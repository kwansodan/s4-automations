/**
 * Application Entrypoint and Main Router.
 */

import { state } from './state.js';
import { fetchHealth, fetchStats, fetchConfig, fetchSheetsData, fetchCatalog, fetchPipelineStatus } from './api.js';

import { renderHeader } from './components/header.js';
import { renderKpiCards } from './components/kpiCards.js';
import { renderProgressTracker } from './components/progressTracker.js';
import { renderConfigSection } from './components/configSection.js';
import { renderSheetsViewer } from './components/sheetsViewer.js';
import { renderCatalogDrawer } from './components/catalogDrawer.js';
import { renderLiveConsole } from './components/liveConsole.js';
import { renderPipelineModal } from './components/pipelineModal.js';
import { renderInvoiceModal } from './components/invoiceModal.js';

async function initApp() {
  const headerContainer = document.getElementById('headerApp');
  const mainContainer = document.getElementById('mainContent');
  const modalContainer = document.getElementById('modalContainer');

  // Load initial backend data
  try {
    const [health, stats, config, sheetsData, catalog, pipelineStatus] = await Promise.all([
      fetchHealth().catch(() => null),
      fetchStats().catch(() => null),
      fetchConfig().catch(() => ({ config: {} })),
      fetchSheetsData('August', 2026).catch(() => ({ daily_details: [], monthly_summary: [] })),
      fetchCatalog().catch(() => ({ contacts: [], items: [] })),
      fetchPipelineStatus().catch(() => null),
    ]);

    state.health = health;
    state.stats = stats;
    state.config = config?.config || {};
    state.sheetsData = sheetsData;
    state.catalog = catalog;
    if (pipelineStatus) {
      state.pipelineProgress = pipelineStatus;
      if (pipelineStatus.is_running) {
        state.startPolling(fetchPipelineStatus);
      }
    }
    state.addLog('info', 'Loaded backend services, sheets data, and catalog.');
  } catch (e) {
    state.addLog('error', `Failed loading initial state: ${e.message}`);
  }

  // Render Modals once
  renderPipelineModal(modalContainer);
  renderInvoiceModal(modalContainer);

  // Re-render views on state change
  function updateUI() {
    renderHeader(headerContainer);

    if (state.activeTab === 'dashboard') {
      mainContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1.75rem;">
          <div id="kpiContainer"></div>

          <!-- Live Pipeline Execution & Progress Tracker -->
          <div id="progressTrackerContainer"></div>

          <!-- Quick Actions Grid -->
          <div class="grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
            <div class="card">
              <div class="card-title"><span>⚡</span> Daily OCR Ingestion Pipeline</div>
              <p class="card-desc" style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
                Trigger vision extraction for hotel client folders, audit linen counts, and sync the review workbook.
              </p>
              <button class="btn btn-primary" style="width: 100%;" onclick="openPipelineModal()">
                <span>🚀</span> Run Ingestion Pipeline
              </button>
            </div>

            <div class="card">
              <div class="card-title"><span>📑</span> 1-Click Zoho Invoicing</div>
              <p class="card-desc" style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
                Create draft invoices in Zoho Books for all approved billing rows and update sheet status.
              </p>
              <button class="btn btn-success" style="width: 100%;" onclick="openInvoiceModal()">
                <span>💳</span> Generate Draft Invoices
              </button>
            </div>

            <div class="card">
              <div class="card-title"><span>⚙️</span> Configuration & Credentials</div>
              <p class="card-desc" style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
                Configure Gemini API, Zoho OAuth2, Google Service Account, and Inngest keys.
              </p>
              <button class="btn btn-outline" style="width: 100%;" onclick="state.setTab('config')">
                <span>⚙️</span> Manage Configuration
              </button>
            </div>
          </div>

          <!-- Embedded Sheets Review Snapshot -->
          <div id="dashboardSheetsContainer"></div>

          <!-- Live Console Output -->
          <div id="dashboardConsoleContainer"></div>
        </div>
      `;

      renderKpiCards(document.getElementById('kpiContainer'));
      renderProgressTracker(document.getElementById('progressTrackerContainer'));
      renderSheetsViewer(document.getElementById('dashboardSheetsContainer'));
      renderLiveConsole(document.getElementById('dashboardConsoleContainer'));

    } else if (state.activeTab === 'sheets') {
      mainContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div id="sheetsProgressTrackerContainer"></div>
          <div id="sheetsContainer"></div>
        </div>
      `;
      renderProgressTracker(document.getElementById('sheetsProgressTrackerContainer'));
      renderSheetsViewer(document.getElementById('sheetsContainer'));

    } else if (state.activeTab === 'invoicing') {
      mainContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <div id="kpiContainer"></div>
          <div class="card">
            <div class="card-header">
              <div class="card-title"><span>💳</span> 1-Click Zoho Books Invoicing Hub</div>
              <button class="btn btn-success" onclick="openInvoiceModal()"><span>💳</span> Create Draft Invoices Now</button>
            </div>
            <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
              Review the approved items below. Only items with <strong>Approved? = Checked</strong> will be drafted into Zoho Books.
            </p>
            <div id="invoicingSheetsContainer"></div>
          </div>
        </div>
      `;
      renderKpiCards(document.getElementById('kpiContainer'));
      renderSheetsViewer(document.getElementById('invoicingSheetsContainer'));

    } else if (state.activeTab === 'catalog') {
      mainContainer.innerHTML = `<div id="catalogContainer"></div>`;
      renderCatalogDrawer(document.getElementById('catalogContainer'));

    } else if (state.activeTab === 'config') {
      mainContainer.innerHTML = `<div id="configContainer"></div>`;
      renderConfigSection(document.getElementById('configContainer'));

    } else if (state.activeTab === 'logs') {
      mainContainer.innerHTML = `<div id="logsContainer"></div>`;
      renderLiveConsole(document.getElementById('logsContainer'));
    }
  }

  // Subscribe to reactive state updates
  state.subscribe(updateUI);

  // Initial render
  updateUI();
}

window.addEventListener('DOMContentLoaded', initApp);
window.state = state;
