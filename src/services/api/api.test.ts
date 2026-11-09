import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ApiClient,
  resolveApiBaseUrl,
  createApiConfig,
  createApiService,
  ApiClientError,
  NetworkError,
  TimeoutError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
  normalizeHttpError,
} from './index';

describe('API Configuration & URL Resolution', () => {
  it('resolves default development URL when no environment or override is provided', () => {
    expect(resolveApiBaseUrl(undefined)).toBe('http://127.0.0.1:8000/api/v1');
    expect(resolveApiBaseUrl('')).toBe('http://127.0.0.1:8000/api/v1');
    expect(resolveApiBaseUrl('   ')).toBe('http://127.0.0.1:8000/api/v1');
  });

  it('normalizes trailing slashes on base URLs', () => {
    expect(resolveApiBaseUrl('http://api.example.com/api/v1/')).toBe('http://api.example.com/api/v1');
    expect(resolveApiBaseUrl('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('allows relative paths for reverse-proxy deployments', () => {
    expect(resolveApiBaseUrl('/api/v1/')).toBe('/api/v1');
    expect(resolveApiBaseUrl('/custom/api')).toBe('/custom/api');
  });

  it('rejects invalid URL protocols', () => {
    expect(() => resolveApiBaseUrl('ftp://api.example.com')).toThrowError(/Invalid protocol/);
    expect(() => resolveApiBaseUrl('javascript:alert(1)')).toThrowError();
  });

  it('rejects base URLs containing embedded credentials', () => {
    expect(() => resolveApiBaseUrl('http://user:pass@127.0.0.1:8000/api/v1')).toThrowError(
      /embedded basic auth credentials/,
    );
  });

  it('creates configuration with default timeout and safe defaults', () => {
    const config = createApiConfig();
    expect(config.baseUrl).toBe('http://127.0.0.1:8000/api/v1');
    expect(config.timeoutMs).toBe(15000);
  });
});

describe('URL Building and Parameter Serialization', () => {
  it('correctly appends query parameters to request URL', () => {
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1' });
    const url = client.buildUrl('/auth/users/123/roles/admin', {
      reason: 'Administrative escalation',
      active_only: true,
      limit: 10,
    });

    expect(url).toBe(
      'http://127.0.0.1:8000/api/v1/auth/users/123/roles/admin?reason=Administrative+escalation&active_only=true&limit=10',
    );
  });

  it('ignores null and undefined query parameters', () => {
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1' });
    const url = client.buildUrl('/test', {
      valid: 'yes',
      empty: null,
      missing: undefined,
    });

    expect(url).toBe('http://127.0.0.1:8000/api/v1/test?valid=yes');
  });
});

describe('ApiClient Request & Header Mechanics', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('auto-generates X-Operation-ID when not supplied', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });
    await client.request('/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['X-Operation-ID']).toBeDefined();
    expect(init.headers['X-Operation-ID']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('preserves caller-supplied X-Operation-ID', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });
    const customOpId = '11111111-2222-3333-4444-555555555555';
    await client.request('/test', { operationId: customOpId });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['X-Operation-ID']).toBe(customOpId);
  });

  it('injects Bearer token when TokenProvider returns a valid token string', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: 'active' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      getToken: async () => 'mock-access-token-12345',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.request('/auth/me');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer mock-access-token-12345');
  });

  it('omits Authorization header when getToken returns null or empty string', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'public' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      getToken: async () => '   ',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.request('/auth/status');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('throws ApiClientError when TokenProvider throws an error', async () => {
    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      getToken: async () => {
        throw new Error('Keycloak refresh session expired');
      },
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.request('/auth/me')).rejects.toThrow(
      /Failed to obtain authentication token: Keycloak refresh session expired/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('correctly sets Content-Type and serializes JSON payload', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'new-id' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });
    const payload = { name: 'Morning Calibration', course_length_m: '1000.0000' };

    await client.post('/sessions', payload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it('handles HTTP 204 No Content returning undefined', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });
    const result = await client.delete('/resource/123');

    expect(result).toBeUndefined();
  });

  it('returns text response when Content-Type is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Plain text message', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });
    const result = await client.get('/text-endpoint');

    expect(result).toBe('Plain text message');
  });

  it('maps network disconnects to NetworkError', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:8000/api/v1', fetch: mockFetch as unknown as typeof fetch });

    await expect(client.request('/test')).rejects.toThrow(NetworkError);
  });

  it('maps request timeouts to TimeoutError', async () => {
    // Simulate timeout by aborting inside fetch or slow response
    mockFetch.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      timeoutMs: 50,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.request('/test')).rejects.toThrow(TimeoutError);
  });

  it('handles caller AbortSignal cancellation', async () => {
    const callerController = new AbortController();

    mockFetch.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const client = new ApiClient({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      timeoutMs: 5000,
      fetch: mockFetch as unknown as typeof fetch,
    });

    const promise = client.request('/test', { signal: callerController.signal });
    callerController.abort('User navigated away');

    await expect(promise).rejects.toThrow(/User navigated away/);
  });
});

describe('Error Hierarchy & HTTP Status Normalization', () => {
  it('normalizes HTTP 401 to AuthenticationError', () => {
    const response = new Response(JSON.stringify({ detail: 'Token has expired.' }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    });
    const err = normalizeHttpError(response, { detail: 'Token has expired.' });

    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Token has expired.');
  });

  it('normalizes HTTP 403 to AuthorizationError and identifies Separation of Duties', () => {
    const response = new Response(
      JSON.stringify({ detail: 'Separation of duties violation: measurers cannot review their own session.' }),
      {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const err = normalizeHttpError(response, {
      detail: 'Separation of duties violation: measurers cannot review their own session.',
    }) as AuthorizationError;

    expect(err).toBeInstanceOf(AuthorizationError);
    expect(err.status).toBe(403);
    expect(err.isSeparationOfDutiesViolation).toBe(true);
    expect(err.isDraftIsolation).toBe(false);
  });

  it('normalizes HTTP 403 to AuthorizationError and identifies Draft Isolation', () => {
    const response = new Response(
      JSON.stringify({ detail: 'Draft sessions can only be accessed by their creator or an auditor.' }),
      {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const err = normalizeHttpError(response, {
      detail: 'Draft sessions can only be accessed by their creator or an auditor.',
    }) as AuthorizationError;

    expect(err).toBeInstanceOf(AuthorizationError);
    expect(err.status).toBe(403);
    expect(err.isSeparationOfDutiesViolation).toBe(false);
    expect(err.isDraftIsolation).toBe(true);
  });

  it('normalizes HTTP 404 to NotFoundError', () => {
    const response = new Response(JSON.stringify({ detail: "Session 'abc' was not found." }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    });
    const err = normalizeHttpError(response, { detail: "Session 'abc' was not found." });

    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.status).toBe(404);
  });

  it('normalizes HTTP 409 to ConflictError and extracts version mismatch numbers', () => {
    const response = new Response(
      JSON.stringify({
        detail: 'Conflict: Session version mismatch. Expected version 2, current database version is 3.',
      }),
      {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const err = normalizeHttpError(response, {
      detail: 'Conflict: Session version mismatch. Expected version 2, current database version is 3.',
    }) as ConflictError;

    expect(err).toBeInstanceOf(ConflictError);
    expect(err.status).toBe(409);
    expect(err.expectedVersion).toBe(2);
    expect(err.currentVersion).toBe(3);
  });

  it('normalizes HTTP 422 to ValidationError and parses field-level issues', () => {
    const validationBody = {
      detail: [
        {
          loc: ['body', 'course_length_m'],
          msg: 'course_length_m precision cannot exceed 4 decimal places (scale <= 4).',
          type: 'value_error',
        },
        {
          loc: ['body', 'name'],
          msg: 'Field required',
          type: 'missing',
        },
      ],
    };
    const response = new Response(JSON.stringify(validationBody), {
      status: 422,
      statusText: 'Unprocessable Content',
      headers: { 'Content-Type': 'application/json' },
    });
    const err = normalizeHttpError(response, validationBody) as ValidationError;

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toHaveLength(2);
    expect(err.fieldErrors[0].field).toBe('course_length_m');
    expect(err.fieldErrors[0].message).toContain('precision cannot exceed 4 decimal places');
    expect(err.fieldErrors[1].field).toBe('name');
  });

  it('normalizes HTTP 429 to RateLimitError and extracts Retry-After header', () => {
    const response = new Response(JSON.stringify({ detail: 'Rate limit exceeded.' }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Retry-After': '60', 'Content-Type': 'application/json' },
    });
    const err = normalizeHttpError(response, { detail: 'Rate limit exceeded.' }) as RateLimitError;

    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(60);
  });

  it('normalizes HTTP 500 to ServerError', () => {
    const response = new Response(JSON.stringify({ detail: 'Database connection failed' }), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'application/json' },
    });
    const err = normalizeHttpError(response, { detail: 'Database connection failed' });

    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(500);
  });

  it('provides comprehensive diagnostic string representation', () => {
    const err = new ConflictError('Version mismatch', {
      url: 'http://127.0.0.1:8000/api/v1/sessions/123',
      method: 'PUT',
      operationId: 'test-op-123',
      status: 409,
      problemDetail: { detail: 'Version mismatch' },
    });

    const diag = err.toDiagnosticString();
    expect(diag).toContain('ConflictError (409): Version mismatch');
    expect(diag).toContain('Request: PUT http://127.0.0.1:8000/api/v1/sessions/123');
    expect(diag).toContain('Operation ID: test-op-123');
  });
});

describe('Domain Endpoints Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let apiService: ReturnType<typeof createApiService>;

  beforeEach(() => {
    mockFetch = vi.fn();
    apiService = createApiService({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      fetch: mockFetch as unknown as typeof fetch,
    });
  });

  describe('Auth & RBAC Endpoints', () => {
    it('registers a new autonomous measurer via POST /auth/register', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'acc-jwt-token-123',
            token_type: 'Bearer',
            expires_in: 86400,
            refresh_token: 'ref-jwt-token-456',
            user: {
              id: 'u-measurer-1',
              issuer: 'local',
              subject: 'u-measurer-1',
              display_name: 'Jane Measurer',
              email: 'jane@athletics.org',
              email_verified: true,
              organization: 'World Athletics',
              status: 'active',
              created_at: '2026-11-08T00:00:00Z',
              roles: ['measurer'],
              permissions: ['session:create'],
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await apiService.auth.register({
        email: 'jane@athletics.org',
        password: 'Password123!',
        display_name: 'Jane Measurer',
        organization: 'World Athletics',
      });

      expect(res.access_token).toBe('acc-jwt-token-123');
      expect(res.user.organization).toBe('World Athletics');
      expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/auth/register');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('authenticates via POST /auth/login', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'acc-login-token-789',
            token_type: 'Bearer',
            expires_in: 86400,
            refresh_token: 'ref-login-token-999',
            user: {
              id: 'u-measurer-1',
              issuer: 'local',
              subject: 'u-measurer-1',
              display_name: 'Jane Measurer',
              email: 'jane@athletics.org',
              email_verified: true,
              status: 'active',
              created_at: '2026-11-08T00:00:00Z',
              roles: ['measurer'],
              permissions: ['session:create'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await apiService.auth.login({
        email: 'jane@athletics.org',
        password: 'Password123!',
      });

      expect(res.access_token).toBe('acc-login-token-789');
      expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/auth/login');
    });

    it('calls getProfile via GET /auth/me', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'u1',
            issuer: 'http://idp',
            subject: 'sub1',
            status: 'active',
            email_verified: true,
            created_at: '2026-01-01',
            roles: ['measurer'],
            permissions: ['session:create'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const profile = await apiService.auth.getProfile();
      expect(profile.id).toBe('u1');
      expect(profile.roles).toContain('measurer');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/auth/me');
      expect(init.method).toBe('GET');
    });

    it('calls listRoles via GET /auth/roles', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'r1', name: 'measurer', permissions: [] }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const roles = await apiService.auth.listRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0].name).toBe('measurer');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/auth/roles');
    });

    it('calls assignRole via POST /auth/users/:userId/roles', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'a1',
            user_id: 'u2',
            role_id: 'r2',
            role_name: 'reviewer',
            assigned_at: '2026-01-01',
            is_active: true,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const assignment = await apiService.auth.assignRole('u2', {
        role_name: 'reviewer',
        reason: 'Authorized reviewer certification completed',
      });

      expect(assignment.role_name).toBe('reviewer');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/auth/users/u2/roles');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        role_name: 'reviewer',
        reason: 'Authorized reviewer certification completed',
      });
    });

    it('calls revokeRole via DELETE /auth/users/:userId/roles/:roleName?reason=...', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'a1',
            user_id: 'u2',
            role_id: 'r2',
            role_name: 'reviewer',
            assigned_at: '2026-01-01',
            revoked_at: '2026-02-01',
            is_active: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const assignment = await apiService.auth.revokeRole('u2', 'reviewer', 'Transferred to different department');

      expect(assignment.is_active).toBe(false);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'http://127.0.0.1:8000/api/v1/auth/users/u2/roles/reviewer?reason=Transferred+to+different+department',
      );
      expect(init.method).toBe('DELETE');
    });
  });

  describe('Session Endpoints', () => {
    it('creates session via POST /sessions', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 's1',
            version: 1,
            schema_version: 1,
            status: 'draft',
            name: 'Test Session',
            course_length_m: '1000.0000',
            course_length_unit: 'm',
            rollover_mode: 'none',
            constant_selection_rule: 'larger',
            working_spec_version: 'ws-0.3-provisional',
            policy_approval_status: 'provisional',
            is_provisional: true,
            rides: [],
            reviews: [],
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const session = await apiService.sessions.create({
        name: 'Test Session',
        course_length_m: '1000.0000',
      });

      expect(session.id).toBe('s1');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions');
      expect(init.method).toBe('POST');
    });

    it('submits session for review via POST /sessions/:id/submit', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 's1', status: 'needs_review' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const session = await apiService.sessions.submit('s1', { notes: 'Ready for peer verification' });
      expect(session.status).toBe('needs_review');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/submit');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ notes: 'Ready for peer verification' });
    });

    it('submits peer review via POST /sessions/:id/reviews', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'r1',
            reviewer_id: 'u3',
            status: 'approved',
            is_invalidated: false,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const review = await apiService.sessions.review('s1', {
        expected_version: 2,
        status: 'approved',
        comments: 'Rides meet spread criteria.',
      });

      expect(review.status).toBe('approved');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/reviews');
      expect(init.method).toBe('POST');
    });

    it('fetches and verifies audit trail', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 'a1', sequence_num: 1, event_type: 'genesis' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ is_valid: true, total_events: 1, verified_events: 1, errors: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const events = await apiService.sessions.getAuditTrail('s1');
      expect(events).toHaveLength(1);

      const verification = await apiService.sessions.verifyAudit('s1');
      expect(verification.is_valid).toBe(true);

      expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/audit-trail');
      expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/verify-audit');
    });

    it('finalizes session via POST /sessions/:id/finalize', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 's1',
            status: 'finalized',
            version: 4,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const finalized = await apiService.sessions.finalize('s1', {
        expected_version: 3,
        confirm_provisional_policy: true,
        supervisor_notes: 'Approved for field deployment',
      });

      expect(finalized.status).toBe('finalized');
      expect(finalized.version).toBe(4);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/finalize');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        expected_version: 3,
        confirm_provisional_policy: true,
        supervisor_notes: 'Approved for field deployment',
      });
    });

    it('creates session revision via POST /sessions/:id/revisions', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 's2',
            status: 'draft',
            supersedes_id: 's1',
            version: 1,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const revision = await apiService.sessions.createRevision('s1', {
        revision_reason: 'Recalculation with new temperature offset',
      });

      expect(revision.id).toBe('s2');
      expect(revision.status).toBe('draft');
      expect(revision.supersedes_id).toBe('s1');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions/s1/revisions');
      expect(init.method).toBe('POST');
    });

    it('retrieves session lineage via GET /sessions/:id/lineage', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            current_session_id: 's2',
            ancestors: [{ id: 's1', status: 'superseded' }],
            descendants: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const lineage = await apiService.sessions.getLineage('s2');
      expect(lineage.current_session_id).toBe('s2');
      expect(lineage.ancestors).toHaveLength(1);
      expect(lineage.ancestors[0].id).toBe('s1');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/sessions/s2/lineage');
    });

    it('migrates legacy sessions via POST /sessions/migrate', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            dry_run: true,
            session_id: null,
            session_name: 'BC-2026',
            reference: 'BC-2026',
            discrepancy_count: 0,
            discrepancies: [],
            authoritative_calculations: { pre_cal_working_constant: '5005.000' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await apiService.sessions.migrate(
        { payload: { format: 'CALIBRATION_SESSION_EXPORT_V1' } },
        { dryRun: true },
      );

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/v1/sessions/migrate');
      expect(url).toContain('dry_run=true');
      expect(init.method).toBe('POST');
    });

  });

  describe('Calculation Endpoints', () => {
    it('executes calculateCalibration via POST /calculations/calibration', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            working_constant: '11234.5678',
            working_constant_formatted: '11234.5678',
            is_provisional: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await apiService.calculations.calculateCalibration({
        rides: [
          { start: 1000, finish: 5000 },
          { start: 5000, finish: 9002 },
        ],
        course_length_m: '1000.0000',
      });

      expect(res.working_constant).toBe('11234.5678');
      expect(res.is_provisional).toBe(true);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/calculations/calibration');
    });

    it('executes calculateCourseDistance via POST /calculations/course-distance', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            distance_km: '10.0000',
            distance_km_formatted: '10.0000',
            is_provisional: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await apiService.calculations.calculateCourseDistance({
        start_count: 10000,
        finish_count: 110000,
        working_constant: '10000.0000',
      });

      expect(res.distance_km).toBe('10.0000');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/calculations/course-distance');
    });

    it('executes compareConstants via POST /calculations/compare', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pre_working_constant: '10000.0000',
            post_working_constant: '10005.0000',
            selected_rule: 'larger',
            final_working_constant: '10005.0000',
            is_provisional: true,
            reasons: ['Post calibration constant is larger.'],
            policy_notice: 'PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const res = await apiService.calculations.compareConstants({
        pre_working_constant: '10000.0000',
        post_working_constant: '10005.0000',
        rule: 'larger',
      });

      expect(res.final_working_constant).toBe('10005.0000');
      expect(res.selected_rule).toBe('larger');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/api/v1/calculations/compare');
    });
  });

  describe('Admin Endpoints', () => {
    it('fetches overview metrics via GET /admin/overview', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_users: 15,
            total_sessions: 42,
            total_finalized_reports: 38,
            total_draft_sessions: 4,
            monthly_activity: [
              { month: '2026-10', session_count: 20, report_count: 18 },
              { month: '2026-11', session_count: 22, report_count: 20 },
            ],
            recent_activity: [
              {
                id: 's1',
                reference: 'BC-2026-001',
                measurer_name: 'Jane Measurer',
                course_name: '5K Loop',
                course_length_m: '1000.0000',
                status: 'finalized',
                is_provisional: true,
                created_at: '2026-11-01T10:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const overview = await apiService.admin.getOverview();
      expect(overview.total_users).toBe(15);
      expect(overview.total_sessions).toBe(42);
      expect(overview.total_finalized_reports).toBe(38);
      expect(overview.recent_activity).toHaveLength(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/admin/overview');
    });
  });
});
