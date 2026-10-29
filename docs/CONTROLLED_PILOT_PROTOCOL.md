# Controlled Pilot Protocol: Bicycle Calibration Calculation Prototype

**Document Identifier:** `PILOT-PROT-2026-V1`  
**Application:** Bicycle Calibration Calculation — Road Course Measurement  
**Repository Working Branch:** `feature/phase-6-controlled-pilot`  
**Prerequisite Reference:** Phase 6.2 Critical Remediation Report (`docs/PHASE_6_2_CRITICAL_REMEDIATION_REPORT.md`)  
**Standard Status:** Unratified / Working Specification `ws-0.3` (Provisional Only)  
**Classification:** Operational Governance & Field Pilot Protocol  

---

## 1. Scope, Purpose, and Authorization

### 1.1. Purpose of the Supervised Pilot
The primary purpose of the controlled pilot is to evaluate the operational ergonomics, user interface clarity, sequential reading workflow, linked-reading override mechanisms, and offline reliability of the Bicycle Calibration Calculation prototype under strictly supervised, non-binding test conditions.

The pilot is designed to gather real-world operator feedback without exposing athletic events, race directors, or governing bodies to unratified calculation rules.

### 1.2. Explicitly Permitted Activities
Participating operators are strictly permitted to perform the following activities:
1. Entering calibration course setup parameters on designated test courses.
2. Recording four-ride pre-calibration and post-calibration counter readings.
3. Exercising sequential counter auto-linking and documenting manual unlinking overrides with legitimate justifications.
4. Recording road course measurement readings to observe distance computation.
5. Reviewing automated calculation results, consistency warnings, and discrepancy alerts.
6. Exporting and restoring offline session backups (`.json`) and audit logs (`.csv` / `.json`).
7. Generating printable report previews marked with mandatory provisional disclaimers.

### 1.3. Strictly Prohibited Activities
1. **NO Official Course Certification:** Under no circumstances may any output, report, PDF, printout, or calculation produced by this prototype be submitted, published, or relied upon as an official road race certification or course measurement certificate.
2. **NO Primary Source of Truth:** Operators must maintain parallel paper measurement logs or official calibration sheets during all pilot sessions.
3. **NO Production Reliance:** Do not use the application for commercial road events, championship races, or record-eligible competitions until the relevant governing athletics standard is formally ratified.
4. **NO Disabling Safeguards:** Operators must not attempt to modify client code, browser storage, or exported files to bypass finalization blockers or suppress provisional notices.

### 1.4. Pilot Authorization & Roles
- **Pilot Supervisor (To be appointed by Project Owner):**
  - Name: `[To be designated by Project Owner]`
  - Responsibility: Overall supervisory authority, session oversight, evidence custody, incident triage, and stop-work decisions.
- **Participating Operators (To be appointed by Project Owner):**
  - Names: `[To be designated by Project Owner]`
  - Responsibility: Execution of measurement steps, parallel manual record logging, backup generation, and issue reporting.
- **Governing Body Disclaimer:**
  - This protocol does **not** convey endorsement, sanction, or accreditation by World Athletics, AIMS, USATF, or any other governing measurement authority. No developer or pilot participant possesses authority to ratify official measurement policies.

### 1.5. Mandatory Policy Acknowledgment
Before participating in any pilot activity, every operator and supervisor must acknowledge:
- Measurement Policy Decisions MP-01 through MP-09 remain **unratified** and open.
- Calibration course length boundaries, ride-consistency tolerances, counter rollover wrapping, final constant selection rules ('larger' vs 'average'), and pre/post comparison tolerances are provisional approximations based on draft working specification `ws-0.3`.
- The application will strictly flag all calculations and final reports with:
  `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION`.

---

## 2. Operating Environment and Hardware Requirements

### 2.1. Supported Devices and Browsers
- **Hardware Tier:**
  - Field Tablet: iOS iPad (Safari 17+) or Android Tablet (Chrome 120+).
  - Laptop / Desktop Workstation: Windows 10/11, macOS 13+, or Ubuntu 22.04+ running modern Chromium (Chrome/Edge 120+) or Firefox (120+).
- **Minimum Display Resolution:** 375 × 667 px (mobile portrait), with optimal experience at 1024 × 768 px or greater.
- **Storage Prerequisite:** HTML5 IndexedDB enabled and unconstrained by private/incognito ephemeral mode.

### 2.2. Offline Operation Procedure
1. The application must be loaded into the browser while network connectivity is available (or hosted locally via a local dev server).
2. Once loaded, the browser service worker and local client cache maintain offline operability.
3. Field operations are conducted entirely in offline mode. No external network requests are attempted or required during data entry.
4. Data is persisted locally to browser IndexedDB after every field change or ride entry.

---

## 3. Test Data, Validation, and Arithmetic Verification

### 3.1. Reference Test Cases
Field evaluations must include both synthetic benchmark test cases and parallel real-world calibration rides:
1. **Nominal 1000m Asphalt Test Case:** 4 uniform pre-cal rides, constant counter delta, nominal post-cal rides within 0.05% variation.
2. **Rollover Wrap Test Case:** Counter readings crossing maximum mechanical capacity (e.g., 5-digit counter wrapping from 99950 to 00450) to evaluate rollover mode handling.
3. **Linked Override Test Case:** Mechanical counter zeroing or reset between rides 2 and 3 requiring manual unlinking and recorded justification.
4. **Discrepancy Test Case:** Pre-calculated test sessions with known intentional calculation deltas to verify that `detectDerivedDiscrepancies()` flags discrepancies and invalidates review signatures.

### 3.2. Arithmetic Verification vs. Policy Approval
- **Arithmetic Verification:** Confirming that the code correctly computes:
  $$C_{avg} = \frac{\sum d_i}{4}$$
  $$CPK = \frac{C_{avg}}{L_m / 1000}$$
  $$WC = CPK \times 1.001$$
  $$\text{Distance} = \frac{T}{WC_{applicable}}$$
  using IEEE 754 double precision without rounding truncation errors.
- **Policy Separation:** Verification of mathematical accuracy does **not** imply that the $1.001$ safety factor or the 4-ride average method is approved for race certification under unresolved policies MP-01 through MP-09.

### 3.3. Logging Requirements
For every test session, operators must document:
- Software version and git commit identifier.
- Operating system and browser version.
- Raw start and finish readings from physical Jones Counter.
- Independent manual calculations (using an approved handheld calculator or spreadsheet).
- Application-computed CPK, Working Constant, Course Distance, and difference values.
- Any warning banners, validation blocks, or discrepancy flags displayed.

---

## 4. Data Handling, Backups, and Recovery

### 4.1. Mandatory Export Schedule
Operators must export session backups (`.json`) at the following milestones:
1. **Initial Setup Completion:** Immediately after course length, surface, and rules are configured.
2. **Pre-Calibration Completion:** Immediately after all 4 pre-calibration rides are entered and reviewed.
3. **Course Distance Completion:** Immediately after course measurement readings are recorded.
4. **Post-Calibration Completion:** Immediately after all 4 post-calibration rides are entered.
5. **Session Finalization:** Immediately prior to and immediately after locking the finalized record.

### 4.2. Verification of Exported Backups
Before relying on an exported `.json` file for recovery:
- The operator must verify that the file size is non-zero and valid JSON.
- For high-consequence test sessions, the backup must be verified by importing it as a separate copy (`-COPY`) on a secondary pilot device to confirm schema validity and calculation reproducibility.

### 4.3. Backup Storage and Retention
- Backups must be stored on encrypted removable storage (e.g., encrypted USB drive) or a secure designated local folder.
- Backup files must not be uploaded to unapproved public cloud storage.
- File naming convention: `[SessionRef]_[YYYYMMDD_HHMM]_[Milestone].json` (e.g. `BC-2026-001_20261029_1430_postcal.json`).

### 4.4. Prohibitions and Data Integrity Rules
- **Finalized Overwrite Prohibition:** Finalized records cannot be overwritten. If a backup is imported that matches a finalized session, it must only be imported as a separate copy.
- **Audit Preservation:** If an existing local session contains audit events or edits absent from an incoming backup, overwrite is blocked. Overwrite is permitted only when the backup contains all local audit events in identical canonical form.
- **Local Audit Limitations:** The local audit trail is client-side and tamper-evident, but is not cryptographically signed. It must not be presented as legal proof of non-tampering.

### 4.5. Device Loss or Browser Storage Failure
If a browser crashes, storage is cleared, or a device fails:
1. Secure the replacement device and verify supported browser version.
2. Open the prototype and verify IndexedDB hydration.
3. Locate the latest verified milestone backup file (`.json`).
4. Execute "Import Backup" from the Session List screen.
5. Inspect the imported session to verify raw readings, override justifications, review status, and recomputed calculations.
6. Compare the recomputed values with the parallel paper log.
7. Record the recovery event in the test log with operator signature.

---

## 5. Incident Management and Stop-Work Criteria

### 5.1. Mandatory Stop-Work Triggers
The pilot supervisor and operators must **immediately halt the pilot session** and notify the Project Owner if any of the following occur:
1. **Finalization Breach:** A finalized session is overwritten, mutated, or unlocked without authorization.
2. **Audit History Loss:** Stored local audit events are silently discarded, truncated, or modified upon import.
3. **Calculation Discrepancy:** The application calculation engine produces a numerical result that differs from independently verified arithmetic for the same inputs by more than $1 \times 10^{-6}$.
4. **Missing Provisional Notice:** Any screen, summary card, printable preview, text export, or JSON report omits the required `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION` notice.
5. **Validation Bypass:** An invalid or malformed import payload corrupts storage, clears mandatory fields, or bypasses checklist blockers.
6. **Data Corruption:** Stored sessions fail to hydrate from IndexedDB, or data fields change without operator action.
7. **Certification Confusion:** Any race official, measurer, or participant treats prototype calculations as official race certification.

### 5.2. Evidence Preservation Procedure Upon Stop-Work
When stop-work is triggered:
1. Do not clear browser cache, refresh the page, or close the browser tab until state is documented.
2. Take full-page browser screenshots of all relevant screens (Setup, Pre-Cal, Distance, Post-Cal, Review, Audit Trail).
3. Export the current session JSON backup and audit CSV export if the export functions remain operational.
4. Export browser console logs (`Inspect > Console > Save as...`).
5. Document physical counter readings, timestamps, and exact operator actions leading up to the incident.
6. Quarantine the device until inspected by the pilot supervisor.

### 5.3. Resumption Authority
- Resumption of a halted pilot may **only** be authorized in writing by the designated Pilot Supervisor after root-cause identification and remediation.
- A software developer or measurer cannot unilaterally authorize pilot resumption.
