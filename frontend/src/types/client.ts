export type ClientStatus = 'live' | 'dev' | 'pending';

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
