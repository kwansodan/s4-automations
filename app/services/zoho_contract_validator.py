"""Zoho API Contract Validator for S4 Ingestion Pipelines.

Strictly validates extracted source document data against target Zoho Books REST API contracts.
Enforces field requisites, math integrity, date checks, and entity/catalog resolution.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime

from app.models.schemas import ContractValidationResult, ValidationIssue, ZohoContact, ZohoItem
from app.models.db_models import AccountingEntityType
from app.utils.logging import get_logger

logger = get_logger("zoho_contract_validator")


class ZohoContractValidator:
    """Validates extracted document data strictly according to target Zoho Books endpoint requisites."""

    @classmethod
    def validate_entity(
        cls,
        entity_type: str,
        extracted_data: Dict[str, Any],
        zoho_contacts: Optional[List[ZohoContact]] = None,
        zoho_items: Optional[List[ZohoItem]] = None,
        variance_tolerance: float = 1.0,
    ) -> ContractValidationResult:
        """
        Validates extracted_data against the specific requirements of entity_type.
        Returns ContractValidationResult with is_valid=True or list of ValidationIssue.
        """
        contacts = zoho_contacts or []
        items_catalog = zoho_items or []
        issues: List[ValidationIssue] = []

        # Normalization
        norm = dict(extracted_data)

        # -------------------------------------------------------------
        # 1. Date Validation (Applies to all accounting entities)
        # -------------------------------------------------------------
        date_str = (
            extracted_data.get("date")
            or extracted_data.get("bill_date")
            or extracted_data.get("slip_date")
            or extracted_data.get("transaction_date")
            or extracted_data.get("journal_date")
        )
        if not date_str:
            issues.append(
                ValidationIssue(
                    field_name="date",
                    error_type="MISSING_MANDATORY_FIELD",
                    message="Missing transaction date required by Zoho API.",
                    severity="CRITICAL",
                )
            )
        else:
            # Check format DD/MM/YYYY or YYYY-MM-DD
            parsed_date = cls._try_parse_date(date_str)
            if not parsed_date:
                issues.append(
                    ValidationIssue(
                        field_name="date",
                        error_type="INVALID_DATE",
                        message=f"Invalid date format '{date_str}'. Expected YYYY-MM-DD or DD/MM/YYYY.",
                        received_value=date_str,
                        severity="CRITICAL",
                    )
                )
            else:
                norm["date"] = parsed_date

        # -------------------------------------------------------------
        # 2. Entity-Specific Contract Rules
        # -------------------------------------------------------------

        # === AR: CUSTOMER SALES INVOICE ===
        if entity_type == AccountingEntityType.AR_SALES_INVOICE.value:
            customer_name = (
                extracted_data.get("customer_name")
                or extracted_data.get("client_name")
                or extracted_data.get("customer_id")
            )
            if not customer_name:
                issues.append(
                    ValidationIssue(
                        field_name="customer_id",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing customer name or Zoho customer_id for Sales Invoice.",
                        severity="CRITICAL",
                    )
                )
            elif contacts:
                matched = cls._match_contact(customer_name, contacts)
                if not matched:
                    issues.append(
                        ValidationIssue(
                            field_name="customer_id",
                            error_type="UNMATCHED_ENTITY",
                            message=f"Customer '{customer_name}' does not match any active contact in Zoho Books.",
                            received_value=customer_name,
                            severity="CRITICAL",
                        )
                    )
                else:
                    norm["customer_id"] = matched.contact_id

            # Line items check
            raw_items = extracted_data.get("items") or extracted_data.get("line_items") or []
            if not raw_items:
                issues.append(
                    ValidationIssue(
                        field_name="line_items",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Zoho Invoice requires at least one valid line item.",
                        severity="CRITICAL",
                    )
                )
            else:
                cls._validate_line_items_math(raw_items, extracted_data.get("total_amount"), variance_tolerance, issues)

        # === AR: CUSTOMER PAYMENT ===
        elif entity_type == AccountingEntityType.AR_CUSTOMER_PAYMENT.value:
            customer_name = (
                extracted_data.get("customer_name")
                or extracted_data.get("client_name")
                or extracted_data.get("payer_name")
            )
            amount = float(extracted_data.get("amount") or extracted_data.get("total_amount") or 0.0)

            if not customer_name:
                issues.append(
                    ValidationIssue(
                        field_name="customer_id",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing Customer / Payer identification for Customer Payment.",
                        severity="CRITICAL",
                    )
                )
            elif contacts:
                matched = cls._match_contact(customer_name, contacts)
                if not matched:
                    issues.append(
                        ValidationIssue(
                            field_name="customer_id",
                            error_type="UNMATCHED_ENTITY",
                            message=f"Payer '{customer_name}' not found in Zoho customer contacts.",
                            received_value=customer_name,
                            severity="CRITICAL",
                        )
                    )
                else:
                    norm["customer_id"] = matched.contact_id

            if amount <= 0:
                issues.append(
                    ValidationIssue(
                        field_name="amount",
                        error_type="MISSING_MANDATORY_FIELD",
                        message=f"Payment amount must be greater than zero (received: {amount}).",
                        received_value=amount,
                        severity="CRITICAL",
                    )
                )

        # === AR: CREDIT NOTE ===
        elif entity_type == AccountingEntityType.AR_CREDIT_NOTE.value:
            customer_name = extracted_data.get("customer_name") or extracted_data.get("client_name")
            if not customer_name:
                issues.append(
                    ValidationIssue(
                        field_name="customer_id",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing customer identification for Credit Note.",
                        severity="CRITICAL",
                    )
                )
            raw_items = extracted_data.get("items") or extracted_data.get("line_items") or []
            if not raw_items:
                issues.append(
                    ValidationIssue(
                        field_name="line_items",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Credit Note requires itemized adjustment lines.",
                        severity="CRITICAL",
                    )
                )

        # === AP: VENDOR BILL ===
        elif entity_type == AccountingEntityType.AP_VENDOR_BILL.value:
            vendor_name = extracted_data.get("vendor_name") or extracted_data.get("supplier_name")
            bill_number = extracted_data.get("bill_number") or extracted_data.get("invoice_number")

            if not vendor_name:
                issues.append(
                    ValidationIssue(
                        field_name="vendor_id",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing Vendor / Supplier Name for Vendor Bill.",
                        severity="CRITICAL",
                    )
                )

            if not bill_number:
                issues.append(
                    ValidationIssue(
                        field_name="bill_number",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing Vendor Bill/Invoice Number required by Zoho Books.",
                        severity="CRITICAL",
                    )
                )

            raw_items = extracted_data.get("items") or extracted_data.get("line_items") or []
            if not raw_items:
                # If no itemized lines, verify at least total_amount > 0
                tot = float(extracted_data.get("total_amount") or 0.0)
                if tot <= 0:
                    issues.append(
                        ValidationIssue(
                            field_name="line_items",
                            error_type="MISSING_MANDATORY_FIELD",
                            message="Vendor bill must contain line items or a positive total amount.",
                            severity="CRITICAL",
                        )
                    )
            else:
                cls._validate_line_items_math(raw_items, extracted_data.get("total_amount"), variance_tolerance, issues)

        # === AP: VENDOR PAYMENT ===
        elif entity_type == AccountingEntityType.AP_VENDOR_PAYMENT.value:
            vendor_name = extracted_data.get("vendor_name") or extracted_data.get("payee")
            amount = float(extracted_data.get("amount") or extracted_data.get("total_amount") or 0.0)

            if not vendor_name:
                issues.append(
                    ValidationIssue(
                        field_name="vendor_id",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Missing Vendor Name for Vendor Payment.",
                        severity="CRITICAL",
                    )
                )
            if amount <= 0:
                issues.append(
                    ValidationIssue(
                        field_name="amount",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Vendor payment amount must be positive.",
                        received_value=amount,
                        severity="CRITICAL",
                    )
                )

        # === AP: DIRECT EXPENSE ===
        elif entity_type == AccountingEntityType.AP_DIRECT_EXPENSE.value:
            amount = float(extracted_data.get("amount") or extracted_data.get("total_amount") or 0.0)
            if amount <= 0:
                issues.append(
                    ValidationIssue(
                        field_name="amount",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Expense amount must be positive.",
                        received_value=amount,
                        severity="CRITICAL",
                    )
                )

        # === BANK: BANK STATEMENT / MOMO STATEMENT ===
        elif entity_type in [AccountingEntityType.BANK_STATEMENT.value, AccountingEntityType.MOMO_STATEMENT.value]:
            transactions = extracted_data.get("transactions") or []
            if not transactions:
                issues.append(
                    ValidationIssue(
                        field_name="transactions",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="No transaction lines extracted from statement document.",
                        severity="CRITICAL",
                    )
                )
            else:
                for idx, tx in enumerate(transactions):
                    tx_amt = float(tx.get("amount", 0.0))
                    tx_desc = tx.get("description", "")
                    if tx_amt <= 0:
                        issues.append(
                            ValidationIssue(
                                field_name=f"transactions[{idx}].amount",
                                error_type="MATH_MISMATCH",
                                message=f"Transaction row {idx+1} has invalid amount {tx_amt}.",
                                severity="CRITICAL",
                            )
                        )
                    if not tx_desc:
                        issues.append(
                            ValidationIssue(
                                field_name=f"transactions[{idx}].description",
                                error_type="MISSING_MANDATORY_FIELD",
                                message=f"Transaction row {idx+1} missing description/narrative.",
                                severity="WARNING",
                            )
                        )

        # === GL: MANUAL JOURNAL ===
        elif entity_type == AccountingEntityType.GL_JOURNAL.value:
            entries = extracted_data.get("journal_entries") or extracted_data.get("entries") or []
            if len(entries) < 2:
                issues.append(
                    ValidationIssue(
                        field_name="journal_entries",
                        error_type="MISSING_MANDATORY_FIELD",
                        message="Manual Journal must have at least 2 entries (Debit and Credit).",
                        severity="CRITICAL",
                    )
                )
            else:
                total_debits = sum(float(e.get("amount", 0.0)) for e in entries if e.get("debit_or_credit") == "debit")
                total_credits = sum(float(e.get("amount", 0.0)) for e in entries if e.get("debit_or_credit") == "credit")
                if abs(total_debits - total_credits) > 0.01:
                    issues.append(
                        ValidationIssue(
                            field_name="journal_entries",
                            error_type="MATH_MISMATCH",
                            message=f"Journal does not balance! Total Debits ({total_debits:.2f}) != Total Credits ({total_credits:.2f}).",
                            severity="CRITICAL",
                        )
                    )

        # Determine overall validity
        has_critical = any(issue.severity == "CRITICAL" for issue in issues)
        is_valid = not has_critical

        if not is_valid:
            logger.warning(
                f"Validation failed for entity '{entity_type}': {len(issues)} issues detected."
            )

        return ContractValidationResult(
            is_valid=is_valid,
            target_entity=entity_type,
            issues=issues,
            normalized_payload=norm,
        )

    @classmethod
    def _validate_line_items_math(
        cls,
        line_items: List[Dict[str, Any]],
        total_amount: Optional[Any],
        tolerance: float,
        issues: List[ValidationIssue],
    ) -> None:
        """Verifies sum of item rates * quantities against declared document total."""
        calculated_sum = 0.0
        for it in line_items:
            qty = float(it.get("quantity") or it.get("pickup_qty") or it.get("delivery_qty") or 1.0)
            rate = float(it.get("rate") or it.get("unit_rate") or it.get("unit_price") or 0.0)
            line_tot = float(it.get("amount") or it.get("line_total") or (qty * rate))
            calculated_sum += line_tot

        if total_amount is not None:
            try:
                doc_tot = float(total_amount)
                if doc_tot > 0 and abs(calculated_sum - doc_tot) > tolerance:
                    issues.append(
                        ValidationIssue(
                            field_name="total_amount",
                            error_type="MATH_MISMATCH",
                            message=f"Line items calculation ({calculated_sum:.2f}) differs from stated document total ({doc_tot:.2f}) by more than tolerance ({tolerance:.2f}).",
                            received_value=doc_tot,
                            severity="CRITICAL",
                        )
                    )
            except (ValueError, TypeError):
                pass

    @classmethod
    def _match_contact(cls, name_str: str, contacts: List[ZohoContact]) -> Optional[ZohoContact]:
        """Matches a client or vendor name against the Zoho Contacts list."""
        cleaned = name_str.strip().lower()
        # Exact match
        for c in contacts:
            if c.contact_name.strip().lower() == cleaned:
                return c
            if c.company_name and c.company_name.strip().lower() == cleaned:
                return c

        # Substring match
        for c in contacts:
            if cleaned in c.contact_name.strip().lower() or (c.company_name and cleaned in c.company_name.strip().lower()):
                return c
            if c.contact_name.strip().lower() in cleaned:
                return c

        return None

    @classmethod
    def _try_parse_date(cls, val: str) -> Optional[str]:
        """Tries to parse date strings and returns standard YYYY-MM-DD."""
        formats = [
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%m/%d/%Y",
            "%Y/%m/%d",
            "%d %B %Y",
            "%d %b %Y",
        ]
        val_cleaned = val.strip()
        for fmt in formats:
            try:
                dt = datetime.strptime(val_cleaned, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None
