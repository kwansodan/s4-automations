import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ClientProvider } from './context/ClientContext';
import { AutomationProvider, useAutomation } from './context/AutomationContext';
import { ErrorProvider } from './context/ErrorContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ToastContainer } from './components/common/ToastContainer';
import { DebugDrawer } from './components/debug/DebugDrawer';
import { LoginCard } from './components/auth/LoginCard';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { CatalogSection } from './components/catalog/CatalogSection';
import { ConfigSection } from './components/config/ConfigSection';
import { LiveConsole } from './components/console/LiveConsole';
import { ClientWorkspace } from './components/clients/ClientWorkspace';
import { PipelineModal } from './components/modals/PipelineModal';
import { InvoiceModal } from './components/modals/InvoiceModal';
import { ClientSetupWizardModal } from './components/modals/ClientSetupWizardModal';
import { ClientPortal } from './components/portal/ClientPortal';
import { InformationRequestsSection } from './components/banking/InformationRequestsSection';
import { SheetsViewer } from './components/sheets/SheetsViewer';
import { ShieldAlert } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const { activeTab, setActiveTab } = useAutomation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // If user navigated directly to the Client Portal
  if (activeTab === 'portal') {
    return (
      <ErrorBoundary componentName="Client Clarification Portal">
        <ClientPortal onBackToAdmin={() => setActiveTab('workspace')} />
      </ErrorBoundary>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary componentName="Login View">
        <LoginCard />
      </ErrorBoundary>
    );
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
          {/* Dynamic Route Switching with Error Boundaries */}
          <ErrorBoundary componentName={`Tab: ${activeTab}`}>
            {activeTab === 'sheets' || activeTab === 'invoicing' ? (
              <SheetsViewer />
            ) : activeTab === 'queries' ? (
              <InformationRequestsSection />
            ) : activeTab === 'catalog' ? (
              <CatalogSection />
            ) : activeTab === 'config' ? (
              user?.role === 'admin' ? (
                <ConfigSection />
              ) : (
                <div className="glass-panel rounded-2xl p-8 border border-rose-500/30 text-center max-w-lg mx-auto my-12 space-y-4 animate-in fade-in">
                  <div className="w-12 h-12 rounded-2xl bg-rose-950/80 border border-rose-500/40 flex items-center justify-center mx-auto text-rose-400">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Access Restricted</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Platform Settings contains sensitive global infrastructure credentials (AI OCR models, SMTP gateways, database connections, and server keys). Only users with the <strong className="text-rose-400">Platform Administrator</strong> role are authorized to view or modify these parameters.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab('workspace')}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                    >
                      Return to Client Workspace
                    </button>
                  </div>
                </div>
              )
            ) : activeTab === 'logs' ? (
              <LiveConsole />
            ) : (
              <ClientWorkspace />
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Global Modals */}
      <PipelineModal />
      <InvoiceModal />
      <ClientSetupWizardModal />

      {/* Diagnostics & Debugging Overlays */}
      <ToastContainer />
      <DebugDrawer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorProvider>
      <AuthProvider>
        <ClientProvider>
          <AutomationProvider>
            <ErrorBoundary componentName="Root S4 Suite">
              <MainLayout />
            </ErrorBoundary>
          </AutomationProvider>
        </ClientProvider>
      </AuthProvider>
    </ErrorProvider>
  );
};

export default App;

