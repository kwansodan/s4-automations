import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AuthState, AuthUser } from '../types/auth';
import { requestOtpApi, verifyOtpApi } from '../lib/api';

interface AuthContextType extends AuthState {
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  requestOtp: (email: string) => Promise<{ success: boolean; message: string; dev_hint?: string | null }>;
  verifyOtp: (email: string, otp: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>(() => {
    if (typeof localStorage === 'undefined') {
      return { isAuthenticated: false, user: null, token: null };
    }
    
    // Check URL parameters for explicit logout
    if (typeof window !== 'undefined' && window?.location) {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      if (search.includes('logout') || search.includes('auth=login') || hash.includes('login') || hash.includes('logout')) {
        localStorage.removeItem('S4_AUTH_TOKEN');
        localStorage.removeItem('S4_AUTH_USER');
        return { isAuthenticated: false, user: null, token: null };
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
      user: user || (token ? { email: 's4bookkeeping@service4gh.com', name: 'S4 Bookkeeping Admin', role: 'admin' } : null),
    };
  });

  const login = (token: string, user: AuthUser) => {
    localStorage.setItem('S4_AUTH_TOKEN', token);
    localStorage.setItem('S4_AUTH_USER', JSON.stringify(user));
    setAuthState({
      isAuthenticated: true,
      token,
      user,
    });
  };

  const logout = () => {
    localStorage.removeItem('S4_AUTH_TOKEN');
    localStorage.removeItem('S4_AUTH_USER');
    setAuthState({
      isAuthenticated: false,
      token: null,
      user: null,
    });
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

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        requestOtp,
        verifyOtp,
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
