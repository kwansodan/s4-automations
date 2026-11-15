import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileText,
  Building2,
  Store,
  Calendar,
  CheckCircle2,
  CheckSquare,
  RefreshCw,
  Eye,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAutomation } from '../../context/AutomationContext';
import { resolveDocumentEmbed } from '../../lib/documentEmbed';
import { formatCurrency } from '../../lib/utils';

type PaneWidthPreset = 'compact' | 'standard' | 'wide' | 'fullscreen';

export const DocumentPreviewPane: React.FC = () => {
  const {
    activeSlipPreview,
    previewQueue,
    previewIndex,
    closeSlipPreview,
    navigateSlipPreview,
    updateActiveSlipApproval,
  } = useAutomation();

  const [widthPreset, setWidthPreset] = useState<PaneWidthPreset>('standard');
  const [isItemsExpanded, setIsItemsExpanded] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imageRotation, setImageRotation] = useState<number>(0);

  // Reset zoom and loader when active preview changes
  useEffect(() => {
    setIframeLoading(true);
    setImageZoom(1);
    setImageRotation(0);
  }, [activeSlipPreview?.id, activeSlipPreview?.rawUrl]);

  const embedInfo = useMemo(() => {
    if (!activeSlipPreview?.rawUrl) return null;
    return resolveDocumentEmbed(activeSlipPreview.rawUrl);
  }, [activeSlipPreview?.rawUrl]);

  const totalSlips = previewQueue.length;
  const currentSlipNumber = previewIndex + 1;

  const cycleWidthPreset = useCallback(() => {
    setWidthPreset((prev) => {
      if (prev === 'compact') return 'standard';
      if (prev === 'standard') return 'wide';
      if (prev === 'wide') return 'fullscreen';
      return 'standard';
    });
  }, []);

  const handleApproveCurrentSlip = async () => {
    if (!activeSlipPreview || isApproving) return;
    if (activeSlipPreview.isApproved) return;
    setIsApproving(true);
    try {
      if (activeSlipPreview.onApprove) {
        await activeSlipPreview.onApprove();
      }
      updateActiveSlipApproval(true);
    } catch (err) {
      console.error('Failed to approve slip from preview pane:', err);
    } finally {
      setIsApproving(false);
    }
  };

  if (!activeSlipPreview) return null;

  // Compute responsive width classes based on preset
  const widthClasses = {
    compact: 'w-full lg:w-[35vw] lg:min-w-[380px] lg:max-w-[500px]',
    standard: 'w-full lg:w-[46vw] xl:w-[42vw] 2xl:w-[38vw] 3xl:w-[35vw] lg:min-w-[480px] lg:max-w-[1200px]',
    wide: 'w-full lg:w-[65vw] xl:w-[58vw] 2xl:w-[52vw] lg:min-w-[640px] lg:max-w-[1600px]',
    fullscreen: 'w-full',
  }[widthPreset];

  const partyLabel = activeSlipPreview.partyType === 'Vendor' ? 'Vendor' : 'Customer';
  const PartyIcon = activeSlipPreview.partyType === 'Vendor' ? Store : Building2;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden animate-in fade-in duration-200">
      {/* Mobile/Tablet Backdrop (Hidden on desktop so table behind remains interactive) */}
      <div
        className="block lg:hidden absolute inset-0 bg-black/60 backdrop-blur-xs pointer-events-auto transition-opacity"
        onClick={closeSlipPreview}
        title="Tap outside to dismiss preview"
      />

      {/* Slide-over Right Pane */}
      <aside
        className={`absolute inset-y-0 right-0 pointer-events-auto bg-white border-l border-slate-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ease-out ${widthClasses}`}
        aria-label="Document and Delivery Slip Previewer"
      >
        {/* Top Header Bar */}
        <div className="p-2.5 sm:p-4 bg-white border-b border-slate-200 shrink-0 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            {/* Left: Document Icon & Title */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 rounded-xl bg-sky-50 text-[#0284C7] border border-sky-200 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3
                    className="text-xs sm:text-sm font-bold text-slate-900 truncate max-w-[200px] sm:max-w-[280px]"
                    title={activeSlipPreview.title}
                  >
                    {activeSlipPreview.title}
                  </h3>
                  {activeSlipPreview.isApproved ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Approved</span>
                    </span>
                  ) : activeSlipPreview.isReviewed ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full shrink-0">
                      <Eye className="w-3 h-3 text-sky-600" />
                      <span>Reviewed</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span>Pending</span>
                    </span>
                  )}
                </div>

                {/* Subtitle / Metadata Badges */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-600">
                  {activeSlipPreview.partyName && (
                    <span
                      className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 font-semibold px-2 py-0.5 rounded-md border border-slate-200/80 max-w-[180px] truncate"
                      title={`${partyLabel}: ${activeSlipPreview.partyName}`}
                    >
                      <PartyIcon className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="truncate">{activeSlipPreview.partyName}</span>
                    </span>
                  )}
                  {activeSlipPreview.date && (
                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 font-mono px-2 py-0.5 rounded-md border border-slate-200/80">
                      <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                      <span>{activeSlipPreview.date}</span>
                    </span>
                  )}
                  {typeof activeSlipPreview.totalAmount === 'number' && (
                    <span className="font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      {formatCurrency(activeSlipPreview.totalAmount, activeSlipPreview.currency || 'GHS')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Quick Approval, Navigation, Width & Close Controls */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {/* Approve Slip Button */}
              {!activeSlipPreview.isApproved && (
                <button
                  type="button"
                  onClick={handleApproveCurrentSlip}
                  disabled={isApproving}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition cursor-pointer shadow-xs disabled:opacity-50"
                  title="Approve this delivery slip and all its line items"
                >
                  {isApproving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckSquare className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">Approve Slip</span>
                </button>
              )}

              {/* Prev / Next Slip Navigation */}
              {totalSlips > 1 && (
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => navigateSlipPreview('prev')}
                    className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition cursor-pointer"
                    title="Previous slip (or Left Arrow)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-1.5 text-[10px] font-mono font-bold text-slate-600 select-none">
                    {currentSlipNumber}/{totalSlips}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigateSlipPreview('next')}
                    className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition cursor-pointer"
                    title="Next slip (or Right Arrow)"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Width Preset Cycle */}
              <button
                type="button"
                onClick={cycleWidthPreset}
                className="hidden sm:flex p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition cursor-pointer border border-transparent hover:border-slate-200"
                title={`Toggle pane width (Current: ${widthPreset})`}
              >
                {widthPreset === 'fullscreen' ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>

              {/* Open in External Tab Fallback */}
              {activeSlipPreview.rawUrl && (
                <a
                  href={activeSlipPreview.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-slate-500 hover:text-[#0284C7] hover:bg-sky-50 rounded-lg transition cursor-pointer border border-transparent hover:border-sky-200"
                  title="Open in new browser tab (Google Drive / OneDrive)"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}

              {/* Close Button */}
              <button
                type="button"
                onClick={closeSlipPreview}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                title="Close right pane (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Collapsible Line Items Verification Drawer Header */}
          {activeSlipPreview.items && activeSlipPreview.items.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsItemsExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between text-left text-xs font-semibold text-slate-700 hover:text-slate-900 py-0.5 cursor-pointer group"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[#0284C7] font-bold">
                    {activeSlipPreview.items.length} Extracted Line Item
                    {activeSlipPreview.items.length === 1 ? '' : 's'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    (Click to {isItemsExpanded ? 'hide' : 'verify SKU details'})
                  </span>
                </div>
                {isItemsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
                )}
              </button>

              {/* Expanded Line Items Table */}
              {isItemsExpanded && (
                <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-slate-50/70 p-1.5 text-xs">
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-slate-500 font-semibold border-b border-slate-200 pb-1">
                      <tr>
                        <th className="py-1 px-2">Description</th>
                        <th className="py-1 px-1 text-center">Deliv</th>
                        <th className="py-1 px-1 text-right">Rate</th>
                        <th className="py-1 px-2 text-right">Total</th>
                        <th className="py-1 px-1 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 font-medium">
                      {activeSlipPreview.items.map((it) => (
                        <tr key={it.id} className="hover:bg-white transition-colors">
                          <td className="py-1 px-2 font-semibold text-slate-800 truncate max-w-[160px]">
                            {it.description}
                          </td>
                          <td className="py-1 px-1 text-center font-mono">{it.delivQty ?? '-'}</td>
                          <td className="py-1 px-1 text-right font-mono text-slate-600">
                            {it.rate ? Number(it.rate).toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-2 text-right font-mono font-bold text-emerald-700">
                            {formatCurrency(it.amount, activeSlipPreview.currency || 'GHS')}
                          </td>
                          <td className="py-1 px-1 text-center">
                            {it.approved ? (
                              <span className="text-emerald-600 font-bold text-[10px]">Approved</span>
                            ) : it.reviewed ? (
                              <span className="text-sky-600 font-bold text-[10px]">Reviewed</span>
                            ) : (
                              <span className="text-amber-600 font-bold text-[10px]">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Document Viewer Body */}
        <div className="flex-1 relative bg-slate-100 flex flex-col overflow-hidden">
          {/* Image Toolbar when previewing an image */}
          {embedInfo?.isImage && (
            <div className="absolute top-3 right-3 z-30 flex items-center gap-1 bg-white/90 backdrop-blur-xs border border-slate-200 rounded-lg p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                className="p-1 hover:bg-slate-100 text-slate-600 rounded transition"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                className="p-1 hover:bg-slate-100 text-slate-600 rounded transition"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setImageRotation((r) => (r + 90) % 360)}
                className="p-1 hover:bg-slate-100 text-slate-600 rounded transition"
                title="Rotate 90 degrees"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setImageZoom(1);
                  setImageRotation(0);
                }}
                className="px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 rounded transition"
                title="Reset zoom and rotation"
              >
                Reset
              </button>
            </div>
          )}

          {/* Loading Skeleton */}
          {iframeLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10 text-slate-500 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-[#0284C7]" />
              <p className="text-xs font-semibold">Loading document preview...</p>
            </div>
          )}

          {/* Embedded Content */}
          {embedInfo?.isImage ? (
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
              <img
                src={embedInfo.embedUrl}
                alt={activeSlipPreview.title}
                onLoad={() => setIframeLoading(false)}
                onError={() => setIframeLoading(false)}
                style={{
                  transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                  transition: 'transform 0.15s ease-out',
                }}
                className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
              />
            </div>
          ) : embedInfo?.canEmbed && embedInfo.embedUrl ? (
            <iframe
              src={embedInfo.embedUrl}
              title={activeSlipPreview.title}
              onLoad={() => setIframeLoading(false)}
              className="w-full h-full border-0"
              allow="autoplay"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
              <FileText className="w-12 h-12 text-slate-400 mb-3" />
              <h4 className="text-sm font-bold text-slate-800">Direct Preview Unavailable</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
                This document format or storage link cannot be embedded directly in an iframe. You can open it in a separate browser tab.
              </p>
              {activeSlipPreview.rawUrl && (
                <a
                  href={activeSlipPreview.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-bold rounded-xl transition shadow-xs"
                >
                  <span>Open in External Tab</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {/* Subtle Bottom Fallback Bar */}
          <div className="p-2 bg-slate-50 border-t border-slate-200 text-center text-[11px] text-slate-500 shrink-0 flex items-center justify-between px-4">
            <span className="truncate">
              Google Drive preview embed
            </span>
            {activeSlipPreview.rawUrl && (
              <a
                href={activeSlipPreview.rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#0284C7] hover:text-[#0369A1] hover:underline font-semibold ml-2 shrink-0"
              >
                <span>Open in Google Drive</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
