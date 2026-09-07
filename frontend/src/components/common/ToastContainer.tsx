import React from 'react';
import { useErrors } from '../../context/ErrorContext';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import type { ToastNotification } from '../../types/errors';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast, openDebugDrawer } = useErrors();
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  if (toasts.length === 0) return null;

  const handleCopy = (toast: ToastNotification) => {
    const text = toast.errorRef
      ? [
          `Title: ${toast.title}`,
          `Message: ${toast.message}`,
          toast.errorRef.status ? `Status: ${toast.errorRef.status}` : '',
          toast.errorRef.endpoint ? `Endpoint: ${toast.errorRef.endpoint}` : '',
          toast.errorRef.troubleshootingHint ? `Hint: ${toast.errorRef.troubleshootingHint}` : '',
          toast.errorRef.traceback ? `Traceback:\n${toast.errorRef.traceback}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : `${toast.title}\n${toast.message}`;

    navigator.clipboard.writeText(text);
    setCopiedId(toast.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((t) => {
        const isCritical = t.severity === 'critical';
        const isError = t.severity === 'error' || isCritical;
        const isWarning = t.severity === 'warning';
        const isSuccess = t.severity === 'success';

        const borderColor = isCritical
          ? 'border-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.35)]'
          : isError
          ? 'border-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.25)]'
          : isWarning
          ? 'border-amber-500/60 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
          : isSuccess
          ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
          : 'border-sky-500/40 shadow-xl';

        const bgColor = isCritical
          ? 'bg-gradient-to-br from-red-950/95 to-slate-950/95'
          : isError
          ? 'bg-gradient-to-br from-rose-950/90 to-slate-950/95'
          : isWarning
          ? 'bg-gradient-to-br from-amber-950/90 to-slate-950/95'
          : isSuccess
          ? 'bg-gradient-to-br from-emerald-950/90 to-slate-950/95'
          : 'bg-gradient-to-br from-slate-900/95 to-slate-950/95';

        const IconComponent = isError ? AlertCircle : isWarning ? AlertTriangle : isSuccess ? CheckCircle2 : Info;
        const iconColor = isError
          ? 'text-red-400'
          : isWarning
          ? 'text-amber-400'
          : isSuccess
          ? 'text-emerald-400'
          : 'text-sky-400';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-2xl border p-4 backdrop-blur-xl ${borderColor} ${bgColor} text-slate-100 shadow-2xl transition-all duration-300 animate-in slide-in-from-bottom-5`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl bg-slate-950/80 border border-slate-800 ${iconColor} shrink-0 mt-0.5`}>
                <IconComponent className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-bold text-white tracking-tight truncate">{t.title}</span>
                  <span
                    className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                      isError
                        ? 'bg-red-900/80 text-red-200'
                        : isWarning
                        ? 'bg-amber-900/80 text-amber-200'
                        : isSuccess
                        ? 'bg-emerald-900/80 text-emerald-200'
                        : 'bg-sky-900/80 text-sky-200'
                    }`}
                  >
                    {t.severity}
                  </span>
                </div>

                <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed break-words">{t.message}</p>

                {/* Troubleshooting Hint if available */}
                {t.errorRef?.troubleshootingHint && (
                  <div className="mt-2 text-[11px] text-amber-300/90 bg-amber-950/40 border border-amber-500/20 rounded-lg p-2 flex items-start gap-1.5">
                    <span className="font-bold shrink-0">💡 Fix:</span>
                    <span className="line-clamp-2">{t.errorRef.troubleshootingHint}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    {t.errorRef && (
                      <button
                        onClick={() => openDebugDrawer('errors', t.errorRef)}
                        className="flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/80 hover:bg-sky-900/80 border border-sky-500/30 px-2.5 py-1 rounded-lg transition cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Inspect Trace</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleCopy(t)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 rounded-lg transition cursor-pointer"
                    >
                      {copiedId === t.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <button
                    onClick={() => dismissToast(t.id)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
