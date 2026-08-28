/**
 * Zoho Contacts and Item Catalog Explorer Component.
 */

import { state } from '../state.js';

export function renderCatalogDrawer(container) {
  const catalog = state.catalog || { contacts: [], items: [] };
  const contacts = catalog.contacts || [];
  const items = catalog.items || [];

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="font-size: 1.4rem; font-weight: 800; color: #fff;">📦 Zoho Books Catalog & Contacts</h2>
          <p style="font-size: 0.88rem; color: var(--text-muted);">
            Active customer accounts and standard linen laundry rates used for automatic OCR semantic matching.
          </p>
        </div>
      </div>

      <div class="config-grid">
        <!-- Active Customers -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>🏨</span> Active Hotel Customer Accounts (${contacts.length})</div>
            <span class="badge badge-success">Zoho Contacts</span>
          </div>

          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Contact Name</th>
                  <th>Company / Property</th>
                  <th>Zoho Contact ID</th>
                </tr>
              </thead>
              <tbody>
                ${
                  contacts.length === 0
                    ? `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No contacts loaded.</td></tr>`
                    : contacts
                        .map(
                          (c) => `
                  <tr>
                    <td><strong>${c.contact_name}</strong></td>
                    <td>${c.company_name || '-'}</td>
                    <td><code>${c.contact_id}</code></td>
                  </tr>
                `
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Linen Price List -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>🧺</span> Commercial Linen Catalog (${items.length})</div>
            <span class="badge badge-info">Standard Rates</span>
          </div>

          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Standard Rate</th>
                  <th>Item ID</th>
                </tr>
              </thead>
              <tbody>
                ${
                  items.length === 0
                    ? `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No items loaded.</td></tr>`
                    : items
                        .map(
                          (i) => `
                  <tr>
                    <td><strong>${i.name}</strong></td>
                    <td style="color: #38bdf8; font-weight: 700;">GHS ${i.rate?.toFixed(2) || '0.00'}</td>
                    <td><code>${i.item_id}</code></td>
                  </tr>
                `
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}
