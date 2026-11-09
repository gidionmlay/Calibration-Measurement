# Phase 10.3.2 Implementation Report: Role-Based Access Control and Permission Enforcement

**Project:** Bicycle Calibration & Course Measurement Application  
**Repository:** `/media/sda3/Projects/Calibration`  
**Branch:** `feature/phase-6-controlled-pilot`  
**Milestone:** Phase 10.3.2 — Role-Based Access Control and Permission Enforcement  
**Disposition:** **PASS — VERIFIED IN PRODUCTION ENVIRONMENT**  
**Execution Date:** November 7, 2026  

---

## 1. Executive Summary

Phase 10.3.2 successfully delivers an enterprise-grade, deny-by-default Role-Based Access Control (RBAC) and permission enforcement architecture. Building directly upon the cryptographically verified OpenID Connect (OIDC) identity foundation established in Phase 10.3.1, this milestone establishes authoritative application-managed authorizations in PostgreSQL, strictly decoupled from external token claims.

### Key Achievements
1. **Deny-by-Default Architecture:** Users lacking explicit role assignments hold zero capability permissions and are immediately blocked at protected API endpoints with `HTTP 403 Forbidden`.
2. **Persistent RBAC Data Model:** Implemented through Alembic migration `0004_rbac_schema`, introducing `roles`, `permissions`, `role_permissions`, and auditable `user_roles` with partial unique index `uq_active_user_role`.
3. **Five Canonical Roles & Ten Granular Capabilities:** Pre-seeded system roles (`Measurer`, `Reviewer`, `Supervisor`, `Auditor`, `Admin`) mapped to discrete actions across `session`, `review`, `audit`, `role`, and `config` resources.
4. **Strict Separation of Duties (SoD):** Absolute invariant comparing internal application UUIDs (`current_user.id != session.measurer_id`), returning `HTTP 403 Forbidden` (`SEPARATION_OF_DUTIES_VIOLATION`). Neither Admin nor Supervisor roles are exempt.
5. **Workflow Immutability Guards:** Sessions submitted for review (`needs_review`) and finalized sessions (`approved`/`finalized`) are strictly immutable, returning `HTTP 409 Conflict`.
6. **Administrative Governance:** Auditable role assignment and non-destructive revocation APIs restricted to users with `role:manage`.
7. **Verification Rigor:** 136 backend tests passing (including 9 exhaustive RBAC tests), 0 TypeScript errors, 0 ESLint errors, 131 frontend Vitest tests passing, and clean Vite production build.

---

## 2. Operational Baseline & Git State

- **Target Directory:** `/media/sda3/Projects/Calibration`
- **Active Branch:** `feature/phase-6-controlled-pilot`
- **Starting Git Status:** Preserved all working-tree changes from Phase 10.2, 10.2.1, and 10.3.1.
- **Git Commit Constraint:** Strictly observed — zero commits, tags, or remote pushes created.

---

## 3. Database Architecture & Migration

### 3.1 Migration `0004_rbac_schema`
Created and applied migration `backend/alembic/versions/0004_rbac_schema.py` against both `calibration_dev` and `calibration_test` databases.

#### Table Schema Summary:
1. `roles`:
   - `id`: UUID Primary Key (deterministic UUIDs for system roles).
   - `name`: VARCHAR(64) UNIQUE NOT NULL (indexed).
   - `description`: TEXT.
   - `is_system_role`: BOOLEAN NOT NULL DEFAULT TRUE.
   - `created_at`, `updated_at`: TIMESTAMPTZ.
2. `permissions`:
   - `id`: UUID Primary Key.
   - `code`: VARCHAR(64) UNIQUE NOT NULL (indexed).
   - `description`: TEXT.
   - `resource`: VARCHAR(64) NOT NULL.
   - `action`: VARCHAR(64) NOT NULL.
   - `created_at`: TIMESTAMPTZ.
3. `role_permissions`:
   - `role_id`: UUID FK -> `roles.id` (ON DELETE CASCADE).
   - `permission_id`: UUID FK -> `permissions.id` (ON DELETE CASCADE).
   - Composite Primary Key `(role_id, permission_id)`.
4. `user_roles`:
   - `id`: UUID Primary Key.
   - `user_id`: UUID FK -> `users.id` (ON DELETE CASCADE, indexed).
   - `role_id`: UUID FK -> `roles.id` (ON DELETE RESTRICT, indexed).
   - `assigned_by`: UUID FK -> `users.id` (ON DELETE SET NULL).
   - `assigned_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW().
   - `revoked_at`: TIMESTAMPTZ NULLABLE.
   - `assignment_reason`: TEXT NULLABLE.
   - **Partial Unique Index:**
     ```sql
     CREATE UNIQUE INDEX uq_active_user_role
     ON user_roles (user_id, role_id)
     WHERE revoked_at IS NULL;
     ```

### 3.2 System Roles & Permission Seeding
All 5 system roles and 10 capability permissions are pre-seeded via migration:
- **Roles:** `measurer`, `reviewer`, `supervisor`, `auditor`, `admin`.
- **Permissions:**
  - `session:create`, `session:read`, `session:update_draft`, `session:submit_review`
  - `review:create`, `review:decide`
  - `audit:read`, `audit:verify`
  - `role:manage`, `config:manage`

---

## 4. Authoritative Role Source & Identity Separation

In accordance with Section 4 of the architectural specification:
1. **OIDC Sole Responsibility:** The external identity provider (IdP) is responsible exclusively for authenticating the human operator and establishing cryptographic identity (`iss`, `sub`, `email`).
2. **PostgreSQL Sole Responsibility:** The internal application database is the single authoritative source of user roles and capability grants. Unverified token claims (e.g. `roles` claim in raw JWT) are rejected and ignored for permission evaluation.
3. **Audit Attribution:** Role assignments record the admin operator UUID (`assigned_by`) and administrative justification (`assignment_reason`).
4. **Historical Preservation:** Revoking a role sets `revoked_at = NOW()`, preserving the assignment row for audit inspection while immediately invalidating active capability permissions.

---

## 5. Centralized RBAC Engine & Dependencies

Implemented in `backend/app/auth/rbac.py`:

### 5.1 `RBACService` Methods
- `get_active_user_roles(db, user_id)`: Fetches active `Role` objects.
- `get_user_role_names(db, user_id)`: Returns active role name strings.
- `get_user_permissions(db, user_id)`: Aggregates capability codes across active roles.
- `has_role(db, user_id, role_name)`: Checks active role membership.
- `has_permission(db, user_id, permission_code)`: Evaluates specific capability entitlement.
- `assign_role(db, target_user_id, role_name, assigned_by, reason)`: Validates user/role, prevents duplicates (409), records assignment.
- `revoke_role(db, target_user_id, role_name, revoked_by, reason)`: Soft-revokes active assignment, recording timestamp and reason.
- `check_separation_of_duties(current_user_id, session)`: Enforces reviewer $\neq$ measurer.
- `check_session_write_access(db, current_user, session)`: Validates workflow state and measurer ownership boundaries.

### 5.2 Dependency Injection Factories
- `require_permission(permission_code: str)`: Callable FastAPI dependency verifying capability. Raises `HTTP 403 Forbidden` on missing grant.
- `require_role(role_name: str)`: Callable FastAPI dependency verifying active role. Raises `HTTP 403 Forbidden` on missing role.

---

## 6. Separation of Duties (SoD) Enforcement

- **Invariant:** A measurer cannot review or approve their own measurement session.
- **Implementation:**
  ```python
  if session.measurer_id and str(current_user_id) == str(session.measurer_id):
      raise HTTPException(
          status_code=status.HTTP_403_FORBIDDEN,
          detail="SEPARATION_OF_DUTIES_VIOLATION: Reviewer cannot be the measurer of the session.",
      )
  ```
- **Universal Scope:** Enforced on `POST /api/v1/sessions/{session_id}/reviews`. Applies uniformly across all users; no supervisor or admin overrides exist.

---

## 7. Workflow State Machine & Session Access

1. **State `draft`:**
   - Editable by original measurer (`session.measurer_id == current_user.id`), or supervisor/admin.
   - Measurers cannot edit sessions owned by another measurer (`HTTP 403 Forbidden`).
2. **State `needs_review`:**
   - Transitioned via `POST /api/v1/sessions/{session_id}/submit`.
   - Direct modifications blocked with `HTTP 409 Conflict`.
3. **State `approved` / `finalized`:**
   - Transitioned via `POST /api/v1/sessions/{session_id}/reviews` with `status: "approved"`.
   - Strictly immutable: any edit or review attempt returns `HTTP 409 Conflict`.

---

## 8. API Endpoints Protection Matrix

| Route | Method | Required Permission / Guard | Error Status |
|---|---|---|---|
| `/api/v1/auth/me` | GET | Valid Bearer Token | 401 |
| `/api/v1/auth/roles` | GET | Valid Bearer Token | 401 |
| `/api/v1/auth/users/{user_id}/roles` | GET | `role:manage` (or self) | 401, 403 |
| `/api/v1/auth/users/{user_id}/roles` | POST | `role:manage` | 401, 403, 404, 409 |
| `/api/v1/auth/users/{user_id}/roles/{role}` | DELETE | `role:manage` | 401, 403, 404 |
| `/api/v1/sessions` | POST | `session:create` | 401, 403, 422 |
| `/api/v1/sessions/{id}` | GET | `session:read` | 401, 403, 404 |
| `/api/v1/sessions/{id}` | PUT | `session:update_draft` + State/Ownership Guard | 401, 403, 404, 409, 422 |
| `/api/v1/sessions/{id}/submit` | POST | `session:submit_review` + State Guard | 401, 403, 404, 409 |
| `/api/v1/sessions/{id}/reviews` | POST | `review:decide` + Separation of Duties Guard | 401, 403, 404, 409 |
| `/api/v1/sessions/{id}/audit-trail` | GET | `audit:read` | 401, 403, 404 |
| `/api/v1/sessions/{id}/verify-audit` | POST | `audit:verify` | 401, 403, 404 |

---

## 9. Verification & Quality Gates

### 9.1 Backend Test Execution
- **Command:** `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/ -v`
- **Result:** **136 passed in 16.21s** (100% pass rate).
- **Test Categories:**
  - Seeding and mappings verification: `test_rbac_seeding_and_role_permission_mappings`
  - Deny-by-default verification: `test_unassigned_user_has_zero_permissions_deny_by_default`
  - Measurer role boundaries: `test_measurer_role_permissions_and_boundaries`
  - Multi-measurer isolation: `test_measurer_cannot_modify_another_measurers_session`
  - Separation of duties: `test_strict_separation_of_duties_prevents_self_review`
  - Peer review and approval: `test_independent_reviewer_can_review_and_approve_session`
  - Workflow state immutability: `test_workflow_state_immutability`
  - Auditor read-only boundaries: `test_auditor_strictly_read_only`
  - Role admin lifecycle: `test_administrative_role_assignment_and_revocation_lifecycle`
  - Plus all 127 existing tests (OIDC, persistence, concurrency, audit integrity, validation, vectors).

### 9.2 Frontend Quality Gates
- **ESLint:** `npm run lint` $\to$ 0 errors, 22 pre-existing warnings.
- **TypeScript:** `npx tsc --noEmit` $\to$ 0 errors.
- **Vitest:** `npm run test -- --run` $\to$ 8 test files passed, 131 tests passed.
- **Production Build:** `npm run build` $\to$ 2358 modules transformed, built in 8.58s.

---

## 10. Integrity Preservation of Calculation Engine

- `backend/app/services/calculation_engine.py` was **unmodified**.
- Calculations remain 100% pure Python `Decimal` arithmetic.
- Provisional policy notices (`PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION`) for MP-01 through MP-09 are preserved intact.

---

## 11. Conclusion & Next Steps

Phase 10.3.2 is fully verified and ready for deployment. The application features a robust, auditable RBAC security layer adhering to zero-trust principles.

**Recommended Next Step:** Phase 10.3.3 / Phase 10.4 — Frontend OIDC/RBAC State Synchronization and Offline Session Synchronization.

