export type ClientStatus = 'live' | 'dev' | 'pending';

export type OrganizationType = 'ACCOUNTING_FIRM' | 'INDIVIDUAL_BUSINESS';

export interface Organization {
  id: string;
  name: string;
  org_type: OrganizationType;
  plan_tier: string;
  subscription_status?: string;
  is_active?: boolean;
  max_clients?: number;
  industry?: string;
  icon?: string;
  white_label_logo_url?: string | null;
  custom_portal_subdomain?: string | null;
  storage_strategy?: string;
  role?: string;
  title?: string;
  is_primary?: boolean;
}

export type AccountingSection = 'AR' | 'AP' | 'BANK' | 'GL' | 'FR';

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
  | 'bank_feed'
  | 'gl_journal'
  | 'fr_statement_pack';

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

export type FolderStructurePattern =
  | 'auto_detect'
  | 'month_then_party'
  | 'month_direct'
  | 'party_then_month'
  | 'flat_root';

export type InvoiceDateRule =
  | 'LAST_DAY_OF_MONTH'
  | 'FIRST_DAY_OF_NEXT_MONTH'
  | 'TODAY'
  | 'FIXED_DAY'
  | 'last_day_of_month'
  | 'first_day_following_month'
  | 'today'
  | 'fixed_day';

export type PaymentTermsRule =
  | 'NET_0'
  | 'NET_7'
  | 'NET_14'
  | 'NET_30'
  | 'NET_60'
  | 'CUSTOM'
  | 'net_0'
  | 'net_7'
  | 'net_14'
  | 'net_30'
  | 'net_60'
  | 'custom'
  | 'custom_offset';

export interface InvoicingDateSettings {
  invoice_date_rule?: InvoiceDateRule;
  fixed_invoice_day?: number;
  payment_terms_rule?: PaymentTermsRule;
  custom_due_days?: number;
  custom_terms_note?: string;
  override_date_rules?: boolean;
  [key: string]: any;
}

export interface IngestionPipeline {
  id: string;
  name: string;
  section: AccountingSection;
  entity_type: AccountingEntityType;
  source_type: 'google_drive' | 'onedrive' | 'email' | 'webhook' | 'manual' | 'whatsapp' | 'bank_feed';
  source_identifier: string;
  folder_id?: string;
  folderId?: string;
  source_email?: string;
  sourceEmail?: string;
  source_config?: {
    folder_structure?: FolderStructurePattern;
    enable_lookback_window?: boolean;
    auto_create_month_folder?: boolean;
    move_processed_files?: boolean;
    processed_folder_name?: string;
    allowed_senders?: string;
    tenant_id?: string;
    client_id?: string;
    secret?: string;
    auto_create_missing_contacts?: boolean;
    auto_create_missing_items?: boolean;
    override_date_rules?: boolean;
    invoice_date_rule?: InvoiceDateRule;
    fixed_invoice_day?: number;
    payment_terms_rule?: PaymentTermsRule;
    custom_due_days?: number;
    custom_terms_note?: string;
    [key: string]: any;
  };
  default_account_code?: string;
  default_account_id?: string;
  default_tax_rate?: string;
  auto_post_to_zoho?: boolean;
  auto_post_draft?: boolean;
  auto_create_missing_contacts?: boolean;
  auto_create_missing_items?: boolean;
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
  field_mappings?: Record<string, string>;
  sample_preview?: any;
  notes?: string;
  missing_cadence?: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'disabled';
  watched_accounts?: string[];
  last_run_summary?: PipelineRunSummary;
  agent_email?: string;
  whatsapp_enabled?: boolean;
  whatsapp_mode?: 'platform_shared' | 'dedicated_meta' | 'dedicated_twilio';
  whatsapp_phone_number?: string;
  whatsapp_phone_number_id?: string;
  whatsapp_routing_tag?: string;
  whatsapp_webhook_url?: string;
  email_webhook_url?: string;
  persona_instructions?: string;
  autonomy_level?: AgentAutonomyLevel;
  schedule_frequency?: 'hourly' | 'every_6_hours' | 'daily_morning' | 'daily_evening' | 'weekly' | 'monthly_cutoff' | 'manual' | string;
  auto_approve_threshold?: number;
  auto_apply_knowledge?: boolean;
  auto_query_anomalies?: boolean;
  proactive_SLA_reminders?: boolean;
  gl_policy_config?: GLAgentPolicyConfig;
  fr_policy_config?: FRAgentPolicyConfig;
}

export interface GLAgentPolicyConfig {
  reporting_framework?: 'IFRS' | 'IFRS_FOR_SMES' | 'GHANA_GAAP' | 'US_GAAP' | string;
  depreciation_method?: 'straight_line' | 'reducing_balance' | string;
  machinery_useful_years?: number;
  vehicles_useful_years?: number;
  furniture_useful_years?: number;
  computer_useful_years?: number;
  buildings_useful_years?: number;
  prepayment_amortization?: 'monthly_pro_rata' | 'immediate' | string;
  statutory_tax_rate?: number;
  fx_revaluation_required?: boolean;
}

export interface FRAgentPolicyConfig {
  reporting_framework?: 'IFRS' | 'IFRS_FOR_SMES' | 'GHANA_GAAP' | 'US_GAAP' | string;
  reporting_frequency?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | string;
  included_statements?: string[];
  is_audited?: boolean;
}

export type AgentAutonomyLevel = 'copilot' | 'semi_autonomous' | 'full_autonomous';

export interface AgentReasoningStep {
  step_index: number;
  thought: string;
  tool_name: string;
  tool_input: Record<string, any>;
  tool_output_summary: string;
  status: 'SUCCESS' | 'FAILED' | 'AWAITING_HUMAN' | string;
  timestamp: string;
}

export interface AgentExecutionRun {
  id?: number;
  run_id: string;
  client_id: string;
  agent_id: string;
  agent_name?: string;
  section?: string;
  trigger_type: string;
  trigger_source?: string | null;
  goal: string;
  autonomy_level: AgentAutonomyLevel | string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'AWAITING_HUMAN' | 'FAILED' | string;
  reasoning_steps: AgentReasoningStep[];
  actions_taken_count: number;
  items_processed: number;
  items_auto_approved: number;
  items_categorized: number;
  queries_dispatched: number;
  invoices_drafted: number;
  summary_report: string;
  started_at: string;
  completed_at?: string | null;
}

export type AccountingAgent = IngestionPipeline;

export interface PipelineRunSummary {
  pipeline_id?: string;
  pipeline_name?: string;
  pipeline_type?: 'AP' | 'AR' | 'BANK' | string;
  triggered_at: string;
  month: string;
  year: number;
  status: 'COMPLETED' | 'COMPLETED_DUPLICATES_SKIPPED' | 'COMPLETED_EMPTY' | 'WARNING' | 'FAILED' | string;
  summary_message: string;
  sources_discovered: number;
  duplicates_skipped: number;
  items_extracted: number;
  auto_post: boolean;
  spreadsheet_id?: string;
  spreadsheet_url?: string;
  documents?: {
    discovered?: Array<{ file_name: string; source_type?: string; folder_id?: string; mime_type?: string }>;
    skipped?: Array<{ file_name: string; reason: string; checksum?: string }>;
    extracted?: Array<{ file_name: string; items_count: number; validation_status?: string; total_amount?: number }>;
    archived?: Array<{ file_name: string; destination: string }>;
  };
  step_logs?: Array<{
    timestamp: string;
    stage: string;
    message: string;
    level: string;
    details?: any;
  }>;
  sync_details?: any;
  post_results?: any;
  errors?: string[];
  warnings?: string[];
  error_message?: string;
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
  organization_id?: string;
  name: string;
  industry: string;
  icon: string;
  status: ClientStatus;
  statusText: string;
  desc: string;
  accounting_software?: AccountingSoftware;
  folderId?: string;
  folder_id?: string;
  zohoOrg?: string;
  zoho_org_id?: string;
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
  agents?: AccountingAgent[];
  team_members?: OrganizationTeamMember[];
  watched_accounts?: string[];
  sourceConfig?: Record<string, any>;
  customConfig?: Record<string, any> & InvoicingDateSettings;
  source_config?: Record<string, any>;
  custom_config?: Record<string, any> & InvoicingDateSettings;
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

export interface BankAccountItem {
  account_id: string;
  account_name: string;
  account_type?: string;
  currency?: string;
  account_number_masked?: string;
  balance?: number;
  uncategorized_transactions?: number;
  is_active?: boolean;
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
  checksum?: string;
  metadata_json?: Record<string, any>;
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

export interface CustomerInvoiceGroupSummary {
  customerName: string;
  itemsCount: number;
  totalAmount: number;
  isReconciled: boolean;
  zohoContactId?: string;
}

export interface InvoicePreflightAudit {
  clientId?: string;
  clientName?: string;
  month: string;
  year: number;
  totalTransactions: number;
  approvedTransactions: number;
  unapprovedTransactions: number;
  totalApprovedAmount: number;
  unapprovedAmount: number;
  uncatalogedApprovedCount: number;
  uncatalogedItemNames: string[];
  zeroRateCount: number;
  zeroRateItemNames: string[];
  lowConfidenceApprovedCount: number;
  unreviewedSlipsCount: number;
  zohoContactMatched: boolean;
  matchedCustomersCount: number;
  unmatchedCustomers: string[];
  customerSummaries: CustomerInvoiceGroupSummary[];
  zohoContactName?: string;
  zohoContactId?: string;
  lossCount?: number;
}

export interface SlipPreviewItemRow {
  id: number;
  description: string;
  pickedQty?: number;
  delivQty?: number;
  lossQty?: number;
  rate?: number;
  amount: number;
  reviewed?: boolean;
  approved?: boolean;
}

export interface SlipPreviewItem {
  id: string;
  title: string;
  rawUrl: string;
  partyName?: string;
  partyType?: 'Customer' | 'Vendor';
  date?: string;
  itemsCount?: number;
  totalAmount?: number;
  currency?: string;
  status?: string;
  isReviewed?: boolean;
  isApproved?: boolean;
  slipKey?: string;
  txIds?: number[];
  items?: SlipPreviewItemRow[];
  onApprove?: () => Promise<void> | void;
}

export type InformationRequestPipelineType = 'BANK' | 'AR' | 'AP' | 'GENERAL';

export type InformationRequestStatus = 'CLARIFICATION_REQUESTED' | 'CLIENT_ANSWERED' | 'RESOLVED';

export interface InformationRequestHistoryEntry {
  actor?: 'ACCOUNTANT' | 'CLIENT';
  sender?: 'accountant' | 'client' | string;
  action?: string;
  message: string;
  text?: string;
  timestamp: string;
  recipient_email?: string;
  attachments?: Array<{ name: string; url?: string; size?: number; type?: string }>;
}

export interface InformationRequestItem {
  id: number;
  item_key: string;
  request_id?: string;
  source_kind: 'BANK' | 'STAGED';
  pipeline_type: InformationRequestPipelineType;
  client_id: string;
  client_name: string;
  client_currency: string;
  transaction_ids: number[];
  primary_id: number;
  items_count: number;
  line_count: number;
  transaction_date: string;
  title: string;
  description: string;
  party_or_account_name: string;
  source_file_name?: string;
  drive_file_id?: string | null;
  drive_file_url?: string | null;
  amount: number;
  transaction_type: 'DEBIT' | 'CREDIT';
  query_status: InformationRequestStatus;
  status?: string;
  accountant_query: string;
  client_explanation?: string;
  client_attachments?: Array<{ name: string; url?: string; size?: number; type?: string }>;
  query_date?: string;
  response_date?: string;
  resolved_date?: string;
  recipient_email?: string;
  reminder_count: number;
  last_reminded_at?: string;
  age_hours: number;
  is_overdue: boolean;
  query_history?: InformationRequestHistoryEntry[];
  mapped_account_id?: string;
  mapped_account_name?: string;
  assigned_category?: string;
  magic_url?: string;
  reviewed?: boolean;
  approved?: boolean;
  line_items?: Array<{
    id: number;
    description: string;
    quantity?: number;
    credit_amount?: number;
    rate?: number;
    amount: number;
  }>;
}

export interface ClientRequestSummaryItem {
  client_id: string;
  client_name: string;
  total: number;
  total_requests: number;
  awaiting_client: number;
  pending_count: number;
  needs_review: number;
  answered_count: number;
  overdue: number;
  overdue_count: number;
  resolved: number;
}

export interface InformationRequestsResponse {
  client_id?: string | null;
  metrics: {
    total_count: number;
    total_requests: number;
    awaiting_client: number;
    pending_client_count: number;
    needs_review: number;
    client_answered_count: number;
    overdue_72h: number;
    overdue_count: number;
    resolved: number;
    resolved_count: number;
    ar_count: number;
    ap_count: number;
    bank_count: number;
    general_count: number;
    by_pipeline: {
      BANK: number;
      AR: number;
      AP: number;
      GENERAL: number;
    };
  };
  client_summaries: ClientRequestSummaryItem[];
  items: InformationRequestItem[];
  requests: InformationRequestItem[];
}

export interface CreateInformationRequestPayload {
  client_id: string;
  pipeline_type: InformationRequestPipelineType;
  query_text: string;
  recipient_email?: string;
  send_immediately?: boolean;
  bank_transaction_ids?: number[];
  staged_transaction_ids?: number[];
  general_title?: string;
  general_amount?: number;
  general_date?: string;
  party_name?: string;
}

export type KnowledgeCategory =
  | 'ENTITY_ALIAS'
  | 'SKU_PRICING_RULE'
  | 'COA_MAPPING_RULE'
  | 'TAX_AND_COMPLIANCE'
  | 'WORKFLOW_SOP'
  | 'DOMAIN_FACT';

export interface ClientKnowledgeEntry {
  id: number;
  client_id: string;
  agent_id?: string | null;
  category: KnowledgeCategory | string;
  rule_key: string;
  rule_value: string;
  natural_language_rule: string;
  structured_data: Record<string, any>;
  source: 'MANUAL' | 'ACCOUNTANT_ACTION' | 'EMAIL_INSTRUCTION' | 'WHATSAPP_INSTRUCTION' | 'AUTO_DISCOVERED' | string;
  confidence: number;
  is_active: boolean;
  usage_count: number;
  last_used_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ClientKnowledgeSummary {
  total_count: number;
  active_count: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
  categories: string[];
}

export interface ClientKnowledgeResponse {
  client_id: string;
  summary: ClientKnowledgeSummary;
  entries: ClientKnowledgeEntry[];
}

export interface AgentMessageItem {
  id: number;
  client_id: string;
  agent_id: string;
  channel: 'EMAIL' | 'WHATSAPP' | 'IN_APP' | string;
  direction: 'INBOUND' | 'OUTBOUND' | string;
  sender_address: string;
  recipient_address: string;
  subject?: string | null;
  body_text: string;
  ai_reasoning?: string | null;
  knowledge_extracted: Array<{
    id?: number;
    category: string;
    rule_key: string;
    rule_value: string;
    natural_language_rule: string;
    action?: string;
  }>;
  status: string;
  external_message_id?: string | null;
  metadata_json?: Record<string, any>;
  ai_metadata?: {
    agent_run?: AgentExecutionRun;
    [key: string]: any;
  };
  created_at?: string | null;
}

export interface TenantWhatsAppConfig {
  client_id: string;
  client_name: string;
  whatsapp_mode: 'platform_shared' | 'dedicated_meta' | 'dedicated_twilio';
  whatsapp_phone_number: string;
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_verify_token: string;
  has_custom_access_token: boolean;
  twilio_account_sid: string;
  has_twilio_auth_token: boolean;
  webhook_url: string;
  global_webhook_url: string;
  platform_shared_number: string;
}

export interface CloseChecklistItem {
  step_id: string;
  sequence: number;
  category:
    | 'SUBLEDGER_TIE_OUT'
    | 'FIXED_ASSETS'
    | 'PREPAYMENTS'
    | 'ACCRUALS_LIABILITIES'
    | 'TREASURY_FX'
    | 'TAXATION'
    | 'EQUITY_RETAINED_EARNINGS'
    | 'CUSTOM_DISCOVERY';
  title: string;
  description: string;
  accounting_standard: string;
  target_account_codes: string[];
  procedure_type: 'AUTOMATED_JOURNAL' | 'RECONCILIATION_TIE_OUT' | 'COMPLIANCE_CHECK' | 'INQUIRY_OUTREACH';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'EXCEPTION_FLAGGED' | 'SKIPPED';
  is_dynamically_discovered: boolean;
  findings_summary: string;
  working_paper_id?: string | null;
  inquiry_thread_id?: string | null;
}

export interface SubledgerTieOutItem {
  status: 'TIED_OUT' | 'PENDING_APPROVALS' | 'SUSPENSE_BLOCKED' | 'FLAGGED';
  gl_control_account?: string;
  gl_balance?: number;
  gl_cash_balance?: number;
  pending_customer_items?: number;
  pending_vendor_items?: number;
  suspense_account_balance?: number;
  suspense_cleared?: boolean;
  message: string;
}

export interface SubledgerTieOutSummary {
  evaluated_at?: string;
  overall_status: 'TIED_OUT' | 'READY_WITH_WARNINGS' | 'BLOCKED';
  accounts_receivable?: SubledgerTieOutItem;
  accounts_payable?: SubledgerTieOutItem;
  bank_reconciliation?: SubledgerTieOutItem;
}

export interface PreFlightDiscoverySummary {
  scanned_at?: string;
  total_gl_accounts_audited: number;
  uncovered_accounts_found: number;
  uncovered_accounts?: Array<{
    account_code: string;
    account_name: string;
    account_type?: string;
    balance: number;
  }>;
  contra_anomalies_found: number;
  contra_anomalies?: Array<{
    account_code: string;
    account_name: string;
    anomaly_type: string;
    balance: number;
    description: string;
  }>;
  new_steps_integrated: number;
  coverage_percentage: number;
  executive_pre_flight_memo?: string;
}

export interface PostCloseVerificationSummary {
  certificate_id: string;
  verified_at: string;
  period: string;
  is_balanced: boolean;
  total_debits: number;
  total_credits: number;
  discrepancy: number;
  suspense_account_balance: number;
  suspense_cleared: boolean;
  status: 'VERIFIED' | 'DISCREPANCY_FLAGGED';
  narrative: string;
}

export interface MonthEndCloseChecklist {
  checklist_id: string;
  client_id: string;
  period_month: string;
  period_year: number;
  status: 'DRAFT' | 'PREFLIGHT_COMPLETED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXCEPTION_FLAGGED';
  autonomy_level: string;
  total_steps_count: number;
  completed_steps_count: number;
  exceptions_count: number;
  steps: CloseChecklistItem[];
  subledger_tie_outs?: SubledgerTieOutSummary;
  pre_flight_summary?: PreFlightDiscoverySummary;
  post_close_verification?: PostCloseVerificationSummary;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
}
