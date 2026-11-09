/**
 * API client configuration and environment resolution.
 *
 * Resolves the backend base URL using Vite environment variables
 * without exposing secrets or credentials in the frontend bundle.
 */

export type TokenProvider = () => Promise<string | null> | string | null;

export interface ApiClientConfig {
  /**
   * Base URL for backend API requests (e.g. 'http://127.0.0.1:8000/api/v1' or '/api/v1').
   */
  baseUrl: string;

  /**
   * Request timeout in milliseconds (default: 15,000ms).
   */
  timeoutMs?: number;

  /**
   * Pluggable token provider returning the active OIDC Bearer access token.
   */
  getToken?: TokenProvider;

  /**
   * Optional custom fetch implementation (useful for tests or mocking).
   */
  fetch?: typeof fetch;
}

const DEFAULT_DEV_API_URL = 'http://127.0.0.1:8000/api/v1';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Cleanly resolve and validate the API base URL from Vite environment.
 * Rejects invalid protocols or URLs containing embedded credentials/secrets.
 */
export function resolveApiBaseUrl(envUrl?: string): string {
  const raw = envUrl !== undefined ? envUrl : import.meta.env?.VITE_API_BASE_URL;

  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    // In browser/test mode without explicit env, fall back to default
    return DEFAULT_DEV_API_URL;
  }

  const trimmed = raw.trim();

  // Allow relative paths for same-origin proxying (e.g. '/api/v1')
  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol '${parsed.protocol}'. Only http: and https: are allowed.`);
    }
    if (parsed.username || parsed.password) {
      throw new Error('API base URL must not contain embedded basic auth credentials.');
    }
    return trimmed.replace(/\/+$/, '');
  } catch (err) {
    if (err instanceof Error && err.message.includes('protocol')) {
      throw err;
    }
    if (err instanceof Error && err.message.includes('credentials')) {
      throw err;
    }
    throw new Error(`Invalid VITE_API_BASE_URL '${trimmed}': must be a valid HTTP/HTTPS URL or relative path.`);
  }
}

/**
 * Build a validated configuration object with safe defaults.
 */
export function createApiConfig(overrides: Partial<ApiClientConfig> = {}): ApiClientConfig {
  return {
    baseUrl: resolveApiBaseUrl(overrides.baseUrl),
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    getToken: overrides.getToken,
    fetch: overrides.fetch ?? globalThis.fetch?.bind(globalThis),
  };
}

