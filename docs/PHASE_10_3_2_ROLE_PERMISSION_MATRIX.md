# Phase 10.3.2 — Role-Based Access Control & Permission Matrix

**Project:** Bicycle Calibration & Course Measurement Application  
**Milestone:** Phase 10.3.2 — Role-Based Access Control and Permission Enforcement  
**Security Model:** Deny-by-Default, Capability-Based, Authoritative Database Persistence  
**Date:** November 2026  

---

## 1. Executive Summary

This document defines the authoritative Role-Based Access Control (RBAC) architecture, capability permissions, separation-of-duties rules, and lifecycle authorization boundaries for the Bicycle Calibration & Course Measurement Application.

Following the verification of OIDC identity foundation in Phase 10.3.1, Phase 10.3.2 decouples external identity claims from internal application authorizations. All role assignments are authoritatively maintained within PostgreSQL (`user_roles`) with complete administrative audit trails and non-destructive revocation timestamps.

---

## 2. Defined Application Roles

| Role Name | Scope & Authority | Primary Responsibilities |
|---|---|---|
| **Measurer** | Field Operations | Record bicycle pre/post calibration rides; create and edit draft measurement sessions; submit sessions for peer review. |
| **Reviewer** | Independent Review | Inspect measurement sessions; verify calculations; approve or reject submitted sessions. Strict separation of duties prevents reviewing self-measured sessions. |
| **Supervisor** | Quality Assurance & Pilot Oversight | Manage measurement workflows across field teams; review sessions; supervise draft revisions; verify audit ledgers. Also subject to separation of duties. |
| **Auditor** | Independent Inspection & Compliance | Strictly read-only access. Inspect sessions, view complete audit ledgers, verify SHA-256 cryptographic chaining. Zero mutation rights. |
| **Admin** | Security Administration & Configuration | Manage user role assignments and revocations; maintain system configurations; provision access. Cannot bypass separation of duties for review decisions. |

---

## 3. Capability Permission Codes

The application decomposes all operations into 10 granular capabilities:

| Permission Code | Target Resource | Action | Description |
|---|---|---|---|
| `session:create` | `session` | `create` | Initialize a new persistent measurement session with rides and genesis audit event. |
| `session:read` | `session` | `read` | Retrieve persistent session details, calculations, rides, and review histories. |
| `session:update_draft` | `session` | `update` | Modify rides, counter readings, and metadata in an editable draft session. |
| `session:submit_review` | `session` | `submit` | Submit a draft session for formal peer review, locking it from direct modification. |
| `review:create` | `review` | `create` | Initiate a formal peer review on a submitted session. |
| `review:decide` | `review` | `decide` | Formally record an approval or rejection decision on a session. |
| `audit:read` | `audit` | `read` | Retrieve the chronological SHA-256 hash-chained audit ledger for a session. |
| `audit:verify` | `audit` | `verify` | Cryptographically verify hash links, monotonic sequence, and tamper detection on audit ledgers. |
| `role:manage` | `role` | `manage` | Administratively assign or revoke security roles from application users. |
| `config:manage` | `config` | `manage` | Modify application system configuration and global measurement parameters. |

---

## 4. Role-to-Permission Capability Matrix

Deny-by-default applies: users with no assigned roles possess zero capabilities and are refused access at all protected API endpoints with `HTTP 403 Forbidden`.

| Capability Permission | Measurer | Reviewer | Supervisor | Auditor | Admin |
|---|:---:|:---:|:---:|:---:|:---:|
| `session:create` | ✅ | ❌ | ✅ | ❌ | ✅ |
| `session:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `session:update_draft` | ✅ *(own draft)* | ❌ | ✅ | ❌ | ✅ |
| `session:submit_review` | ✅ *(own draft)* | ❌ | ✅ | ❌ | ✅ |
| `review:create` | ❌ | ✅ | ✅ | ❌ | ✅ |
| `review:decide` | ❌ | ✅ *(SoD applied)* | ✅ *(SoD applied)* | ❌ | ✅ *(SoD applied)* |
| `audit:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit:verify` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `role:manage` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `config:manage` | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 5. Separation of Duties (SoD) Invariants

### 5.1 Peer Review Separation Rule (SoD-01)
> **Invariant:** A user who participated as the measurer of a calibration session cannot review or approve that session.
>
> $$\text{Reviewer UUID} \neq \text{Measurer UUID}$$

- **Enforcement Layer:** Backend service (`RBACService.check_separation_of_duties`) and API endpoint (`POST /sessions/{id}/reviews`).
- **Identifier Compared:** Immutable internal application user UUID (`session.measurer_id` vs `current_user.id`).
- **Exemptions:** **None.** Neither `admin` nor `supervisor` roles can override this invariant.
- **Violation Response:** `HTTP 403 Forbidden` with detail:  
  `"SEPARATION_OF_DUTIES_VIOLATION: Reviewer cannot be the measurer of the session."`

---

## 6. Workflow State Machine & Immutability Rules

Measurement sessions progress through discrete lifecycle states:

```
[ draft ] -------- submit ---------> [ needs_review ] -------- approve --------> [ approved / finalized ]
   |                                        |                                              |
   |                                        | (reject)                                     |
   +--- update (measurer/supervisor) <------+                                        [ Strictly Immutable ]
```

| Lifecycle State | Allowed Operations | Modification Restrictions |
|---|---|---|
| `draft` | Edit readings, add rides, update metadata, submit for review. | Only the original measurer, supervisor, or admin may modify. |
| `needs_review` | Read, inspect audit trail, submit review decision. | Locked from direct reading modification (`HTTP 409 Conflict`). |
| `approved` / `finalized` | Read, inspect audit trail, verify cryptographic hashes. | **Strictly immutable.** Any edit or review attempt returns `HTTP 409 Conflict`. |

---

## 7. Role Management & Auditable Persistence

- **Persistence Table:** `user_roles` (PostgreSQL 16)
- **Active Assignment Uniqueness:** Partial unique index `uq_active_user_role` on `(user_id, role_id) WHERE revoked_at IS NULL`.
- **Revocation Semantics:** Non-destructive soft-revocation. Setting `revoked_at = NOW()` deactivates entitlements while preserving historical attribution.
- **Audit Requirement:** Role assignments require administrative justification (`assignment_reason`).

