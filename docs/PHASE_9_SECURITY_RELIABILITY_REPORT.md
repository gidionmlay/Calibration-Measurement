# Phase 9 — Security and Reliability Hardening Report

**Repository:** `/media/sda3/Projects/Calibration`  
**Working Branch:** `feature/phase-6-controlled-pilot`  
**Baseline Git Reference:** `bf9094b2e739df610d32651d568f5494e257406f` (tag: `prototype-v2.0-provisional-hardened`)  
**Prerequisite Reports:**
- [`docs/PHASE_8_INDEPENDENT_CALCULATION_VALIDATION_REPORT.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_8_INDEPENDENT_CALCULATION_VALIDATION_REPORT.md)
- [`docs/CONTROLLED_PILOT_PROTOCOL.md`](file:///media/sda3/Projects/Calibration/docs/CONTROLLED_PILOT_PROTOCOL.md)
- [`docs/MEASUREMENT_POLICY_DECISION_REGISTER.md`](file:///media/sda3/Projects/Calibration/docs/MEASUREMENT_POLICY_DECISION_REGISTER.md)  
**Assessment Date:** 2026-10-29  
**Status:** Security Hardening and Reliability Review Complete  

---

## 1. Repository Baseline and Preservation Status

- **Active Branch:** `feature/phase-6-controlled-pilot`
- **Current HEAD Commit:** `bf9094b2e739df610d32651d568f5494e257406f`
- **Preservation Status:** All tracked modifications, test suites, and untracked documentation files were preserved without any reset, clean, stash, discard, branch switch, commit, or push.
- **Scope of Phase 9:** In-depth security analysis of dependencies, import/export validation, local storage fault tolerance, client-side trust boundaries, and operational reliability hardening.

---

## 2. Dependency Security Audit and Remediation

A fresh dependency security audit was executed using `npm audit --json`.

### Audit Findings Analysis

| Package | Severity | Advisory ID & Description | Dependency Path | Runtime vs Dev Impact | Practical Attack Surface & Exposure |
| :--- | :---: | :--- | :--- | :---: | :--- |
| **`vitest`** | **Critical** | GHSA-5xrq-8626-4rwp: Arbitrary file read & execution when Vitest UI server listens (`<3.2.6`). | `vitest` (direct devDependency) | Development / Test | **Zero Runtime Exposure.** The application uses `vitest run` (headless CLI mode). The Vitest UI server (`@vitest/ui`) is not installed, configured, or running. In production, no test tooling exists in the bundle. |
| **`vite`** | **High** | GHSA-587h-7wmj-h5pm: `launch-editor` `fs.existsSync()` bypass on Windows (`<=6.4.3`). | `vite` (direct devDependency) | Development / Build | **Zero Runtime Exposure.** Affects only development-mode `launch-editor` middleware on Windows systems. Production build compiles to static assets (`dist/`) without Vite dev server. |
| **`vite`** | **Moderate** | GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22, GHSA-fx2h-pf6j-xcff | `vite` | Development / Build | Path traversal in optimized deps `.map` handling and Windows UNC path handling in `launch-editor`. Requires running `npx vite` on an untrusted network. |
| **`vite-node`**| **Moderate** | Transitive via `vite`. | `vitest -> vite-node -> vite` | Development / Test | Transitive dependency of Vitest CLI; zero runtime exposure. |

### Build Output & Configuration Hardening
1. **Source Map Suppression:**
   In [`vite.config.ts`](file:///media/sda3/Projects/Calibration/vite.config.ts), `build.sourcemap: false` was explicitly codified. Physical inspection of `dist/assets/` confirmed only production bundles (`index-*.js`, `index-*.css`) are generated with zero `.map` files or source code exposure.
2. **Loopback Host Binding:**
   In [`vite.config.ts`](file:///media/sda3/Projects/Calibration/vite.config.ts), `server.host: '127.0.0.1'` was configured. This ensures that when the Vite dev server is executed locally, it binds strictly to the local loopback interface and never to `0.0.0.0`, eliminating LAN-based path traversal risks.
3. **Dependency Version Policy:**
   Upgrading `vitest` from v1 to v3/v5 or `vite` to v8 represents a major breaking change requiring new Node.js runtimes and bundler engine migrations. Because all advisories are restricted to dev-server middleware and have zero presence in the compiled static client bundle (`dist/`), forced major upgrades are deferred to post-pilot modernization.

---

## 3. Import/Export Security Review

The session backup, audit export, and report generation workflows were inspected across all trust boundaries:

| Security Vector | Implementation Mechanism | Validation Status |
| :--- | :--- | :---: |
| **Schema Validation** | [`validateSessionImport()`](file:///media/sda3/Projects/Calibration/src/utils/sessionExport.ts#L106-L316) validates format identifier, schemaVersion (1), object types, enum validity (`rolloverMode`, `finalRule`, `ruleSet`, `consistencyRule`), 4-ride arrays, and timestamp ISO formats. | **PASS** |
| **Derived Value Recalculation** | [`detectDerivedDiscrepancies()`](file:///media/sda3/Projects/Calibration/src/utils/sessionExport.ts#L322-L364) recomputes all mathematical constants using the engine and flags exported discrepancies; recomputed values govern. | **PASS** |
| **Finalized Overwrite Protection** | Both [`prepareImportedSession()`](file:///media/sda3/Projects/Calibration/src/utils/sessionExport.ts#L541-L547) and [`SessionContext.tsx`](file:///media/sda3/Projects/Calibration/src/contexts/SessionContext.tsx#L457-L461) throw an explicit error if `conflictStrategy === 'overwrite'` targets a finalized session. | **PASS** |
| **Audit Loss & Alteration Detection**| [`detectLocalAuditLoss()`](file:///media/sda3/Projects/Calibration/src/utils/sessionExport.ts#L425-L518) enforces: 1) duplicate ID rejection; 2) complete local event presence; 3) canonical content equivalence; 4) unexported local reading edit protection. | **PASS** |
| **Safe Conflict Resolution** | [`ImportConflictDialog.tsx`](file:///media/sda3/Projects/Calibration/src/components/shell/ImportConflictDialog.tsx) disables "Overwrite" whenever the local record is finalized or local audit loss is detected, forcing "Import as copy". | **PASS** |
| **CSV Formula Injection Sanitization**| [`escapeCsvCell()`](file:///media/sda3/Projects/Calibration/src/utils/auditExport.ts#L76-L118) detects dangerous spreadsheet triggers (`=`, `+`, `-`, `@`) and prepends a neutralizing single quote (`'`), while preserving valid numeric literals (e.g., `-12`, `3.5`). | **PASS** |
| **Provisional Notice Retention** | Reports generated in text, JSON, or print formats embed mandatory provisional headers and enumerate unratified policies MP-01 through MP-09. | **PASS** |

---

## 4. Local Storage and Recovery Hardening

IndexedDB transactions, hydration, and error-recovery mechanisms in [`src/utils/storage.ts`](file:///media/sda3/Projects/Calibration/src/utils/storage.ts) and [`src/contexts/SessionContext.tsx`](file:///media/sda3/Projects/Calibration/src/contexts/SessionContext.tsx) were evaluated:

1. **Atomic Store Replacement:**
   `saveSessionsToStorage()` executes inside a single `readwrite` transaction spanning `SESSIONS_STORE` and `META_STORE`. `sessionStore.clear()` precedes record insertion to eliminate ghost records.
2. **Corrupt Record Isolation:**
   `loadSessionsFromStorage()` iterates over raw records using `isValidSessionRecord()`. Malformed or corrupt records are discarded with `corruptCount` tracked, allowing valid sessions to load without application crashes. Verified via direct IndexedDB injection drill in `storage.test.ts`.
3. **Storage Unavailability Resilience:**
   `openDatabase()` checks `globalThis.indexedDB`. If unavailable or disabled (e.g. private browsing sandbox failure), the call rejects cleanly with an explicit error, which sets `storageStatus.health = 'degraded'` in the UI without crashing the React tree.
4. **Hydration Protection:**
   In `SessionContext.tsx`, `isHydrated` guards against overwriting stored records with initial in-memory seed defaults before IndexedDB hydration has resolved.

---

## 5. Application Security Boundaries

### Client-Side Trust Model & Inherent Limitations
> [!IMPORTANT]
> The application is currently a **client-only single-page application (SPA)** utilizing local browser IndexedDB storage.
> 
> The following security boundaries must be explicitly understood:
> 1. **No Tamper-Proofing against Local Operator:** A user with browser DevTools access can modify IndexedDB records, edit JavaScript variables in memory, or alter the local system clock. Client-side code cannot provide cryptographic non-repudiation or tamper-proofing without a trusted backend service.
> 2. **Operator Identity is Simulated:** Operator names (e.g., `J. Okafor`) are prototype strings stored in local state. The application does not possess an identity provider, session tokens, or Role-Based Access Control (RBAC).
> 3. **Provisional-Only Enforcement:** Because client-side state is malleable, all outputs are marked `PROVISIONAL` and official certification is prohibited.

### Client-Side Vulnerability Mitigations
- **Cross-Site Scripting (XSS):**
  - Codebase search confirmed zero instances of `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `new Function()`.
  - All dynamic data is rendered via standard React JSX escaping.
- **URL Handling:**
  - Zero external URL navigation or dynamic `href` bindings exist. Only standard in-app state routing and blob object URLs for local file downloads (`URL.createObjectURL()`, immediately revoked) are utilized.
- **Programmatic Finalization Bypass Fix:**
  - Previously, `FinalReview.tsx` verified `derived.blockers.length === 0` in the UI before opening the finalize confirmation dialog, but `SessionContext.finalize()` did not verify checklist blockers internally.
  - **Hardening Applied:** In `SessionContext.tsx`, `finalize()` now independently evaluates `deriveSession(currentSession, connectivity)` and immediately blocks finalization if `d.blockers.length > 0`, closing the programmatic bypass vector.

---

## 6. Verified Fixes and Regression Coverage

| Component | Security / Reliability Issue | Applied Hardening | Regression Test Reference |
| :--- | :--- | :--- | :--- |
| [`src/contexts/SessionContext.tsx`](file:///media/sda3/Projects/Calibration/src/contexts/SessionContext.tsx) | Direct function call could bypass UI finalization blocker checks. | Enforced `d.blockers.length === 0` check inside `finalize()`. | [`src/utils/sessionRules.test.ts:77-122`](file:///media/sda3/Projects/Calibration/src/utils/sessionRules.test.ts#L77-L122) |
| [`vite.config.ts`](file:///media/sda3/Projects/Calibration/vite.config.ts) | Dev-server default host binding and unconfigured sourcemap settings. | Configured `server.host: '127.0.0.1'` and `build.sourcemap: false`. | Production build asset verification (`dist/assets`) |
| [`src/utils/sessionRules.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/sessionRules.test.ts) | Missing regression tests for policy approval blocker. | Added tests asserting unapproved policy blocks finalization even when all other inputs and reviews are complete. | [`sessionRules.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/sessionRules.test.ts) (5 tests) |
| [`src/utils/storage.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/storage.test.ts) | Missing test for corrupt record isolation directly in IndexedDB. | Injected invalid object directly into `SESSIONS_STORE` and verified clean recovery of valid records. | [`storage.test.ts:162-187`](file:///media/sda3/Projects/Calibration/src/utils/storage.test.ts#L162-L187) |
| [`src/utils/calculationValidation.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/calculationValidation.test.ts) | Need independent reference validation of formulas and review invalidation. | Established 33 independent tests verifying arithmetic, IEEE 754 precision, and sequential linkage cancellations. | [`calculationValidation.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/calculationValidation.test.ts) (33 tests) |

---

## 7. Outstanding Vulnerabilities and Compensating Operational Controls

| Residual Risk | Severity | Root Architectural Cause | Compensating Operational Control (Controlled Pilot) |
| :--- | :---: | :--- | :--- |
| **Unauthenticated Identity** | High | Client-only SPA architecture lacks OIDC/OAuth2 backend. | Controlled Pilot Protocol mandates Pilot Supervisor physical oversight; paper logs signed by hand. |
| **Local Storage Tampering** | High | IndexedDB is accessible to operator via browser tools. | Parallel paper recording mandatory; end-of-day JSON backups exported to external USB storage. |
| **Vite Dev-Tooling CVEs** | Low | Upstream vulnerabilities in dev-mode middleware (`vite`, `vitest`). | Standalone offline production build deployed; dev server is never run in field or production. |
| **Unratified Measurement Policies** | Critical | Governing standards body has not ratified MP-01 through MP-09. | Hardcoded `PROVISIONAL` disclaimers across UI and reports; official certification blocked. |

---

## 8. Automated Quality-Gate Execution Results

All repository quality gates were executed against the working tree:

| Quality Gate | Command Line | Exit Code | Result Summary |
| :--- | :--- | :---: | :--- |
| **Type Checking** | `npx tsc --noEmit` | `0` | **PASS**: 0 compile or type errors across all files |
| **Code Linting** | `npm run lint` | `0` | **PASS**: 0 errors (22 pre-existing style warnings in tests) |
| **Unit & Integration** | `npm run test` (Vitest) | `0` | **PASS**: 8/8 files passed, **131/131 tests passed (100%)** |
| **Production Build** | `npm run build` (Vite) | `0` | **PASS**: Static bundle generated in 45.80s (zero sourcemaps leaked) |
| **End-to-End Suite** | `npm run test:e2e` (Playwright)| `0` | **PASS**: **14/14 tests passed (100%)** in Chromium across Desktop and Mobile viewports |
| **Dependency Security** | `npm audit` | `1` | **DOCUMENTED**: 3 dev-tooling vulnerabilities; zero runtime exposure |

---

## 9. Prioritized Remediation Backlog for Phase 10 / Production

1. **Central Authentication & Role-Based Access Control (RBAC):**
   Implement OIDC/OAuth2 authentication (Measurer, Validator, Technical Director) to replace simulated operator strings.
2. **Cryptographic Server-Side Audit Trail:**
   Deploy an append-only backend audit service with HMAC or asymmetric digital signatures on finalized measurement sessions.
3. **Formal Revision Branching & Certificate Addenda (MP-09):**
   Replace disabled "Start formal revision" placeholder with versioned certificate superseding logic.
4. **Governing Policy Ratification (MP-01 through MP-09):**
   Obtain formal written ratification of standard manual, calibration course bounds, and final constant rules.
5. **Modernized Bundler Toolchain Upgrade:**
   Upgrade Vite and Vitest to latest major versions post-pilot to clear dev-server security advisories.

---

## 10. Readiness Verdicts

| Dimension | Verdict | Evidence / Justification |
| :--- | :---: | :--- |
| **Security & Reliability Hardening** | **PASS** | Input sanitization, CSV formula injection defense, atomic IndexedDB storage, and programmatic finalization safeguards verified. 131 unit tests and 14 E2E tests pass. |
| **Controlled-Pilot Authorization** | **PASS WITH CONDITIONS** | Permitted under strict supervision using the Controlled Pilot Protocol (`docs/CONTROLLED_PILOT_PROTOCOL.md`) with parallel paper logs. All outputs maintain prominent provisional notices. |
| **Measurement Policy Authorization** | **BLOCKED** | Decisions MP-01 through MP-09 remain unratified. The prototype cannot produce official certified course measurements. |
| **Production Readiness** | **BLOCKED** | Blocked due to client-only architecture, unratified measurement policy, lack of server authentication, and absence of signed audit logs. |

### Recommended Next Action
Proceed with controlled operational pilot under Pilot Supervisor oversight using paper logs in parallel. Maintain working tree intact on `feature/phase-6-controlled-pilot`.
