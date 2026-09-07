import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type {
  AppError,
  ErrorSeverity,
  ErrorCategory,
  NetworkRequestRecord,
  ToastNotification,
} from '../types/errors';

interface ErrorContextType {
  errors: AppError[];
  networkLogs: NetworkRequestRecord[];
  toasts: ToastNotification[];
  unreadErrorsCount: number;
  isDebugDrawerOpen: boolean;
  debugDrawerTab: 'errors' | 'network' | 'logs' | 'health';
  selectedError: AppError | null;

  reportError: (err: {
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
      const newError: AppError = {
        id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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

      setErrors((prev) => [newError, ...prev.slice(0, MAX_ERRORS - 1)]);
      setUnreadErrorsCount((prev) => prev + 1);

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
        setToasts((prev) => [newToast, ...prev.slice(0, 4)]);

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

  // Expose global reporting function on window for non-React code (e.g. state.js)
  useEffect(() => {
    (window as any).__S4_REPORT_ERROR__ = reportError;
    (window as any).__S4_REPORT_NETWORK__ = reportNetworkRequest;
    return () => {
      delete (window as any).__S4_REPORT_ERROR__;
      delete (window as any).__S4_REPORT_NETWORK__;
    };
  }, [reportError, reportNetworkRequest]);

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
