/**
 * Real-time Streaming Logs & Diagnostic Console Component.
 */

import { state } from '../state.js';

export function renderLiveConsole(container) {
  const logs = state.logs || [];

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title"><span>🖥️</span> Live Pipeline & Execution Console</div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btnClearLogs" class="btn btn-outline btn-sm">Clear</button>
        </div>
      </div>

      <div class="console-wrapper" id="consoleOutput">
        ${
          logs.length === 0
            ? `<div style="color: var(--text-muted);">No logs yet. Execute a task to see live events.</div>`
            : logs
                .map(
                  (l) => `
          <div class="log-entry">
            <span class="log-time">[${l.time}]</span>
            <span class="log-${l.type}">${l.message}</span>
          </div>
        `
                )
                .join('')
        }
      </div>
    </div>
  `;

  const btnClear = document.getElementById('btnClearLogs');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      state.logs = [];
      state.notify();
    });
  }
}
