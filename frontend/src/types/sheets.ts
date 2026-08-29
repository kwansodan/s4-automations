export interface DailyDetailRow {
  date: string;
  client_name: string;
  file_name: string;
  item_name: string;
  category: string;
  pickup_quantity: number;
  delivery_quantity: number;
  discrepancy: number;
  unit_price: number;
  total_amount: number;
  source_image_url?: string;
}

export interface MonthlySummaryRow {
  row_index: number;
  client_name: string;
  item_name: string;
  pickup_qty: number;
  delivery_qty: number;
  linen_discrepancy: number;
  unit_price: number;
  total_billed: number;
  reviewed: boolean;
  approved: boolean;
  status: 'PENDING' | 'INVOICED' | 'DISCREPANCY_FLAGGED';
}

export interface SheetsReviewData {
  daily_details: DailyDetailRow[];
  monthly_summary: MonthlySummaryRow[];
  spreadsheet_id?: string;
  spreadsheet_url?: string;
}
