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

    # Authentication & Email OTP
    AUTH_EMAIL: str = Field(default="s4bookkeeping@service4gh.com", description="Admin login email for S4 Automations")
    AUTH_SECRET_KEY: str = Field(default="s4-bookkeeping-otp-secret-key-2026", description="Secret key for signing auth tokens")
    SMTP_HOST: Optional[str] = Field(default=None, description="SMTP Server Host (e.g. smtp.zoho.com or smtp.gmail.com)")
    SMTP_PORT: int = Field(default=587, description="SMTP Server Port")
    SMTP_USER: Optional[str] = Field(default=None, description="SMTP Username")
    SMTP_PASSWORD: Optional[str] = Field(default=None, description="SMTP Password")
    SMTP_FROM: str = Field(default="s4bookkeeping@service4gh.com", description="Sender Email Address for OTPs")

    # Database Configuration (PostgreSQL / SQLModel)
    DATABASE_URL: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/s4_automations",
        description="PostgreSQL or SQLite database connection URL",
    )

    # System & Notification
    NOTIFICATION_EMAIL: str = Field(default="cdanso@service4gh.com", description="Notification email address")
    PORT: int = Field(default=8000, description="Server port")
    ENVIRONMENT: str = Field(default="development", description="Environment: development, staging, production")
    LOG_LEVEL: str = Field(default="INFO", description="Logging level")
    
    # Mock / Dry-Run Mode
    MOCK_MODE: bool = Field(default=False, description="Enable mock mode for testing without real credentials")

    def get_masked_dict(self) -> dict:
        """Returns configuration dictionary with secrets masked for safe frontend display."""
        def mask(val: str) -> str:
            if not val:
                return ""
            if len(val) <= 6:
                return "******"
            return val[:3] + "******" + val[-3:]

        return {
            "INNGEST_EVENT_KEY": mask(self.INNGEST_EVENT_KEY),
            "INNGEST_SIGNING_KEY": mask(self.INNGEST_SIGNING_KEY),
            "INNGEST_APP_ID": self.INNGEST_APP_ID,
            "INNGEST_DEV_SERVER_URL": self.INNGEST_DEV_SERVER_URL or "",
            "GEMINI_API_KEY": mask(self.GEMINI_API_KEY),
            "GEMINI_MODEL": self.GEMINI_MODEL,
            "ZOHO_CLIENT_ID": self.ZOHO_CLIENT_ID,
            "ZOHO_CLIENT_SECRET": mask(self.ZOHO_CLIENT_SECRET),
            "ZOHO_REFRESH_TOKEN": mask(self.ZOHO_REFRESH_TOKEN),
            "ZOHO_ORG_ID": self.ZOHO_ORG_ID,
            "ZOHO_ACCOUNTS_URL": self.ZOHO_ACCOUNTS_URL,
            "ZOHO_BOOKS_API_URL": self.ZOHO_BOOKS_API_URL,
            "CONTROL_SHEETS_FOLDER_ID": self.CONTROL_SHEETS_FOLDER_ID,
            "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64": mask(self.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or ""),
            "GOOGLE_SERVICE_ACCOUNT_FILE": self.GOOGLE_SERVICE_ACCOUNT_FILE or "",
            "NOTIFICATION_EMAIL": self.NOTIFICATION_EMAIL,
            "PORT": self.PORT,
            "ENVIRONMENT": self.ENVIRONMENT,
            "LOG_LEVEL": self.LOG_LEVEL,
            "MOCK_MODE": self.MOCK_MODE,
        }

    def update_values(self, new_values: dict):
        """Updates runtime settings with non-masked incoming values."""
        for key, val in new_values.items():
            if hasattr(self, key) and val is not None:
                # Do not overwrite with masked placeholder values
                if isinstance(val, str) and "******" in val:
                    continue
                setattr(self, key, val)

    def save_to_env_file(self, env_path: str = ".env"):
        """Persists current settings to the .env file."""
        lines = [
            f"INNGEST_EVENT_KEY={self.INNGEST_EVENT_KEY}",
            f"INNGEST_SIGNING_KEY={self.INNGEST_SIGNING_KEY}",
            f"INNGEST_APP_ID={self.INNGEST_APP_ID}",
            f"INNGEST_DEV_SERVER_URL={self.INNGEST_DEV_SERVER_URL or ''}",
            "",
            f"GEMINI_API_KEY={self.GEMINI_API_KEY}",
            f"GEMINI_MODEL={self.GEMINI_MODEL}",
            "",
            f"ZOHO_CLIENT_ID={self.ZOHO_CLIENT_ID}",
            f"ZOHO_CLIENT_SECRET={self.ZOHO_CLIENT_SECRET}",
            f"ZOHO_REFRESH_TOKEN={self.ZOHO_REFRESH_TOKEN}",
            f"ZOHO_ORG_ID={self.ZOHO_ORG_ID}",
            f"ZOHO_ACCOUNTS_URL={self.ZOHO_ACCOUNTS_URL}",
            f"ZOHO_BOOKS_API_URL={self.ZOHO_BOOKS_API_URL}",
            "",
            f"CONTROL_SHEETS_FOLDER_ID={self.CONTROL_SHEETS_FOLDER_ID}",
            f"GOOGLE_SERVICE_ACCOUNT_JSON_BASE64={self.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or ''}",
            f"GOOGLE_SERVICE_ACCOUNT_FILE={self.GOOGLE_SERVICE_ACCOUNT_FILE or ''}",
            "",
            f"NOTIFICATION_EMAIL={self.NOTIFICATION_EMAIL}",
            f"PORT={self.PORT}",
            f"ENVIRONMENT={self.ENVIRONMENT}",
            f"LOG_LEVEL={self.LOG_LEVEL}",
            f"MOCK_MODE={'true' if self.MOCK_MODE else 'false'}",
        ]
        with open(env_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


settings = Settings()
