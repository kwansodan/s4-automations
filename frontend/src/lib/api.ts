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
  accounts_url?: string;
}

export interface AccountingOAuthStatusResponse {
  client_id: string;
  platform: string;
  is_connected: boolean;
  org_id?: string;
  org_name?: string;
  connected_at?: string;
  auth_type?: string;
}

export type ZohoOAuthAuthorizeUrlResponse = AccountingOAuthAuthorizeUrlResponse;
export type ZohoOAuthStatusResponse = AccountingOAuthStatusResponse;

function normalizePlatformPrefix(platform: string): 'zoho' | 'quickbooks' | 'xero' {
  if (platform.includes('quickbooks')) return 'quickbooks';
  if (platform.includes('xero')) return 'xero';
  return 'zoho';
}

export async function getAccountingOAuthAuthorizeUrl(
  platform: string,
  clientId: string
): Promise<AccountingOAuthAuthorizeUrlResponse> {
  const prefix = normalizePlatformPrefix(platform);
  const res = await resilientFetch(`/api/v1/oauth/${prefix}/authorize-url?client_id=${encodeURIComponent(clientId)}`, {
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


