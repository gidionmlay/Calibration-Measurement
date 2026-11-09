/**
 * Unified API Client Module.
 *
 * Exports configuration, error hierarchy, data contracts, core HTTP client,
 * domain endpoints, and factory functions.
 */

export * from './config';
export * from './errors';
export * from './types';
export * from './client';
export * from './endpoints';

import { ApiClient } from './client';
import { ApiClientConfig } from './config';
import {
  createAdminEndpoints,
  createAuthEndpoints,
  createCalculationEndpoints,
  createSessionEndpoints,
  createSystemEndpoints,
} from './endpoints';

export interface ApiService {
  client: ApiClient;
  auth: ReturnType<typeof createAuthEndpoints>;
  sessions: ReturnType<typeof createSessionEndpoints>;
  calculations: ReturnType<typeof createCalculationEndpoints>;
  system: ReturnType<typeof createSystemEndpoints>;
  admin: ReturnType<typeof createAdminEndpoints>;
  setTokenProvider: (provider?: import('./config').TokenProvider) => void;
}

/**
 * Instantiate an integrated API service with all domain namespaces.
 */
export function createApiService(configOverrides: Partial<ApiClientConfig> = {}): ApiService {
  const client = new ApiClient(configOverrides);
  return {
    client,
    auth: createAuthEndpoints(client),
    sessions: createSessionEndpoints(client),
    calculations: createCalculationEndpoints(client),
    system: createSystemEndpoints(client),
    admin: createAdminEndpoints(client),
    setTokenProvider: (provider) => client.setTokenProvider(provider),
  };
}

/**
 * Singleton API service instance configured with environment defaults.
 */
export const api = createApiService();

