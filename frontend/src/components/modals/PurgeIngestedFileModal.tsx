import React, { useState, useMemo } from 'react';
import {
  X,
  Trash2,
  AlertTriangle,
  FileText,
  RefreshCw,
  CheckCircle2,
  Calendar,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import { batchDeleteStagedTransactions } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAutomation } from '../../context/AutomationContext';

interface PurgeIngestedFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  selectedMonth: string;
  selectedYear: number;
  transactions: any[];
  onSuccess: () => void;
  initialFileName?: string;
}

interface IngestedFileInfo {
  fileName: string;
  count: number;
  totalAmount: number;
  dates: string[];
  isPosted: boolean;
  status: string;
  transactionIds: number[];
}

export const PurgeIngestedFileModal: React.FC<PurgeIngestedFileModalProps> = ({
  isOpen,
  onClose,
  clientId,
  clientName,
  selectedMonth,
  selectedYear,
  transactions,
  onSuccess,
  initialFileName,
}) => {
  const { addLog } = useAutomation();
  const [selectedFileName, setSelectedFileName] = useState<string>(initialFileName || '');
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState<string | null>(null);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null);
  const [manualFileName, setManualFileName] = useState<string>('');

  // Group transactions by source file name
  const ingestedFiles = useMemo<IngestedFileInfo[]>(() => {
    const map = new Map<string, IngestedFileInfo>();

    transactions.forEach((tx) => {
      const fName = (tx.source_file_name || '').trim();
      if (!fName) return;

      let fileObj = map.get(fName);
      if (!fileObj) {
        fileObj = {
          fileName: fName,
          count: 0,
          totalAmount: 0,
          dates: [],
          isPosted: false,
          status: 'PENDING',
          transactionIds: [],
        };
        map.set(fName, fileObj);
      }

      fileObj.count += 1;
      fileObj.totalAmount += tx.total_amount || 0;
      fileObj.transactionIds.push(tx.id);
      if (tx.transaction_date && !fileObj.dates.includes(tx.transaction_date)) {
        fileObj.dates.push(tx.transaction_date);
      }
      if (['INVOICED', 'BILLED', 'JOURNAL_POSTED', 'PAID'].includes(tx.status)) {
        fileObj.isPosted = true;
        fileObj.status = tx.status;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [transactions]);

  // Set default selection when modal opens or files change
  React.useEffect(() => {
    if (initialFileName) {
      setSelectedFileName(initialFileName);
    } else if (ingestedFiles.length > 0 && !selectedFileName) {
      setSelectedFileName(ingestedFiles[0].fileName);
    }
  }, [initialFileName, ingestedFiles]);

  if (!isOpen) return null;

  const targetFile = ingestedFiles.find((f) => f.fileName === selectedFileName);
  const activeFileName = selectedFileName || manualFileName.trim();

  const handlePurge = async () => {
    if (!clientId || !activeFileName) return;

    const count = targetFile ? targetFile.count : 'all';
    const confirmText = `Are you sure you want to permanently delete ${count} staged line items from "${activeFileName}"? This will purge the mistakenly ingested records from PostgreSQL.`;

    if (!window.confirm(confirmText)) {
      return;
    }

    setIsDeleting(true);
    setDeleteSuccessMsg(null);
    setDeleteErrorMsg(null);

    try {
      const res = await batchDeleteStagedTransactions(clientId, {
        file_name: activeFileName,
        transaction_ids: targetFile?.transactionIds,
      });

      const deletedCount = res.deleted_count || targetFile?.count || 1;
      setDeleteSuccessMsg(`Successfully deleted ${deletedCount} transaction(s) extracted from "${activeFileName}".`);
      addLog('success', `🗑️ Purged ${deletedCount} staged transaction(s) for "${activeFileName}" (${clientName}).`);

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (err: any) {
      setDeleteErrorMsg(err.message || 'Failed to delete staged transactions.');
      addLog('error', `Failed to delete file data: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50/80 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shadow-xs">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0F172A] flex items-center gap-2">
                <span>Delete Mistakenly Ingested File</span>
              </h3>
              <p className="text-xs text-[#64748B]">
                Purge unposted records from PostgreSQL ledger for {clientName} ({selectedMonth} {selectedYear})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 bg-white">
          {/* Status Banners */}
          {deleteSuccessMsg && (
            <div className="p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0" />
              <span>{deleteSuccessMsg}</span>
            </div>
          )}
          {deleteErrorMsg && (
            <div className="p-3 rounded-xl bg-[#FFF1F2] border border-[#FECDD3] text-[#9F1239] text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#E11D48] shrink-0" />
              <span>{deleteErrorMsg}</span>
            </div>
          )}

          {/* Explanation Alert */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-[#E2E8F0] text-xs text-[#334155] space-y-1">
            <p className="font-semibold text-[#0F172A] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <span>Zero-Accounting-Pollution Guarantee</span>
            </p>
            <p className="text-[#64748B] text-[11px] leading-relaxed">
              Ingested files remain in the staging database until explicitly approved and exported. Deleting a file removes all of its extracted line items and clears deduplication footprints so you can upload a corrected file.
            </p>
          </div>

          {/* List of Ingested Files */}
          <div>
            <label className="block text-xs font-bold text-[#334155] uppercase tracking-wider mb-2">
              Select Ingested File to Purge ({ingestedFiles.length} detected)
            </label>

            {ingestedFiles.length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                {ingestedFiles.map((file) => {
                  const isSelected = selectedFileName === file.fileName;
                  return (
                    <div
                      key={file.fileName}
                      onClick={() => !file.isPosted && setSelectedFileName(file.fileName)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                        file.isPosted
                          ? 'bg-slate-50 border-[#E2E8F0] opacity-60 cursor-not-allowed'
                          : isSelected
                          ? 'bg-rose-50/70 border-rose-400 shadow-xs'
                          : 'bg-white border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText
                          className={`w-4 h-4 shrink-0 ${
                            isSelected ? 'text-rose-600' : 'text-slate-400'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0F172A] truncate" title={file.fileName}>
                            {file.fileName}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                            <span>{file.count} line item{file.count === 1 ? '' : 's'}</span>
                            <span>•</span>
                            <span className="font-mono text-emerald-600 font-semibold">
                              {formatCurrency(file.totalAmount)}
                            </span>
                            {file.dates.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="font-mono">{file.dates.join(', ')}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {file.isPosted ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Posted ({file.status})
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                              isSelected
                                ? 'bg-rose-100 text-rose-700 border-rose-300'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {isSelected ? 'Selected for Purge' : 'Staged (Unposted)'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 bg-slate-50 border border-[#E2E8F0] rounded-xl">
                <FileText className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                <p className="text-xs text-[#64748B]">No staged source files found in the current period.</p>
                <div className="mt-3 px-4">
                  <label className="block text-[11px] text-[#64748B] text-left mb-1 font-medium">
                    Or enter file name manually:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. August_Invoice_01.pdf"
                    value={manualFileName}
                    onChange={(e) => setManualFileName(e.target.value)}
                    className="w-full bg-white border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs text-[#0F172A] placeholder-slate-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>
            )}
          </div>

          {targetFile && targetFile.isPosted && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                This file has already been posted to Zoho Books ({targetFile.status}). Locked records cannot be deleted from the staging ledger.
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50/80 border-t border-[#E2E8F0] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handlePurge}
            disabled={!activeFileName || isDeleting || (targetFile?.isPosted ?? false)}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer"
          >
            {isDeleting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Purging Staged Records...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>
                  {targetFile ? `Purge All Data for "${targetFile.fileName}"` : 'Purge File Data'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
