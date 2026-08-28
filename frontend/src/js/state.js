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
  logs: [
    { time: new Date().toLocaleTimeString(), type: 'info', message: 'ANR Laundry Billing Engine dashboard initialized.' }
  ],

  listeners: new Set(),

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

  addLog(type, message) {
    this.logs.unshift({
      time: new Date().toLocaleTimeString(),
      type,
      message,
    });
    if (this.logs.length > 200) this.logs.pop();
    this.notify();
  },
};
