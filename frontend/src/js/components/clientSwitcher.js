/**
 * Interactive Client Switcher Dropdown & Onboarding Modal.
 */

import { state } from '../state.js';

let isDropdownOpen = false;
let isModalOpen = false;
let searchQuery = '';

export function renderClientSwitcher(container) {
  const currentClient = state.getCurrentClient();
  const clients = state.clients || [];

  const filteredClients = clients.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q);
  });

  container.innerHTML = `
    <div class="client-switcher-wrapper" id="clientSwitcherWrapper">
      <button class="client-switcher-btn" id="btnClientSwitcher" type="button" aria-haspopup="true" aria-expanded="${isDropdownOpen}">
        <div class="client-avatar">${currentClient.icon || '🏢'}</div>
        <div class="client-meta">
          <div class="client-header-row">
            <span class="client-current-name">${currentClient.name}</span>
            <span class="client-pill ${currentClient.badgeClass || 'badge-primary'}">${currentClient.statusLabel || currentClient.status}</span>
          </div>
          <div class="client-industry">${currentClient.industry}</div>
        </div>
        <span class="client-caret ${isDropdownOpen ? 'open' : ''}">▼</span>
      </button>

      <div class="client-dropdown-menu ${isDropdownOpen ? 'show' : ''}" id="clientDropdownMenu">
        <div class="client-dropdown-header">
          <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
            Accounting Clients (${clients.length})
          </div>
          <div style="margin-top: 0.5rem;">
            <input 
              type="text" 
              id="clientSearchInput" 
              class="client-search-input" 
              placeholder="Search clients or industry..." 
              value="${searchQuery}"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="client-dropdown-list">
          ${filteredClients
            .map((client) => {
              const isSelected = client.id === state.currentClientId;
              return `
              <div class="client-dropdown-item ${isSelected ? 'selected' : ''}" data-client-id="${client.id}">
                <div class="client-item-icon">${client.icon || '🏢'}</div>
                <div class="client-item-info">
                  <div class="client-item-title-row">
                    <span class="client-item-name">${client.name}</span>
                    <span class="badge ${client.badgeClass || 'badge-primary'}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
                      ${client.statusLabel || client.status}
                    </span>
                  </div>
                  <div class="client-item-sub">${client.industry}</div>
                </div>
                ${isSelected ? '<span class="client-item-check">✓</span>' : ''}
              </div>
            `;
            })
            .join('')}
        </div>

        <div class="client-dropdown-footer">
          <button class="btn btn-outline btn-sm" id="btnOpenAllClients" style="width: 100%; margin-bottom: 0.4rem; justify-content: center;">
            <span>🏢</span> View All Clients Hub
          </button>
          <button class="btn btn-primary btn-sm" id="btnOpenAddClientModal" style="width: 100%; justify-content: center;">
            <span>➕</span> Add Accounting Client
          </button>
        </div>
      </div>
    </div>

    <!-- Modal for Adding New Client -->
    <div class="modal-backdrop ${isModalOpen ? 'show' : ''}" id="addClientModalBackdrop">
      <div class="modal-card" style="max-width: 520px;">
        <div class="modal-header">
          <div class="modal-title"><span>➕</span> Register New Accounting Client</div>
          <button class="btn btn-outline btn-sm" id="btnCloseAddClientModal">✕</button>
        </div>

        <div class="modal-body" style="padding: 1.25rem 0;">
          <form id="formAddClient">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Client / Business Name *</label>
              <input type="text" id="newClientName" class="form-control" placeholder="e.g. Apex Logistics, Nana & Sons" required />
            </div>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Industry / Domain *</label>
              <input type="text" id="newClientIndustry" class="form-control" placeholder="e.g. Retail Distribution, Healthcare, Legal" required />
            </div>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Client Icon / Emoji</label>
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                ${['🏢', '⚡', '🧺', '📦', '🚢', '🏥', '⚖️', '🏗️', '🍔', '🚜', '💻']
                  .map(
                    (emoji, idx) => `
                  <label class="emoji-radio-label">
                    <input type="radio" name="newClientEmoji" value="${emoji}" ${idx === 0 ? 'checked' : ''} />
                    <span class="emoji-box">${emoji}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Primary Automation Objective</label>
              <input type="text" id="newClientTagline" class="form-control" placeholder="e.g. Automated Supplier Invoices & VAT Reconciliation" />
            </div>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Target Integrations</label>
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; font-size: 0.85rem;">
                <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                  <input type="checkbox" name="integration" value="Zoho Books" checked /> Zoho Books
                </label>
                <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                  <input type="checkbox" name="integration" value="Google Drive" checked /> Google Drive
                </label>
                <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                  <input type="checkbox" name="integration" value="Google Sheets" checked /> Google Sheets
                </label>
                <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                  <input type="checkbox" name="integration" value="Bank Feeds" /> Bank Feeds / PDF
                </label>
              </div>
            </div>

            <div class="modal-footer" style="padding-top: 1rem; margin-top: 1rem; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 0.75rem;">
              <button type="button" class="btn btn-outline" id="btnCancelAddClient">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Client Workspace</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  const btnSwitcher = container.querySelector('#btnClientSwitcher');
  const dropdownMenu = container.querySelector('#clientDropdownMenu');
  const searchInput = container.querySelector('#clientSearchInput');

  if (btnSwitcher) {
    btnSwitcher.addEventListener('click', (e) => {
      e.stopPropagation();
      isDropdownOpen = !isDropdownOpen;
      renderClientSwitcher(container);
      if (isDropdownOpen) {
        setTimeout(() => {
          const inp = container.querySelector('#clientSearchInput');
          if (inp) inp.focus();
        }, 50);
      }
    });
  }

  // Client list item clicks
  container.querySelectorAll('.client-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      const clientId = item.getAttribute('data-client-id');
      if (clientId) {
        state.setClient(clientId);
        isDropdownOpen = false;
        renderClientSwitcher(container);
      }
    });
  });

  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      // Re-render only list
      const listContainer = container.querySelector('.client-dropdown-list');
      if (listContainer) {
        const filtered = state.clients.filter((c) => {
          const q = searchQuery.toLowerCase();
          return c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q);
        });
        listContainer.innerHTML = filtered
          .map((client) => {
            const isSelected = client.id === state.currentClientId;
            return `
            <div class="client-dropdown-item ${isSelected ? 'selected' : ''}" data-client-id="${client.id}">
              <div class="client-item-icon">${client.icon || '🏢'}</div>
              <div class="client-item-info">
                <div class="client-item-title-row">
                  <span class="client-item-name">${client.name}</span>
                  <span class="badge ${client.badgeClass || 'badge-primary'}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">
                    ${client.statusLabel || client.status}
                  </span>
                </div>
                <div class="client-item-sub">${client.industry}</div>
              </div>
              ${isSelected ? '<span class="client-item-check">✓</span>' : ''}
            </div>
          `;
          })
          .join('');

        // Reattach listeners
        listContainer.querySelectorAll('.client-dropdown-item').forEach((it) => {
          it.addEventListener('click', () => {
            const cid = it.getAttribute('data-client-id');
            if (cid) {
              state.setClient(cid);
              isDropdownOpen = false;
              renderClientSwitcher(container);
            }
          });
        });
      }
    });
    searchInput.addEventListener('click', (e) => e.stopPropagation());
  }

  // All clients hub button
  const btnOpenAll = container.querySelector('#btnOpenAllClients');
  if (btnOpenAll) {
    btnOpenAll.addEventListener('click', () => {
      isDropdownOpen = false;
      state.setTab('clients');
      renderClientSwitcher(container);
    });
  }

  // Add client modal triggers
  const btnOpenModal = container.querySelector('#btnOpenAddClientModal');
  const btnCloseModal = container.querySelector('#btnCloseAddClientModal');
  const btnCancelModal = container.querySelector('#btnCancelAddClient');
  const formAdd = container.querySelector('#formAddClient');

  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', (e) => {
      e.stopPropagation();
      isDropdownOpen = false;
      isModalOpen = true;
      renderClientSwitcher(container);
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      isModalOpen = false;
      renderClientSwitcher(container);
    });
  }

  if (btnCancelModal) {
    btnCancelModal.addEventListener('click', () => {
      isModalOpen = false;
      renderClientSwitcher(container);
    });
  }

  if (formAdd) {
    formAdd.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = container.querySelector('#newClientName')?.value.trim();
      const industry = container.querySelector('#newClientIndustry')?.value.trim();
      const emoji = container.querySelector('input[name="newClientEmoji"]:checked')?.value || '🏢';
      const tagline = container.querySelector('#newClientTagline')?.value.trim();
      const selectedIntegrations = Array.from(
        container.querySelectorAll('input[name="integration"]:checked')
      ).map((el) => el.value);

      if (!name || !industry) return;

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const newClientObj = {
        id: slug,
        name,
        industry,
        icon: emoji,
        status: 'in_development',
        statusLabel: 'In Development',
        badgeClass: 'badge-warning',
        tagline: tagline || `${industry} Accounting & Billing Automation`,
        description: `Custom automation pipelines and Zoho Books synchronization for ${name}.`,
        stats: { accountsCount: 'Setup in Progress', monthlyVolume: 'Planned', syncStatus: 'Draft' },
        workflows: [
          { name: 'Document / Data Extraction', status: 'dev', icon: '📄' },
          { name: 'Reconciliation Rules', status: 'planned', icon: '🤖' },
          { name: 'Zoho Books Posting', status: 'planned', icon: '📚' },
        ],
        integrations: selectedIntegrations.length > 0 ? selectedIntegrations : ['Zoho Books', 'Google Drive'],
      };

      state.addClient(newClientObj);
      isModalOpen = false;
      renderClientSwitcher(container);
    });
  }

  // Click outside to close dropdown
  const closeDropdownOnOutsideClick = (e) => {
    const wrapper = document.getElementById('clientSwitcherWrapper');
    if (wrapper && !wrapper.contains(e.target) && isDropdownOpen) {
      isDropdownOpen = false;
      renderClientSwitcher(container);
    }
  };
  document.removeEventListener('click', closeDropdownOnOutsideClick);
  document.addEventListener('click', closeDropdownOnOutsideClick);
}
