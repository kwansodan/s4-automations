/**
 * Typed REST API client for ANR Commercial Laundry Billing Engine.
 */

const API_BASE = ''; // Uses relative URLs with Vite proxy in dev or FastAPI in prod

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  if (!res.ok) throw new Error(`Stats fetch failed (${res.status})`);
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(`Config fetch failed (${res.status})`);
  return res.json();
}

export async function updateConfig(configData) {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(configData),
  });
  if (!res.ok) throw new Error(`Config update failed (${res.status})`);
  return res.json();
}

export async function testConnections() {
  const res = await fetch(`${API_BASE}/api/config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Connection test failed (${res.status})`);
  return res.json();
}

export async function fetchSheetsData(month = 'August', year = 2026) {
  const res = await fetch(`${API_BASE}/api/sheets/data?month=${month}&year=${year}`);
  if (!res.ok) throw new Error(`Sheets data fetch failed (${res.status})`);
  return res.json();
}

export async function toggleApproval(payload) {
  const res = await fetch(`${API_BASE}/api/sheets/toggle-approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Toggle approval failed (${res.status})`);
  return res.json();
}

export async function triggerPipeline(payload = {}) {
  const res = await fetch(`${API_BASE}/api/pipeline/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Pipeline trigger failed (${res.status})`);
  return res.json();
}

export async function triggerInvoicing(payload = {}) {
  const res = await fetch(`${API_BASE}/api/invoices/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Invoice generation failed (${res.status})`);
  return res.json();
}

export async function fetchCatalog() {
  const res = await fetch(`${API_BASE}/api/catalog`);
  if (!res.ok) throw new Error(`Catalog fetch failed (${res.status})`);
  return res.json();
}
