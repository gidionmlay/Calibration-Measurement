/**
 * Authentication and OIDC types.
 *
 * Defines contracts for OpenID Connect configuration, PKCE exchange,
 * token lifecycle, JWT claims, and user state.
 */

import { LoginPayload, RegisterPayload, UserProfile } from '../api/types';

export type SystemRoleName = 'measurer' | 'reviewer' | 'supervisor' | 'auditor' | 'admin';

export type SystemPermissionCode =
  | 'session:create'
  | 'session:read'
  | 'session:update'
  | 'session:submit_review'
  | 'session:review'
  | 'audit:read'
  | 'audit:verify'
  | 'role:manage'
  | 'policy:approve'
  | 'system:admin';

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  audience?: string;
  clockSkewSeconds?: number;
}

export interface AuthTokens {
  accessToken: string;
  tokenType: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: number; // Wall-clock timestamp in ms
  scope?: string;
}

export interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
  [key: string]: unknown;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown;
}

export interface ParsedJwt {
  header: JwtHeader;
  payload: JwtClaims;
}

export interface PkceState {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirectPath?: string;
  timestamp: number;
}

export interface AuthContextValue {
  user: UserProfile | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  activeRole: string | null;
  isMockAuth: boolean;
  login: (redirectPath?: string) => Promise<void>;
  loginWithCredentials: (payload: LoginPayload) => Promise<void>;
  registerWithCredentials: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  isAuthModalOpen: boolean;
  authModalTab: 'signin' | 'register';
  openAuthModal: (initialTab?: 'signin' | 'register') => void;
  closeAuthModal: () => void;
  handleCallback: (callbackUrl?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  switchMockRole?: (role: SystemRoleName) => Promise<void>;
}

