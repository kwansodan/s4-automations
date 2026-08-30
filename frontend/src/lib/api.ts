/**
 * Typed REST API client for S4 Accounting Automations Suite.
 * Built with dual-layer resilient fallback (Relative Proxy -> Direct Backend).
 */

import type { OtpRequestResponse, OtpVerifyResponse, AuthUser } from '../types/auth';
import type { DashboardStats, PipelineProgress } from '../types/pipeline';
import type { SheetsReviewData } from '../types/sheets';
import type { ZohoCatalogData } from '../types/zoho';
import type { SystemConfig, DiagnosticsResult } from '../types/config';

const DIRECT_BACKEND_URL = 'https://autapi.service4gh.com';

function resolveApiBase(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('S4_API_URL');
    if (saved) return saved.replace(/\/$/, '');
  }
  return '';
}

const API_BASE = resolveApiBase();

function getAuthHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...additionalHeaders };
  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('S4_AUTH_TOKEN');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

/**
 * Builds the ordered list of URLs to try for a given path.
 *
 * Both directions matter, so the fallback is bidirectional:
 *  - An absolute base (VITE_API_URL / S4_API_URL) fails when the client's DNS resolver
 *    hijacks or sinkholes the backend host, while the same-origin proxy still works
 *    because the rewrite is resolved server-side.
 *  - A relative base fails when no proxy sits in front of the app, while the direct
 *    backend is reachable.
 */
function buildCandidateUrls(path: string): string[] {
  const candidates = [`${API_BASE}${path}`];

  // If we started from an absolute base, retry through the same-origin proxy.
  if (API_BASE) candidates.push(path);

  // Always keep the known production backend as a last resort.
  candidates.push(`${DIRECT_BACKEND_URL}${path}`);

  return candidates.filter((url, i) => Boolean(url) && candidates.indexOf(url) === i);
}

function describeHost(url: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    return new URL(url, base).host;
  } catch {
    return url;
  }
}

/**
 * Fetch with bidirectional fallback across every candidate URL.
 *
 * Only network-layer rejections are retried. A `fetch` promise rejects when the request
 * never completes (offline, DNS failure, TLS interception, blocked CORS preflight); HTTP
 * error statuses resolve normally and are handed straight to `handleResponse`.
 */
async function resilientFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const candidates = buildCandidateUrls(path);
  const failedHosts: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    console.info(`📡 [S4 API] ${i === 0 ? 'Fetching' : `Fallback ${i} fetching`}: ${url}`);
    try {
      return await fetch(url, options);
    } catch (err: any) {
      failedHosts.push(describeHost(url));
      console.warn(`⚠️ [S4 API] ${url} failed at the network layer (${err?.message || err}).`);
    }
  }

  throw new Error(
    `Cannot reach the S4 backend — tried ${failedHosts.join(', ')}. ` +
      `The request never left the browser, so this is not a server error. ` +
      `Likely causes: no internet connection, a DNS block or captive portal on this network, ` +
      `or TLS interception presenting an untrusted certificate for the API host.`
  );
}

async function handleResponse<T>(res: Response, context = 'API request'): Promise<T> {
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
    return res.json() as Promise<T>;
  }
  return (await res.text()) as unknown as T;
}

// -------------------------------------------------------------------------
// Auth API Endpoints
// -------------------------------------------------------------------------

export async function requestOtpApi(email: string): Promise<OtpRequestResponse> {
  const res = await resilientFetch('/api/auth/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse<OtpRequestResponse>(res, 'Request OTP');
}

export async function verifyOtpApi(email: string, otp: string): Promise<OtpVerifyResponse> {
  const res = await resilientFetch('/api/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  return handleResponse<OtpVerifyResponse>(res, 'Verify OTP');
}

export async function fetchCurrentUser(): Promise<{ authenticated: boolean; user: AuthUser }> {
  const res = await resilientFetch('/api/auth/me', {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ authenticated: boolean; user: AuthUser }>(res, 'Fetch current user');
}

// -------------------------------------------------------------------------
// Dashboard & Pipeline Endpoints
// -------------------------------------------------------------------------

export async function fetchHealth(): Promise<{ status: string; service: string; mock_mode: boolean }> {
  const res = await resilientFetch('/health');
  return handleResponse<{ status: string; service: string; mock_mode: boolean }>(res, 'Health check');
}

export async function fetchPipelineStats(): Promise<DashboardStats> {
  const res = await resilientFetch('/api/pipeline/stats', {
    headers: getAuthHeaders(),
  });
  return handleResponse<DashboardStats>(res, 'Fetch pipeline stats');
}

export async function fetchPipelineProgress(): Promise<PipelineProgress> {
  const res = await resilientFetch('/api/pipeline/progress', {
    headers: getAuthHeaders(),
  });
  return handleResponse<PipelineProgress>(res, 'Fetch pipeline progress');
}

export async function triggerDailyBillingPipeline(dryRun = false): Promise<{ message: string; event_id: string }> {
  const res = await resilientFetch('/api/pipeline/trigger', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  return handleResponse<{ message: string; event_id: string }>(res, 'Trigger pipeline');
}

export async function triggerZohoInvoiceBatch(dryRun = false): Promise<{ message: string; event_id: string }> {
  const res = await resilientFetch('/api/pipeline/trigger-invoices', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  return handleResponse<{ message: string; event_id: string }>(res, 'Trigger invoice batch');
}

// -------------------------------------------------------------------------
// Sheets Review Data Endpoints
// -------------------------------------------------------------------------

export async function fetchSheetsReviewData(): Promise<SheetsReviewData> {
  const res = await resilientFetch('/api/sheets/review-data', {
    headers: getAuthHeaders(),
  });
  return handleResponse<SheetsReviewData>(res, 'Fetch sheets review data');
}

export async function updateTransactionStatus(
  transactionId: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MODIFIED',
  notes?: string
): Promise<{ success: boolean; message: string }> {
  const res = await resilientFetch(`/api/sheets/transactions/${transactionId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status, notes }),
  });
  return handleResponse<{ success: boolean; message: string }>(res, 'Update transaction status');
}

// -------------------------------------------------------------------------
// Zoho Catalog Endpoints
// -------------------------------------------------------------------------

export async function fetchZohoCatalog(organizationId?: string): Promise<ZohoCatalogData> {
  const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
  const res = await resilientFetch(`/api/zoho/catalog${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ZohoCatalogData>(res, 'Fetch Zoho catalog');
}

// -------------------------------------------------------------------------
// Configuration & Diagnostics Endpoints
// -------------------------------------------------------------------------

export async function fetchSystemConfig(): Promise<SystemConfig> {
  const res = await resilientFetch('/api/config', {
    headers: getAuthHeaders(),
  });
  return handleResponse<SystemConfig>(res, 'Fetch system config');
}

export async function runDiagnostics(): Promise<DiagnosticsResult> {
  const res = await resilientFetch('/api/config/diagnostics', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<DiagnosticsResult>(res, 'Run diagnostics');
}

// -------------------------------------------------------------------------
// Multi-Client API Endpoints
// -------------------------------------------------------------------------

export async function fetchClients(): Promise<any[]> {
  const res = await resilientFetch('/api/clients', {
    headers: getAuthHeaders(),
  });
  return handleResponse<any[]>(res, 'Fetch clients');
}

export async function createClient(payload: any): Promise<any> {
  const res = await resilientFetch('/api/clients', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res, 'Create new client');
}

export async function fetchClientById(clientId: string): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<any>(res, `Fetch client ${clientId}`);
}

export async function runClientStrategy(clientId: string, dryRun = false): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/run`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  return handleResponse<any>(res, `Run strategy for ${clientId}`);
}

export async function fetchClientConfig(clientId: string): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/config`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<any>(res, `Fetch configuration for ${clientId}`);
}

export async function saveClientConfig(clientId: string, payload: any): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/config`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res, `Save configuration for ${clientId}`);
}

export async function updateClientIngestion(clientId: string, payload: { source_type: string; folder_id?: string; source_email?: string; source_config?: any }): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/ingestion`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res, `Update ingestion for ${clientId}`);
}

export async function testClientIngestion(clientId: string): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/ingestion/test`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<any>(res, `Test ingestion for ${clientId}`);
}

export async function probeExternalConnection(payload: {
  source_type: string;
  folder_id?: string;
  source_email?: string;
  zoho_org_id?: string;
  zoho_contact_id?: string;
  source_config?: any;
}): Promise<any> {
  const res = await resilientFetch('/api/clients/probe-external', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res, 'Probe external connection');
}

export async function dryRunSampleOcr(payload: {
  engine_type: string;
  sample_preset?: string;
  sample_image_base64?: string;
}): Promise<any> {
  const res = await resilientFetch('/api/clients/dry-run-ocr', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res, 'Execute dry-run OCR extraction');
}

export async function fetchClientTransactions(clientId: string, status?: string): Promise<any[]> {
  const query = status ? `?status=${status}` : '';
  const res = await resilientFetch(`/api/clients/${clientId}/transactions${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<any[]>(res, `Fetch transactions for ${clientId}`);
}

export async function batchApproveTransactions(clientId: string, transactionIds: number[], notes?: string): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/transactions/batch-approve`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ transaction_ids: transactionIds, notes }),
  });
  return handleResponse<any>(res, `Batch approve transactions for ${clientId}`);
}

export async function fetchAuditLogs(limit = 50, clientId?: string): Promise<any[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (clientId) params.append('client_id', clientId);
  const res = await resilientFetch(`/api/audit?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<any[]>(res, 'Fetch audit logs');
}

// -------------------------------------------------------------------------
// Component Aliases & Compatibility Exports
// -------------------------------------------------------------------------

export async function fetchStats(month?: string, year?: number): Promise<DashboardStats> {
  const query = month && year ? `?month=${month}&year=${year}` : '';
  const res = await resilientFetch(`/api/pipeline/stats${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<DashboardStats>(res, 'Fetch stats');
}

export async function fetchConfig(): Promise<{ status: string; config: any }> {
  const res = await resilientFetch('/api/config', {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ status: string; config: any }>(res, 'Fetch config');
}

export async function fetchSheetsData(month?: string, year?: number): Promise<SheetsReviewData> {
  const query = month && year ? `?month=${month}&year=${year}` : '';
  const res = await resilientFetch(`/api/sheets/review-data${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<SheetsReviewData>(res, 'Fetch sheets data');
}

export const fetchCatalog = fetchZohoCatalog;
export const fetchPipelineStatus = fetchPipelineProgress;
export const testConnections = runDiagnostics;

export async function triggerPipeline(payload?: any): Promise<{ message: string; event_id: string }> {
  const isDryRun = typeof payload === 'boolean' ? payload : Boolean(payload?.dry_run);
  const body = typeof payload === 'object' ? payload : { dry_run: isDryRun };
  const res = await resilientFetch('/api/pipeline/trigger', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handleResponse<{ message: string; event_id: string }>(res, 'Trigger pipeline');
}

export async function triggerInvoicing(payload?: any): Promise<{ message: string; event_id: string }> {
  const isDryRun = typeof payload === 'boolean' ? payload : Boolean(payload?.dry_run);
  const body = typeof payload === 'object' ? payload : { dry_run: isDryRun };
  const res = await resilientFetch('/api/pipeline/trigger-invoices', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return handleResponse<{ message: string; event_id: string }>(res, 'Trigger invoicing');
}

export async function toggleApproval(payloadOrId: any, approved?: boolean): Promise<{ success: boolean; message: string }> {
  if (typeof payloadOrId === 'string') {
    return updateTransactionStatus(payloadOrId, approved ? 'APPROVED' : 'PENDING');
  }
  const res = await resilientFetch('/api/sheets/toggle-approval', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payloadOrId),
  });
  return handleResponse<{ success: boolean; message: string }>(res, 'Toggle approval');
}

export async function updateConfig(newConfig: Record<string, any>): Promise<{ success: boolean; message: string; config: any }> {
  const res = await resilientFetch('/api/config', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(newConfig),
  });
  return handleResponse<{ success: boolean; message: string; config: any }>(res, 'Update config');
}


