import React, { useState, useEffect } from 'react';
import type { IngestionPipeline, AccountingSection, AccountingEntityType, TriggerType, PipelineSimulationResult, ChartOfAccountItem, FolderStructurePattern } from '../../types/client';
import { ACCOUNTING_PLATFORMS } from '../../types/client';
import { probeExternalConnection, simulatePipelineExtraction, fetchChartOfAccounts } from '../../lib/api';
import { useAutomation } from '../../context/AutomationContext';
import {
  X,
  Check,
  Sparkles,
  Cloud,
  Folder,
  FolderTree,
  Mail,
  Zap,
  Clock,
  Calendar,
  Building2,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Copy,
  Info,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  RefreshCw,
  Save,
  MessageSquare,
  FileText,
  DollarSign,
  ArrowRight,
  Upload,
  Bot,
  Code,
  Wand2,
  FileSpreadsheet,
} from 'lucide-react';

interface PipelineSetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pipelineData: IngestionPipeline) => Promise<void>;
  clientId: string;
  clientName: string;
  initialPipeline?: IngestionPipeline | null;
  targetAccountingSoftware?: string;
}

const SERVICE_ACCOUNT_EMAIL = 's4-vision-ingest@s4-automations.iam.gserviceaccount.com';

const DOMAIN_TEMPLATES: {
  id: string;
  title: string;
  badge: string;
  entities: AccountingEntityType[];
  template: string;
}[] = [
  {
    id: 'ap_vendor_bill',
    title: '🧾 Supplier Bills & AP',
    badge: 'Accounts Payable',
    entities: ['ap_vendor_bill', 'ap_direct_expense', 'ap_vendor_payment', 'ap_purchase_order', 'ap_vendor_credit'],
    template: `[DOCUMENT IDENTITY]
1. Document Type: Supplier Invoice / Vendor Bill
2. Vendor Name: Extract supplier name from header. Map to existing contact.

[KEY HEADERS]
3. Reference Number: Extract Bill / Invoice Number from top header.
4. Document Date: Extract Bill Date (YYYY-MM-DD). If Due Date is stated, extract it; else default Net 30.
5. Currency: Default to GHS unless USD/EUR symbol is present.

[LINE ITEMS & MATH RULES]
6. Line Items: Extract each row with Description, Quantity, Unit Rate, and Total Amount.
7. Math Check: Verify Total Amount = Quantity × Unit Rate.
8. Ancillary Fees: Add shipping, handling, or delivery fees as separate line items.

[CHART OF ACCOUNTS ROUTING]
9. Default Expense Account: 50000 - Operating Expenses (or stream default account).
10. Keyword Overrides:
    - "Detergent / Bleach / Chemicals" -> Cleaning & Direct Supplies
    - "Fuel / Diesel / Transportation" -> Motor Vehicle Expenses
    - "Repairs / Spare Parts" -> Maintenance & Repairs

[TAX & REVIEW FLAGS]
11. Tax Handling: Extract VAT (15%), NHIL (2.5%), and GETFund (2.5%) if itemized.
12. Flag for Review if: Calculated total differs from invoice total by > GHS 1.00, or supplier is unknown.`,
  },
  {
    id: 'laundry_control_slips',
    title: '🧺 Control & Delivery Slips',
    badge: 'Sales & Invoicing',
    entities: ['ar_sales_invoice', 'ar_delivery_challan', 'ar_customer_payment', 'ar_credit_note'],
    template: `[DOCUMENT IDENTITY]
1. Document Type: Handwritten Pickup & Delivery Control Slip
2. Customer Name: Map hotel or commercial client name to Customer ID.

[KEY HEADERS]
3. Reference Number: Extract Slip Number / Control Sheet Number.
4. Document Date: Extract Delivery Date (YYYY-MM-DD).
5. Slip Mode: Check if Marked Delivered (D) or Pickup (P).

[LINE ITEMS & DISCREPANCY MATH]
6. Column Mapping: Column P is Pickup Count, Column D is Delivery Count.
7. Discrepancy Formula: Calculate Discrepancy = Pickup - Delivery.
8. Invoicing Rule: Price line items based on Delivered count (Col D) × contracted catalog rate.
9. Linen Loss Rule: If Discrepancy > 0, log as linen discrepancy count.

[CHART OF ACCOUNTS ROUTING]
10. Default Revenue Account: 4000 - Commercial Sales Revenue.
11. Discrepancy Revenue: Map linen loss replacement charges to 4050 - Linen Loss Recovery.

[TAX & REVIEW FLAGS]
12. Flag for Review if: Discrepancy > 5 pieces, driver signature missing, or handwriting is illegible.`,
  },
  {
    id: 'bank_momo_statement',
    title: '💳 Bank & MoMo Statements',
    badge: 'Banking & Feeds',
    entities: ['bank_statement', 'momo_statement'],
    template: `[DOCUMENT IDENTITY]
1. Document Type: Bank Account Statement / MTN / Telecel Mobile Money Statement.
2. Account: Match to primary operating bank account or MoMo cash wallet.

[KEY HEADERS]
3. Statement Period: Extract opening statement date and closing statement date.
4. Balances: Extract stated Opening Balance and Closing Balance.

[TRANSACTION PARSING RULES]
5. Transaction Rows: Extract Date, Narration/Description, Money Out (Debit), Money In (Credit), and Balance.
6. MoMo Reference: Extract Transaction ID / Reference Code from transfer narration.
7. Counterparty: Parse recipient/sender phone number or name from transfer description.

[CHART OF ACCOUNTS ROUTING]
8. Money Out (Debits): Default to 50000 - Operating Expenses or Suspense Clearing.
9. Money In (Credits): Default to 40000 - Customer Collections & Revenue.
10. Bank Charges: Route "E-Levy", "SMS Alert Fee", or "Service Charge" to 50900 - Bank & MoMo Charges.

[TAX & REVIEW FLAGS]
11. Flag for Review if: Calculated net transactions do not reconcile with closing balance.`,
  },
  {
    id: 'tenant_property_rent',
    title: '🏢 Tenant Rent & Leases',
    badge: 'Property & Real Estate',
    entities: ['ar_retainer_invoice', 'gl_journal'],
    template: `[DOCUMENT IDENTITY]
1. Document Type: Property Tenant Rent Payment / Lease Slip.
2. Tenant / Unit: Map Tenant Name and Unit/Apartment Number to customer ledger.

[KEY HEADERS]
3. Reference Number: Extract Rent Receipt / Payment Ref number.
4. Rental Period: Extract rental period covered (e.g. Oct 2026 - Dec 2026).
5. Payment Date: Extract Date Paid (YYYY-MM-DD).

[LINE ITEMS & APPORTIONMENT]
6. Base Rent: Apportion base monthly rental amount.
7. Utilities & Common Fees: Separate electricity, water, and service charge fees into distinct line items.
8. Withholding Tax: If rent withholding tax (8% / 10%) was deducted, record as Withholding Tax Receivable.

[CHART OF ACCOUNTS ROUTING]
9. Rental Income: Route base rent to 4100 - Rental Property Income.
10. Utility Recoveries: Route service charges to 4150 - Tenant Utility Recoveries.
11. Security Deposits: Route deposits to 2100 - Tenant Security Deposit Liability.

[TAX & REVIEW FLAGS]
12. Flag for Review if: Receipt does not specify unit number or covers an expired lease.`,
  },
  {
    id: 'universal_questionnaire',
    title: '📋 Universal Questionnaire Form',
    badge: 'Fill-in-the-Blank',
    entities: [],
    template: `[DOCUMENT IDENTIFICATION]
1. Document Type: [e.g. Supplier Invoice / Delivery Slip / Bank Statement / POS Receipt]
2. Counterparty Name: [e.g. Extract name from top left; map to existing client contact]

[HEADER & REFERENCE FIELDS]
3. Reference Number: [e.g. Extract "Invoice No." or generate "REF-{Date}-{Row}"]
4. Date Handling: [e.g. Extract "Date" in YYYY-MM-DD format. If missing, use today's date]
5. Currency: [e.g. Default GHS unless USD / EUR symbol is present]

[LINE ITEMS & MATH RULES]
6. Table Structure: [e.g. Extract Description, Quantity, Unit Rate, and Total Amount]
7. Formulas & Calculations: [e.g. Total = Qty × Rate. Calculate Net = Gross - Discount]
8. Discrepancy Checks: [e.g. Discrepancy = Expected - Actual. Flag if difference > 0]

[CHART OF ACCOUNTS ROUTING]
9. Default Account: [e.g. 50000 - Operating Expenses or 4000 - Sales Revenue]
10. Keyword Overrides:
    - "[keyword 1]" -> [Account Code / Name]
    - "[keyword 2]" -> [Account Code / Name]

[TAX & REVIEW CRITERIA]
11. Tax Handling: [e.g. Extract VAT / NHIL / GETFund if printed; otherwise treat as exempt]
12. Review Thresholds: [e.g. Flag if total > GHS 5,000, signature missing, or handwriting is unclear]`,
  },
];

const getTailoredTemplate = (entity: AccountingEntityType): string => {
  const match = DOMAIN_TEMPLATES.find((t) => t.entities.includes(entity));
  return match ? match.template : DOMAIN_TEMPLATES[DOMAIN_TEMPLATES.length - 1].template;
};

const formatAccountOptionValue = (acc: ChartOfAccountItem): string => {
  if (acc.account_code) {
    return `${acc.account_code} - ${acc.account_name}`;
  }
  return acc.account_name;
};

export const PipelineSetupWizardModal: React.FC<PipelineSetupWizardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  clientId,
  clientName,
  initialPipeline,
  targetAccountingSoftware = 'zoho_books',
}) => {
  const { addLog, config } = useAutomation();
  const serviceAccountEmail = config?.GOOGLE_SERVICE_ACCOUNT_EMAIL || SERVICE_ACCOUNT_EMAIL;

  const [step, setStep] = useState<number>(1);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form State
  const [pipeId, setPipeId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [section, setSection] = useState<AccountingSection>('AR');
  const [entityType, setEntityType] = useState<AccountingEntityType>('ar_sales_invoice');
  const [sourceType, setSourceType] = useState<'google_drive' | 'onedrive' | 'email' | 'webhook' | 'whatsapp' | 'manual'>('google_drive');
  const [sourceIdentifier, setSourceIdentifier] = useState<string>('');
  const [defaultAccountCode, setDefaultAccountCode] = useState<string>('');
  const [autoPostToZoho, setAutoPostToZoho] = useState<boolean>(false);
  const [isActive, setIsActive] = useState<boolean>(true);

  // Client-specific Chart of Accounts State
  const [accounts, setAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isOauthPending, setIsOauthPending] = useState<boolean>(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);

  // Simulation & Human Instructions State
  const [humanInstructions, setHumanInstructions] = useState<string>('');
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [sampleText, setSampleText] = useState<string>('');
  const [sampleMode, setSampleMode] = useState<'file' | 'text'>('file');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<PipelineSimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  // Trigger State
  const [triggerType, setTriggerType] = useState<TriggerType>('scheduled_cron');
  const [cronExpression, setCronExpression] = useState<string>('0 20 * * *');
  const [cronScheduleHuman, setCronScheduleHuman] = useState<string>('Daily at 8:00 PM');

  // Channel External Configuration Details
  const [allowedSenders, setAllowedSenders] = useState<string>('');
  const [oneDriveTenantId, setOneDriveTenantId] = useState<string>('');
  const [oneDriveClientId, setOneDriveClientId] = useState<string>('');
  const [oneDriveSecret, setOneDriveSecret] = useState<string>('');

  // Dynamic Month & Folder Hierarchy State
  const [folderStructure, setFolderStructure] = useState<FolderStructurePattern>('auto_detect');
  const [enableLookbackWindow, setEnableLookbackWindow] = useState<boolean>(true);
  const [autoCreateMonthFolder, setAutoCreateMonthFolder] = useState<boolean>(false);

  // Probing State
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<{ success: boolean; message: string; details?: any; detected_month_folders?: string[]; suggested_hierarchy?: string } | null>(null);

  // Load client-specific Chart of Accounts when modal opens or clientId changes
  useEffect(() => {
    if (!isOpen || !clientId) return;
    let isCancelled = false;
    setIsLoadingAccounts(true);

    fetchChartOfAccounts(clientId)
      .then((data) => {
        if (!isCancelled && data) {
          if (data.oauth_pending || !data.accounts || data.accounts.length === 0) {
            setIsOauthPending(true);
            setAccounts([]);
            setIsCustomMode(true);
          } else {
            setIsOauthPending(false);
            setAccounts(data.accounts);
          }
        }
      })
      .catch((err) => {
        console.warn('Could not fetch client chart of accounts for pipeline wizard:', err);
        if (!isCancelled) {
          setIsOauthPending(true);
          setAccounts([]);
          setIsCustomMode(true);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingAccounts(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, clientId]);

  // Group client accounts by accounting classification
  const groupedAccounts = React.useMemo(() => {
    const groups: { [key: string]: ChartOfAccountItem[] } = {
      'Income & Revenue': [],
      'Cost of Goods & Expenses': [],
      'Bank, Cash & Clearing Accounts': [],
      'Liabilities & Equity': [],
      'Other Accounts': [],
    };

    accounts.forEach((acc) => {
      const type = (acc.account_type || '').toLowerCase();
      const name = (acc.account_name || '').toLowerCase();
      if (type.includes('income') || type.includes('revenue') || type.includes('sales')) {
        groups['Income & Revenue'].push(acc);
      } else if (type.includes('expense') || type.includes('cost of goods') || type.includes('cogs')) {
        groups['Cost of Goods & Expenses'].push(acc);
      } else if (
        type.includes('bank') ||
        type.includes('cash') ||
        type.includes('clearing') ||
        type.includes('current asset') ||
        name.includes('momo') ||
        name.includes('clearing') ||
        acc.is_suspense
      ) {
        groups['Bank, Cash & Clearing Accounts'].push(acc);
      } else if (type.includes('liability') || type.includes('equity') || type.includes('loan')) {
        groups['Liabilities & Equity'].push(acc);
      } else {
        groups['Other Accounts'].push(acc);
      }
    });

    return Object.entries(groups).filter(([_, items]) => items.length > 0);
  }, [accounts]);

  // Resolve matching selected account code value
  const selectedValue = React.useMemo(() => {
    if (!defaultAccountCode) return '';
    const exactMatch = accounts.find((acc) => formatAccountOptionValue(acc) === defaultAccountCode);
    if (exactMatch) return formatAccountOptionValue(exactMatch);
    const codeMatch = accounts.find(
      (acc) =>
        acc.account_code &&
        (acc.account_code === defaultAccountCode ||
          defaultAccountCode.startsWith(`${acc.account_code} `) ||
          defaultAccountCode.startsWith(`${acc.account_code} -`))
    );
    if (codeMatch) return formatAccountOptionValue(codeMatch);
    return defaultAccountCode;
  }, [defaultAccountCode, accounts]);

  const hasMatchingAccount = React.useMemo(() => {
    return accounts.some((acc) => {
      const fullVal = formatAccountOptionValue(acc);
      return fullVal === selectedValue || acc.account_code === selectedValue;
    });
  }, [accounts, selectedValue]);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsCustomMode(false);
      if (initialPipeline) {
        setPipeId(initialPipeline.id);
        setName(initialPipeline.name);
        setSection(initialPipeline.section);
        setEntityType(initialPipeline.entity_type);
        setSourceType(initialPipeline.source_type as any || 'google_drive');
        setSourceIdentifier(
          initialPipeline.source_identifier ||
          initialPipeline.folder_id ||
          (initialPipeline as any).folderId ||
          initialPipeline.source_email ||
          (initialPipeline as any).sourceEmail ||
          ''
        );
        setDefaultAccountCode(
          initialPipeline.default_account_code ||
          (initialPipeline.section === 'AR'
            ? '4000 - Commercial Sales Revenue'
            : initialPipeline.section === 'AP'
            ? '5000 - Operating Expenses'
            : '1001 - Main Operating Account')
        );
        setAutoPostToZoho(!!(initialPipeline.auto_post_to_zoho ?? initialPipeline.auto_post_draft));
        setIsActive(initialPipeline.is_active !== false && initialPipeline.active !== false);
        setTriggerType(initialPipeline.trigger_type || 'scheduled_cron');
        setCronExpression(initialPipeline.cron_expression || '0 20 * * *');
        setCronScheduleHuman(initialPipeline.cron_schedule_human || initialPipeline.schedule || 'Daily at 8:00 PM');
        setHumanInstructions(initialPipeline.human_instructions || '');
        setAllowedSenders(initialPipeline.source_config?.allowed_senders || '');
        setOneDriveTenantId(initialPipeline.source_config?.tenant_id || '');
        setOneDriveClientId(initialPipeline.source_config?.client_id || '');
        setOneDriveSecret(initialPipeline.source_config?.secret || '');
        setFolderStructure(initialPipeline.source_config?.folder_structure || 'auto_detect');
        setEnableLookbackWindow(initialPipeline.source_config?.enable_lookback_window !== false);
        setAutoCreateMonthFolder(!!initialPipeline.source_config?.auto_create_month_folder);
      } else {
        const newId = `pipe_${Date.now()}`;
        setPipeId(newId);
        setName('');
        setSection('AR');
        setEntityType('ar_sales_invoice');
        setSourceType('google_drive');
        setSourceIdentifier('');
        setDefaultAccountCode('4000 - Commercial Sales Revenue');
        setAutoPostToZoho(false);
        setIsActive(true);
        setTriggerType('scheduled_cron');
        setCronExpression('0 20 * * *');
        setCronScheduleHuman('Daily at 8:00 PM');
        setAllowedSenders('');
        setOneDriveTenantId('');
        setOneDriveClientId('');
        setOneDriveSecret('');
        setFolderStructure('auto_detect');
        setEnableLookbackWindow(true);
        setAutoCreateMonthFolder(false);
        setHumanInstructions('');
      }
      setStep(1);
      setProbeResult(null);
      setSampleFile(null);
      setSampleText('');
      setSimulationResult(null);
      setSimulationError(null);
    }
  }, [isOpen, initialPipeline]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleTestChannel = async () => {
    if (sourceType === 'google_drive' && !sourceIdentifier.trim()) {
      setProbeResult({
        success: false,
        message: 'Please enter a Google Drive Root Folder ID first.',
      });
      return;
    }
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await probeExternalConnection({
        source_type: sourceType,
        folder_id: sourceType === 'google_drive' ? sourceIdentifier : undefined,
        source_email: sourceType === 'email' ? sourceIdentifier : undefined,
        source_config: {
          tenant_id: oneDriveTenantId,
          client_id: oneDriveClientId,
          drive_id: sourceType === 'onedrive' ? sourceIdentifier : undefined,
        },
      });
      const driveCheck = res.checks?.find((c: any) => c.target === 'Google Drive Folder');
      setProbeResult({
        success: res.success !== false,
        message: driveCheck?.message || res.summary || `Channel connectivity confirmed for ${sourceType}.`,
        details: res.checks,
        detected_month_folders: driveCheck?.detected_month_folders,
        suggested_hierarchy: driveCheck?.suggested_hierarchy,
      });
      addLog('success', `✅ [STREAM PROBE] Successfully probed ${sourceType} connection for stream "${name}".`);
    } catch (err: any) {
      setProbeResult({
        success: false,
        message: err.message || `Channel probe failed for ${sourceType}.`,
      });
      addLog('warning', `⚠️ [STREAM PROBE] Channel probe failed: ${err.message}`);
    } finally {
      setIsProbing(false);
    }
  };

  const handleSimulate = async () => {
    setIsSimulating(true);
    setSimulationError(null);
    try {
      const formData = new FormData();
      if (sampleFile) {
        formData.append('file', sampleFile);
      }
      if (sampleText.trim()) {
        formData.append('sample_text', sampleText.trim());
      }
      formData.append('entity_type', entityType);
      formData.append('client_id', clientId);
      formData.append('client_name', clientName);
      formData.append('accounting_software', targetAccountingSoftware);
      if (humanInstructions.trim()) {
        formData.append('human_instructions', humanInstructions.trim());
      }

      const res = await simulatePipelineExtraction(formData);
      setSimulationResult(res);
      addLog('success', `🧪 [AI SIMULATION] Simulated transposition for "${name || 'stream'}" (${res.validation_status}).`);
    } catch (err: any) {
      setSimulationError(err.message || 'Simulation failed');
      addLog('error', `❌ [AI SIMULATION FAIL] ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const pipelineData: IngestionPipeline = {
        id: pipeId || `pipe_${Date.now()}`,
        name: name.trim(),
        section,
        entity_type: entityType,
        source_type: sourceType,
        source_identifier: sourceIdentifier.trim(),
        folder_id: sourceType === 'google_drive' ? sourceIdentifier.trim() : (initialPipeline?.folder_id || undefined),
        source_email: sourceType === 'email' ? sourceIdentifier.trim() : (initialPipeline?.source_email || undefined),
        default_account_code: defaultAccountCode.trim(),
        auto_post_to_zoho: autoPostToZoho,
        auto_post_draft: autoPostToZoho,
        is_active: isActive,
        active: isActive,
        trigger_type: triggerType,
        cron_expression: triggerType === 'scheduled_cron' ? cronExpression : undefined,
        cron_schedule_human: triggerType === 'scheduled_cron' ? cronScheduleHuman : undefined,
        schedule: triggerType === 'scheduled_cron' ? (cronScheduleHuman || 'Daily') : (triggerType === 'realtime_webhook' ? 'Realtime Webhook' : 'Manual Only'),
        webhook_slug: triggerType === 'realtime_webhook' ? `pipe_${pipeId || 'stream'}` : undefined,
        human_instructions: humanInstructions.trim() || undefined,
        source_config: {
          folder_structure: folderStructure,
          enable_lookback_window: enableLookbackWindow,
          auto_create_month_folder: autoCreateMonthFolder,
          allowed_senders: allowedSenders.trim() || undefined,
          tenant_id: oneDriveTenantId.trim() || undefined,
          client_id: oneDriveClientId.trim() || undefined,
          secret: oneDriveSecret.trim() || undefined,
        },
      };

      await onSave(pipelineData);
      onClose();
    } catch (err: any) {
      addLog('error', `Failed to save pipeline: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const stepsList = [
    { num: 1, title: 'Accounting & Entity', icon: SlidersHorizontal },
    { num: 2, title: 'Channel & Storage', icon: Cloud },
    { num: 3, title: 'AI Simulation & Rules', icon: Sparkles },
    { num: 4, title: 'Trigger & Schedule', icon: Clock },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-sky-500/30 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  {initialPipeline ? 'Edit Ingestion Pipeline Stream' : 'Configure New Ingestion Pipeline Stream'}
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-950 border border-sky-500/40 text-sky-300">
                  {clientName}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Define document classification, dedicated channel source, and automated trigger schedules for this stream.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Navigation Bar */}
        <div className="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
            {stepsList.map((s) => {
              const IconComp = s.icon;
              const isCurrent = step === s.num;
              const isPassed = step > s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => setStep(s.num)}
                  className={`flex items-center gap-2 text-xs font-semibold py-1 px-2.5 rounded-lg transition cursor-pointer ${
                    isCurrent
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : isPassed
                      ? 'text-emerald-400 hover:bg-slate-800'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrent ? 'bg-sky-500 text-white' : isPassed ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isPassed ? '✓' : s.num}
                  </span>
                  <span>{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          
          {/* STEP 1: Accounting Classification & Target Entity */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Pipeline Stream Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Counter Sales Delivery Slips, China Container Bills, MoMo Customer Receipts"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Accounting Workflow Section
                  </label>
                  <select
                    value={section}
                    onChange={(e) => {
                      const sec = e.target.value as AccountingSection;
                      setSection(sec);
                      if (sec === 'AR') {
                        setEntityType('ar_sales_invoice');
                        const defaultAr = accounts.find((a) => (a.account_type || '').toLowerCase().includes('income') || (a.account_type || '').toLowerCase().includes('sales'));
                        setDefaultAccountCode(defaultAr ? formatAccountOptionValue(defaultAr) : '4000 - Commercial Sales Revenue');
                      } else if (sec === 'AP') {
                        setEntityType('ap_vendor_bill');
                        const defaultAp = accounts.find((a) => (a.account_type || '').toLowerCase().includes('expense') || (a.account_type || '').toLowerCase().includes('cogs'));
                        setDefaultAccountCode(defaultAp ? formatAccountOptionValue(defaultAp) : '5000 - Cost of Goods Sold (Inventory)');
                      } else if (sec === 'BANK') {
                        setEntityType('bank_statement');
                        const defaultBank = accounts.find((a) => (a.account_type || '').toLowerCase().includes('bank') || (a.account_type || '').toLowerCase().includes('current asset'));
                        setDefaultAccountCode(defaultBank ? formatAccountOptionValue(defaultBank) : '1001 - Main Operating Bank Account');
                      } else {
                        setEntityType('gl_journal');
                        const defaultGl = accounts.find((a) => a.account_code === '9000' || (a.account_type || '').toLowerCase().includes('equity'));
                        setDefaultAccountCode(defaultGl ? formatAccountOptionValue(defaultGl) : '9000 - General Ledger Accruals');
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="AR">🔵 Accounts Receivable (AR) — Revenue &amp; Customer Invoices</option>
                    <option value="AP">🟠 Accounts Payable (AP) — Vendor Bills &amp; Expenses</option>
                    <option value="BANK">🟢 Banking &amp; Treasury (BANK) — Statements &amp; MoMo Feeds</option>
                    <option value="GL">🟣 General Ledger (GL) — Manual Journal Entries</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Accounting Entity (API Schema)
                  </label>
                  <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value as AccountingEntityType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    {section === 'AR' && (
                      <>
                        <option value="ar_sales_invoice">Sales Invoice &amp; Delivery Slips (/invoices)</option>
                        <option value="ar_customer_payment">Customer Payment &amp; MoMo Proofs (/customerpayments)</option>
                        <option value="ar_credit_note">Credit Note &amp; Return Slips (/creditnotes)</option>
                        <option value="ar_retainer_invoice">Retainer Invoice (/retainerinvoices)</option>
                        <option value="ar_estimate">Sales Estimate / Quote (/estimates)</option>
                      </>
                    )}
                    {section === 'AP' && (
                      <>
                        <option value="ap_vendor_bill">Vendor / Supplier Bill (/bills)</option>
                        <option value="ap_vendor_payment">Vendor Payment &amp; Wire Proof (/vendorpayments)</option>
                        <option value="ap_direct_expense">Direct Expense &amp; Petty Cash (/expenses)</option>
                        <option value="ap_purchase_order">Purchase Order (/purchaseorders)</option>
                        <option value="ap_vendor_credit">Vendor Credit (/vendorcredits)</option>
                      </>
                    )}
                    {section === 'BANK' && (
                      <>
                        <option value="bank_statement">Bank Statement PDF / Feed (/banktransactions)</option>
                        <option value="momo_statement">Mobile Money (MoMo) Statement (/banktransactions)</option>
                      </>
                    )}
                    {section === 'GL' && (
                      <option value="gl_journal">Manual Double-Entry Journal Entry (/journalentries)</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Default Chart of Accounts Code for this Stream
                  </label>
                  <div className="flex items-center gap-2">
                    {isLoadingAccounts && (
                      <span className="text-[10px] text-sky-400 flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>Loading CoA...</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCustomMode(!isCustomMode)}
                      className="text-[11px] text-sky-400 hover:text-sky-300 transition underline cursor-pointer"
                    >
                      {isCustomMode ? 'Select from Client Accounts' : 'Enter Custom Code'}
                    </button>
                  </div>
                </div>

                {isOauthPending && (
                  <div className="mb-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-200">
                      <span className="font-semibold block mb-0.5">⚠️ OAuth Authorization Pending</span>
                      <span>OAuth connection for this client is pending. Complete OAuth authorization in Client Settings to flow your live Chart of Accounts. Manual code entry mode is enabled below.</span>
                    </div>
                  </div>
                )}

                {isCustomMode ? (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={defaultAccountCode}
                      onChange={(e) => setDefaultAccountCode(e.target.value)}
                      placeholder="e.g. 4000 - Sales Revenue or 5000 - Inventory COGS"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        Manual account code entry mode.
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCustomMode(false)}
                        className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                      >
                        Switch back to dropdown
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={selectedValue}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setIsCustomMode(true);
                        } else {
                          setDefaultAccountCode(e.target.value);
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500 cursor-pointer appearance-none pr-8"
                    >
                      {defaultAccountCode && !hasMatchingAccount && (
                        <option value={defaultAccountCode} className="bg-slate-950 text-amber-300">
                          📌 Current: {defaultAccountCode}
                        </option>
                      )}
                      {groupedAccounts.map(([groupName, groupItems]) => (
                        <optgroup
                          key={groupName}
                          label={groupName}
                          className="bg-slate-900 text-sky-400 font-sans font-bold"
                        >
                          {groupItems.map((acc) => {
                            const optVal = formatAccountOptionValue(acc);
                            return (
                              <option
                                key={acc.account_id || optVal}
                                value={optVal}
                                className="bg-slate-950 text-slate-200 font-mono py-1"
                              >
                                {acc.account_code ? `[${acc.account_code}] ` : ''}{acc.account_name} {acc.account_type ? `(${acc.account_type})` : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                      <option value="__custom__" className="bg-slate-900 text-sky-400 font-sans font-semibold">
                        ✏️ Enter Custom Code...
                      </option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </div>
                  </div>
                )}

                <span className="text-[10px] text-slate-400 mt-1 block">
                  Line items extracted from this stream's documents will default to this account if not explicitly overridden by AI SKU matching.
                </span>
              </div>
            </div>
          )}

          {/* STEP 2: Dedicated Ingestion Channel & Storage Setup */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Ingestion Channel for "{name || 'this stream'}"
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'google_drive', label: 'Google Drive', icon: Folder, desc: 'Shared folder' },
                    { id: 'onedrive', label: 'OneDrive / SharePoint', icon: Cloud, desc: 'Microsoft 365 drive' },
                    { id: 'email', label: 'Inbound Email Alias', icon: Mail, desc: 'Forwarding mailbox' },
                    { id: 'webhook', label: 'Inbound Webhook', icon: Zap, desc: 'ERP / POS push' },
                    { id: 'whatsapp', label: 'WhatsApp Bot', icon: MessageSquare, desc: 'In Progress' },
                    { id: 'manual', label: 'Manual Upload', icon: FileText, desc: 'Staging dropzone' },
                  ].map((type) => {
                    const IconComp = type.icon;
                    const isSel = sourceType === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => {
                          const newType = type.id as any;
                          setSourceType(newType);
                          if (newType === 'google_drive' && sourceIdentifier.includes('@')) {
                            setSourceIdentifier('');
                          } else if (newType === 'email' && !sourceIdentifier.includes('@')) {
                            setSourceIdentifier('');
                          }
                        }}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between space-y-1 ${
                          isSel
                            ? 'bg-sky-950/60 border-sky-500 text-white shadow-lg shadow-sky-500/10'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <IconComp className={`w-4 h-4 ${isSel ? 'text-sky-400' : 'text-slate-400'}`} />
                          <span className="text-xs font-bold text-white">{type.label}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{type.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel Identifier Inputs */}
              {sourceType === 'google_drive' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
                    <span className="font-bold text-white block">Google Service Account Instructions:</span>
                    <p className="text-slate-400">
                      Share your client's target Google Drive folder with the Service Account email below as <strong>Viewer</strong> or <strong>Editor</strong>:
                    </p>
                    <div className="p-2 bg-slate-900 border border-slate-700 rounded font-mono text-[11px] text-sky-300 flex items-center justify-between">
                      <span className="truncate">{serviceAccountEmail}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(serviceAccountEmail, 'sa_email')}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-0.5 rounded cursor-pointer ml-2"
                      >
                        {copiedKey === 'sa_email' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-300">
                        Google Drive Root Source Folder ID *
                      </label>
                      <span className="text-[10px] text-sky-400 font-medium">Static Parent Folder ID</span>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. 1A2b3C4d5E6f7G8h9I0jK (from root drive folder URL)"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Provide the top-level root folder ID. The pipeline dynamically navigates into each month's subfolder at runtime without needing reconfiguration each month.
                    </span>
                  </div>

                  {/* Dynamic Month & Folder Hierarchy Selector */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <FolderTree className="w-3.5 h-3.5 text-sky-400" />
                        <span>Dynamic Month &amp; Folder Hierarchy Pattern</span>
                      </label>
                      <span className="text-[10px] text-slate-400">Controls runtime periodic discovery</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        {
                          id: 'auto_detect',
                          title: '🌐 Auto-Detect Structure (Recommended)',
                          desc: 'Scans month aliases (e.g. August 2026, 2026-08), customer subfolders, or flat files automatically.',
                          badge: 'Multi-Convention',
                        },
                        {
                          id: 'month_then_party',
                          title: '📁 Root ➔ Month Year ➔ Customer/Vendor ➔ Files',
                          desc: 'Party subfolders inside each month. Subfolder names are automatically tagged as customer/vendor names.',
                          badge: 'Most Popular for AP & AR',
                        },
                        {
                          id: 'month_direct',
                          title: '📄 Root ➔ Month Year ➔ Invoices/Bills',
                          desc: 'Direct PDF or image documents placed immediately inside each month’s folder.',
                          badge: 'Direct Files',
                        },
                        {
                          id: 'party_then_month',
                          title: '🏢 Root ➔ Customer/Vendor ➔ Month Year ➔ Files',
                          desc: 'Organized by customer/vendor at root, with nested month subfolders inside each.',
                          badge: 'Client Portfolios',
                        },
                      ].map((item) => {
                        const isSelected = folderStructure === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setFolderStructure(item.id as FolderStructurePattern)}
                            className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? 'bg-sky-950/60 border-sky-500 shadow-md shadow-sky-500/10'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>{item.title}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                            </div>
                            <span className="text-[9px] font-semibold text-sky-400 mt-2">{item.badge}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Visual Drive Structure Preview */}
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5 font-mono text-[11px]">
                    <span className="text-[10px] text-slate-400 font-sans font-bold uppercase tracking-wider block">
                      📁 Live Folder Hierarchy Preview:
                    </span>
                    <div className="text-slate-300 pl-1 leading-relaxed">
                      {folderStructure === 'month_then_party' && (
                        <>
                          <div className="text-sky-400">📂 [Root Source Folder: {sourceIdentifier || '1A2b3C...'}]</div>
                          <div className="pl-4 text-emerald-400">└── 📁 August 2026 / 2026-08 (Dynamically resolved by current period)</div>
                          <div className="pl-8 text-amber-300">├── 📁 Luxwood Hotel / Supplier A (Auto-tagged as Contact Hint)</div>
                          <div className="pl-12 text-slate-400">└── 📄 bill_001.pdf</div>
                          <div className="pl-8 text-amber-300">└── 📁 Active 8 Spintex / Supplier B</div>
                          <div className="pl-12 text-slate-400">└── 📄 slip_002.jpg</div>
                        </>
                      )}
                      {folderStructure === 'month_direct' && (
                        <>
                          <div className="text-sky-400">📂 [Root Source Folder: {sourceIdentifier || '1A2b3C...'}]</div>
                          <div className="pl-4 text-emerald-400">└── 📁 August 2026 / 2026-08 (Dynamically resolved by current period)</div>
                          <div className="pl-8 text-slate-400">├── 📄 invoice_001.pdf</div>
                          <div className="pl-8 text-slate-400">└── 📄 bill_002.pdf</div>
                        </>
                      )}
                      {folderStructure === 'party_then_month' && (
                        <>
                          <div className="text-sky-400">📂 [Root Source Folder: {sourceIdentifier || '1A2b3C...'}]</div>
                          <div className="pl-4 text-amber-300">├── 📁 Luxwood Hotel (Customer / Vendor)</div>
                          <div className="pl-8 text-emerald-400">└── 📁 August 2026 / 2026-08</div>
                          <div className="pl-12 text-slate-400">└── 📄 slip_001.jpg</div>
                        </>
                      )}
                      {folderStructure === 'auto_detect' && (
                        <>
                          <div className="text-sky-400">📂 [Root Source Folder: {sourceIdentifier || '1A2b3C...'}]</div>
                          <div className="pl-4 text-emerald-400">└── 📁 August 2026 / 2026-08 (Auto-matched by alias)</div>
                          <div className="pl-8 text-amber-300">├── 📁 [Customer / Vendor Subfolders] (Auto-detects contact names)</div>
                          <div className="pl-8 text-slate-400">└── 📄 [Direct Loose PDFs or Images]</div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Runtime Execution Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <label className="flex items-start gap-2 p-2.5 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer text-xs text-slate-300 hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={enableLookbackWindow}
                        onChange={(e) => setEnableLookbackWindow(e.target.checked)}
                        className="rounded border-slate-700 text-sky-500 mt-0.5"
                      />
                      <div>
                        <span className="font-semibold text-white block">Lookback Grace Window</span>
                        <span className="text-[10px] text-slate-400">Scan prior month during days 1–7 to catch late-arriving bills.</span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 p-2.5 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer text-xs text-slate-300 hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={autoCreateMonthFolder}
                        onChange={(e) => setAutoCreateMonthFolder(e.target.checked)}
                        className="rounded border-slate-700 text-sky-500 mt-0.5"
                      />
                      <div>
                        <span className="font-semibold text-white block">Auto-Create Month Folder</span>
                        <span className="text-[10px] text-slate-400">Automatically create month folder in Drive (e.g. "September 2026") if missing.</span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {sourceType === 'onedrive' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      SharePoint / OneDrive Folder URL or Drive ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. https://company.sharepoint.com/sites/.../Ingestion"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Azure Tenant ID (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 3a5b8c9d-..."
                        value={oneDriveTenantId}
                        onChange={(e) => setOneDriveTenantId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Azure Client ID (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. 9f8e7d6c-..."
                        value={oneDriveClientId}
                        onChange={(e) => setOneDriveClientId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'email' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Monitored Inbox Folder Name
                    </label>
                    <input
                      type="text"
                      placeholder="INBOX or INBOX/VendorBills"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Allowed Sender Whitelist (Comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. billing@supplier.com, frontdesk@hotel.com"
                      value={allowedSenders}
                      onChange={(e) => setAllowedSenders(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {sourceType === 'webhook' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                    <span className="font-bold text-white block">Dedicated Stream Webhook Endpoint:</span>
                    <div className="p-2 bg-slate-900 border border-slate-700 rounded font-mono text-[11px] text-sky-300 break-all flex items-center justify-between">
                      <span>https://s4-api.service4gh.com/api/v1/webhooks/pipelines/{pipeId || 'pipe_id'}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(`https://s4-api.service4gh.com/api/v1/webhooks/pipelines/${pipeId || 'pipe_id'}`, 'wh_url')}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-0.5 rounded cursor-pointer ml-2"
                      >
                        {copiedKey === 'wh_url' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sourceType === 'whatsapp' && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span>📱 WhatsApp Ingestion Bot</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        In Progress
                      </span>
                    </span>
                    <p className="text-slate-400">
                      Drivers and staff can snap photos of delivery slips or MoMo confirmation SMS and send them directly to this stream's WhatsApp bot.
                    </p>
                    <input
                      type="text"
                      placeholder="e.g. Dedicated WhatsApp Number: +233 55 123 4567"
                      value={sourceIdentifier}
                      onChange={(e) => setSourceIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Direct Test Channel Connection Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestChannel}
                  disabled={isProbing}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin' : ''}`} />
                  <span>{isProbing ? 'Testing Connection...' : `🔍 Test ${sourceType.replace(/_/g, ' ')} Channel Connection`}</span>
                </button>

                {probeResult && (
                  <div className={`mt-2 p-3 rounded-xl border text-xs space-y-2 ${
                    probeResult.success ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-red-950/40 border-red-500/40 text-red-300'
                  }`}>
                    <div className="flex items-center gap-2">
                      {probeResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
                      <span className="font-medium">{probeResult.message}</span>
                    </div>

                    {probeResult.detected_month_folders && probeResult.detected_month_folders.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-emerald-500/20 text-[11px]">
                        <span className="text-emerald-400 font-semibold">Active Month Folders in Root:</span>
                        {probeResult.detected_month_folders.map((mf, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-500/30 text-emerald-200 font-mono text-[10px]">
                            📁 {mf}
                          </span>
                        ))}
                      </div>
                    )}

                    {probeResult.suggested_hierarchy && probeResult.suggested_hierarchy !== 'auto_detect' && (
                      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-sky-300">
                        <span className="font-semibold">Suggested Hierarchy:</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-sky-900/60 border border-sky-500/30">
                          {probeResult.suggested_hierarchy.replace(/_/g, ' ')}
                        </span>
                        {folderStructure !== probeResult.suggested_hierarchy && (
                          <button
                            type="button"
                            onClick={() => setFolderStructure(probeResult.suggested_hierarchy as FolderStructurePattern)}
                            className="text-sky-400 hover:text-sky-200 underline cursor-pointer text-[10px] ml-1"
                          >
                            Apply suggestion
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Interactive AI Simulation Lab & Rules Studio */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-sky-950/30 border border-sky-500/30 rounded-xl p-3.5 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <span className="font-bold text-white block">Interactive AI Simulation & Transposition Studio</span>
                  <p className="text-slate-300">
                    Feed a test sample document (image, PDF, or text) and write plain-English rules to guide how the AI extracts and transposes raw data into the {ACCOUNTING_PLATFORMS.find((p) => p.id === targetAccountingSoftware)?.name || 'Accounting Platform'} <code className="text-sky-300 font-mono">{entityType}</code> API schema.
                  </p>
                </div>
              </div>

              {/* Natural Language Prompt Rules Box */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                    <label className="text-xs font-semibold text-slate-300">
                      Human Transposition Instructions (Guided Prompt)
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const tailored = getTailoredTemplate(entityType);
                      setHumanInstructions(tailored);
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 px-2.5 py-1 rounded-lg shadow transition cursor-pointer"
                    title="Insert structured questionnaire tailored to this entity type"
                  >
                    <Sparkles className="w-3 h-3 text-sky-400" />
                    <span>Auto-Fill Questionnaire for {entityType.replace(/_/g, ' ')}</span>
                  </button>
                </div>

                <textarea
                  rows={8}
                  value={humanInstructions}
                  onChange={(e) => setHumanInstructions(e.target.value)}
                  placeholder="Paste or fill in your transposition instructions here. You can also click any of the tailored templates below to get guided questions."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 font-mono leading-relaxed placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />

                {/* Preset Prompt Buttons */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      Tailored Pipeline Questionnaire Templates:
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Click to insert template into editor
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {DOMAIN_TEMPLATES.map((tmpl) => {
                      const isRecommended = tmpl.entities.includes(entityType);
                      return (
                        <button
                          key={tmpl.id}
                          type="button"
                          onClick={() => setHumanInstructions(tmpl.template)}
                          className={`text-left p-2 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                            isRecommended
                              ? 'bg-sky-950/60 border-sky-500/60 hover:border-sky-400 shadow-sm'
                              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white truncate">{tmpl.title}</span>
                            {isRecommended && (
                              <span className="text-[9px] font-bold text-sky-400 bg-sky-900/60 px-1.5 py-0.2 rounded border border-sky-500/30 shrink-0 ml-1">
                                Recommended
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 mt-0.5">{tmpl.badge}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Sample Document Ingestion Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSampleMode('file')}
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                        sampleMode === 'file' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      📁 Upload Sample File (Image / PDF)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSampleMode('text')}
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                        sampleMode === 'text' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      📝 Paste Sample Document Text
                    </button>
                  </div>
                </div>

                {sampleMode === 'file' ? (
                  <div className="border-2 border-dashed border-slate-800 hover:border-sky-500/50 rounded-xl p-4 text-center transition bg-slate-900/40">
                    <input
                      type="file"
                      id="sample-upload"
                      accept="image/*,.pdf,.csv,.txt"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setSampleFile(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                    />
                    <label htmlFor="sample-upload" className="cursor-pointer block space-y-1.5">
                      <Upload className="w-6 h-6 text-sky-400 mx-auto" />
                      <div className="text-xs text-slate-300">
                        {sampleFile ? (
                          <span className="text-sky-300 font-bold font-mono">Selected: {sampleFile.name} ({(sampleFile.size / 1024).toFixed(1)} KB)</span>
                        ) : (
                          <span>Click to browse or drop sample slip, invoice photo, or PDF statement</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 block">PNG, JPG, WebP, PDF, CSV up to 10MB</span>
                    </label>
                  </div>
                ) : (
                  <div>
                    <textarea
                      rows={4}
                      value={sampleText}
                      onChange={(e) => setSampleText(e.target.value)}
                      placeholder="Paste raw text extracted from invoice, delivery note, bank SMS, or WhatsApp message here..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                {/* Simulate Button */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={isSimulating}
                    className="flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-sky-500/20 transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
                    <span>{isSimulating ? 'Studying Sample & Simulating...' : '🧪 Run AI Extraction & Transposition'}</span>
                  </button>
                  <span className="text-[11px] text-slate-400">
                    {simulationResult ? 'Simulation ready below' : 'Click to preview live API draft'}
                  </span>
                </div>

                {simulationError && (
                  <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{simulationError}</span>
                  </div>
                )}
              </div>

              {/* Simulation Result Split View */}
              {simulationResult && (
                <div className="space-y-3 bg-slate-950 border border-slate-800 rounded-xl p-4 animate-in fade-in">
                  {/* Status Bar */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                        simulationResult.validation_status === 'VALID'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                          : 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                      }`}>
                        {simulationResult.validation_status === 'VALID' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-amber-400" />}
                        <span>{simulationResult.validation_status === 'VALID' ? 'PASSED CONTRACT VALIDATION' : 'VALIDATION WARNINGS'}</span>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Confidence: <strong className="text-white">{Math.round(simulationResult.confidence_score * 100)}%</strong>
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-500/30">
                      Target: {simulationResult.accounting_software.toUpperCase()} ({simulationResult.entity_type})
                    </span>
                  </div>

                  {/* AI Reasoning Narrative */}
                  {simulationResult.ai_reasoning && (
                    <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 space-y-1">
                      <span className="font-semibold text-sky-300 flex items-center gap-1 text-[11px]">
                        <Bot className="w-3.5 h-3.5" />
                        <span>AI Transposition Reasoning:</span>
                      </span>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{simulationResult.ai_reasoning}</p>
                    </div>
                  )}

                  {/* Extracted Datapoints & Transposed JSON Split */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {/* Left: Raw Detected Datapoints */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-300 block">Extracted Data Points:</span>
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 max-h-48 overflow-y-auto space-y-1.5 text-xs">
                        {simulationResult.raw_datapoints.map((dp, i) => (
                          <div key={i} className="p-1.5 rounded bg-slate-950 border border-slate-800/80 text-[11px]">
                            <div className="flex items-center justify-between text-slate-400">
                              <span className="font-semibold text-sky-300">{dp.key}</span>
                              <span className="text-[9px] text-slate-500">{Math.round(dp.confidence * 100)}%</span>
                            </div>
                            <div className="text-white font-mono text-[10px] mt-0.5">{String(dp.value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Target API JSON Draft */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span>Transposed Entity Payload:</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(JSON.stringify(simulationResult.transposed_payload, null, 2), 'sim_json')}
                          className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                        >
                          {copiedKey === 'sim_json' ? 'Copied!' : 'Copy JSON'}
                        </button>
                      </span>
                      <pre className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-[10px] text-emerald-300 font-mono max-h-48 overflow-y-auto overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(simulationResult.transposed_payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Trigger Schedule & Automation Rules */}
          {step === 4 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Trigger Modality for "{name || 'this stream'}"
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTriggerType('scheduled_cron')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'scheduled_cron'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span className="text-xs font-bold">⏰ Scheduled Cron</span>
                    <span className="text-[10px] opacity-75">Recurring Batch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTriggerType('realtime_webhook')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'realtime_webhook'
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    <span className="text-xs font-bold">⚡ Real-Time Push</span>
                    <span className="text-[10px] opacity-75">Instant Webhook</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTriggerType('manual_only')}
                    className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col items-center gap-1 ${
                      triggerType === 'manual_only'
                        ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-md'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span className="text-xs font-bold">🖱️ Manual Only</span>
                    <span className="text-[10px] opacity-75">On-Demand Trigger</span>
                  </button>
                </div>
              </div>

              {/* Scheduled Cron Presets */}
              {triggerType === 'scheduled_cron' && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-300">
                    Batch Frequency Preset
                  </label>
                  <select
                    value={cronScheduleHuman}
                    onChange={(e) => {
                      const val = e.target.value;
                      let expr = '0 20 * * *';
                      if (val === 'Hourly') expr = '0 * * * *';
                      else if (val === 'Every 6 Hours') expr = '0 */6 * * *';
                      else if (val === 'Weekdays at 6:00 PM') expr = '0 18 * * 1-5';
                      else if (val === '1st of Month at 9:00 AM') expr = '0 9 1 * *';
                      setCronScheduleHuman(val);
                      setCronExpression(expr);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="Daily at 8:00 PM">Daily at 8:00 PM (Default End-of-Day Sweep)</option>
                    <option value="Hourly">Hourly Continuous Ingestion</option>
                    <option value="Every 6 Hours">Every 6 Hours (Periodic Batch)</option>
                    <option value="Weekdays at 6:00 PM">Weekdays at 6:00 PM (Business Close)</option>
                    <option value="1st of Month at 9:00 AM">1st of Month at 9:00 AM (Monthly Closing)</option>
                  </select>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Cron Expression: <code className="text-amber-300">{cronExpression}</code>
                  </p>
                </div>
              )}

              {/* Auto-Post & Active Toggles */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <label className="flex items-start gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5 cursor-pointer hover:border-slate-700 transition">
                  <input
                    type="checkbox"
                    checked={autoPostToZoho}
                    onChange={(e) => setAutoPostToZoho(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white block">
                      Auto-Post Live to {ACCOUNTING_PLATFORMS.find((p) => p.id === targetAccountingSoftware)?.name || 'Accounting Platform'}
                    </span>
                    <span className="text-slate-400">
                      When enabled, extracted documents that pass 100% strict contract validation will be created immediately in your accounting platform. If disabled, transactions are staged in the Review Ledger for CPA approval.
                    </span>
                  </div>
                </label>

                <label className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5 cursor-pointer hover:border-slate-700 transition">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white">Stream Active</span>
                    <span className="text-slate-400 block text-[11px]">Uncheck to pause document scanning without deleting this stream configuration.</span>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((prev) => prev - 1)}
                className="flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-slate-400 hover:text-white px-3.5 py-2 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => prev + 1)}
                disabled={!name.trim()}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-sky-600/20 transition cursor-pointer"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSaving || !name.trim()}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{initialPipeline ? 'Save Pipeline Changes' : 'Create Ingestion Pipeline'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
