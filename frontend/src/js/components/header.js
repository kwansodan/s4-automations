/**
 * Header and Navigation Component with Integrated Client Switcher.
 */

import { state } from '../state.js';
import { renderClientSwitcher } from './clientSwitcher.js';

export function renderHeader(container) {
  const currentClient = state.getCurrentClient();
  const isAnr = state.currentClientId === 'anr_group';

  const mockBadge = state.config?.MOCK_MODE
    ? `<span class="badge badge-warning">🧪 Mock Mode</span>`
    : `<span class="badge badge-success">● Live</span>`;

  const isRunning = state.pipelineProgress?.is_running;
  const runningBadge = isRunning
    ? `<span class="badge badge-primary" style="animation: pulse-glow 1.5s infinite; font-size: 0.8rem;">
        <span class="pulse-dot running"></span> ⚡ Pipeline ${state.pipelineProgress?.percent || 0}%
       </span>`
    : '';

  // Adaptive Tabs depending on selected client
  const navTabsHtml = isAnr
    ? `
      <button class="nav-tab-btn ${state.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
        <span>📊</span> Dashboard
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'sheets' ? 'active' : ''}" data-tab="sheets">
        <span>📋</span> Sheets Review
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'invoicing' ? 'active' : ''}" data-tab="invoicing">
        <span>💳</span> Zoho Invoicing
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'catalog' ? 'active' : ''}" data-tab="catalog">
        <span>📦</span> Catalog
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'config' ? 'active' : ''}" data-tab="config">
        <span>⚙️</span> Config
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">
        <span>🖥️</span> Logs
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'clients' ? 'active' : ''}" data-tab="clients" style="border-left: 1px solid var(--border-color); margin-left: 0.4rem; padding-left: 0.85rem;">
        <span>🏢</span> Clients Hub
      </button>
    `
    : `
      <button class="nav-tab-btn ${state.activeTab === 'workspace' ? 'active' : ''}" data-tab="workspace">
        <span>⚡</span> Workspace
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">
        <span>🖥️</span> Logs
      </button>
      <button class="nav-tab-btn ${state.activeTab === 'clients' ? 'active' : ''}" data-tab="clients" style="border-left: 1px solid var(--border-color); margin-left: 0.4rem; padding-left: 0.85rem;">
        <span>🏢</span> All Clients
      </button>
    `;

  container.innerHTML = `
    <header class="navbar">
      <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
        <div class="brand-wrapper">
          <div class="brand-icon">⚡</div>
          <div>
            <div class="brand-title">S4 Automations</div>
            <div class="brand-subtitle">Multi-Client Accounting Suite</div>
          </div>
        </div>

        <!-- Integrated Client Switcher Container -->
        <div id="headerClientSwitcher"></div>
      </div>

      <div style="display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;">
        ${runningBadge}

        <nav class="nav-tabs">
          ${navTabsHtml}
        </nav>

        <div>${mockBadge}</div>

        <!-- User Profile & Logout -->
        <div style="display: flex; align-items: center; gap: 0.5rem; border-left: 1px solid var(--border-color); padding-left: 0.85rem;">
          <div class="user-profile-pill" title="${state.authState.user?.email || 's4bookkeeping@service4gh.com'}">
            <span style="font-size: 0.9rem;">👤</span>
            <span class="user-email-text">${state.authState.user?.email?.split('@')[0] || 's4bookkeeping'}</span>
          </div>
          <button class="btn btn-outline btn-sm" id="btnAppLogout" title="Sign out of S4 Accounting Hub" style="padding: 0.35rem 0.6rem; color: var(--text-muted);">
            <span>🚪</span>
          </button>
        </div>
      </div>
    </header>
  `;

  // Render Client Switcher into its mounted header element
  const switcherContainer = container.querySelector('#headerClientSwitcher');
  if (switcherContainer) {
    renderClientSwitcher(switcherContainer);
  }

  // Attach logout listener
  const btnLogout = container.querySelector('#btnAppLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('Are you sure you want to sign out of S4 Automations?')) {
        state.logout();
      }
    });
  }

  // Attach tab navigation listeners
  container.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = btn.getAttribute('data-tab');
      if (tab) state.setTab(tab);
    });
  });
}

