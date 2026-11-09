/**
 * Core HTTP API client using native fetch.
 *
 * Implements typed requests, timeout handling via AbortController,
 * bearer token injection, operation correlation (X-Operation-ID),
 * and normalized error transformation.
 */

import { ApiClientConfig, createApiConfig } from './config';
import { ApiClientError, NetworkError, TimeoutError, normalizeHttpError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  operationId?: string;
}

/**
 * Generate a RFC 4122 v4 UUID for operation tracing.
 */
function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Safe fallback for test environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const NOOP = () => {
  // No-op cleanup handler
};

/**
 * Combine multiple AbortSignals so that any abort triggers the controller.
 */
function linkAbortSignals(target: AbortController, externalSignal?: AbortSignal): () => void {
  if (!externalSignal) return NOOP;

  if (externalSignal.aborted) {
    target.abort(externalSignal.reason);
    return NOOP;
  }

  const onAbort = () => {
    target.abort(externalSignal.reason);
  };

  externalSignal.addEventListener('abort', onAbort, { once: true });
  return () => {
    externalSignal.removeEventListener('abort', onAbort);
  };
}

export class ApiClient {
  private readonly config: ApiClientConfig;

  constructor(configOverrides: Partial<ApiClientConfig> = {}) {
    this.config = createApiConfig(configOverrides);
  }

  /**
   * The effective base URL of the client.
   */
  public get baseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Dynamically configure or update the token provider.
   */
  public setTokenProvider(provider?: import('./config').TokenProvider): void {
    this.config.getToken = provider;
  }

  /**
   * Resolve an absolute or relative path against baseUrl, appending query params.
   */
  public buildUrl(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
    // Normalize path
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let fullUrl: string;

    if (this.config.baseUrl.startsWith('http://') || this.config.baseUrl.startsWith('https://')) {
      const base = this.config.baseUrl.endsWith('/') ? this.config.baseUrl.slice(0, -1) : this.config.baseUrl;
      fullUrl = `${base}${cleanPath}`;
    } else {
      // Relative base URL (e.g. '/api/v1')
      const base = this.config.baseUrl.endsWith('/') ? this.config.baseUrl.slice(0, -1) : this.config.baseUrl;
      fullUrl = `${base}${cleanPath}`;
    }

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
      }
    }

    return fullUrl;
  }

  /**
   * Perform an HTTP request with JSON serialization, timeout, authentication,
   * and standardized error handling.
   */
  public async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase() as HttpMethod;
    const url = this.buildUrl(path, options.params);
    const operationId = options.operationId || generateUUID();
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 15000;

    const controller = new AbortController();
    let isTimeout = false;

    // Timeout timer
    const timeoutId = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, timeoutMs);

    // Link caller's external AbortSignal if provided
    const cleanupSignal = linkAbortSignals(controller, options.signal);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Operation-ID': operationId,
      ...options.headers,
    };

    // Bearer token injection
    if (this.config.getToken) {
      try {
        const token = await this.config.getToken();
        if (token && typeof token === 'string' && token.trim() !== '') {
          headers['Authorization'] = `Bearer ${token.trim()}`;
        }
      } catch (err) {
        // Token retrieval failure
        clearTimeout(timeoutId);
        cleanupSignal();
        throw new ApiClientError(
          `Failed to obtain authentication token: ${err instanceof Error ? err.message : String(err)}`,
          { url, method, operationId },
        );
      }
    }

    // Body preparation
    let requestBody: string | undefined = undefined;
    if (options.body !== undefined && options.body !== null) {
      if (typeof options.body === 'string') {
        requestBody = options.body;
      } else {
        requestBody = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const fetchFn = this.config.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      clearTimeout(timeoutId);
      cleanupSignal();
      throw new NetworkError('No fetch implementation available in runtime environment.', {
        url,
        method,
        operationId,
      });
    }

    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      cleanupSignal();

      if (isTimeout) {
        throw new TimeoutError(timeoutMs, { url, method, operationId });
      }

      // If user externally aborted
      if (options.signal?.aborted) {
        const abortReason = options.signal.reason;
        throw new ApiClientError(
          `Request aborted: ${abortReason instanceof Error ? abortReason.message : String(abortReason || 'Operation canceled')}`,
          { url, method, operationId },
        );
      }

      // Other fetch/network errors
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new NetworkError(message, { url, method, operationId });
    } finally {
      clearTimeout(timeoutId);
      cleanupSignal();
    }

    // Process HTTP Response
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json') || contentType.includes('+json');

    if (response.ok) {
      if (isJson) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    }

    // Error response handling
    let problemDetail: import('./errors').ProblemDetail | undefined = undefined;
    let rawBody: string | undefined = undefined;

    try {
      if (isJson) {
        problemDetail = (await response.json()) as import('./errors').ProblemDetail;
      } else {
        rawBody = await response.text();
      }
    } catch {
      // Ignore response body reading failures on error paths
    }

    throw normalizeHttpError(
      response,
      problemDetail,
      rawBody,
      { url, method, operationId },
    );
  }

  // Convenience shorthand methods
  public get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  public put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  public patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  public delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}
