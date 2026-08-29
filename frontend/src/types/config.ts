export interface SystemConfig {
  INNGEST_APP_ID?: string;
  INNGEST_DEV_SERVER_URL?: string;
  GEMINI_MODEL?: string;
  ZOHO_CLIENT_ID?: string;
  ZOHO_ORG_ID?: string;
  ZOHO_ACCOUNTS_URL?: string;
  ZOHO_BOOKS_API_URL?: string;
  CONTROL_SHEETS_FOLDER_ID?: string;
  NOTIFICATION_EMAIL?: string;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  MOCK_MODE?: boolean;
  AUTH_EMAIL?: string;
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
  all_healthy: boolean;
}

export interface LogEntry {
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
