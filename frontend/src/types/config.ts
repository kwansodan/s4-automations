export interface SystemConfig {
  INNGEST_APP_ID?: string;
  INNGEST_DEV_SERVER_URL?: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_SIGNING_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ZOHO_CLIENT_ID?: string;
  ZOHO_ORG_ID?: string;
  ZOHO_ACCOUNTS_URL?: string;
  ZOHO_BOOKS_API_URL?: string;
  CONTROL_SHEETS_FOLDER_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_FILE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?: string;
  NOTIFICATION_EMAIL?: string;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  MOCK_MODE?: boolean;
  AUTH_EMAIL?: string;
  MAILJET_API_KEY?: string;
  MAILJET_SECRET_KEY?: string;
  MAILJET_FROM_EMAIL?: string;
  MAILJET_FROM_NAME?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  DATABASE_URL?: string;
  PORT?: number;
  [key: string]: any;
}

export interface DiagnosticsResult {
  gemini_status: string;
  gemini_message: string;
  zoho_status: string;
  zoho_message: string;
  google_status: string;
  google_message: string;
  inngest_status: string;
  inngest_message: string;
  database_status?: string;
  database_message?: string;
  all_healthy: boolean;
}

export interface LogEntry {
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
