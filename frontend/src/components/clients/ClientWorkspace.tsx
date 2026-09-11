import React from 'react';
import { useClient } from '../../context/ClientContext';
import { useAutomation } from '../../context/AutomationContext';
import { ClientOverviewTab } from './tabs/ClientOverviewTab';
import { ClientArTab } from './tabs/ClientArTab';
import { ClientApTab } from './tabs/ClientApTab';
import { ClientBankTab } from './tabs/ClientBankTab';
import { ClientRequestsTab } from './tabs/ClientRequestsTab';
import { ClientPipelinesTab } from './tabs/ClientPipelinesTab';
import { ClientSettingsTab } from './tabs/ClientSettingsTab';

export const ClientWorkspace: React.FC = () => {
  const { activeSections } = useClient();
  const { workspaceSubTab, setWorkspaceSubTab } = useAutomation();

  // Gracefully fallback to overview if currently viewing an accounting workflow whose active pipelines were removed
  React.useEffect(() => {
    if (workspaceSubTab === 'ar' && !activeSections.hasAr) {
      setWorkspaceSubTab('overview');
    } else if (workspaceSubTab === 'ap' && !activeSections.hasAp) {
      setWorkspaceSubTab('overview');
    } else if (workspaceSubTab === 'bank' && !activeSections.hasBank) {
      setWorkspaceSubTab('overview');
    }
  }, [workspaceSubTab, activeSections, setWorkspaceSubTab]);

  return (
    <div className="space-y-6">
      {/* Sub-View Content */}
      {workspaceSubTab === 'overview' && <ClientOverviewTab />}
      {workspaceSubTab === 'ar' && <ClientArTab />}
      {workspaceSubTab === 'ap' && <ClientApTab />}
      {workspaceSubTab === 'bank' && <ClientBankTab />}
      {workspaceSubTab === 'requests' && <ClientRequestsTab />}
      {workspaceSubTab === 'pipelines' && <ClientPipelinesTab />}
      {workspaceSubTab === 'settings' && <ClientSettingsTab />}
    </div>
  );
};
