/**
 * Zoho Invoicing Modal Component.
 */

import { state } from '../state.js';
import { triggerInvoicing, fetchSheetsData, fetchStats, fetchPipelineStatus } from '../api.js';

export function renderInvoiceModal(container) {
  container.innerHTML = `
    <div id="invoiceModalBackdrop" class="modal-backdrop">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">💳 Generate Zoho Books Draft Invoices</div>
          <button class="modal-close-btn" id="btnCloseInvoiceModal">&times;</button>
        </div>

        <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
          This will scan Tab 2 (<strong>Monthly_Summary</strong>) in Google Sheets for all rows marked <code>Approved? = True</code> with status <code>PENDING</code>, create safe Draft Invoices in Zoho Books API, and mark the sheet rows as <code>INVOICED</code>.
        </p>

        <div class="card" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.3); margin-bottom: 1rem;">
          <div style="font-size: 0.85rem; color: #34d399; font-weight: 700;">Ready to Bill:</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #fff;">
            GHS ${(state.stats?.approved_billing_total_ghs || 0).toFixed(2)}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
            Draft status allows accounting review before final sending.
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" id="btnCancelInvoiceModal">Cancel</button>
          <button class="btn btn-success" id="btnExecuteInvoiceModal">
            <span>💳</span> Create Draft Invoices
          </button>
        </div>
      </div>
    </div>
  `;

  const backdrop = document.getElementById('invoiceModalBackdrop');
  const btnClose = document.getElementById('btnCloseInvoiceModal');
  const btnCancel = document.getElementById('btnCancelInvoiceModal');
  const btnExecute = document.getElementById('btnExecuteInvoiceModal');

  const closeModal = () => backdrop.classList.remove('active');

  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  btnExecute.addEventListener('click', async () => {
    closeModal();
    state.addLog('info', 'Dispatching Zoho Draft Invoice generation task...');

    try {
      const payload = {
        month: state.selectedMonth,
        year: state.selectedYear,
      };
      const res = await triggerInvoicing(payload);
      state.addLog('success', `Zoho Invoicing Task Dispatched: ${res.message || 'Queued in Inngest'}`);

      // Start real-time progress polling
      state.startPolling(fetchPipelineStatus, async (finalProgress) => {
        state.sheetsData = await fetchSheetsData(state.selectedMonth, state.selectedYear);
        state.stats = await fetchStats();
        state.notify();
        state.addLog('success', `Invoicing completed: ${finalProgress?.current_step || 'Invoices drafted.'}`);
      });

    } catch (e) {
      state.addLog('error', `Invoicing dispatch error: ${e.message}`);
      alert(`Invoice generation error: ${e.message}`);
    }
  });

  window.openInvoiceModal = () => {
    const el = document.getElementById('invoiceModalBackdrop');
    if (el) el.classList.add('active');
  };
}

export function openInvoiceModal() {
  const el = document.getElementById('invoiceModalBackdrop');
  if (el) el.classList.add('active');
}
