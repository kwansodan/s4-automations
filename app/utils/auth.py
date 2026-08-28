"""Authentication helper for Google Workspace APIs (Drive & Sheets)."""

import base64
import json
import os
from typing import Optional, Any
from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger("auth")

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


def get_google_credentials() -> Optional[service_account.Credentials]:
    """
    Loads Google Service Account credentials from base64 string, file path,
    or returns None in mock mode.
    """
    if settings.MOCK_MODE:
        logger.info("Running in MOCK_MODE: Skipping real Google credentials loading.")
        return None

    # 1. Base64 environment variable
    if settings.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64:
        try:
            decoded = base64.b64decode(settings.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64).decode("utf-8")
            service_account_info = json.loads(decoded)
            creds = service_account.Credentials.from_service_account_info(
                service_account_info, scopes=GOOGLE_SCOPES
            )
            logger.info("Successfully loaded Google Service Account credentials from Base64 string.")
            return creds
        except Exception as e:
            logger.error(f"Failed to decode GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: {e}")
            raise

    # 2. File path
    if settings.GOOGLE_SERVICE_ACCOUNT_FILE and os.path.exists(settings.GOOGLE_SERVICE_ACCOUNT_FILE):
        try:
            creds = service_account.Credentials.from_service_account_file(
                settings.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=GOOGLE_SCOPES
            )
            logger.info(f"Successfully loaded Google credentials from file: {settings.GOOGLE_SERVICE_ACCOUNT_FILE}")
            return creds
        except Exception as e:
            logger.error(f"Failed to load credentials from file {settings.GOOGLE_SERVICE_ACCOUNT_FILE}: {e}")
            raise

    # 3. Check for standard GOOGLE_APPLICATION_CREDENTIALS
    adc_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if adc_path and os.path.exists(adc_path):
        try:
            creds = service_account.Credentials.from_service_account_file(
                adc_path, scopes=GOOGLE_SCOPES
            )
            logger.info(f"Loaded credentials from GOOGLE_APPLICATION_CREDENTIALS: {adc_path}")
            return creds
        except Exception as e:
            logger.error(f"Failed to load GOOGLE_APPLICATION_CREDENTIALS: {e}")

    logger.warning("No Google Service Account credentials found. Service will operate in Mock or Degraded mode.")
    return None


def get_google_drive_service(credentials: Optional[service_account.Credentials] = None) -> Any:
    """Builds and returns the Google Drive v3 client."""
    creds = credentials or get_google_credentials()
    if creds is None:
        return None
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def get_google_sheets_service(credentials: Optional[service_account.Credentials] = None) -> Any:
    """Builds and returns the Google Sheets v4 client."""
    creds = credentials or get_google_credentials()
    if creds is None:
        return None
    return build("sheets", "v4", credentials=creds, cache_discovery=False)
