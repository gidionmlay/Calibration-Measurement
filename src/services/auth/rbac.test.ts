import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MOCK_PROFILES } from './mock';
import { api } from '../api';

describe('RBAC Entitlements & Role Evaluation', () => {
  it('correctly maps Measurer role and capabilities', () => {
    const measurer = MOCK_PROFILES.measurer;
    expect(measurer.roles).toContain('measurer');
    expect(measurer.permissions).toContain('session:create');
    expect(measurer.permissions).toContain('session:read');
    expect(measurer.permissions).toContain('session:update');
    expect(measurer.permissions).toContain('session:submit_review');

    // Strict boundary: Measurers do NOT have session:review
    expect(measurer.permissions).not.toContain('session:review');
    expect(measurer.permissions).not.toContain('role:manage');
  });

  it('correctly maps Reviewer role and capabilities', () => {
    const reviewer = MOCK_PROFILES.reviewer;
    expect(reviewer.roles).toContain('reviewer');
    expect(reviewer.permissions).toContain('session:read');
    expect(reviewer.permissions).toContain('session:review');

    // Reviewers do NOT create or update sessions directly
    expect(reviewer.permissions).not.toContain('session:create');
    expect(reviewer.permissions).not.toContain('session:update');
  });

  it('correctly maps Supervisor role with elevated review and policy approval capabilities', () => {
    const supervisor = MOCK_PROFILES.supervisor;
    expect(supervisor.roles).toContain('supervisor');
    expect(supervisor.permissions).toContain('policy:approve');
    expect(supervisor.permissions).toContain('session:review');
  });

  it('correctly maps Auditor strictly read-only capabilities', () => {
    const auditor = MOCK_PROFILES.auditor;
    expect(auditor.roles).toContain('auditor');
    expect(auditor.permissions).toContain('session:read');
    expect(auditor.permissions).toContain('audit:read');
    expect(auditor.permissions).toContain('audit:verify');

    // Auditor cannot mutate any data
    expect(auditor.permissions).not.toContain('session:create');
    expect(auditor.permissions).not.toContain('session:update');
    expect(auditor.permissions).not.toContain('session:review');
    expect(auditor.permissions).not.toContain('role:manage');
  });

  it('correctly maps Admin role with administrative capabilities', () => {
    const admin = MOCK_PROFILES.admin;
    expect(admin.roles).toContain('admin');
    expect(admin.permissions).toContain('role:manage');
    expect(admin.permissions).toContain('system:admin');
  });
});

describe('API Client Bearer Token Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('injects Bearer token from dynamic token provider into outgoing requests', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = api.client;
    // Configure mock fetch on underlying client
    const testClient = new (client.constructor as any)({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      fetch: mockFetch,
    });

    testClient.setTokenProvider(async () => 'jwt-test-token-xyz');

    await testClient.request('/auth/me');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer jwt-test-token-xyz');
  });

  it('allows updating or clearing the token provider dynamically', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: '1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: 'anonymous' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const client = api.client;
    const testClient = new (client.constructor as any)({
      baseUrl: 'http://127.0.0.1:8000/api/v1',
      fetch: mockFetch,
    });

    // 1. Set active token
    testClient.setTokenProvider(async () => 'token-1');
    await testClient.request('/auth/me');
    expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer token-1');

    // 2. Clear token provider on logout
    testClient.setTokenProvider(undefined);
    await testClient.request('/auth/status');
    expect(mockFetch.mock.calls[1][1].headers['Authorization']).toBeUndefined();
  });
});
