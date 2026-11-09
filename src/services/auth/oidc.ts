/**
 * OpenID Connect (OIDC) client implementing PKCE authorization code flow.
 *
 * Provider-neutral implementation supporting Keycloak, Auth0, Google Identity,
 * and Okta without external dependencies.
 */

import { AuthenticationError } from '../api/errors';
import { generateCodeChallenge, generateCodeVerifier, generateNonce, generateState, base64UrlDecode } from './pkce';
import { AuthTokens, OidcConfig, ParsedJwt, PkceState } from './types';

const PKCE_STORAGE_KEY = 'calibration_oidc_pkce';
const TOKENS_STORAGE_KEY = 'calibration_oidc_tokens';
const DEFAULT_CLOCK_SKEW_SECONDS = 30;

export class OidcClient {
  private config: OidcConfig;
  private currentTokens: AuthTokens | null = null;
  private readonly storage: Storage;

  constructor(configOverrides: Partial<OidcConfig> = {}, storage: Storage = globalThis.sessionStorage) {
    this.storage = storage;

    const defaultIssuer =
      import.meta.env?.VITE_OIDC_ISSUER_URL || 'http://127.0.0.1:8080/realms/calibration';
    const defaultClientId = import.meta.env?.VITE_OIDC_CLIENT_ID || 'calibration-web-client';
    const defaultRedirect =
      import.meta.env?.VITE_OIDC_REDIRECT_URI ||
      (typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : 'http://127.0.0.1:5173/auth/callback');

    this.config = {
      issuerUrl: (configOverrides.issuerUrl || defaultIssuer).replace(/\/+$/, ''),
      clientId: configOverrides.clientId || defaultClientId,
      redirectUri: configOverrides.redirectUri || defaultRedirect,
      scope: configOverrides.scope || 'openid profile email',
      audience: configOverrides.audience || import.meta.env?.VITE_OIDC_AUDIENCE || 'calibration-backend-api',
      clockSkewSeconds: configOverrides.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
    };

    // Load persisted tokens if available
    this.currentTokens = this.loadStoredTokens();
  }

  public getConfig(): Readonly<OidcConfig> {
    return this.config;
  }

  public getTokens(): AuthTokens | null {
    return this.currentTokens;
  }

  /**
   * Endpoint URLs for OpenID Connect provider.
   */
  public get authorizationEndpoint(): string {
    return `${this.config.issuerUrl}/protocol/openid-connect/auth`;
  }

  public get tokenEndpoint(): string {
    return `${this.config.issuerUrl}/protocol/openid-connect/token`;
  }

  public get endSessionEndpoint(): string {
    return `${this.config.issuerUrl}/protocol/openid-connect/logout`;
  }

  /**
   * Parse a JWT without cryptographic verification (used client-side for claim inspection only).
   */
  public static parseJwt(token: string): ParsedJwt {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthenticationError('Invalid JWT token structure.');
    }

    try {
      const headerJson = base64UrlDecode(parts[0]);
      const payloadJson = base64UrlDecode(parts[1]);

      return {
        header: JSON.parse(headerJson),
        payload: JSON.parse(payloadJson),
      };
    } catch (err) {
      throw new AuthenticationError(
        `Failed to parse JWT token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Check whether a token is expired with configurable clock skew tolerance.
   */
  public isTokenExpired(token: string, clockSkewSeconds = this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS): boolean {
    try {
      const parsed = OidcClient.parseJwt(token);
      if (!parsed.payload.exp) {
        return false;
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      return parsed.payload.exp <= nowSeconds + clockSkewSeconds;
    } catch {
      return true;
    }
  }

  /**
   * Initiate authorization code flow with PKCE by generating state and building redirect URL.
   */
  public async buildAuthorizationUrl(options: { redirectPath?: string } = {}): Promise<string> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    const pkceState: PkceState = {
      codeVerifier,
      state,
      nonce,
      redirectPath: options.redirectPath || (typeof window !== 'undefined' ? window.location.pathname : '/'),
      timestamp: Date.now(),
    };

    // Store transient PKCE state in sessionStorage
    try {
      this.storage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pkceState));
    } catch {
      // Storage unavailable or disabled
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope || 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (this.config.audience) {
      params.append('audience', this.config.audience);
    }

    return `${this.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Complete the authorization code exchange after IdP redirects back with code.
   */
  public async handleCallback(callbackUrlString?: string): Promise<{ tokens: AuthTokens; redirectPath?: string }> {
    const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';
    const urlString = callbackUrlString || (typeof window !== 'undefined' ? window.location.href : `${defaultOrigin}/auth/callback`);
    const url = new URL(urlString, defaultOrigin);
    const searchParams = url.searchParams;

    const error = searchParams.get('error');
    if (error) {
      const errorDesc = searchParams.get('error_description') || error;
      throw new AuthenticationError(`IdP authentication error: ${errorDesc}`);
    }

    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');

    if (!code) {
      throw new AuthenticationError('Authorization callback missing code parameter.');
    }
    if (!returnedState) {
      throw new AuthenticationError('Authorization callback missing state parameter.');
    }

    // Retrieve and validate PKCE state
    let storedPkceState: PkceState | null = null;
    try {
      const raw = this.storage.getItem(PKCE_STORAGE_KEY);
      if (raw) {
        storedPkceState = JSON.parse(raw);
      }
    } catch {
      // ignore
    } finally {
      this.storage.removeItem(PKCE_STORAGE_KEY);
    }

    if (!storedPkceState) {
      throw new AuthenticationError('No matching PKCE flow found. The login session may have timed out.');
    }

    if (storedPkceState.state !== returnedState) {
      throw new AuthenticationError('Invalid state parameter. Potential CSRF attack detected.');
    }

    // Exchange authorization code for tokens
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
      code_verifier: storedPkceState.codeVerifier,
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      let errDetail = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json();
        errDetail = errJson.error_description || errJson.error || errDetail;
      } catch {
        // ignore
      }
      throw new AuthenticationError(`Token exchange failed: ${errDetail}`);
    }

    const data = await response.json();
    const expiresIn = data.expires_in || 300;
    const tokens: AuthTokens = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn,
      expiresAt: Date.now() + expiresIn * 1000,
      scope: data.scope,
    };

    this.saveTokens(tokens);
    return { tokens, redirectPath: storedPkceState.redirectPath };
  }

  /**
   * Silently refresh tokens using the refresh token.
   */
  public async refreshTokens(): Promise<AuthTokens | null> {
    if (!this.currentTokens?.refreshToken) {
      return null;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: this.currentTokens.refreshToken,
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      // Refresh token is revoked or expired; clear tokens
      this.clearTokens();
      return null;
    }

    const data = await response.json();
    const expiresIn = data.expires_in || 300;
    const newTokens: AuthTokens = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      idToken: data.id_token || this.currentTokens.idToken,
      refreshToken: data.refresh_token || this.currentTokens.refreshToken,
      expiresIn,
      expiresAt: Date.now() + expiresIn * 1000,
      scope: data.scope || this.currentTokens.scope,
    };

    this.saveTokens(newTokens);
    return newTokens;
  }

  /**
   * Return a valid access token, automatically refreshing if close to expiry.
   */
  public async getValidAccessToken(): Promise<string | null> {
    if (!this.currentTokens?.accessToken) {
      return null;
    }

    if (this.isTokenExpired(this.currentTokens.accessToken, 60)) {
      // Attempt refresh
      const refreshed = await this.refreshTokens();
      return refreshed ? refreshed.accessToken : null;
    }

    return this.currentTokens.accessToken;
  }

  /**
   * Persist tokens to active memory and storage.
   */
  public saveTokens(tokens: AuthTokens): void {
    this.currentTokens = tokens;
    try {
      this.storage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      // storage unavailable
    }
  }

  /**
   * Clear all active and persisted tokens and PKCE state.
   */
  public clearTokens(): void {
    this.currentTokens = null;
    try {
      this.storage.removeItem(TOKENS_STORAGE_KEY);
      this.storage.removeItem(PKCE_STORAGE_KEY);
    } catch {
      // storage unavailable
    }
  }

  /**
   * Build the IdP logout URL if end session endpoint is supported.
   */
  public buildLogoutUrl(postLogoutRedirectUri?: string): string {
    const redirectUri =
      postLogoutRedirectUri ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173');
    const idToken = this.currentTokens?.idToken;
    const params = new URLSearchParams({
      post_logout_redirect_uri: redirectUri,
    });
    if (idToken) {
      params.append('id_token_hint', idToken);
    }
    return `${this.endSessionEndpoint}?${params.toString()}`;
  }

  /**
   * Complete local and IdP logout.
   */
  public logout(): void {
    this.clearTokens();
  }

  private loadStoredTokens(): AuthTokens | null {
    try {
      const raw = this.storage.getItem(TOKENS_STORAGE_KEY);
      if (!raw) return null;
      const tokens: AuthTokens = JSON.parse(raw);
      // Validate structure
      if (tokens.accessToken && typeof tokens.expiresAt === 'number') {
        return tokens;
      }
    } catch {
      // ignore
    }
    return null;
  }
}
