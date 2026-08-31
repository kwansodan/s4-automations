import React, { useState, useEffect } from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { fetchAccountingCatalog } from '../../lib/api';
import type {
  IngestionPipeline,
  StarterRecipe,
  AccountingSoftware,
} from '../../types/client';
import { ACCOUNTING_PLATFORMS } from '../../types/client';
import {
  X,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Building2,
  Sparkles,
  Cloud,
  Folder,
  Mail,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Sliders,
  Layers,
  ArrowRight,
  RefreshCw,
  Info,
  Users,
  DollarSign,
  Plus,
  Trash2,
  PlayCircle,
  Clock,
  MessageSquare,
} from 'lucide-react';

const STARTER_RECIPES: StarterRecipe[] = [
  {
    id: 'wholesale_trading',
    name: 'Wholesale, Retail & Distribution',
    icon: '🛍️',
    tagline: 'Multi-stream AR Sales, AP Supplier Bills & Bank Rec',
    description: 'Automatic ingestion of daily POS tally slips, counter sales, China/supplier vendor bills, and monthly bank statement reconciliation.',
    defaultVolume: '1,200+ Docs / mo',
    currency: 'GHS',
    pipelines: [
      {
        id: 'p_ar_invoices',
        name: 'Sales Invoices & Counter Delivery Slips',
        section: 'AR',
        entity_type: 'ar_sales_invoice',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '4000 - Commercial Sales Revenue',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
      {
        id: 'p_ar_payments',
        name: 'Customer MoMo & Wire Proof of Payments',
        section: 'AR',
        entity_type: 'ar_customer_payment',
        source_type: 'email',
        source_identifier: '',
        default_account_code: '1001 - Main Bank / Clearing Account',
        auto_post_to_zoho: false,
        trigger_type: 'realtime_webhook',
      },
      {
        id: 'p_ap_bills',
        name: 'Vendor & Supplier Bills',
        section: 'AP',
        entity_type: 'ap_vendor_bill',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '5000 - Cost of Goods Sold (Inventory)',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
      {
        id: 'p_bank_rec',
        name: 'Bank Statements & Feeds',
        section: 'BANK',
        entity_type: 'bank_statement',
        source_type: 'onedrive',
        source_identifier: '',
        default_account_code: '1001 - Main Operating Bank Account',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: '1st of Month at 9:00 AM',
        cron_expression: '0 9 1 * *',
      },
    ],
    blueprints: [
      { title: 'Multi-Channel Ingestion', desc: 'Active ingestion across Drive, Email, and OneDrive', status: 'active' },
      { title: 'Accounting Contract Validator', desc: 'Strict entity-driven schema checks & anomaly engine', status: 'active' },
      { title: 'Review Ledger & Posting', desc: 'Staging ledger with 1-click draft creation to accounting', status: 'active' },
    ],
  },
  {
    id: 'hospitality_services',
    name: 'Commercial Laundry & Hospitality',
    icon: '🧺',
    tagline: 'Handwritten Slip OCR Vision & Detergent AP Bills',
    description: 'Physical handwritten pickup/delivery slip OCR vision, linen loss reconciliation, supplier detergent bills, and Zoho draft billing.',
    defaultVolume: '350+ Slips / mo',
    currency: 'GHS',
    pipelines: [
      {
        id: 'p_laundry_slips',
        name: 'Daily Pickup & Delivery Slips',
        section: 'AR',
        entity_type: 'ar_sales_invoice',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '4001 - Commercial Laundry Revenue',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
      {
        id: 'p_laundry_detergent_bills',
        name: 'Chemical & Detergent Supplier Bills',
        section: 'AP',
        entity_type: 'ap_vendor_bill',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '5002 - Cleaning Supplies & Detergents',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
    ],
    blueprints: [
      { title: 'Handwritten Slip Vision OCR', desc: 'Gemini 3.6 Flash structured JSON extraction on daily slips', status: 'active' },
      { title: 'Loss Reconciler', desc: 'Calculates pickup vs delivery discrepancies and billing summaries', status: 'active' },
      { title: 'Draft Invoicing', desc: '1-Click draft invoice appending newly approved line items', status: 'active' },
    ],
  },
  {
    id: 'real_estate_management',
    name: 'Real Estate & Property Management',
    icon: '🏢',
    tagline: 'Tenant Rent Invoices, MoMo Receipts & Utility Bills',
    description: 'Automated tenant rent receipt processing, recurring billing, shared utility cost allocation, and late notice dispatch.',
    defaultVolume: '85+ Units / mo',
    currency: 'GHS',
    pipelines: [
      {
        id: 'p_prop_rent',
        name: 'Tenant Rent Receipts & Invoices',
        section: 'AR',
        entity_type: 'ar_sales_invoice',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '4002 - Rental Income',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: '1st of Month at 9:00 AM',
        cron_expression: '0 9 1 * *',
      },
      {
        id: 'p_prop_momo',
        name: 'Tenant MoMo Payment Proofs',
        section: 'AR',
        entity_type: 'ar_customer_payment',
        source_type: 'email',
        source_identifier: '',
        default_account_code: '1002 - Mobile Money Merchant Account',
        auto_post_to_zoho: false,
        trigger_type: 'realtime_webhook',
      },
      {
        id: 'p_prop_utilities',
        name: 'Shared Utility & Electricity Bills',
        section: 'AP',
        entity_type: 'ap_vendor_bill',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '5004 - Utilities Expense (Electricity & Water)',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
    ],
    blueprints: [
      { title: 'Rent Receipt OCR Ingestion', desc: 'Extract tenant mobile money / bank transfer receipts', status: 'active' },
      { title: 'Utility Apportionment', desc: 'Apportion shared water/power bills across occupied units', status: 'in_progress' },
      { title: 'Tenant Monthly Invoicing', desc: 'Generate tenant invoices with automated email/SMS dispatch', status: 'queued' },
    ],
  },
  {
    id: 'financial_advisory',
    name: 'Asset Management & Advisory',
    icon: '⚡',
    tagline: 'Advisory Billing, Multi-Currency Bank Rec & Journals',
    description: 'Multi-currency PDF bank statement parsing, automated chart of accounts matching, and journal batch posting.',
    defaultVolume: '1,500+ Tx / mo',
    currency: 'USD',
    pipelines: [
      {
        id: 'p_fin_retainer',
        name: 'Advisory Retainer Invoices',
        section: 'AR',
        entity_type: 'ar_sales_invoice',
        source_type: 'google_drive',
        source_identifier: '',
        default_account_code: '4005 - Retainer Advisory Fees',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: '1st of Month at 9:00 AM',
        cron_expression: '0 9 1 * *',
      },
      {
        id: 'p_fin_bank',
        name: 'Multi-Currency Bank Statements',
        section: 'BANK',
        entity_type: 'bank_statement',
        source_type: 'onedrive',
        source_identifier: '',
        default_account_code: '1005 - USD Corporate Checking',
        auto_post_to_zoho: false,
        trigger_type: 'scheduled_cron',
        cron_schedule_human: 'Daily at 8:00 PM',
        cron_expression: '0 20 * * *',
      },
      {
        id: 'p_fin_journal',
        name: 'Manual Journals & Accruals',
        section: 'GL',
        entity_type: 'gl_journal',
        source_type: 'manual',
        source_identifier: '',
        default_account_code: '9000 - General Ledger Accruals',
        auto_post_to_zoho: false,
        trigger_type: 'manual_only',
      },
    ],
    blueprints: [
      { title: 'Bank Statement PDF Parser', desc: 'Extract structured transactions from multi-bank statements', status: 'active' },
      { title: 'AI Categorization', desc: 'Fuzzy-match chart of accounts and assign expense categories', status: 'in_progress' },
      { title: 'Journal Batch Poster', desc: 'Post balanced double-entry journals into accounting API', status: 'queued' },
    ],
  },
  {
    id: 'custom_modular',
    name: 'Custom Clean Organization',
    icon: '🏢',
    tagline: 'Start with Blank Setup (Add Streams Manually in Workspace)',
    description: 'Register client organization details first, and build customized ingestion streams post-onboarding using the Pipeline Setup Wizard.',
    defaultVolume: 'Flexible',
    currency: 'GHS',
    pipelines: [],
    blueprints: [
      { title: 'Source Ingestion', desc: 'Configured pipeline streams', status: 'active' },
      { title: 'Contract Validation', desc: 'Strict field checks', status: 'in_progress' },
      { title: 'Accounting Posting', desc: 'Automated entry synchronization', status: 'queued' },
    ],
  },
];

export const ClientSetupWizardModal: React.FC = () => {
  const { isWizardOpen, setIsWizardOpen, createClientFromWizard, wizardDraft, saveWizardDraft, clearWizardDraft } = useClient();
  const { setActiveTab, addLog } = useAutomation();

  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: Organization Profile State
  const [name, setName] = useState<string>('');
  const [selectedRecipe, setSelectedRecipe] = useState<string>('wholesale_trading');
  const [icon, setIcon] = useState<string>('🛍️');
  const [currency, setCurrency] = useState<string>('GHS');
  const [projectedVolume, setProjectedVolume] = useState<string>('1,200+ Docs / mo');
  const [description, setDescription] = useState<string>('');

  // Step 2: Target Accounting Platform State
  const [accountingSoftware, setAccountingSoftware] = useState<AccountingSoftware>('zoho_books');
  const [zohoOrgId, setZohoOrgId] = useState<string>('');
  const [defaultIncomeAccount, setDefaultIncomeAccount] = useState<string>('4000 - Commercial Sales Revenue');
  const [taxRateVat, setTaxRateVat] = useState<string>('Standard Ghana GRA (15% VAT + 2.5% NHIL + 2.5% GETFund + 1% COVID)');

  // Step 2 API Dynamic Discovery State
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [syncedContacts, setSyncedContacts] = useState<any[] | null>(null);
  const [syncedItemsCount, setSyncedItemsCount] = useState<number | null>(null);

  // Step 3: Global AI Guardrails State
  const [aiEngine, setAiEngine] = useState<string>('gemini_flash_vision');
  const [varianceTolerance, setVarianceTolerance] = useState<number>(5.0);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(80);
  const [enableSheetsSync, setEnableSheetsSync] = useState<boolean>(true);
  const [notificationEmail, setNotificationEmail] = useState<string>('cdanso@service4gh.com');

  // Step 4: Starter Pipelines State
  const [configuredPipelines, setConfiguredPipelines] = useState<IngestionPipeline[]>(STARTER_RECIPES[0].pipelines);

  // Loading & Submission State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Initialize or resume draft
  useEffect(() => {
    if (wizardDraft) {
      if (wizardDraft.name !== undefined) setName(wizardDraft.name);
      if (wizardDraft.selectedRecipe) setSelectedRecipe(wizardDraft.selectedRecipe);
      if (wizardDraft.icon !== undefined) setIcon(wizardDraft.icon);
      if (wizardDraft.currency !== undefined) setCurrency(wizardDraft.currency);
      if (wizardDraft.projectedVolume !== undefined) setProjectedVolume(wizardDraft.projectedVolume);
      if (wizardDraft.description !== undefined) setDescription(wizardDraft.description);
      if (wizardDraft.accountingSoftware !== undefined) setAccountingSoftware(wizardDraft.accountingSoftware);
      if (wizardDraft.zohoOrgId !== undefined) setZohoOrgId(wizardDraft.zohoOrgId);
      if (wizardDraft.defaultIncomeAccount !== undefined) setDefaultIncomeAccount(wizardDraft.defaultIncomeAccount);
      if (wizardDraft.taxRateVat !== undefined) setTaxRateVat(wizardDraft.taxRateVat);
      if (wizardDraft.configuredPipelines !== undefined) setConfiguredPipelines(wizardDraft.configuredPipelines);
      if (wizardDraft.aiEngine !== undefined) setAiEngine(wizardDraft.aiEngine);
      if (wizardDraft.varianceTolerance !== undefined) setVarianceTolerance(wizardDraft.varianceTolerance);
      if (wizardDraft.confidenceThreshold !== undefined) setConfidenceThreshold(wizardDraft.confidenceThreshold);
      if (wizardDraft.enableSheetsSync !== undefined) setEnableSheetsSync(wizardDraft.enableSheetsSync);
      if (wizardDraft.notificationEmail !== undefined) setNotificationEmail(wizardDraft.notificationEmail);
      if (wizardDraft.currentStep !== undefined) setCurrentStep(Math.min(wizardDraft.currentStep, 4));
    }
  }, [wizardDraft]);

  // Auto-persist draft changes to localStorage
  const syncDraft = (overrideStep?: number) => {
    saveWizardDraft({
      name,
      selectedRecipe,
      icon,
      currency,
      projectedVolume,
      description,
      accountingSoftware,
      zohoOrgId,
      defaultIncomeAccount,
      taxRateVat,
      configuredPipelines,
      aiEngine,
      varianceTolerance,
      confidenceThreshold,
      enableSheetsSync,
      notificationEmail,
      currentStep: overrideStep ?? currentStep,
    });
  };

  const handleResetDraft = () => {
    if (confirm('Are you sure you want to discard your draft and start fresh?')) {
      clearWizardDraft();
      setName('');
      setSelectedRecipe('wholesale_trading');
      setIcon('🛍️');
      setCurrency('GHS');
      setProjectedVolume('1,200+ Docs / mo');
      setDescription('');
      setAccountingSoftware('zoho_books');
      setZohoOrgId('');
      setConfiguredPipelines([...STARTER_RECIPES[0].pipelines]);
      setCurrentStep(1);
    }
  };

  // Handle Recipe Change
  const handleSelectRecipe = (recipeId: string) => {
    const recipe = STARTER_RECIPES.find((p) => p.id === recipeId);
    if (!recipe) return;
    setSelectedRecipe(recipe.id);
    setIcon(recipe.icon);
    setConfiguredPipelines([...recipe.pipelines]);
    setProjectedVolume(recipe.defaultVolume);
    setCurrency(recipe.currency);
    if (!description || description === STARTER_RECIPES.find((p) => p.id === selectedRecipe)?.description) {
      setDescription(recipe.description);
    }
  };

  const handleFetchAccountingData = async () => {
    setIsFetchingData(true);
    try {
      const data = await fetchAccountingCatalog(accountingSoftware, zohoOrgId || undefined);
      if (data && data.contacts) {
        setSyncedContacts(data.contacts);
        setSyncedItemsCount(data.items_count || data.items?.length || 0);
        addLog('success', `[${data.platform_name || 'ACCOUNTING API'}] Synced ${data.contacts_count || (data.contacts && data.contacts.length) || 0} customer contacts & ${data.items_count || 0} catalog items.`);
      }
    } catch (err: any) {
      addLog('warning', `Could not fetch live accounting contacts: ${err.message}`);
    } finally {
      setIsFetchingData(false);
    }
  };

  const handleStepJump = (stepNum: number) => {
    syncDraft(stepNum);
    setCurrentStep(stepNum);
  };

  const handleNextStep = () => {
    const nextStep = Math.min(currentStep + 1, 4);
    syncDraft(nextStep);
    setCurrentStep(nextStep);
  };

  const handlePrevStep = () => {
    const prevStep = Math.max(currentStep - 1, 1);
    syncDraft(prevStep);
    setCurrentStep(prevStep);
  };

  const handleLaunchClient = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      const currentRecipe = STARTER_RECIPES.find((p) => p.id === selectedRecipe);
      const currentPlatform = ACCOUNTING_PLATFORMS.find((p) => p.id === accountingSoftware);
      const blueprints = currentRecipe?.blueprints || [
        { title: 'Source Ingestion', desc: 'Modular multi-pipeline streams', status: 'active' },
        { title: 'AI Extraction', desc: 'Custom vision models for document extraction', status: 'in_progress' },
        { title: 'Accounting Posting Engine', desc: 'Sync approved transactions into accounting platform', status: 'queued' },
      ];

      await createClientFromWizard({
        name: name.trim(),
        industry: currentRecipe?.name || 'Financial & Professional Services',
        icon: icon || '🏢',
        status: 'dev',
        status_text: 'In Development',
        description: description.trim() || currentRecipe?.description,
        accounting_software: accountingSoftware,
        source_type: configuredPipelines[0]?.source_type || 'google_drive',
        source_email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}@inbound.service4gh.com`,
        zoho_org_id: zohoOrgId,
        currency,
        projectedMonthlyVolume: projectedVolume,
        blueprints,
        pipelines: configuredPipelines,
        active_integrations: [
          'Gemini Vision',
          currentPlatform?.name || 'Accounting Platform',
          'Inngest',
        ],
        custom_config: {
          currency,
          volume: projectedVolume,
          variance_tolerance: varianceTolerance,
          confidence_threshold: confidenceThreshold,
          enable_sheets_sync: enableSheetsSync,
          notification_email: notificationEmail,
          default_income_account: defaultIncomeAccount,
          tax_rate_vat: taxRateVat,
        },
      });

      addLog('success', `🎉 Client organization "${name}" registered successfully with ${configuredPipelines.length} initial ingestion pipelines!`);
      clearWizardDraft();
      setIsWizardOpen(false);
      setActiveTab('workspace');
    } catch (err: any) {
      addLog('error', `Failed to create client: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isWizardOpen) return null;

  const stepsList = [
    { num: 1, title: 'Organization Profile', icon: Building2 },
    { num: 2, title: 'Target Accounting System', icon: Sliders },
    { num: 3, title: 'AI & Review Guardrails', icon: Sparkles },
    { num: 4, title: 'Starter Streams & Launch', icon: ShieldCheck },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  New Client Organization Onboarding
                </h2>
                <span className="text-[10px] bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono px-2 py-0.5 rounded-full font-bold">
                  Step {currentStep} of 4
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Register a new client entity, target accounting software credentials, and firm-wide AI quality guardrails.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {wizardDraft && (
              <button
                type="button"
                onClick={handleResetDraft}
                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-300 px-2.5 py-1 rounded-lg transition cursor-pointer"
                title="Discard draft and start fresh"
              >
                Reset Draft
              </button>
            )}
            <button
              onClick={() => {
                syncDraft();
                setIsWizardOpen(false);
              }}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Multi-Step Progress Tracker Bar */}
        <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80">
          <div className="grid grid-cols-4 gap-2">
            {stepsList.map((s) => {
              const StepIcon = s.icon;
              const isPast = currentStep > s.num;
              const isCurrent = currentStep === s.num;

              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => handleStepJump(s.num)}
                  className={`flex items-center gap-2 py-2 px-3 rounded-xl text-left transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-sky-500/20 border border-sky-500/50 text-white shadow-md shadow-sky-500/10'
                      : isPast
                      ? 'bg-slate-900/60 border border-emerald-500/30 text-emerald-300 hover:bg-slate-850'
                      : 'bg-slate-900/30 border border-slate-800/50 text-slate-500 hover:bg-slate-850/50'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      isCurrent
                        ? 'bg-sky-500 text-white'
                        : isPast
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isPast ? '✓' : s.num}
                  </div>
                  <span className="text-[11px] font-semibold truncate hidden sm:inline">
                    {s.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Wizard Step Body */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">

          {/* STEP 1: Organization Profile & Core Settings */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-400" />
                  <span>Client Organization Profile &amp; Reporting Currency</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Enter the primary organization identity and operational currency. Individual ingestion streams will be organized under this client entity.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Client Organization Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Apex Logistics Ltd, ANR Commercial Laundry, Polaris Advisory"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Base Accounting Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                    >
                      <option value="GHS">GHS (₵ - Ghana Cedi)</option>
                      <option value="USD">USD ($ - US Dollar)</option>
                      <option value="EUR">EUR (€ - Euro)</option>
                      <option value="GBP">GBP (£ - British Pound)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Client Icon
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={icon}
                        onChange={(e) => setIcon(e.target.value)}
                        className="w-14 text-center bg-slate-950 border border-slate-800 rounded-xl px-2 py-2.5 text-lg text-white focus:outline-none focus:border-sky-500"
                      />
                      <div className="flex gap-1">
                        {['🛍️', '🏢', '🧺', '⚡', '🚛', '🏥', '📦', '🏗️'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setIcon(emoji)}
                            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center justify-center cursor-pointer"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Estimated Monthly Document Volume
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1,000+ Invoices & Slips / mo"
                    value={projectedVolume}
                    onChange={(e) => setProjectedVolume(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Client Summary &amp; Scope Description
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Brief description of client business operations and automation scope..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Target Accounting Platform */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>Target Accounting Platform Integration (West Africa)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select the core accounting platform your client operates. <strong>Zoho Books</strong>, <strong>QuickBooks Online</strong>, and <strong>Xero</strong> are production-ready with live API synchronization. Connectors for other top West African ERP and accounting suites are in active development.
                </p>
              </div>

              {/* 10 Platforms Grid */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Select Target Accounting Software ({ACCOUNTING_PLATFORMS.length} Supported Platforms)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto custom-scrollbar p-1">
                  {ACCOUNTING_PLATFORMS.map((platform) => {
                    const isSelected = accountingSoftware === platform.id;
                    const isLive = platform.status === 'live';

                    return (
                      <button
                        key={platform.id}
                        type="button"
                        onClick={() => setAccountingSoftware(platform.id)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 relative ${
                          isSelected
                            ? 'bg-sky-950/60 border-sky-500 shadow-lg shadow-sky-500/10'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{platform.icon}</span>
                            <span className="text-xs font-bold text-white leading-tight">{platform.name}</span>
                          </div>
                          <span
                            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                              isLive
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_#34d39944]'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {isLive ? 'Live' : 'In Progress'}
                          </span>
                        </div>

                        <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                          {platform.description}
                        </p>

                        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9px] text-slate-500 font-mono">
                          <span className="truncate">{platform.regionalPopularity}</span>
                          <span className="shrink-0 ml-1 text-slate-400">{platform.targetProtocol}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* LIVE PLATFORMS: ZOHO BOOKS, QUICKBOOKS ONLINE, XERO */}
              {['zoho_books', 'quickbooks_online', 'xero'].includes(accountingSoftware) ? (
                <div className="space-y-4 pt-3 border-t border-slate-800 animate-in fade-in">
                  {(() => {
                    const sel = ACCOUNTING_PLATFORMS.find((p) => p.id === accountingSoftware);
                    const orgLabel =
                      accountingSoftware === 'zoho_books'
                        ? "Client's Zoho Books Organization ID"
                        : accountingSoftware === 'quickbooks_online'
                        ? "QuickBooks Company ID / Realm ID"
                        : "Xero Tenant ID / Organization Shortcode";

                    const orgPlaceholder =
                      accountingSoftware === 'zoho_books'
                        ? "e.g. 782910482 (from Settings > Organization Profile)"
                        : accountingSoftware === 'quickbooks_online'
                        ? "e.g. 9341452891048201 (from Company Info)"
                        : "e.g. xero_tenant_accra_01 (from Connected Apps)";

                    const orgHelp =
                      accountingSoftware === 'zoho_books'
                        ? "Obtain from the client's Zoho Books profile under Settings > Organization Profile."
                        : accountingSoftware === 'quickbooks_online'
                        ? "Obtain from QuickBooks Settings > Account and Settings > Company > Company ID."
                        : "Obtain from Xero Settings > Connected Apps / Tenant ID.";

                    return (
                      <>
                        <div>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                            <label className="text-xs font-semibold text-slate-300">
                              {orgLabel}
                            </label>
                            <button
                              type="button"
                              onClick={handleFetchAccountingData}
                              disabled={isFetchingData}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                            >
                              <Users className={`w-3.5 h-3.5 ${isFetchingData ? 'animate-spin' : ''}`} />
                              <span>{isFetchingData ? 'Connecting API...' : `Fetch Contacts & Items via ${sel?.name || 'Accounting API'}`}</span>
                            </button>
                          </div>
                          <input
                            type="text"
                            placeholder={orgPlaceholder}
                            value={zohoOrgId}
                            onChange={(e) => setZohoOrgId(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                          />
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {orgHelp}
                          </span>
                        </div>

                        {/* Discovered Customers & SKUs Live Card */}
                        {syncedContacts && syncedContacts.length > 0 && (
                          <div className="bg-gradient-to-r from-emerald-950/40 via-slate-950 to-sky-950/40 border border-emerald-500/40 rounded-xl p-4 space-y-3 animate-in fade-in">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Users className="w-4 h-4 text-emerald-400" />
                                <span className="text-xs font-bold text-white">
                                  Discovered Contacts in this {sel?.name} Account ({syncedContacts.length} Contacts)
                                </span>
                              </div>
                              <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                                {syncedItemsCount || 10} SKUs Synced
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                              {syncedContacts.map((contact, idx) => (
                                <span
                                  key={contact.contact_id || idx}
                                  className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 text-slate-200 text-xs px-2.5 py-1 rounded-lg"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  <span className="font-semibold">{contact.contact_name || contact.company_name}</span>
                                  <span className="text-[10px] text-slate-400 font-mono">({contact.contact_id})</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-xs font-semibold text-slate-300 block mb-1">
                            Standard Ghana GRA VAT &amp; Levy Rule
                          </label>
                          <input
                            type="text"
                            value={taxRateVat}
                            onChange={(e) => setTaxRateVat(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                /* IN-PROGRESS CONNECTOR PREVIEW */
                <div className="space-y-4 pt-3 border-t border-slate-800 animate-in fade-in">
                  {(() => {
                    const sel = ACCOUNTING_PLATFORMS.find((p) => p.id === accountingSoftware);
                    if (!sel) return null;
                    return (
                      <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-5 space-y-3">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{sel.icon}</span>
                          <span>{sel.name} Integration Connector</span>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            In Progress
                          </span>
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 border border-slate-800/80 p-3 rounded-xl">
                          ℹ️ Direct posting connectors for <strong>{sel.name}</strong> ({sel.targetProtocol}) are currently in active development. During this phase, all document extractions and contract validations will run normally, and approved transactions will be safely staged in the <strong>Review Ledger</strong> ready for automated dispatch.
                        </p>
                        <div>
                          <label className="text-xs font-semibold text-slate-300 block mb-1">
                            {sel.name} Sandbox / Organization / Tenant ID
                          </label>
                          <input
                            type="text"
                            placeholder={`e.g. ${sel.id}_sandbox_001`}
                            value={zohoOrgId}
                            onChange={(e) => setZohoOrgId(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Global AI Guardrails & Review Settings */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <span>Global AI Guardrails &amp; Quality Thresholds</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set firm-wide discrepancy thresholds and automated email alert destinations for quarantine anomalies.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    Math Variance Discrepancy Tolerance (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    value={varianceTolerance}
                    onChange={(e) => setVarianceTolerance(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                  <p className="text-[10px] text-slate-500">
                    If subtotal line-item math differs from header total by more than this percentage, the transaction is automatically quarantined to <code>PENDING_VALIDATION_ERROR</code>.
                  </p>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    AI OCR Confidence Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="100"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseInt(e.target.value) || 80)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                  <p className="text-[10px] text-slate-500">
                    Extractions scoring below this confidence require mandatory accountant visual confirmation.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    CPA Quarantine Alert Email (Mailjet Notifications)
                  </label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    placeholder="accounting@yourfirm.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Immediate HTML diagnostic alerts with root-cause violation details are dispatched here when documents fail contract checks.
                  </span>
                </div>

                <label className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5 cursor-pointer hover:border-slate-700 transition">
                  <input
                    type="checkbox"
                    checked={enableSheetsSync}
                    onChange={(e) => setEnableSheetsSync(e.target.checked)}
                    className="rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white">Enable Real-Time Google Sheets Review Mirroring</span>
                    <span className="text-slate-400 block text-[11px]">Syncs approved extractions into client workbook tabs for CPA spreadsheet verification.</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 4: Starter Pipeline Streams Preset & Launch */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-in fade-in">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  <span>Choose Starter Pipeline Stream Preset</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Choose a starter recipe to pre-initialize standard ingestion streams, or start blank and add pipelines individually.
                </p>
              </div>

              {/* Starter Recipe Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {STARTER_RECIPES.map((recipe) => {
                  const isSelected = selectedRecipe === recipe.id;
                  return (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => handleSelectRecipe(recipe.id)}
                      className={`p-4 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                        isSelected
                          ? 'bg-sky-950/60 border-sky-500 shadow-lg shadow-sky-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{recipe.icon}</span>
                        <div>
                          <span className="text-xs font-bold text-white block">{recipe.name}</span>
                          <span className="text-[10px] text-sky-400 font-medium">{recipe.tagline}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">
                        {recipe.description}
                      </p>
                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                        <span>{recipe.pipelines.length} Ingestion Streams</span>
                        <span className="text-slate-300 font-bold">{recipe.defaultVolume}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Summary of Starter Streams */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-sky-400" />
                    <span>Initial Ingestion Streams to be Initialized ({configuredPipelines.length})</span>
                  </span>
                </div>

                {configuredPipelines.length > 0 ? (
                  <div className="space-y-2">
                    {configuredPipelines.map((p, idx) => (
                      <div
                        key={p.id || idx}
                        className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-950 border border-sky-500/30 text-sky-300 uppercase">
                            {p.section}
                          </span>
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="text-[11px] text-slate-400">
                            → Target: <code className="text-sky-300 font-mono text-[10px]">{p.entity_type}</code>
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {p.trigger_type === 'realtime_webhook' ? '⚡ Real-time' : '⏰ ' + (p.cron_schedule_human || 'Daily')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    Blank client initialized. You will be able to add streams immediately in the Workspace with the Pipeline Setup Wizard.
                  </p>
                )}

                <div className="p-3 bg-sky-950/30 border border-sky-500/30 rounded-lg text-xs text-slate-300 flex items-start gap-2">
                  <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    💡 <strong>Note on Channel Ingestion:</strong> After creating this client, you can open any stream card in the Client Workspace to link its dedicated Google Drive folder ID, email alias, or webhook and test connectivity with 1 click.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Actions */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handlePrevStep}
                className="flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                syncDraft();
                setIsWizardOpen(false);
              }}
              className="text-xs font-semibold text-slate-400 hover:text-white px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              Save Draft &amp; Exit
            </button>

            {currentStep < 4 ? (
              <button
                type="button"
                onClick={handleNextStep}
                disabled={currentStep === 1 && !name.trim()}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-sky-600/20 transition cursor-pointer"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunchClient}
                disabled={isSubmitting || !name.trim()}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Create Client Organization</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
