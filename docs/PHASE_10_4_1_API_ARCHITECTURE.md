# Phase 10.4.1 — API Client Architecture Document

**Document Version:** 1.0.0  
**Status:** IMPLEMENTED AND VERIFIED  
**Date:** 2026-11-07  
**Author:** Senior Full-Stack Architect & React/TypeScript Integration Engineer  
**Component:** `src/services/api/`  
**Target Backend:** FastAPI Authoritative Service (`/api/v1`)

---

## 1. Architectural Mission and System Boundaries

Phase 10.4.1 establishes the frontend-to-backend API integration foundation for the Bicycle Calibration & Course Measurement Application. It connects the existing React 18 / TypeScript frontend to the authoritative FastAPI backend via a strongly typed, maintainable, lightweight, and secure HTTP client architecture.

### 1.1 Separation of Concerns & Authoritative Boundary

The architecture strictly enforces the principle of backend authority:
- **FastAPI Backend is Authoritative For:**
  - OpenID Connect (OIDC) identity validation, profile synchronization, and session authorization.
  - Role-Based Access Control (RBAC) and granular permission enforcement (`SystemPermissions`, `SystemRoles`).
  - Session lifecycle state machine (`draft` -> `needs_review` -> `approved` / `rejected` -> `superseded`).
  - High-precision calculation engine (pure Python `Decimal` arithmetic, ruleset versioning, working constant calculations, rollover handling, and spread analysis).
  - Append-only cryptographic audit logging (SHA-256 hash chaining, database triggers, sequence tracking).
  - Optimistic concurrency control via mandatory `expected_version` assertions.
  - Provisional measurement policy compliance (Unratified Policy MP-01 through MP-09 warnings and flags).

- **React Frontend is Responsible For:**
  - Responsive, accessible UI presentation and form entry.
  - Local state management, reactive feedback, and user workflow guidance.
  - Supplying caller context and operation correlation IDs (`X-Operation-ID`).
  - Delegating all authoritative calculations, state mutations, and peer review decisions to the backend.
  - Never independently recalculating or overriding authoritative server metrics.

```
+-----------------------------------------------------------------------------------+
|                              REACT FRONTEND                                       |
|                                                                                   |
|  +-------------------------+      +--------------------------------------------+  |
|  | Components & Contexts   | ---> | ApiService (`api.sessions`, `api.auth`)     |  |
|  +-------------------------+      +--------------------------------------------+  |
|                                                 |                                 |
|                                                 v                                 |
|                                   +--------------------------------------------+  |
|                                   | ApiClient (Native Fetch, Timeout, Auth)    |  |
|                                   +--------------------------------------------+  |
+-------------------------------------------------|---------------------------------+
                                                  | HTTP / JSON (Bearer Token, X-Operation-ID)
                                                  v
+-----------------------------------------------------------------------------------+
|                              FASTAPI BACKEND (/api/v1)                            |
|                                                                                   |
|  +-------------------------+      +--------------------------------------------+  |
|  | Auth & RBAC Middleware  | ---> | Session & Calculation Services             |  |
|  +-------------------------+      +--------------------------------------------+  |
|                                                 |                                 |
|                                                 v                                 |
|                                   +--------------------------------------------+  |
|                                   | PostgreSQL 16 + Pure Decimal Engine        |  |
|                                   +--------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Module Organization & Core Components

The API client layer is modularized under `src/services/api/`:

```
src/services/api/
├── config.ts         # Environment resolution, base URL validation, and client configuration
├── errors.ts         # Normalized error hierarchy, RFC 7807 parsing, and diagnostic reporting
├── types.ts          # Wire contracts matching authoritative FastAPI / Pydantic schemas
├── client.ts         # Core fetch transport, timeout, token injection, and correlation tracking
├── endpoints.ts      # Domain-specific endpoint namespaces (auth, sessions, calculations, system)
├── index.ts          # Barrel export, ApiService factory, and singleton client instance
└── api.test.ts       # Vitest test suite covering configuration, transport, errors, and endpoints
```

### 2.1 Configuration and Environment Resolution (`config.ts`)

- **Resolution Hierarchy:** `configOverrides.baseUrl` -> `import.meta.env.VITE_API_BASE_URL` -> default `'http://127.0.0.1:8000/api/v1'`.
- **Security Protections:**
  - Validates protocol strictly (`http:` and `https:` allowed, rejects `javascript:`, `ftp:`, etc.).
  - Rejects URLs containing embedded user credentials (`http://user:pass@host/`).
  - Allows relative paths (e.g. `/api/v1`) for production deployments behind reverse proxies.
  - Normalizes trailing slashes to eliminate double-slash bugs.
  - Zero secrets or private keys exposed in the client bundle.

### 2.2 Error Hierarchy & Problem Details Normalization (`errors.ts`)

All failures map to a unified, strongly typed error hierarchy rooted at `ApiClientError`:

```
ApiClientError (Base)
├── NetworkError (status 0, connection drop, DNS failure, CORS)
├── TimeoutError (status 0, AbortController timeout exceeded)
├── AuthenticationError (HTTP 401, missing/expired token)
├── AuthorizationError (HTTP 403, missing permissions, separation of duties, draft isolation)
│   ├── .isSeparationOfDutiesViolation: boolean
│   └── .isDraftIsolation: boolean
├── NotFoundError (HTTP 404, missing resource)
├── ConflictError (HTTP 409, optimistic lock version mismatch, invalid transition)
│   ├── .expectedVersion?: number
│   └── .currentVersion?: number
├── ValidationError (HTTP 422 / 400, Pydantic field-level errors)
│   └── .fieldErrors: Array<{ field: string; message: string; type?: string }>
├── RateLimitError (HTTP 429, retry-after header extraction)
│   └── .retryAfterSeconds?: number
└── ServerError (HTTP 500..599, backend unexpected failures)
```

### 2.3 Wire Contract Alignment (`types.ts`)

TypeScript types in `types.ts` mirror backend Pydantic models with 100% fidelity:
- **Numeric Precision Contract:** Decimal fields (e.g. `course_length_m`, `temperature_c`, `working_constant`, `counts_per_km`) accept `string | number` in payloads and preserve exact string representations from the backend to prevent floating-point precision loss.
- **Optimistic Concurrency:** `expected_version: number` is required on both `SessionUpdatePayload` and `SessionReviewPayload`.
- **Review Decision:** `status: 'approved' | 'rejected'` matches backend validation rules.
- **Administrative Justification:** `reason: string` is mandatory for role assignment and revocation.

### 2.4 Transport Mechanics & Reliability (`client.ts`)

- **Native Fetch Transport:** Built exclusively on native `fetch` and standard Web APIs (`AbortController`, `URLSearchParams`, `Response`). Zero runtime external dependencies (no Axios).
- **Bearer Token Injection:** Supports pluggable `TokenProvider: () => Promise<string | null> | string | null`. Injects `Authorization: Bearer <token>` when a token is available. Fails closed with descriptive `ApiClientError` if the provider throws.
- **Traceability (`X-Operation-ID`):** Generates RFC 4122 v4 UUIDs for all requests unless explicitly supplied by the caller. Preserves the operation ID in all request headers and attaches it to generated error objects.
- **Timeout Management:** Configurable request timeout (default: 15,000ms). Links caller-supplied `AbortSignal` with the internal timeout `AbortController`.
- **HTTP 204 Handling:** Properly returns `undefined` for 204 No Content responses.
- **No Automatic Mutating Retries:** Adheres to distributed systems best practices: state-changing methods (`POST`, `PUT`, `DELETE`, `PATCH`) are never automatically retried to prevent duplicate side effects.

### 2.5 Domain Endpoint Namespaces (`endpoints.ts`)

Endpoints are partitioned into logical, cohesive namespaces:
- `auth`: `getProfile()`, `getStatus()`, `listRoles()`, `listUserRoles()`, `assignRole()`, `revokeRole()`.
- `sessions`: `create()`, `get()`, `update()`, `submit()`, `review()`, `getAuditTrail()`, `verifyAudit()`.
- `calculations`: `calculateCalibration()`, `calculateCourseDistance()`, `compareConstants()`.
- `system`: `health()`.

---

## 3. Security & Operational Guarantees

1. **Deny-by-Default Error Processing:** Any unexpected status code or non-2xx response is parsed, logged with correlation data, and converted into a typed `ApiClientError`.
2. **Separation of Duties Observability:** `AuthorizationError.isSeparationOfDutiesViolation` enables frontend UI layers to distinguish generic access denial from strict separation-of-duties blocks (e.g., measurers attempting to approve their own sessions).
3. **Draft Session Isolation Observability:** `AuthorizationError.isDraftIsolation` enables frontend navigation to explain that in-progress drafts are restricted to the session creator and authorized auditors.
4. **Optimistic Locking Conflict Recovery:** `ConflictError.expectedVersion` and `ConflictError.currentVersion` allow future UI workflows to prompt the user with a structured "resource has changed" dialog displaying exact version discrepancies.
5. **No Secret Ingestion:** The client bundle only ingests public Vite configuration variables (`VITE_API_BASE_URL`). All sensitive credentials (OIDC client secrets, database passwords) remain isolated in backend server environments.

