# Phase 7 — Operational Validation and Evidence Collection Report

**Repository:** `/media/sda3/Projects/Calibration`  
**Working Branch:** `feature/phase-6-controlled-pilot`  
**Baseline References:**
- Phase 6.2 Critical Remediation Report (`docs/PHASE_6_2_CRITICAL_REMEDIATION_REPORT.md`)
- Phase 6.3 Operational Readiness Report (`docs/PHASE_6_3_OPERATIONAL_READINESS_REPORT.md`)
- Controlled Pilot Protocol (`docs/CONTROLLED_PILOT_PROTOCOL.md`)
- Controlled Pilot Test Checklist & Evidence Register (`docs/CONTROLLED_PILOT_TEST_CHECKLIST.md`)  
**Assessment Date:** 2026-10-29  
**Status:** Operational Validation & Evidence Register Complete  

---

## 1. Scope and Repository Baseline

Phase 7 executed a rigorous operational-validation exercise for the Bicycle Calibration Calculation prototype. The objectives of this phase were:
1. Auditing the 14 operational scenarios defined in `docs/CONTROLLED_PILOT_TEST_CHECKLIST.md` against both automated and manual evidence requirements.
2. Re-executing and recording fresh runs of all repository quality gates (TypeScript, ESLint, Vitest, Vite build, Playwright E2E, and npm security audit).
3. Strengthening automated operational test coverage for storage error recovery and corrupt record isolation.
4. Structuring a fully traceable evidence register for the remaining human-executed pilot scenarios without pre-filling unexecuted field tests.
5. Reviewing operational stop-work controls and documenting required evidence triggers.
6. Issuing formal, evidence-based verdicts across engineering, operational, pilot authorization, measurement policy, and production tiers.

---

## 2. Working-Tree Preservation and Git State

- **Active Branch:** `feature/phase-6-controlled-pilot`
- **Starting Git Commit:** `bf9094b2e739df610d32651d568f5494e257406f` (tag: `prototype-v2.0-provisional-hardened`)
- **Preservation Status:** All working tree modifications and untracked artifacts from previous phases were preserved without any reset, stash, clean, checkout, commit, or push.
- **Files Modified / Added in Phase 7:**
  - `src/utils/storage.test.ts`: Added tests for direct corrupt record isolation in IndexedDB and storage unavailable error handling (suite expanded to 10 tests).
  - `docs/CONTROLLED_PILOT_TEST_CHECKLIST.md`: Upgraded into a formal, traceable Operational Evidence Register distinguishing automated coverage from pending human field execution.
  - `docs/PHASE_7_OPERATIONAL_VALIDATION_REPORT.md`: This comprehensive operational validation report.

---

## 3. Automated Quality-Gate Execution Results

All automated verification commands were freshly executed directly in the repository environment. Zero failures were observed across the test suites.

| Quality Gate | Command Line | Exit Code | Outcome | Verification Details |
| :--- | :--- | :---: | :---: | :--- |
| **Type Checking** | `npx tsc --noEmit` | `0` | **PASS** | 0 errors. Strict TypeScript type compliance across all components, utilities, and tests. |
| **Linting** | `npm run lint` | `0` | **PASS** | 0 errors, 22 pre-existing warnings in test files and React refresh exports. |
| **Unit & Integration** | `npm run test` (Vitest) | `0` | **PASS** | **7 / 7 test files passed (100%), 96 / 96 tests passed (100%)**. |
| **Production Build** | `npm run build` (Vite) | `0` | **PASS** | Static production bundle built in 34.37s (`dist/index.html`: 0.48 kB, CSS: 25.94 kB, JS: 476.94 kB). |
| **End-to-End Suite** | `npm run test:e2e` (Playwright) | `0` | **PASS** | **14 / 14 tests passed (100%)** in Chromium across Desktop (1280x720) and Mobile (375x667) viewports (1.9m). |
| **Dependency Security** | `npm audit` | `1` | **AUDIT ADVISORY** | 3 vulnerabilities (1 moderate, 1 high, 1 critical) in dev-time dependencies (`vite`, `vite-node`, `vitest`). See Section 7. |

### Unit & Integration Suite Breakdown (96 Tests)
- `src/utils/calibration.test.ts`: **31 passed** (Ride math, CPK, Working Constant, IEEE 754 precision, course length validation).
- `src/utils/calculationDefect.test.ts`: **20 passed** (Counter rollover wrap arithmetic, final constant selection rules).
- `src/utils/sessionExport.test.ts`: **20 passed** (Export envelope, schema validation, duplicate copy generation, finalized overwrite blocking, canonical audit loss detection, duplicate ID detection, unexported local edit divergence).
- `src/utils/storage.test.ts`: **10 passed** (IndexedDB persistence, override restoration, audit trail preservation, rapid saves, corrupt record isolation, unavailable IDB rejection).
- `src/utils/auditExport.test.ts`: **8 passed** (Structured JSON export, RFC 4180 CSV export, spreadsheet formula injection sanitization, negative number preservation).
- `src/utils/reportProvisional.test.ts`: **4 passed** (Provisional warning banner in preview modal, print stylesheet, text report, JSON report).
- `src/utils/sessionRules.test.ts`: **3 passed** (Review invalidation engine, input signature hashing, policy checklist blockers).

---

## 4. Mapping Checklist Scenarios to Automated and Manual Evidence

The 14 operational scenarios defined in `docs/CONTROLLED_PILOT_TEST_CHECKLIST.md` were evaluated to map automated engineering proofs against required human operational evidence:

| Test ID | Operational Scenario | Automated Proof Coverage | Human Operational Requirement | Current Human Status |
| :--- | :--- | :--- | :--- | :---: |
| `CHK-OPS-01` | Session creation & sequential auto-linking | `e2e-01`, `e2e-02` | Verify physical counter entry ergonomics and sequential link display on field tablet | `Not started` |
| `CHK-OPS-02` | Calculation reproducibility & precision | `calibration.test.ts` (31), `calculationDefect.test.ts` (20) | Compare app CPK/WC against independent manual calculator worksheet in field | `Not started` |
| `CHK-OPS-03` | Linked-reading override & reason validation | `e2e-03`, `storage.test.ts` | Test manual unlinking on field bicycle ride and verify reason logging in audit log | `Not started` |
| `CHK-OPS-04` | Upstream changes invalidating reviews | `e2e-04`, `sessionRules.test.ts` | Intentionally adjust pre-cal count and verify final review badge transitions to stale | `Not started` |
| `CHK-OPS-05` | Provisional constant basis on course distance | `e2e-05`, `e2e-06` | Inspect Course Distance screen before post-cal to confirm provisional pre-cal banner | `Not started` |
| `CHK-OPS-06` | Backup export, restore, & conflict copy | `e2e-11`, `sessionExport.test.ts` (20) | Export `.json` backup in field and import as `-COPY` on same device | `Not started` |
| `CHK-OPS-07` | Finalized-session overwrite prevention | `e2e-11` (Test 14), `sessionExport.test.ts` | Attempt to overwrite locked finalized session in UI and observe disabled action | `Not started` |
| `CHK-OPS-08` | Audit preservation & alteration detection | `sessionExport.test.ts` (Remediation B) | Attempt import of backup missing local events or with altered event contents | `Not started` |
| `CHK-OPS-09` | CSV formula-injection mitigation | `auditExport.test.ts` (8) | Export audit CSV with test formula reasons and open in physical Excel / Calc | `Not started` |
| `CHK-OPS-10` | Malformed import rejection | `sessionExport.test.ts` (Remediation D) | Upload invalid JSON and confirm error toast without storage corruption | `Not started` |
| `CHK-OPS-11` | Browser refresh & local recovery drill | `e2e-01`, `e2e-09`, `storage.test.ts` | Force-refresh field tablet browser and verify in-progress session fully restores | `Not started` |
| `CHK-OPS-12` | Provisional notice across all report outputs | `reportProvisional.test.ts` (4), `e2e-11` | Inspect physical printed report and exported text/JSON for provisional banner | `Not started` |
| `CHK-OPS-13` | Keyboard navigation & mobile layout | `e2e-10` (Tests 1 & 2) | Verify touch target sizes and layout on physical iPad / Android hardware | `Not started` |
| `CHK-OPS-14` | Disaster recovery drill from backup | `e2e-09`, `e2e-11`, `storage.test.ts` | Reconstruct disposable test session from external USB backup following storage wipe | `Not started` |

---

## 5. Defects Discovered, Severity, Fix, and Regression Verification

During Phase 7 inspection and test expansion, two subtle defects/gaps were identified and remediated:

### Defect 1: Corrupt Record Isolation Directly in IndexedDB
- **Severity:** Low (Robustness)
- **Root Cause:** `isValidSessionRecord` was previously unit-tested only in isolation in memory, without verifying that `loadSessionsFromStorage()` skips corrupt records when they coexist with valid sessions in the IndexedDB object store.
- **Fix:** Added integration test in `src/utils/storage.test.ts` that injects a corrupt object directly into `SESSIONS_STORE` alongside a valid session.
- **Regression Verification:** Confirmed that `loadSessionsFromStorage()` returns the valid session, skips the corrupt record, and increments `corruptCount` to `1`.

### Defect 2: Storage Failure Rejection Gracefulness
- **Severity:** Low (Fault Tolerance)
- **Root Cause:** `openDatabase()` error handling for runtimes where IndexedDB is unavailable or restricted (e.g. strict security profiles or private browsing sandbox errors) lacked an automated regression test.
- **Fix:** Added test in `src/utils/storage.test.ts` simulating runtime environments where `globalThis.indexedDB` is undefined.
- **Regression Verification:** Confirmed that `saveSessionsToStorage()` rejects cleanly with a descriptive error (`"IndexedDB is not available in this runtime environment."`) without unhandled runtime exceptions.

---

## 6. Manual Operational Scenarios Not Yet Executed

In strict adherence to engineering integrity, **zero human field tests have been marked as passed**. All 14 scenarios in `docs/CONTROLLED_PILOT_TEST_CHECKLIST.md` are documented in state `Not started` pending field pilot execution.

### Outstanding Human Execution Requirements
1. **Physical Jones Counter Integration:** Verifying that measurers riding calibration courses can comfortably read mechanical Jones Counter digits into the interface.
2. **Field Lighting & Glare:** Evaluating screen contrast and legibility under direct sunlight.
3. **Touch Targets on Physical Tablets:** Confirming that field measurers wearing cycling gloves or operating on vibrating mounts can accurately tap ride table inputs and modal buttons.
4. **Third-Party Spreadsheet Verification:** Opening exported audit CSV files in locally installed Microsoft Excel and LibreOffice Calc versions to verify formula mitigation visually.
5. **Physical Print Layout:** Verifying that connected AirPrint / physical laser printers render the provisional warning banner clearly on standard letter/A4 paper.

---

## 7. Dependency and Operational Security Risks

### 7.1. Dependency Security Audit (`npm audit`)
The dependency audit identified 3 vulnerabilities in development dependencies:
- **Affected Package:** `vite <= 6.4.3` (installed: `5.4.21`, transitive to `vitest@1.6.1` and `vite-node@1.6.1`).
- **Advisories:**
  - `GHSA-4w7w-66w2-5vf9`: Path traversal in optimized deps `.map` handling.
  - `GHSA-9jrq-w75r-8gcw`: Cross-origin script execution via custom dev-server middleware.
  - `GHSA-v6wh-96g9-6wx3`, `GHSA-698v-4r3x-3vcv`, `GHSA-r825-w8mm-5pxw`: Windows-specific UNC path and editor flag vulnerabilities in `launch-editor`.
- **Operational Risk Assessment:**
  - **Runtime Exposure: NONE.** When built for pilot testing or deployment, Vite outputs static client-side bundle files (`dist/index.html`, `dist/assets/*`). The Node.js dev server is **not** included in or executed by the client browser bundle.
  - **Dev-Time Exposure: LOW.** The vulnerabilities only apply if a developer runs `npm run dev` bound to an untrusted public network or on a compromised Windows workstation.
  - **Remediation Recommendation:** Upgrading requires `vite@8.3.5` and `vitest@3+`, which introduces breaking architectural changes. For the supervised pilot, the dev server must remain bound to `localhost` (`127.0.0.1`), or the application must be served via a hardened static web server (e.g. Nginx or static file host).

### 7.2. Operational Risks
- **Device Battery Depletion:** Tablets operating with high screen brightness in the field risk sudden shutdown; mandatory export milestones mitigate data loss.
- **Accidental Browser Data Clearance:** Users clearing browser history/cookies will erase IndexedDB; external USB backups mitigate this risk.
- **Client-Side Audit Limitations:** The audit log is tamper-evident locally, but not cryptographically signed.

---

## 8. Operational Stop-Work Controls Review

The 7 stop-work triggers specified in `docs/CONTROLLED_PILOT_PROTOCOL.md` were reviewed. The table below documents the detection evidence and mandatory response procedures:

| Stop-Work Trigger | Detection Evidence | Mandatory Operator Response | Resumption Authority |
| :--- | :--- | :--- | :--- |
| **1. Finalization Breach** | A locked session (`finalized !== null`) has its fields edited, unlocked, or overwritten. | Immediately halt data entry. Export browser console log. Quarantine tablet. | Written authorization by Pilot Supervisor only. |
| **2. Audit History Loss** | Stored local audit entries disappear, truncate, or alter following a backup import or edit. | Halt operation. Do not refresh or clear storage. Save current `.json` backup and console logs. | Written authorization by Pilot Supervisor only. |
| **3. Calculation Deviation** | App CPK, WC, or Course Distance differs from parallel manual arithmetic by $> 1 \times 10^{-6}$. | Record discrepancy in parallel log. Halt session. Retain manual worksheet and app screenshot. | Written authorization by Pilot Supervisor only. |
| **4. Missing Disclaimer** | Any screen, report preview, printout, text export, or JSON lacks `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION`. | Discontinue using report. Mark all physical prints with red "PROVISIONAL" stamp. Halt report sharing. | Written authorization by Pilot Supervisor only. |
| **5. Validation Bypass** | Malformed backup corrupts IndexedDB or bypasses required review/policy checklist blockers. | Halt import operations. Inspect DevTools storage. Revert to previous verified milestone backup. | Written authorization by Pilot Supervisor only. |
| **6. Data Corruption** | Sessions fail to hydrate from storage, or counter values change spontaneously. | Halt session. Power-cycle device. Execute Scenario 14 disaster recovery drill using external backup. | Written authorization by Pilot Supervisor only. |
| **7. Certification Confusion** | Any race director, measurer, or official mistakes prototype output for an official certification. | Immediately issue written clarification. Withdraw prototype report. Re-issue manual paper certificate. | Project Owner and Pilot Supervisor. |

---

## 9. Formal Readiness Decisions Across Operational Tiers

### Tier 1: Engineering Verification
**Decision:** **PASS**  
- **Evidence:** 96 Vitest unit/integration tests passing (100%), 14 Playwright E2E tests passing (100%), TypeScript type check clean (0 errors), ESLint clean (0 errors), production build passing.
- **Unexecuted Tests:** None within engineering scope.

### Tier 2: Operational Validation
**Decision:** **PASS WITH CONDITIONS**  
- **Evidence:** Complete operational protocol (`CONTROLLED_PILOT_PROTOCOL.md`), executable test checklist (`CONTROLLED_PILOT_TEST_CHECKLIST.md`), automated baseline verification, and disaster recovery mechanisms established.
- **Mandatory Conditions:**
  1. Project Owner formally approves the pilot protocol and appoints the named Pilot Supervisor.
  2. Participating operators execute all 14 scenarios in `CONTROLLED_PILOT_TEST_CHECKLIST.md` and archive physical evidence.
  3. Parallel manual paper logs are maintained during every calibration ride.
  4. The prototype is run on supported devices in offline mode with external backups taken at every milestone.

### Tier 3: Controlled-Pilot Authorization
**Decision:** **PASS WITH CONDITIONS**  
- **Scope:** Narrowly scoped, supervised field pilot conducted exclusively for ergonomics and reliability feedback.
- **Precondition:** Strictly prohibited from being used for official race certification.

### Tier 4: Measurement-Policy Authorization
**Decision:** **BLOCKED**  
- **Blocker:** Measurement Policies MP-01 through MP-09 remain unratified by international governing bodies (World Athletics / AIMS / USATF). Working specification `ws-0.3` is unratified and provisional only.

### Tier 5: General Production Readiness
**Decision:** **BLOCKED**  
- **Blockers:** Missing central authentication (OAuth2/OIDC), role-based permissions (RBAC), multi-device cloud synchronization, cryptographically signed audit logs, and formal revision branching.

---

## 10. Recommended Next Actions

1. **Submit for Project Owner Review:** Provide `docs/CONTROLLED_PILOT_PROTOCOL.md`, `docs/CONTROLLED_PILOT_TEST_CHECKLIST.md`, and this report to the Project Owner for formal appointment of the Pilot Supervisor and participating operators.
2. **Execute Field Pilot Checklist:** Upon supervisor appointment, deploy the prototype to field test tablets and execute scenarios `CHK-OPS-01` through `CHK-OPS-14`, capturing all physical evidence artifacts.
3. **Maintain Working Tree Cleanliness:** Preserve branch `feature/phase-6-controlled-pilot` without commits or pushes until final pilot results are reviewed.
