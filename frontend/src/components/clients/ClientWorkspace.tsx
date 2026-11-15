import React from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { ClientOverviewTab } from './tabs/ClientOverviewTab';
import { ClientArTab } from './tabs/ClientArTab';
import { ClientApTab } from './tabs/ClientApTab';
import { ClientRequestsTab } from './tabs/ClientRequestsTab';
import { ClientPipelinesTab } from './tabs/ClientPipelinesTab';
import { ClientSettingsTab } from './tabs/ClientSettingsTab';
import { ClientGLTab } from './tabs/ClientGLTab';
import { ClientFRTab } from './tabs/ClientFRTab';
import { InformationRequestsSection } from '../banking/InformationRequestsSection';

export const ClientWorkspace: React.FC = () => {
  const { currentClient, activeSections, setIsWizardOpen, activeOrganization } = useClient();
  const { workspaceSubTab, setWorkspaceSubTab } = useAutomation();

  // Gracefully fallback to overview if currently viewing an accounting workflow whose active pipelines were removed
  React.useEffect(() => {
    if (!currentClient) return;
    if (workspaceSubTab === 'ar' && !activeSections.hasAr) {
      setWorkspaceSubTab('overview');
    } else if (workspaceSubTab === 'ap' && !activeSections.hasAp) {
      setWorkspaceSubTab('overview');
    } else if (workspaceSubTab === 'bank' && !activeSections.hasBank) {
      setWorkspaceSubTab('overview');
    }
  }, [currentClient, workspaceSubTab, activeSections, setWorkspaceSubTab]);

  if (!currentClient) {
    return (
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center max-w-xl mx-auto my-8 space-y-3 shadow-xs">
        <h2 className="text-base font-bold text-[#0F172A]">
          No Client Workspaces Yet{activeOrganization?.name ? ` in ${activeOrganization.name}` : ''}
        </h2>
        <p className="text-xs text-[#64748B]">
          Provision a client workspace to configure AR/AP/Bank AI agents, review queues, and accounting software integrations.
        </p>
        <div className="pt-2">
          <button
            onClick={() => setIsWizardOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer"
          >
            Onboard First Client Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-View Content */}
      {workspaceSubTab === 'overview' && <ClientOverviewTab />}
      {workspaceSubTab === 'ar' && <ClientArTab />}
      {workspaceSubTab === 'ap' && <ClientApTab />}
      {workspaceSubTab === 'bank' && (
        <div className="animate-in fade-in duration-200">
          <InformationRequestsSection />
        </div>
      )}
      {workspaceSubTab === 'gl' && <ClientGLTab />}
      {workspaceSubTab === 'fr' && <ClientFRTab />}
      {workspaceSubTab === 'requests' && <ClientRequestsTab />}
      {(workspaceSubTab === 'pipelines' || workspaceSubTab === 'agents') && <ClientPipelinesTab />}
      {workspaceSubTab === 'settings' && <ClientSettingsTab />}
    </div>
  );
};

