import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  TrendingUp,
  DollarSign,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  Plus,
  ArrowUpRight,
  ExternalLink,
  Search,
  Filter,
  RefreshCw,
  Sparkles,
  Smartphone,
  Building2,
  Check,
  X,
  Lock,
  Layers,
  HelpCircle,
  Receipt,
  FileText,
} from 'lucide-react';
import {
  fetchBillingOverview,
  fetchCustomerSubscriptions,
  updateCustomerSubscription,
  applyBoosterPack,
  extendCustomerTrial,
  convertTrialToPaid,
  fetchCustomerPayments,
  recordCustomerPayment,
  updatePaymentStatus,
  fetchPaidServicesCostMonitor,
  BillingOverview,
  CustomerSubscription,
  CustomerPayment,
  CostMonitorData,
  BoosterPackOption,
} from '../../lib/api';
import { useAutomation } from '../../context/AutomationContext';

type BillingTab = 'overview' | 'subscriptions' | 'trials' | 'payments' | 'costs';

export const AdminBillingSection: React.FC = () => {
  const { addLog } = useAutomation();

  const [activeTab, setActiveTab] = useState<BillingTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Overview Data
  const [overview, setOverview] = useState<BillingOverview | null>(null);

  // Subscriptions Data
  const [subscriptions, setSubscriptions] = useState<CustomerSubscription[]>([]);
  const [subFilter, setSubFilter] = useState('ALL');
  const [subSearch, setSubSearch] = useState('');

  // Payments Ledger Data
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [payFilter, setPayFilter] = useState('ALL');

  // Cost Monitor Data
  const [costData, setCostData] = useState<CostMonitorData | null>(null);
  const [costDays, setCostDays] = useState(30);

  // Modals
  const [selectedOrgForBooster, setSelectedOrgForBooster] = useState<CustomerSubscription | null>(null);
  const [boosterSlips, setBoosterSlips] = useState(500);
  const [boosterPriceGhs, setBoosterPriceGhs] = useState(550);
  const [boosterChannel, setBoosterChannel] = useState('MTN_MOMO');
  const [boosterRef, setBoosterRef] = useState('');
  const [isSubmittingBooster, setIsSubmittingBooster] = useState(false);

  // Edit Subscription Modal
  const [selectedOrgForEdit, setSelectedOrgForEdit] = useState<CustomerSubscription | null>(null);
  const [editTier, setEditTier] = useState('pro');
  const [editPrice, setEditPrice] = useState(2800);
  const [editCycle, setEditCycle] = useState('MONTHLY');
  const [editAllowance, setEditAllowance] = useState(3000);
  const [editOverage, setEditOverage] = useState(0.90);
  const [editContactName, setEditContactName] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [isSavingSub, setIsSavingSub] = useState(false);

  // Record Payment Modal
  const [isRecordPayOpen, setIsRecordPayOpen] = useState(false);
  const [payOrgId, setPayOrgId] = useState('');
  const [payAmount, setPayAmount] = useState<number>(2800);
  const [payPeriod, setPayPeriod] = useState('September 2026');
  const [payChannel, setPayChannel] = useState('MTN_MOMO');
  const [payType, setPayType] = useState('SUBSCRIPTION');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  // Load Overview & Data
  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [ov, subs, pays, costs] = await Promise.all([
        fetchBillingOverview().catch(() => null),
        fetchCustomerSubscriptions().catch(() => ({ organizations: [], total_count: 0 })),
        fetchCustomerPayments().catch(() => ({ payments: [], total_count: 0 })),
        fetchPaidServicesCostMonitor(costDays).catch(() => null),
      ]);

      if (ov) setOverview(ov);
      if (subs?.organizations) setSubscriptions(subs.organizations);
      if (pays?.payments) setPayments(pays.payments);
      if (costs) setCostData(costs);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load billing metrics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [costDays]);

  // Handle Option 2 Booster Pack Apply
  const handleApplyBooster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgForBooster) return;

    setIsSubmittingBooster(true);
    try {
      const res = await applyBoosterPack(selectedOrgForBooster.id, {
        slips_count: boosterSlips,
        amount_ghs: boosterPriceGhs,
        payment_channel: boosterChannel,
        transaction_reference: boosterRef.trim() || undefined,
        mark_as_paid: true,
        notes: `Option 2 Booster Pack applied by admin`,
      });

      addLog('success', `🎉 Applied +${boosterSlips} slips booster pack to ${selectedOrgForBooster.name}`);
      setSelectedOrgForBooster(null);
      setBoosterRef('');
      loadData();
    } catch (err: any) {
      alert(`Failed to apply booster pack: ${err.message}`);
    } finally {
      setIsSubmittingBooster(false);
    }
  };

  // Handle 1-Click Extend Trial
  const handleExtendTrial = async (org: CustomerSubscription, days: number = 14) => {
    try {
      await extendCustomerTrial(org.id, {
        additional_days: days,
        additional_slips: 50,
        notes: `Extended by platform administrator`,
      });
      addLog('success', `Extended trial for ${org.name} by ${days} days (+50 slips granted).`);
      loadData();
    } catch (err: any) {
      alert(`Trial extension failed: ${err.message}`);
    }
  };

  // Handle Convert Trial to Paid
  const handleConvertTrial = async (org: CustomerSubscription) => {
    const confirmed = confirm(`Convert trial for "${org.name}" to Active Paid Subscription (${org.currency} ${org.base_price}/mo)?`);
    if (!confirmed) return;

    try {
      await convertTrialToPaid(org.id, {
        plan_tier: org.plan_tier || 'pro',
        base_price: org.base_price || 2800.0,
        billing_cycle: org.billing_cycle || 'MONTHLY',
        currency: org.currency || 'GHS',
        payment_channel: 'MTN_MOMO',
        notes: 'Converted from trial by administrator',
      });
      addLog('success', `🎉 Converted ${org.name} to ACTIVE paid subscription.`);
      loadData();
    } catch (err: any) {
      alert(`Conversion failed: ${err.message}`);
    }
  };

  // Handle Save Subscription Changes
  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgForEdit) return;

    setIsSavingSub(true);
    try {
      await updateCustomerSubscription(selectedOrgForEdit.id, {
        plan_tier: editTier,
        base_price: editPrice,
        billing_cycle: editCycle,
        monthly_document_allowance: editAllowance,
        overage_rate_per_doc: editOverage,
        billing_contact_name: editContactName,
        billing_contact_email: editContactEmail,
        billing_contact_phone: editContactPhone,
      });

      addLog('success', `Updated subscription parameters for ${selectedOrgForEdit.name}`);
      setSelectedOrgForEdit(null);
      loadData();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setIsSavingSub(false);
    }
  };

  // Handle Record Payment
  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payOrgId) {
      alert('Please select a customer organization.');
      return;
    }

    setIsSubmittingPay(true);
    try {
      await recordCustomerPayment({
        organization_id: payOrgId,
        amount: payAmount,
        currency: 'GHS',
        period_covered: payPeriod,
        payment_channel: payChannel,
        payment_type: payType,
        transaction_reference: payRef.trim() || undefined,
        payment_status: 'PAID',
        admin_notes: payNotes,
      });

      addLog('success', `Recorded payment of GHS ${payAmount} for organization ${payOrgId}`);
      setIsRecordPayOpen(false);
      setPayRef('');
      setPayNotes('');
      loadData();
    } catch (err: any) {
      alert(`Payment recording failed: ${err.message}`);
    } finally {
      setIsSubmittingPay(false);
    }
  };

  // Handle Verify Payment
  const handleVerifyPayment = async (paymentId: number) => {
    try {
      await updatePaymentStatus(paymentId, 'PAID', 'Verified by Platform Administrator');
      addLog('success', `Verified payment #${paymentId} as PAID.`);
      loadData();
    } catch (err: any) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Top Header Toolbar */}
      <div className="glass-panel rounded-2xl p-5 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-md">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Platform Billing, Subscriptions &amp; Cost Monitor
              </h2>
              <p className="text-xs text-slate-400">
                Manage customer subscriptions, MoMo payment verifications, free trial lifecycle, and 3rd-party API infrastructure costs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              if (subscriptions.length > 0) setPayOrgId(subscriptions[0].id);
              setIsRecordPayOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/20 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Record MoMo / Wire Payment</span>
          </button>

          <button
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        {[
          { id: 'overview', label: 'Financial Overview & Margins', icon: TrendingUp },
          { id: 'subscriptions', label: `Customer Subscriptions (${subscriptions.length})`, icon: Building2 },
          { id: 'trials', label: `Free Trial Center (${subscriptions.filter((s) => s.subscription_status === 'TRIALING').length})`, icon: Clock },
          { id: 'payments', label: `Payments & MoMo Ledger (${payments.length})`, icon: Receipt },
          { id: 'costs', label: '3rd-Party Cost Monitor', icon: Zap },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                isActive
                  ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: FINANCIAL OVERVIEW & MARGINS */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Monthly Recurring Revenue */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Monthly Recurring Revenue</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-white tracking-tight">
                GHS {overview?.mrr_ghs.toLocaleString() || '2,800'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>≈ ${overview?.mrr_usd.toLocaleString() || '210'} / mo</span>
                <span className="font-mono text-emerald-400 font-bold">ARR: GHS {overview?.arr_ghs.toLocaleString() || '33,600'}</span>
              </div>
            </div>

            {/* KPI 2: 30-Day Third-Party Infrastructure Cost */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>3rd-Party Infrastructure Cost</span>
                <Zap className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-black text-sky-400 tracking-tight">
                GHS {overview?.infra_cost_30d_ghs.toLocaleString() || '18.40'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>Gemini OCR + Zoho + Mailjet</span>
                <span className="font-mono text-slate-300">(${overview?.infra_cost_30d_usd.toFixed(2) || '1.36'})</span>
              </div>
            </div>

            {/* KPI 3: Gross Profit Margin */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Gross Profit Margin</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-black text-emerald-400 tracking-tight flex items-baseline gap-2">
                <span>{overview?.gross_profit_margin_percent || 99.3}%</span>
                <span className="text-xs font-semibold text-emerald-500 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Elite SaaS
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Revenue collected vs. Cloud API COGS
              </div>
            </div>

            {/* KPI 4: Active Accounts & Trials */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Customer Pipeline</span>
                <Users className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-black text-white tracking-tight flex items-baseline gap-2">
                <span>{overview?.active_subscriptions_count || 1} Paid</span>
                <span className="text-xs font-bold text-amber-400 font-mono">
                  +{overview?.trialing_accounts_count || 0} Trials
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span className="text-amber-300">{overview?.expiring_trials_count || 0} trials expiring</span>
                <span className="text-rose-400 font-bold">{overview?.overdue_payments_count || 0} overdue</span>
              </div>
            </div>
          </div>

          {/* S4 Pricing Structure Showcase & Option 2 Boosters */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Starter Plan Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  Boutique &amp; Single Entity
                </span>
                <div className="text-xl font-bold text-white mt-1">GHS 850 <span className="text-xs font-normal text-slate-400">/ month</span></div>
                <p className="text-xs text-slate-400 mt-1">
                  For single restaurants, hotels, retail shops, or commercial laundries managing their own books.
                </p>
                <div className="mt-4 space-y-1.5 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Up to 500 documents / month</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Gemini 2.5/3.6 Flash Vision OCR</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>1-Click Sync to Zoho Books / QuickBooks</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Option 2 Add-ons</span>
                <span className="font-mono text-emerald-400 font-bold">+250 / +500 Slips</span>
              </div>
            </div>

            {/* Firm Pro Card (Recommended) */}
            <div className="bg-gradient-to-b from-slate-900 to-emerald-950/20 border-2 border-emerald-500/60 rounded-2xl p-5 space-y-3 flex flex-col justify-between shadow-xl shadow-emerald-950/30">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950 px-2.5 py-0.5 rounded border border-emerald-500/40">
                    Most Popular for CPAs
                  </span>
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl font-bold text-white mt-1">GHS 2,800 <span className="text-xs font-normal text-slate-400">/ month</span></div>
                <p className="text-xs text-slate-400 mt-1">
                  Purpose-built for accounting &amp; advisory firms managing multi-client portfolios.
                </p>
                <div className="mt-4 space-y-1.5 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Up to 15 client organizations included</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>3,000 documents / month across all clients</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Client Clarification Magic Portal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Automatic MoMo &amp; Bank feed matching</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Extra Clients</span>
                <span className="font-mono text-emerald-400 font-bold">GHS 150 / client / mo</span>
              </div>
            </div>

            {/* Enterprise Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  Scale &amp; Enterprise
                </span>
                <div className="text-xl font-bold text-white mt-1">GHS 6,500 <span className="text-xs font-normal text-slate-400">/ month</span></div>
                <p className="text-xs text-slate-400 mt-1">
                  For large accounting practices (30+ clients) or high-volume multi-branch hospitality groups.
                </p>
                <div className="mt-4 space-y-1.5 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Up to 50 client organizations</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>10,000 documents / month</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Custom blueprint pipeline rules &amp; SLA</span>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Support</span>
                <span className="font-mono text-emerald-400 font-bold">Dedicated Account Mgr</span>
              </div>
            </div>
          </div>

          {/* Option 2 Booster Packs Banner */}
          <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                    Option 2 Approved
                  </span>
                  <h3 className="text-sm font-bold text-white">Mid-Month Document Booster Packs</h3>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  When any customer reaches their monthly document quota, they never stop. Slips draw from their active booster credit balance, and credits roll over month to month without expiring.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {overview?.booster_packs?.map((bp: BoosterPackOption, idx: number) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center min-w-[110px]"
                  >
                    <div className="text-xs font-black text-white">+{bp.slips} Slips</div>
                    <div className="text-[11px] font-mono text-emerald-400 font-bold">GHS {bp.price_ghs}</div>
                    <div className="text-[9px] text-slate-500 font-mono">GHS {bp.unit_rate}/slip</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMER SUBSCRIPTIONS & BOOSTER PACKS */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            {/* Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-md bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={subSearch}
                  onChange={(e) => setSubSearch(e.target.value)}
                  placeholder="Search organizations by name or slug..."
                  className="bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none w-full"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={subFilter}
                  onChange={(e) => setSubFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active Paid</option>
                  <option value="TRIALING">Trialing</option>
                  <option value="PAST_DUE">Past Due</option>
                  <option value="GRACE_PERIOD">Grace Period</option>
                </select>
              </div>
            </div>

            {/* Subscriptions Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="pb-3 pl-2">Customer Organization</th>
                    <th className="pb-3">Plan Tier</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Monthly Usage</th>
                    <th className="pb-3">Option 2 Booster Balance</th>
                    <th className="pb-3">Price / Cycle</th>
                    <th className="pb-3 text-right pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {subscriptions
                    .filter((s) => {
                      if (subFilter !== 'ALL' && s.subscription_status !== subFilter) return false;
                      if (subSearch && !s.name.toLowerCase().includes(subSearch.toLowerCase()) && !s.id.toLowerCase().includes(subSearch.toLowerCase())) return false;
                      return true;
                    })
                    .map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 pl-2">
                          <div className="font-bold text-white">{sub.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {sub.id} • {sub.billing_contact_phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                            {sub.plan_tier?.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              sub.subscription_status === 'ACTIVE'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                                : sub.subscription_status === 'TRIALING'
                                ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                                : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                            }`}
                          >
                            {sub.subscription_status}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="space-y-1 max-w-[140px]">
                            <div className="flex justify-between text-[10px] font-mono">
                              <span>{sub.monthly_documents_processed} / {sub.monthly_document_allowance}</span>
                              <span className={sub.quota_utilization_percent > 85 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                {sub.quota_utilization_percent}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  sub.quota_utilization_percent > 90
                                    ? 'bg-rose-500'
                                    : sub.quota_utilization_percent > 70
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, sub.quota_utilization_percent)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3">
                          {sub.topup_document_balance > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                              +{sub.topup_document_balance} Slips (Active)
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 font-mono">0 slips</span>
                          )}
                        </td>
                        <td className="py-3 font-mono font-bold text-white">
                          {sub.currency} {sub.base_price?.toLocaleString()}
                          <span className="text-[10px] font-normal text-slate-400 block">
                            {sub.billing_cycle?.toLowerCase()}
                          </span>
                        </td>
                        <td className="py-3 text-right pr-2 space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedOrgForBooster(sub);
                              setBoosterSlips(500);
                              setBoosterPriceGhs(550);
                            }}
                            className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-bold transition cursor-pointer"
                          >
                            + Booster Pack
                          </button>
                          <button
                            onClick={() => {
                              setSelectedOrgForEdit(sub);
                              setEditTier(sub.plan_tier || 'pro');
                              setEditPrice(sub.base_price || 2800);
                              setEditCycle(sub.billing_cycle || 'MONTHLY');
                              setEditAllowance(sub.monthly_document_allowance || 3000);
                              setEditOverage(sub.overage_rate_per_doc || 0.90);
                              setEditContactName(sub.billing_contact_name || '');
                              setEditContactEmail(sub.billing_contact_email || '');
                              setEditContactPhone(sub.billing_contact_phone || '');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FREE TRIAL LIFECYCLE CENTER */}
      {activeTab === 'trials' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">Free Trial Onboarding &amp; Conversion Cockpit</h3>
              <p className="text-xs text-slate-400">
                Track prospective firm trials. Standard pilot gives 14 days or 50 free slips. Extend or convert trials with 1 click.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {subscriptions
                .filter((s) => s.subscription_status === 'TRIALING')
                .map((trial) => (
                  <div
                    key={trial.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{trial.name}</span>
                        <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950 border border-amber-500/40 px-2 py-0.5 rounded-full">
                          {trial.trial_days_remaining !== undefined ? `${trial.trial_days_remaining}d Left` : 'Active Trial'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {trial.billing_contact_phone || trial.billing_contact_email || 'Contact pending'}
                      </p>

                      <div className="pt-2">
                        <div className="flex justify-between text-[11px] text-slate-300 font-mono mb-1">
                          <span>Trial Slips Used</span>
                          <span className="font-bold">{trial.monthly_documents_processed} / {trial.trial_document_quota}</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{
                              width: `${Math.min(100, ((trial.monthly_documents_processed || 0) / (trial.trial_document_quota || 50)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-850 flex items-center gap-2">
                      <button
                        onClick={() => handleExtendTrial(trial, 14)}
                        className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-bold transition cursor-pointer"
                      >
                        +14 Days
                      </button>
                      <button
                        onClick={() => handleConvertTrial(trial)}
                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow-md"
                      >
                        Convert to Paid
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {subscriptions.filter((s) => s.subscription_status === 'TRIALING').length === 0 && (
              <div className="py-12 text-center text-slate-500 text-xs">
                No active trials in the pipeline right now. Inbound demo requests and pilots will populate here.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: PAYMENTS & MOMO LEDGER */}
      {activeTab === 'payments' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">Platform Payments Ledger (MoMo &amp; Bank Wire)</h3>
                <p className="text-xs text-slate-400">
                  Track customer subscription invoices, Mobile Money transaction IDs, and manual wire receipts.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={payFilter}
                  onChange={(e) => setPayFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
                >
                  <option value="ALL">All Payment Statuses</option>
                  <option value="PAID">Paid / Verified</option>
                  <option value="PENDING_VERIFICATION">Pending Verification</option>
                  <option value="OVERDUE">Overdue</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="pb-3 pl-2">Invoice / Ref</th>
                    <th className="pb-3">Organization</th>
                    <th className="pb-3">Amount</th>
                    <th className="pb-3">Type</th>
                    <th className="pb-3">Channel &amp; MoMo ID</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Date</th>
                    <th className="pb-3 text-right pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {payments
                    .filter((p) => payFilter === 'ALL' || p.payment_status === payFilter)
                    .map((pay) => (
                      <tr key={pay.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 pl-2 font-mono text-sky-400 font-bold">
                          {pay.invoice_number}
                        </td>
                        <td className="py-3 font-semibold text-white">
                          {pay.organization_id}
                        </td>
                        <td className="py-3 font-mono font-bold text-emerald-400">
                          {pay.currency} {pay.amount.toLocaleString()}
                        </td>
                        <td className="py-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {pay.payment_type}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-slate-300">
                          <span className="text-amber-400 font-bold">{pay.payment_channel}</span>
                          {pay.transaction_reference && (
                            <span className="text-[10px] text-slate-400 block">
                              Ref: {pay.transaction_reference}
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              pay.payment_status === 'PAID'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                                : pay.payment_status === 'PENDING_VERIFICATION'
                                ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                                : 'bg-rose-950/80 text-rose-300 border-rose-500/40'
                            }`}
                          >
                            {pay.payment_status}
                          </span>
                        </td>
                        <td className="py-3 text-[11px] text-slate-400 font-mono">
                          {pay.created_at ? new Date(pay.created_at).toLocaleDateString() : '-'}
                        </td>
                        <td className="py-3 text-right pr-2">
                          {pay.payment_status === 'PENDING_VERIFICATION' && (
                            <button
                              onClick={() => handleVerifyPayment(pay.id)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                            >
                              Verify MoMo
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: 3RD-PARTY PAID SERVICES COST MONITOR */}
      {activeTab === 'costs' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">3rd-Party Paid Services Infrastructure Monitor</h3>
                <p className="text-xs text-slate-400">
                  Real-time token and call consumption across Google Gemini Vision, Zoho Books, Mailjet, and Google Cloud.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Timeframe:</span>
                <select
                  value={costDays}
                  onChange={(e) => setCostDays(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                </select>
              </div>
            </div>

            {/* Service Breakdown Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {costData?.summary?.services &&
                Object.entries(costData.summary.services).map(([key, s]: [string, any]) => (
                  <div
                    key={key}
                    className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{s.name}</span>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                        GHS {s.cost_ghs} (${s.cost_usd})
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300 font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Total Calls:</span>
                        <span className="font-bold text-white">{s.calls.toLocaleString()}</span>
                      </div>
                      {s.tokens > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Tokens Processed:</span>
                          <span className="text-sky-400">{s.tokens.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Avg Latency:</span>
                        <span>{s.avg_latency_ms} ms</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Errors:</span>
                        <span className={s.errors > 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                          {s.errors}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            {/* Customer Infrastructure Cost Attribution */}
            <div className="pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                Top Cost-Consuming Customer Organizations
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="pb-2.5 pl-2">Customer / Client ID</th>
                      <th className="pb-2.5">Total API Operations</th>
                      <th className="pb-2.5">Gemini Tokens</th>
                      <th className="pb-2.5">Total Infrastructure Cost (GHS)</th>
                      <th className="pb-2.5">USD Equiv</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-200 font-mono">
                    {costData?.summary?.client_attribution?.map((ca: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2.5 pl-2 font-bold text-white">{ca.client_id}</td>
                        <td className="py-2.5">{ca.total_calls} calls</td>
                        <td className="py-2.5 text-sky-400">{ca.gemini_tokens.toLocaleString()}</td>
                        <td className="py-2.5 text-emerald-400 font-bold">GHS {ca.cost_ghs}</td>
                        <td className="py-2.5 text-slate-400">${ca.cost_usd}</td>
                      </tr>
                    ))}
                    {(!costData?.summary?.client_attribution || costData.summary.client_attribution.length === 0) && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500 text-xs font-sans">
                          No customer usage recorded in this period yet. Telemetry populates as pipelines run.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Apply Option 2 Booster Pack */}
      {selectedOrgForBooster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Apply Option 2 Booster Pack</h3>
                <p className="text-xs text-slate-400">Organization: {selectedOrgForBooster.name}</p>
              </div>
              <button
                onClick={() => setSelectedOrgForBooster(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyBooster} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                  Select Booster Pack (Credits Never Expire)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { slips: 250, price: 320 },
                    { slips: 500, price: 550 },
                    { slips: 1000, price: 950 },
                  ].map((bp) => (
                    <button
                      key={bp.slips}
                      type="button"
                      onClick={() => {
                        setBoosterSlips(bp.slips);
                        setBoosterPriceGhs(bp.price);
                      }}
                      className={`p-2.5 rounded-xl border text-center transition cursor-pointer ${
                        boosterSlips === bp.slips
                          ? 'bg-emerald-950 border-emerald-500 text-white font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div>+{bp.slips} Slips</div>
                      <div className="text-[10px] text-emerald-400 font-mono">GHS {bp.price}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Payment Channel
                </label>
                <select
                  value={boosterChannel}
                  onChange={(e) => setBoosterChannel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="MTN_MOMO">MTN Mobile Money</option>
                  <option value="VODAFONE_CASH">Telecel / Vodafone Cash</option>
                  <option value="BANK_DEPOSIT">Bank Transfer / Wire</option>
                  <option value="CARD">Credit / Debit Card</option>
                  <option value="MANUAL_OVERRIDE">Admin Courtesy Override</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  MoMo Transaction ID / Reference (Optional)
                </label>
                <input
                  type="text"
                  value={boosterRef}
                  onChange={(e) => setBoosterRef(e.target.value)}
                  placeholder="e.g. MM-2026-99410"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrgForBooster(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBooster}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingBooster ? 'Applying...' : `Activate +${boosterSlips} Slips`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Customer Subscription */}
      {selectedOrgForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Edit Subscription: {selectedOrgForEdit.name}</h3>
                <p className="text-xs text-slate-400">Modify plan tier, included document limits, and billing terms.</p>
              </div>
              <button
                onClick={() => setSelectedOrgForEdit(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubscription} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Plan Tier
                  </label>
                  <select
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="starter">Starter (500 docs)</option>
                    <option value="pro">CPA Firm Pro (3,000 docs)</option>
                    <option value="enterprise">Enterprise (10,000 docs)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Base Price (GHS)
                  </label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Monthly Document Allowance
                  </label>
                  <input
                    type="number"
                    value={editAllowance}
                    onChange={(e) => setEditAllowance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Billing Cycle
                  </label>
                  <select
                    value={editCycle}
                    onChange={(e) => setEditCycle(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="ANNUALLY">Annually (15% Off)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Billing Contact Name
                  </label>
                  <input
                    type="text"
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    placeholder="e.g. K. Danso"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    MoMo Phone Number
                  </label>
                  <input
                    type="text"
                    value={editContactPhone}
                    onChange={(e) => setEditContactPhone(e.target.value)}
                    placeholder="024XXXXXXX"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrgForEdit(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSub}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
                >
                  {isSavingSub ? 'Saving...' : 'Save Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Record Offline / MoMo Payment */}
      {isRecordPayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Record MoMo / Bank Wire Payment</h3>
                <p className="text-xs text-slate-400">Post an incoming platform subscription settlement.</p>
              </div>
              <button
                onClick={() => setIsRecordPayOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPaymentSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Customer Organization
                </label>
                <select
                  value={payOrgId}
                  onChange={(e) => setPayOrgId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                >
                  {subscriptions.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Amount (GHS)
                  </label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(Number(e.target.value))}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Payment Type
                  </label>
                  <select
                    value={payType}
                    onChange={(e) => setPayType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="SUBSCRIPTION">Monthly Subscription</option>
                    <option value="BOOSTER_PACK">Booster Top-Up Pack</option>
                    <option value="OVERAGE">Overage Settlement</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Payment Channel
                  </label>
                  <select
                    value={payChannel}
                    onChange={(e) => setPayChannel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="MTN_MOMO">MTN Mobile Money</option>
                    <option value="VODAFONE_CASH">Vodafone / Telecel Cash</option>
                    <option value="BANK_DEPOSIT">Bank Deposit / Wire</option>
                    <option value="CARD">Debit / Credit Card</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Period Covered
                  </label>
                  <input
                    type="text"
                    value={payPeriod}
                    onChange={(e) => setPayPeriod(e.target.value)}
                    placeholder="e.g. September 2026"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  MoMo Transaction ID / Reference
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="e.g. MTN-9938102938"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRecordPayOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPay}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingPay ? 'Recording...' : 'Confirm & Post Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
