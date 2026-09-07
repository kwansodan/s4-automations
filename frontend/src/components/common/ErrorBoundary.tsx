import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Terminal, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
  componentName?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error(`🚨 [S4 ErrorBoundary] Crash in ${this.props.componentName || 'Component'}:`, error, errorInfo);

    if (typeof window !== 'undefined' && (window as any).__S4_REPORT_ERROR__) {
      (window as any).__S4_REPORT_ERROR__({
        severity: 'critical',
        category: 'react',
        title: `UI Render Crash in ${this.props.componentName || 'Component'}`,
        message: error.message || 'React component threw an uncaught render error.',
        traceback: error.stack,
        componentStack: errorInfo.componentStack || undefined,
        troubleshootingHint: 'Check recent state updates or missing object properties in this view.',
      });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleCopy = () => {
    const text = [
      `Component: ${this.props.componentName || 'Unknown'}`,
      `Error: ${this.state.error?.message}`,
      `Stack:`,
      this.state.error?.stack,
      `Component Stack:`,
      this.state.errorInfo?.componentStack,
    ].join('\n');

    navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="bg-red-950/30 border border-red-500/40 rounded-2xl p-6 my-4 shadow-2xl animate-in fade-in backdrop-blur-xl">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-red-900/40 border border-red-500/30 rounded-xl text-red-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Render Crash: {this.props.componentName || 'Application View'}
                </h3>
                <span className="text-[10px] font-mono font-bold text-red-300 bg-red-950/80 border border-red-500/40 px-2 py-0.5 rounded-full uppercase">
                  Client Runtime Error
                </span>
              </div>

              <p className="text-xs text-red-200/90 font-mono break-all mb-4">
                {this.state.error?.message || 'An unexpected rendering error crashed this component.'}
              </p>

              {/* Stack Trace Accordion */}
              <div className="bg-slate-950/90 border border-red-900/40 rounded-xl p-3 text-[11px] font-mono text-slate-300 mb-4 overflow-x-auto max-h-48 custom-scrollbar">
                <div className="text-red-400 font-bold mb-1">Stack Trace:</div>
                <pre className="text-slate-400 whitespace-pre-wrap">{this.state.error?.stack || 'No stack trace available'}</pre>
                {this.state.errorInfo?.componentStack && (
                  <>
                    <div className="text-sky-400 font-bold mt-2 mb-1">Component Hierarchy:</div>
                    <pre className="text-slate-400 whitespace-pre-wrap">{this.state.errorInfo.componentStack.trim()}</pre>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={this.handleReset}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-red-600/30 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Again</span>
                </button>

                <button
                  onClick={this.handleCopy}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  {this.state.copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{this.state.copied ? 'Copied' : 'Copy Error Details'}</span>
                </button>

                <button
                  onClick={() => {
                    const event = new KeyboardEvent('keydown', {
                      key: 'D',
                      ctrlKey: true,
                      shiftKey: true,
                      bubbles: true,
                    });
                    window.dispatchEvent(event);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900/80 hover:bg-slate-800 border border-sky-500/30 text-sky-400 hover:text-sky-300 text-xs font-semibold rounded-xl transition cursor-pointer ml-auto"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Open In-App Debug Inspector</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
