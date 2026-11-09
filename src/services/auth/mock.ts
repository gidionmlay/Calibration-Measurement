/**
 * Mock authentication provider for offline development and headless testing.
 *
 * Provides realistic pre-configured profiles and JWT tokens representing
 * the five application roles without requiring a live Keycloak server.
 */

import { UserProfile } from '../api/types';
import { base64UrlEncode } from './pkce';
import { AuthTokens, SystemRoleName } from './types';

export const MOCK_PROFILES: Record<SystemRoleName, UserProfile> = {
  measurer: {
    id: '11111111-1111-4111-8111-111111111111',
    issuer: 'http://mock-idp.calibration.local',
    subject: 'mock-sub-measurer-01',
    display_name: 'Alex Rivera (Measurer)',
    email: 'alex.measurer@calibration.local',
    email_verified: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_authenticated_at: new Date().toISOString(),
    roles: ['measurer'],
    permissions: [
      'session:create',
      'session:read',
      'session:update',
      'session:submit_review',
    ],
  },
  reviewer: {
    id: '22222222-2222-4222-8222-222222222222',
    issuer: 'http://mock-idp.calibration.local',
    subject: 'mock-sub-reviewer-02',
    display_name: 'Morgan Vance (Reviewer)',
    email: 'morgan.reviewer@calibration.local',
    email_verified: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_authenticated_at: new Date().toISOString(),
    roles: ['reviewer'],
    permissions: ['session:read', 'session:review'],
  },
  supervisor: {
    id: '33333333-3333-4333-8333-333333333333',
    issuer: 'http://mock-idp.calibration.local',
    subject: 'mock-sub-supervisor-03',
    display_name: 'Jordan Hayes (Supervisor)',
    email: 'jordan.supervisor@calibration.local',
    email_verified: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_authenticated_at: new Date().toISOString(),
    roles: ['supervisor', 'measurer', 'reviewer'],
    permissions: [
      'session:create',
      'session:read',
      'session:update',
      'session:submit_review',
      'session:review',
      'policy:approve',
    ],
  },
  auditor: {
    id: '44444444-4444-4444-8444-444444444444',
    issuer: 'http://mock-idp.calibration.local',
    subject: 'mock-sub-auditor-04',
    display_name: 'Sam Taylor (Auditor)',
    email: 'sam.auditor@calibration.local',
    email_verified: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_authenticated_at: new Date().toISOString(),
    roles: ['auditor'],
    permissions: ['session:read', 'audit:read', 'audit:verify'],
  },
  admin: {
    id: '55555555-5555-4555-8555-555555555555',
    issuer: 'http://mock-idp.calibration.local',
    subject: 'mock-sub-admin-05',
    display_name: 'Pat Chen (Admin)',
    email: 'pat.admin@calibration.local',
    email_verified: true,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_authenticated_at: new Date().toISOString(),
    roles: ['admin', 'supervisor', 'measurer', 'reviewer', 'auditor'],
    permissions: [
      'session:create',
      'session:read',
      'session:update',
      'session:submit_review',
      'session:review',
      'audit:read',
      'audit:verify',
      'role:manage',
      'policy:approve',
      'system:admin',
    ],
  },
};

/**
 * Generate a synthetic well-formed JWT token for a given mock profile.
 */
export function createMockJwt(profile: UserProfile, expiresInSeconds = 3600): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'mock-key-01',
  };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: profile.issuer,
    sub: profile.subject,
    aud: 'calibration-backend-api',
    exp: nowSeconds + expiresInSeconds,
    nbf: nowSeconds,
    iat: nowSeconds,
    email: profile.email,
    email_verified: profile.email_verified,
    name: profile.display_name,
    roles: profile.roles,
    permissions: profile.permissions,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signatureB64 = base64UrlEncode(encoder.encode('mock-signature-bytes'));

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Generate synthetic AuthTokens for a mock profile.
 */
export function createMockTokens(role: SystemRoleName = 'measurer', expiresIn = 3600): AuthTokens {
  const profile = MOCK_PROFILES[role];
  const accessToken = createMockJwt(profile, expiresIn);
  const idToken = createMockJwt(profile, expiresIn);

  return {
    accessToken,
    tokenType: 'Bearer',
    idToken,
    refreshToken: `mock-refresh-token-${role}`,
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: 'openid profile email',
  };
}

