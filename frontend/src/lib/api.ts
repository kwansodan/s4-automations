/**
 * Typed REST API client for S4 Accounting Automations Suite.
 */

import type { OtpRequestResponse, OtpVerifyResponse, AuthUser } from '../types/auth';
import type { DashboardStats, PipelineProgress } from '../types/pipeline';
import type { SheetsReviewData } from '../types/sheets';
import type { ZohoCatalogData } from '../types/zoho';
import type { SystemConfig, DiagnosticsResult } from '../types/config';

function resolveApiBase(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('S4_API_URL');
    if (saved) return saved.replace(/\/$/, '');
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return 'https://autapi.service4gh.com';
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
  const res = await fetch(`${API_BASE}/api/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse<OtpRequestResponse>(res, 'Request OTP');
}

export async function verifyOtpApi(email: string, otp: string): Promise<OtpVerifyResponse> {
  const res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  return handleResponse<OtpVerifyResponse>(res, 'Verify OTP');
}

export async function fetchCurrentUser(): Promise<{ authenticated: boolean; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ authenticated: boolean; user: AuthUser }>(res, 'Fetch current user');
}

// -------------------------------------------------------------------------
// Dashboard & Pipeline Endpoints
// -------------------------------------------------------------------------

export async function fetchHealth(): Promise<{ status: string; service: string; mock_mode: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse<{ status: string; service: string; mock_mode: boolean }>(res, 'Health check');
}

export async function fetchStats(month = 'August', year = 2026): Promise<DashboardStats> {
  const res = await fetch(`${API_BASE}/api/stats?month=${month}&year=${year}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<DashboardStats>(res, 'Stats fetch');
}

export async function fetchPipelineStatus(): Promise<PipelineProgress> {
  const res = await fetch(`${API_BASE}/api/pipeline/status`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<PipelineProgress>(res, 'Pipeline status fetch');
}

export async function triggerPipeline(payload: Record<string, any> = {}): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/pipeline/trigger`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<{ status: string; message: string }>(res, 'Pipeline trigger');
}

// -------------------------------------------------------------------------
// Google Sheets Review Endpoints
// -------------------------------------------------------------------------

export async function fetchSheetsData(month = 'August', year = 2026): Promise<SheetsReviewData> {
  const res = await fetch(`${API_BASE}/api/sheets/data?month=${month}&year=${year}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<SheetsReviewData>(res, 'Sheets data fetch');
}

export async function toggleApproval(payload: {
  spreadsheet_id?: string;
  row_index: number;
  field: 'reviewed' | 'approved';
  value: boolean;
}): Promise<{ status: string; row_index: number; field: string; value: boolean }> {
  const res = await fetch(`${API_BASE}/api/sheets/toggle-approval`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<{ status: string; row_index: number; field: string; value: boolean }>(res, 'Toggle approval');
}

// -------------------------------------------------------------------------
// Zoho Books Invoicing & Catalog
// -------------------------------------------------------------------------

export async function triggerInvoicing(payload: Record<string, any> = {}): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/invoices/generate`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return handleResponse<{ status: string; message: string }>(res, 'Invoice generation');
}

export async function fetchCatalog(): Promise<ZohoCatalogData> {
  const res = await fetch(`${API_BASE}/api/catalog`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ZohoCatalogData>(res, 'Catalog fetch');
}

// -------------------------------------------------------------------------
// System Configuration & Diagnostics
// -------------------------------------------------------------------------

export async function fetchConfig(): Promise<{ status: string; config: SystemConfig }> {
  const res = await fetch(`${API_BASE}/api/config`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ status: string; config: SystemConfig }>(res, 'Config fetch');
}

export async function updateConfig(configData: Record<string, any>): Promise<{ status: string; message: string; config: SystemConfig }> {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(configData),
  });
  return handleResponse<{ status: string; message: string; config: SystemConfig }>(res, 'Config update');
}

export async function testConnections(): Promise<DiagnosticsResult> {
  const res = await fetch(`${API_BASE}/api/config/test`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
  });
  return handleResponse<DiagnosticsResult>(res, 'Connection test');
}
