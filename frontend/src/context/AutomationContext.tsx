import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { DashboardStats, PipelineProgress } from '../types/pipeline';
import type { SheetsReviewData } from '../types/sheets';
import type { ZohoCatalogData } from '../types/zoho';
import type { SystemConfig, LogEntry } from '../types/config';
import {
  fetchHealth,
  fetchStats,
  fetchConfig,
  fetchSheetsData,
  fetchCatalog,
  fetchPipelineStatus,
  triggerPipeline,
  triggerInvoicing,
  toggleApproval,
  updateConfig,
} from '../lib/api';
import { useAuth } from './AuthContext';

export type ActiveTab = 'dashboard' | 'sheets' | 'invoicing' | 'catalog' | 'config' | 'logs' | 'clients' | 'workspace' | 'queries' | 'portal' | 'social' | 'changelog' | 'privacy' | 'contacts';

export type WorkspaceSubTab = 'overview' | 'ar' | 'ap' | 'bank' | 'requests' | 'pipelines' | 'settings';

interface AutomationContextType {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  workspaceSubTab: WorkspaceSubTab;
  setWorkspaceSubTab: (sub: WorkspaceSubTab) => void;
  navigateToClientSubTab: (sub: WorkspaceSubTab) => void;

  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  sheetsSubTab: 'monthly' | 'daily';
  setSheetsSubTab: (sub: 'monthly' | 'daily') => void;

  health: { status: string; service: string; mock_mode: boolean } | null;
  stats: DashboardStats | null;
  config: SystemConfig | null;
  sheetsData: SheetsReviewData | null;
  catalog: ZohoCatalogData | null;
  pipelineProgress: PipelineProgress | null;
  logs: LogEntry[];

  isLoading: boolean;
  isPipelineModalOpen: boolean;
  setIsPipelineModalOpen: (open: boolean) => void;
  isInvoiceModalOpen: boolean;
  setIsInvoiceModalOpen: (open: boolean) => void;

  addLog: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
  refreshAll: () => Promise<void>;
  runPipeline: (payload: Record<string, any>) => Promise<any>;
  runInvoicing: (payload: Record<string, any>) => Promise<any>;
  handleToggleApproval: (rowIndex: number, field: 'reviewed' | 'approved', value: boolean) => Promise<void>;
  saveSystemConfig: (newConfig: Record<string, any>) => Promise<void>;
}

const AutomationContext = createContext<AutomationContextType | undefined>(undefined);

export const AutomationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();

  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [workspaceSubTab, setWorkspaceSubTab] = useState<WorkspaceSubTab>('overview');
  const [selectedMonth, setSelectedMonth] = useState<string>('August');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [sheetsSubTab, setSheetsSubTab] = useState<'monthly' | 'daily'>('monthly');

  const [health, setHealth] = useState<{ status: string; service: string; mock_mode: boolean } | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [sheetsData, setSheetsData] = useState<SheetsReviewData | null>(null);
  const [catalog, setCatalog] = useState<ZohoCatalogData | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: new Date().toLocaleTimeString(), type: 'info', message: 'S4 Accounting Automation Engine v2.0 (React 19) initialized.' },
  ]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState<boolean>(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState<boolean>(false);

  const navigateToClientSubTab = useCallback((sub: WorkspaceSubTab) => {
    setWorkspaceSubTab(sub);
    setActiveTab('workspace');
  }, []);

  const addLog = useCallback((type: 'info' | 'success' | 'warning' | 'error', message: string) => {
    setLogs((prev) => [
      { time: new Date().toLocaleTimeString(), type, message },
      ...prev.slice(0, 150),
    ]);
  }, []);

  const refreshAll = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const [h, s, c, sh, cat, p] = await Promise.all([
        fetchHealth().catch((err) => {
          addLog('error', `Health check failed: ${err.message}`);
          return null;
        }),
        fetchStats(selectedMonth, selectedYear).catch((err) => {
          addLog('error', `Stats fetch failed: ${err.message}`);
          return null;
        }),
        fetchConfig().catch((err) => {
          addLog('error', `Config fetch failed: ${err.message}`);
          return { status: 'ok', config: {} };
        }),
        fetchSheetsData(selectedMonth, selectedYear).catch((err) => {
          addLog('error', `Sheets fetch failed: ${err.message}`);
          return { daily_details: [], monthly_summary: [] };
        }),
        fetchCatalog().catch((err) => {
          addLog('error', `Zoho catalog fetch failed: ${err.message}`);
          return { contacts_count: 0, items_count: 0, contacts: [], items: [] };
        }),
        fetchPipelineStatus().catch((err) => {
          addLog('warning', `Pipeline status check failed: ${err.message}`);
          return null;
        }),
      ]);

      setHealth(h);
      setStats(s);
      setConfig(c?.config || {});
      setSheetsData(sh);
      setCatalog(cat);
      if (p) setPipelineProgress(p);

      addLog('info', `Synced system telemetry (${h?.status || 'live'}). Data loaded for ${selectedMonth} ${selectedYear}.`);
    } catch (e: any) {
      addLog('error', `Failed refreshing automation state: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedMonth, selectedYear, addLog]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshAll();
    }
  }, [isAuthenticated, refreshAll]);

  // Real-time polling when pipeline is executing
  // Real-time sequential polling when pipeline is executing (prevents request stacking)
  useEffect(() => {
    if (!isAuthenticated || !pipelineProgress?.is_running) return;

    let isMounted = true;
    let timeoutId: any = null;
    let isRequestInFlight = false;

    const poll = async () => {
      if (!isMounted || isRequestInFlight) return;
      isRequestInFlight = true;

      try {
        const progress = await fetchPipelineStatus();
        if (!isMounted) return;
        setPipelineProgress(progress);

        if (!progress.is_running) {
          addLog('success', `Pipeline completed: ${progress.current_step || 'Workflow finished.'}`);
          refreshAll();
          return; // Terminate polling
        }
      } catch (err) {
        console.warn('Polling notice:', err);
      } finally {
        isRequestInFlight = false;
        if (isMounted) {
          timeoutId = setTimeout(poll, 2500);
        }
      }
    };

    // Schedule initial poll
    timeoutId = setTimeout(poll, 1500);

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAuthenticated, pipelineProgress?.is_running, addLog, refreshAll]);


  const runPipeline = async (payload: Record<string, any>) => {
    addLog('info', `Dispatching OCR Ingestion Pipeline run for ${selectedMonth} ${selectedYear}...`);
    try {
      const res = await triggerPipeline({
        month: selectedMonth,
        year: selectedYear,
        ...payload,
      });
      setIsPipelineModalOpen(false);
      addLog('success', `Pipeline Dispatched: ${res.message}`);
      const initialProgress = await fetchPipelineStatus();
      setPipelineProgress(initialProgress);
      return res;
    } catch (e: any) {
      addLog('error', `Pipeline execution error: ${e.message}`);
      throw e;
    }
  };

  const runInvoicing = async (payload: Record<string, any>) => {
    addLog('info', `Dispatching Zoho Books Draft Invoice generation task for ${selectedMonth} ${selectedYear}...`);
    try {
      const res = await triggerInvoicing({
        month: selectedMonth,
        year: selectedYear,
        ...payload,
      });
      setIsInvoiceModalOpen(false);
      addLog('success', `Zoho Invoicing Task Dispatched: ${res.message}`);
      const initialProgress = await fetchPipelineStatus();
      setPipelineProgress(initialProgress);
      return res;
    } catch (e: any) {
      addLog('error', `Invoicing dispatch error: ${e.message}`);
      throw e;
    }
  };

  const handleToggleApproval = async (rowIndex: number, field: 'reviewed' | 'approved', value: boolean) => {
    try {
      // Optimistic UI update
      if (sheetsData) {
        const updatedSummary = sheetsData.monthly_summary.map((row) =>
          row.row_index === rowIndex ? { ...row, [field]: value } : row
        );
        setSheetsData({ ...sheetsData, monthly_summary: updatedSummary });
      }

      await toggleApproval({
        spreadsheet_id: sheetsData?.spreadsheet_id,
        row_index: rowIndex,
        field,
        value,
      });

      addLog('info', `Updated Tab 2 Row ${rowIndex}: ${field} = ${value}`);
      // Refresh stats
      const s = await fetchStats(selectedMonth, selectedYear);
      setStats(s);
    } catch (e: any) {
      addLog('error', `Toggle approval failed: ${e.message}`);
      refreshAll();
    }
  };

  const saveSystemConfig = async (newConfig: Record<string, any>) => {
    try {
      const res = await updateConfig(newConfig);
      setConfig(res.config);
      addLog('success', 'Configuration updated and persisted successfully.');
    } catch (e: any) {
      addLog('error', `Failed updating config: ${e.message}`);
    }
  };

  return (
    <AutomationContext.Provider
      value={{
        activeTab,
        setActiveTab,
        workspaceSubTab,
        setWorkspaceSubTab,
        navigateToClientSubTab,
        selectedMonth,
        setSelectedMonth,
        selectedYear,
        setSelectedYear,
        sheetsSubTab,
        setSheetsSubTab,

        health,
        stats,
        config,
        sheetsData,
        catalog,
        pipelineProgress,
        logs,

        isLoading,
        isPipelineModalOpen,
        setIsPipelineModalOpen,
        isInvoiceModalOpen,
        setIsInvoiceModalOpen,

        addLog,
        refreshAll,
        runPipeline,
        runInvoicing,
        handleToggleApproval,
        saveSystemConfig,
      }}
    >
      {children}
    </AutomationContext.Provider>
  );
};

export const useAutomation = () => {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error('useAutomation must be used within an AutomationProvider');
  }
  return context;
};
