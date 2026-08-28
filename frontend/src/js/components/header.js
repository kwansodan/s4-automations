/**
 * Header and Navigation Component.
 */

import { state } from '../state.js';

export function renderHeader(container) {
  const isHealthy = state.health?.status === 'healthy';
  const mockBadge = state.config?.MOCK_MODE
    ? `<span class="badge badge-warning">🧪 Mock Mode</span>`
    : `<span class="badge badge-success">● Production Live</span>`;

  container.innerHTML = `
    <header class="navbar">
      <div class="brand-wrapper">
        <div class="brand-icon">🧺</div>
        <div>
          <div class="brand-title">ANR Laundry Billing Engine</div>
          <div class="brand-subtitle">Durable OCR Vision &bull; Google Sheets Review &bull; Zoho Books Sync</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 1.5rem;">
        <nav class="nav-tabs">
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
            <span>⚙️</span> Configuration
          </button>
          <button class="nav-tab-btn ${state.activeTab === 'logs' ? 'active' : ''}" data-tab="logs">
            <span>🖥️</span> Live Logs
          </button>
        </nav>

        <div>${mockBadge}</div>
      </div>
    </header>
  `;

  // Attach tab navigation listeners
  container.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = btn.getAttribute('data-tab');
      if (tab) state.setTab(tab);
    });
  });
}
