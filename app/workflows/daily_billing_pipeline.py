"""Inngest Workflow 1: Daily Commercial Laundry Billing & Ingestion Pipeline."""

from datetime import datetime
from typing import List, Dict, Any, Optional
import inngest
import hashlib
import uuid
import re

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
from app.models.db_models import ClientOrganization, StagedTransaction
from app.db.session import get_engine
from sqlmodel import select, Session
from app.services.zoho_service import ZohoBooksService
from app.services.google_drive_service import GoogleDriveService
from app.services.ocr_service import GeminiOCRService, AIModelUnavailableException, is_model_unavailable_error
from app.services.customer_matcher import CustomerMatcher
from app.utils.date_parser import resolve_transaction_date
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
            current_step=f"Pre-flight: Syncing Zoho catalog & scanning Drive folders for {target_month} {target_year}...",
        )
        pipeline_tracker.add_log("info", f"Pre-flight: Connecting to Zoho Books & Google Drive ({target_month} {target_year})...")

        async def run_preflight() -> Dict[str, Any]:
            logger.info(f"Running Pre-flight Discovery for {target_month} {target_year}...")
            zoho = ZohoBooksService()
            contacts = await zoho.fetch_active_contacts()
            items = await zoho.fetch_item_catalog()

            drive = GoogleDriveService()
            month_folder_id = drive.get_month_folder(target_month, target_year)
            sheet_id, sheet_url = None, None
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
        pipeline_tracker.add_log("info", f"Pre-flight complete: {len(clients_to_process)} client folders found.")

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
                ocr = GeminiOCRService()

                client_obj = None
                zoho_org_id = None
                customer_mappings = {}
                try:
                    with Session(get_engine()) as session:
                        client_obj = session.exec(
                            select(ClientOrganization).where(
                                (ClientOrganization.id == client_slug) | (ClientOrganization.name == client_name)
                            )
                        ).first()
                        if client_obj:
                            zoho_org_id = client_obj.zoho_org_id
                            customer_mappings = (client_obj.custom_config or {}).get("customer_mappings", {})
                except Exception as db_err:
                    logger.warning(f"Could not load ClientOrganization for '{client_slug}' ({db_err}). Proceeding with default configuration.")

                zoho = ZohoBooksService(org_id=zoho_org_id)

                # Ensure contacts & items catalog are ready
                contacts = await zoho.fetch_active_contacts()
                items = await zoho.fetch_item_catalog()

                # First Line of Defence: Check Customer Mapping Registry (with case-insensitive fallback)
                zoho_contact_id = ""
                mapping_entry = customer_mappings.get(client_name)
                if not mapping_entry:
                    c_lower = client_name.strip().lower()
                    for m_key, m_val in customer_mappings.items():
                        if m_key.strip().lower() == c_lower:
                            mapping_entry = m_val
                            break

                if mapping_entry and mapping_entry.get("zoho_contact_id"):
                    zoho_contact_id = mapping_entry.get("zoho_contact_id")
                else:
                    # Find matching Zoho Contact ID via active contacts cache
                    zoho_contact = zoho.find_contact_by_name(client_name)
                    zoho_contact_id = zoho_contact.contact_id if zoho_contact else ""

                # Check / Create Processed/ subfolder
                processed_folder_id = drive.find_or_create_folder("Processed", client_folder_id)

                # Discover existing staged transactions for this client to ensure idempotency
                existing_staged_files = set()
                existing_staged_file_ids = set()
                client_identifiers = {client_slug, client_name}
                if client_obj and client_obj.id:
                    client_identifiers.add(client_obj.id)

                try:
                    with Session(get_engine()) as session:
                        staged_rows = session.exec(
                            select(StagedTransaction.source_file_name, StagedTransaction.source_identifier).where(
                                StagedTransaction.client_id.in_(list(client_identifiers))
                            )
                        ).all()
                        for fname, fid in staged_rows:
                            if fname:
                                existing_staged_files.add(fname)
                            if fid:
                                existing_staged_file_ids.add(fid)
                except Exception as db_err:
                    logger.warning(f"Could not load existing staged transactions for client {client_name}: {db_err}")

                # List loose unarchived files in client folder root
                loose_files = drive.list_unprocessed_slips(client_folder_id)

                # List slips in Processed folder for self-healing recovery sweep
                processed_files = []
                if processed_folder_id:
                    try:
                        processed_files = drive.list_unprocessed_slips(processed_folder_id)
                    except Exception as proc_err:
                        logger.warning(f"Could not scan Processed folder for client {client_name}: {proc_err}")

                # Build slip queue: (file_dict, already_in_processed)
                slips_to_process = []
                for f in loose_files:
                    f_name = f.get("name")
                    f_id = f.get("id")
                    if (f_name and f_name in existing_staged_files) or (f_id and f_id in existing_staged_file_ids):
                        # File was already staged into PostgreSQL previously but left loose; archive it
                        try:
                            drive.archive_file(f_id, client_folder_id, processed_folder_id)
                            logger.info(f"Archived already-staged loose file {f_name} into Processed/")
                        except Exception as arch_err:
                            logger.warning(f"Could not archive already-staged file {f_name}: {arch_err}")
                    else:
                        slips_to_process.append((f, False))

                # Check for unindexed recovery slips in Processed/ folder
                unindexed_recovery_count = 0
                for f in processed_files:
                    f_name = f.get("name")
                    f_id = f.get("id")
                    if (not f_name or f_name not in existing_staged_files) and (not f_id or f_id not in existing_staged_file_ids):
                        slips_to_process.append((f, True))
                        unindexed_recovery_count += 1

                if unindexed_recovery_count > 0:
                    pipeline_tracker.add_log(
                        "info",
                        f"🔄 {client_name}: Found {unindexed_recovery_count} unindexed slip(s) in Processed/ folder. Initiating self-healing recovery sweep..."
                    )

                if not slips_to_process:
                    logger.info(f"No loose or unindexed slips to process for client: {client_name}")
                    pipeline_tracker.add_log("info", f"📁 {client_name}: All slips up to date in database ledger.")
                    return ClientProcessingResult(
                        client_name=client_name,
                        client_slug=client_slug,
                        files_processed_count=0,
                        line_items_extracted_count=0,
                        sku_summaries_count=0,
                    ).model_dump()

                pipeline_tracker.add_log(
                    "info",
                    f"🔍 {client_name}: Found {len(slips_to_process)} slip(s) to process ({unindexed_recovery_count} recovery from Processed/). Running Gemini Vision OCR..."
                )

                batch_id = f"batch_{client_slug}_{target_month.lower()}_{target_year}_{uuid.uuid4().hex[:6]}"
                extractions: List[OCRSlipExtraction] = []
                detail_rows: List[DailySlipDetailRow] = []

                for f_idx, (f, already_in_processed) in enumerate(slips_to_process, start=1):
                    file_id = f["id"]
                    file_name = f.get("name", "slip.jpg")
                    web_link = f.get("webViewLink", "")
                    
                    try:
                        recovery_label = " (Recovery)" if already_in_processed else ""
                        pipeline_tracker.update_progress(
                            percent=min(current_pct + f_idx * 2, 85),
                            current_step=f"OCR Vision{recovery_label}: {client_name} - {file_name} ({f_idx}/{len(slips_to_process)})...",
                        )
                        file_bytes, mime_type = drive.download_file_bytes(file_id)
                        file_checksum = hashlib.sha256(file_bytes).hexdigest()

                        extraction = await ocr.extract_slip_data(
                            file_bytes=file_bytes,
                            mime_type=mime_type,
                            file_name=file_name,
                            client_name=client_name,
                            item_catalog=items,
                            customer_catalog=contacts,
                            known_aliases=customer_mappings,
                        )
                        extractions.append(extraction)

                        # Resolve transaction date using robust date parser
                        tx_date = resolve_transaction_date(
                            extracted_date=extraction.slip_date,
                            file_name=file_name,
                            target_month=target_month,
                            target_year=target_year,
                        )

                        # Intelligent Customer Resolution using CustomerMatcher
                        detected_hotel = (
                            extraction.reconciled_customer_name
                            or extraction.raw_customer_name
                            or client_name
                        )
                        matched_contact_id = zoho_contact_id
                        matched_contact_name = client_name
                        match_tier = "exact_client_match" if zoho_contact_id else "unmatched"
                        match_conf = 1.0 if zoho_contact_id else 0.0
                        is_reconciled = bool(zoho_contact_id)
                        candidate_suggestions = []

                        if detected_hotel:
                            match_res = CustomerMatcher.match_customer(
                                raw_name=detected_hotel,
                                contacts=contacts,
                                customer_mappings=customer_mappings,
                            )
                            if match_res.is_auto_matched and match_res.matched_contact_id:
                                matched_contact_id = match_res.matched_contact_id
                                matched_contact_name = match_res.matched_contact_name or detected_hotel
                                is_reconciled = True
                                match_tier = match_res.match_tier
                                match_conf = match_res.confidence_score
                            elif match_res.matched_contact_id:
                                matched_contact_name = match_res.matched_contact_name or detected_hotel
                                match_tier = match_res.match_tier
                                match_conf = match_res.confidence_score
                                candidate_suggestions = [c.model_dump() for c in match_res.candidate_suggestions]

                        processed_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        slip_discrepancies = 0
                        staged_items: List[StagedTransaction] = []

                        if not extraction.items:
                            # Stage a fallback review transaction so unparseable/empty slips are visible in the ledger
                            staged_tx = StagedTransaction(
                                client_id=client_obj.id if client_obj else client_slug,
                                batch_id=batch_id,
                                pipeline_id="pipe_daily_slips",
                                pipeline_name="Daily Control Slips OCR",
                                pipeline_type="AR",
                                entity_type="ar_sales_invoice",
                                transaction_date=str(tx_date),
                                source_type="google_drive",
                                source_file_name=str(file_name),
                                source_identifier=str(file_id),
                                item_or_description="Unparsed Slip - Manual Review Required",
                                category_or_account="Linen Laundry Service",
                                quantity_or_debit=0.0,
                                credit_amount=0.0,
                                rate_or_price=0.0,
                                total_amount=0.0,
                                confidence_score=0.2,
                                discrepancy_amount=0.0,
                                discrepancy_reason=None,
                                accounting_ref_id=str(matched_contact_id) if matched_contact_id else None,
                                reviewed=False,
                                approved=False,
                                status="PENDING",
                                validation_status="PENDING_VALIDATION_ERROR",
                                validation_errors=[{"field": "items", "message": "No items extracted from slip"}],
                                checksum=file_checksum,
                                metadata_json={
                                    "hotel_name": detected_hotel,
                                    "customer_name": matched_contact_name,
                                    "file_name": file_name,
                                    "source_identifier": file_id,
                                    "drive_file_url": web_link or f"https://drive.google.com/file/d/{file_id}/view",
                                    "slip_date": extraction.slip_date,
                                    "processed_at": processed_time_str,
                                },
                            )
                            staged_items.append(staged_tx)

                        for item in extraction.items:
                            if item.unreturned_loss_qty > 0:
                                slip_discrepancies += item.unreturned_loss_qty

                            unit_rate = item.unit_rate or 15.0
                            qty = float(item.delivery_qty if item.delivery_qty > 0 else (item.pickup_qty or 0))
                            credit_amount = float(item.pickup_qty or 0)
                            total_amount = float(qty * unit_rate)
                            discrepancy = float(item.unreturned_loss_qty or max(0, (item.pickup_qty or 0) - (item.delivery_qty or 0)))

                            raw_desc = item.standard_item_name or item.raw_item_name or "Linen Item"
                            clean_desc = re.sub(r"^[:;\s\-•.]+", "", str(raw_desc)).strip()

                            item_metadata = {
                                "hotel_name": detected_hotel,
                                "customer_name": matched_contact_name,
                                "raw_customer_name": extraction.raw_customer_name,
                                "reconciled_customer_name": extraction.reconciled_customer_name,
                                "zoho_contact_id": matched_contact_id,
                                "customer_reconciled": is_reconciled,
                                "customer_match_tier": match_tier,
                                "customer_confidence": match_conf,
                                "candidate_suggestions": candidate_suggestions,
                                "pickup_qty": item.pickup_qty,
                                "delivery_qty": item.delivery_qty,
                                "loss_qty": item.unreturned_loss_qty,
                                "raw_item_name": item.raw_item_name,
                                "standard_item_name": item.standard_item_name,
                                "unit_rate": unit_rate,
                                "file_name": file_name,
                                "source_identifier": file_id,
                                "drive_file_url": web_link or f"https://drive.google.com/file/d/{file_id}/view",
                                "slip_date": extraction.slip_date,
                                "processed_at": processed_time_str,
                            }

                            conf_str = item.confidence_score.value if hasattr(item.confidence_score, "value") else str(item.confidence_score)
                            float_conf = 0.95 if conf_str == "HIGH" else (0.80 if conf_str == "MEDIUM" else 0.60)

                            staged_tx = StagedTransaction(
                                client_id=client_obj.id if client_obj else client_slug,
                                batch_id=batch_id,
                                pipeline_id="pipe_daily_slips",
                                pipeline_name="Daily Control Slips OCR",
                                pipeline_type="AR",
                                entity_type="ar_sales_invoice",
                                transaction_date=str(tx_date),
                                source_type="google_drive",
                                source_file_name=str(file_name),
                                source_identifier=str(file_id),
                                item_or_description=clean_desc,
                                category_or_account="Linen Laundry Service",
                                quantity_or_debit=qty,
                                credit_amount=credit_amount,
                                rate_or_price=float(unit_rate),
                                total_amount=float(total_amount),
                                confidence_score=float_conf,
                                discrepancy_amount=float(discrepancy),
                                discrepancy_reason=f"Unreturned loss qty: {discrepancy}" if discrepancy > 0 else None,
                                accounting_ref_id=str(matched_contact_id) if matched_contact_id else None,
                                reviewed=False,
                                approved=False,
                                status="PENDING",
                                validation_status="VALID" if is_reconciled else "PENDING_CUSTOMER_MAPPING",
                                validation_errors=[] if is_reconciled else [{"field": "customer_name", "message": f"Customer '{detected_hotel}' requires mapping"}],
                                checksum=file_checksum,
                                metadata_json=item_metadata,
                            )
                            staged_items.append(staged_tx)

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

                        # Commit staged transactions to PostgreSQL BEFORE archiving the file
                        if staged_items:
                            with Session(get_engine()) as session:
                                session.add_all(staged_items)
                                session.commit()
                            logger.info(f"Committed {len(staged_items)} staged transactions into database for {file_name}")

                        # Update in-memory set to prevent duplicate processing in the same run
                        existing_staged_files.add(file_name)
                        existing_staged_file_ids.add(file_id)

                        total_items_extracted += len(extraction.items)
                        total_discrepancies += slip_discrepancies

                        pipeline_tracker.add_log(
                            "success",
                            f"✨ {client_name} ({file_name}): Extracted and staged {len(extraction.items)} items (Date: {tx_date}, Customer: {matched_contact_name}).",
                        )

                        # Archive file after successful staging (only if not already in Processed)
                        if not already_in_processed:
                            drive.archive_file(file_id, client_folder_id, processed_folder_id)
                            pipeline_tracker.add_log("info", f"📦 Archived {file_name} into {client_name}/Processed/.")
                        else:
                            pipeline_tracker.add_log("info", f"✅ Successfully recovered and staged {file_name} from Processed/.")

                    except AIModelUnavailableException as ai_err:
                        err_msg = f"AI model not available: {ai_err}"
                        logger.error(err_msg)
                        pipeline_tracker.add_log("error", f"🚨 {err_msg}")
                        pipeline_tracker.fail_pipeline(err_msg)
                        raise
                    except Exception as file_err:
                        if is_model_unavailable_error(file_err):
                            err_msg = f"AI model not available: {file_err}"
                            logger.error(err_msg)
                            pipeline_tracker.add_log("error", f"🚨 {err_msg}")
                            pipeline_tracker.fail_pipeline(err_msg)
                            raise AIModelUnavailableException(err_msg) from file_err
                        logger.error(f"Error processing slip file {file_name}: {file_err}")
                        pipeline_tracker.add_log("error", f"⚠️ Error processing {file_name}: {file_err}")

                sku_summaries = ocr.aggregate_monthly_skus(
                    client_name=client_name,
                    zoho_contact_id=zoho_contact_id,
                    extractions=extractions,
                    item_catalog=items,
                )

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
        if e.__class__.__name__ in ("StepInterrupt", "InngestStepInterrupt"):
            raise
        logger.error(f"Pipeline execution failed: {e}")
        pipeline_tracker.fail_pipeline(str(e))
        raise


async def execute_daily_billing_pipeline(
    ctx: inngest.Context,
    step: Optional[inngest.Step] = None,
) -> Dict[str, Any]:
    """Inngest entrypoint for the durable daily billing pipeline."""
    event_data = ctx.event.data if hasattr(ctx.event, "data") and ctx.event.data else {}
    now = datetime.now()
    target_month = event_data.get("month") or now.strftime("%B")
    target_year = int(event_data.get("year") or now.year)
    filter_clients = event_data.get("client_slugs")

    step_runner = None
    if hasattr(ctx, "step") and ctx.step:
        async def _ctx_step_runner(name: str, fn):
            return await ctx.step.run(name, fn)
        step_runner = _ctx_step_runner
    elif step and hasattr(step, "run"):
        async def _direct_step_runner(name: str, fn):
            return await step.run(name, fn)
        step_runner = _direct_step_runner

    return await run_daily_pipeline_core(
        target_month=target_month,
        target_year=target_year,
        filter_clients=filter_clients,
        step_runner=step_runner,
    )


# Register durable Inngest function
daily_slip_billing_pipeline = inngest_client.create_function(
    fn_id="daily_slip_billing_pipeline",
    trigger=[
        inngest.TriggerEvent(event="s4/pipeline.trigger"),
        inngest.TriggerEvent(event="anr/pipeline.trigger"),
    ],
)(execute_daily_billing_pipeline)

anr_daily_billing_pipeline = daily_slip_billing_pipeline

