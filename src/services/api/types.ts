/**
 * TypeScript API contracts matching authoritative FastAPI / Pydantic models.
 *
 * All wire payloads, responses, and enumerations are strictly typed to guarantee
 * compile-time type safety across frontend and backend boundaries.
 */

// ============================================================================
// Enums and Common Primitives
// ============================================================================

export type RolloverMode = 'none' | 'wrap' | 'notConfigured';
export type FinalConstantRule = 'larger' | 'average' | 'notConfigured';
export type SessionStatus =
  | 'draft'
  | 'in_progress'
  | 'needs_review'
  | 'approved'
  | 'ready_for_final_review'
  | 'finalized'
  | 'rejected'
  | 'superseded';
export type ReviewDecision = 'approved' | 'rejected';
export type RideType = 'pre_calibration' | 'post_calibration' | 'course_measurement';

export interface RolloverConfig {
  mode: RolloverMode;
  max_reading?: number | null;
}

// ============================================================================
// Auth & RBAC Schemas
// ============================================================================

export interface PermissionItem {
  id: string;
  code: string;
  description?: string | null;
  resource: string;
  action: string;
}

export interface RoleItem {
  id: string;
  name: string;
  description?: string | null;
  is_system_role: boolean;
  permissions: PermissionItem[];
}

export interface UserRoleAssignment {
  id: string;
  user_id: string;
  role_id: string;
  role_name: string;
  assigned_by?: string | null;
  assigned_at: string;
  revoked_at?: string | null;
  assignment_reason?: string | null;
  is_active: boolean;
}

export interface RoleAssignPayload {
  role_name: string;
  reason: string;
}

export interface RoleRevokePayload {
  reason: string;
}

export interface UserProfile {
  id: string;
  issuer: string;
  subject: string;
  display_name?: string | null;
  email?: string | null;
  email_verified: boolean;
  organization?: string | null;
  status: 'active' | 'disabled' | string;
  created_at: string;
  last_authenticated_at?: string | null;
  roles: string[];
  permissions: string[];
}

export interface RegisterPayload {
  email: string;
  password: string;
  display_name: string;
  organization?: string | null;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  user: UserProfile;
}

export interface TokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthStatus {
  environment: string;
  oidc_issuer: string;
  oidc_audience: string;
  auto_provisioning: boolean;
  allowed_algorithms: string[];
  is_provisional: boolean;
  policy_notice: string;
}

export interface MonthlyActivityItem {
  month: string;
  session_count: number;
  report_count: number;
}

export interface RecentSessionItem {
  id: string;
  reference: string;
  measurer_name: string;
  course_name?: string | null;
  course_length_m: string;
  status: string;
  is_provisional: boolean;
  created_at: string;
}

export interface AdminOverviewMetrics {
  total_users: number;
  total_sessions: number;
  total_finalized_reports: number;
  total_draft_sessions: number;
  monthly_activity: MonthlyActivityItem[];
  recent_activity: RecentSessionItem[];
}

// ============================================================================
// Session & Measurement Schemas
// ============================================================================

export interface SessionRideInput {
  ride_type?: RideType | string;
  ride_number: number;
  start_count: number;
  finish_count: number;
  is_linked_override?: boolean;
  override_reason?: string | null;
}

export interface SessionRideItem {
  id: string;
  ride_type: string;
  ride_number: number;
  start_count: number;
  finish_count: number;
  count_delta: number;
  is_linked: boolean;
  is_linked_override: boolean;
  override_reason?: string | null;
  adjustment: number;
  created_at: string;
}

export interface SessionReviewItem {
  id: string;
  reviewer_id: string;
  status: string;
  comments?: string | null;
  signed_at?: string | null;
  is_invalidated: boolean;
  invalidated_at?: string | null;
  invalidation_reason?: string | null;
}

export interface SessionCreatePayload {
  name: string;
  description?: string | null;
  measurer_id?: string | null;
  supervisor_id?: string | null;
  course_name?: string | null;
  course_length_m: string | number;
  course_length_unit?: string;
  surface_type?: string | null;
  temperature_c?: string | number | null;
  rollover?: RolloverConfig;
  constant_selection_rule?: FinalConstantRule;
  working_spec_version?: string;
  rides?: SessionRideInput[];
}

export interface SessionUpdatePayload {
  expected_version: number;
  name?: string | null;
  description?: string | null;
  course_name?: string | null;
  course_length_m?: string | number | null;
  temperature_c?: string | number | null;
  rollover?: RolloverConfig | null;
  constant_selection_rule?: FinalConstantRule | null;
  rides?: SessionRideInput[] | null;
  change_reason?: string | null;
}

export interface SessionSubmitPayload {
  notes?: string | null;
}

export interface SessionReviewPayload {
  expected_version: number;
  status: ReviewDecision;
  comments?: string | null;
  checklist_snapshot?: Record<string, unknown> | null;
}

export interface SessionFinalizePayload {
  expected_version: number;
  supervisor_notes?: string | null;
  confirm_provisional_policy?: boolean;
}

export interface SessionRevisionPayload {
  revision_reason: string;
}

export interface SessionLineageResponse {
  current_session_id: string;
  ancestors: MeasurementSession[];
  descendants: MeasurementSession[];
}

export interface MigrationDiscrepancy {
  field: string;
  legacy_value: string;
  authoritative_value: string;
  delta: string;
}

export interface MigrationRequestPayload {
  payload: Record<string, unknown>;
  measurer_id?: string | null;
}

export interface MigrationResponse {
  success: boolean;
  dry_run: boolean;
  session_id?: string | null;
  session_name: string;
  reference: string;
  discrepancy_count: number;
  discrepancies: MigrationDiscrepancy[];
  authoritative_calculations: Record<string, string | boolean | null>;
}

export interface MeasurementSession {
  id: string;
  version: number;
  schema_version: number;
  status: SessionStatus | string;
  name: string;
  description?: string | null;
  measurer_id?: string | null;
  supervisor_id?: string | null;
  course_name?: string | null;
  course_length_m: string | number;
  course_length_unit: string;
  surface_type?: string | null;
  temperature_c?: string | number | null;
  rollover_mode: RolloverMode | string;
  max_reading?: number | null;
  constant_selection_rule: FinalConstantRule | string;
  working_spec_version: string;
  policy_approval_status: string;

  // Authoritative derived calculations
  pre_cal_working_constant?: string | number | null;
  post_cal_working_constant?: string | number | null;
  final_working_constant?: string | number | null;
  cal_drift_percent?: string | number | null;
  course_distance_km?: string | number | null;
  calculation_engine_version?: string | null;
  is_provisional: boolean;
  policy_notice?: string | null;

  // Lineage
  supersedes_id?: string | null;
  superseded_by_id?: string | null;
  revision_reason?: string | null;

  // Associated models
  rides: SessionRideItem[];
  reviews: SessionReviewItem[];

  created_at: string;
  updated_at: string;
}

// ============================================================================
// Pure Calculation Schemas
// ============================================================================

export interface PureRideInput {
  start: number;
  finish: number;
  start_overridden?: boolean;
  override_reason?: string;
}

export interface CalibrationCalculationRequest {
  rides: PureRideInput[];
  course_length_m: string | number;
  rollover?: RolloverConfig;
}

export interface ResolvedRideItem {
  ride_number: number;
  start: number;
  finish: number;
  count: number;
  linked: boolean;
  overridden: boolean;
  override_reason: string;
  adjustment: number;
}

export interface SpreadItem {
  high_ride: number;
  high_count: number;
  low_ride: number;
  low_count: number;
  range_count: number;
}

export interface CalibrationCalculationResponse {
  rides: ResolvedRideItem[];
  counts: number[];
  total_count: number;
  average_count: string | number;
  course_length_m: string | number;
  course_length_km: string | number;
  counts_per_km: string | number;
  working_constant: string | number;
  working_constant_formatted: string;
  spread: SpreadItem;
  is_provisional: boolean;
  engine_version: string;
  ruleset_version: string;
  policy_notice: string;
}

export interface CourseDistanceCalculationRequest {
  start_count: number;
  finish_count: number;
  working_constant: string | number;
  rollover?: RolloverConfig;
}

export interface CourseDistanceCalculationResponse {
  start_count: number;
  finish_count: number;
  course_count: number;
  working_constant_applied: string | number;
  distance_km: string | number;
  distance_km_formatted: string;
  is_provisional: boolean;
  engine_version: string;
  ruleset_version: string;
  policy_notice: string;
}

export interface ConstantComparisonRequest {
  pre_working_constant: string | number;
  post_working_constant?: string | number | null;
  rule?: FinalConstantRule;
  policy_approved?: boolean;
}

export interface ConstantComparisonResponse {
  pre_working_constant: string | number;
  post_working_constant?: string | number | null;
  difference?: string | number | null;
  percent_change?: string | number | null;
  selected_rule: string;
  final_working_constant?: string | number | null;
  is_provisional: boolean;
  reasons: string[];
  policy_notice: string;
}

// ============================================================================
// Audit Schemas
// ============================================================================

export interface AuditEvent {
  id: string;
  session_id: string;
  sequence_num: number;
  event_type: string;
  actor_id: string;
  client_operation_id?: string | null;
  timestamp: string;
  event_summary: string;
  affected_field?: string | null;
  before_value?: string | null;
  after_value?: string | null;
  override_reason?: string | null;
  payload: Record<string, unknown>;
  previous_event_hash: string;
  event_hash: string;
}

export interface AuditVerificationResult {
  is_valid: boolean;
  total_events: number;
  verified_events: number;
  errors: string[];
}

