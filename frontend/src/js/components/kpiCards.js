/**
 * KPI Summary Widget Cards Component.
 */

import { state } from '../state.js';

export function renderKpiCards(container) {
  const stats = state.stats || {
    total_slips_ingested: 0,
    unreturned_linen_loss_count: 0,
    approved_billing_total_ghs: 0.0,
    pending_approval_count: 0,
    active_clients_count: 0,
  };

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon blue">📑</div>
        <div class="kpi-info">
          <div class="kpi-label">Ingested Slips</div>
          <div class="kpi-value">${stats.total_slips_ingested}</div>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon amber">⚠️</div>
        <div class="kpi-info">
          <div class="kpi-label">Linen Loss Discrepancy</div>
          <div class="kpi-value">${stats.unreturned_linen_loss_count} pcs</div>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon green">💰</div>
        <div class="kpi-info">
          <div class="kpi-label">Approved Billing</div>
          <div class="kpi-value">GHS ${stats.approved_billing_total_ghs.toFixed(2)}</div>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon purple">🏨</div>
        <div class="kpi-info">
          <div class="kpi-label">Active Hotel Clients</div>
          <div class="kpi-value">${stats.active_clients_count}</div>
        </div>
      </div>
    </div>
  `;
}
