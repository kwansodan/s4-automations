import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ClientProfile } from '../types/client';

const DEFAULT_CLIENTS: ClientProfile[] = [
  {
    id: 'anr_group',
    name: 'ANR Group (Commercial Laundry)',
    industry: 'Commercial Hospitality & Laundry Services',
    icon: '🧺',
    status: 'live',
    statusText: 'Production Live',
    desc: 'Daily handwritten pickup/delivery slip OCR extraction, reconciliation, Google Sheets review sync, and Zoho Books draft invoicing.',
    folderId: '1Uu_Q3p8s1_anr_laundry_slips',
    zohoOrg: '782910482',
    workflowsCount: 2,
    projectedMonthlyVolume: '350+ Slips / mo',
    activeIntegrations: ['Google Drive', 'Gemini Vision 3.6', 'Google Sheets', 'Zoho Books', 'Inngest'],
    blueprints: [
      { title: 'Vision OCR Extraction', desc: 'Gemini 3.6 Flash structured JSON extraction on daily control sheets', status: 'active' },
      { title: 'Google Sheets Review Sync', desc: 'Populate Tab 1 (Daily Details) and Tab 2 (Monthly Billing Summary)', status: 'active' },
      { title: 'Zoho Books Draft Invoicing', desc: '1-Click draft invoice creation appending newly approved line items', status: 'active' },
    ],
  },
  {
    id: 'polaris',
    name: 'Polaris Capital & Advisory',
    industry: 'Financial Services & Asset Management',
    icon: '⚡',
    status: 'dev',
    statusText: 'In Development',
    desc: 'Automated bank statement PDF parsing, multi-currency ledger matching, and Zoho Books expense journal posting.',
    workflowsCount: 3,
    projectedMonthlyVolume: '1,200+ Transactions / mo',
    activeIntegrations: ['PDF Vision Parser', 'Zoho Books Journals', 'Bank Feeds', 'Inngest'],
    blueprints: [
      { title: 'Bank Statement PDF Parser', desc: 'Extract structured transactions from multi-bank PDF statements', status: 'in_progress' },
      { title: 'AI Transaction Categorization', desc: 'Fuzzy-match chart of accounts and assign expense categories', status: 'in_progress' },
      { title: 'Zoho Journal Batch Poster', desc: 'Post balanced double-entry journals into Zoho Books API', status: 'queued' },
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
    workflowsCount: 2,
    projectedMonthlyVolume: '85+ Units / mo',
    activeIntegrations: ['WhatsApp Receipts', 'Google Sheets', 'Zoho Invoicing', 'Inngest'],
    blueprints: [
      { title: 'Rent Receipt OCR Ingestion', desc: 'Extract tenant mobile money / bank transfer receipts', status: 'queued' },
      { title: 'Utility Cost Apportionment', desc: 'Apportion shared water/power bills across occupied units', status: 'queued' },
      { title: 'Tenant Monthly Invoicing', desc: 'Generate tenant invoices with automated email/SMS dispatch', status: 'queued' },
    ],
  },
];

interface ClientContextType {
  currentClient: ClientProfile;
  clients: ClientProfile[];
  setClient: (clientId: string) => void;
  addClient: (newClient: Omit<ClientProfile, 'id' | 'workflowsCount' | 'projectedMonthlyVolume' | 'activeIntegrations' | 'blueprints'>) => void;
  isSwitcherOpen: boolean;
  setIsSwitcherOpen: (open: boolean) => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<ClientProfile[]>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('S4_CLIENTS_LIST');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.warn('Failed parsing saved clients list:', e);
        }
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

  const currentClient = clients.find((c) => c.id === currentClientId) || clients[0];

  const setClient = (clientId: string) => {
    setCurrentClientId(clientId);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_ACTIVE_CLIENT', clientId);
    }
    setIsSwitcherOpen(false);
  };

  const addClient = (clientData: Omit<ClientProfile, 'id' | 'workflowsCount' | 'projectedMonthlyVolume' | 'activeIntegrations' | 'blueprints'>) => {
    const slug = clientData.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const newProfile: ClientProfile = {
      ...clientData,
      id: slug || `client_${Date.now()}`,
      workflowsCount: 1,
      projectedMonthlyVolume: 'Upcoming',
      activeIntegrations: ['Google Drive', 'Inngest', 'Zoho Books'],
      blueprints: [
        { title: 'Source Data Discovery', desc: 'Connect Google Drive or email inbox for automated ingestion', status: 'in_progress' },
        { title: 'AI Extraction Pipeline', desc: 'Custom vision models for domain-specific document schemas', status: 'queued' },
        { title: 'Accounting Posting Engine', desc: 'Sync approved transactions into target accounting books', status: 'queued' },
      ],
    };

    const updated = [...clients, newProfile];
    setClients(updated);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('S4_CLIENTS_LIST', JSON.stringify(updated));
    }
    setClient(newProfile.id);
  };

  return (
    <ClientContext.Provider
      value={{
        currentClient,
        clients,
        setClient,
        addClient,
        isSwitcherOpen,
        setIsSwitcherOpen,
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
