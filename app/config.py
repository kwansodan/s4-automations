"""Application configuration using Pydantic Settings."""

import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Inngest Configuration
    INNGEST_EVENT_KEY: str = Field(default="dev-event-key", description="Inngest Event Key")
    INNGEST_SIGNING_KEY: str = Field(default="dev-signing-key", description="Inngest Signing Key")
    INNGEST_APP_ID: str = Field(default="anr-laundry-billing", description="Inngest App Identifier")
    INNGEST_DEV_SERVER_URL: Optional[str] = Field(default=None, description="Optional Inngest Dev Server URL")

    # Google Gemini Vision OCR
    GEMINI_API_KEY: str = Field(default="", description="Google Gemini Developer API Key")
    GEMINI_MODEL: str = Field(default="gemini-3.6-flash", description="Gemini model identifier (e.g. gemini-3.6-flash, gemini-2.5-flash)")

    # Zoho Books API Credentials
    ZOHO_CLIENT_ID: str = Field(default="", description="Zoho OAuth2 Client ID")
    ZOHO_CLIENT_SECRET: str = Field(default="", description="Zoho OAuth2 Client Secret")
    ZOHO_REFRESH_TOKEN: str = Field(default="", description="Zoho OAuth2 Refresh Token")
    ZOHO_ORG_ID: str = Field(default="", description="Zoho Organization ID")
    ZOHO_ACCOUNTS_URL: str = Field(default="https://accounts.zoho.com", description="Zoho Accounts Auth Base URL")
    ZOHO_BOOKS_API_URL: str = Field(default="https://www.zohoapis.com/books/v3", description="Zoho Books API Base URL")

    # Google Workspace (Drive & Sheets)
    CONTROL_SHEETS_FOLDER_ID: str = Field(default="", description="Google Drive root folder ID for control sheets")
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Optional[str] = Field(default=None, description="Base64-encoded Service Account JSON")
    GOOGLE_SERVICE_ACCOUNT_FILE: Optional[str] = Field(default=None, description="Path to Service Account JSON key file")

    # System & Notification
    NOTIFICATION_EMAIL: str = Field(default="cdanso@service4gh.com", description="Notification email address")
    PORT: int = Field(default=8000, description="Server port")
    ENVIRONMENT: str = Field(default="development", description="Environment: development, staging, production")
    LOG_LEVEL: str = Field(default="INFO", description="Logging level")
    
    # Mock / Dry-Run Mode
    MOCK_MODE: bool = Field(default=False, description="Enable mock mode for testing without real credentials")


settings = Settings()
