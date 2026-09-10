/**
 * Typed REST API client for S4 Accounting Automations Suite.
 * Built with dual-layer resilient fallback (Relative Proxy -> Direct Backend).
 */

import type { OtpRequestResponse, OtpVerifyResponse, AuthUser } from '../types/auth';
import type { DashboardStats, PipelineProgress } from '../types/pipeline';
import type { SheetsReviewData } from '../types/sheets';
import type { ZohoCatalogData } from '../types/zoho';
import type { SystemConfig, DiagnosticsResult } from '../types/config';
import type { PipelineSimulationResult } from '../types/client';

const DIRECT_BACKEND_URL = 'https://autapi.service4gh.com';

function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('S4_API_URL');
      if (saved) {
        const clean = saved.replace(/\/$/, '');
        // Purge dummy or unresolvable placeholder hosts stored from earlier templates
        if (clean.includes('yourdomain.com') || clean.includes('example.com') || clean.includes('localhost:8000')) {
          localStorage.removeItem('S4_API_URL');
        } else {
          return clean;
        }
      }
    } catch {
      // Ignore localStorage access restrictions
    }
  }

  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    const envUrl = import.meta.env.VITE_API_URL.replace(/\/$/, '');
    if (!envUrl.includes('yourdomain.com') && !envUrl.includes('example.com')) {
      return envUrl;
    }
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

export class ApiError extends Error {
  status: number;
  statusText: string;
  url: string;
  method: string;
  requestPayload?: any;
  responseData?: any;
  traceback?: string;
  errorType?: string;
  troubleshootingHint?: string;

  constructor({
    message,
    status,
    statusText,
    url,
    method,
    requestPayload,
    responseData,
    traceback,
    errorType,
    troubleshootingHint,
  }: {
    message: string;
    status: number;
    statusText: string;
    url: string;
    method: string;
    requestPayload?: any;
    responseData?: any;
    traceback?: string;
    errorType?: string;
    troubleshootingHint?: string;
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.method = method;
    this.requestPayload = requestPayload;
    this.responseData = responseData;
    this.traceback = traceback;
    this.errorType = errorType;
    this.troubleshootingHint = troubleshootingHint;
  }
}

/**
 * Fetch with bidirectional fallback across every candidate URL with telemetry.
 */
async function resilientFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const candidates = buildCandidateUrls(path);
  const failedHosts: string[] = [];

  // Normalize headers and guarantee Content-Type for JSON payloads
  const headersRecord: Record<string, string> = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => {
        headersRecord[k] = v;
      });
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([k, v]) => {
        headersRecord[k] = v;
      });
    } else {
      Object.assign(headersRecord, options.headers);
    }
  }

  const hasContentType = Object.keys(headersRecord).some(
    (k) => k.toLowerCase() === 'content-type'
  );
  if (
    !hasContentType &&
    typeof options.body === 'string' &&
    (options.body.trim().startsWith('{') || options.body.trim().startsWith('['))
  ) {
    headersRecord['Content-Type'] = 'application/json';
  }

  const effectiveOptions: RequestInit = {
    ...options,
    headers: headersRecord,
  };

  let requestBodyParsed: any = undefined;
  if (options.body && typeof options.body === 'string') {
    try {
      requestBodyParsed = JSON.parse(options.body);
    } catch {
      requestBodyParsed = options.body;
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    const candidateStart = performance.now();
    try {
      const response = await fetch(url, effectiveOptions);
      const durationMs = Math.round(performance.now() - candidateStart);

      // Report to in-app Network Inspector
      if (typeof window !== 'undefined' && (window as any).__S4_REPORT_NETWORK__) {
        (window as any).__S4_REPORT_NETWORK__({
          id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          timestamp: new Date().toISOString(),
          timeDisplay: new Date().toLocaleTimeString(),
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          requestBody: requestBodyParsed,
          isError: !response.ok,
        });
      }

      return response;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - candidateStart);
      failedHosts.push(describeHost(url));
      console.warn(`⚠️ [S4 API] ${url} failed at the network layer (${err?.message || err}).`);

      if (typeof window !== 'undefined' && (window as any).__S4_REPORT_NETWORK__) {
        (window as any).__S4_REPORT_NETWORK__({
          id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          timestamp: new Date().toISOString(),
          timeDisplay: new Date().toLocaleTimeString(),
          method,
          url,
          status: 0,
          statusText: 'Network Failed',
          durationMs,
          requestBody: requestBodyParsed,
          isError: true,
          errorMsg: err?.message || String(err),
        });
      }
    }
  }

  const networkErrMessage = `Cannot reach S4 backend — tried ${failedHosts.join(', ')}. The browser network request could not complete.`;

  if (typeof window !== 'undefined' && (window as any).__S4_REPORT_ERROR__) {
    (window as any).__S4_REPORT_ERROR__({
      severity: 'critical',
      category: 'network',
      title: `Network Failure: ${method} ${path}`,
      message: networkErrMessage,
      endpoint: path,
      method,
      requestPayload: requestBodyParsed,
      troubleshootingHint: 'Verify the FastAPI backend is running on port 8000 and CORS allows requests from this origin.',
    });
  }

  throw new ApiError({
    message: networkErrMessage,
    status: 0,
    statusText: 'Network Refused',
    url: path,
    method,
    requestPayload: requestBodyParsed,
    troubleshootingHint: 'Check if backend server is running and reachable.',
  });
}

async function handleResponse<T>(res: Response, context = 'API request', payload?: any): Promise<T> {
  const method = res.url ? 'HTTP' : 'API';
  if (!res.ok) {
    let errorDetail = '';
    let responseJson: any = null;
    let traceback: string | undefined = undefined;
    let errorType = 'HttpError';
    let formattedErrors: string[] = [];

    try {
      responseJson = await res.json();
      errorDetail = responseJson.message || responseJson.detail || JSON.stringify(responseJson);
      traceback = responseJson.traceback;
      errorType = responseJson.error_type || errorType;
      if (Array.isArray(responseJson.formatted_errors)) {
        formattedErrors = responseJson.formatted_errors;
      } else if (Array.isArray(responseJson.detail)) {
        formattedErrors = responseJson.detail.map((d: any) => `[${(d.loc || []).join('.')}]: ${d.msg}`);
      }
    } catch {
      errorDetail = await res.text().catch(() => '');
    }

    let hint = 'Review the detailed error response and request payload below.';
    if (res.status === 401 || res.status === 403) {
      hint = 'Authentication or authorization failed. Check your API keys, OAuth tokens, or Service Account permissions.';
    } else if (res.status === 404) {
      hint = 'Resource or endpoint not found. Verify the client ID, date, or folder path.';
    } else if (res.status === 422) {
      hint = formattedErrors.length ? `Schema validation failed: ${formattedErrors.join(', ')}` : 'Payload failed field validation.';
    } else if (res.status >= 500) {
      hint = 'Server exception occurred. Inspect the Python traceback below to pinpoint the failing line in the backend.';
    }

    const fullMessage = `${context} failed (${res.status}): ${errorDetail || res.statusText}`;

    // Auto-report to in-app ErrorContext & pop notification
    if (typeof window !== 'undefined' && (window as any).__S4_REPORT_ERROR__) {
      (window as any).__S4_REPORT_ERROR__({
        severity: res.status >= 500 ? 'critical' : res.status === 422 ? 'warning' : 'error',
        category: res.status === 422 ? 'validation' : 'api',
        title: `${context} Error (${res.status} ${res.statusText})`,
        message: fullMessage,
        status: res.status,
        endpoint: res.url,
        method,
        requestPayload: payload,
        responseData: responseJson || errorDetail,
        traceback,
        troubleshootingHint: hint,
      });
    }

    throw new ApiError({
      message: fullMessage,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      method,
      requestPayload: payload,
      responseData: responseJson || errorDetail,
      traceback,
      errorType,
      troubleshootingHint: hint,
    });
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

export async function switchActiveOrganization(organizationId: string): Promise<{ success: boolean; message: string; user: AuthUser }> {
  const res = await resilientFetch('/api/auth/switch-org', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ organization_id: organizationId }),
  });
  return handleResponse<{ success: boolean; message: string; user: AuthUser }>(res, 'Switch organization context');
}

export async function fetchUserOrganizations(): Promise<{ organizations: any[]; current_organization: any }> {
  const res = await resilientFetch('/api/auth/organizations', {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ organizations: any[]; current_organization: any }>(res, 'Fetch user organizations');
}

// -------------------------------------------------------------------------
// Dashboard & Pipeline Endpoints
// -------------------------------------------------------------------------

export async function fetchHealth(): Promise<{ status: string; service: string; mock_mode: boolean }> {
  const res = await resilientFetch('/health');
  return handleResponse<{ status: string; service: string; mock_mode: boolean }>(res, 'Health check');
}

export async function fetchPipelineStats(month?: string, year?: number): Promise<DashboardStats> {
  return fetchStats(month, year);
}


export async function fetchPipelineProgress(): Promise<PipelineProgress> {
  let res = await resilientFetch('/api/pipeline/progress', {
    headers: getAuthHeaders(),
  });
  if (res.status === 404) {
    res = await resilientFetch('/api/pipeline/status', {
      headers: getAuthHeaders(),
    });
  }
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
  const res = await resilientFetch('/api/sheets/data', {
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
// Multi-Platform Accounting Catalog Endpoints
// -------------------------------------------------------------------------

export async function fetchAccountingCatalog(software = 'zoho_books', orgId?: string, config?: any): Promise<any> {
  const res = await resilientFetch('/api/clients/accounting/fetch-catalog', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      software,
      org_id: orgId || undefined,
      config: config || {},
    }),
  });
  return handleResponse<any>(res, `Fetch catalog for ${software}`);
}

export async function fetchZohoCatalog(organizationId?: string): Promise<any> {
  return fetchAccountingCatalog('zoho_books', organizationId);
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
  let res = await resilientFetch('/api/config/test', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (res.status === 404) {
    res = await resilientFetch('/api/config/diagnostics', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  }
  return handleResponse<DiagnosticsResult>(res, 'Run diagnostics');
}

// -------------------------------------------------------------------------
// Multi-Client API Endpoints
// -------------------------------------------------------------------------

export async function fetchClients(organizationId?: string): Promise<any[]> {
  const query = (organizationId && organizationId !== 's4_advisory')
    ? `?organization_id=${encodeURIComponent(organizationId)}`
    : '';
  const res = await resilientFetch(`/api/clients${query}`, {
    headers: getAuthHeaders(),
  });
  let data = await handleResponse<any[]>(res, 'Fetch clients');

  // Fallback: if filtered query returned empty, fetch all clients
  if ((!data || data.length === 0) && query) {
    try {
      const fallbackRes = await resilientFetch('/api/clients', { headers: getAuthHeaders() });
      const fallbackData = await handleResponse<any[]>(fallbackRes, 'Fetch all clients fallback');
      if (Array.isArray(fallbackData) && fallbackData.length > 0) {
        return fallbackData;
      }
    } catch (e) {
      console.warn('Fallback fetching all clients failed:', e);
    }
  }

  return data || [];
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

export async function fetchClientPipelines(clientId: string): Promise<any[]> {
  const res = await resilientFetch(`/api/clients/${clientId}/pipelines`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<any[]>(res, `Fetch pipelines for ${clientId}`);
}

export async function saveClientPipeline(clientId: string, pipelineData: any): Promise<any[]> {
  const res = await resilientFetch(`/api/clients/${clientId}/pipelines`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(pipelineData),
  });
  return handleResponse<any[]>(res, `Save pipeline for ${clientId}`);
}

export async function deleteClientPipeline(clientId: string, pipelineId: string): Promise<any[]> {
  const res = await resilientFetch(`/api/clients/${clientId}/pipelines/${pipelineId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<any[]>(res, `Delete pipeline ${pipelineId} for ${clientId}`);
}

export async function triggerClientPipeline(clientId: string, pipelineId: string, payload?: any): Promise<any> {
  const res = await resilientFetch(`/api/clients/${clientId}/pipelines/${pipelineId}/trigger`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  });
  return handleResponse<any>(res, `Trigger pipeline ${pipelineId} for ${clientId}`);
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
  let res = await resilientFetch(`/api/pipeline/stats${query}`, {
    headers: getAuthHeaders(),
  });
  if (res.status === 404) {
    res = await resilientFetch(`/api/config/stats${query}`, {
      headers: getAuthHeaders(),
    });
  }
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
  const res = await resilientFetch(`/api/sheets/data${query}`, {
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
  const res = await resilientFetch('/api/invoices/generate', {
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

// -------------------------------------------------------------------------
// Accounts Payable (AP) & Bank Statement Upload
// -------------------------------------------------------------------------

export async function mapBankTransaction(txId: number, mappedAccountId: string): Promise<any> {
  const res = await resilientFetch(`/api/v1/bank/transactions/${txId}/map`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapped_account_id: mappedAccountId }),
  });
  return handleResponse<any>(res, 'Map bank transaction');
}

export async function uploadBankStatement(clientId: string, file: File, month?: string, year?: number): Promise<any> {
  const formData = new FormData();
  formData.append('client_id', clientId);
  if (month) formData.append('month', month);
  if (year) formData.append('year', year.toString());
  formData.append('file', file);

  const res = await resilientFetch('/api/v1/bank/upload', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  return handleResponse<any>(res, 'Upload bank statement');
}

export async function triggerApPipeline(payload: { month: string; year: number; client_id: string; auto_post_draft?: boolean }): Promise<any> {
  const res = await resilientFetch('/api/pipeline/trigger', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      ...payload,
      event_name: 'app/ap.pipeline.trigger',
    }),
  });
  return handleResponse<any>(res, 'Trigger AP pipeline');
}

export async function simulatePipelineExtraction(formData: FormData): Promise<PipelineSimulationResult> {
  const res = await resilientFetch('/api/v1/pipeline/simulate', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  return handleResponse<PipelineSimulationResult>(res, 'Simulate pipeline extraction');
}

export async function deleteClient(clientId: string): Promise<{ success: boolean; message: string }> {
  const res = await resilientFetch(`/api/v1/clients/${clientId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ success: boolean; message: string }>(res, 'Delete organisation');
}

export async function deletePipeline(clientId: string, pipelineId: string): Promise<{ success: boolean; message: string; remaining_pipelines_count: number }> {
  const res = await resilientFetch(`/api/v1/clients/${clientId}/pipelines/${pipelineId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ success: boolean; message: string; remaining_pipelines_count: number }>(res, 'Delete pipeline stream');
}

// ---------------------------------------------------------------------------
// Bank Transactions & Information Requests API
// ---------------------------------------------------------------------------

export async function fetchBankTransactions(
  clientId: string,
  status: string = 'ALL',
  search?: string
): Promise<{
  client_id: string;
  metrics: {
    total_count: number;
    total_uncategorized: number;
    total_pending_client: number;
    total_client_answered: number;
    total_mapped: number;
  };
  transactions: any[];
}> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (search) params.append('search', search);

  const res = await resilientFetch(`/api/v1/bank/clients/${clientId}/transactions?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch bank transactions');
}

export async function fetchChartOfAccounts(clientId: string): Promise<{
  client_id: string;
  accounting_software: string;
  oauth_pending?: boolean;
  message?: string;
  watched_accounts: string[];
  accounts: any[];
  accounts_count: number;
}> {
  const res = await resilientFetch(`/api/v1/bank/clients/${clientId}/accounts`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch Chart of Accounts');
}

export async function updateWatchedAccounts(clientId: string, watchedAccounts: string[]): Promise<{ success: boolean; watched_accounts: string[]; message: string }> {
  const res = await resilientFetch(`/api/v1/bank/clients/${clientId}/watched-accounts`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ watched_accounts: watchedAccounts }),
  });
  return handleResponse(res, 'Update watched accounts');
}

export async function categorizeBankTransaction(
  txId: number,
  payload: {
    mapped_account_id: string;
    mapped_account_name?: string;
    payee_name?: string;
    tax_rate?: string;
    post_to_accounting?: boolean;
  }
): Promise<{ success: boolean; transaction: any; message: string }> {
  const res = await resilientFetch(`/api/v1/bank/transactions/${txId}/categorize`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Categorize bank transaction');
}

export async function queryBankTransaction(
  txId: number,
  payload: {
    query_text: string;
    recipient_email?: string;
    send_immediately?: boolean;
  }
): Promise<{ success: boolean; transaction: any; magic_url: string; recipient_email?: string; message: string }> {
  const res = await resilientFetch(`/api/v1/bank/transactions/${txId}/query`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Query bank transaction');
}

export async function bulkCategorizeBankTransactions(payload: {
  transaction_ids: number[];
  mapped_account_id: string;
  mapped_account_name?: string;
  payee_name?: string;
  tax_rate?: string;
}): Promise<{ success: boolean; categorized_count: number; message: string }> {
  const res = await resilientFetch('/api/v1/bank/transactions/bulk-categorize', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Bulk categorize transactions');
}

export async function bulkQueryBankTransactions(payload: {
  transaction_ids: number[];
  query_text: string;
  recipient_email?: string;
}): Promise<{ success: boolean; queried_count: number; magic_url: string; message: string }> {
  const res = await resilientFetch('/api/v1/bank/transactions/bulk-query', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Bulk query transactions');
}

export async function syncBankFeedsFromAccounting(clientId: string): Promise<{ success: boolean; synced_new_count: number; message: string }> {
  const res = await resilientFetch(`/api/v1/bank/clients/${clientId}/sync-accounting`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Sync bank feeds from accounting platform');
}

export async function verifyPortalMagicToken(token: string): Promise<{
  success: boolean;
  token: string;
  client: { id: string; name: string };
  target_tx_id?: number;
}> {
  const res = await resilientFetch(`/api/v1/portal/magic-access?token=${encodeURIComponent(token)}`);
  return handleResponse(res, 'Verify portal magic token');
}

export async function submitPortalExplanation(
  txId: number,
  sessionToken: string,
  payload: {
    client_explanation: string;
    client_attachments?: any[];
  }
): Promise<{ success: boolean; transaction: any }> {
  const res = await resilientFetch(`/api/v1/portal/transactions/${txId}/explain`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Submit portal explanation');
}

// ---------------------------------------------------------------------------
// 1-Click Multi-Tenant OAuth2 Connection Engine (Zoho, QuickBooks, Xero)
// ---------------------------------------------------------------------------

export type SupportedAccountingPlatform = 'zoho_books' | 'quickbooks_online' | 'xero';

export interface AccountingOAuthAuthorizeUrlResponse {
  platform: string;
  authorize_url: string;
  client_id: string;
  redirect_uri: string;
  app_client_id?: string;
  accounts_url?: string;
  recommended_redirect_uris?: string[];
}

export interface AccountingOAuthStatusResponse {
  platform: string;
  is_connected: boolean;
  org_id?: string;
  org_name?: string;
  connected_at?: string;
  details?: Record<string, any>;
}

export type ZohoOAuthAuthorizeUrlResponse = AccountingOAuthAuthorizeUrlResponse;
export type ZohoOAuthStatusResponse = AccountingOAuthStatusResponse;

function normalizePlatformPrefix(platform: string): string {
  if (platform.includes('quickbooks')) return 'quickbooks';
  if (platform.includes('xero')) return 'xero';
  return 'zoho';
}

export async function getAccountingOAuthAuthorizeUrl(
  platform: string,
  clientId: string,
  redirectUri?: string
): Promise<AccountingOAuthAuthorizeUrlResponse> {
  const prefix = normalizePlatformPrefix(platform);
  const query = new URLSearchParams({ client_id: clientId });
  if (redirectUri && redirectUri.trim()) {
    query.append('redirect_uri', redirectUri.trim());
  }
  const res = await resilientFetch(`/api/v1/oauth/${prefix}/authorize-url?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<AccountingOAuthAuthorizeUrlResponse>(res, `Get ${platform} OAuth Authorize URL`);
}

export async function getAccountingOAuthStatus(
  platform: string,
  clientId: string
): Promise<AccountingOAuthStatusResponse> {
  const prefix = normalizePlatformPrefix(platform);
  const res = await resilientFetch(`/api/v1/oauth/${prefix}/status?client_id=${encodeURIComponent(clientId)}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<AccountingOAuthStatusResponse>(res, `Get ${platform} OAuth Status`);
}

export async function disconnectAccountingOAuth(
  platform: string,
  clientId: string
): Promise<{ success: boolean; message: string }> {
  const prefix = normalizePlatformPrefix(platform);
  const res = await resilientFetch(`/api/v1/oauth/${prefix}/disconnect?client_id=${encodeURIComponent(clientId)}`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ success: boolean; message: string }>(res, `Disconnect ${platform} OAuth`);
}

// Backwards-compatible aliases
export const getZohoAuthorizeUrl = (clientId: string) => getAccountingOAuthAuthorizeUrl('zoho_books', clientId);
export const getZohoOAuthStatus = (clientId: string) => getAccountingOAuthStatus('zoho_books', clientId);
export const disconnectZohoOAuth = (clientId: string) => disconnectAccountingOAuth('zoho_books', clientId);

// -------------------------------------------------------------------------
// System Diagnostics & Server Log Streaming API
// -------------------------------------------------------------------------

export async function fetchServerLogsApi(
  level?: string,
  limit = 100,
  search?: string
): Promise<{ status: string; total_returned: number; capacity: number; logs: any[] }> {
  const params = new URLSearchParams();
  if (level && level !== 'ALL') params.append('level', level);
  if (limit) params.append('limit', String(limit));
  if (search) params.append('search', search);

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const res = await resilientFetch(`/api/v1/system/logs${queryStr}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch Server Logs');
}

export async function fetchServerErrorsApi(
  limit = 50,
  sinceSeq = 0,
  includeWarnings = true
): Promise<{ status: string; total_returned: number; errors: any[]; latest_seq?: number }> {
  const params = new URLSearchParams({
    limit: String(limit),
    since_seq: String(sinceSeq),
    include_warnings: String(includeWarnings),
  });
  const res = await resilientFetch(`/api/v1/system/errors?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch Server Errors');
}

export async function clearServerLogsApi(): Promise<{ status: string; message: string }> {
  const res = await resilientFetch('/api/v1/system/logs', {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Clear Server Logs');
}

export async function fetchSystemDebugDumpApi(): Promise<any> {
  const res = await resilientFetch('/api/v1/system/debug-dump', {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch System Debug Dump');
}

// -------------------------------------------------------------------------
// Multi-Channel Social & Release Broadcaster API
// -------------------------------------------------------------------------

export interface GitCommitItem {
  hash: string;
  full_hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GeneratedReleaseContent {
  linkedin: {
    hooks: string[];
    body: string;
    hashtags: string[];
  };
  twitter: {
    tweet: string;
    thread: string[];
  };
  client_email: {
    subject: string;
    preheader: string;
    html: string;
  };
  changelog: {
    version: string;
    category: string;
    markdown: string;
  };
}

export interface BroadcastReleasePayload {
  version: string;
  title: string;
  category: string;
  summary: string;
  commit_hash?: string;
  linkedin_post?: string;
  twitter_post?: string;
  client_email_subject?: string;
  client_email_html?: string;
  changelog_entry?: string;
  channels: ('linkedin' | 'twitter' | 'email' | 'changelog')[];
  email_recipients?: string[];
}

export interface ReleaseHistoryItem {
  id: number;
  version: string;
  title: string;
  category: string;
  summary: string;
  commit_hash?: string;
  channels_broadcasted: string[];
  broadcast_status: Record<string, any>;
  created_at?: string;
  published_at?: string;
}

export interface ChangelogEntryItem {
  id: number;
  version: string;
  title: string;
  category: string;
  summary: string;
  changelog_entry: string;
  published_at?: string;
}

export async function fetchRecentGitCommits(limit = 8): Promise<GitCommitItem[]> {
  const res = await resilientFetch(`/api/v1/social/commits?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<GitCommitItem[]>(res, 'Fetch Recent Git Commits');
}

export async function generateReleaseContent(payload: {
  title: string;
  summary: string;
  category?: string;
  target_audience?: string;
  commit_hash?: string;
}): Promise<GeneratedReleaseContent> {
  const res = await resilientFetch('/api/v1/social/generate', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<GeneratedReleaseContent>(res, 'Generate Multi-Channel Release Content');
}

export async function broadcastRelease(payload: BroadcastReleasePayload): Promise<{
  success: boolean;
  release_id?: number;
  version: string;
  title: string;
  channels: string[];
  delivery_status: Record<string, any>;
}> {
  const res = await resilientFetch('/api/v1/social/broadcast', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Broadcast Release to Channels');
}

export async function fetchReleaseHistory(limit = 20): Promise<ReleaseHistoryItem[]> {
  const res = await resilientFetch(`/api/v1/social/history?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ReleaseHistoryItem[]>(res, 'Fetch Release History');
}

export async function fetchPublicChangelog(limit = 30): Promise<ChangelogEntryItem[]> {
  const res = await resilientFetch(`/api/v1/social/changelog?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ChangelogEntryItem[]>(res, 'Fetch Public Changelog');
}

export interface LinkedInConfig {
  status: string;
  posting_mode: 'organization' | 'person';
  organization_id: string;
  organization_name: string;
  author_urn: string;
  company_admin_url?: string;
  has_access_token: boolean;
  masked_token: string;
  client_id: string;
  has_client_secret: boolean;
  is_connected: boolean;
}

export async function fetchLinkedInConfig(): Promise<LinkedInConfig> {
  const res = await resilientFetch('/api/v1/social/linkedin/config', {
    headers: getAuthHeaders(),
  });
  return handleResponse<LinkedInConfig>(res, 'Fetch LinkedIn Configuration');
}

export async function updateLinkedInConfig(payload: {
  posting_mode?: 'organization' | 'person';
  organization_id?: string;
  organization_name?: string;
  author_urn?: string;
  access_token?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
}): Promise<LinkedInConfig> {
  const res = await resilientFetch('/api/v1/social/linkedin/config', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<LinkedInConfig>(res, 'Update LinkedIn Configuration');
}

export interface LinkedInTestResult {
  success: boolean;
  mode?: string;
  message: string;
  organization_name?: string;
  authenticated_user?: string;
  company_admin_url?: string;
}

export async function testLinkedInConnection(payload?: {
  access_token?: string;
  author_urn?: string;
  organization_id?: string;
}): Promise<LinkedInTestResult> {
  const res = await resilientFetch('/api/v1/social/linkedin/test', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  });
  return handleResponse<LinkedInTestResult>(res, 'Test LinkedIn Connection');
}

// -------------------------------------------------------------------------
// Marketing & Audience CRM (Email Subscriber List CRUD & Leads)
// -------------------------------------------------------------------------

export interface EmailSubscriber {
  id: number;
  email: string;
  name?: string;
  company?: string;
  role_or_title?: string;
  tier: 'lead' | 'client' | 'firm_partner' | 'subscriber' | string;
  tags: string[];
  is_active: boolean;
  source: string;
  notes?: string;
  last_emailed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AudienceResponse {
  subscribers: EmailSubscriber[];
  total_count: number;
  active_count: number;
  tier_counts: Record<string, number>;
  available_tags: string[];
}

export interface MarketingLead {
  id: number;
  full_name: string;
  email: string;
  phone_or_whatsapp?: string;
  company_name: string;
  accounting_firm: boolean;
  client_count_estimate?: string;
  primary_accounting_software?: string;
  biggest_headache?: string;
  status: string;
  source: string;
  created_at: string;
}

export async function fetchAudienceSubscribers(params?: {
  search?: string;
  tag?: string;
  tier?: string;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<AudienceResponse> {
  const query = new URLSearchParams();
  if (params?.search) query.append('search', params.search);
  if (params?.tag) query.append('tag', params.tag);
  if (params?.tier) query.append('tier', params.tier);
  if (params?.active_only) query.append('active_only', 'true');
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.offset) query.append('offset', params.offset.toString());

  const res = await resilientFetch(`/api/v1/marketing/audience?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<AudienceResponse>(res, 'Fetch Audience Subscribers');
}

export async function createOrBulkImportSubscribers(payload: {
  email?: string;
  name?: string;
  company?: string;
  role_or_title?: string;
  tier?: string;
  tags?: string[];
  notes?: string;
  bulk_emails?: string;
}): Promise<{ success: boolean; created_count: number; skipped_count: number; message: string }> {
  const res = await resilientFetch('/api/v1/marketing/audience', {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Add or Bulk Import Subscribers');
}

export async function updateAudienceSubscriber(
  id: number,
  payload: Partial<EmailSubscriber>
): Promise<{ success: boolean; subscriber: EmailSubscriber }> {
  const res = await resilientFetch(`/api/v1/marketing/audience/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Update Subscriber');
}

export async function deleteAudienceSubscriber(id: number): Promise<{ success: boolean; message: string }> {
  const res = await resilientFetch(`/api/v1/marketing/audience/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Delete Subscriber');
}

export async function syncClientContactsToAudience(): Promise<{
  success: boolean;
  synced_count: number;
  new_count: number;
  total_processed: number;
  message: string;
}> {
  const res = await resilientFetch('/api/v1/marketing/audience/sync-clients', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Sync Client Contacts');
}

export async function capturePublicLead(payload: {
  full_name: string;
  email: string;
  company_name: string;
  phone_or_whatsapp?: string;
  accounting_firm?: boolean;
  client_count_estimate?: string;
  primary_accounting_software?: string;
  biggest_headache?: string;
}): Promise<{ success: boolean; lead_id: number; message: string }> {
  const res = await resilientFetch('/api/v1/marketing/lead-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res, 'Capture Lead Inquiry');
}

export async function fetchMarketingLeads(statusFilter?: string): Promise<{
  leads: MarketingLead[];
  total_count: number;
}> {
  const query = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
  const res = await resilientFetch(`/api/v1/marketing/leads${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res, 'Fetch Marketing Leads');
}






