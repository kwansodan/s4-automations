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

export type TriggerType = 'realtime_webhook' | 'scheduled_cron' | 'manual_only' | 'event_mesh';

export interface IngestionPipeline {
  id: string;
  name: string;
  section: AccountingSection;
  entity_type: AccountingEntityType;
  source_type: 'google_drive' | 'onedrive' | 'email' | 'webhook' | 'manual';
  source_identifier: string;
  default_account_code?: string;
  default_account_id?: string;
  default_tax_rate?: string;
  auto_post_to_zoho?: boolean;
  is_active?: boolean;
  trigger_type?: TriggerType;
  cron_expression?: string;
  cron_schedule_human?: string;
  webhook_slug?: string;
  last_triggered_at?: string;
  total_runs_count?: number;
  notes?: string;
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

export interface ClientProfile {
  id: string;
  name: string;
  industry: string;
  icon: string;
  status: ClientStatus;
  statusText: string;
  desc: string;
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
  sourceConfig?: Record<string, any>;
  customConfig?: Record<string, any>;
  externalChecklist?: ExternalChecklistItem[];
  created_at?: string;
  updated_at?: string;
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
