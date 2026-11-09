/**
 * API error hierarchy and normalization.
 *
 * Provides strongly typed, actionable error classes capturing HTTP status,
 * RFC 7807 Problem Details (or FastAPI validation details), request context,
 * and correlation headers.
 */

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string | Array<{ loc?: (string | number)[]; msg?: string; type?: string }>;
  instance?: string;
  code?: string;
  [key: string]: unknown;
}

export interface ErrorContext {
  url?: string;
  method?: string;
  operationId?: string | null;
  status?: number;
  statusText?: string;
  problemDetail?: ProblemDetail;
  rawBody?: string;
}

/**
 * Base error class for all API-related failures.
 */
export class ApiClientError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly problemDetail?: ProblemDetail;
  public readonly url?: string;
  public readonly method?: string;
  public readonly operationId?: string | null;
  public readonly rawBody?: string;

  constructor(message: string, context: ErrorContext = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = context.status ?? 0;
    this.statusText = context.statusText ?? '';
    this.problemDetail = context.problemDetail;
    this.url = context.url;
    this.method = context.method;
    this.operationId = context.operationId ?? null;
    this.rawBody = context.rawBody;

    // Maintain prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Returns human-readable diagnostic information.
   */
  public toDiagnosticString(): string {
    const parts = [`${this.name} (${this.status || 'NO_STATUS'}): ${this.message}`];
    if (this.method && this.url) {
      parts.push(`  Request: ${this.method} ${this.url}`);
    }
    if (this.operationId) {
      parts.push(`  Operation ID: ${this.operationId}`);
    }
    if (this.problemDetail) {
      parts.push(`  Detail: ${JSON.stringify(this.problemDetail)}`);
    }
    return parts.join('\n');
  }
}

/**
 * Raised when a network failure occurs (DNS resolution failure, CORS, offline, TCP dropped).
 */
export class NetworkError extends ApiClientError {
  constructor(message = 'Network connection failed. Please check your connectivity.', context: ErrorContext = {}) {
    super(message, { ...context, status: 0 });
    this.name = 'NetworkError';
  }
}

/**
 * Raised when an API request times out.
 */
export class TimeoutError extends ApiClientError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, context: ErrorContext = {}) {
    super(`Request timed out after ${timeoutMs}ms.`, { ...context, status: 0 });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Raised on HTTP 401 Unauthorized (missing, expired, or invalid bearer token).
 */
export class AuthenticationError extends ApiClientError {
  constructor(message = 'Authentication required or token expired.', context: ErrorContext = {}) {
    super(message, { ...context, status: 401 });
    this.name = 'AuthenticationError';
  }
}

/**
 * Raised on HTTP 403 Forbidden (insufficient permissions, ownership boundary, or separation of duties).
 */
export class AuthorizationError extends ApiClientError {
  constructor(message = 'Access denied: insufficient permissions or policy restriction.', context: ErrorContext = {}) {
    super(message, { ...context, status: 403 });
    this.name = 'AuthorizationError';
  }

  /**
   * Returns true if this error represents a separation of duties (SoD) violation
   * (e.g. measurers cannot review or approve their own sessions).
   */
  public get isSeparationOfDutiesViolation(): boolean {
    const detailStr = typeof this.problemDetail?.detail === 'string'
      ? this.problemDetail.detail
      : this.message;
    return /separation of duties|cannot review (their )?own/i.test(detailStr);
  }

  /**
   * Returns true if this error represents draft session isolation
   * (drafts can only be accessed by creator or auditor).
   */
  public get isDraftIsolation(): boolean {
    const detailStr = typeof this.problemDetail?.detail === 'string'
      ? this.problemDetail.detail
      : this.message;
    return /draft sessions can only be accessed/i.test(detailStr);
  }
}

/**
 * Raised on HTTP 404 Not Found.
 */
export class NotFoundError extends ApiClientError {
  constructor(message = 'Resource not found.', context: ErrorContext = {}) {
    super(message, { ...context, status: 404 });
    this.name = 'NotFoundError';
  }
}

/**
 * Raised on HTTP 409 Conflict (e.g. optimistic lock version mismatch, duplicate assignment, invalid state transition).
 */
export class ConflictError extends ApiClientError {
  public readonly expectedVersion?: number;
  public readonly currentVersion?: number;

  constructor(
    message = 'Conflict: the resource was modified by another operation.',
    context: ErrorContext | { expectedVersion?: number; currentVersion?: number } = {},
  ) {
    super(message, typeof context === 'object' && 'status' in context ? context : { status: 409 });
    this.name = 'ConflictError';

    // Allow direct version specification or extract from message/detail
    if ('expectedVersion' in context && typeof context.expectedVersion === 'number') {
      this.expectedVersion = context.expectedVersion;
    }
    if ('currentVersion' in context && typeof context.currentVersion === 'number') {
      this.currentVersion = context.currentVersion;
    }

    const detailStr =
      typeof context === 'object' && 'problemDetail' in context && typeof context.problemDetail?.detail === 'string'
        ? context.problemDetail.detail
        : message;

    const expectedMatch = detailStr.match(/expected\s+(?:version\s+)?(\d+)/i);
    const currentMatch = detailStr.match(
      /(?:current|database)\s+(?:(?:database|current)\s+)?version\s+(?:is\s+)?(\d+)/i,
    );

    if (this.expectedVersion === undefined && expectedMatch) {
      this.expectedVersion = parseInt(expectedMatch[1], 10);
    }
    if (this.currentVersion === undefined && currentMatch) {
      this.currentVersion = parseInt(currentMatch[1], 10);
    }
  }
}

/**
 * Raised on HTTP 422 Unprocessable Entity or HTTP 400 Bad Request with schema validation errors.
 */
export class ValidationError extends ApiClientError {
  public readonly fieldErrors: Array<{ field: string; message: string; type?: string }>;

  constructor(message = 'Request validation failed.', context: ErrorContext = {}) {
    super(message, { ...context, status: context.status ?? 422 });
    this.name = 'ValidationError';
    this.fieldErrors = [];

    const detail = context.problemDetail?.detail;
    if (Array.isArray(detail)) {
      for (const item of detail) {
        if (typeof item === 'object' && item !== null) {
          const field = Array.isArray(item.loc) ? item.loc.filter(x => x !== 'body').join('.') : 'unknown';
          const msg = item.msg ?? 'Validation error';
          this.fieldErrors.push({ field, message: msg, type: item.type });
        }
      }
    }
  }
}

/**
 * Raised on HTTP 429 Too Many Requests.
 */
export class RateLimitError extends ApiClientError {
  public readonly retryAfterSeconds?: number;

  constructor(message = 'Too many requests. Rate limit exceeded.', retryAfterSeconds?: number, context: ErrorContext = {}) {
    super(message, { ...context, status: 429 });
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Raised on HTTP 500..599 Internal Server Errors.
 */
export class ServerError extends ApiClientError {
  constructor(message = 'An unexpected server error occurred.', context: ErrorContext = {}) {
    super(message, { ...context, status: context.status ?? 500 });
    this.name = 'ServerError';
  }
}

/**
 * Extract human message from a parsed problem detail or fallback.
 */
function extractErrorMessage(status: number, statusText: string, problemDetail?: ProblemDetail, rawBody?: string): string {
  if (problemDetail) {
    if (typeof problemDetail.detail === 'string' && problemDetail.detail.trim() !== '') {
      return problemDetail.detail;
    }
    if (Array.isArray(problemDetail.detail) && problemDetail.detail.length > 0) {
      const first = problemDetail.detail[0];
      if (typeof first === 'object' && first !== null && first.msg) {
        return `Validation failed: ${first.msg} (${Array.isArray(first.loc) ? first.loc.join('.') : 'payload'})`;
      }
    }
    if (problemDetail.title && problemDetail.title.trim() !== '') {
      return problemDetail.title;
    }
  }

  if (rawBody && rawBody.trim() !== '') {
    // Trim raw body if short
    const trimmed = rawBody.trim();
    if (trimmed.length < 200) {
      return trimmed;
    }
  }

  return `HTTP ${status}: ${statusText || 'Request failed'}`;
}

/**
 * Factory to normalize an HTTP response into the appropriate strongly typed ApiClientError.
 */
export function normalizeHttpError(
  response: Response,
  problemDetail?: ProblemDetail,
  rawBody?: string,
  requestContext: { url?: string; method?: string; operationId?: string | null } = {},
): ApiClientError {
  const status = response.status;
  const statusText = response.statusText;
  const operationId = response.headers.get('x-operation-id') ?? requestContext.operationId ?? null;

  const context: ErrorContext = {
    url: requestContext.url ?? response.url,
    method: requestContext.method,
    operationId,
    status,
    statusText,
    problemDetail,
    rawBody,
  };

  const message = extractErrorMessage(status, statusText, problemDetail, rawBody);

  switch (status) {
    case 401:
      return new AuthenticationError(message, context);
    case 403:
      return new AuthorizationError(message, context);
    case 404:
      return new NotFoundError(message, context);
    case 409:
      return new ConflictError(message, context);
    case 422:
      return new ValidationError(message, context);
    case 400:
      // In FastAPI or custom validators, 400 may also contain validation detail
      if (Array.isArray(problemDetail?.detail)) {
        return new ValidationError(message, context);
      }
      return new ApiClientError(message, context);
    case 429: {
      const retryHeader = response.headers.get('retry-after');
      const retryAfter = retryHeader ? parseInt(retryHeader, 10) : undefined;
      return new RateLimitError(message, isNaN(retryAfter as number) ? undefined : retryAfter, context);
    }
    default:
      if (status >= 500 && status <= 599) {
        return new ServerError(message, context);
      }
      return new ApiClientError(message, context);
  }
}
