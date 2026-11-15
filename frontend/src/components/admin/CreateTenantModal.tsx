import React, { useState } from 'react';
import { Building2, RefreshCw, X } from 'lucide-react';
import { createAdminOrganization } from '../../lib/api';

interface CreateTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const CreateTenantModal: React.FC<CreateTenantModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState('ACCOUNTING_FIRM');
  const [planTier, setPlanTier] = useState('STARTER');
  const [maxClients, setMaxClients] = useState(5);
  const [trialDays, setTrialDays] = useState(14);
  const [billingEmail, setBillingEmail] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [storageStrategy, setStorageStrategy] = useState('MANAGED_GDRIVE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Organization name is required.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await createAdminOrganization({
        name: name.trim(),
        org_type: orgType,
        plan_tier: planTier,
        max_clients: Number(maxClients) || 1,
        trial_days: Number(trialDays) || 14,
        billing_email: billingEmail.trim() || undefined,
        owner_email: ownerEmail.trim() || undefined,
        owner_name: ownerName.trim() || undefined,
        custom_portal_subdomain: subdomain.trim() || undefined,
        white_label_logo_url: logoUrl.trim() || undefined,
        storage_strategy: storageStrategy,
      });
      setName('');
      setBillingEmail('');
      setOwnerEmail('');
      setOwnerName('');
      setSubdomain('');
      setLogoUrl('');
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create organization.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] flex items-center justify-center text-[#0284C7]">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0F172A]">Provision New Tenant Organization</h3>
              <p className="text-[11px] text-[#64748B]">
                Creates an isolated tenant workspace, trial window, and optional initial Admin owner.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Organization Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Accra Advisory Partners"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Organization Type
              </label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              >
                <option value="ACCOUNTING_FIRM">Accounting Firm (Multi-Client)</option>
                <option value="INDIVIDUAL_BUSINESS">Individual Business (Single Company)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Initial Plan Tier
              </label>
              <select
                value={planTier}
                onChange={(e) => setPlanTier(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              >
                <option value="STARTER">STARTER</option>
                <option value="GROWTH">GROWTH</option>
                <option value="FIRM_PRO">FIRM_PRO</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Client Quota (Max Clients)
              </label>
              <input
                type="number"
                min={1}
                value={maxClients}
                onChange={(e) => setMaxClients(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Trial Period (Days)
              </label>
              <input
                type="number"
                min={0}
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Initial Owner Email (Optional)
              </label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="partner@firm.com"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Initial Owner Name
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Managing Partner"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Billing Email
              </label>
              <input
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="billing@firm.com"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Storage Strategy (BYOS)
              </label>
              <select
                value={storageStrategy}
                onChange={(e) => setStorageStrategy(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              >
                <option value="MANAGED_GDRIVE">Managed Google Drive</option>
                <option value="BYOS_GDRIVE">BYOS Customer Google Drive</option>
                <option value="S4_CLOUD">S4 Managed Cloud Storage</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Custom Portal Subdomain
              </label>
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="portal.firm.com"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                White-Label Logo URL
              </label>
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.firm.com/logo.png"
                className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] focus:outline-none focus:border-[#0284C7]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-60"
            >
              {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Create Tenant Organization
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
