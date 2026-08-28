/**
 * Pipeline Run Modal Trigger Component.
 */

import { state } from '../state.js';
import { triggerPipeline, fetchSheetsData, fetchStats } from '../api.js';

export function renderPipelineModal(container) {
  container.innerHTML = `
    <div id="pipelineModalBackdrop" class="modal-backdrop">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">🚀 Trigger Daily OCR Ingestion Pipeline</div>
          <button class="modal-close-btn" id="btnClosePipelineModal">&times;</button>
        </div>

        <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.25rem;">
          This initiates the Inngest workflow: discovers client folders in Google Drive, runs Gemini 3.6 Flash structured extraction on handwritten slips, updates the review workbook, and archives processed files.
        </p>

        <div class="form-group">
          <label class="form-label">Billing Month & Year</label>
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem;">
            <select id="modalPipelineMonth" class="form-select">
              <option value="August" ${state.selectedMonth === 'August' ? 'selected' : ''}>August</option>
              <option value="September">September</option>
              <option value="October">October</option>
              <option value="July">July</option>
            </select>
            <input type="number" id="modalPipelineYear" class="form-input" value="${state.selectedYear}" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Filter Specific Client (Optional)</label>
          <select id="modalPipelineClient" class="form-select">
            <option value="">All Discovered Clients (Fan-out)</option>
            <option value="luxwood">Luxwood Hotel & Suites</option>
            <option value="the_lennox">The Lennox Luxury Apartments</option>
            <option value="the_bantree">The Bantree Residences</option>
            <option value="active_8_spintex">Active 8 Spintex</option>
            <option value="maharaja">Maharaja</option>
          </select>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" id="btnCancelPipelineModal">Cancel</button>
          <button class="btn btn-primary" id="btnExecutePipelineModal">
            <span>⚡</span> Start Ingestion Pipeline
          </button>
        </div>
      </div>
    </div>
  `;

  const backdrop = document.getElementById('pipelineModalBackdrop');
  const btnClose = document.getElementById('btnClosePipelineModal');
  const btnCancel = document.getElementById('btnCancelPipelineModal');
  const btnExecute = document.getElementById('btnExecutePipelineModal');

  const closeModal = () => backdrop.classList.remove('active');

  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  btnExecute.addEventListener('click', async () => {
    const month = document.getElementById('modalPipelineMonth').value;
    const year = parseInt(document.getElementById('modalPipelineYear').value, 10);
    const client = document.getElementById('modalPipelineClient').value;

    closeModal();
    state.addLog('info', `Dispatching OCR Ingestion Pipeline run for ${month} ${year}...`);

    try {
      const payload = {
        month,
        year,
        client_slugs: client ? [client] : null,
      };
      const res = await triggerPipeline(payload);
      state.addLog('success', `Pipeline Dispatched: ${res.message || 'Queued in Inngest'}`);
      
      // Auto refresh sheets and stats
      setTimeout(async () => {
        state.sheetsData = await fetchSheetsData(month, year);
        state.stats = await fetchStats();
        state.notify();
      }, 1500);

    } catch (e) {
      state.addLog('error', `Pipeline execution error: ${e.message}`);
      alert(`Pipeline error: ${e.message}`);
    }
  });

  window.openPipelineModal = () => {
    backdrop.classList.add('active');
  };
}
