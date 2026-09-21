"""Date parsing and normalization utilities for filenames and OCR extractions."""

import re
from typing import Optional, Any
from datetime import datetime

MONTH_MAP = {
    "january": 1, "jan": 1, "01": 1, "1": 1,
    "february": 2, "feb": 2, "02": 2, "2": 2,
    "march": 3, "mar": 3, "03": 3, "3": 3,
    "april": 4, "apr": 4, "04": 4, "4": 4,
    "may": 5, "05": 5, "5": 5,
    "june": 6, "jun": 6, "06": 6, "6": 6,
    "july": 7, "jul": 7, "07": 7, "7": 7,
    "august": 8, "aug": 8, "08": 8, "8": 8,
    "september": 9, "sep": 9, "sept": 9, "09": 9, "9": 9,
    "october": 10, "oct": 10, "10": 10,
    "november": 11, "nov": 11, "11": 11,
    "december": 12, "dec": 12, "12": 12,
}


def resolve_transaction_date(
    extracted_date: Optional[str] = None,
    file_name: Optional[str] = None,
    target_month: Optional[str] = None,
    target_year: Optional[Any] = None,
    **kwargs,
) -> str:
    """
    Robustly resolves transaction date in standard ISO YYYY-MM-DD format:
    1. Checks file_name / source_filename for explicit date patterns (e.g. 'Embassy Gardens 03-09-2026', '03_09_2026', '2026-09-03')
    2. Checks extracted_date / ocr_date / slip_date
    3. Falls back to normalized target_year-target_month-01 (e.g. 2026-09-01, NEVER 2026-September-01)
    """
    # Resolve aliases
    fn = file_name or kwargs.get("source_filename") or kwargs.get("source_file_name")
    ext_date = extracted_date or kwargs.get("ocr_date") or kwargs.get("slip_date")
    t_month = target_month or kwargs.get("fallback_month")
    raw_yr = target_year if target_year is not None else kwargs.get("fallback_year")
    try:
        t_year = int(raw_yr) if raw_yr else None
    except (ValueError, TypeError):
        t_year = None

    # 1. Try parsing from file_name first if filename has explicit date pattern
    if fn:
        fn_date = parse_date_from_string(fn, target_year=t_year)
        if fn_date:
            return fn_date

    # 2. Try parsing from extracted_date
    if ext_date:
        parsed = parse_date_from_string(str(ext_date), target_year=t_year)
        if parsed:
            return parsed

    # 3. Fallback: normalize target_year and target_month
    yr = t_year or datetime.now().year
    m_num = 1
    if t_month:
        m_clean = str(t_month).lower().strip()
        m_num = MONTH_MAP.get(m_clean, 1)

    return f"{yr:04d}-{m_num:02d}-01"


def parse_date_from_string(text: str, target_year: Optional[int] = None) -> Optional[str]:
    """Extracts and normalizes a date from arbitrary text or filename into YYYY-MM-DD."""
    if not text:
        return None

    clean_text = str(text).strip()

    # Pattern 1: DD-MM-YYYY or DD_MM_YYYY or DD/MM/YYYY or DD.MM.YYYY
    # e.g. "Embassy Gardens 03-09-2026" or "03/09/2026"
    m1 = re.search(r"\b(\d{1,2})[-_/\.](\d{1,2})[-_/\.](\d{4})\b", clean_text)
    if m1:
        d1, d2, y = int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
        # Determine day vs month (Ghana & UK convention: DD/MM/YYYY)
        if 1 <= d2 <= 12 and 1 <= d1 <= 31:
            day, month = d1, d2
        elif 1 <= d1 <= 12 and 1 <= d2 <= 31:
            day, month = d2, d1
        else:
            day, month = min(d1, 31), min(d2, 12)
        return f"{y:04d}-{month:02d}-{day:02d}"

    # Pattern 2: YYYY-MM-DD or YYYY_MM_DD or YYYY/MM/DD
    m2 = re.search(r"\b(\d{4})[-_/\.](\d{1,2})[-_/\.](\d{1,2})\b", clean_text)
    if m2:
        y, month, day = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{y:04d}-{month:02d}-{day:02d}"

    # Pattern 3: DD-MM-YY or DD_MM_YY
    m3 = re.search(r"\b(\d{1,2})[-_/\.](\d{1,2})[-_/\.](\d{2})\b", clean_text)
    if m3:
        d1, d2, short_y = int(m3.group(1)), int(m3.group(2)), int(m3.group(3))
        y = 2000 + short_y if short_y < 70 else 1900 + short_y
        if 1 <= d2 <= 12 and 1 <= d1 <= 31:
            day, month = d1, d2
        elif 1 <= d1 <= 12 and 1 <= d2 <= 31:
            day, month = d2, d1
        else:
            day, month = min(d1, 31), min(d2, 12)
        return f"{y:04d}-{month:02d}-{day:02d}"

    # Pattern 4: DD MonthName YYYY (e.g. "03 September 2026", "3rd Sept 2026", "3_Sep_2026")
    m4 = re.search(
        r"\b(\d{1,2})(?:st|nd|rd|th)?\s*[-_ ]*\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*[-_ ]*\s*(\d{2,4})?\b",
        clean_text,
        re.IGNORECASE,
    )
    if m4:
        day = int(m4.group(1))
        month_str = m4.group(2).lower()
        month = MONTH_MAP.get(month_str, 1)
        raw_yr = m4.group(3)
        if raw_yr:
            yr = int(raw_yr)
            if yr < 100:
                yr += 2000
        else:
            yr = target_year or datetime.now().year
        return f"{yr:04d}-{month:02d}-{day:02d}"

    return None
