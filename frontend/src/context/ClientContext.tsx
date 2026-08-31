import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ClientProfile } from '../types/client';
import { fetchClients, createClient } from '../lib/api';

const DEFAULT_CLIENTS: ClientProfile[] = [
  {
    id: 'anr_group',
    name: 'ANR Group (Commercial Laundry)',
    industry: 'Commercial Hospitality & Laundry Services',
    icon: '🧺',
    status: 'live',
    statusText: 'Production Live',
    desc: 'Daily handwritten pickup/delivery slip OCR extraction, reconciliation, Google Sheets review sync, and Zoho Books draft invoicing.',
    accounting_software: 'zoho_books',
    folderId: '1Uu_Q3p8s1_anr_laundry_slips',
    zohoOrg: '782910482',
    zohoContactId: 'cnt_luxwood_001',
    workflowsCount: 2,
    projectedMonthlyVolume: '350+ Slips / mo',
    currency: 'GHS',
    activeIntegrations: ['Google Drive', 'Gemini Vision 3.6', 'Google Sheets', 'Zoho Books', 'Inngest'],
    blueprints: [
      { title: 'Vision OCR Extraction', desc: 'Gemini 3.6 Flash structured JSON extraction on daily control sheets', status: 'active' },
      { title: 'Google Sheets Review Sync', desc: 'Populate Tab 1 (Daily Details) and Tab 2 (Monthly Billing Summary)', status: 'active' },
      { title: 'Draft Invoicing Engine', desc: '1-Click draft invoice creation appending newly approved line items', status: 'active' },
    ],
  },
  {
    id: 'polaris',
    name: 'Polaris Capital & Advisory',
    industry: 'Financial Services & Asset Management',
    icon: '⚡',
    status: 'dev',
    statusText: 'In Development',
    desc: 'Automated bank statement PDF parsing, multi-currency ledger matching, and Xero expense journal posting.',
    accounting_software: 'xero',
    folderId: 'xero_tenant_accra_01',
    zohoOrg: 'xero_tenant_accra_01',
    workflowsCount: 3,
    projectedMonthlyVolume: '1,200+ Transactions / mo',
    currency: 'USD',
    activeIntegrations: ['PDF Vision Parser', 'Xero Accounting', 'Bank Feeds', 'Inngest'],
    blueprints: [
      { title: 'Bank Statement PDF Parser', desc: 'Extract structured transactions from multi-bank PDF statements', status: 'in_progress' },
      { title: 'AI Transaction Categorization', desc: 'Fuzzy-match chart of accounts and assign expense categories', status: 'in_progress' },
      { title: 'Journal Batch Poster', desc: 'Post balanced double-entry journals into Xero Accounting API', status: 'queued' },
    ],
  },
  {
    id: 'mr_osei',
    name: 'Mr. Osei Property Group',
    industry: 'Real Estate & Property Management',
    icon: '🏢',
    status: 'pending',
    statusText: 'Setup Pending',
    desc: 'Automated tenant rent receipt processing, monthly recurring billing, utility cost allocation, and late notice dispatch.',
    accounting_software: 'quickbooks_online',
    folderId: '9341452891048201',
    zohoOrg: '9341452891048201',
    workflowsCount: 2,
    projectedMonthlyVolume: '85+ Units / mo',
    currency: 'GHS',
    activeIntegrations: ['WhatsApp Receipts', 'Google Sheets', 'QuickBooks Online', 'Inngest'],
    blueprints: [
      { title: 'Rent Receipt OCR Ingestion', desc: 'Extract tenant mobile money / bank transfer receipts', status: 'queued' },
      { title: 'Utility Cost Apportionment', desc: 'Apportion shared water/power bills across occupied units', status: 'queued' },
      { title: 'Tenant Monthly Invoicing', desc: 'Generate tenant invoices with automated dispatch in QuickBooks Online', status: 'queued' },
    ],
  },
];

interface ClientContextType {
  currentClient: ClientProfile;
  clients: ClientProfile[];
  setClient: (clientId: string) => void;
  addClient: (newClient: Omit<ClientProfile, 'id' | 'workflowsCount' | 'projectedMonthlyVolume' | 'activeIntegrations' | 'blueprints'>) => void;
  createClientFromWizard: (payload: any) => Promise<ClientProfile>;
  isSwitcherOpen: boolean;
  setIsSwitcherOpen: (open: boolean) => void;
  isWizardOpen: boolean;
  setIsWizardOpen: (open: boolean) => void;
  wizardDraft: any;
  saveWizardDraft: (draft: any) => void;
  clearWizardDraft: () => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<ClientProfile[]>(DEFAULT_CLIENTS);

  const [currentClientId, setCurrentClientId] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('S4_ACTIVE_CLIENT');
      if (saved) return saved;
    }
    return 'anr_group';
  });

  const [isSwitcherOpen, setIsSwitcherOpen] = useState<boolean>(false);
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [wizardDraft, setWizardDraft] = useState<any>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('S4_WIZARD_DRAFT');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return null;
        }
      }
    }
    return null;
  });

  // Sync with backend PostgreSQL database on mount
  useEffect(() => {
    const loadBackendClients = async () => {
      try {
        const dbClients = await fetchClients();
        if (dbClients && Array.isArray(dbClients) && dbClients.length > 0) {
          const mapped: ClientProfile[] = dbClients.map((c: any) => ({
            id: c.id,
            name: c.name,
            industry: c.industry,
            icon: c.icon || '🏢',
            status: c.status || 'dev',
            statusText: c.status_text || (c.status === 'live' ? 'Production Live' : 'In Development'),
            desc: c.description || '',
            accounting_software: c.accounting_software || 'zoho_books',
            folderId: c.folder_id,
            zohoOrg: c.zoho_org_id,
            zohoContactId: c.zoho_contact_id,
            sourceType: c.source_type || 'google_drive',
            sourceEmail: c.source_email,
            currency: c.custom_config?.currency || 'GHS',
            varianceTolerance: c.custom_config?.variance_tolerance || 5,
            confidenceThreshold: c.custom_config?.confidence_threshold || 80,
            workflowsCount: (c.blueprints || []).length || 1,
            projectedMonthlyVolume: c.custom_config?.volume || 'Active',
            activeIntegrations: c.active_integrations || ['Google Drive', 'Gemini Vision', 'Zoho Books', 'Inngest'],
            sourceConfig: c.source_config || {},
            customConfig: c.custom_config || {},
            pipelines: c.pipelines || [],
            blueprints: c.blueprints || [
              { title: 'Source Ingestion', desc: `Ingest via ${c.source_type || 'Google Drive'}`, status: 'active' },
              { title: 'AI Schema Extraction', desc: 'Custom vision models for document extraction', status: 'in_progress' },
              { title: 'Accounting Posting Engine', desc: 'Sync approved transactions into accounting platform', status: 'queued' },
            ],
          }));
          setClients(mapped);
        }
      } catch (err) {
        console.warn('Using local client registry fallback:', err);
      }
    };
    loadBackendClients();
  }, []);

  const currentClient = clients.find((c) => c.id === currentClientId) || clients[0];

  const setClient = (clientId: string) => {
    setCurrentClientId(clientId);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_ACTIVE_CLIENT', clientId);
    }
    setIsSwitcherOpen(false);
  };

  const saveWizardDraft = (draft: any) => {
    setWizardDraft(draft);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_WIZARD_DRAFT', JSON.stringify(draft));
    }
  };

  const clearWizardDraft = () => {
    setWizardDraft(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('S4_WIZARD_DRAFT');
    }
  };

  const createClientFromWizard = async (payload: any): Promise<ClientProfile> => {
    const slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const newProfile: ClientProfile = {
      id: slug || `client_${Date.now()}`,
      name: payload.name,
      industry: payload.industry || 'Financial & Professional Services',
      icon: payload.icon || '🏢',
      status: payload.status || 'dev',
      statusText: payload.status === 'live' ? 'Production Live' : 'In Development',
      desc: payload.description || payload.desc || 'Custom accounting automation workspace.',
      accounting_software: payload.accounting_software || 'zoho_books',
      folderId: payload.folder_id || payload.folderId,
      zohoOrg: payload.zoho_org_id || payload.zohoOrg,
      zohoContactId: payload.zoho_contact_id || payload.zohoContactId,
      sourceType: payload.source_type || payload.sourceType || 'google_drive',
      sourceEmail: payload.source_email || payload.sourceEmail,
      currency: payload.currency || payload.custom_config?.currency || 'GHS',
      varianceTolerance: payload.custom_config?.variance_tolerance || 5,
      confidenceThreshold: payload.custom_config?.confidence_threshold || 80,
      workflowsCount: (payload.pipelines || []).length || (payload.blueprints || []).length || 3,
      projectedMonthlyVolume: payload.projectedMonthlyVolume || payload.custom_config?.volume || 'Active',
      activeIntegrations: payload.active_integrations || ['Google Drive', 'Gemini Vision', 'Zoho Books', 'Inngest'],
      pipelines: payload.pipelines || [],
      blueprints: payload.blueprints || [
        { title: 'Source Ingestion', desc: `Connected via ${payload.source_type || 'Google Drive'}`, status: 'active' },
        { title: 'AI Schema Extraction', desc: 'Automated OCR vision parsing', status: 'in_progress' },
        { title: 'Accounting Posting Engine', desc: 'Export approved lines to accounting', status: 'queued' },
      ],
      sourceConfig: payload.source_config || {},
      customConfig: payload.custom_config || {},
    };

    // Optimistic local update
    setClients((prev) => [...prev.filter((c) => c.id !== newProfile.id), newProfile]);
    setClient(newProfile.id);
    clearWizardDraft();

    // Persist to backend database
    try {
      await createClient({
        name: newProfile.name,
        industry: newProfile.industry,
        icon: newProfile.icon,
        status: newProfile.status,
        status_text: newProfile.statusText,
        description: newProfile.desc,
        accounting_software: newProfile.accounting_software,
        source_type: newProfile.sourceType,
        source_email: newProfile.sourceEmail,
        folder_id: newProfile.folderId,
        zoho_org_id: newProfile.zohoOrg,
        zoho_contact_id: newProfile.zohoContactId,
        source_config: newProfile.sourceConfig,
        custom_config: newProfile.customConfig,
        blueprints: newProfile.blueprints,
        pipelines: newProfile.pipelines,
        active_integrations: newProfile.activeIntegrations,
      });
    } catch (err) {
      console.warn('Backend client creation notice:', err);
    }

    return newProfile;
  };

  const addClient = async (clientData: Omit<ClientProfile, 'id' | 'workflowsCount' | 'projectedMonthlyVolume' | 'activeIntegrations' | 'blueprints'>) => {
    await createClientFromWizard({
      ...clientData,
      description: clientData.desc,
      folder_id: clientData.folderId,
      zoho_org_id: clientData.zohoOrg,
    });
  };

  return (
    <ClientContext.Provider
      value={{
        currentClient,
        clients,
        setClient,
        addClient,
        createClientFromWizard,
        isSwitcherOpen,
        setIsSwitcherOpen,
        isWizardOpen,
        setIsWizardOpen,
        wizardDraft,
        saveWizardDraft,
        clearWizardDraft,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const context = useContext(ClientContext);
  if (!context) {
    throw new Error('useClient must be used within a ClientProvider');
  }
  return context;
};
