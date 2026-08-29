export interface PipelineStats {
  files_discovered: number;
  files_processed: number;
  total_items_extracted: number;
  linen_discrepancies: number;
  total_billed_amount: number;
}

export interface PipelineProgress {
  is_running: boolean;
  status: 'IDLE' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  percent: number;
  current_step: string;
  stats: PipelineStats;
  recent_logs: string[];
}

export interface DashboardStats {
  total_slips_ingested: number;
  unreturned_linen_loss_count: number;
  approved_billing_total_ghs: number;
  pending_approval_count: number;
  active_clients_count: number;
  mock_mode: boolean;
}
