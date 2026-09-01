"""Inngest Workflow 1: Daily Commercial Laundry Billing & Ingestion Pipeline."""

from datetime import datetime
from typing import List, Dict, Any, Optional
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
from app.models.db_models import ClientOrganization
from app.db.session import get_engine
from sqlmodel import select, Session
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.google_sheets_service import GoogleSheetsService
from app.services.ocr_service import GeminiOCRService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker

logger = get_logger("daily_billing_pipeline")


async def run_daily_pipeline_core(
    target_month: str,
    target_year: int,
    filter_clients: Optional[List[str]] = None,
    step_runner=None,
) -> Dict[str, Any]:
    """
    Core implementation of the automated daily billing pipeline.
    Runs via Inngest step runner or direct asynchronous execution.
    """
    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("Daily OCR & Ingestion Pipeline", target_month, target_year, total_stages=5)

    try:
        # Step 1: Discover & Pre-flight
        pipeline_tracker.update_progress(
            percent=15,
            stage_index=1,
            current_step=f"Pre-flight: Syncing Zoho catalog & locating review sheet for {target_month} {target_year}...",
        )
        pipeline_tracker.add_log("info", f"Pre-flight: Connecting to Zoho Books & Google Drive ({target_month} {target_year})...")

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

        preflight_data = await _run_step("preflight-and-discovery", run_preflight)
        clients_to_process = preflight_data.get("clients", [])
        sheet_id = preflight_data.get("spreadsheet_id", "")
        sheet_url = preflight_data.get("spreadsheet_url", "")

        pipeline_tracker.update_progress(
            percent=25,
            stage_index=2,
            current_step=f"Discovered {len(clients_to_process)} hotel client folders in Google Drive.",
            stats_update={"clients_total": len(clients_to_process)},
        )
        pipeline_tracker.add_log("info", f"Pre-flight complete: {len(clients_to_process)} client folders found. Spreadsheet: {sheet_url or sheet_id}")

        client_results: List[Dict[str, Any]] = []
        total_slips_processed = 0
        total_items_extracted = 0
        total_discrepancies = 0

        # Step 2: Resilient Client Fan-out Loop
        total_clients_count = len(clients_to_process)
        for c_idx, client_info in enumerate(clients_to_process, start=1):
            client_name = client_info.get("client_name", "")
            client_slug = client_info.get("client_slug", "")
            client_folder_id = client_info.get("folder_id", "")

            step_id = f"process-client-{client_slug}"

            current_pct = 25 + int((c_idx / max(total_clients_count, 1)) * 60)
            pipeline_tracker.update_progress(
                percent=current_pct,
                stage_index=3,
                current_step=f"Processing client {c_idx}/{total_clients_count}: {client_name}...",
            )

            async def process_single_client() -> Dict[str, Any]:
                nonlocal total_items_extracted, total_discrepancies
                logger.info(f"Processing client folder: {client_name} ({client_slug})")
                drive = GoogleDriveService()
                sheets = GoogleSheetsService()
                ocr = GeminiOCRService()

                zoho_org_id = None
                with Session(get_engine()) as session:
                    client_obj = session.exec(
                        select(ClientOrganization).where(
                            (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_name)
                        )
                    ).first()
                    if client_obj:
                        zoho_org_id = client_obj.zoho_org_id

                zoho = ZohoBooksService(org_id=zoho_org_id)

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
                    pipeline_tracker.add_log("info", f"📁 {client_name}: 0 loose slips found (all up to date).")
                    return ClientProcessingResult(
                        client_name=client_name,
                        client_slug=client_slug,
                        files_processed_count=0,
                        line_items_extracted_count=0,
                        sku_summaries_count=0,
                    ).model_dump()

                pipeline_tracker.add_log("info", f"🔍 {client_name}: Found {len(loose_files)} loose slips. Running Gemini Vision OCR...")

                extractions: List[OCRSlipExtraction] = []
                detail_rows: List[DailySlipDetailRow] = []

                for f_idx, f in enumerate(loose_files, start=1):
                    file_id = f["id"]
                    file_name = f.get("name", "slip.jpg")
                    web_link = f.get("webViewLink", "")
                    
                    try:
                        pipeline_tracker.update_progress(
                            percent=min(current_pct + f_idx * 2, 85),
                            current_step=f"OCR Vision: {client_name} - {file_name} ({f_idx}/{len(loose_files)})...",
                        )
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
                        slip_discrepancies = 0
                        for item in extraction.items:
                            if item.unreturned_loss_qty > 0:
                                slip_discrepancies += item.unreturned_loss_qty
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

                        total_items_extracted += len(extraction.items)
                        total_discrepancies += slip_discrepancies

                        pipeline_tracker.add_log(
                            "success",
                            f"✨ {client_name} ({file_name}): Extracted {len(extraction.items)} items (Date: {extraction.slip_date or 'N/A'}).",
                        )

                        # Archive file after successful extraction
                        drive.archive_file(file_id, client_folder_id, processed_folder_id)
                        pipeline_tracker.add_log("info", f"📦 Archived {file_name} into {client_name}/Processed/.")

                    except Exception as file_err:
                        logger.error(f"Error processing slip file {file_name}: {file_err}")
                        pipeline_tracker.add_log("error", f"⚠️ Error processing {file_name}: {file_err}")

                # Tab 1: Append Daily_Slip_Details
                if detail_rows:
                    sheets.append_daily_slip_details(sheet_id, detail_rows)
                    pipeline_tracker.add_log("info", f"📋 Appended {len(detail_rows)} rows to Daily_Slip_Details in review sheet.")

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
                    pipeline_tracker.add_log("info", f"📊 Synced Monthly_Summary rollup ({len(monthly_rows)} SKUs) for {client_name}.")

                return ClientProcessingResult(
                    client_name=client_name,
                    client_slug=client_slug,
                    files_processed_count=len(extractions),
                    line_items_extracted_count=len(detail_rows),
                    sku_summaries_count=len(sku_summaries),
                ).model_dump()

            result = await _run_step(step_id, process_single_client)
            client_results.append(result)
            total_slips_processed += result.get("files_processed_count", 0)

            pipeline_tracker.update_progress(
                percent=min(current_pct + 10, 90),
                stats_update={
                    "clients_done": c_idx,
                    "slips_processed": total_slips_processed,
                    "items_extracted": total_items_extracted,
                    "loss_discrepancies": total_discrepancies,
                },
            )

        # Stage 5: Finalize
        pipeline_tracker.update_progress(
            percent=95,
            stage_index=5,
            current_step="Finalizing workbook and updating review counters...",
        )

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
        pipeline_tracker.complete_pipeline(final_output.model_dump())
        return final_output.model_dump()

    except Exception as e:
        logger.error(f"Pipeline execution failed: {e}")
        pipeline_tracker.fail_pipeline(str(e))
        raise


async def execute_daily_billing_pipeline(ctx: inngest.Context, step: inngest.Step) -> Dict[str, Any]:
    """Inngest entrypoint for the durable daily billing pipeline."""
    event_data = ctx.event.data if hasattr(ctx.event, "data") and ctx.event.data else {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    filter_clients = event_data.get("client_slugs")

    return await run_daily_pipeline_core(
        target_month=target_month,
        target_year=target_year,
        filter_clients=filter_clients,
        step_runner=step.run,
    )


# Register durable Inngest function
anr_daily_billing_pipeline = inngest_client.create_function(
    fn_id="anr_daily_billing_pipeline",
    trigger=[
        inngest.TriggerCron(cron="0 23 * * *"),  # Daily at 11:00 PM GMT
        inngest.TriggerEvent(event="anr/pipeline.trigger"),
    ],
)(execute_daily_billing_pipeline)

