/**
 * Interactive Two-Tier Google Sheet Review Viewer Component.
 */

import { state } from '../state.js';
import { fetchSheetsData, toggleApproval } from '../api.js';

export function renderSheetsViewer(container) {
  const data = state.sheetsData || { daily_details: [], monthly_summary: [] };
  const dailyRows = data.daily_details || [];
  const monthlyRows = data.monthly_summary || [];

  const confidenceBadge = (score) => {
    const s = (score || 'HIGH').toUpperCase();
    if (s === 'LOW') return `<span class="badge badge-warning">LOW</span>`;
    if (s === 'MEDIUM') return `<span class="badge badge-info">MEDIUM</span>`;
    return `<span class="badge badge-success">HIGH</span>`;
  };

  const statusBadge = (status) => {
    const s = (status || 'PENDING').toUpperCase();
    if (s === 'INVOICED') return `<span class="badge badge-success">INVOICED</span>`;
    if (s === 'APPROVED') return `<span class="badge badge-info">APPROVED</span>`;
    return `<span class="badge badge-warning">PENDING</span>`;
  };

  container.innerHTML = `
    <div class="card">
      <div class="sheets-toolbar">
        <div>
          <div class="card-title"><span>📋</span> Google Sheets Review Workbook</div>
          <div class="card-subtitle">
            Workbook: <strong>ANR_Billing_Review_${state.selectedMonth}_${state.selectedYear}</strong>
            ${data.spreadsheet_url ? `&bull; <a href="${data.spreadsheet_url}" target="_blank" class="link-scan">Open in Google Sheets ↗</a>` : ''}
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div class="sheets-subtabs">
            <button class="subtab-btn ${state.sheetsSubTab === 'monthly' ? 'active' : ''}" id="btnSubtabMonthly">
              Tab 2: Monthly Summary (${monthlyRows.length})
            </button>
            <button class="subtab-btn ${state.sheetsSubTab === 'daily' ? 'active' : ''}" id="btnSubtabDaily">
              Tab 1: Daily Slip Details (${dailyRows.length})
            </button>
          </div>

          <button id="btnRefreshSheets" class="btn btn-outline btn-sm">
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      <div class="table-container">
        ${
          state.sheetsSubTab === 'monthly'
            ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Zoho Item ID</th>
                <th>Standard Linen Item</th>
                <th>Raw Names Seen</th>
                <th>Confidence</th>
                <th>Unit Rate</th>
                <th>Total Picked Up</th>
                <th>Total Delivered</th>
                <th>Loss Discrepancy</th>
                <th>Total Billed (GHS)</th>
                <th>Audit Notes</th>
                <th style="text-align: center;">Reviewed?</th>
                <th style="text-align: center;">Approved?</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${
                monthlyRows.length === 0
                  ? `<tr><td colspan="14" style="text-align: center; color: var(--text-muted); padding: 2rem;">No monthly summary rows found for ${state.selectedMonth} ${state.selectedYear}. Run the ingestion pipeline to populate.</td></tr>`
                  : monthlyRows
                      .map(
                        (r) => `
                <tr>
                  <td><strong>${r.client_name}</strong></td>
                  <td><code>${r.zoho_item_id || '-'}</code></td>
                  <td>${r.standard_item_name}</td>
                  <td style="color: var(--text-muted); font-size: 0.8rem;">${r.raw_names_seen || '-'}</td>
                  <td>${confidenceBadge(r.confidence_score)}</td>
                  <td>GHS ${r.unit_rate?.toFixed(2) || '0.00'}</td>
                  <td><strong>${r.total_picked_up}</strong></td>
                  <td>${r.total_delivered}</td>
                  <td style="${r.linen_discrepancy > 0 ? 'color: #fbbf24; font-weight: bold;' : ''}">${r.linen_discrepancy} pcs</td>
                  <td style="font-weight: 700; color: #38bdf8;">GHS ${r.total_billed?.toFixed(2) || '0.00'}</td>
                  <td style="font-size: 0.8rem; color: var(--text-muted);">${r.audit_notes || '-'}</td>
                  <td style="text-align: center;">
                    <input type="checkbox" class="chk-reviewed" data-row="${r.row_index}" ${r.reviewed ? 'checked' : ''} />
                  </td>
                  <td style="text-align: center;">
                    <input type="checkbox" class="chk-approved" data-row="${r.row_index}" ${r.approved ? 'checked' : ''} />
                  </td>
                  <td>${statusBadge(r.status)}</td>
                </tr>
              `
                      )
                      .join('')
              }
            </tbody>
          </table>
        `
            : `
          <table class="data-table">
            <thead>
              <tr>
                <th>Slip Date</th>
                <th>File Name</th>
                <th>Client Name</th>
                <th>Raw Handwritten Text</th>
                <th>Standard Item</th>
                <th>Pickup Qty</th>
                <th>Delivery Qty</th>
                <th>Loss</th>
                <th>Confidence</th>
                <th>Scan Link</th>
                <th>Processed At</th>
              </tr>
            </thead>
            <tbody>
              ${
                dailyRows.length === 0
                  ? `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2rem;">No individual slip line items found for ${state.selectedMonth} ${state.selectedYear}.</td></tr>`
                  : dailyRows
                      .map(
                        (d) => `
                <tr>
                  <td>${d.slip_date}</td>
                  <td><code>${d.file_name}</code></td>
                  <td><strong>${d.client_name}</strong></td>
                  <td style="color: #c084fc;">${d.raw_item_name}</td>
                  <td>${d.standard_item_name}</td>
                  <td><strong>${d.pickup_qty}</strong></td>
                  <td>${d.delivery_qty}</td>
                  <td style="${d.loss_qty > 0 ? 'color: #fbbf24; font-weight: bold;' : ''}">${d.loss_qty}</td>
                  <td>${confidenceBadge(d.confidence_score)}</td>
                  <td><a href="${d.drive_file_url || '#'}" target="_blank" class="link-scan">View Scan ↗</a></td>
                  <td style="font-size: 0.78rem; color: var(--text-muted);">${d.processed_at}</td>
                </tr>
              `
                      )
                      .join('')
              }
            </tbody>
          </table>
        `
        }
      </div>
    </div>
  `;

  // Attach Subtab switcher listeners
  const btnMonthly = document.getElementById('btnSubtabMonthly');
  const btnDaily = document.getElementById('btnSubtabDaily');
  if (btnMonthly) btnMonthly.addEventListener('click', () => state.setSheetsSubTab('monthly'));
  if (btnDaily) btnDaily.addEventListener('click', () => state.setSheetsSubTab('daily'));

  // Attach Refresh button listener
  const btnRefresh = document.getElementById('btnRefreshSheets');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      state.addLog('info', 'Refreshing Google Sheets review data...');
      try {
        state.sheetsData = await fetchSheetsData(state.selectedMonth, state.selectedYear);
        state.addLog('success', 'Sheets review data refreshed.');
        state.notify();
      } catch (e) {
        state.addLog('error', `Failed to refresh sheets data: ${e.message}`);
      }
    });
  }

  // Attach interactive checkbox listeners
  container.querySelectorAll('.chk-reviewed').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const rowIdx = parseInt(chk.getAttribute('data-row'), 10);
      const isChecked = chk.checked;
      try {
        await toggleApproval({
          spreadsheet_id: state.sheetsData?.spreadsheet_id,
          row_index: rowIdx,
          field: 'reviewed',
          value: isChecked,
        });
        state.addLog('info', `Updated Row ${rowIdx} Reviewed? -> ${isChecked}`);
      } catch (err) {
        state.addLog('error', `Failed to update checkbox: ${err.message}`);
        chk.checked = !isChecked; // revert
      }
    });
  });

  container.querySelectorAll('.chk-approved').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const rowIdx = parseInt(chk.getAttribute('data-row'), 10);
      const isChecked = chk.checked;
      try {
        await toggleApproval({
          spreadsheet_id: state.sheetsData?.spreadsheet_id,
          row_index: rowIdx,
          field: 'approved',
          value: isChecked,
        });
        state.addLog('success', `Updated Row ${rowIdx} Approved? -> ${isChecked}`);
      } catch (err) {
        state.addLog('error', `Failed to update approval: ${err.message}`);
        chk.checked = !isChecked; // revert
      }
    });
  });
}
