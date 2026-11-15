import type { Organization } from './client';

export interface AuthUser {
  email: string;
  name: string;
  role: 'admin' | 'bookkeeper' | 'auditor' | string;
  is_platform_admin?: boolean;
  is_org_admin?: boolean;
  impersonating_org_id?: string | null;
  organization?: Organization;
  organizations?: Organization[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
}

export interface OtpRequestResponse {
  success: boolean;
  status: string;
  message: string;
  email?: string;
  expires_in_seconds?: number;
  dev_hint?: string | null;
}

export interface OtpVerifyResponse {
  success: boolean;
  status: string;
  access_token: string;
  token_type: string;
  user: AuthUser;
}
