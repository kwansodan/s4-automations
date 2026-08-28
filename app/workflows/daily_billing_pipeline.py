"""Inngest Workflow 1: Daily Commercial Laundry Billing & Ingestion Pipeline."""

from datetime import datetime
from typing import List, Dict, Any
import inngest

from app.inngest_client import inngest_client
from app.models.schemas import (
    DailySlipDetailRow,
    MonthlySummaryRow,
    OCRSlipExtraction,
    ClientFolderInfo,
    PreflightDiscoveryResult,
    ClientProcessingResult,
    PipelineRunResult,
    ConfidenceLevel,
    SlipStatus,
)
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.services.ocr_service import GeminiOCRService
from app.utils.logging import get_logger

logger = get_logger("daily_billing_pipeline")


async def execute_daily_billing_pipeline(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    """
    Automated durable pipeline:
    1. Pre-flight & Discovery: Sync Zoho catalog, locate Month folder & review spreadsheet, discover client folders.
    2. Resilient Fan-out: Process loose slips for each hotel client.
    3. Vision OCR: Extract structured data and reconcile SKUs with Gemini 3.6 Flash.
    4. Two-Tier Sheets Sync: Append Daily_Slip_Details and upsert Monthly_Summary.
    5. Archival: Move processed files into client_folder/Processed/.
    """
    event_data = ctx.event.data if hasattr(ctx.event, "data") and ctx.event.data else {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    filter_clients = event_data.get("client_slugs")

    # Step 1: Discover & Pre-flight
    async def run_preflight() -> Dict[str, Any]:
        logger.info(f"Running Pre-flight Discovery for {target_month} {target_year}...")
        zoho = ZohoBooksService()
        contacts = await zoho.fetch_active_contacts()
        items = await zoho.fetch_item_catalog()

        drive = GoogleDriveService()
        sheets = GoogleSheetsService()

        month_folder_id = drive.get_month_folder(target_month, target_year)
        sheet_id, sheet_url = sheets.find_or_create_workbook(target_month, target_year, month_folder_id)
        clients = drive.list_client_folders(month_folder_id)

        # Filter clients if requested in event
        if filter_clients:
            clients = [c for c in clients if c.client_slug in filter_clients or c.client_name in filter_clients]

        result = PreflightDiscoveryResult(
            month_name=target_month,
            year=target_year,
            month_folder_id=month_folder_id,
            spreadsheet_id=sheet_id,
            spreadsheet_url=sheet_url,
            clients=clients,
            active_contacts_count=len(contacts),
            active_items_count=len(items),
        )
        return result.model_dump()

    preflight_data = await step.run("preflight-and-discovery", run_preflight)
    clients_to_process = preflight_data.get("clients", [])
    sheet_id = preflight_data.get("spreadsheet_id", "")
    sheet_url = preflight_data.get("spreadsheet_url", "")

    client_results: List[Dict[str, Any]] = []
    total_slips_processed = 0

    # Step 2: Resilient Client Fan-out Loop
    for client_info in clients_to_process:
        client_name = client_info.get("client_name", "")
        client_slug = client_info.get("client_slug", "")
        client_folder_id = client_info.get("folder_id", "")

        step_id = f"process-client-{client_slug}"

        async def process_single_client() -> Dict[str, Any]:
            logger.info(f"Processing client folder: {client_name} ({client_slug})")
            drive = GoogleDriveService()
            sheets = GoogleSheetsService()
            ocr = GeminiOCRService()
            zoho = ZohoBooksService()

            # Ensure contacts & items catalog are ready
            contacts = await zoho.fetch_active_contacts()
            items = await zoho.fetch_item_catalog()

            # Find matching Zoho Contact ID
            zoho_contact = zoho.find_contact_by_name(client_name)
            zoho_contact_id = zoho_contact.contact_id if zoho_contact else ""

            # Check / Create Processed/ subfolder
            processed_folder_id = drive.find_or_create_folder("Processed", client_folder_id)

            # List loose unarchived files
            loose_files = drive.list_unprocessed_slips(client_folder_id)
            if not loose_files:
                logger.info(f"No loose slips to process for client: {client_name}")
                return ClientProcessingResult(
                    client_name=client_name,
                    client_slug=client_slug,
                    files_processed_count=0,
                    line_items_extracted_count=0,
                    sku_summaries_count=0,
                ).model_dump()

            extractions: List[OCRSlipExtraction] = []
            detail_rows: List[DailySlipDetailRow] = []

            for f in loose_files:
                file_id = f["id"]
                file_name = f.get("name", "slip.jpg")
                web_link = f.get("webViewLink", "")
                
                try:
                    file_bytes, mime_type = drive.download_file_bytes(file_id)
                    extraction = await ocr.extract_slip_data(
                        file_bytes=file_bytes,
                        mime_type=mime_type,
                        file_name=file_name,
                        client_name=client_name,
                        item_catalog=items,
                    )
                    extractions.append(extraction)

                    # Build Tab 1: Daily_Slip_Details rows
                    processed_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    for item in extraction.items:
                        detail_rows.append(
                            DailySlipDetailRow(
                                slip_date=extraction.slip_date or datetime.now().strftime("%d/%m/%Y"),
                                file_name=file_name,
                                client_name=client_name,
                                raw_item_name=item.raw_item_name,
                                standard_item_name=item.standard_item_name,
                                pickup_qty=item.pickup_qty,
                                delivery_qty=item.delivery_qty,
                                loss_qty=item.unreturned_loss_qty,
                                confidence_score=item.confidence_score,
                                drive_file_url=web_link,
                                processed_at=processed_time_str,
                            )
                        )

                    # Archive file after successful extraction
                    drive.archive_file(file_id, client_folder_id, processed_folder_id)

                except Exception as file_err:
                    logger.error(f"Error processing slip file {file_name}: {file_err}")

            # Tab 1: Append Daily_Slip_Details
            if detail_rows:
                sheets.append_daily_slip_details(sheet_id, detail_rows)

            # Tab 2: Aggregate & Sync Monthly_Summary
            sku_summaries = ocr.aggregate_monthly_skus(
                client_name=client_name,
                zoho_contact_id=zoho_contact_id,
                extractions=extractions,
                item_catalog=items,
            )

            monthly_rows = [
                MonthlySummaryRow(
                    client_name=s.client_name,
                    zoho_contact_id=s.zoho_contact_id,
                    zoho_item_id=s.zoho_item_id,
                    standard_item_name=s.standard_item_name,
                    raw_names_seen=s.raw_names_display,
                    confidence_score=s.confidence_score,
                    unit_rate=s.unit_rate,
                    total_picked_up=s.total_pickup_qty,
                    total_delivered=s.total_delivery_qty,
                    linen_discrepancy=s.total_loss_qty,
                    total_billed=s.line_total_amount,
                    audit_notes=s.audit_notes,
                    reviewed=s.reviewed,
                    approved=s.approved,
                    status=s.status,
                )
                for s in sku_summaries
            ]

            if monthly_rows:
                sheets.sync_monthly_summaries(sheet_id, monthly_rows)

            return ClientProcessingResult(
                client_name=client_name,
                client_slug=client_slug,
                files_processed_count=len(extractions),
                line_items_extracted_count=len(detail_rows),
                sku_summaries_count=len(sku_summaries),
            ).model_dump()

        result = await step.run(step_id, process_single_client)
        client_results.append(result)
        total_slips_processed += result.get("files_processed_count", 0)

    # Pipeline summary result
    final_output = PipelineRunResult(
        run_id=f"run_{int(datetime.now().timestamp())}",
        month_name=target_month,
        year=target_year,
        spreadsheet_id=sheet_id,
        spreadsheet_url=sheet_url,
        total_clients_discovered=len(clients_to_process),
        clients_processed=[ClientProcessingResult.model_validate(r) for r in client_results],
        total_slips_processed=total_slips_processed,
        status="COMPLETED",
    )
    logger.info(f"Pipeline completed successfully. Processed {total_slips_processed} slips across {len(client_results)} clients.")
    return final_output.model_dump()


# Register durable Inngest function
anr_daily_billing_pipeline = inngest_client.create_function(
    fn_id="anr_daily_billing_pipeline",
    trigger=[
        inngest.TriggerCron(cron="0 23 * * *"),  # Daily at 11:00 PM GMT
        inngest.TriggerEvent(event="anr/pipeline.trigger"),
    ],
)(execute_daily_billing_pipeline)

