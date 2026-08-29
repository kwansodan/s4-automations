const DEFAULT_CLIENTS = [
  {
    id: 'anr_group',
    name: 'ANR Group',
    industry: 'Commercial Laundry & Hospitality',
    icon: '🧺',
    status: 'active', // 'active' | 'in_development' | 'setup_pending'
    statusLabel: 'Production Live',
    badgeClass: 'badge-success',
    tagline: 'Physical Control Slip OCR Vision & Zoho Books Invoicing',
    description: 'Automated handwritten laundry slip OCR extraction with Gemini 3.6 Flash, Google Sheets 2-tab review, and automated Zoho Books draft billing.',
    stats: { slipsCount: '1,420+', monthlyVolume: 'GHS 84,200', activeHotels: 8 },
    workflows: [
      { name: 'Daily Control Slip OCR', status: 'live', icon: '⚡' },
      { name: 'Missing Linen Loss Audit', status: 'live', icon: '🔍' },
      { name: '1-Click Zoho Draft Invoicing', status: 'live', icon: '💳' },
    ],
    integrations: ['Google Drive', 'Google Sheets', 'Zoho Books', 'Gemini Flash AI'],
  },
  {
    id: 'polaris',
    name: 'Polaris',
    industry: 'Financial & Advisory Services',
    icon: '⚡',
    status: 'in_development',
    statusLabel: 'In Development',
    badgeClass: 'badge-warning',
    tagline: 'Multi-Currency Bank Feeds & Expense Reconciliation',
    description: 'Automated bank statement statement extraction, intelligent vendor expense categorization, and double-entry Zoho Books journal entry synchronization.',
    stats: { accountsCount: '4 Accounts', monthlyVolume: 'Pending Sync', syncStatus: 'Blueprint Ready' },
    workflows: [
      { name: 'Bank Statement PDF Parser', status: 'dev', icon: '📄' },
      { name: 'AI Transaction Matching', status: 'dev', icon: '🤖' },
      { name: 'Zoho Expense Journal Sync', status: 'planned', icon: '📚' },
    ],
    integrations: ['Bank Feeds / PDF', 'Zoho Books', 'Inngest Engine'],
  },
  {
    id: 'mr_osei',
    name: 'Mr Osei',
    industry: 'Real Estate & Property Management',
    icon: '🏢',
    status: 'setup_pending',
    statusLabel: 'Setup Pending',
    badgeClass: 'badge-primary',
    tagline: 'Tenant Rent Billing, Receipt Matching & Utility Allocations',
    description: 'End-to-end property tenant invoicing, rent receipt bank matching, automatic utility sub-meter calculations, and monthly arrears tracking.',
    stats: { propertiesCount: '12 Units', monthlyVolume: 'Ready to Setup', syncStatus: 'Not Connected' },
    workflows: [
      { name: 'Rent Receipt Verification', status: 'planned', icon: '🧾' },
      { name: 'Automated Monthly Rent Invoicing', status: 'planned', icon: '🏢' },
      { name: 'Utility Sub-meter Allocations', status: 'planned', icon: '💡' },
    ],
    integrations: ['WhatsApp Receipts', 'Google Sheets', 'Zoho Invoicing'],
  },
];

function loadSavedClients() {
  if (typeof localStorage === 'undefined') return DEFAULT_CLIENTS;
  try {
    const saved = localStorage.getItem('S4_CLIENTS_LIST');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn('Failed loading saved clients list:', e);
  }
  return DEFAULT_CLIENTS;
}

function getInitialClientId(clients) {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('S4_ACTIVE_CLIENT');
    if (saved && clients.some((c) => c.id === saved)) return saved;
  }
  return 'anr_group';
}

function loadSavedAuth() {
  if (typeof localStorage === 'undefined') {
    return { isAuthenticated: false, user: null, token: null };
  }
  // Force sign-out if URL contains ?logout, ?auth=login, or #login
  if (typeof window !== 'undefined') {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    if (search.includes('logout') || search.includes('auth=login') || hash.includes('login') || hash.includes('logout')) {
      localStorage.removeItem('S4_AUTH_TOKEN');
      localStorage.removeItem('S4_AUTH_USER');
      return { isAuthenticated: false, user: null, token: null };
    }
  }

  const token = localStorage.getItem('S4_AUTH_TOKEN');
  let user = null;
  try {
    const savedUser = localStorage.getItem('S4_AUTH_USER');
    if (savedUser) user = JSON.parse(savedUser);
  } catch (e) {
    console.warn('Failed parsing saved auth user:', e);
  }

  return {
    isAuthenticated: Boolean(token),
    user: user || (token ? { email: 's4bookkeeping@service4gh.com', name: 'S4 Bookkeeping Admin', role: 'admin' } : null),
    token: token || null,
  };
}

export const state = {
  authState: loadSavedAuth(),
  currentClientId: getInitialClientId(initialClients),
  clients: initialClients,
  activeTab: 'dashboard', // 'dashboard' | 'sheets' | 'invoicing' | 'catalog' | 'config' | 'logs' | 'clients' | 'workspace'
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
    { time: new Date().toLocaleTimeString(), type: 'info', message: 'S4 Accounting Automation Hub initialized.' }
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

  login(token, user) {
    this.authState = {
      isAuthenticated: true,
      token,
      user: user || { email: 's4bookkeeping@service4gh.com', name: 'S4 Bookkeeping Admin', role: 'admin' },
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_AUTH_TOKEN', token);
      localStorage.setItem('S4_AUTH_USER', JSON.stringify(this.authState.user));
    }
    this.addLog('success', `Signed in successfully as ${this.authState.user.email}.`);
    this.notify();
  },

  logout() {
    this.authState = {
      isAuthenticated: false,
      token: null,
      user: null,
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('S4_AUTH_TOKEN');
      localStorage.removeItem('S4_AUTH_USER');
    }
    this.addLog('info', 'Signed out of S4 Accounting Hub.');
    this.notify();
  },

  getCurrentClient() {
    return this.clients.find((c) => c.id === this.currentClientId) || this.clients[0];
  },

  setClient(clientId) {
    if (this.currentClientId === clientId) return;
    this.currentClientId = clientId;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_ACTIVE_CLIENT', clientId);
    }
    
    // Switch active tab appropriately
    if (clientId === 'anr_group') {
      this.activeTab = 'dashboard';
    } else {
      this.activeTab = 'workspace';
    }

    const client = this.getCurrentClient();
    this.addLog('info', `Switched active client context to ${client.name} (${client.industry}).`);
    this.notify();
  },

  addClient(newClient) {
    this.clients.push(newClient);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_CLIENTS_LIST', JSON.stringify(this.clients));
    }
    this.addLog('success', `Created new accounting client profile: ${newClient.name}.`);
    this.setClient(newClient.id);
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
