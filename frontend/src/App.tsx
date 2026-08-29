import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ClientProvider, useClient } from './context/ClientContext';
import { AutomationProvider, useAutomation } from './context/AutomationContext';
import { LoginCard } from './components/auth/LoginCard';
import { Header } from './components/layout/Header';
import { KpiCards } from './components/dashboard/KpiCards';
import { ProgressTracker } from './components/dashboard/ProgressTracker';
import { SheetsViewer } from './components/sheets/SheetsViewer';
import { CatalogDrawer } from './components/catalog/CatalogDrawer';
import { ConfigSection } from './components/config/ConfigSection';
import { LiveConsole } from './components/console/LiveConsole';
import { ClientsHub } from './components/clients/ClientsHub';
import { ClientWorkspace } from './components/clients/ClientWorkspace';
import { PipelineModal } from './components/modals/PipelineModal';
import { InvoiceModal } from './components/modals/InvoiceModal';

const MainLayout: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { currentClient } = useClient();
  const { activeTab } = useAutomation();

  if (!isAuthenticated) {
    return <LoginCard />;
  }

  const isAnr = currentClient.id === 'anr_group';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Dynamic Route Switching */}
        {activeTab === 'clients' ? (
          <ClientsHub />
        ) : !isAnr || activeTab === 'workspace' ? (
          activeTab === 'logs' ? <LiveConsole /> : <ClientWorkspace />
        ) : activeTab === 'dashboard' ? (
          <div className="space-y-6 animate-in fade-in">
            <KpiCards />
            <ProgressTracker />
            <SheetsViewer />
          </div>
        ) : activeTab === 'sheets' || activeTab === 'invoicing' ? (
          <SheetsViewer />
        ) : activeTab === 'catalog' ? (
          <CatalogDrawer />
        ) : activeTab === 'config' ? (
          <ConfigSection />
        ) : activeTab === 'logs' ? (
          <LiveConsole />
        ) : null}
      </main>

      {/* Global Modals */}
      <PipelineModal />
      <InvoiceModal />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <ClientProvider>
        <AutomationProvider>
          <MainLayout />
        </AutomationProvider>
      </ClientProvider>
    </AuthProvider>
  );
};

export default App;
