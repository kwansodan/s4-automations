/**
 * Configuration Component - View, Edit, Test, and Save all environment variables.
 */

import { state } from '../state.js';
import { updateConfig, testConnections } from '../api.js';

export function renderConfigSection(container) {
  const cfg = state.config || {};

  container.innerHTML = `
    <div class="config-container">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="font-size: 1.4rem; font-weight: 800; color: #fff;">⚙️ System & Environment Configuration</h2>
          <p style="font-size: 0.88rem; color: var(--text-muted);">
            Manage credentials, API keys, Google Service Accounts, and runtime settings directly without server restart.
          </p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button id="btnTestConnections" class="btn btn-outline">
            <span>⚡</span> Test All Connections
          </button>
          <button id="btnSaveConfig" class="btn btn-primary">
            <span>💾</span> Save & Apply Changes
          </button>
        </div>
      </div>

      <!-- Diagnostic Results Area -->
      <div id="diagResultsContainer" style="display: none;">
        <div class="card" style="border-color: var(--primary-light);">
          <div class="card-title"><span>🔍</span> Integration Connectivity Diagnostics</div>
          <div class="diag-grid" id="diagGrid"></div>
        </div>
      </div>

      <div class="config-grid">
        <!-- 1. Gemini Vision OCR -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>✨</span> Google Gemini Vision OCR</div>
            <span class="badge badge-info">AI OCR Engine</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_GEMINI_API_KEY">Gemini Developer API Key</label>
            <div class="input-wrapper">
              <input type="password" id="cfg_GEMINI_API_KEY" class="form-input" value="${cfg.GEMINI_API_KEY || ''}" placeholder="AIzaSy..." />
              <button type="button" class="btn-toggle-secret" onclick="toggleSecretVisibility('cfg_GEMINI_API_KEY')">👁️</button>
            </div>
            <span class="form-help">Developer API key for multimodal vision extraction.</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_GEMINI_MODEL">Vision Model</label>
            <select id="cfg_GEMINI_MODEL" class="form-select">
              <option value="gemini-3.6-flash" ${cfg.GEMINI_MODEL === 'gemini-3.6-flash' ? 'selected' : ''}>gemini-3.6-flash (Recommended)</option>
              <option value="gemini-2.5-flash" ${cfg.GEMINI_MODEL === 'gemini-2.5-flash' ? 'selected' : ''}>gemini-2.5-flash</option>
              <option value="gemini-1.5-flash" ${cfg.GEMINI_MODEL === 'gemini-1.5-flash' ? 'selected' : ''}>gemini-1.5-flash</option>
            </select>
          </div>
        </div>

        <!-- 2. Zoho Books API Credentials -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>📚</span> Zoho Books API Credentials</div>
            <span class="badge badge-success">Invoicing & Catalog</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_ZOHO_CLIENT_ID">OAuth2 Client ID</label>
            <input type="text" id="cfg_ZOHO_CLIENT_ID" class="form-input" value="${cfg.ZOHO_CLIENT_ID || ''}" placeholder="1000.XXXXX" />
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_ZOHO_CLIENT_SECRET">OAuth2 Client Secret</label>
            <div class="input-wrapper">
              <input type="password" id="cfg_ZOHO_CLIENT_SECRET" class="form-input" value="${cfg.ZOHO_CLIENT_SECRET || ''}" />
              <button type="button" class="btn-toggle-secret" onclick="toggleSecretVisibility('cfg_ZOHO_CLIENT_SECRET')">👁️</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_ZOHO_REFRESH_TOKEN">OAuth2 Refresh Token</label>
            <div class="input-wrapper">
              <input type="password" id="cfg_ZOHO_REFRESH_TOKEN" class="form-input" value="${cfg.ZOHO_REFRESH_TOKEN || ''}" />
              <button type="button" class="btn-toggle-secret" onclick="toggleSecretVisibility('cfg_ZOHO_REFRESH_TOKEN')">👁️</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_ZOHO_ORG_ID">Organization ID</label>
            <input type="text" id="cfg_ZOHO_ORG_ID" class="form-input" value="${cfg.ZOHO_ORG_ID || ''}" placeholder="8000XXXX" />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
            <div class="form-group">
              <label class="form-label" for="cfg_ZOHO_ACCOUNTS_URL">Accounts URL</label>
              <input type="text" id="cfg_ZOHO_ACCOUNTS_URL" class="form-input" value="${cfg.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com'}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cfg_ZOHO_BOOKS_API_URL">Books API URL</label>
              <input type="text" id="cfg_ZOHO_BOOKS_API_URL" class="form-input" value="${cfg.ZOHO_BOOKS_API_URL || 'https://www.zohoapis.com/books/v3'}" />
            </div>
          </div>
        </div>

        <!-- 3. Google Workspace (Drive & Sheets) -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>📁</span> Google Workspace (Drive & Sheets)</div>
            <span class="badge badge-info">Storage & Review</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_CONTROL_SHEETS_FOLDER_ID">Control Sheets Root Folder ID</label>
            <input type="text" id="cfg_CONTROL_SHEETS_FOLDER_ID" class="form-input" value="${cfg.CONTROL_SHEETS_FOLDER_ID || ''}" placeholder="1aB2cD3eF4gH..." />
            <span class="form-help">ID of the root 'control sheets' Google Drive folder.</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64">Service Account Key (Base64 JSON)</label>
            <textarea id="cfg_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64" class="form-textarea" placeholder="eyJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsICJwcm9qZWN0X2lkIjog...">${cfg.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ''}</textarea>
            <span class="form-help">Paste base64-encoded Service Account JSON.</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_GOOGLE_SERVICE_ACCOUNT_FILE">Or File Path</label>
            <input type="text" id="cfg_GOOGLE_SERVICE_ACCOUNT_FILE" class="form-input" value="${cfg.GOOGLE_SERVICE_ACCOUNT_FILE || ''}" placeholder="C:\\path\\to\\service_account.json" />
          </div>
        </div>

        <!-- 4. Inngest Durable Orchestration -->
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span>⚡</span> Inngest Durable Orchestration</div>
            <span class="badge badge-warning">Workflow Engine</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_INNGEST_APP_ID">Inngest App ID</label>
            <input type="text" id="cfg_INNGEST_APP_ID" class="form-input" value="${cfg.INNGEST_APP_ID || 'anr-laundry-billing'}" />
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_INNGEST_EVENT_KEY">Inngest Event Key</label>
            <div class="input-wrapper">
              <input type="password" id="cfg_INNGEST_EVENT_KEY" class="form-input" value="${cfg.INNGEST_EVENT_KEY || ''}" />
              <button type="button" class="btn-toggle-secret" onclick="toggleSecretVisibility('cfg_INNGEST_EVENT_KEY')">👁️</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_INNGEST_SIGNING_KEY">Inngest Signing Key</label>
            <div class="input-wrapper">
              <input type="password" id="cfg_INNGEST_SIGNING_KEY" class="form-input" value="${cfg.INNGEST_SIGNING_KEY || ''}" />
              <button type="button" class="btn-toggle-secret" onclick="toggleSecretVisibility('cfg_INNGEST_SIGNING_KEY')">👁️</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cfg_INNGEST_DEV_SERVER_URL">Inngest Dev Server URL (Optional)</label>
            <input type="text" id="cfg_INNGEST_DEV_SERVER_URL" class="form-input" value="${cfg.INNGEST_DEV_SERVER_URL || ''}" placeholder="http://localhost:8288" />
          </div>
        </div>

        <!-- 5. System & Mode Settings -->
        <div class="card" style="grid-column: 1 / -1;">
          <div class="card-header">
            <div class="card-title"><span>🛡️</span> System & Operational Settings</div>
            <span class="badge badge-info">Runtime Controls</span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
            <div class="form-group">
              <label class="form-label" for="cfg_NOTIFICATION_EMAIL">Notification Email</label>
              <input type="email" id="cfg_NOTIFICATION_EMAIL" class="form-input" value="${cfg.NOTIFICATION_EMAIL || 'cdanso@service4gh.com'}" />
            </div>

            <div class="form-group">
              <label class="form-label" for="cfg_ENVIRONMENT">Environment</label>
              <select id="cfg_ENVIRONMENT" class="form-select">
                <option value="development" ${cfg.ENVIRONMENT === 'development' ? 'selected' : ''}>development</option>
                <option value="staging" ${cfg.ENVIRONMENT === 'staging' ? 'selected' : ''}>staging</option>
                <option value="production" ${cfg.ENVIRONMENT === 'production' ? 'selected' : ''}>production</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="cfg_LOG_LEVEL">Log Level</label>
              <select id="cfg_LOG_LEVEL" class="form-select">
                <option value="INFO" ${cfg.LOG_LEVEL === 'INFO' ? 'selected' : ''}>INFO</option>
                <option value="DEBUG" ${cfg.LOG_LEVEL === 'DEBUG' ? 'selected' : ''}>DEBUG</option>
                <option value="WARNING" ${cfg.LOG_LEVEL === 'WARNING' ? 'selected' : ''}>WARNING</option>
                <option value="ERROR" ${cfg.LOG_LEVEL === 'ERROR' ? 'selected' : ''}>ERROR</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Mock / Dry-Run Mode</label>
              <div class="toggle-switch-wrapper">
                <span style="font-size: 0.85rem; color: var(--text-secondary);">Enable offline simulation</span>
                <input type="checkbox" id="cfg_MOCK_MODE" style="width: 20px; height: 20px; accent-color: var(--primary);" ${cfg.MOCK_MODE ? 'checked' : ''} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach window helper for toggle
  window.toggleSecretVisibility = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.type = el.type === 'password' ? 'text' : 'password';
    }
  };

  // Attach Save button listener
  document.getElementById('btnSaveConfig').addEventListener('click', async () => {
    const payload = {
      GEMINI_API_KEY: document.getElementById('cfg_GEMINI_API_KEY').value,
      GEMINI_MODEL: document.getElementById('cfg_GEMINI_MODEL').value,
      ZOHO_CLIENT_ID: document.getElementById('cfg_ZOHO_CLIENT_ID').value,
      ZOHO_CLIENT_SECRET: document.getElementById('cfg_ZOHO_CLIENT_SECRET').value,
      ZOHO_REFRESH_TOKEN: document.getElementById('cfg_ZOHO_REFRESH_TOKEN').value,
      ZOHO_ORG_ID: document.getElementById('cfg_ZOHO_ORG_ID').value,
      ZOHO_ACCOUNTS_URL: document.getElementById('cfg_ZOHO_ACCOUNTS_URL').value,
      ZOHO_BOOKS_API_URL: document.getElementById('cfg_ZOHO_BOOKS_API_URL').value,
      CONTROL_SHEETS_FOLDER_ID: document.getElementById('cfg_CONTROL_SHEETS_FOLDER_ID').value,
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: document.getElementById('cfg_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64').value,
      GOOGLE_SERVICE_ACCOUNT_FILE: document.getElementById('cfg_GOOGLE_SERVICE_ACCOUNT_FILE').value,
      INNGEST_APP_ID: document.getElementById('cfg_INNGEST_APP_ID').value,
      INNGEST_EVENT_KEY: document.getElementById('cfg_INNGEST_EVENT_KEY').value,
      INNGEST_SIGNING_KEY: document.getElementById('cfg_INNGEST_SIGNING_KEY').value,
      INNGEST_DEV_SERVER_URL: document.getElementById('cfg_INNGEST_DEV_SERVER_URL').value,
      NOTIFICATION_EMAIL: document.getElementById('cfg_NOTIFICATION_EMAIL').value,
      ENVIRONMENT: document.getElementById('cfg_ENVIRONMENT').value,
      LOG_LEVEL: document.getElementById('cfg_LOG_LEVEL').value,
      MOCK_MODE: document.getElementById('cfg_MOCK_MODE').checked,
      persist_to_file: true,
    };

    try {
      state.addLog('info', 'Saving configuration changes...');
      const res = await updateConfig(payload);
      state.config = res.config;
      state.addLog('success', 'Configuration successfully saved and applied to runtime!');
      alert('Configuration updated and saved to .env successfully!');
    } catch (e) {
      state.addLog('error', `Failed to save configuration: ${e.message}`);
      alert(`Error saving configuration: ${e.message}`);
    }
  });

  // Attach Test Connections listener
  document.getElementById('btnTestConnections').addEventListener('click', async () => {
    const diagBox = document.getElementById('diagResultsContainer');
    const diagGrid = document.getElementById('diagGrid');
    diagBox.style.display = 'block';
    diagGrid.innerHTML = '<div style="color: var(--primary-light);">Testing integration connections...</div>';

    state.addLog('info', 'Running integration connectivity diagnostics...');
    try {
      const diag = await testConnections();
      state.addLog('info', `Diagnostic outcome: Gemini=${diag.gemini_status}, Zoho=${diag.zoho_status}, Google=${diag.google_status}`);

      diagGrid.innerHTML = `
        <div class="diag-item">
          <div class="diag-header">
            <span>Gemini Vision</span>
            <span class="badge ${diag.gemini_status.includes('OK') || diag.gemini_status === 'CONNECTED' ? 'badge-success' : 'badge-danger'}">${diag.gemini_status}</span>
          </div>
          <div class="diag-desc">${diag.gemini_message || 'OK'}</div>
        </div>

        <div class="diag-item">
          <div class="diag-header">
            <span>Zoho Books</span>
            <span class="badge ${diag.zoho_status.includes('OK') || diag.zoho_status === 'CONNECTED' ? 'badge-success' : 'badge-danger'}">${diag.zoho_status}</span>
          </div>
          <div class="diag-desc">${diag.zoho_message || 'OK'}</div>
        </div>

        <div class="diag-item">
          <div class="diag-header">
            <span>Google Drive/Sheets</span>
            <span class="badge ${diag.google_status.includes('OK') || diag.google_status === 'CONNECTED' ? 'badge-success' : 'badge-danger'}">${diag.google_status}</span>
          </div>
          <div class="diag-desc">${diag.google_message || 'OK'}</div>
        </div>

        <div class="diag-item">
          <div class="diag-header">
            <span>Inngest Engine</span>
            <span class="badge ${diag.inngest_status === 'CONFIGURED' ? 'badge-success' : 'badge-warning'}">${diag.inngest_status}</span>
          </div>
          <div class="diag-desc">${diag.inngest_message || 'OK'}</div>
        </div>
      `;
    } catch (e) {
      diagGrid.innerHTML = `<div style="color: #f87171;">Diagnostic test error: ${e.message}</div>`;
      state.addLog('error', `Connection test error: ${e.message}`);
    }
  });
}
