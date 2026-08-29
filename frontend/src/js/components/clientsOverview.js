/**
 * Master Overview Hub of all Accounting Clients.
 */

import { state } from '../state.js';

export function renderClientsOverview(container) {
  const clients = state.clients || [];

  container.innerHTML = `
    <div class="clients-hub-container">
      <div class="card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9));">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.6rem; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.6rem;">
              <span>🏢</span> Accounting Clients Automation Hub
            </h1>
            <div style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.35rem;">
              Centralized management for multi-client bookkeeping, document OCR, bank reconciliation, and Zoho Books synchronization.
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-primary" id="btnHubAddClient">
              <span>➕</span> Register New Client
            </button>
          </div>
        </div>
      </div>

      <!-- Clients Grid -->
      <div class="clients-master-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.5rem;">
        ${clients
          .map((client) => {
            const isCurrent = client.id === state.currentClientId;
            return `
            <div class="card client-master-card ${isCurrent ? 'active-client-border' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="display: flex; gap: 0.85rem; align-items: center;">
                  <div class="client-avatar" style="font-size: 1.8rem;">${client.icon || '🏢'}</div>
                  <div>
                    <h3 style="font-size: 1.15rem; font-weight: 700; margin: 0; color: var(--text-color);">${client.name}</h3>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${client.industry}</div>
                  </div>
                </div>
                <span class="badge ${client.badgeClass || 'badge-primary'}">${client.statusLabel || client.status}</span>
              </div>

              <div style="margin-top: 1rem; font-size: 0.85rem; color: var(--text-color); min-height: 2.8rem; line-height: 1.4;">
                ${client.tagline || client.description}
              </div>

              <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm);">
                <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.4rem;">
                  Automation Workflows (${client.workflows?.length || 0})
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                  ${(client.workflows || [])
                    .map(
                      (wf) => `
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                      <span>${wf.icon} ${wf.name}</span>
                      <span style="color: ${wf.status === 'live' ? 'var(--success)' : 'var(--warning)'}; font-weight: 500;">
                        ${wf.status === 'live' ? '● Live' : '⚡ Dev'}
                      </span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>

              <div style="margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.35rem;">
                ${(client.integrations || [])
                  .map((it) => `<span class="badge badge-primary" style="font-size: 0.68rem;">${it}</span>`)
                  .join('')}
              </div>

              <div style="margin-top: 1.25rem; padding-top: 0.85rem; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                ${
                  isCurrent
                    ? `<span style="font-size: 0.8rem; color: var(--primary); font-weight: 600;">✓ Active Context</span>`
                    : `<span></span>`
                }
                <button class="btn ${isCurrent ? 'btn-outline' : 'btn-primary'} btn-sm btn-launch-client" data-client-id="${client.id}">
                  ${isCurrent ? 'Open Workspace ↗' : 'Switch & Open ⚡'}
                </button>
              </div>
            </div>
          `;
          })
          .join('')}

        <!-- Add Client Card -->
        <div class="card add-client-card" id="cardAddClientPrompt" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; border: 2px dashed var(--border-color); cursor: pointer; min-height: 280px; transition: all 0.2s ease;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--primary);">➕</div>
          <h3 style="font-size: 1.1rem; font-weight: 600; margin: 0;">Add Accounting Client</h3>
          <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.4rem; max-width: 240px;">
            Expand automations to your other bookkeeping & accounting clients.
          </p>
          <button class="btn btn-outline btn-sm" style="margin-top: 0.75rem;">
            Configure Workspace
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach switch button listeners
  container.querySelectorAll('.btn-launch-client').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cid = btn.getAttribute('data-client-id');
      if (cid) {
        state.setClient(cid);
      }
    });
  });

  // Add client triggers
  const triggerAddClientModal = () => {
    const switcherBtn = document.getElementById('btnClientSwitcher');
    if (switcherBtn) switcherBtn.click();
    setTimeout(() => {
      const openAddModalBtn = document.getElementById('btnOpenAddClientModal');
      if (openAddModalBtn) openAddModalBtn.click();
    }, 100);
  };

  const btnHubAdd = container.querySelector('#btnHubAddClient');
  if (btnHubAdd) btnHubAdd.addEventListener('click', triggerAddClientModal);

  const cardAdd = container.querySelector('#cardAddClientPrompt');
  if (cardAdd) cardAdd.addEventListener('click', triggerAddClientModal);
}
