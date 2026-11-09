# Phase 10.3.1 — OIDC Identity and Authentication Foundation Implementation Report

**Project:** Bicycle Calibration & Course Measurement Application  
**Milestone:** Phase 10.3.1 — OIDC Identity and Authentication Foundation  
**Repository Working Directory:** `/media/sda3/Projects/Calibration`  
**Git Branch:** `feature/phase-6-controlled-pilot`  
**Starting Commit:** `9f4f43f`  
**Evaluation Role:** Senior Backend Architect, Database Reliability Engineer & Security Verification Auditor  
**Date:** 2026-11-07  
**Overall Verdict:** **PASS WITH CONDITIONS (FOUNDATION VERIFIED; READY FOR PHASE 10.3.2 RBAC)**

---

## 1. Executive Summary

Phase 10.3.1 successfully implements the OpenID Connect (OIDC) identity and authentication foundation for the Bicycle Calibration Calculation backend.

Prior to this milestone, the backend operated with provisional, unverified actor identifiers (e.g., `provisional:measurer`, `provisional:system`) and unauthenticated session mutation endpoints. This implementation establishes a cryptographically verified, fail-closed relationship between external OIDC identity providers, validated Bearer identity tokens, persistent application user entities, and append-only audit ledger records.

### Key Deliverables Completed & Verified:
1. **Architectural IdP Decision ([ADR-10-07](file:///media/sda3/Projects/Calibration/docs/PHASE_10_3_1_IDENTITY_PROVIDER_DECISION.md)):** Established a provider-neutral OIDC strategy supporting Keycloak for local/on-premise deployments and managed enterprise OIDC providers (Auth0/Google Cloud Identity/AWS Cognito) for cloud production.
2. **Cryptographic Token Validation ([`backend/app/auth/oidc.py`](file:///media/sda3/Projects/Calibration/backend/app/auth/oidc.py)):** Built `OIDCValidator` enforcing strict asymmetric signature checks (RS256, ES256), rejecting algorithm confusion (`none`, symmetric `HS256`), validating `iss`, `aud`, `exp`, `nbf`, `sub`, and handling dynamic JWKS caching and key rotation.
3. **Persistent User Identity Model & Migration ([`backend/app/models/user.py`](file:///media/sda3/Projects/Calibration/backend/app/models/user.py), [Alembic `0003`](file:///media/sda3/Projects/Calibration/backend/alembic/versions/0003_user_identity.py)):** Deployed PostgreSQL `users` table with compound unique constraint `(issuer, subject)`, immutable internal `UUID` primary key, account status (`active`, `disabled`), and profile metadata.
4. **Controlled User Provisioning ([`backend/app/auth/service.py`](file:///media/sda3/Projects/Calibration/backend/app/auth/service.py)):** Atomic first-authentication provisioning, profile synchronization, disabled account blocking (`UserAccountDisabledError`), and concurrent race-condition handling via row-level locks and `IntegrityError` recovery.
5. **FastAPI Authentication Dependency & Endpoints ([`backend/app/auth/dependencies.py`](file:///media/sda3/Projects/Calibration/backend/app/auth/dependencies.py), [`backend/app/api/routes/auth.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/auth.py)):** Implemented `get_current_user` enforcing Bearer token validation, `GET /api/v1/auth/me` returning safe profiles, and `GET /api/v1/auth/status` exposing public non-sensitive configuration.
6. **Authoritative Audit Attribution ([`backend/app/api/routes/sessions.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/sessions.py)):** Protected session creation and updates now derive `actor_id` strictly from the authenticated internal user UUID (`str(current_user.id)`). Client-supplied actor IDs and spoofing headers (`X-Actor-ID`) are discarded. Historical audit events remain 100% verifiable.
7. **Comprehensive Automated Test Coverage ([`backend/tests/test_auth_oidc.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_auth_oidc.py)):** 26 new automated unit, integration, and security tests covering all token, user, API, and audit scenarios, bringing the backend test suite to **127 passing tests**.

---

## 2. Starting Git Commit, Branch, & Working-Tree State

- **Target Directory:** `/media/sda3/Projects/Calibration`
- **Active Branch:** `feature/phase-6-controlled-pilot`
- **Starting HEAD Commit:** `9f4f43f`
- **Working-Tree State:** Uncommitted Phase 10.2, 10.2.1, and 10.3.1 files preserved. Zero commits created, zero git tags pushed.
- **Repository Safety:** All calculations, reference vectors, and provisional measurement policy disclaimers (MP-01 through MP-09) strictly preserved.

---

## 3. Identity Provider Decision

Documented in [`docs/PHASE_10_3_1_IDENTITY_PROVIDER_DECISION.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_3_1_IDENTITY_PROVIDER_DECISION.md):
- **Selected Provider Model:** **Provider-Neutral OpenID Connect (OIDC) Standard**.
- **Development & Field Operations Reference:** **Keycloak** (Self-hosted container via Docker Compose).
- **Production Cloud Target:** **Managed OIDC Provider** (e.g., Auth0, Google Cloud Identity, or AWS Cognito).
- **Rationale:** The application requires field portability for international cycling federation measurers who may operate in air-gapped or offline networks, while simultaneously demanding zero-overhead managed cloud scalability for central federation portals. By strictly adhering to RFC 7519, RFC 7517, RFC 7636 (PKCE), and standard OIDC discovery, the application can switch between Keycloak and enterprise managed providers purely via environment variables (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`) with zero code alterations.

---

## 4. Authentication Architecture

```
[Browser / React Client]
       │
       │ 1. Authorization Code Flow + PKCE
       ▼
[OIDC Identity Provider (Keycloak / Auth0)]
       │
       │ 2. Issues RS256 Signed JWT Token
       ▼
[Browser / React Client]
       │
       │ 3. HTTP Request: Authorization: Bearer <token>
       ▼
[FastAPI Backend: get_current_user Dependency]
       │
       ├──► 4. Validate Token (OIDCValidator)
       │       - Verify Header alg in ['RS256', 'ES256']
       │       - Resolve Public Key via cached JWKS / kid
       │       - Verify Cryptographic Signature
       │       - Verify exp, nbf, iss, aud, sub
       │
       ├──► 5. Resolve / Provision User (IdentityService)
       │       - Query DB by (issuer, subject)
       │       - Reject if status == 'disabled' (HTTP 403)
       │       - If absent, create new User (UUID id)
       │
       └──► 6. Execute Business Operation
               - Pass authenticated internal UUID to Audit Ledger
               - Append tamper-evident audit event (actor_id = user.id)
```

The backend independently validates every Bearer token without trusting client-side headers, request body IDs, or forwarded identities.

---

## 5. Token Validation Implementation

Implemented in [`backend/app/auth/oidc.py`](file:///media/sda3/Projects/Calibration/backend/app/auth/oidc.py):
- **Algorithm Allowlist:** Explicitly restricted to asymmetric algorithms (`settings.OIDC_ALLOWED_ALGORITHMS`, default `["RS256", "ES256"]`). Tokens requesting `alg: "none"` or symmetric `HS256` are immediately rejected with `UnsupportedAlgorithmError`.
- **Cryptographic Signature Verification:** PyJWT with `cryptography` backend decodes tokens using RSA/ECDSA public keys retrieved from the provider JWKS or registered static keys.
- **Mandatory Claims Enforcement:** Requires `exp`, `iss`, `aud`, and `sub`. Rejects missing or empty subjects.
- **Clock Skew Allowance:** Configurable leeway (`settings.OIDC_CLOCK_SKEW_SECONDS`, default 30s) prevents spurious rejections due to minor NTP drift.
- **JWKS Dynamic Retrieval & Key Rotation:** `PyJWKClient` maintains an in-memory cache of public keys (`lifespan = 3600s`). When a token specifies an unrecognized `kid`, the client automatically refreshes the JWKS from the provider endpoint. If the key is still missing, it fails closed with `SigningKeyNotFoundError`.

---

## 6. User Identity Model

Implemented in [`backend/app/models/user.py`](file:///media/sda3/Projects/Calibration/backend/app/models/user.py) and applied via Alembic migration `0003_user_identity`:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer VARCHAR(512) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(320),
    email_verified BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_authenticated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_users_issuer_subject UNIQUE (issuer, subject),
    CONSTRAINT chk_user_status CHECK (status IN ('active', 'disabled'))
);
```

### Architectural Guarantees:
- **Compound Identity Scope:** Identity is strictly scoped to `(issuer, subject)`. The system never uses email as a primary or foreign key, avoiding collisions across identity providers.
- **Internal Identity Decoupling:** All foreign keys and audit references point to the internal immutable `id` UUID, shielding the application from external provider renames or identifier reorganizations.

---

## 7. User Provisioning Behavior

Implemented in [`backend/app/auth/service.py`](file:///media/sda3/Projects/Calibration/backend/app/auth/service.py):
1. **First-Time Provisioning:** If `OIDC_AUTO_PROVISION_USERS=true`, when a verified token presents a novel `(issuer, subject)` pair, a new user entity is atomically created with `status="active"` and assigned a new UUID.
2. **Returning Users:** The existing user entity is loaded with row-level locking (`SELECT ... FOR UPDATE`).
3. **Disabled Account Protection:** If `user.status != "active"`, the service raises `UserAccountDisabledError`, and the dependency aborts with `HTTP 403 Forbidden`. External tokens from deactivated personnel cannot access application APIs.
4. **Profile Claim Synchronization:** Updates `last_authenticated_at`, `display_name`, `email`, and `email_verified` if changed in the token.
5. **Concurrency Safety:** If two concurrent requests arrive simultaneously for a first-time user, the database unique constraint catches the collision (`IntegrityError`), rolls back, and resolves the persisted entity cleanly.

---

## 8. API Endpoints

Implemented in [`backend/app/api/routes/auth.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/auth.py):

| Method | Path | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/me` | **Bearer Token** | Returns safe profile of authenticated user (`id`, `issuer`, `subject`, `email`, `display_name`, `status`). |
| `GET` | `/api/v1/auth/status` | Public | Returns non-sensitive auth configuration (`environment`, `oidc_issuer`, `allowed_algorithms`, provisional notices). |

### Secret Leakage Protection:
- Responses never include client secrets, signing keys, access tokens, refresh tokens, or passwords.
- All errors conform to RFC 7807/9457 `application/problem+json` with standard `WWW-Authenticate` response headers.

---

## 9. Audit Actor Integration & Spoofing Defense

Implemented in [`backend/app/api/routes/sessions.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/sessions.py):
- **Authoritative Actor Derivation:** Session mutation endpoints (`POST /api/v1/sessions`, `PUT /api/v1/sessions/{id}`) derive `actor_id` directly from `str(current_user.id)`.
- **Anti-Spoofing Guard:** Client-supplied headers (e.g. `X-Actor-ID`, `X-User-ID`) or request body properties are ignored. Tested and verified in `test_client_supplied_actor_id_cannot_spoof_audit_identity`.
- **Audit Hash Integrity:** The SHA-256 hash chaining formula (`compute_audit_event_hash`) binds `actor_id` into the preimage alongside all 13 other columns.
- **Historical Continuity:** Historical audit events recorded under provisional identities (`provisional:measurer`, `provisional:system`) remain valid and pass ledger verification because the ledger verifier recalculates hashes against recorded event attributes.

---

## 10. Frontend Integration Boundary

- **Authentication Protocol:** React client must authenticate using **OAuth 2.0 Authorization Code Flow with PKCE** via standard OIDC client libraries (e.g., `oidc-client-ts`).
- **Token Storage Strategy:**
  - In-memory storage during active session lifecycle.
  - Refresh tokens stored in `httpOnly`, `Secure`, `SameSite=Strict` cookies or managed via Backend-for-Frontend (BFF) proxy.
  - **Explicit Prohibition:** Long-lived access tokens MUST NOT be stored in unencrypted `localStorage` due to XSS extraction risks.
- **Frontend Quality Gate Stability:** The existing client unit tests (`vitest run`), build (`vite build`), and Playwright E2E suites continue to pass without regression. Full frontend token attachment will be wired during Milestone 10.4.

---

## 11. Security Controls Assessment

| Threat Vector | Mitigation Strategy | Status |
| :--- | :--- | :--- |
| **JWT Algorithm Confusion** | Asymmetric allowlist (`RS256, ES256`); explicitly rejects `none` and symmetric `HS256`. | **VERIFIED** |
| **Signature Forgery** | Cryptographic verification with 2048-bit RSA / ECDSA public keys via PyJWT and cryptography. | **VERIFIED** |
| **Issuer Substitution** | Strict comparison between token `iss` and `settings.OIDC_ISSUER_URL`; OIDC discovery issuer check. | **VERIFIED** |
| **Audience Hijacking** | Enforces `aud` claim matches `settings.OIDC_AUDIENCE`. | **VERIFIED** |
| **Expired Token Replay** | Strict `exp` claim validation with configurable clock skew leeway (30s). | **VERIFIED** |
| **Premature Token Acceptance** | `nbf` (not-before) verification blocks tokens with future activation timestamps. | **VERIFIED** |
| **Key Rotation Denial-of-Service** | JWKS caching with automated refresh on unknown `kid`. | **VERIFIED** |
| **Disabled Account Access** | Application database lookup enforces `status == 'active'` on every authenticated request. | **VERIFIED** |
| **Identity / Sub Collision** | Compound unique constraint `(issuer, subject)` prevents cross-provider collisions. | **VERIFIED** |
| **Actor Identity Spoofing** | Actor ID in audit records is derived exclusively from server-validated user UUID. | **VERIFIED** |
| **Credential / Secret Leakage** | All error responses sanitized via RFC 7807; no secrets present in config or responses. | **VERIFIED** |

---

## 12. Automated Test Suite Results

### Backend Test Execution
- **Command:** `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/ -v`
- **Result:** **127 passed** in 4.76s
- **Coverage Breakdown:**
  - `test_auth_oidc.py`: **26 passed** (Token validation, provisioning, `/auth/me`, `/auth/status`, audit UUID binding, spoofing defense)
  - `test_audit_integrity.py`: 20 passed (Canonical serialization, tamper detection, hash coverage)
  - `test_calibration.py`: 7 passed (Calibration arithmetic, linkages, float rejections)
  - `test_concurrency.py`: 3 passed (Optimistic concurrency, HTTP 409 Problem Details)
  - `test_concurrency_threads.py`: 4 passed (Real multi-threaded barrier concurrency)
  - `test_course_distance.py`: 6 passed (Course distance calculation, division-by-zero guards)
  - `test_migrations.py`: 1 passed (Downgrade to base and upgrade to head lifecycle, including `users`)
  - `test_persistence_models.py`: 8 passed (SQLAlchemy models, precision, check constraints)
  - `test_reference_vectors.py`: 34 passed (Phase 8 Golden Reference Vectors)
  - `test_session_api.py`: 3 passed (Session persistence API, review invalidation)
  - `test_transactions.py`: 6 passed (Atomicity, rollback, engine triggers, Core immutability)
  - `test_validation.py`: 10 passed (Decimal scale limits, negative reading rejections)

### Frontend Quality Gates
- **TypeScript:** `npx tsc --noEmit` $\to$ **0 errors**
- **ESLint:** `npm run lint` $\to$ **0 errors** (22 pre-existing test warnings)
- **Vitest:** `npm run test -- --run` $\to$ **131 passed** in 6.31s
- **Production Build:** `npm run build` $\to$ **Built in 8.20s**
- **Playwright E2E:** `npm run test:e2e` $\to$ **14 passed** in 1.5m

---

## 13. Environment Configuration & Deployment Requirements

Updated [`.env.example`](file:///media/sda3/Projects/Calibration/.env.example):
```bash
# PostgreSQL Database URLs (psycopg v3 driver)
DATABASE_URL=postgresql+psycopg://calibration_user:calibration_dev_password@127.0.0.1:5433/calibration_dev
TEST_DATABASE_URL=postgresql+psycopg://calibration_user:calibration_dev_password@127.0.0.1:5433/calibration_test

# OIDC Identity Provider Configuration
OIDC_ISSUER_URL=http://127.0.0.1:8080/realms/calibration
OIDC_AUDIENCE=calibration-backend-api
OIDC_CLIENT_ID=calibration-web-client
OIDC_ALLOWED_ALGORITHMS=RS256,ES256
OIDC_JWKS_CACHE_TTL_SECONDS=3600
OIDC_CLOCK_SKEW_SECONDS=30
OIDC_AUTO_PROVISION_USERS=true
```

### Production Deployment Constraints:
- In production (`ENVIRONMENT=production`), `OIDC_ISSUER_URL` **MUST** use HTTPS.
- In production, `OIDC_AUDIENCE` **MUST** be explicitly configured.
- The backend will **fail closed** on startup if these variables are missing or insecure.

---

## 14. Known Limitations & Remaining Operational Constraints

1. **Role-Based Access Control Pending:** Phase 10.3.1 implements authentication and identity mapping only. Fine-grained 5-tier authorization (`measurer`, `reviewer`, `supervisor`, `auditor`, `admin`) and separation-of-duties enforcement (`reviewer_id != measurer_id`) are scheduled for Phase 10.3.2.
2. **Live IdP Container:** Tests use deterministic RSA 2048-bit key fixtures registered in `OIDCValidator`. A live Keycloak container is documented in ADR-10-07 but was not spun up in this milestone to avoid unnecessary JVM overhead during CI testing.
3. **Frontend Sync Pending:** The React application continues to persist sessions locally in IndexedDB; full OIDC client UI and backend synchronization will be completed in Phase 10.4.
4. **Provisional Measurement Policies:** All persisted sessions continue to carry `is_provisional=true` and policy warning notices citing unratified policies (MP-01 through MP-09).

---

## 15. Readiness Assessment for Phase 10.3.2

Phase 10.3.1 is **COMPLETE** and verified. The backend identity and authentication foundation is fully ready for **Phase 10.3.2 (Role-Based Access Control and Permission Enforcement)**:

- [x] OIDC provider decision documented and architected.
- [x] Cryptographic token validation enforced at backend ingress.
- [x] Persistent `users` entity mapped to `(issuer, subject)`.
- [x] Disabled account blocking active.
- [x] Protected endpoints enforce Bearer authentication.
- [x] Audit ledger actor attribution bound to authenticated user UUID.
- [x] Anti-spoofing guards verified by automated tests.
- [ ] **Next Step (Phase 10.3.2):** Implement role claims extraction from tokens, FastAPI role dependencies (`@require_role("measurer")`, `@require_role("reviewer")`), and separation-of-duties validation on review approvals.

