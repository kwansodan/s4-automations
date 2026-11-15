export type AdminTab =
  | 'overview'
  | 'tenants'
  | 'users'
  | 'agents'
  | 'config'
  | 'audit'
  | 'growth';

export interface AdminOverviewData {
  operator_email: string;
  maintenance_mode: boolean;
  revenue: {
    mrr_usd: number;
    estimated_ai_cost_usd_30d: number;
    gross_margin_usd: number;
    pending_payments_count: number;
    pending_payments_amount_usd: number;
  };
  tenants: {
    total: number;
    active: number;
    suspended: number;
    trialing: number;
    total_clients: number;
    total_memberships: number;
    by_tier: Record<string, number>;
  };
  agent_fleet: {
    total_agents: number;
    active_agents: number;
    runs_24h: number;
    failed_runs_24h: number;
    tokens_24h: number;
    messages_24h: number;
  };
  subsystems: {
    database: { status: string; provider: string };
    email_gateway: { status: string; provider: string; agent_domain: string };
    whatsapp_gateway: { status: string; configured_number: string | null };
    llm_router: { status: string; provider: string };
    zoho_books: { status: string };
  };
  recent_audits: AdminAuditLogEntry[];
}

export interface PlatformSuperAdmin {
  id: string;
  email: string;
  name?: string | null;
  is_active: boolean;
  is_root: boolean;
  notes?: string | null;
  added_by?: string | null;
  last_login_at?: string | null;
  created_at?: string | null;
}

export interface CrossTenantUserMembership {
  id: string;
  organization_id: string;
  organization_name: string;
  org_type: string;
  role: string;
  title?: string | null;
  is_primary: boolean;
}

export interface CrossTenantUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  is_platform_admin: boolean;
  last_seen_at?: string | null;
  membership_count: number;
  memberships: CrossTenantUserMembership[];
}

export interface AdminTenantDetail {
  organization: {
    id: string;
    name: string;
    org_type: string;
    plan_tier: string;
    subscription_status: string;
    is_active: boolean;
    max_clients: number;
    booster_packs_count: number;
    trial_ends_at?: string | null;
    billing_email?: string | null;
    white_label_logo_url?: string | null;
    custom_portal_subdomain?: string | null;
    storage_strategy?: string | null;
    custom_gdrive_folder_id?: string | null;
    created_at?: string | null;
  };
  clients: Array<{
    id: string;
    name: string;
    industry?: string | null;
    status: string;
    agent_enabled: boolean;
    agent_email?: string | null;
    created_at?: string | null;
  }>;
  members_count: number;
  memberships: Array<{
    id: string;
    user_id: string;
    email?: string | null;
    name?: string | null;
    role: string;
    title?: string | null;
    is_primary: boolean;
    created_at?: string | null;
  }>;
  firm_members: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
  }>;
  payments: Array<{
    id: string;
    plan_tier: string;
    amount_usd: number;
    currency: string;
    payment_method: string;
    status: string;
    reference_number?: string | null;
    created_at?: string | null;
  }>;
  telemetry_30d: {
    agent_runs: number;
    tokens_used: number;
    estimated_cost_usd: number;
  };
  recent_audits: AdminAuditLogEntry[];
}

export interface AdminAgentFleetEntry {
  client_id: string;
  client_name: string;
  organization_id?: string | null;
  organization_name: string;
  agent_enabled: boolean;
  agent_email?: string | null;
  agent_whatsapp_number?: string | null;
  agent_persona_name?: string | null;
  agent_tone?: string | null;
  agent_autonomy_mode?: string | null;
  total_runs: number;
  failed_runs: number;
  inbound_messages: number;
  outbound_messages: number;
  last_run?: {
    id: string;
    trigger_type: string;
    status: string;
    summary?: string | null;
    started_at?: string | null;
  } | null;
}

export interface AdminAgentRunEntry {
  id: string;
  client_id: string;
  client_name: string;
  trigger_type: string;
  status: string;
  summary?: string | null;
  actions_taken: any[];
  reasoning_trace: any[];
  tokens_used: number;
  estimated_cost_usd: number;
  started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
}

export interface AdminAgentMessageEntry {
  id: string;
  client_id: string;
  client_name: string;
  channel: string;
  direction: string;
  sender_address?: string | null;
  recipient_address?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  status: string;
  created_at?: string | null;
}

export interface GatewayHealthData {
  email_gateway: {
    status: string;
    smtp_configured: boolean;
    smtp_host?: string | null;
    smtp_port?: number | null;
    imap_configured: boolean;
    imap_host?: string | null;
    agent_email_domain?: string | null;
    poll_interval_seconds: number;
    recent_outbound_24h: number;
    recent_inbound_24h: number;
    failed_24h: number;
  };
  whatsapp_gateway: {
    status: string;
    provider: string;
    platform_number?: string | null;
    phone_number_id_configured: boolean;
    access_token_configured: boolean;
    verify_token_configured: boolean;
    recent_outbound_24h: number;
    recent_inbound_24h: number;
    failed_24h: number;
  };
}

export interface AdminAuditLogEntry {
  id: string;
  timestamp?: string | null;
  client_id?: string | null;
  actor_email: string;
  action: string;
  source_type?: string | null;
  source_reference?: string | null;
  details: Record<string, any>;
}

export interface TenantTelemetryBreakdown {
  period_days: number;
  summary: {
    total_tenants: number;
    total_mrr_usd: number;
    total_tokens: number;
    total_ai_cost_usd: number;
    gross_margin_usd: number;
  };
  tenants: Array<{
    organization_id: string;
    organization_name: string;
    plan_tier: string;
    subscription_status: string;
    is_active: boolean;
    client_count: number;
    max_clients: number;
    agent_runs: number;
    failed_runs: number;
    tokens_used: number;
    estimated_ai_cost_usd: number;
    mrr_usd: number;
    gross_margin_usd: number;
    margin_pct: number;
  }>;
}
