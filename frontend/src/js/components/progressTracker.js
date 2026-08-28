/**
 * Real-time Pipeline Progress Tracker & Background Execution Monitor Component.
 */

import { state } from '../state.js';

export function renderProgressTracker(container) {
  const p = state.pipelineProgress;

  if (!p || p.status === 'IDLE') {
    container.innerHTML = `
      <div class="progress-card progress-idle">
        <div class="progress-header">
          <div class="progress-title">
            <span class="pulse-dot idle"></span>
            <span>Pipeline Engine: Standby</span>
          </div>
          <span class="badge badge-outline">Ready</span>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">
          Click <strong>Run Ingestion Pipeline</strong> or <strong>Generate Draft Invoices</strong> to process live hotel laundry slips with Gemini Flash OCR.
        </p>
      </div>
    `;
    return;
  }

  const isRunning = p.is_running || p.status === 'RUNNING';
  const isCompleted = p.status === 'COMPLETED';
  const isError = p.status === 'ERROR';

  let statusBadge = '';
  let progressThemeClass = 'progress-running';

  if (isRunning) {
    statusBadge = `<span class="badge badge-primary"><span class="pulse-dot running"></span> Live: Stage ${p.stage_index}/${p.total_stages}</span>`;
    progressThemeClass = 'progress-running';
  } else if (isCompleted) {
    statusBadge = `<span class="badge badge-success">✅ Completed (${p.elapsed_seconds}s)</span>`;
    progressThemeClass = 'progress-completed';
  } else if (isError) {
    statusBadge = `<span class="badge badge-danger">❌ Error</span>`;
    progressThemeClass = 'progress-error';
  }

  const percent = p.percent || 0;
  const stats = p.stats || {};
  const currentStep = p.current_step || 'Processing...';

  container.innerHTML = `
    <div class="progress-card ${progressThemeClass}">
      <div class="progress-header">
        <div class="progress-title">
          <span>${isRunning ? '⚡' : isCompleted ? '🎉' : '⚠️'}</span>
          <span>${p.task_name || 'Daily Pipeline'}</span>
          <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 500;">
            (${p.month} ${p.year})
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          ${statusBadge}
          <span style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: #ffffff;">
            ${percent}%
          </span>
        </div>
      </div>

      <!-- Animated Glowing Progress Bar -->
      <div class="progress-track">
        <div class="progress-fill ${isRunning ? 'shimmer' : ''}" style="width: ${percent}%;"></div>
      </div>

      <!-- Current Step Description -->
      <div class="progress-step-desc">
        ${isRunning ? '<span class="spinner-sm"></span>' : ''}
        <span>${currentStep}</span>
      </div>

      <!-- Live Real-Time Telemetry Counters -->
      <div class="progress-stats-grid">
        <div class="progress-stat-pill">
          <span class="stat-label">📁 Clients</span>
          <span class="stat-val">${stats.clients_done || 0} / ${stats.clients_total || 0}</span>
        </div>
        <div class="progress-stat-pill">
          <span class="stat-label">🧾 Slips Read</span>
          <span class="stat-val">${stats.slips_processed || 0}</span>
        </div>
        <div class="progress-stat-pill">
          <span class="stat-label">📦 Items Extracted</span>
          <span class="stat-val">${stats.items_extracted || 0}</span>
        </div>
        <div class="progress-stat-pill">
          <span class="stat-label">⚠️ Linen Losses</span>
          <span class="stat-val ${stats.loss_discrepancies > 0 ? 'text-warning' : ''}">${stats.loss_discrepancies || 0} pcs</span>
        </div>
        <div class="progress-stat-pill">
          <span class="stat-label">⏱️ Elapsed Time</span>
          <span class="stat-val font-mono">${p.elapsed_seconds || 0}s</span>
        </div>
      </div>

      ${
        isCompleted && p.last_result?.spreadsheet_url
          ? `
        <div style="margin-top: 1rem; display: flex; justify-content: flex-end;">
          <a href="${p.last_result.spreadsheet_url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">
            <span>📊</span> Open Updated Google Sheet ↗
          </a>
        </div>
      `
          : ''
      }
    </div>
  `;
}
