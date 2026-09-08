import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ClientProfile, OrganizationTeamMember, Organization } from '../types/client';
import { fetchClients, createClient, deleteClient as apiDeleteClient, deletePipeline as apiDeletePipeline, saveClientPipeline } from '../lib/api';
import { useAuth } from './AuthContext';

const getStoredPipelines = (clientId: string): any[] | null => {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(`S4_PIPELINES_${clientId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
  }
  return null;
};

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
    folder_id: '1Uu_Q3p8s1_anr_laundry_slips',
    zohoOrg: '782910482',
    zoho_org_id: '782910482',
    zohoContactId: 'cnt_luxwood_001',
    workflowsCount: 2,
    projectedMonthlyVolume: '350+ Slips / mo',
    currency: 'GHS',
    activeIntegrations: ['Google Drive', 'Gemini Vision 3.6', 'Google Sheets', 'Zoho Books', 'Inngest'],
    team_members: [
      {
        id: 'tm_1',
        name: 'Chief Financial Officer',
        email: 'cfo@anrgroup.com',
        phone: '+233 24 400 1122',
        role: 'CFO',
        notifications: { executive_digest: true, critical_anomalies: true, staged_approvals: false, channel: 'both' },
      },
      {
        id: 'tm_2',
        name: 'Head of Operations',
        email: 'operations@anrgroup.com',
        phone: '+233 20 889 0041',
        role: 'Operations_Lead',
        notifications: { executive_digest: false, critical_anomalies: true, staged_approvals: false, channel: 'email' },
      },
    ],
    pipelines: [
      {
        id: 'pipe_anr_daily_slips',
        name: 'Daily Control Slips OCR',
        section: 'AR',
        entity_type: 'ar_sales_invoice',
        source_type: 'google_drive',
        source_identifier: '1Uu_Q3p8s1_anr_laundry_slips',
        schedule: 'Daily @ 18:00 UTC',
        auto_post_draft: false,
        active: true,
        is_active: true,
      },
      {
        id: 'pipe_anr_detergent_bills',
        name: 'Chemical & Detergent Vendor Bills',
        section: 'AP',
        entity_type: 'ap_vendor_bill',
        source_type: 'email',
        source_identifier: 'bills@anrgroup.com',
        schedule: 'Weekly on Friday',
        auto_post_draft: false,
        active: true,
        is_active: true,
      },
    ],
    blueprints: [
      { title: 'Vision OCR Extraction', desc: 'Gemini 3.6 Flash structured JSON extraction on daily control sheets', status: 'active' },
      { title: 'Google Sheets Review Sync', desc: 'Populate Tab 1 (Daily Details) and Tab 2 (Monthly Billing Summary)', status: 'active' },
      { title: 'Draft Invoicing Engine', desc: '1-Click draft invoice creation appending newly approved line items', status: 'active' },
    ],
  },
];

export interface ActiveAccountingSections {
  hasAr: boolean;
  hasAp: boolean;
  hasBank: boolean;
  hasGl: boolean;
  activeCount: number;
}

interface ClientContextType {
  currentClient: ClientProfile;
  clients: ClientProfile[];
  activeSections: ActiveAccountingSections;
  setClient: (clientId: string) => void;
  addClient: (newClient: Omit<ClientProfile, 'id' | 'workflowsCount' | 'projectedMonthlyVolume' | 'activeIntegrations' | 'blueprints'>) => void;
  createClientFromWizard: (payload: any) => Promise<ClientProfile>;
  deleteClient: (clientId: string) => Promise<{ success: boolean; message?: string }>;
  deletePipeline: (clientId: string, pipelineId: string) => Promise<{ success: boolean; message?: string }>;
  savePipeline: (clientId: string, pipelineData: any) => Promise<any[]>;
  isSwitcherOpen: boolean;
  setIsSwitcherOpen: (open: boolean) => void;
  isWizardOpen: boolean;
  setIsWizardOpen: (open: boolean) => void;
  wizardDraft: any;
  saveWizardDraft: (draft: any) => void;
  clearWizardDraft: () => void;
  isIndividualBusiness: boolean;
  isAccountingFirm: boolean;
  activeOrganization?: Organization;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const activeOrg = user?.organization;
  const isIndividualBusiness = activeOrg?.org_type === 'INDIVIDUAL_BUSINESS';
  const isAccountingFirm = !isIndividualBusiness;

  const [clients, setClients] = useState<ClientProfile[]>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('S4_CLIENTS_LIST');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch {}
      }
    }
    return DEFAULT_CLIENTS;
  });

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

  // Sync with backend PostgreSQL database on mount or when active organization changes
  useEffect(() => {
    const loadBackendClients = async () => {
      try {
        const orgFilter = isIndividualBusiness ? activeOrg?.id : undefined;
        const dbClients = await fetchClients(orgFilter);
        if (dbClients && Array.isArray(dbClients) && dbClients.length > 0) {
          const mapped: ClientProfile[] = dbClients.map((c: any) => {
            const defaultMatch = DEFAULT_CLIENTS.find((dc) => dc.id === c.id);
            const storedPipes = getStoredPipelines(c.id);
            const rawPipelines = (Array.isArray(c.pipelines) && c.pipelines.length > 0)
              ? c.pipelines
              : ((storedPipes && storedPipes.length > 0)
                ? storedPipes
                : (defaultMatch?.pipelines || []));
            const normalizedPipelines = rawPipelines.map((p: any) => ({
              ...p,
              is_active: p.is_active !== undefined ? p.is_active : (p.active !== undefined ? p.active : true),
              active: p.active !== undefined ? p.active : (p.is_active !== undefined ? p.is_active : true),
            }));

            if (typeof localStorage !== 'undefined' && Array.isArray(c.pipelines) && c.pipelines.length > 0) {
              try {
                localStorage.setItem(`S4_PIPELINES_${c.id}`, JSON.stringify(normalizedPipelines));
              } catch (e) {}
            }

            return {
              id: c.id,
              organization_id: c.organization_id || 's4_advisory',
              name: c.name,
              industry: c.industry,
              icon: c.icon || defaultMatch?.icon || '🏢',
              status: c.status || defaultMatch?.status || 'dev',
              statusText: c.status_text || (c.status === 'live' ? 'Production Live' : 'In Development'),
              desc: c.description || defaultMatch?.desc || '',
              accounting_software: c.accounting_software || defaultMatch?.accounting_software || 'zoho_books',
              folderId: c.folder_id || defaultMatch?.folderId,
              folder_id: c.folder_id || defaultMatch?.folderId,
              zohoOrg: c.zoho_org_id || defaultMatch?.zohoOrg,
              zoho_org_id: c.zoho_org_id || defaultMatch?.zohoOrg,
              zohoContactId: c.zoho_contact_id || defaultMatch?.zohoContactId,
              sourceType: c.source_type || defaultMatch?.sourceType || 'google_drive',
              sourceEmail: c.source_email || defaultMatch?.sourceEmail,
              currency: c.custom_config?.currency || defaultMatch?.currency || 'GHS',
              varianceTolerance: c.custom_config?.variance_tolerance || 5,
              confidenceThreshold: c.custom_config?.confidence_threshold || 80,
              workflowsCount: normalizedPipelines.length || (c.blueprints || []).length || 1,
              projectedMonthlyVolume: c.custom_config?.volume || 'Active',
              activeIntegrations: (c.active_integrations && c.active_integrations.length > 0)
                ? c.active_integrations
                : (defaultMatch?.activeIntegrations || ['Google Drive', 'Gemini Vision', 'Zoho Books', 'Inngest']),
              sourceConfig: c.source_config || {},
              customConfig: c.custom_config || {},
              pipelines: normalizedPipelines,
              team_members: (c.team_members && c.team_members.length > 0) ? c.team_members : (defaultMatch?.team_members || []),
              blueprints: (c.blueprints && c.blueprints.length > 0) ? c.blueprints : (defaultMatch?.blueprints || [
                { title: 'Source Ingestion', desc: `Ingest via ${c.source_type || 'Google Drive'}`, status: 'active' },
                { title: 'AI Schema Extraction', desc: 'Custom vision models for document extraction', status: 'in_progress' },
                { title: 'Accounting Posting Engine', desc: 'Sync approved transactions into accounting platform', status: 'queued' },
              ]),
            };
          });
          setClients(mapped);
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem('S4_CLIENTS_LIST', JSON.stringify(mapped));
            } catch (e) {}
          }

          // If in individual business mode, lock focus onto company client
          if (isIndividualBusiness) {
            const matched = mapped.find(
              (c) => c.id === activeOrg?.id || c.organization_id === activeOrg?.id || c.id === 'anr_group'
            );
            if (matched) {
              setCurrentClientId(matched.id);
            } else if (mapped.length > 0) {
              setCurrentClientId(mapped[0].id);
            }
          }
        }
      } catch (err) {
        console.warn('Using local client registry fallback:', err);
      }
    };
    loadBackendClients();
  }, [activeOrg?.id, isIndividualBusiness]);

  const currentClient = clients.find((c) => c.id === currentClientId) || clients[0];

  const activeSections: ActiveAccountingSections = React.useMemo(() => {
    const pipelines = currentClient?.pipelines || [];
    const active = pipelines.filter((p: any) => p.is_active !== false && p.active !== false);
    return {
      hasAr: active.some((p: any) => p.section?.toUpperCase() === 'AR' || p.entity_type?.startsWith('ar_') || p.entity_type?.startsWith('pos_')),
      hasAp: active.some((p: any) => p.section?.toUpperCase() === 'AP' || p.entity_type?.startsWith('ap_')),
      hasBank: active.some((p: any) => p.section?.toUpperCase() === 'BANK' || p.entity_type?.includes('statement') || p.entity_type?.includes('bank') || p.entity_type === 'momo_statement'),
      hasGl: active.some((p: any) => p.section?.toUpperCase() === 'GL' || p.entity_type?.startsWith('gl_')),
      activeCount: active.length,
    };
  }, [currentClient]);

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
      team_members: payload.team_members || [],
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
        organization_id: activeOrg?.id || 's4_advisory',
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
        team_members: newProfile.team_members,
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
      organization_id: activeOrg?.id || 's4_advisory',
      description: clientData.desc,
      folder_id: clientData.folderId,
      zoho_org_id: clientData.zohoOrg,
    });
  };

  const deletePipeline = async (clientId: string, pipelineId: string): Promise<{ success: boolean; message?: string }> => {
    let updatedPipelines: any[] = [];
    try {
      const res = await apiDeletePipeline(clientId, pipelineId);
      if (Array.isArray(res)) {
        updatedPipelines = res;
      }
    } catch (err: any) {
      console.warn('Backend delete pipeline notice:', err);
    }

    setClients((prev) => {
      const next = prev.map((c) => {
        if (c.id !== clientId) return c;
        const pipes = updatedPipelines.length > 0 ? updatedPipelines : (c.pipelines || []).filter((p) => p.id !== pipelineId);
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(`S4_PIPELINES_${clientId}`, JSON.stringify(pipes));
          } catch (e) {}
        }
        return {
          ...c,
          pipelines: pipes,
          workflowsCount: pipes.length,
        };
      });
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('S4_CLIENTS_LIST', JSON.stringify(next));
        } catch (e) {}
      }
      return next;
    });
    return { success: true, message: 'Pipeline stream deleted successfully.' };
  };

  const savePipeline = async (clientId: string, pipelineData: any): Promise<any[]> => {
    let updatedPipelines: any[] = [];
    try {
      const res = await saveClientPipeline(clientId, pipelineData);
      if (Array.isArray(res) && res.length > 0) {
        updatedPipelines = res;
      }
    } catch (err) {
      console.warn('Backend save pipeline notice:', err);
    }

    if (!updatedPipelines || updatedPipelines.length === 0) {
      const target = clients.find((c) => c.id === clientId);
      const existing = [...(target?.pipelines || [])];
      const pipeId = pipelineData.id || `pipe_${Date.now()}`;
      const idx = existing.findIndex((p) => p.id === pipeId);
      if (idx >= 0) {
        existing[idx] = { ...pipelineData, id: pipeId };
      } else {
        existing.push({ ...pipelineData, id: pipeId });
      }
      updatedPipelines = existing;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`S4_PIPELINES_${clientId}`, JSON.stringify(updatedPipelines));
      } catch (e) {}
    }

    setClients((prev) => {
      const next = prev.map((c) => {
        if (c.id !== clientId) return c;
        return {
          ...c,
          pipelines: updatedPipelines,
          workflowsCount: updatedPipelines.length,
        };
      });
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('S4_CLIENTS_LIST', JSON.stringify(next));
        } catch (e) {}
      }
      return next;
    });

    return updatedPipelines;
  };

  const deleteClient = async (clientId: string): Promise<{ success: boolean; message?: string }> => {
    const target = clients.find((c) => c.id === clientId);
    if (!target) return { success: false, message: 'Client not found.' };

    if (target.pipelines && target.pipelines.length > 0) {
      throw new Error(`Cannot delete organisation '${target.name}' because it contains ${target.pipelines.length} active pipeline stream(s). Delete all pipelines first.`);
    }

    try {
      await apiDeleteClient(clientId);
    } catch (err: any) {
      console.warn('Backend delete notification:', err);
    }

    const remaining = clients.filter((c) => c.id !== clientId);
    setClients(remaining);
    if (currentClientId === clientId && remaining.length > 0) {
      setClient(remaining[0].id);
    }
    return { success: true, message: `Organisation '${target.name}' deleted successfully.` };
  };

  return (
    <ClientContext.Provider
      value={{
        currentClient,
        clients,
        activeSections,
        setClient,
        addClient,
        createClientFromWizard,
        deleteClient,
        deletePipeline,
        savePipeline,
        isSwitcherOpen,
        setIsSwitcherOpen,
        isWizardOpen,
        setIsWizardOpen,
        wizardDraft,
        saveWizardDraft,
        clearWizardDraft,
        isIndividualBusiness,
        isAccountingFirm,
        activeOrganization: activeOrg,
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
