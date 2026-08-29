/**
 * Typed REST API client for ANR Commercial Laundry Billing Engine.
 */

// Supports explicit backend base URL in production (e.g. Komodo host) or relative proxying
function resolveApiBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('ANR_API_URL');
    if (saved) return saved.replace(/\/$/, '');
    // In production on Vercel or remote host, default to backend API URL
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return 'https://autapi.service4gh.com';
    }
  }
  return '';
}

const API_BASE = resolveApiBase();

async function handleResponse(res, context = 'API request') {
  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text().catch(() => '');
    }
    throw new Error(`${context} failed (${res.status}): ${errorDetail || res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

function getAuthHeaders(additionalHeaders = {}) {
  const headers = { ...additionalHeaders };
  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('S4_AUTH_TOKEN');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

export async function requestOtp(email = 's4bookkeeping@service4gh.com') {
  const res = await fetch(`${API_BASE}/api/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res, 'Request OTP');
}

export async function verifyOtp(email, otp) {
  const res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  return handleResponse(res, 'Verify OTP');
}

export async function fetchCurrentUser() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch current user');
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse(res, 'Health check');
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Stats fetch');
}

export async function fetchConfig() {
  const res = await fetch(`${API_BASE}/api/config`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Config fetch');
}

export async function updateConfig(configData) {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(configData),
  });
  return handleResponse(res, 'Config update');
}

export async function testConnections() {
  const res = await fetch(`${API_BASE}/api/config/test`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
  });
  return handleResponse(res, 'Connection test');
}

export async function fetchSheetsData(month = 'August', year = 2026) {
  const res = await fetch(`${API_BASE}/api/sheets/data?month=${month}&year=${year}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Sheets data fetch');
}

export async function toggleApproval(payload) {
  const res = await fetch(`${API_BASE}/api/sheets/toggle-approval`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Toggle approval');
}

export async function triggerPipeline(payload = {}) {
  const res = await fetch(`${API_BASE}/api/pipeline/trigger`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Pipeline trigger');
}

export async function triggerInvoicing(payload = {}) {
  const res = await fetch(`${API_BASE}/api/invoices/generate`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Invoice generation');
}

export async function fetchCatalog() {
  const res = await fetch(`${API_BASE}/api/catalog`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Catalog fetch');
}

export async function fetchPipelineStatus() {
  const res = await fetch(`${API_BASE}/api/pipeline/status`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Pipeline status fetch');
}
