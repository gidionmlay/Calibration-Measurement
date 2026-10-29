# Controlled Pilot Operational Test Checklist & Evidence Register

**Document Identifier:** `PILOT-CHK-2026-V2`  
**Application:** Bicycle Calibration Calculation — Road Course Measurement  
**Repository Working Branch:** `feature/phase-6-controlled-pilot`  
**Protocol Reference:** `docs/CONTROLLED_PILOT_PROTOCOL.md`  
**Status:** Operational Register Prepared for Human Field Execution  
**Current Execution State:** `Pending Human Pilot Execution` (All manual field scenarios: `Not started`)  
**Automated Baseline Verification:** Complete (96 Vitest unit/integration tests passing, 14 Playwright E2E tests passing)  

---

## 1. Operating Instructions & Status Definitions

This document serves as the formal operational test checklist and evidence register for the controlled field pilot. Each scenario must be executed by a designated human operator under the direct oversight of the appointed Pilot Supervisor.

### Permitted Scenario Statuses
- **Not started:** Test scenario has not yet been executed in the field pilot environment. (Default starting state).
- **In progress:** Execution has commenced but all steps, verifications, or artifacts are not yet finalized.
- **Passed:** All execution steps completed successfully; observed actual results match expected results; all required evidence artifacts are captured and archived.
- **Failed:** Observed behavior deviates from expected results, or a defect was triggered. Defect reference must be logged.
- **Blocked:** Preconditions cannot be satisfied (e.g. equipment failure, severe weather, device unavailability, or stop-work condition active).
- **Not applicable (N/A):** Scenario is not relevant to the specific test setup; detailed justification must be provided.

### Strict Governance Rules
1. **No False Passing:** Automated test passage does **not** mark a human operational scenario as passed. Human execution and physical artifact retention are strictly required.
2. **Disposable Test Data:** Never perform destructive recovery drills (`CHK-OPS-14`) against live primary field data. Use dedicated disposable test sessions.
3. **Evidence Custody:** All retention items (screenshots, `.json` backups, parallel paper logs, `.csv` exports) must be preserved in the designated pilot evidence folder.

---

## 2. Operational Scenarios & Evidence Register

### Scenario 01: New Session Creation and Sequential Reading Auto-Linking
- **Test ID:** `CHK-OPS-01`
- **Requirement Verified:** Clean session initialization, reference sequence numbering (`BC-YYYY-NNN`), parameter entry, and start-to-previous-finish counter auto-linking.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-01-session-creation.spec.ts`, `e2e/e2e-02-linked-readings.spec.ts`
- **Prerequisites & Test Data:** Supported browser (Chromium/Safari/Firefox), active Session List; Course length: `1000.00 m`, Surface: `Asphalt`, Rollover: `notConfigured`, Final Rule: `larger`, Rule Set: `ws-0.3`. Readings: Ride 1 (10000 -> 14000), Ride 2 (finish 18000), Ride 3 (finish 22000), Ride 4 (finish 26000).
- **Steps:**
  1. Click "New Session". Verify reference ID is generated (`BC-YYYY-NNN`).
  2. In Setup, enter Course Length (`1000.00`), select Surface (`Asphalt`), select Rollover (`notConfigured`), select Final Rule (`larger`), Rule Set (`ws-0.3`).
  3. Navigate to Pre-Calibration.
  4. Enter Ride 1 Start (`10000`) and Finish (`14000`).
  5. Observe Ride 2 Start reading.
  6. Enter Ride 2 Finish (`18000`), Ride 3 Finish (`22000`), Ride 4 Finish (`26000`).
- **Expected Result:**
  - Ride 2 Start automatically links to Ride 1 Finish (`14000`).
  - Ride 3 Start auto-links to `18000`, Ride 4 Start auto-links to `22000`.
  - All ride diffs compute to `4000`. Aggregate CPK displays `4000.000` counts/km. Pre WC displays `4004.000000`.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. iPad Air / Safari 17 / iOS 17.4]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot ID / JSON export filename]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 02: Calculation Reproducibility and IEEE 754 Precision
- **Test ID:** `CHK-OPS-02`
- **Requirement Verified:** Numerical verification of calibration mathematics against independent manual calculations without truncation or precision loss.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `src/utils/calibration.test.ts` (31 unit tests), `src/utils/calculationDefect.test.ts` (20 tests)
- **Prerequisites & Test Data:** Benchmark dataset: Course length $1000.00\text{ m}$, Ride counts: $4001, 3998, 4002, 3999$. Expected Sum: $16000$, Average: $4000.000000$, Pre CPK: $4000.000000$, Pre WC ($CPK \times 1.001$): $4004.000000$.
- **Steps:**
  1. Input benchmark readings into a new session.
  2. Compute manual expected values using an approved handheld calculator or spreadsheet.
  3. Compare application displays on Pre-Calibration and Summary screens.
- **Expected Result:**
  - Application displays match manual calculations exactly with zero truncation or rounding errors.
  - Floating point epsilon is within $1 \times 10^{-6}$.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Windows 11 / Chrome 122]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Parallel Calculation Worksheet Ref]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 03: Linked-Reading Override and Mandatory Justification
- **Test ID:** `CHK-OPS-03`
- **Requirement Verified:** Unlinking sequential counter start reading, enforcing mandatory non-empty justification string, and persisting override across reload.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-03-linked-override.spec.ts`, `src/utils/storage.test.ts`
- **Prerequisites & Test Data:** Pre-calibration rides 1 and 2 entered; Modified Ride 2 Start count: `14050`; Justification string: `"Manual counter adjustment after lane clearing maneuver"`.
- **Steps:**
  1. On Ride 2 Start, click the link icon to initiate manual override.
  2. Attempt to save the modal with an empty reason string. Observe validation error.
  3. Enter modified start reading (`14050`) and justification text. Save override.
  4. Refresh browser page to test persistence.
- **Expected Result:**
  - Saving empty reason is blocked with clear validation message.
  - After saving valid reason, Ride 2 Start unlinks from Ride 1 Finish, displaying `14050` with an "Overridden" badge.
  - Net counts and CPK recalculate immediately.
  - Reloading browser maintains overridden value, badge, and justification string in IndexedDB.
  - Audit trail logs a `reading_overridden` event with actor, from, to, and reason.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. iPad Air / Safari 17 / iOS 17.4]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot ID / Audit CSV Export Ref]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 04: Upstream Reading Changes Invalidating Dependent Reviews
- **Test ID:** `CHK-OPS-04`
- **Requirement Verified:** Review invalidation engine; upstream modifications recalculate input hash and transition signed reviews to stale/invalidated.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-04-review-invalidation.spec.ts`, `src/utils/sessionRules.test.ts`
- **Prerequisites & Test Data:** Completed pre-calibration session with Pre-Calibration review signed by operator. Upstream modification: Ride 1 Finish changed from `14000` to `14005`.
- **Steps:**
  1. In Final Review, verify Pre-Calibration review badge shows `"Reviewed"`.
  2. Navigate back to Pre-Calibration screen.
  3. Modify Ride 1 Finish reading from `14000` to `14005`.
  4. Return to Final Review screen. Inspect review status badge and finalization checklist.
- **Expected Result:**
  - Upstream modification changes the input signature hash.
  - Pre-Calibration review badge immediately transitions to `"Stale"` (or `"Invalidated"`).
  - Finalization checklist blocks locking because a required section is stale.
  - Audit log records review invalidation event.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. macOS Sonoma / Chrome 122]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot of stale badge / checklist blocker]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 05: Provisional Constant Selection and Incomplete Post-Calibration
- **Test ID:** `CHK-OPS-05`
- **Requirement Verified:** Clear provisional indication on Course Distance when post-calibration is incomplete.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-05-course-distance.spec.ts`, `e2e/e2e-06-post-calibration.spec.ts`
- **Prerequisites & Test Data:** Pre-cal complete; Course Distance readings: `distStart: 30000`, `distFinish: 70040`; Post-cal incomplete (0 rides).
- **Steps:**
  1. Navigate to Course Distance screen before entering post-cal rides.
  2. Observe constant basis indicator and warning banners.
  3. Enter Course Distance readings. Observe distance calculation.
- **Expected Result:**
  - System clearly indicates that Pre-Calibration Working Constant is applied provisionally.
  - Prominent badge displays: `"Provisional pre-cal basis"`.
  - Calculated distance displays with clear warning that final constant rule (`larger` / `average`) cannot be evaluated until post-calibration is complete.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Android Tablet / Chrome 120]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot of Course Distance Screen]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 06: Session Export, Restore, and Duplicate-Reference Conflict Resolution
- **Test ID:** `CHK-OPS-06`
- **Requirement Verified:** Full JSON backup export, re-import into IndexedDB, and automatic conflict detection prompting "Import as copy".
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-11-session-export-import.spec.ts` (Test 1), `src/utils/sessionExport.test.ts`
- **Prerequisites & Test Data:** Active session `BC-2026-002` in IndexedDB. Export file generated via UI.
- **Steps:**
  1. On Session List or Final Review, click "Export JSON Backup". Verify download.
  2. On Session List screen, click "Import Backup" and select the exported file.
  3. Observe `ImportConflictDialog`. Select "Import as copy".
- **Expected Result:**
  - Conflict dialog detects that `BC-2026-002` already exists locally.
  - Option "Import as copy" creates a new session `BC-2026-002-COPY`.
  - Both original and copy exist in the session list without mutating the original.
  - Raw readings and calculated values in copy match original exactly.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Ubuntu 22.04 / Firefox 122]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Exported JSON file / Session List Screenshot]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 07: Finalized-Session Overwrite Prevention
- **Test ID:** `CHK-OPS-07`
- **Requirement Verified:** Immutability of finalized calibration sessions; strict prohibition of overwrite in UI and storage layers.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-11-session-export-import.spec.ts` (Test 3), `src/utils/sessionExport.test.ts` (Remediation A tests)
- **Prerequisites & Test Data:** Finalized session `BC-2026-001` in IndexedDB; modified unfinalized backup payload matching `BC-2026-001`.
- **Steps:**
  1. Click "Import Backup" and upload matching backup file for `BC-2026-001`.
  2. Inspect `ImportConflictDialog`.
  3. Verify overwrite button state and alerts.
- **Expected Result:**
  - Conflict dialog renders a prominent alert: `"Finalized record protection (Overwrite Prohibited)"`.
  - "Overwrite" button is completely disabled with title `"Cannot overwrite a finalized record"`.
  - Operator can only select "Import as copy" or "Cancel".
  - Existing finalized session `BC-2026-001` remains locked, unchanged, and intact.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. iPad Air / Safari 17]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot of disabled overwrite button]`
  - **Defect Reference:** `[Phase 6.1 Finding F-02 / Phase 6.2 Remediation A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 08: Audit-History Preservation and Alteration Detection
- **Test ID:** `CHK-OPS-08`
- **Requirement Verified:** Preservation of local audit history; blocking overwrite when local audit events are missing, altered, duplicate, or diverged.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `src/utils/sessionExport.test.ts` (Remediation B tests)
- **Prerequisites & Test Data:** Active unfinalized session with local audit events; backup missing recent local events; backup with modified event actor/summary.
- **Steps:**
  1. Attempt to import backup lacking recent local audit events. Observe conflict dialog.
  2. Attempt to import backup containing altered event contents. Observe conflict dialog.
- **Expected Result:**
  - Conflict dialog displays audit protection alert showing unexported local events or altered records.
  - Overwrite button is disabled.
  - Attempting overwrite is blocked and throws an error at the storage layer.
  - Stored local audit history is completely preserved without data loss.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Windows 11 / Chrome 122]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot of audit protection warning banner]`
  - **Defect Reference:** `[Phase 6.1 Finding F-01 / Phase 6.2 Remediation B]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 09: CSV Formula-Injection Mitigation in Audit Export
- **Test ID:** `CHK-OPS-09`
- **Requirement Verified:** Spreadsheet-safe serialization of untrusted strings (`=`, `+`, `-`, `@`) in audit CSV export without altering underlying data or numbers.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `src/utils/auditExport.test.ts` (8 unit tests)
- **Prerequisites & Test Data:** Override reasons entered: `"=SUM(1,2) test reason"` and `"+2+2 test"`; genuine negative numbers (e.g. `-0.0024`).
- **Steps:**
  1. Export Audit Trail as CSV.
  2. Open CSV in raw text editor (Notepad, nano, VS Code).
  3. Open CSV in spreadsheet software (Microsoft Excel / LibreOffice Calc).
- **Expected Result:**
  - In raw text editor, formula triggers are prefixed with a single quote: `"'=SUM(1,2) test reason"`.
  - Genuine negative numbers (e.g. `-0.0024`) remain unquoted numbers without quote prefix.
  - When opened in spreadsheet software, the cells display as plain text and do NOT execute as calculations.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. macOS Sonoma / Excel 16 / Numbers 13]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Exported CSV file / Excel screenshot]`
  - **Defect Reference:** `[Phase 6.1 Finding F-04 / Phase 6.2 Remediation C]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 10: Malformed Import Rejection Without State Corruption
- **Test ID:** `CHK-OPS-10`
- **Requirement Verified:** Complete structural schema validation rejecting invalid payloads before database mutation.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `src/utils/sessionExport.test.ts` (Remediation D tests)
- **Prerequisites & Test Data:** JSON file with invalid `finalized` type (`"finalized": true`); JSON file with invalid review status (`"status": "certified"`).
- **Steps:**
  1. Attempt to import invalid finalized file via "Import Backup".
  2. Attempt to import invalid review file via "Import Backup".
- **Expected Result:**
  - Import fails with an actionable error toast (e.g., `"Import failed: 'finalized' field must be null or an object."`).
  - No records in IndexedDB are created, modified, or corrupted.
  - Application remains fully responsive.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Ubuntu 22.04 / Chrome 122]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Screenshot of Error Toast / DevTools DB Inspection]`
  - **Defect Reference:** `[Phase 6.1 Finding F-03 / Phase 6.2 Remediation D]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 11: Browser Refresh and Local Storage Recovery Drill
- **Test ID:** `CHK-OPS-11`
- **Requirement Verified:** Persistence of active session state, rides, overrides, and audit trails across browser refresh and restart.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-01-session-creation.spec.ts`, `e2e/e2e-09-storage-recovery.spec.ts`, `src/utils/storage.test.ts`
- **Prerequisites & Test Data:** Active session in progress with 4 pre-cal rides, overrides, and distance readings.
- **Steps:**
  1. Confirm autosave indicator shows `"Saved on this device"`.
  2. Force-refresh browser (`Ctrl+F5` / `Cmd+Shift+R`).
  3. Close browser completely, re-open browser, navigate back to application URL.
  4. Open in-progress session.
- **Expected Result:**
  - Application hydrates smoothly from IndexedDB without data loss.
  - All readings, overrides, reasons, review states, and audit events match pre-refresh state.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. iPad Air / Safari 17]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Post-reload hydrated screenshot]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 12: Prominent Provisional Notice Verification Across All Report Outputs
- **Test ID:** `CHK-OPS-12`
- **Requirement Verified:** Prominent display of `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION` warning on preview modal, print stylesheet, text export, and JSON export.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `src/utils/reportProvisional.test.ts` (4 unit tests), `e2e/e2e-11-session-export-import.spec.ts` (Test 2)
- **Prerequisites & Test Data:** Completed session ready for report review.
- **Steps:**
  1. Open Final Review screen and click "Preview Report".
  2. Click "Print Report" and inspect browser print layout.
  3. Click "Export Text Report" (`.txt`) and inspect downloaded file.
  4. Click "Export JSON Report" (`.json`) and inspect payload.
- **Expected Result:**
  - On-screen modal features top and bottom red warning banners with `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION`.
  - Print preview preserves banner and citations of unratified policies (MP-01 through MP-09).
  - Text export contains ASCII box warning with provisional disclaimer.
  - JSON export contains explicit `provisionalNotice` and `disclaimer` metadata fields.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Windows 11 / Chrome 122 / PDF Print Engine]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Printed PDF / Exported Text Report / Exported JSON]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 13: Keyboard Navigation and Mobile Responsive Interaction Checks
- **Test ID:** `CHK-OPS-13`
- **Requirement Verified:** Complete accessibility keyboard operability (Tab, Enter, Escape, modal focus trap) and small viewport (375 × 667 px) responsive layout.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-10-accessibility-keyboard.spec.ts` (Tests 1 & 2)
- **Prerequisites & Test Data:** Desktop workstation and physical tablet or mobile device (375 × 667 px).
- **Steps:**
  1. On desktop, navigate through the entire session workflow using `Tab`, `Shift+Tab`, `Enter`, and `Space`.
  2. Open an override modal, press `Escape`, verify modal closes and focus returns to triggering button.
  3. Switch to mobile device / viewport. Verify ride table renders readable mobile cards without clipped text or overflow.
- **Expected Result:**
  - Complete keyboard operability with visible focus indicators.
  - Modals trap focus and close on `Escape`.
  - Responsive cards render cleanly on mobile viewport without layout breakage.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. iPhone SE / Safari / iOS 17.4]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Mobile Screenshot / Screen Recording]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

### Scenario 14: Backup Verification and Disaster Recovery Drill
- **Test ID:** `CHK-OPS-14`
- **Requirement Verified:** End-to-end disaster recovery: reconstructing complete session state from external backup following local storage deletion.
- **Verification Type:** Automated + Human Field Operational
- **Automated Evidence Reference:** `e2e/e2e-09-storage-recovery.spec.ts`, `e2e/e2e-11-session-export-import.spec.ts`
- **Prerequisites & Test Data:** Disposable test session `BC-2026-DISASTER-TEST` with verified backup saved to external USB drive.
- **Steps:**
  1. On primary test device, open DevTools > Application > IndexedDB and delete `bicycle_calibration_db`.
  2. Refresh application. Verify session list shows default empty state.
  3. Insert external USB drive containing backup file.
  4. Click "Import Backup" and load the file. Inspect restored session.
- **Expected Result:**
  - Session restores completely with all historical readings, audit events, and override reasons.
  - Derived calculations are independently recomputed and confirmed with zero discrepancies.
  - Storage is repopulated in IndexedDB.
- **Human Execution Record:**
  - **Status:** `[X] Not started   [ ] In progress   [ ] Passed   [ ] Failed   [ ] Blocked   [ ] N/A`
  - **Execution Date:** `[YYYY-MM-DD]`
  - **Executor / Operator:** `[Operator Name]`
  - **Reviewer / Supervisor:** `[Supervisor Name]`
  - **Environment / Device / Browser:** `[e.g. Field Laptop / Chrome 122 / Encrypted USB]`
  - **Actual Result:** `[To be recorded during human pilot execution]`
  - **Evidence Reference:** `[Pre-wipe screenshot / Post-restore screenshot]`
  - **Defect Reference:** `[N/A]`
  - **Notes / Justification:** `[Unexecuted - awaiting physical field pilot deployment]`

---

## 3. Human Operational Evidence Summary & Pilot Sign-off

| Operational Metric | Target | Current Status |
| :--- | :---: | :---: |
| **Total Operational Scenarios:** | `14` | `14 Scenarios Defined` |
| **Automated Regression Coverage:** | `14 / 14 (100%)` | **Verified (96 Vitest / 14 Playwright passed)** |
| **Human Scenarios Executed in Field:** | `14` | `0 (Pending Human Pilot Execution)` |
| **Human Scenarios Passed:** | `14` | `0` |
| **Human Scenarios Blocked / Failed:** | `0` | `0` |
| **Operational Incidents Logged:** | `0` | `0` |

### Field Sign-off Block (To be completed upon human pilot conclusion)

- **Pilot Execution Date:** `[YYYY-MM-DD]`
- **Pilot Location / Course Reference:** `[Location Name / Course ID]`
- **Lead Operator Signature:** `___________________________________` Date: `__________`
- **Pilot Supervisor Signature:** `___________________________________` Date: `__________`
