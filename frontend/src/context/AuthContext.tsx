import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AuthState, AuthUser } from '../types/auth';
import {
  requestOtpApi,
  verifyOtpApi,
  switchActiveOrganization,
  fetchCurrentUser,
  startAdminImpersonation,
  exitAdminImpersonation,
} from '../lib/api';

export interface ImpersonatingOrgState {
  id: string;
  name: string;
  org_type?: string;
  plan_tier?: string;
  subscription_status?: string;
  is_active?: boolean;
}

interface AuthContextType extends AuthState {
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  impersonatingOrg: ImpersonatingOrgState | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  requestOtp: (email: string) => Promise<{ success: boolean; message: string; dev_hint?: string | null }>;
  verifyOtp: (email: string, otp: string) => Promise<boolean>;
  switchOrganization: (organizationId: string) => Promise<boolean>;
  startImpersonation: (organizationId: string, reason?: string) => Promise<boolean>;
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [impersonatingOrg, setImpersonatingOrg] = useState<ImpersonatingOrgState | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    try {
      const impId = localStorage.getItem('S4_IMPERSONATE_ORG_ID');
      const impMeta = localStorage.getItem('S4_IMPERSONATE_ORG_META');
      if (impId && impMeta) {
        return JSON.parse(impMeta);
      }
      if (impId) {
        return { id: impId, name: impId };
      }
    } catch {}
    return null;
  });

  const [authState, setAuthState] = useState<AuthState>(() => {
    if (typeof localStorage === 'undefined') {
      return { isAuthenticated: false, user: null, token: null };
    }

    // Check URL parameters for explicit logout or 1-click magic auto-login
    if (typeof window !== 'undefined' && window?.location) {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      if (search.includes('logout') || search.includes('auth=login') || hash.includes('login') || hash.includes('logout')) {
        localStorage.removeItem('S4_AUTH_TOKEN');
        localStorage.removeItem('S4_AUTH_USER');
        localStorage.removeItem('S4_IMPERSONATE_ORG_ID');
        localStorage.removeItem('S4_IMPERSONATE_ORG_META');
        return { isAuthenticated: false, user: null, token: null };
      }

      // Check URL parameters for 1-click team invitation magic login
      const params = new URLSearchParams(search);
      const urlAuthToken = params.get('auth_token');
      if (urlAuthToken) {
        localStorage.setItem('S4_AUTH_TOKEN', urlAuthToken);
        params.delete('auth_token');
        const newSearch = params.toString() ? `?${params.toString()}` : '';
        try {
          window.history.replaceState({}, '', window.location.pathname + newSearch);
        } catch (_) {}
        return {
          isAuthenticated: true,
          token: urlAuthToken,
          user: null,
        };
      }
    }

    const token = localStorage.getItem('S4_AUTH_TOKEN');
    let user: AuthUser | null = null;
    try {
      const saved = localStorage.getItem('S4_AUTH_USER');
      if (saved) user = JSON.parse(saved);
    } catch (e) {
      console.warn('Failed parsing saved user:', e);
    }

    return {
      isAuthenticated: Boolean(token),
      token: token || null,
      user: user || (token ? { email: '', name: 'Authenticated Member', role: 'bookkeeper' } : null),
    };
  });

  // Listen for global session expiration events
  useEffect(() => {
    const handleAuthExpired = () => {
      logout();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('s4:auth:expired', handleAuthExpired);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('s4:auth:expired', handleAuthExpired);
      }
    };
  }, []);

  // Re-verify and refresh current user organizations on mount if token exists
  useEffect(() => {
    if (!authState.token) return;
    fetchCurrentUser()
      .then((res) => {
        if (res?.authenticated && res.user) {
          setAuthState((prev) => ({
            ...prev,
            user: res.user,
          }));
          localStorage.setItem('S4_AUTH_USER', JSON.stringify(res.user));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('s4:auth:changed'));
          }
          if (!res.user.is_platform_admin) {
            localStorage.removeItem('S4_IMPERSONATE_ORG_ID');
            localStorage.removeItem('S4_IMPERSONATE_ORG_META');
            setImpersonatingOrg(null);
          } else if (res.user.impersonating_org_id && res.user.organization) {
            const meta: ImpersonatingOrgState = {
              id: res.user.organization.id,
              name: res.user.organization.name,
              org_type: res.user.organization.org_type,
              plan_tier: res.user.organization.plan_tier,
              subscription_status: res.user.organization.subscription_status,
              is_active: res.user.organization.is_active,
            };
            localStorage.setItem('S4_IMPERSONATE_ORG_META', JSON.stringify(meta));
            setImpersonatingOrg(meta);
          }
        } else {
          logout();
        }
      })
      .catch((err) => {
        console.warn('Silent user session refresh notice:', err);
        if (err?.status === 401 || String(err?.message || '').includes('401')) {
          logout();
        }
      });
  }, [authState.token]);

  const login = (token: string, user: AuthUser) => {
    localStorage.setItem('S4_AUTH_TOKEN', token);
    localStorage.setItem('S4_AUTH_USER', JSON.stringify(user));
    localStorage.removeItem('S4_IMPERSONATE_ORG_ID');
    localStorage.removeItem('S4_IMPERSONATE_ORG_META');
    setImpersonatingOrg(null);
    setAuthState({
      isAuthenticated: true,
      token,
      user,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('s4:auth:changed'));
    }
  };

  const logout = () => {
    localStorage.removeItem('S4_AUTH_TOKEN');
    localStorage.removeItem('S4_AUTH_USER');
    localStorage.removeItem('S4_IMPERSONATE_ORG_ID');
    localStorage.removeItem('S4_IMPERSONATE_ORG_META');
    setImpersonatingOrg(null);
    setAuthState({
      isAuthenticated: false,
      token: null,
      user: null,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('s4:auth:changed'));
    }
  };

  const requestOtp = async (email: string) => {
    const res = await requestOtpApi(email);
    return {
      success: res.success,
      message: res.message,
      dev_hint: res.dev_hint,
    };
  };

  const verifyOtp = async (email: string, otp: string) => {
    const res = await verifyOtpApi(email, otp);
    if (res.success && res.access_token) {
      login(res.access_token, res.user);
      return true;
    }
    return false;
  };

  const switchOrganization = async (organizationId: string): Promise<boolean> => {
    try {
      const res = await switchActiveOrganization(organizationId);
      if (res?.success && res.user) {
        setAuthState((prev) => ({
          ...prev,
          user: res.user,
        }));
        localStorage.setItem('S4_AUTH_USER', JSON.stringify(res.user));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to switch active organization:', err);
      return false;
    }
  };

  const startImpersonation = async (organizationId: string, reason?: string): Promise<boolean> => {
    try {
      const res = await startAdminImpersonation(organizationId, reason);
      if (res?.success && res.impersonating_org) {
        localStorage.setItem('S4_IMPERSONATE_ORG_ID', organizationId);
        localStorage.setItem('S4_IMPERSONATE_ORG_META', JSON.stringify(res.impersonating_org));
        setImpersonatingOrg(res.impersonating_org);
        const me = await fetchCurrentUser();
        if (me?.authenticated && me.user) {
          setAuthState((prev) => ({
            ...prev,
            user: me.user,
          }));
          localStorage.setItem('S4_AUTH_USER', JSON.stringify(me.user));
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to start tenant impersonation:', err);
      return false;
    }
  };

  const exitImpersonation = async (): Promise<void> => {
    const currentId = impersonatingOrg?.id;
    try {
      await exitAdminImpersonation(currentId);
    } catch (err) {
      console.warn('Notice exiting impersonation:', err);
    } finally {
      localStorage.removeItem('S4_IMPERSONATE_ORG_ID');
      localStorage.removeItem('S4_IMPERSONATE_ORG_META');
      setImpersonatingOrg(null);
      try {
        const me = await fetchCurrentUser();
        if (me?.authenticated && me.user) {
          setAuthState((prev) => ({
            ...prev,
            user: me.user,
          }));
          localStorage.setItem('S4_AUTH_USER', JSON.stringify(me.user));
        }
      } catch {}
    }
  };

  const isPlatformAdmin = Boolean(authState.user?.is_platform_admin);
  const isOrgAdmin = Boolean(authState.user?.is_org_admin || authState.user?.role === 'admin' || isPlatformAdmin);

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        isPlatformAdmin,
        isOrgAdmin,
        impersonatingOrg,
        login,
        logout,
        requestOtp,
        verifyOtp,
        switchOrganization,
        startImpersonation,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
