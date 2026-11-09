/**
 * Strongly typed endpoint operations grouped by domain.
 *
 * Each group takes an ApiClient instance and exposes domain methods
 * corresponding to authoritative FastAPI backend routes.
 */

import { ApiClient, RequestOptions } from './client';
import {
  AdminOverviewMetrics,
  AuditEvent,
  AuditVerificationResult,
  AuthStatus,
  AuthTokenResponse,
  CalibrationCalculationRequest,
  CalibrationCalculationResponse,
  ConstantComparisonRequest,
  ConstantComparisonResponse,
  CourseDistanceCalculationRequest,
  CourseDistanceCalculationResponse,
  LoginPayload,
  MeasurementSession,
  MigrationRequestPayload,
  MigrationResponse,
  RegisterPayload,
  RoleAssignPayload,
  RoleItem,
  SessionCreatePayload,
  SessionFinalizePayload,
  SessionLineageResponse,
  SessionReviewItem,
  SessionReviewPayload,
  SessionRevisionPayload,
  SessionSubmitPayload,
  SessionUpdatePayload,
  TokenRefreshResponse,
  UserProfile,
  UserRoleAssignment,
} from './types';

export type EndpointOptions = Omit<RequestOptions, 'method' | 'body'>;

/**
 * Authentication, identity, and RBAC endpoints.
 */
export function createAuthEndpoints(client: ApiClient) {
  return {
    /**
     * Self-register a new autonomous Field Measurer.
     * Route: POST /auth/register
     */
    register: (payload: RegisterPayload, options?: EndpointOptions): Promise<AuthTokenResponse> => {
      return client.post<AuthTokenResponse>('/auth/register', payload, options);
    },

    /**
     * Authenticate with local email and password.
     * Route: POST /auth/login
     */
    login: (payload: LoginPayload, options?: EndpointOptions): Promise<AuthTokenResponse> => {
      return client.post<AuthTokenResponse>('/auth/login', payload, options);
    },

    /**
     * Refresh JWT access token using a valid refresh token.
     * Route: POST /auth/refresh
     */
    refreshToken: (refreshToken: string, options?: EndpointOptions): Promise<TokenRefreshResponse> => {
      return client.post<TokenRefreshResponse>('/auth/refresh', { refresh_token: refreshToken }, options);
    },

    /**
     * Retrieve the authenticated user's profile, assigned roles, and effective permissions.
     * Route: GET /auth/me
     */
    getProfile: (options?: EndpointOptions): Promise<UserProfile> => {
      return client.get<UserProfile>('/auth/me', options);
    },

    /**
     * Retrieve public non-sensitive authentication status and policy flags.
     * Route: GET /auth/status
     */
    getStatus: (options?: EndpointOptions): Promise<AuthStatus> => {
      return client.get<AuthStatus>('/auth/status', options);
    },

    /**
     * List all system security roles and their associated permissions.
     * Route: GET /auth/roles
     */
    listRoles: (options?: EndpointOptions): Promise<RoleItem[]> => {
      return client.get<RoleItem[]>('/auth/roles', options);
    },

    /**
     * List active and historical role assignments for a user.
     * Route: GET /auth/users/{userId}/roles
     */
    listUserRoles: (userId: string, options?: EndpointOptions): Promise<UserRoleAssignment[]> => {
      return client.get<UserRoleAssignment[]>(`/auth/users/${encodeURIComponent(userId)}/roles`, options);
    },

    /**
     * Administratively assign an active role to a target user.
     * Route: POST /auth/users/{userId}/roles
     */
    assignRole: (userId: string, payload: RoleAssignPayload, options?: EndpointOptions): Promise<UserRoleAssignment> => {
      return client.post<UserRoleAssignment>(`/auth/users/${encodeURIComponent(userId)}/roles`, payload, options);
    },

    /**
     * Administratively revoke an active role from a target user with mandatory justification.
     * Route: DELETE /auth/users/{userId}/roles/{roleName}?reason=...
     */
    revokeRole: (
      userId: string,
      roleName: string,
      reason: string,
      options?: EndpointOptions,
    ): Promise<UserRoleAssignment> => {
      return client.delete<UserRoleAssignment>(
        `/auth/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleName)}`,
        {
          ...options,
          params: { ...options?.params, reason },
        },
      );
    },
  };
}

/**
 * Measurement session lifecycle, review, and audit endpoints.
 */
export function createSessionEndpoints(client: ApiClient) {
  return {
    /**
     * Create a new measurement session.
     * Route: POST /sessions
     */
    create: (payload: SessionCreatePayload, options?: EndpointOptions): Promise<MeasurementSession> => {
      return client.post<MeasurementSession>('/sessions', payload, options);
    },

    /**
     * Retrieve a session by ID including rides, reviews, and authoritative calculations.
     * Route: GET /sessions/{sessionId}
     */
    get: (sessionId: string, options?: EndpointOptions): Promise<MeasurementSession> => {
      return client.get<MeasurementSession>(`/sessions/${encodeURIComponent(sessionId)}`, options);
    },

    /**
     * Update an editable session with optimistic concurrency (expected_version).
     * Route: PUT /sessions/{sessionId}
     */
    update: (
      sessionId: string,
      payload: SessionUpdatePayload,
      options?: EndpointOptions,
    ): Promise<MeasurementSession> => {
      return client.put<MeasurementSession>(`/sessions/${encodeURIComponent(sessionId)}`, payload, options);
    },

    /**
     * Submit a draft session for peer review.
     * Route: POST /sessions/{sessionId}/submit
     */
    submit: (
      sessionId: string,
      payload: SessionSubmitPayload = {},
      options?: EndpointOptions,
    ): Promise<MeasurementSession> => {
      return client.post<MeasurementSession>(`/sessions/${encodeURIComponent(sessionId)}/submit`, payload, options);
    },

    /**
     * Submit a peer review decision (approved/rejected).
     * Route: POST /sessions/{sessionId}/reviews
     */
    review: (
      sessionId: string,
      payload: SessionReviewPayload,
      options?: EndpointOptions,
    ): Promise<SessionReviewItem> => {
      return client.post<SessionReviewItem>(`/sessions/${encodeURIComponent(sessionId)}/reviews`, payload, options);
    },

    /**
     * Retrieve the append-only cryptographic audit trail for a session.
     * Route: GET /sessions/{sessionId}/audit-trail
     */
    getAuditTrail: (sessionId: string, options?: EndpointOptions): Promise<AuditEvent[]> => {
      return client.get<AuditEvent[]>(`/sessions/${encodeURIComponent(sessionId)}/audit-trail`, options);
    },

    /**
     * Cryptographically verify hash-chain integrity of a session's audit trail.
     * Route: POST /sessions/{sessionId}/verify-audit
     */
    verifyAudit: (sessionId: string, options?: EndpointOptions): Promise<AuditVerificationResult> => {
      return client.post<AuditVerificationResult>(
        `/sessions/${encodeURIComponent(sessionId)}/verify-audit`,
        {},
        options,
      );
    },

    /**
     * Finalize an approved session into a permanently immutable record.
     * Route: POST /sessions/{sessionId}/finalize
     */
    finalize: (
      sessionId: string,
      payload: SessionFinalizePayload,
      options?: EndpointOptions,
    ): Promise<MeasurementSession> => {
      return client.post<MeasurementSession>(
        `/sessions/${encodeURIComponent(sessionId)}/finalize`,
        payload,
        options,
      );
    },

    /**
     * Create a formal revision child draft from a finalized parent session.
     * Route: POST /sessions/{sessionId}/revisions
     */
    createRevision: (
      sessionId: string,
      payload: SessionRevisionPayload,
      options?: EndpointOptions,
    ): Promise<MeasurementSession> => {
      return client.post<MeasurementSession>(
        `/sessions/${encodeURIComponent(sessionId)}/revisions`,
        payload,
        options,
      );
    },

    /**
     * Retrieve the ancestor and descendant revision chain for a session.
     * Route: GET /sessions/{sessionId}/lineage
     */
    getLineage: (sessionId: string, options?: EndpointOptions): Promise<SessionLineageResponse> => {
      return client.get<SessionLineageResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/lineage`,
        options,
      );
    },

    /**
     * Ingest legacy JSON session backups, recalculate figures, report discrepancies, and optionally persist.
     * Route: POST /sessions/migrate?dry_run=...
     */
    migrate: (
      payload: MigrationRequestPayload,
      options?: EndpointOptions & { dryRun?: boolean },
    ): Promise<MigrationResponse> => {
      const dryRun = options?.dryRun ?? true;
      return client.post<MigrationResponse>(
        '/sessions/migrate',
        payload,
        {
          ...options,
          params: { ...options?.params, dry_run: dryRun },
        },
      );
    },
  };
}

/**
 * Pure calculation endpoints powered by the Python Decimal engine.
 */
export function createCalculationEndpoints(client: ApiClient) {
  return {
    /**
     * Authoritative Calibration Calculation (rides, course length -> working constant, spread).
     * Route: POST /calculations/calibration
     */
    calculateCalibration: (
      payload: CalibrationCalculationRequest,
      options?: EndpointOptions,
    ): Promise<CalibrationCalculationResponse> => {
      return client.post<CalibrationCalculationResponse>('/calculations/calibration', payload, options);
    },

    /**
     * Authoritative Course Distance Calculation.
     * Route: POST /calculations/course-distance
     */
    calculateCourseDistance: (
      payload: CourseDistanceCalculationRequest,
      options?: EndpointOptions,
    ): Promise<CourseDistanceCalculationResponse> => {
      return client.post<CourseDistanceCalculationResponse>('/calculations/course-distance', payload, options);
    },

    /**
     * Compare pre- and post-calibration working constants and evaluate final constant.
     * Route: POST /calculations/compare
     */
    compareConstants: (
      payload: ConstantComparisonRequest,
      options?: EndpointOptions,
    ): Promise<ConstantComparisonResponse> => {
      return client.post<ConstantComparisonResponse>('/calculations/compare', payload, options);
    },
  };
}

/**
 * System and operational endpoints.
 */
export function createSystemEndpoints(client: ApiClient) {
  return {
    /**
     * Server health check endpoint.
     * Route: GET /health
     */
    health: (options?: EndpointOptions): Promise<{ status: string; engine_version: string; ruleset_version: string; is_provisional: boolean; policy_notice: string }> => {
      return client.get('/health', options);
    },
  };
}

/**
 * Admin overview & analytics endpoints.
 */
export function createAdminEndpoints(client: ApiClient) {
  return {
    /**
     * Operational overview metrics (measurers count, total sessions, report numbers, monthly trends).
     * Route: GET /admin/overview
     */
    getOverview: (options?: EndpointOptions): Promise<AdminOverviewMetrics> => {
      return client.get<AdminOverviewMetrics>('/admin/overview', options);
    },
  };
}
