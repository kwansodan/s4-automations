/**
 * Dedicated Client Automation Workspace for Onboarding / In-Development Clients (Polaris, Mr Osei, etc.)
 */

import { state } from '../state.js';

export function renderClientWorkspace(container) {
  const client = state.getCurrentClient();

  container.innerHTML = `
    <div class="client-workspace-container">
      <!-- Client Banner Header -->
      <div class="card client-workspace-hero">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; gap: 1.25rem; align-items: center;">
            <div class="workspace-avatar">${client.icon || '🏢'}</div>
            <div>
              <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                <h1 style="font-size: 1.6rem; font-weight: 700; margin: 0;">${client.name}</h1>
                <span class="badge ${client.badgeClass || 'badge-warning'}" style="font-size: 0.8rem; padding: 0.25rem 0.6rem;">
                  ${client.statusLabel || client.status}
                </span>
              </div>
              <div style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.25rem;">
                ${client.industry} &bull; ${client.tagline || 'Accounting & Financial Automations'}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-outline btn-sm" id="btnSwitchToAnr">
              <span>🧺</span> Switch to ANR Group
            </button>
            <button class="btn btn-primary btn-sm" id="btnSimulateWorkflow">
              <span>⚡</span> Run Test Simulation
            </button>
          </div>
        </div>

        <div style="margin-top: 1.25rem; font-size: 0.9rem; color: var(--text-color); line-height: 1.5; background: rgba(0,0,0,0.2); padding: 0.85rem 1.1rem; border-radius: var(--radius-sm); border-left: 3px solid var(--primary);">
          ${client.description}
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid-4" style="margin-top: 1.5rem;">
        <div class="kpi-card">
          <div class="kpi-icon">📊</div>
          <div class="kpi-value">${client.stats?.monthlyVolume || 'Planned'}</div>
          <div class="kpi-label">Projected Monthly Volume</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">📁</div>
          <div class="kpi-value">${client.stats?.accountsCount || client.stats?.propertiesCount || '3 Workflows'}</div>
          <div class="kpi-label">Active Modules</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🔗</div>
          <div class="kpi-value" style="font-size: 1.1rem; color: var(--success);">${client.stats?.syncStatus || 'Connected'}</div>
          <div class="kpi-label">Integration Health</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">⚡</div>
          <div class="kpi-value" style="font-size: 1.1rem; color: var(--primary);">Inngest Engine</div>
          <div class="kpi-label">Automation Runner</div>
        </div>
      </div>

      <!-- Main Columns: Pipeline Blueprint & Integration Settings -->
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
        
        <!-- Workflow Architecture Blueprint -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>📐</span> Automation Pipeline Blueprint</div>
            <span class="badge badge-primary">Custom Workflow Engine</span>
          </div>

          <div class="blueprint-flow-list" style="display: flex; flex-direction: column; gap: 1rem; padding: 0.5rem 0;">
            ${client.workflows
              .map(
                (wf, idx) => `
              <div class="blueprint-step-card">
                <div class="blueprint-step-num">0${idx + 1}</div>
                <div style="flex: 1;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-weight: 600; font-size: 1rem; color: var(--text-color);">
                      ${wf.icon} ${wf.name}
                    </div>
                    <span class="badge ${
                      wf.status === 'live'
                        ? 'badge-success'
                        : wf.status === 'dev'
                        ? 'badge-warning'
                        : 'badge-primary'
                    }" style="font-size: 0.7rem;">
                      ${wf.status === 'live' ? '● Ready' : wf.status === 'dev' ? '⚡ In Development' : '⏳ Planned'}
                    </span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.3rem;">
                    ${
                      idx === 0
                        ? 'Ingests source files (PDF / Scans / Feeds) and applies multimodal extraction.'
                        : idx === 1
                        ? 'Fuzzy matches records against historical charts of accounts and applies reconciliation rules.'
                        : 'Prepares draft postings in Zoho Books with full audit trail links.'
                    }
                  </div>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Connected Services & Configuration -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>🔌</span> Integrations</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.85rem;">
            ${(client.integrations || ['Zoho Books', 'Google Drive'])
              .map(
                (intg) => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.85rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                  <span>${intg.includes('Drive') ? '📂' : intg.includes('Zoho') ? '💳' : intg.includes('Sheet') ? '📋' : '⚡'}</span>
                  <span style="font-weight: 500; font-size: 0.9rem;">${intg}</span>
                </div>
                <span class="badge badge-success" style="font-size: 0.7rem;">Active</span>
              </div>
            `
              )
              .join('')}

            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
              <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-muted);">
                Setup New Pipeline for ${client.name}
              </div>
              <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                Ready to develop custom parsers or bank rules for ${client.name}? The Inngest orchestrator and Zoho Books service are already linked.
              </p>
              <button class="btn btn-outline btn-sm" id="btnReqAutomation" style="width: 100%; margin-top: 0.5rem; justify-content: center;">
                <span>🛠️</span> Configure Workflows
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach buttons
  const btnSwitchToAnr = container.querySelector('#btnSwitchToAnr');
  if (btnSwitchToAnr) {
    btnSwitchToAnr.addEventListener('click', () => {
      state.setClient('anr_group');
    });
  }

  const btnSim = container.querySelector('#btnSimulateWorkflow');
  if (btnSim) {
    btnSim.addEventListener('click', () => {
      state.addLog('info', `[${client.name}] Initiating test simulation for ${client.workflows[0]?.name}...`);
      setTimeout(() => {
        state.addLog('info', `[${client.name}] Ingested 3 test transaction documents.`);
      }, 700);
      setTimeout(() => {
        state.addLog('success', `[${client.name}] AI Extraction verified with 99.4% confidence score.`);
        state.addLog('info', `[${client.name}] Generated 3 draft reconciliation journals.`);
      }, 1500);
    });
  }

  const btnReq = container.querySelector('#btnReqAutomation');
  if (btnReq) {
    btnReq.addEventListener('click', () => {
      state.addLog('info', `Opened workflow configurator for ${client.name}. Ready to build specialized pipeline.`);
      alert(`Workflow Configurator for ${client.name} is ready! We can add your client-specific data rules, folder IDs, and posting schemas.`);
    });
  }
}
