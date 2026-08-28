/**
 * Application reactive state store and event bus.
 */

export const state = {
  activeTab: 'dashboard', // 'dashboard' | 'sheets' | 'invoicing' | 'catalog' | 'config' | 'logs'
  selectedMonth: 'August',
  selectedYear: 2026,
  sheetsSubTab: 'monthly', // 'monthly' | 'daily'
  
  health: null,
  stats: null,
  config: null,
  sheetsData: null,
  catalog: null,
  pipelineProgress: null,
  logs: [
    { time: new Date().toLocaleTimeString(), type: 'info', message: 'ANR Laundry Billing Engine dashboard initialized.' }
  ],

  listeners: new Set(),
  _pollingInterval: null,
  _knownLogKeys: new Set(),

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this));
  },

  setTab(tab) {
    this.activeTab = tab;
    this.notify();
  },

  setSheetsSubTab(subTab) {
    this.sheetsSubTab = subTab;
    this.notify();
  },

  addLog(type, message, time = null) {
    this.logs.unshift({
      time: time || new Date().toLocaleTimeString(),
      type,
      message,
    });
    if (this.logs.length > 300) this.logs.pop();
    this.notify();
  },

  updatePipelineProgress(progress) {
    this.pipelineProgress = progress;

    let hasNewLogs = false;
    // Merge recent logs from backend
    if (progress?.recent_logs && Array.isArray(progress.recent_logs)) {
      progress.recent_logs.forEach((entry) => {
        const key = `${entry.time}_${entry.message}`;
        if (!this._knownLogKeys.has(key)) {
          this._knownLogKeys.add(key);
          this.logs.unshift({
            time: entry.time || new Date().toLocaleTimeString(),
            type: entry.level || 'info',
            message: entry.message,
          });
          hasNewLogs = true;
        }
      });
      if (this.logs.length > 300) {
        this.logs = this.logs.slice(0, 300);
      }
    }

    this.notify();
  },

  startPolling(fetchFn, onComplete) {
    if (this._pollingInterval) clearInterval(this._pollingInterval);

    const poll = async () => {
      try {
        const progress = await fetchFn();
        this.updatePipelineProgress(progress);

        if (!progress.is_running && progress.status !== 'RUNNING') {
          if (this._pollingInterval) {
            clearInterval(this._pollingInterval);
            this._pollingInterval = null;
          }
          if (typeof onComplete === 'function') {
            onComplete(progress);
          }
        }
      } catch (err) {
        console.warn('Status polling error:', err);
      }
    };

    poll(); // Run immediately
    this._pollingInterval = setInterval(poll, 1200);
  },

  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
  },
};
