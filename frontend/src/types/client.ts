export type ClientStatus = 'live' | 'dev' | 'pending';

export type AccountingSection = 'AR' | 'AP' | 'BANK' | 'GL';

export type AccountingEntityType =
  | 'ar_sales_invoice'
  | 'ar_customer_payment'
  | 'ar_credit_note'
  | 'ar_retainer_invoice'
  | 'ar_estimate'
  | 'ar_delivery_challan'
  | 'ap_vendor_bill'
  | 'ap_vendor_payment'
  | 'ap_direct_expense'
  | 'ap_purchase_order'
  | 'ap_vendor_credit'
  | 'bank_statement'
  | 'momo_statement'
  | 'gl_journal';

export type AccountingSoftware =
  | 'zoho_books'
  | 'quickbooks_online'
  | 'sage_business_cloud'
  | 'xero'
  | 'odoo'
  | 'tally_prime'
  | 'sap_business_one'
  | 'ms_dynamics_365'
  | 'wave'
  | 'busy_accounting';

export interface AccountingPlatformInfo {
  id: AccountingSoftware;
  name: string;
  regionalPopularity: string;
  icon: string;
  status: 'live' | 'in_progress';
  targetProtocol: string;
  description: string;
}

export const ACCOUNTING_PLATFORMS: AccountingPlatformInfo[] = [
  {
    id: 'zoho_books',
    name: 'Zoho Books',
    regionalPopularity: '#1 Cloud Accounting in West Africa (Ghana, Nigeria)',
    icon: '🟢',
    status: 'live',
    targetProtocol: 'REST API v3 / OAuth2',
    description: 'Native cloud accounting with live contact sync, catalog pricing, and automated invoice/bill generation.',
  },
  {
    id: 'quickbooks_online',
    name: 'QuickBooks Online (Intuit)',
    regionalPopularity: 'Dominant SME & Startup Accounting across West Africa',
    icon: '📗',
    status: 'live',
    targetProtocol: 'Intuit REST API / OAuth2',
    description: 'Standard cloud accounting for West African SMEs with live customer, item catalog, and invoice sync.',
  },
  {
    id: 'sage_business_cloud',
    name: 'Sage Business Cloud / Evolution',
    regionalPopularity: 'Standard Mid-Market ERP in Ghana & Nigeria',
    icon: '🌿',
    status: 'in_progress',
    targetProtocol: 'Sage Data Hub REST API',
    description: 'Widely deployed across mid-tier manufacturing, retail, and commercial enterprises. In progress.',
  },
  {
    id: 'xero',
    name: 'Xero Accounting',
    regionalPopularity: 'Rapidly Growing for Tech & Export Companies',
    icon: '🔵',
    status: 'live',
    targetProtocol: 'Xero API v2 / OAuth2',
    description: 'Cloud accounting for modern agencies and regional tech firms with native contact & invoice sync.',
  },
  {
    id: 'odoo',
    name: 'Odoo Accounting & ERP',
    regionalPopularity: 'Major Open-Source ERP for Wholesale & Trading',
    icon: '🟣',
    status: 'in_progress',
    targetProtocol: 'Odoo JSON-RPC / REST API',
    description: 'Integrated ERP widely adopted across West African distribution and logistics firms. In progress.',
  },
  {
    id: 'tally_prime',
    name: 'TallyPrime / Tally.ERP 9',
    regionalPopularity: 'Market Standard in Opera Square & Alaba Market',
    icon: '⚡',
    status: 'in_progress',
    targetProtocol: 'Tally XML / Server Gateway',
    description: 'Essential trading and inventory software for large commodity and electronics distributors. In progress.',
  },
  {
    id: 'sap_business_one',
    name: 'SAP Business One',
    regionalPopularity: 'Corporate & FMCG Standard across West Africa',
    icon: '🔷',
    status: 'in_progress',
    targetProtocol: 'SAP Service Layer OData',
    description: 'Mid-tier and enterprise ERP for large distribution and FMCG conglomerates. In progress.',
  },
  {
    id: 'ms_dynamics_365',
    name: 'Microsoft Dynamics 365 Business Central',
    regionalPopularity: 'Corporate & Financial Institutions',
    icon: '🟦',
    status: 'in_progress',
    targetProtocol: 'Microsoft Graph / OData API',
    description: 'Enterprise cloud ERP for institutional supply chains and corporate finance. In progress.',
  },
  {
    id: 'wave',
    name: 'Wave Accounting',
    regionalPopularity: 'Popular for Micro-Merchants & Small Consultancies',
    icon: '🌊',
    status: 'in_progress',
    targetProtocol: 'Wave GraphQL API',
    description: 'Free cloud accounting used by micro-enterprises and boutique service providers. In progress.',
  },
  {
    id: 'busy_accounting',
    name: 'Busy Accounting / Busy ERP',
    regionalPopularity: 'Retail, Hardware & Fast-Moving Consumer Goods',
    icon: '💼',
    status: 'in_progress',
    targetProtocol: 'Busy Sync API / Webhook',
    description: 'Inventory and accounting software popular in West African commercial trading centres. In progress.',
  },
];

export type TriggerType = 'realtime_webhook' | 'scheduled_cron' | 'manual_only' | 'event_mesh';

export interface IngestionPipeline {
  id: string;
  name: string;
  section: AccountingSection;
  entity_type: AccountingEntityType;
  source_type: 'google_drive' | 'onedrive' | 'email' | 'webhook' | 'manual' | 'whatsapp' | 'bank_feed';
  source_identifier: string;
  default_account_code?: string;
  default_account_id?: string;
  default_tax_rate?: string;
  auto_post_to_zoho?: boolean;
  auto_post_draft?: boolean;
  is_active?: boolean;
  active?: boolean;
  trigger_type?: TriggerType;
  cron_expression?: string;
  cron_schedule_human?: string;
  schedule?: string;
  webhook_slug?: string;
  last_triggered_at?: string;
  total_runs_count?: number;
  human_instructions?: string;
  sample_preview?: any;
  notes?: string;
}

export interface PipelineSimulationResult {
  success: boolean;
  entity_type: string;
  accounting_software: string;
  raw_datapoints: Array<{
    key: string;
    value: any;
    confidence: number;
    source_snippet?: string;
  }>;
  transposed_payload: Record<string, any>;
  validation_status: 'VALID' | 'VALIDATION_WARNINGS';
  validation_errors: string[];
  ai_reasoning: string;
  confidence_score: number;
  source_file_name?: string;
}

export interface StarterRecipe {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  defaultVolume: string;
  currency: string;
  pipelines: IngestionPipeline[];
  blueprints: BlueprintStep[];
}

export interface ValidationIssue {
  field_name: string;
  error_type: string;
  message: string;
  received_value?: any;
  severity: 'CRITICAL' | 'WARNING';
}

export interface BlueprintStep {
  title: string;
  desc: string;
  status: 'active' | 'in_progress' | 'queued';
}

export interface ExternalChecklistItem {
  id: string;
  title: string;
  category: 'zoho' | 'storage' | 'email' | 'tax' | 'catalog';
  description: string;
  guideSteps: string[];
  isCompleted: boolean;
  copyableValue?: string;
  copyableLabel?: string;
  required: boolean;
}

export interface OrganizationTeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'CFO' | 'Financial_Controller' | 'Operations_Lead' | 'External_Auditor' | 'Accounts_Payable_Clerk';
  notifications: {
    executive_digest: boolean;
    critical_anomalies: boolean;
    staged_approvals: boolean;
    channel: 'email' | 'whatsapp' | 'both';
  };
}

export interface ClientProfile {
  id: string;
  name: string;
  industry: string;
  icon: string;
  status: ClientStatus;
  statusText: string;
  desc: string;
  accounting_software?: AccountingSoftware;
  folderId?: string;
  zohoOrg?: string;
  zohoContactId?: string;
  sourceType?: string;
  sourceEmail?: string;
  currency?: string;
  varianceTolerance?: number;
  confidenceThreshold?: number;
  workflowsCount: number;
  projectedMonthlyVolume: string;
  activeIntegrations: string[];
  blueprints: BlueprintStep[];
  pipelines?: IngestionPipeline[];
  team_members?: OrganizationTeamMember[];
  watched_accounts?: string[];
  sourceConfig?: Record<string, any>;
  customConfig?: Record<string, any>;
  externalChecklist?: ExternalChecklistItem[];
  created_at?: string;
  updated_at?: string;
}

export interface ChartOfAccountItem {
  account_id: string;
  account_name: string;
  account_code?: string;
  account_type: string;
  is_watched?: boolean;
  is_suspense?: boolean;
}

export interface BankTransactionRecord {
  id: number;
  client_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: 'DEBIT' | 'CREDIT';
  bank_account_name?: string;
  source_file_name?: string;
  status: 'UNMAPPED' | 'CLARIFICATION_REQUESTED' | 'CLIENT_ANSWERED' | 'MAPPED' | 'POSTED';
  mapped_account_id?: string;
  mapped_account_name?: string;
  payee_name?: string;
  tax_rate?: string;
  ai_suggested_account?: string;
  category_confidence?: number;
  client_explanation?: string;
  accountant_query?: string;
  client_attachments?: Array<{ name: string; url?: string; size?: number; type?: string }>;
  query_date?: string;
  response_date?: string;
  source_platform?: string;
}

export interface TransactionCategorizePayload {
  mapped_account_id: string;
  mapped_account_name?: string;
  payee_name?: string;
  tax_rate?: string;
  post_to_accounting?: boolean;
}

export interface TransactionQueryPayload {
  query_text: string;
  recipient_email?: string;
  send_immediately?: boolean;
}

export interface IndustryPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  defaultSource: 'google_drive' | 'onedrive' | 'email' | 'webhook';
  defaultEngine: 'gemini_flash_vision' | 'pdf_bank_parser' | 'rent_receipt_matcher' | 'invoice_ocr';
  samplePreset: 'laundry_slip' | 'bank_statement' | 'rent_receipt' | 'commercial_invoice';
  defaultVolume: string;
  currency: string;
  defaultBlueprints: BlueprintStep[];
  pipelines?: IngestionPipeline[];
}

export interface ProbeCheck {
  target: string;
  identifier: string;
  status: 'PASS' | 'WARNING' | 'FAIL' | 'INFO';
  message: string;
  service_account?: string;
}

export interface ProbeResult {
  success: boolean;
  status: 'CONNECTED' | 'REQUIRES_ATTENTION' | 'FAILED';
  source_type: string;
  checks: ProbeCheck[];
  timestamp: string;
  summary: string;
}

export interface DryRunItem {
  raw_handwritten_text: string;
  matched_sku: string;
  zoho_item_id?: string;
  pickup_qty?: number;
  delivery_qty?: number;
  debit?: number;
  credit?: number;
  discrepancy?: number;
  discrepancy_reason?: string;
  unit_price?: number;
  total_amount?: number;
  confidence: number;
  status: 'MATCHED' | 'DISCREPANCY_FLAGGED' | 'UNMATCHED';
}

export interface DryRunResult {
  engine: string;
  preset: string;
  document_name: string;
  extracted_date: string;
  overall_confidence: number;
  discrepancy_detected: boolean;
  items: DryRunItem[];
  total_value: number;
  currency: string;
  ready_for_review_sheets: boolean;
}
