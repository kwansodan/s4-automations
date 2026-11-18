import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ClientProvider } from './context/ClientContext';
import { AutomationProvider, useAutomation } from './context/AutomationContext';
import { ErrorProvider } from './context/ErrorContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ToastContainer } from './components/common/ToastContainer';
import { DebugDrawer } from './components/debug/DebugDrawer';
import { DocumentPreviewPane } from './components/common/DocumentPreviewPane';
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
import { ContactManagementSection } from './components/contacts/ContactManagementSection';
import { SheetsViewer } from './components/sheets/SheetsViewer';
import { MultiChannelLaunchpad } from './components/social/MultiChannelLaunchpad';
import { ChangelogSection } from './components/changelog/ChangelogSection';
import { LandingPage } from './components/landing/LandingPage';
import { LandingManagerSection } from './components/landing/LandingManagerSection';
import { AdminBillingSection } from './components/billing/AdminBillingSection';
import { MaintenanceView } from './components/landing/MaintenanceView';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { PlatformAdminConsole } from './components/admin/PlatformAdminConsole';
import {
  LandingPageConfig,
  DEFAULT_LANDING_CONFIG,
  fetchLandingPageConfig,
} from './lib/api';
import { Eye, LogOut, ShieldAlert } from 'lucide-react';
import { PipelineFloatingWidget } from './components/common/PipelineFloatingWidget';
import { AgentTeamRoomModal } from './components/modals/AgentTeamRoomModal';

const MainLayout: React.FC = () => {
  const { isAuthenticated, isPlatformAdmin, impersonatingOrg, exitImpersonation } = useAuth();
  const { activeTab, setActiveTab, setAdminSubTab, pipelineProgress, isInvoiceModalOpen, isSidebarCollapsed } = useAutomation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = (window.location.pathname || '').toLowerCase();
      const h = (window.location.hash || '').toLowerCase();
      return p.includes('login') || h.includes('login');
    }
    return false;
  });

  const [landingConfig, setLandingConfig] = useState<LandingPageConfig>(DEFAULT_LANDING_CONFIG);

  useEffect(() => {
    if (!isAuthenticated) {
      let isMounted = true;
      fetchLandingPageConfig()
        .then((cfg) => {
          if (isMounted && cfg) setLandingConfig(cfg);
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
  }, [isAuthenticated]);

  // Public Privacy Policy view accessible without authentication
  if (activeTab === 'privacy') {
    return (
      <ErrorBoundary componentName="Privacy Policy">
        <PrivacyPolicy onBack={() => setActiveTab(isAuthenticated ? 'workspace' : 'dashboard')} />
      </ErrorBoundary>
    );
  }

  // If user navigated directly to the Client Portal or followed a magic link
  const hasMagicParam =
    typeof window !== 'undefined' &&
    (window.location.search.includes('portal_magic') || window.location.search.includes('magic_token'));

  if (activeTab === 'portal' || hasMagicParam) {
    return (
      <ErrorBoundary componentName="Client Clarification Portal">
        <ClientPortal onBackToAdmin={() => setActiveTab('workspace')} />
      </ErrorBoundary>
    );
  }

  if (!isAuthenticated) {
    if (showLogin) {
      return (
        <ErrorBoundary componentName="Login View">
          <LoginCard
            onBackToLanding={
              landingConfig.mode !== 'login_only'
                ? () => {
                    setShowLogin(false);
                    if (typeof window !== 'undefined') {
                      window.history.replaceState({}, '', '/');
                    }
                  }
                : undefined
            }
          />
        </ErrorBoundary>
      );
    }

    if (landingConfig.mode === 'login_only') {
      return (
        <ErrorBoundary componentName="Login View">
          <LoginCard />
        </ErrorBoundary>
      );
    }

    if (landingConfig.mode === 'maintenance') {
      return (
        <ErrorBoundary componentName="Maintenance Mode">
          <MaintenanceView
            headline={landingConfig.maintenance_headline}
            message={landingConfig.maintenance_message}
            supportEmail={landingConfig.maintenance_support_email}
            whatsappNumber={landingConfig.whatsapp_number}
            onStaffLogin={() => {
              setShowLogin(true);
              if (typeof window !== 'undefined') {
                window.history.pushState({}, '', '/login');
              }
            }}
          />
        </ErrorBoundary>
      );
    }

    return (
      <ErrorBoundary componentName="Public Landing Page">
        <LandingPage
          initialConfig={landingConfig}
          onGoToLogin={() => {
            setShowLogin(true);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', '/login');
            }
          }}
          onOpenPortal={() => setActiveTab('portal')}
          onOpenPrivacy={() => setActiveTab('privacy')}
        />
      </ErrorBoundary>
    );
  }

  const isAdminSurface =
    activeTab === 'admin' ||
    activeTab === 'config' ||
    activeTab === 'landing-manager' ||
    activeTab === 'billing' ||
    activeTab === 'logs' ||
    activeTab === 'social';

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex font-sans selection:bg-[#0EA5E9]/20 selection:text-[#0284C7]">
      {/* Collapsible / Responsive Sidebar */}
      <Sidebar
        isMobileOpen={isMobileMenuOpen}
        setIsMobileOpen={setIsMobileMenuOpen}
      />

      {/* Main Content Area (Offset by dynamic sidebar width on desktop) */}
      <div className={`flex-1 flex flex-col min-w-0 ${isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'} transition-all duration-300`}>
        {impersonatingOrg && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950 z-40">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Impersonation Mode:</strong> Viewing workspace as{' '}
                <strong className="underline">{impersonatingOrg.name}</strong> ({impersonatingOrg.id})
              </span>
            </div>
            <button
              onClick={async () => {
                await exitImpersonation();
                setAdminSubTab('tenants');
                setActiveTab('admin');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] cursor-pointer transition"
            >
              <LogOut className="w-3 h-3" />
              Exit Tenant View
            </button>
          </div>
        )}

        <Header onOpenMobileMenu={() => setIsMobileMenuOpen(true)} />

        <main className="flex-1 w-full max-w-[2160px] mx-auto px-3 sm:px-6 lg:px-8 2xl:px-10 py-4 sm:py-6">
          {/* Dynamic Route Switching with Error Boundaries */}
          <ErrorBoundary componentName={`Tab: ${activeTab}`}>
            {activeTab === 'sheets' || activeTab === 'invoicing' ? (
              <SheetsViewer />
            ) : activeTab === 'contacts' ? (
              <ContactManagementSection />
            ) : activeTab === 'catalog' ? (
              <CatalogSection />
            ) : isAdminSurface ? (
              isPlatformAdmin ? (
                <PlatformAdminConsole />
              ) : (
                <div className="bg-white rounded-2xl p-8 border border-rose-200 shadow-sm text-center max-w-lg mx-auto my-12 space-y-4 animate-in fade-in">
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-[#0F172A]">Platform Super-Admin Required</h3>
                  <p className="text-xs text-[#64748B] leading-relaxed">
                    The Platform Admin Console controls multi-tenant provisioning, global secrets, billing ledgers, and cross-tenant audit telemetry. Only authorized Platform Super-Admins can access this surface.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab('workspace')}
                      className="px-4 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold transition cursor-pointer"
                    >
                      Return to Client Workspace
                    </button>
                  </div>
                </div>
              )
            ) : activeTab === 'changelog' ? (
              <ChangelogSection />
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
      <AgentTeamRoomModal />

      {/* Diagnostics & Debugging Overlays */}
      <ToastContainer />
      <DebugDrawer />
      <DocumentPreviewPane />

      {/* Multi-Tier Agent Co-Working Dock (0% View Blockage) */}
      {pipelineProgress?.is_running && !isInvoiceModalOpen && (
        <PipelineFloatingWidget />
      )}
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

