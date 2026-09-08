/**
 * Error reporting and diagnostic types for S4 Automations Frontend.
 */

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

export type ErrorCategory =
  | 'api'
  | 'pipeline'
  | 'react'
  | 'auth'
  | 'network'
  | 'validation'
  | 'backend';

export interface AppError {
  id: string;
  timestamp: string;
  timeDisplay: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  title: string;
  message: string;
  status?: number;
  endpoint?: string;
  method?: string;
  requestPayload?: any;
  responseData?: any;
  traceback?: string;
  componentStack?: string;
  troubleshootingHint?: string;
  read: boolean;
}

export interface NetworkRequestRecord {
  id: string;
  timestamp: string;
  timeDisplay: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  requestBody?: any;
  responseBody?: any;
  isError: boolean;
  errorMsg?: string;
}

export interface ToastNotification {
  id: string;
  severity: ErrorSeverity | 'success';
  title: string;
  message: string;
  errorRef?: AppError;
  durationMs?: number;
}

export interface ServerLogRecord {
  id: string;
  timestamp: string;
  time_display: string;
  level: string;
  logger: string;
  message: string;
  formatted: string;
  traceback?: string | null;
  path?: string;
  func?: string;
}

export interface SystemDebugDump {
  timestamp: string;
  service: string;
  environment: string;
  mock_mode: boolean;
  gemini_model: string;
  database: {
    status: string;
    clients_count: number;
    staged_transactions_count: number;
    bank_transactions_count: number;
  };
  pipeline: {
    is_running: boolean;
    status: string;
    current_step: string;
    error_message?: string | null;
    percent: number;
  };
  config_summary: Record<string, any>;
  recent_errors: ServerLogRecord[];
}
