import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateRandomString,
  generateState,
} from './pkce';
import { OidcClient } from './oidc';
import { createMockJwt, createMockTokens, MOCK_PROFILES } from './mock';
import { AuthenticationError } from '../api/errors';

describe('PKCE Cryptographic Helpers (RFC 7636)', () => {
  it('encodes and decodes base64url strings without padding', () => {
    const raw = 'Hello World & Calibration!';
    const encoder = new TextEncoder();
    const encoded = base64UrlEncode(encoder.encode(raw));

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');

    const decoded = base64UrlDecode(encoded);
    expect(decoded).toBe(raw);
  });

  it('generates random strings of specified length', () => {
    const str1 = generateRandomString(16);
    const str2 = generateRandomString(16);
    expect(str1).toBeDefined();
    expect(str2).toBeDefined();
    expect(str1).not.toBe(str2);
  });

  it('generates a valid PKCE code verifier between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier(64);
    expect(verifier.length).toBe(64);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('computes S256 code challenge from a code verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // SHA256 of above RFC 7636 example string
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates unique state and nonce strings', () => {
    const state1 = generateState();
    const state2 = generateState();
    expect(state1).not.toBe(state2);

    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });
});

describe('OidcClient Authentication Flow', () => {
  let mockStorage: Storage;
  let storageMap: Map<string, string>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageMap = new Map();
    mockStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => storageMap.set(key, val),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
      key: () => null,
      length: 0,
    };
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('initializes with default configuration', () => {
    const client = new OidcClient({}, mockStorage);
    const config = client.getConfig();
    expect(config.issuerUrl).toBe('http://127.0.0.1:8080/realms/calibration');
    expect(config.clientId).toBe('calibration-web-client');
    expect(config.audience).toBe('calibration-backend-api');
    expect(client.authorizationEndpoint).toBe(
      'http://127.0.0.1:8080/realms/calibration/protocol/openid-connect/auth',
    );
    expect(client.tokenEndpoint).toBe(
      'http://127.0.0.1:8080/realms/calibration/protocol/openid-connect/token',
    );
  });

  it('builds authorization URL with PKCE parameters and stores state', async () => {
    const client = new OidcClient(
      {
        issuerUrl: 'https://auth.example.com',
        clientId: 'test-client',
        redirectUri: 'https://app.example.com/callback',
      },
      mockStorage,
    );

    const authUrl = await client.buildAuthorizationUrl({ redirectPath: '/session/123' });
    const parsed = new URL(authUrl);

    expect(parsed.origin).toBe('https://auth.example.com');
    expect(parsed.pathname).toBe('/protocol/openid-connect/auth');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('test-client');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeDefined();
    expect(parsed.searchParams.get('state')).toBeDefined();
    expect(parsed.searchParams.get('nonce')).toBeDefined();

    // Verify stored PKCE state
    const rawStored = mockStorage.getItem('calibration_oidc_pkce');
    expect(rawStored).toBeDefined();
    const stored = JSON.parse(rawStored!);
    expect(stored.state).toBe(parsed.searchParams.get('state'));
    expect(stored.redirectPath).toBe('/session/123');
  });

  it('rejects callback with IdP error', async () => {
    const client = new OidcClient({}, mockStorage);
    const callbackUrl = 'https://app.example.com/callback?error=access_denied&error_description=User+cancelled';

    try {
      await client.handleCallback(callbackUrl);
      expect.fail('Should have thrown AuthenticationError');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as Error).message).toContain('IdP authentication error: User cancelled');
    }
  });

  it('rejects callback when state parameter is missing or mismatched (CSRF protection)', async () => {
    const client = new OidcClient({}, mockStorage);

    // No stored PKCE state
    await expect(
      client.handleCallback('https://app.example.com/callback?code=abc&state=xyz'),
    ).rejects.toThrow(/No matching PKCE flow found/);

    // Mismatched state
    mockStorage.setItem(
      'calibration_oidc_pkce',
      JSON.stringify({ codeVerifier: 'verifier123', state: 'correct-state' }),
    );

    await expect(
      client.handleCallback('https://app.example.com/callback?code=abc&state=wrong-state'),
    ).rejects.toThrow(/Invalid state parameter. Potential CSRF attack detected/);
  });

  it('successfully exchanges code for tokens and persists session', async () => {
    const client = new OidcClient(
      {
        issuerUrl: 'https://auth.example.com',
        clientId: 'test-client',
        redirectUri: 'https://app.example.com/callback',
      },
      mockStorage,
    );

    mockStorage.setItem(
      'calibration_oidc_pkce',
      JSON.stringify({
        codeVerifier: 'test-verifier-xyz',
        state: 'valid-state',
        redirectPath: '/setup',
      }),
    );

    const mockTokenResponse = {
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      id_token: 'mock-id-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 300,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(mockTokenResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { tokens, redirectPath } = await client.handleCallback(
      'https://app.example.com/callback?code=valid-code&state=valid-state',
    );

    expect(tokens.accessToken).toBe('mock-access-token');
    expect(tokens.refreshToken).toBe('mock-refresh-token');
    expect(redirectPath).toBe('/setup');

    // Verify token endpoint call
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [endpointUrl, init] = mockFetch.mock.calls[0];
    expect(endpointUrl).toBe('https://auth.example.com/protocol/openid-connect/token');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain('code_verifier=test-verifier-xyz');

    // PKCE state removed, tokens stored
    expect(mockStorage.getItem('calibration_oidc_pkce')).toBeNull();
    expect(mockStorage.getItem('calibration_oidc_tokens')).toBeDefined();
  });

  it('parses JWT payload and evaluates expiration', () => {
    const profile = MOCK_PROFILES.measurer;
    const token = createMockJwt(profile, 3600); // Expires in 1 hour

    const parsed = OidcClient.parseJwt(token);
    expect(parsed.payload.sub).toBe(profile.subject);
    expect(parsed.payload.email).toBe(profile.email);
    expect(parsed.payload.roles).toContain('measurer');

    const client = new OidcClient({}, mockStorage);
    expect(client.isTokenExpired(token)).toBe(false);

    // Expired token
    const expiredToken = createMockJwt(profile, -10); // Expired 10s ago
    expect(client.isTokenExpired(expiredToken)).toBe(true);
  });

  it('silently refreshes tokens using refresh token', async () => {
    const client = new OidcClient({}, mockStorage);
    client.saveTokens({
      accessToken: 'old-access-token',
      tokenType: 'Bearer',
      refreshToken: 'valid-refresh-token',
      expiresIn: 300,
      expiresAt: Date.now() - 5000, // Expired
    });

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          refresh_token: 'new-refresh-token',
          expires_in: 600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const newTokens = await client.refreshTokens();
    expect(newTokens).toBeDefined();
    expect(newTokens!.accessToken).toBe('new-access-token');
    expect(newTokens!.refreshToken).toBe('new-refresh-token');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/protocol/openid-connect/token');
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain('refresh_token=valid-refresh-token');
  });

  it('clears session on logout', () => {
    const client = new OidcClient({}, mockStorage);
    client.saveTokens(createMockTokens('measurer'));

    expect(client.getTokens()).not.toBeNull();
    expect(mockStorage.getItem('calibration_oidc_tokens')).not.toBeNull();

    client.logout();

    expect(client.getTokens()).toBeNull();
    expect(mockStorage.getItem('calibration_oidc_tokens')).toBeNull();
  });
});

describe('Mock Auth Provider Helpers', () => {
  it('provides all five system roles with correct permissions', () => {
    expect(MOCK_PROFILES.measurer.roles).toContain('measurer');
    expect(MOCK_PROFILES.measurer.permissions).toContain('session:create');

    expect(MOCK_PROFILES.reviewer.roles).toContain('reviewer');
    expect(MOCK_PROFILES.reviewer.permissions).toContain('session:review');

    expect(MOCK_PROFILES.supervisor.roles).toContain('supervisor');
    expect(MOCK_PROFILES.supervisor.permissions).toContain('policy:approve');

    expect(MOCK_PROFILES.auditor.roles).toContain('auditor');
    expect(MOCK_PROFILES.auditor.permissions).toContain('audit:read');

    expect(MOCK_PROFILES.admin.roles).toContain('admin');
    expect(MOCK_PROFILES.admin.permissions).toContain('role:manage');
  });
});
