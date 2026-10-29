# Phase 10 — Architecture Decision Records (ADRs)

**Project:** Bicycle Calibration Calculation / Road Course Measurement Application  
**Repository:** `/media/sda3/Projects/Calibration`  
**Working Branch:** `feature/phase-6-controlled-pilot`  
**Date:** 2026-10-29  
**Status:** Proposed Architecture Decisions (Pending Project Owner Approval)  

---

## 1. Executive Summary

This document formalizes the key architectural decisions for the target production platform described in [`docs/PHASE_10_PRODUCTION_ARCHITECTURE.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_PRODUCTION_ARCHITECTURE.md). Each decision evaluates technical trade-offs, consequences, and alternatives considered, establishing a traceable record for project stakeholders and governing bodies.

> [!IMPORTANT]
> **Approval Status:** All ADRs in this document are **PROPOSED**. None of these architectural changes have been implemented or committed to code in this phase.

---

## 2. Architecture Decision Records Index

| ADR ID | Title | Status | Category |
| :--- | :--- | :---: | :--- |
| **ADR-10-01** | Modular Monolith (FastAPI + PostgreSQL) vs. Distributed Microservices | PROPOSED | System Architecture |
| **ADR-10-02** | Authoritative Server-Side Calculation Service with Pure Functional Engine | PROPOSED | Calculation & Integrity |
| **ADR-10-03** | Append-Only Audit Logging with Transactional Coupling and SHA-256 Checkpointing | PROPOSED | Audit & Compliance |
| **ADR-10-04** | Offline-First Operation with Optimistic Concurrency Control and Interactive Conflict Resolution | PROPOSED | Synchronization |
| **ADR-10-05** | Immutable Finalized Sessions and Explicit Revision / Supersession Lineage | PROPOSED | Domain Lifecycle |
| **ADR-10-06** | OpenID Connect (OIDC) / OAuth2 Authentication with Backend RBAC Enforcement | PROPOSED | Security & Identity |
| **ADR-10-07** | RFC 7807 Structured Problem Details and Idempotent Request Handling | PROPOSED | API Design |
| **ADR-10-08** | S3-Compatible Blob Storage for Export Bundles and Signed Measurement Certificates | PROPOSED | Data Storage |

---

## 3. Detailed Architecture Decision Records

### ADR-10-01: Modular Monolith Architecture vs. Distributed Microservices

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
The measurement application must support field operators, peer reviewers, supervisors, and compliance auditors. Some architectures favor splitting domains into microservices (e.g., Auth Service, Calculation Service, Audit Service, Session Service). However, road course measurement is a domain with tightly coupled transactional requirements (e.g., saving a ride reading must transactionally update the session state, recalculate constants, and record an audit log entry).

#### Decision
Implement the backend as a **Modular Monolith** using **FastAPI** (Python 3.12+) and **PostgreSQL 16**. Internal module boundaries will separate authentication, calculation, session management, and auditing, but all modules will execute within a single deployable process sharing an ACID-compliant database.

#### Alternatives Considered
1. **Microservices Architecture:** Rejected. Introduces distributed transactions (Saga/2PC), network latency, complex observability requirements, and high operational overhead with zero throughput justification for a domain with hundreds—not millions—of concurrent measurers.
2. **Serverless Functions (AWS Lambda / Cloud Run):** Rejected. Cold starts degrade the responsiveness of field operations, and distributed database connection pooling adds unnecessary failure points.

#### Consequences & Trade-offs
- **Positive:** Single deployment artifact; zero network hops between calculation and persistence; true ACID transactions across domain state and audit events; simplified local testing and developer onboarding.
- **Negative:** Single failure domain (a fatal crash in the calculation engine could theoretically crash the API process, mitigated via process supervisors and worker isolation).

---

### ADR-10-02: Authoritative Server-Side Calculation Boundary

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
In the client-side prototype, calculations are performed in the browser (`src/utils/calibration.ts`). As established in the Phase 9 security review, client-side calculations cannot be trusted because an operator can modify browser memory or tamper with exported JSON files.

#### Decision
Establish an **Authoritative Server-Side Calculation Service** in Python. The client-side TypeScript calculation engine will remain for instant, responsive UI presentation in the field, but the backend will treat all client-submitted derived values as **ephemeral drafts**. The server will independently compute all working constants, drift percentages, and course distances directly from validated raw counts before persisting them or issuing reports.

#### Alternatives Considered
1. **Trust Client Calculations with Validation Rules:** Rejected. Any client-side derived value could be spoofed using browser developer tools.
2. **Shared WebAssembly (Wasm) Calculation Core:** Considered compiling a single Rust/C++ engine to Wasm (client) and native binary (server). Deferred to avoid toolchain complexity; independent implementations (TypeScript client + Python server) with automated parity test suites provide cross-verification.

#### Consequences & Trade-offs
- **Positive:** Guarantees arithmetic integrity; prevents falsified certificates; maintains strict provenance linking every calculation to an explicit `engine_version` and `ruleset_version`.
- **Negative:** Requires maintaining two calculation codebases (TypeScript presentation engine and Python authoritative service).
- **Mitigation:** Golden reference test vectors established in Phase 8 ([`calculationValidation.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/calculationValidation.test.ts)) will be run against both engines to enforce bit-level parity.

---

### ADR-10-03: Append-Only Audit Logging with Transactional Coupling and SHA-256 Checkpointing

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
Audit trails in road course measurement provide legal and athletic non-repudiation. If an audit log can be edited or truncated, the legitimacy of world records or Olympic qualification courses is compromised.

#### Decision
Implement an **Append-Only Audit Ledger** in PostgreSQL with three defense layers:
1. **Transactional Coupling:** Domain updates and audit writes occur within the same database transaction.
2. **Database Permission Hardening:** The application user has only `SELECT` and `INSERT` permissions on `audit_events`. `UPDATE`, `DELETE`, and `TRUNCATE` are revoked.
3. **Cryptographic Chaining & Checkpointing:** Each audit event contains a SHA-256 hash incorporating the previous event's hash. Hourly Merkle roots of the audit log are signed using an external HSM/KMS key and pushed to an immutable WORM S3 bucket.

#### Alternatives Considered
1. **Client-Side Event Log Only (Current Status):** Rejected. Trivial to delete or alter in IndexedDB.
2. **Dedicated Blockchain / Distributed Ledger:** Rejected. Over-engineered, expensive, high latency, and unneeded when cryptographic hash chaining and offsite WORM storage provide equivalent tamper evidence.

#### Consequences & Trade-offs
- **Positive:** Complete non-repudiation; tamper detection; clear evidence of operator actions and override justifications.
- **Negative:** Increased database storage growth (mitigated by storing compact JSONB payloads).

---

### ADR-10-04: Offline-First Operation with Optimistic Concurrency Control

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
Course measurement takes place on public roads, rural routes, and remote locations where cellular coverage is unreliable. Measurers must be able to record data without an internet connection.

#### Decision
Support an **Offline-First Workflow** in the React client using local IndexedDB storage.
- Each client-generated action receives a client UUID (`op_id`).
- When connectivity resumes, queued operations are sent to the backend.
- Concurrency is managed via **Optimistic Locking (`version_id` / `ETag`)**.
- If a version conflict occurs, the server returns `HTTP 409 Conflict`.
- **No Silent Merges:** The application never automatically overwrites or merges data. Conflicts must be resolved interactively by the operator, allowing them to keep the server version or branch their changes into an independent copy (following [`src/components/shell/ImportConflictDialog.tsx`](file:///media/sda3/Projects/Calibration/src/components/shell/ImportConflictDialog.tsx)).
- **Finalization Prohibited Offline:** Finalization requires real-time server authentication and cannot occur offline.

#### Alternatives Considered
1. **Always-Online Requirement:** Rejected. Completely unusable in field measurement conditions.
2. **Automated Last-Write-Wins (LWW):** Rejected. Causes silent data loss of critical calibration readings.
3. **CRDTs (Conflict-Free Replicated Data Types):** Rejected. Too complex for simple sequential counter readings where physical order matters.

#### Consequences & Trade-offs
- **Positive:** Seamless field operations; zero silent data loss; predictable conflict handling.
- **Negative:** Requires operators to understand conflict dialogs if multiple devices touch the same session.

---

### ADR-10-05: Immutable Finalized Sessions and Explicit Revision Lineage

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
Once a road course measurement is finalized, altering it invalidates the athletic certificate. However, real-world errors (e.g., typographical error in course name or roadway resurfacing) occasionally require corrections.

#### Decision
Enforce strict **Session Immutability**:
1. When a session reaches `finalized` status, the database row is locked. The API rejects all `PUT`, `PATCH`, and `DELETE` requests on finalized sessions with `HTTP 422 Unprocessable Entity`.
2. Any subsequent modification requires creating a **Superseding Revision Session** (`v1.1` or `v2.0`).
3. The new revision explicitly links to its parent (`supersedes_id`), and the original session records `superseded_by_id`.
4. Creating a revision requires a mandatory justification string ($\ge 20$ characters) and joint authorization from a Pilot Supervisor or Administrator.

#### Alternatives Considered
1. **In-Place Unlocking / Reopening:** Rejected. Unlocking an existing certificate creates ambiguity over which numbers were officially approved.
2. **Deleting and Re-Entering:** Rejected. Destroys historical audit continuity.

#### Consequences & Trade-offs
- **Positive:** Full audit traceability; certificates can never be altered retroactively; historical truth is permanently preserved.
- **Negative:** Requires storage of multiple session versions.

---

### ADR-10-06: OpenID Connect (OIDC) / OAuth2 with Centralized Backend RBAC

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
The prototype currently uses unauthenticated mock names. In production, measurers, reviewers, supervisors, and auditors require verified identities and distinct permissions.

#### Decision
Adopt **OAuth2 Authorization Code Flow with PKCE** via an external **OpenID Connect (OIDC)** Identity Provider (e.g., Keycloak or Cloud Identity).
- The backend validates RS256/EdDSA JWT access tokens on every request.
- Centralized FastAPI dependencies enforce a 5-tier Role-Based Access Control (RBAC) model: `measurer`, `reviewer`, `supervisor`, `auditor`, `admin`.
- **Separation of Duties:** The backend strictly forbids `measurer_id == reviewer_id` on review approvals.

#### Alternatives Considered
1. **Custom Username/Password in Local Database:** Rejected. Burden of password hashing, MFA, account recovery, and security compliance on the measurement application.
2. **API Keys / Static Tokens:** Rejected. Inadequate for multi-user role management and user-level audit attribution.

#### Consequences & Trade-offs
- **Positive:** Standards-compliant identity; MFA support; clean separation between identity management and application logic.
- **Negative:** Dependency on an external IdP service (mitigated by using standard OIDC libraries allowing pluggable IdP providers).

---

### ADR-10-07: Structured Problem Details (RFC 7807) and Idempotency Keys

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
Field operations over unreliable cellular connections frequently experience network timeouts and retried HTTP requests. Standard unstructured HTTP errors make automated client recovery difficult.

#### Decision
1. All API error responses adhere to **RFC 7807 (Problem Details for HTTP APIs)**, returning structured JSON with `type`, `title`, `status`, `detail`, `instance`, and `invalid_params`.
2. All mutating endpoints (`POST`, `PUT`, `DELETE`) accept an `X-Operation-ID` header (UUIDv4). The server caches operation results in PostgreSQL/Redis for 24 hours. Retried requests return the identical cached response without re-executing logic or creating duplicate audit entries.

#### Consequences & Trade-offs
- **Positive:** Predictable error handling for client UI; prevents duplicate readings caused by double-clicking or network retries.
- **Negative:** Slight storage overhead for idempotency tracking.

---

### ADR-10-08: S3-Compatible Blob Storage for Artifacts and Measurement Certificates

#### Status
**PROPOSED (Pending Project Owner Approval)**

#### Context
Course measurement generates high-resolution PDFs, raw JSON export bundles, and signed audit checkpoints. Storing large binary objects directly inside PostgreSQL bloats database size and degrades backup performance.

#### Decision
Use an **S3-Compatible Object Store** (e.g., MinIO for on-premise/local deployments, AWS S3 / Google Cloud Storage for cloud) to store generated measurement certificates, exported JSON bundles, and audit checkpoints. The PostgreSQL database will store only metadata and immutable object URIs.

#### Consequences & Trade-offs
- **Positive:** Keeps relational database fast and lean; enables S3 Object Lock (WORM) to guarantee immutability of certificates.
- **Negative:** Introduces an auxiliary storage service.

---

## 4. Architectural Decisions Requiring Project Owner Approval

The following decisions require explicit sign-off from the project owner and governing measurement authorities before implementation begins:

1. **Approval of Proposed RBAC Roles:** Confirmation that the 5 proposed roles (`measurer`, `reviewer`, `supervisor`, `auditor`, `admin`) match the real-world operational hierarchy of course measurement.
2. **Identity Provider Selection:** Decision whether to deploy an open-source self-hosted IdP (Keycloak) or a managed cloud IdP (Auth0, AWS Cognito, Google Cloud Identity).
3. **Mandatory Measurement Policy Ratification:** Formal determination of whether MP-01 through MP-09 will be approved as governing standards, modified, or replaced before the backend finalization endpoint is enabled.
4. **Data Retention Horizon:** Specification of legal data retention requirements (e.g., minimum 10-year retention for certified marathon measurements).
