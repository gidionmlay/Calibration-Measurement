/**
 * React Authentication Context and Provider.
 *
 * Implements OIDC PKCE authentication state management, automatic token
 * wiring into the API client, profile retrieval, and RBAC helpers.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { LoginPayload, RegisterPayload, UserProfile } from '../services/api/types';
import { OidcClient } from '../services/auth/oidc';
import { MOCK_PROFILES, createMockTokens } from '../services/auth/mock';
import { AuthContextValue, AuthTokens, SystemRoleName } from '../services/auth/types';

const LOCAL_STORAGE_TOKENS_KEY = 'bicycle_calibration_local_tokens';
const LOCAL_STORAGE_USER_KEY = 'bicycle_calibration_local_user';

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
  oidcClient?: OidcClient;
  defaultMockRole?: SystemRoleName;
  forceMock?: boolean;
}

export function AuthProvider({
  children,
  oidcClient: customOidcClient,
  defaultMockRole,
  forceMock,
}: AuthProviderProps) {
  const oidcClient = useMemo(() => customOidcClient || new OidcClient(), [customOidcClient]);

  const isMockAuth = useMemo(() => {
    if (forceMock !== undefined) return forceMock;
    if (typeof window !== 'undefined') {
      if (window.location.search.includes('mock=true')) return true;
      if (localStorage.getItem('bicycle_calibration_mock_auth') === 'true') return true;
    }
    return (
      import.meta.env?.VITE_MOCK_AUTH === 'true' ||
      import.meta.env?.MODE === 'test' ||
      defaultMockRole !== undefined
    );
  }, [forceMock, defaultMockRole]);

  const [user, setUser] = useState<UserProfile | null>(() => {
    if (isMockAuth && defaultMockRole) {
      return MOCK_PROFILES[defaultMockRole];
    }
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        // Ignore local parse errors
      }
    }
    return null;
  });

  const [tokens, setTokens] = useState<AuthTokens | null>(() => {
    if (isMockAuth && defaultMockRole) {
      return createMockTokens(defaultMockRole);
    }
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_TOKENS_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        // Ignore local parse errors
      }
    }
    return oidcClient.getTokens();
  });

  const [isLoading, setIsLoading] = useState<boolean>(!isMockAuth);
  const [error, setError] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'signin' | 'register'>('signin');

  const openAuthModal = useCallback((initialTab: 'signin' | 'register' = 'signin') => {
    setAuthModalTab(initialTab);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  // Wire token provider to API client so all backend requests carry Authorization header
  useEffect(() => {
    api.setTokenProvider(async () => {
      if (tokens) {
        return tokens.accessToken;
      }
      return oidcClient.getValidAccessToken();
    });
  }, [tokens, oidcClient]);

  // Synchronize user profile from backend API or mock
  const syncUserProfile = useCallback(async () => {
    try {
      setError(null);
      const profile = await api.auth.getProfile();
      setUser(profile);
      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
      }
    } catch (err) {
      // If backend call fails (e.g. backend down or 401), keep tokens or record error
      const msg = err instanceof Error ? err.message : 'Failed to retrieve user profile';
      setError(msg);
    }
  }, []);

  // Initialization and Callback Handling
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      // 1. Check for locally saved token credentials and profile first
      if (typeof window !== 'undefined') {
        const localTokensRaw = localStorage.getItem(LOCAL_STORAGE_TOKENS_KEY);
        const localUserRaw = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
        if (localTokensRaw) {
          try {
            const parsedTokens: AuthTokens = JSON.parse(localTokensRaw);
            setTokens(parsedTokens);
            if (localUserRaw) {
              try {
                setUser(JSON.parse(localUserRaw));
              } catch {
                // Ignore user parse errors
              }
            }
            if (!isMockAuth) {
              syncUserProfile().catch(() => undefined);
            }
            if (isMounted) setIsLoading(false);
            return;
          } catch {
            localStorage.removeItem(LOCAL_STORAGE_TOKENS_KEY);
            localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
          }
        }
      }

      if (isMockAuth) {
        if (defaultMockRole) {
          setUser(MOCK_PROFILES[defaultMockRole]);
          setTokens(createMockTokens(defaultMockRole));
        } else {
          setUser(null);
          setTokens(null);
        }
        setIsLoading(false);
        return;
      }

      // Existing session restoration via OIDC client
      const existingToken = await oidcClient.getValidAccessToken();
      if (existingToken) {
        try {
          setTokens(oidcClient.getTokens());
          await syncUserProfile();
        } catch {
          // Token invalid or expired
          oidcClient.clearTokens();
          setTokens(null);
          setUser(null);
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, [oidcClient, isMockAuth, defaultMockRole, syncUserProfile]);

  const login = useCallback(
    async (redirectPath?: string) => {
      setError(null);
      if (isMockAuth) {
        const role = defaultMockRole || 'measurer';
        setUser(MOCK_PROFILES[role]);
        setTokens(createMockTokens(role));
        return;
      }

      try {
        const authUrl = await oidcClient.buildAuthorizationUrl({ redirectPath });
        window.location.assign(authUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize login flow');
      }
    },
    [isMockAuth, defaultMockRole, oidcClient],
  );

  const loginWithCredentials = useCallback(
    async (payload: LoginPayload) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.auth.login(payload);
        const authTokens: AuthTokens = {
          accessToken: res.access_token,
          tokenType: res.token_type,
          refreshToken: res.refresh_token,
          expiresIn: res.expires_in,
          expiresAt: Date.now() + res.expires_in * 1000,
        };
        setTokens(authTokens);
        setUser(res.user);
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_TOKENS_KEY, JSON.stringify(authTokens));
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(res.user));
        }
        setIsAuthModalOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Login failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const registerWithCredentials = useCallback(
    async (payload: RegisterPayload) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.auth.register(payload);
        const authTokens: AuthTokens = {
          accessToken: res.access_token,
          tokenType: res.token_type,
          refreshToken: res.refresh_token,
          expiresIn: res.expires_in,
          expiresAt: Date.now() + res.expires_in * 1000,
        };
        setTokens(authTokens);
        setUser(res.user);
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_STORAGE_TOKENS_KEY, JSON.stringify(authTokens));
          localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(res.user));
        }
        setIsAuthModalOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    oidcClient.logout();
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_TOKENS_KEY);
      localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
    }
    setTokens(null);
    setUser(null);
    setError(null);
    api.setTokenProvider(undefined);

    if (!isMockAuth && typeof window !== 'undefined') {
      try {
        const logoutUrl = oidcClient.buildLogoutUrl();
        window.location.assign(logoutUrl);
      } catch {
        // Fallback to local reset
      }
    }
  }, [oidcClient, isMockAuth]);

  const handleCallback = useCallback(
    async (callbackUrl?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { tokens: newTokens } = await oidcClient.handleCallback(callbackUrl);
        setTokens(newTokens);
        await syncUserProfile();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication callback error');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [oidcClient, syncUserProfile],
  );

  const refreshUser = useCallback(async () => {
    if (isMockAuth && user) {
      return;
    }
    await syncUserProfile();
  }, [isMockAuth, user, syncUserProfile]);

  const hasRole = useCallback(
    (role: string): boolean => {
      if (!user?.roles) return false;
      const target = role.toLowerCase().trim();
      return user.roles.some((r) => r.toLowerCase().trim() === target);
    },
    [user],
  );

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user?.permissions) return false;
      const target = permission.toLowerCase().trim();
      return user.permissions.some((p) => p.toLowerCase().trim() === target);
    },
    [user],
  );

  const hasAnyRole = useCallback(
    (roles: string[]): boolean => {
      return roles.some((r) => hasRole(r));
    },
    [hasRole],
  );

  const hasAllPermissions = useCallback(
    (permissions: string[]): boolean => {
      return permissions.every((p) => hasPermission(p));
    },
    [hasPermission],
  );

  const activeRole = useMemo(() => {
    if (!user?.roles || user.roles.length === 0) return null;
    return user.roles[0];
  }, [user]);

  const switchMockRole = useCallback(
    async (role: SystemRoleName) => {
      if (!isMockAuth) return;
      const mockProfile = MOCK_PROFILES[role];
      const mockTok = createMockTokens(role);
      setUser(mockProfile);
      setTokens(mockTok);
      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_TOKENS_KEY, JSON.stringify(mockTok));
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(mockProfile));
      }
      setError(null);
    },
    [isMockAuth],
  );

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      tokens,
      isAuthenticated: !!user && !!tokens,
      isLoading,
      error,
      activeRole,
      isMockAuth,
      login,
      loginWithCredentials,
      registerWithCredentials,
      logout,
      isAuthModalOpen,
      authModalTab,
      openAuthModal,
      closeAuthModal,
      handleCallback,
      refreshUser,
      hasRole,
      hasPermission,
      hasAnyRole,
      hasAllPermissions,
      switchMockRole,
    }),
    [
      user,
      tokens,
      isLoading,
      error,
      activeRole,
      isMockAuth,
      login,
      loginWithCredentials,
      registerWithCredentials,
      logout,
      isAuthModalOpen,
      authModalTab,
      openAuthModal,
      closeAuthModal,
      handleCallback,
      refreshUser,
      hasRole,
      hasPermission,
      hasAnyRole,
      hasAllPermissions,
      switchMockRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}

