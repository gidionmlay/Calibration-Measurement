# Phase 10 — Production Threat Model and Risk Assessment

**Project:** Bicycle Calibration Calculation / Road Course Measurement Application  
**Repository:** `/media/sda3/Projects/Calibration`  
**Working Branch:** `feature/phase-6-controlled-pilot`  
**Date:** 2026-10-29  
**Status:** Security Analysis & Threat Model (Preserving Provisional Status)  

---

## 1. Executive Summary and Scope

This document provides a comprehensive threat model for the Bicycle Calibration Calculation platform, evaluating both the current client-side prototype (Phases 1–9) and the target production architecture defined in [`docs/PHASE_10_PRODUCTION_ARCHITECTURE.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_PRODUCTION_ARCHITECTURE.md).

The primary objective of this threat model is to identify how an attacker, rogue operator, or compromised device could undermine **measurement integrity, non-repudiation, calculation correctness, or audit trustworthiness**, and to specify concrete architectural controls to neutralize those threats.

---

## 2. Critical Information Assets and Trust Boundaries

### 2.1 Critical Information Assets

| Asset ID | Asset Name | Description | Sensitivity / Impact if Compromised |
| :--- | :--- | :--- | :--- |
| **AST-01** | **Raw Counter Readings** | Start and end counts entered from Jones Counter on bicycle wheel. | **CRITICAL:** Falsification alters the derived working constant and course length, risking course miscertification. |
| **AST-02** | **Working Constants & Course Distance** | Values computed from raw counts (`CPK`, `WC`, course distance). | **CRITICAL:** If client-manipulated derived values are accepted, fraudulent certificates could be issued. |
| **AST-03** | **Override Reason Records** | Explanations entered when sequential count continuity is broken. | **HIGH:** Loss of override justifications destroys measurement auditability. |
| **AST-04** | **Audit Trail Records** | Sequential history of all creation, edits, overrides, reviews, and syncs. | **CRITICAL:** If audit entries can be altered or erased, accountability and non-repudiation collapse. |
| **AST-05** | **User Credentials & Identity** | Operator credentials, JWT tokens, and role assignments. | **HIGH:** Compromise allows impersonation of accredited measurers or supervisors. |
| **AST-06** | **Session Finalization State** | The immutable lock certifying that a measurement has passed all reviews. | **CRITICAL:** Premature or unauthorized finalization could release invalid or unapproved courses. |
| **AST-07** | **Export Bundles & Reports** | Signed JSON backups, CSV data exports, and PDF certificates. | **MEDIUM:** Manipulation outside the app could deceive event organizers or athletic federations. |

### 2.2 Trust Boundaries

```
[ UNTRUSTED OPERATOR DOMAIN ]
  ┌─────────────────────────────────────────────────────────────────┐
  │ Physical Measurer / Laptop / Browser / DevTools / Local Storage │
  └───────────────────────────────┬─────────────────────────────────┘
══════════════════════════════════╪═════════════════════════════════════════════════
  TRUST BOUNDARY 1 (Client / Network): TLS 1.3 / Reverse Proxy / Rate Limiter
══════════════════════════════════╪═════════════════════════════════════════════════
  ┌───────────────────────────────▼─────────────────────────────────┐
  │ API Gateway & Authentication Middleware (JWT & Scope Validation)│
  └───────────────────────────────┬─────────────────────────────────┘
══════════════════════════════════╪═════════════════════════════════════════════════
  TRUST BOUNDARY 2 (Gateway / Application): FastAPI Core Execution Engine
══════════════════════════════════╪═════════════════════════════════════════════════
  ┌───────────────────────────────▼─────────────────────────────────┐
  │ Authoritative Calculation Service & Domain State Machine       │
  └───────────────────────────────┬─────────────────────────────────┘
══════════════════════════════════╪═════════════════════════════════════════════════
  TRUST BOUNDARY 3 (Application / Storage): PostgreSQL Relational Layer
══════════════════════════════════╪═════════════════════════════════════════════════
  ┌───────────────────────────────▼─────────────────────────────────┐
  │ PostgreSQL (Append-Only Audit, Encrypted Tables, Foreign Keys)  │
  └───────────────────────────────┬─────────────────────────────────┘
══════════════════════════════════╪═════════════════════════════════════════════════
  TRUST BOUNDARY 4 (Database / Backup): Immutable Offsite Storage
══════════════════════════════════╪═════════════════════════════════════════════════
  ┌───────────────────────────────▼─────────────────────────────────┐
  │ WORM Object Storage (MinIO / S3) & HSM Checkpoint Ledger        │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 3. Threat Actor Profiles

1. **Curious / Careless Operator:** Legitimate user who enters incorrect numbers, attempts to bypass warnings, edits historical entries without realizing audit consequences, or loses network connectivity mid-sync.
2. **Disgruntled or Dishonest Measurer:** Operator incentivized to make a course measure to an exact target distance (e.g., exactly $42,195\text{ m}$) by fabricating counts, suppressing high-drift post-calibrations, or removing override annotations.
3. **External Impersonator / Network Attacker:** Unauthenticated adversary attempting credential stuffing, man-in-the-middle attacks on public Wi-Fi, or API exploitation.
4. **Compromised Field Machine:** Field laptop infected with malware, malicious browser extensions, or untrusted third-party software with access to local IndexedDB.
5. **Privileged System Administrator / DBA:** Database administrator with `postgres` superuser access capable of directly modifying tables or rewriting audit records.

---

## 4. STRIDE Threat Analysis

### 4.1 Spoofing (Identity Deception)
- **Threat S-1: Operator Impersonation in Field App.**
  - *Current Prototype:* Operator name is a plain text string (`J. Okafor`) stored in local memory. Any user can type another measurer's name.
  - *Target Architecture Mitigation:* OAuth2/OIDC authentication with RS256-signed JWTs. The user identity (`sub`, `name`, `email`) is extracted directly from the verified token signature.
  - *Residual Risk:* Low (session timeout, device lock required).

- **Threat S-2: Self-Review Spoofing (Violating Separation of Duties).**
  - *Vulnerability:* A measurer signs off on their own measurement review to circumvent peer verification.
  - *Target Architecture Mitigation:* Backend API checks `session.measurer_id != current_user.id` when processing review approvals. Attempted self-reviews return `HTTP 403 Forbidden` and trigger a security audit event.
  - *Residual Risk:* Negligible.

### 4.2 Tampering (Data Manipulation)
- **Threat T-1: Client-Side Calculation Manipulation.**
  - *Current Prototype:* Derived constants (`CPK`, `WC`, course length) are calculated by the browser in `calibration.ts`. An attacker using browser DevTools could inject falsified working constants into the export file.
  - *Target Architecture Mitigation:* The backend treats all client-supplied derived metrics as untrusted. Upon receipt of any session, the **Authoritative Calculation Service** recalculates every constant, drift percentage, and course distance from raw counts using the server's pure engine.
  - *Residual Risk:* Negligible.

- **Threat T-2: Falsification of Historical Audit Logs.**
  - *Current Prototype:* Audit entries are plain JSON objects in IndexedDB. An operator can delete or modify records.
  - *Target Architecture Mitigation:* PostgreSQL table `audit_events` has `REVOKE UPDATE, DELETE, TRUNCATE` applied to the application connection. Every event is cryptographically linked to its predecessor via SHA-256 hash chaining. Hourly signed checkpoints are exported to immutable WORM object storage.
  - *Residual Risk:* Low (requires compromising both the database superuser AND the offsite WORM storage credentials).

- **Threat T-3: Formula Injection via CSV / Report Exports.**
  - *Vulnerability:* Malicious course names (e.g., `=cmd|' /C calc'!A0`) entered into course setup fields execute arbitrary commands when opened in Microsoft Excel.
  - *Mitigation (Verified in Phase 9):* `reportExport.ts` and backend export formatters sanitize all cells starting with `=`, `+`, `-`, or `@` by prefixing them with a single quote (`'`).
  - *Residual Risk:* Negligible.

### 4.3 Repudiation (Denial of Actions)
- **Threat R-1: Operator Denies Entering Overrides or Altering Counts.**
  - *Vulnerability:* An operator claims the system automatically altered their start counts or miscalculated their calibration.
  - *Target Architecture Mitigation:* Every state-changing API request requires an authenticated JWT. The backend records the actor's verified user ID, client IP address, user agent, server timestamp, and the exact diff of before/after state in the cryptographically chained audit log.
  - *Residual Risk:* Negligible.

### 4.4 Information Disclosure (Data Leakage)
- **Threat I-1: Production Source Code or Sensitive Architecture Leakage.**
  - *Mitigation (Verified in Phase 9):* `vite.config.ts` enforces `build.sourcemap = false`. Production builds generate zero `.map` files.
  - *Target Architecture Mitigation:* Backend API suppresses verbose stack traces in production (returns RFC 7807 Problem Details with sanitized error messages and opaque correlation IDs).
  - *Residual Risk:* Low.

- **Threat I-2: Unauthorized Access to Competitor Course Measurements.**
  - *Vulnerability:* An unauthenticated user enumerates session IDs (`GET /api/v1/sessions/{id}`) to inspect unannounced marathon routes.
  - *Target Architecture Mitigation:* UUIDv4 session identifiers (non-enumerable) combined with organization-level multitenancy filters (`WHERE session.org_id = current_user.org_id`).
  - *Residual Risk:* Negligible.

### 4.5 Denial of Service (Availability Destruction)
- **Threat D-1: Synchronization Flooding and Large File Uploads.**
  - *Vulnerability:* An attacker submits multi-gigabyte JSON payloads or loops rapid sync requests to exhaust server memory and database connections.
  - *Target Architecture Mitigation:* Reverse proxy enforces 5 MB payload limit and IP-based rate limiting (100 req/min). Backend streaming JSON parser rejects excessive arrays.
  - *Residual Risk:* Low.

- **Threat D-2: Accidental Local Storage Deletion in Field.**
  - *Vulnerability:* An operator clears browser cache or private browsing data while offline, losing un-synchronized field readings.
  - *Mitigation:* IndexedDB persistence requested with `navigator.storage.persist()`. Prominent UI warnings displayed before clearing cache or exiting un-synced sessions.
  - *Residual Risk:* Low (managed via pilot protocol physical paper log requirements).

### 4.6 Elevation of Privilege (Unauthorized Operations)
- **Threat E-1: Client-Side Finalization Blocker Bypass.**
  - *Vulnerability:* An operator executes `sessionContext.finalize()` in browser DevTools or patches `blockers = []` to finalize an unapproved session.
  - *Mitigation (Verified in Phase 9 & Target Architecture):* Phase 9 added programmatic checks inside `finalize()` in `SessionContext.tsx`. In the target architecture, finalization is executed exclusively by the server within an ACID transaction that independently verifies:
    1. Zero calculation blockers.
    2. Independent peer review approval present.
    3. Governing policy MP-01..09 status == approved (currently blocks all requests with HTTP 422).
    4. Authenticated caller possesses `supervisor` or `admin` role.
  - *Residual Risk:* Negligible.

---

## 5. Comprehensive Risk Assessment Matrix

| Threat ID | Threat Description | Likelihood | Impact | Inherent Risk | Implemented / Proposed Mitigations | Residual Risk |
| :--- | :--- | :---: | :---: | :---: | :--- | :---: |
| **THR-01** | Client-side manipulation of working constant or course distance | High | Critical | **CRITICAL** | Authoritative backend recalculation; client derived values discarded. | **LOW** |
| **THR-02** | Premature finalization while measurement policy unratified | High | Critical | **CRITICAL** | Hardcoded policy blocker in client + server-side transactional rejection (HTTP 422). | **LOW** |
| **THR-03** | Local audit log tampering or selective deletion | High | High | **HIGH** | Append-only PostgreSQL table (`REVOKE UPDATE, DELETE`) + SHA-256 hash chaining + WORM backup. | **LOW** |
| **THR-04** | Operator self-review and unverified sign-off | Medium | High | **HIGH** | Strict separation of duties enforcement (`measurer_id != reviewer_id`). | **NEGLIGIBLE** |
| **THR-05** | Offline sync race conditions and silent data overwrite | Medium | High | **HIGH** | Optimistic locking via `version_id` / `ETag`; explicit interactive conflict resolution dialog. | **LOW** |
| **THR-06** | Accidental data loss due to device battery failure or browser reset | High | Medium | **HIGH** | IndexedDB auto-save + exportable backup bundles + mandatory dual-paper recording protocol. | **LOW** |
| **THR-07** | Formula injection via exported CSV spreadsheets | Medium | Medium | **MEDIUM** | Formula sanitization (`'`) on all formula trigger characters (`=`, `+`, `-`, `@`). | **NEGLIGIBLE** |
| **THR-08** | LAN-based path traversal via Vite dev server | Low | High | **MEDIUM** | Dev-server bound strictly to `127.0.0.1`; static production bundle contains zero Vite code. | **LOW** |
| **THR-09** | Rogue database administrator tampering with historical records | Low | Critical | **HIGH** | Hourly HSM/KMS-signed Merkle checkpoints published to offsite immutable object storage. | **LOW** |

---

## 6. Dependency Vulnerability Analysis and Upgrade Path

In Phase 9, `npm audit` reported 3 advisories in development dependencies:
- **`vite` (installed: `5.4.21`, vulnerable: `<=6.4.3`):** GHSA-587h-7wmj-h5pm (high), GHSA-4w7w-66w2-5vf9 (moderate), and related path-traversal advisories in dev-server middleware and `launch-editor`.
- **`vitest` (installed: `1.6.1`, vulnerable: `<3.2.6`):** GHSA-5xrq-8626-4rwp (critical: arbitrary file read/exec when Vitest UI server is listening).
- **`vite-node` (installed: `1.6.1`, vulnerable: `<=2.2.0-beta.2`):** Transitive dependency of `vitest`.

### 6.1 Real-World Exposure Assessment
1. **Zero Runtime Exposure:** Neither `vite`, `vitest`, nor `vite-node` are bundled into the production output in `dist/assets/`. Production assets consist exclusively of static JavaScript (`index-*.js`), CSS, and HTML.
2. **Compensating Controls Active:**
   - Dev server bound to `127.0.0.1` (`vite.config.ts`), eliminating network-based LAN exploitation.
   - Vitest runs purely headless in CLI mode (`vitest run`). The vulnerable Vitest UI server package (`@vitest/ui`) is not installed.

### 6.2 Recommended Toolchain Upgrade Path
To eliminate the warnings entirely prior to broad production deployment, the development toolchain should be upgraded to:
- **`vite` $\ge$ `6.0.0` or `7.x`**
- **`vitest` $\ge$ `3.2.6` or `5.x`**
- *Note:* This major upgrade requires testing for breaking changes in Vitest configuration and React plugins. This is scheduled as an engineering task in Phase 10.6 of the implementation roadmap.

---

## 7. Security Assumptions and Unresolved Architectural Questions

### 7.1 Security Assumptions
1. **Physical Device Custody:** The operator is assumed to maintain physical custody of the measurement laptop/tablet during course measurement. Full-disk encryption (BitLocker / LUKS) is assumed to be active on all pilot hardware.
2. **TLS Integrity:** Communication between the browser client and the backend API is assumed to occur over trusted TLS 1.3 infrastructure where certificates are properly validated.
3. **External IdP Trust:** The OpenID Connect identity provider (e.g., Keycloak, Auth0) is assumed to enforce secure credential storage and multi-factor authentication.

### 7.2 Unresolved Governance and Security Questions
1. **Cryptographic Signing of Certificates:** Should measurement certificates be digitally signed with an X.509 certificate issued by the governing athletic federation, or is a server-side digital signature sufficient?
2. **Long-Term Audit Retention:** How long must raw measurement data and audit trails be retained (e.g., 5 years, 10 years, or permanently)?
3. **Cross-Federation Reciprocity:** Will multiple measurement organizations share a multi-tenant cloud instance, or will governing bodies require isolated, on-premise deployments?
