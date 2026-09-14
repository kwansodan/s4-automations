export interface DailyDetailRow {
  date?: string;
  slip_date?: string;
  client_name?: string;
  file_name?: string;
  raw_item_name?: string;
  standard_item_name?: string;
  item_name?: string;
  category?: string;
  pickup_quantity?: number;
  pickup_qty?: number;
  delivery_quantity?: number;
  delivery_qty?: number;
  discrepancy?: number;
  loss_qty?: number;
  unit_price?: number;
  unit_rate?: number;
  total_amount?: number;
  total_billed?: number;
  source_image_url?: string;
  drive_file_url?: string;
  confidence_score?: string;
  processed_at?: string;
}

export interface MonthlySummaryRow {
  row_index: number;
  client_name: string;
  item_name?: string;
  standard_item_name?: string;
  zoho_contact_id?: string;
  zoho_item_id?: string;
  raw_names_seen?: string;
  confidence_score?: string;
  pickup_qty?: number;
  total_picked_up?: number;
  pickup_quantity?: number;
  delivery_qty?: number;
  total_delivered?: number;
  delivery_quantity?: number;
  linen_discrepancy?: number;
  discrepancy?: number;
  loss_qty?: number;
  unit_price?: number;
  unit_rate?: number;
  total_billed?: number;
  total_amount?: number;
  audit_notes?: string;
  reviewed: boolean;
  approved: boolean;
  status: 'PENDING' | 'INVOICED' | 'DISCREPANCY_FLAGGED' | string;
}

export interface SheetsReviewData {
  daily_details: DailyDetailRow[];
  monthly_summary: MonthlySummaryRow[];
  spreadsheet_id?: string;
  spreadsheet_url?: string;
  month?: string;
  year?: number;
}
