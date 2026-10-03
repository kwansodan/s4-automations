export interface PipelineStats {
  files_discovered?: number;
  files_processed?: number;
  total_items_extracted?: number;
  linen_discrepancies?: number;
  total_billed_amount?: number;
  customers_total?: number;
  customers_done?: number;
  clients_total?: number;
  clients_done?: number;
  slips_processed?: number;
  items_extracted?: number;
  loss_discrepancies?: number;
  [key: string]: any;
}

export interface CreatedInvoiceReceiptItem {
  invoice_id?: string;
  invoice_number: string;
  customer_name: string;
  total_ghs: number;
  zoho_link?: string;
  [key: string]: any;
}

export interface PipelineProgress {
  is_running: boolean;
  status: 'IDLE' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RUNNING' | 'ERROR' | string;
  percent: number;
  current_step: string;
  stage_index?: number;
  total_stages?: number;
  task_name?: string;
  month?: string;
  year?: number;
  elapsed_seconds?: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  stats: PipelineStats;
  recent_logs: Array<string | { time: string; level: string; message: string }>;
  last_result?: {
    invoices_created?: Array<{
      invoice_id?: string;
      invoice_number: string;
      customer_name: string;
      total_ghs: number;
      zoho_link?: string;
    }>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface DashboardStats {
  total_slips_ingested: number;
  unreturned_linen_loss_count: number;
  approved_billing_total_ghs: number;
  pending_approval_count: number;
  active_clients_count: number;
  mock_mode: boolean;
  approved_rows_count?: number;
}
