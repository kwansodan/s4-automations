import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ClientProvider } from './context/ClientContext';
import { AutomationProvider, useAutomation } from './context/AutomationContext';
import { LoginCard } from './components/auth/LoginCard';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { CatalogSection } from './components/catalog/CatalogSection';
import { ConfigSection } from './components/config/ConfigSection';
import { LiveConsole } from './components/console/LiveConsole';
import { ClientsHub } from './components/clients/ClientsHub';
import { ClientWorkspace } from './components/clients/ClientWorkspace';
import { PipelineModal } from './components/modals/PipelineModal';
import { InvoiceModal } from './components/modals/InvoiceModal';
import { ClientSetupWizardModal } from './components/modals/ClientSetupWizardModal';
import { ClientPortal } from './components/portal/ClientPortal';
import { InformationRequestsSection } from './components/banking/InformationRequestsSection';
import { SheetsViewer } from './components/sheets/SheetsViewer';

const MainLayout: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { activeTab, setActiveTab } = useAutomation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // If user navigated directly to the Client Portal
  if (activeTab === 'portal') {
    return <ClientPortal onBackToAdmin={() => setActiveTab('workspace')} />;
  }

  if (!isAuthenticated) {
    return <LoginCard />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans selection:bg-sky-500 selection:text-white">
      {/* Collapsible / Responsive Sidebar */}
      <Sidebar
        isMobileOpen={isMobileMenuOpen}
        setIsMobileOpen={setIsMobileMenuOpen}
      />

      {/* Main Content Area (Offset by sidebar width on desktop) */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 transition-all duration-300">
        <Header onOpenMobileMenu={() => setIsMobileMenuOpen(true)} />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Dynamic Route Switching */}
          {activeTab === 'clients' ? (
            <ClientsHub />
          ) : activeTab === 'sheets' || activeTab === 'invoicing' ? (
            <SheetsViewer />
          ) : activeTab === 'queries' ? (
            <InformationRequestsSection />
          ) : activeTab === 'catalog' ? (
            <CatalogSection />
          ) : activeTab === 'config' ? (
            <ConfigSection />
          ) : activeTab === 'logs' ? (
            <LiveConsole />
          ) : (
            <ClientWorkspace />
          )}
        </main>
      </div>

      {/* Global Modals */}
      <PipelineModal />
      <InvoiceModal />
      <ClientSetupWizardModal />
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
