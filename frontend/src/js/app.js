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
import { renderPipelineModal, openPipelineModal } from './components/pipelineModal.js';
import { renderInvoiceModal, openInvoiceModal } from './components/invoiceModal.js';
import { renderClientWorkspace } from './components/clientWorkspace.js';
import { renderClientsOverview } from './components/clientsOverview.js';
import { renderLoginView } from './components/loginView.js';

// Expose modal open handlers globally for inline event bindings
window.openPipelineModal = openPipelineModal;
window.openInvoiceModal = openInvoiceModal;

export async function loadBackendData() {
  if (!state.authState.isAuthenticated) return;
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

    state.addLog('info', `S4 Accounting Hub connected to API (${health?.status || 'live'}). User: ${state.authState.user?.email}.`);
    if (sheetsData?.monthly_summary?.length > 0) {
      state.addLog('success', `Google Sheets: Loaded ${sheetsData.monthly_summary.length} billing rows for ${state.selectedMonth} ${state.selectedYear}.`);
    }

    if (pipelineStatus) {
      state.updatePipelineProgress(pipelineStatus);
      if (pipelineStatus.is_running) {
        state.addLog('info', `⚡ Active background pipeline detected (${pipelineStatus.percent}%). Streaming live progress...`);
        state.startPolling(fetchPipelineStatus);
      }
    }
    state.notify();
  } catch (e) {
    state.addLog('error', `Failed loading initial state: ${e.message}`);
  }
}
window.loadBackendData = loadBackendData;

async function initApp() {
  const headerContainer = document.getElementById('headerApp');
  const mainContainer = document.getElementById('mainContent');
  const pipelineModalContainer = document.getElementById('pipelineModalContainer');
  const invoiceModalContainer = document.getElementById('invoiceModalContainer');

  // Load initial backend data only if authenticated
  if (state.authState.isAuthenticated) {
    loadBackendData();
  }

  // Render Modals into their dedicated containers defensively
  try {
    if (pipelineModalContainer) renderPipelineModal(pipelineModalContainer);
    if (invoiceModalContainer) renderInvoiceModal(invoiceModalContainer);
  } catch (err) {
    console.warn('Modal initialization notice:', err);
  }

  // Global delegated click listeners for modal triggers
  document.addEventListener('click', (e) => {
    const pipelineTrigger = e.target.closest('[data-action="open-pipeline-modal"]');
    if (pipelineTrigger) {
      e.preventDefault();
      openPipelineModal();
    }
    const invoiceTrigger = e.target.closest('[data-action="open-invoice-modal"]');
    if (invoiceTrigger) {
      e.preventDefault();
      openInvoiceModal();
    }
  });

  // Re-render views on state change
  function updateUI() {
    try {
      // 🔒 Full Application Route Guard
      if (!state.authState.isAuthenticated) {
        if (headerContainer) headerContainer.innerHTML = '';
        if (mainContainer) renderLoginView(mainContainer);
        return;
      }

      if (headerContainer) renderHeader(headerContainer);

    const isAnr = state.currentClientId === 'anr_group';

    if (state.activeTab === 'clients') {
      mainContainer.innerHTML = `<div id="clientsHubContainer"></div>`;
      renderClientsOverview(document.getElementById('clientsHubContainer'));
      return;
    }

    if (!isAnr || state.activeTab === 'workspace') {
      if (state.activeTab === 'logs') {
        mainContainer.innerHTML = `<div id="logsContainer"></div>`;
        renderLiveConsole(document.getElementById('logsContainer'));
      } else {
        mainContainer.innerHTML = `<div id="workspaceContainer"></div>`;
        renderClientWorkspace(document.getElementById('workspaceContainer'));
      }
      return;
    }

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
              <button class="btn btn-primary" style="width: 100%;" data-action="open-pipeline-modal" onclick="openPipelineModal()">
                <span>🚀</span> Run Ingestion Pipeline
              </button>
            </div>

            <div class="card">
              <div class="card-title"><span>📑</span> 1-Click Zoho Invoicing</div>
              <p class="card-desc" style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
                Create draft invoices in Zoho Books for all approved billing rows and update sheet status.
              </p>
              <button class="btn btn-success" style="width: 100%;" data-action="open-invoice-modal" onclick="openInvoiceModal()">
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
              <button class="btn btn-success" data-action="open-invoice-modal" onclick="openInvoiceModal()"><span>💳</span> Create Draft Invoices Now</button>
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
  } catch (err) {
    console.error('Critical Render Error:', err);
    if (mainContainer) {
      mainContainer.innerHTML = `
        <div style="padding: 3rem 1.5rem; text-align: center; max-width: 500px; margin: 2rem auto; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px;">
          <h2 style="color: #f87171; margin-bottom: 0.5rem;">⚡ Application Notice</h2>
          <p style="color: #cbd5e1; font-size: 0.9rem; margin-bottom: 1.5rem;">${err.message}</p>
          <button class="btn btn-primary" onclick="window.location.reload()">Reload Application</button>
        </div>
      `;
    }
  }
}

  // Subscribe to reactive state updates
  state.subscribe(updateUI);

  // Initial render
  updateUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
window.state = state;
