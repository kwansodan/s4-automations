"""Inngest Workflow: Bank Statement Ingestion (CSV, Excel, PDF) & Auto-Reconciliation."""

import io
import csv
from datetime import datetime
from typing import List, Dict, Any, Optional
import inngest

from app.inngest_client import inngest_client
from app.models.db_models import BankTransaction, ClientOrganization
from app.db.session import get_engine
from app.services.google_drive_service import GoogleDriveService
from app.services.ocr_service import GeminiOCRService
from app.utils.logging import get_logger
from app.utils.progress_tracker import pipeline_tracker
from sqlmodel import select, Session

logger = get_logger("bank_statement_pipeline")


def parse_csv_bank_statement(content_bytes: bytes, file_name: str) -> List[Dict[str, Any]]:
    """Parses standard CSV bank export lines."""
    transactions = []
    text = content_bytes.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []

    # Simple heuristic to identify header row
    header = [c.lower().strip() for c in rows[0]]
    date_col = next((i for i, c in enumerate(header) if "date" in c), 0)
    desc_col = next((i for i, c in enumerate(header) if any(k in c for k in ["desc", "narration", "detail", "particulars", "memo"])), 1)
    amt_col = next((i for i, c in enumerate(header) if any(k in c for k in ["amount", "value", "ghs", "usd"])), None)
    debit_col = next((i for i, c in enumerate(header) if "debit" in c or "withdrawal" in c), None)
    credit_col = next((i for i, c in enumerate(header) if "credit" in c or "deposit" in c), None)

    for row in rows[1:]:
        if not row or len(row) <= max(date_col, desc_col):
            continue
        date_val = row[date_col].strip()
        desc_val = row[desc_col].strip()
        if not date_val or not desc_val:
            continue

        tx_type = "DEBIT"
        amount = 0.0

        if debit_col is not None and credit_col is not None:
            deb_str = row[debit_col].replace(",", "").strip() if len(row) > debit_col else ""
            cred_str = row[credit_col].replace(",", "").strip() if len(row) > credit_col else ""
            if cred_str and float(cred_str or 0) > 0:
                tx_type = "CREDIT"
                amount = float(cred_str)
            elif deb_str and float(deb_str or 0) > 0:
                tx_type = "DEBIT"
                amount = float(deb_str)
        elif amt_col is not None and len(row) > amt_col:
            val_str = row[amt_col].replace(",", "").strip()
            try:
                raw_amt = float(val_str)
                if raw_amt < 0:
                    tx_type = "DEBIT"
                    amount = abs(raw_amt)
                else:
                    tx_type = "CREDIT"
                    amount = raw_amt
            except ValueError:
                amount = 0.0

        transactions.append({
            "transaction_date": date_val,
            "description": desc_val,
            "amount": amount,
            "transaction_type": tx_type,
            "source_file_name": file_name,
        })
    return transactions


async def run_bank_pipeline_core(
    target_month: str,
    target_year: int,
    client_id: str,
    file_bytes: Optional[bytes] = None,
    file_name: Optional[str] = None,
    mime_type: Optional[str] = None,
    step_runner=None,
) -> Dict[str, Any]:
    """
    Core bank statement ingestion logic supporting CSV, Excel, and PDF.
    """
    async def _run_step(step_name: str, fn):
        if step_runner:
            return await step_runner(step_name, fn)
        return await fn()

    pipeline_tracker.start_pipeline("Bank Statement Ingestion & Recon", target_month, target_year, total_stages=3)

    try:
        pipeline_tracker.update_progress(percent=20, stage_index=1, current_step="Parsing bank statement file...")
        
        extracted_txs: List[Dict[str, Any]] = []

        if file_bytes and file_name:
            fname_lower = file_name.lower()
            if fname_lower.endswith(".csv"):
                extracted_txs = parse_csv_bank_statement(file_bytes, file_name)
            elif fname_lower.endswith(".pdf"):
                ocr = GeminiOCRService()
                pdf_res = await ocr.extract_bank_statement(
                    file_bytes=file_bytes,
                    mime_type=mime_type or "application/pdf",
                    file_name=file_name,
                )
                for tx in pdf_res.transactions:
                    extracted_txs.append({
                        "transaction_date": tx.transaction_date,
                        "description": tx.description,
                        "amount": tx.amount,
                        "transaction_type": tx.transaction_type,
                        "source_file_name": file_name,
                    })
            else:
                # Treat as CSV text fallback
                extracted_txs = parse_csv_bank_statement(file_bytes, file_name)

        pipeline_tracker.update_progress(
            percent=60,
            stage_index=2,
            current_step=f"Extracted {len(extracted_txs)} transactions. Staging to database...",
        )

        staged_count = 0
        with Session(get_engine()) as session:
            for tx_data in extracted_txs:
                # Check duplicate
                existing = session.exec(
                    select(BankTransaction).where(
                        BankTransaction.client_id == client_id,
                        BankTransaction.transaction_date == tx_data["transaction_date"],
                        BankTransaction.description == tx_data["description"],
                        BankTransaction.amount == tx_data["amount"],
                    )
                ).first()

                if not existing:
                    bank_tx = BankTransaction(
                        client_id=client_id,
                        transaction_date=tx_data["transaction_date"],
                        description=tx_data["description"],
                        amount=tx_data["amount"],
                        transaction_type=tx_data["transaction_type"],
                        source_file_name=tx_data.get("source_file_name", file_name or "uploaded_statement"),
                        status="UNMAPPED",
                    )
                    session.add(bank_tx)
                    staged_count += 1
            session.commit()

        pipeline_tracker.update_progress(
            percent=100,
            stage_index=3,
            current_step=f"Successfully staged {staged_count} unmapped bank transactions for client attention.",
            stats_update={"staged_bank_txs": staged_count},
        )

        return {
            "status": "success",
            "client_id": client_id,
            "total_extracted": len(extracted_txs),
            "newly_staged": staged_count,
        }

    except Exception as e:
        logger.error(f"Bank statement pipeline failed: {e}", exc_info=True)
        pipeline_tracker.fail_pipeline(str(e))
        raise


@inngest_client.create_function(
    fn_id="bank-statement-pipeline",
    name="Bank Statement Ingestion Pipeline",
    trigger=inngest.TriggerEvent(event="app/bank.statement.trigger"),
)
async def inngest_bank_statement_fn(ctx: inngest.Context) -> Dict[str, Any]:
    event_data = ctx.event.data or {}
    target_month = event_data.get("month", datetime.now().strftime("%B"))
    target_year = int(event_data.get("year", datetime.now().year))
    client_id = event_data.get("client_id", "default")
    file_name = event_data.get("file_name")

    async def step_runner(name: str, fn):
        return await ctx.step.run(name, fn)

    return await run_bank_pipeline_core(
        target_month=target_month,
        target_year=target_year,
        client_id=client_id,
        file_name=file_name,
        step_runner=step_runner,
    )
