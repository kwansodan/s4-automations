import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  AppError,
  ErrorSeverity,
  ErrorCategory,
  NetworkRequestRecord,
  ToastNotification,
} from '../types/errors';
import { fetchServerErrorsApi } from '../lib/api';

interface ErrorContextType {
  errors: AppError[];
  networkLogs: NetworkRequestRecord[];
  toasts: ToastNotification[];
  unreadErrorsCount: number;
  isDebugDrawerOpen: boolean;
  debugDrawerTab: 'errors' | 'network' | 'logs' | 'health';
  selectedError: AppError | null;

  reportError: (err: {
    id?: string;
    severity?: ErrorSeverity;
    category?: ErrorCategory;
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
    showToast?: boolean;
  }) => AppError;

  reportNetworkRequest: (record: NetworkRequestRecord) => void;
  clearErrors: () => void;
  clearNetworkLogs: () => void;
  markErrorsAsRead: () => void;
  openDebugDrawer: (tab?: 'errors' | 'network' | 'logs' | 'health', error?: AppError) => void;
  closeDebugDrawer: () => void;
  dismissToast: (id: string) => void;
  generateDiagnosticReport: () => string;
  syncServerIssuesNow: () => Promise<void>;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

const MAX_ERRORS = 100;
const MAX_NETWORK_LOGS = 100;

export const ErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [networkLogs, setNetworkLogs] = useState<NetworkRequestRecord[]>([]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [unreadErrorsCount, setUnreadErrorsCount] = useState(0);
  const [isDebugDrawerOpen, setIsDebugDrawerOpen] = useState(false);
  const [debugDrawerTab, setDebugDrawerTab] = useState<'errors' | 'network' | 'logs' | 'health'>('errors');
  const [selectedError, setSelectedError] = useState<AppError | null>(null);

  // Dismiss a toast
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Main error reporting function
  const reportError = useCallback(
    ({
      id,
      severity = 'error',
      category = 'api',
      title,
      message,
      status,
      endpoint,
      method,
      requestPayload,
      responseData,
      traceback,
      componentStack,
      troubleshootingHint,
      showToast = true,
    }: {
      id?: string;
      severity?: ErrorSeverity;
      category?: ErrorCategory;
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
      showToast?: boolean;
    }): AppError => {
      const now = new Date();
      const newErrorId = id || `err_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const newError: AppError = {
        id: newErrorId,
        timestamp: now.toISOString(),
        timeDisplay: now.toLocaleTimeString(),
        severity,
        category,
        title,
        message,
        status,
        endpoint,
        method,
        requestPayload,
        responseData,
        traceback,
        componentStack,
        troubleshootingHint,
        read: false,
      };

      // Deduplicate recurring polling errors to prevent 100+ identical errors from flooding the drawer
      const isPollingEndpoint =
        endpoint?.includes('/progress') || endpoint?.includes('/status') || endpoint?.includes('/logs');

      setErrors((prev) => {
        if (prev.some((e) => e.id === newErrorId)) {
          return prev;
        }

        if (isPollingEndpoint) {
          const existingIdx = prev.findIndex(
            (e) => e.endpoint === endpoint && e.status === status
          );
          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = {
              ...updated[existingIdx],
              timestamp: now.toISOString(),
              timeDisplay: now.toLocaleTimeString(),
              message,
            };
            return updated;
          }
        }
        return [newError, ...prev.slice(0, MAX_ERRORS - 1)];
      });

      setUnreadErrorsCount((prev) => {
        if (isPollingEndpoint) return Math.min(prev, 5);
        return prev + 1;
      });

      if (showToast) {
        const toastId = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const newToast: ToastNotification = {
          id: toastId,
          severity,
          title,
          message,
          errorRef: newError,
          durationMs: severity === 'critical' ? undefined : 7000,
        };
        setToasts((prev) => {
          // Avoid duplicate toast with identical title and message
          if (prev.some((t) => t.title === title && t.message === message)) {
            return prev;
          }
          return [newToast, ...prev.slice(0, 4)];
        });

        if (severity !== 'critical') {
          setTimeout(() => {
            dismissToast(toastId);
          }, 7000);
        }
      }

      return newError;
    },
    [dismissToast]
  );

  // Record a network request
  const reportNetworkRequest = useCallback((record: NetworkRequestRecord) => {
    setNetworkLogs((prev) => [record, ...prev.slice(0, MAX_NETWORK_LOGS - 1)]);
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setUnreadErrorsCount(0);
    setSelectedError(null);
  }, []);

  const clearNetworkLogs = useCallback(() => {
    setNetworkLogs([]);
  }, []);

  const markErrorsAsRead = useCallback(() => {
    setUnreadErrorsCount(0);
    setErrors((prev) => prev.map((e) => ({ ...e, read: true })));
  }, []);

  const openDebugDrawer = useCallback(
    (tab: 'errors' | 'network' | 'logs' | 'health' = 'errors', error?: AppError) => {
      setDebugDrawerTab(tab);
      if (error) {
        setSelectedError(error);
      }
      setIsDebugDrawerOpen(true);
      markErrorsAsRead();
    },
    [markErrorsAsRead]
  );

  const closeDebugDrawer = useCallback(() => {
    setIsDebugDrawerOpen(false);
  }, []);

  // Global listeners for unhandled exceptions and promise rejections
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      reportError({
        severity: 'critical',
        category: 'react',
        title: 'Uncaught JavaScript Error',
        message: event.message || 'An unexpected browser error occurred.',
        traceback: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
        troubleshootingHint: 'Check the browser console stack trace. A component or library threw an unhandled exception.',
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === 'object' && reason?.message ? reason.message : String(reason);
      const stack = typeof reason === 'object' && reason?.stack ? reason.stack : undefined;

      reportError({
        severity: 'error',
        category: 'api',
        title: 'Unhandled Promise Rejection',
        message: message || 'An asynchronous operation failed without a catch handler.',
        traceback: stack,
        troubleshootingHint: 'An API call or async function was rejected. Ensure all promises include catch handlers.',
      });
    };

    // Hotkey listener: Ctrl+Shift+D or Ctrl+Shift+E toggles Debug Drawer
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'E')) {
        e.preventDefault();
        setIsDebugDrawerOpen((prev) => {
          if (!prev) markErrorsAsRead();
          return !prev;
        });
      }
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [reportError, markErrorsAsRead]);

  const lastSeqRef = useRef<number>(0);

  // Sync backend server errors and warnings continuously into ErrorContext
  const syncServerIssues = useCallback(
    async (isInitial = false) => {
      try {
        const sinceSeq = isInitial ? 0 : lastSeqRef.current;
        const res = await fetchServerErrorsApi(25, sinceSeq, true);
        if (res && res.status === 'success' && Array.isArray(res.errors)) {
          if (res.errors.length > 0) {
            let maxSeq = lastSeqRef.current;
            // The backend returns latest first; reverse so they are processed chronologically
            const chronological = [...res.errors].reverse();

            for (const rec of chronological) {
              if (rec.seq && rec.seq > maxSeq) {
                maxSeq = rec.seq;
              }

              const recSeverity: ErrorSeverity =
                rec.level === 'CRITICAL' ? 'critical' : rec.level === 'WARNING' ? 'warning' : 'error';

              let hint: string | undefined = undefined;
              const msgLower = (rec.message || '').toLowerCase();
              if (msgLower.includes('404') || msgLower.includes('not found')) {
                hint = 'The target Google Drive folder or resource was not found. Please verify the folder ID and permissions.';
              } else if (msgLower.includes('403') || msgLower.includes('permission')) {
                hint = 'Google Drive access denied. Ensure the folder is shared with the service account email.';
              } else if (msgLower.includes('contract') || msgLower.includes('zoho')) {
                hint = 'Zoho Books contract schema validation error. Check customer name and tax rate configuration.';
              }

              // Show toast for newly arrived errors/warnings when polling (not on initial bulk load)
              const shouldToast = !isInitial && recSeverity !== 'warning';

              reportError({
                id: rec.id ? `server_${rec.id}` : undefined,
                severity: recSeverity,
                category: 'backend',
                title: `[Server ${rec.level}] ${rec.logger}`,
                message: rec.message,
                traceback: rec.traceback || undefined,
                troubleshootingHint: hint,
                showToast: shouldToast,
              });
            }

            if (res.latest_seq && res.latest_seq > maxSeq) {
              maxSeq = res.latest_seq;
            }
            lastSeqRef.current = Math.max(lastSeqRef.current, maxSeq);
          } else if (res.latest_seq && res.latest_seq > lastSeqRef.current) {
            lastSeqRef.current = res.latest_seq;
          }
        }
      } catch (err) {
        // Backend temporarily unreachable or offline; avoid cascading alerts
      }
    },
    [reportError]
  );

  const syncServerIssuesNow = useCallback(async () => {
    await syncServerIssues(false);
  }, [syncServerIssues]);

  // Periodic polling for backend server issues and unhandled exceptions
  useEffect(() => {
    syncServerIssues(true);

    const interval = setInterval(() => {
      syncServerIssues(false);
    }, 6000);

    return () => clearInterval(interval);
  }, [syncServerIssues]);

  // Expose global reporting function on window for non-React code (e.g. state.js)
  useEffect(() => {
    (window as any).__S4_REPORT_ERROR__ = reportError;
    (window as any).__S4_REPORT_NETWORK__ = reportNetworkRequest;
    (window as any).__S4_SYNC_SERVER_ISSUES__ = syncServerIssuesNow;
    return () => {
      delete (window as any).__S4_REPORT_ERROR__;
      delete (window as any).__S4_REPORT_NETWORK__;
      delete (window as any).__S4_SYNC_SERVER_ISSUES__;
    };
  }, [reportError, reportNetworkRequest, syncServerIssuesNow]);

  // Generates a copyable Markdown diagnostic report
  const generateDiagnosticReport = useCallback((): string => {
    const lines: string[] = [];
    lines.push('# S4 Automations System Diagnostic Report');
    lines.push(`**Generated at:** ${new Date().toISOString()}`);
    lines.push(`**User Agent:** ${navigator.userAgent}`);
    lines.push(`**URL:** ${window.location.href}`);
    lines.push(`**Active Errors:** ${errors.length}`);
    lines.push('');

    lines.push('## Active Errors');
    if (errors.length === 0) {
      lines.push('No errors currently logged.');
    } else {
      errors.slice(0, 15).forEach((err, idx) => {
        lines.push(`### ${idx + 1}. [${err.severity.toUpperCase()}] ${err.title}`);
        lines.push(`- **Time:** ${err.timeDisplay} (${err.timestamp})`);
        lines.push(`- **Category:** ${err.category}`);
        if (err.status) lines.push(`- **HTTP Status:** ${err.status}`);
        if (err.endpoint) lines.push(`- **Endpoint:** \`${err.method || 'GET'} ${err.endpoint}\``);
        lines.push(`- **Message:** ${err.message}`);
        if (err.troubleshootingHint) lines.push(`- **Hint:** ${err.troubleshootingHint}`);
        if (err.traceback) {
          lines.push('```');
          lines.push(err.traceback.trim());
          lines.push('```');
        }
        if (err.requestPayload) {
          lines.push('**Request Payload:**');
          lines.push('```json');
          lines.push(JSON.stringify(err.requestPayload, null, 2));
          lines.push('```');
        }
        if (err.responseData) {
          lines.push('**Response Data:**');
          lines.push('```json');
          lines.push(JSON.stringify(err.responseData, null, 2));
          lines.push('```');
        }
        lines.push('---');
      });
    }

    lines.push('');
    lines.push('## Recent Network Requests (Last 10)');
    if (networkLogs.length === 0) {
      lines.push('No network activity recorded.');
    } else {
      networkLogs.slice(0, 10).forEach((n) => {
        const icon = n.isError ? '❌' : '✅';
        lines.push(`- ${icon} **${n.method}** \`${n.url}\` → \`${n.status} ${n.statusText}\` (${n.durationMs}ms) [${n.timeDisplay}]`);
      });
    }

    return lines.join('\n');
  }, [errors, networkLogs]);

  const value = useMemo(
    () => ({
      errors,
      networkLogs,
      toasts,
      unreadErrorsCount,
      isDebugDrawerOpen,
      debugDrawerTab,
      selectedError,
      reportError,
      reportNetworkRequest,
      clearErrors,
      clearNetworkLogs,
      markErrorsAsRead,
      openDebugDrawer,
      closeDebugDrawer,
      dismissToast,
      generateDiagnosticReport,
      syncServerIssuesNow,
    }),
    [
      errors,
      networkLogs,
      toasts,
      unreadErrorsCount,
      isDebugDrawerOpen,
      debugDrawerTab,
      selectedError,
      reportError,
      reportNetworkRequest,
      clearErrors,
      clearNetworkLogs,
      markErrorsAsRead,
      openDebugDrawer,
      closeDebugDrawer,
      dismissToast,
      generateDiagnosticReport,
      syncServerIssuesNow,
    ]
  );

  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
};

export const useErrors = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrors must be used within an ErrorProvider');
  }
  return context;
};
