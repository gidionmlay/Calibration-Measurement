# Session Export and Backup Format Specification

**Format Identifier:** `CALIBRATION_SESSION_EXPORT_V1`  
**Current Schema Version:** `1`  
**Standard Status:** Controlled-Pilot Provisional Specification (Workstream A)  
**Governing Standard Reference:** Unratified / Working Specification `ws-0.3`  

---

## 1. Executive Summary

This document specifies the format, validation rules, conflict resolution semantics, and calculation integrity checks for the local-first bicycle calibration session export and backup file format (`.json`).

The primary purpose of this format is:
1. Enabling secure, offline backups of measurement session data stored in browser IndexedDB.
2. Preserving the exact historical integrity of raw readings, user-entered values, linked-start overrides, override justifications, review status, policy approval decisions, and audit-event logs.
3. Enabling cross-device and offline session transport without reliance on network connectivity.
4. Enforcing an untrusted-data boundary upon import: all imported derived values (CPK, Working Constants, Course Distance, ride differences) are strictly recomputed from raw inputs using the vetted calculation engine, flagging discrepancies rather than blindly trusting imported calculations.

---

## 2. File Identification and Structure

Session exports are formatted as single, self-contained JSON objects encoded in UTF-8.

### Top-Level Envelope Structure

| Property | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | `integer` | Yes | Must equal `1` for the current format. Unsupported versions are rejected. |
| `formatIdentifier` | `string` | Yes | Constant string: `"CALIBRATION_SESSION_EXPORT_V1"`. |
| `exportedAt` | `string` (ISO 8601) | Yes | UTC timestamp recording when the export file was generated. |
| `exportedBy` | `string` | Yes | Operator username or identifier who initiated the export. |
| `application` | `object` | Yes | Metadata identifying application name (`"Bicycle Calibration Calculation"`), version (`"0.0.1"`), and working specification (`"ws-0.3"`). |
| `session` | `object` | Yes | Complete calibration session record payload (see Section 3). |

---

## 3. Session Payload Schema (`session`)

The `session` object maps directly to the local application session model, preserving original inputs and non-mutated historical data.

### 3.1. Session Core Attributes

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` (UUID) | Stable local session identifier. |
| `reference` | `string` | Human-readable measurement reference identifier (e.g. `BC-2026-003`). |
| `operator` | `string` | Primary surveyor/measurer identifier. |
| `date` | `string` | Session creation date in `YYYY-MM-DD` format. |
| `status` | `string` | Current session lifecycle state: `'draft'`, `'in_progress'`, `'completed'`, `'flagged'`. |
| `syncStatus` | `string` | Local device synchronization status: `'synced'`, `'pending'`, `'conflict'`, `'error'`. |
| `provisional` | `boolean` | Always `true` while measurement policy decisions remain unratified. |

### 3.2. Setup Configuration (`setup`)

Preserves user-entered calibration course parameters and calculation policies:
- `courseLength`: Course length string entered by user (in metres, strictly positive numeric string).
- `surface`: Course surface description (e.g. `'Asphalt'`, `'Concrete'`).
- `temperature`: Temperature string during calibration (in °C).
- `rolloverMode`: Counter overflow handling policy: `'notConfigured'`, `'none'`, `'wrap'`.
- `rolloverMax`: Maximum counter capacity integer if rollover is active.
- `ruleSetVersion`: Identifier of the rule-set applied (e.g. `'ws-0.3'`).
- `finalConstantRule`: Method for selecting final working constant: `'larger'`, `'average'`, `'notConfigured'`.
- `policyApproved`: Explicit boolean indicating whether unratified policies were acknowledged by the operator.
- `policyApprovedAt`: Optional ISO timestamp of policy approval.
- `policyApprovedBy`: Optional operator identifier of policy approver.

### 3.3. Ride Readings (`pre` and `post`)

Both `pre` and `post` calibration arrays contain 4 ride objects. Each ride object records:
- `ride`: Ride sequence number (`1`, `2`, `3`, `4`).
- `start`: Active start counter reading string.
- `finish`: Active finish counter reading string.
- `startRaw`: Counter reading as entered before any linked-reading logic.
- `startOverridden`: Boolean indicating whether sequential counter auto-linking was manually unlinked.
- `overrideReason`: Mandatory justification string when `startOverridden` is `true`.
- `diff`: Net count difference (`finish - start` or wrapped count).
- `cpk`: Derived counts per kilometre for the ride.
- `wc`: Derived working constant for the ride ($CPK \times 1.001$).

### 3.4. Course Distance Readings (`distance`)

Records the actual measurement ride across the calibrated road course:
- `start`: Start counter reading string.
- `finish`: Finish counter reading string.
- `diff`: Net counts for the course ride.
- `calculatedDistance`: Derived distance in metres ($diff / WC_{applicable}$).
- `targetDistance`: Optional expected course distance in metres.
- `constantUsed`: Working constant selected for distance calculation.
- `constantBasis`: Method applied (`'pre-calibration-only'`, `'final-larger'`, `'final-average'`).

### 3.5. Derived Results (`derived`)

Derived calculation summary included for reference and discrepancy detection:
- `preCpk`: Average CPK across 4 pre-calibration rides.
- `preWc`: Pre-calibration Working Constant ($preCpk \times 1.001$).
- `postCpk`: Average CPK across 4 post-calibration rides (if complete).
- `postWc`: Post-calibration Working Constant ($postCpk \times 1.001$).
- `diff`: Signed difference between post and pre working constants.
- `diffPercent`: Percentage change ($((PostWC - PreWC) / PreWC) \times 100$).
- `finalConstant`: Working constant selected by final constant rule.
- `finalConstantRule`: Selection rule utilized.
- `status`: Derived status badge (`'provisional'`, `'pre-only'`, `'complete'`).

### 3.6. Audit Trail (`auditTrail`)

Chronological array of all audit events recorded for the session. Every entry preserves:
- `id`: Unique event identifier.
- `timestamp`: ISO 8601 UTC timestamp.
- `eventType`: Event category (`'session_created'`, `'field_changed'`, `'reading_overridden'`, `'status_changed'`, `'policy_approved'`, etc.).
- `field`: Affected property or path.
- `oldValue`: Value prior to change (null if newly created).
- `newValue`: Value resulting from change.
- `reason`: Justification for override or critical edit.
- `actor`: Operator identity.

### 3.7. Review and Finalization State

- `review`: Review status object containing `status` (`'pending'`, `'in_review'`, `'reviewed'`, `'stale'`), `reviewedAt`, `reviewedBy`, `inputSignature`, and `notes`.
- `finalized`: Lock object containing `at` (ISO timestamp) and `by` (operator) if finalized; `null` if unfinalized.

---

## 4. Import Validation and Security Gates

When an operator uploads a JSON file for import, the application executes multi-stage validation before permitting any write to IndexedDB:

### Step 1: JSON Syntax & Structure
The file must parse as valid JSON. Root must be a non-null object containing `formatIdentifier`, `schemaVersion`, and `session`.

### Step 2: Schema Compatibility
`formatIdentifier` must strictly equal `"CALIBRATION_SESSION_EXPORT_V1"`.  
`schemaVersion` must equal `1`. Unsupported schema versions trigger an actionable error message (`"Unsupported schema version: X. Supported version is 1."`).

### Step 3: Required Fields & Type Checks
The `session` payload must contain valid `id`, `reference`, `operator`, `date`, `status`, `setup`, `pre`, and `distance` objects.  
- `pre` and `post` must be arrays containing exactly 4 ride items each.
- `finalized` must be either explicitly `null` (unfinalized session) or an object conforming to `{ at: string (ISO 8601), by: string (non-empty) }`. Malformed primitive values, arrays, missing timestamps, or missing actor fields are strictly rejected.
- `reviews` (if present) must be a dictionary object where values adhere to valid `ReviewRecord` structures with supported `status` enums (`'pending'`, `'in_review'`, `'reviewed'`, `'stale'`).
- `acknowledgements` (if present) must be an array of string identifiers.
- `createdAt` and `updatedAt` (if present) must be valid ISO 8601 strings.

### Step 4: Non-Mutation of Original Historical Inputs
Raw counts (`startRaw`, `start`, `finish`), override states (`startOverridden`), override justifications (`overrideReason`), and audit records are restored verbatim. They are never altered, normalized, or overwritten by recalculated values during import.

---

## 5. Conflict Resolution Strategy

To guarantee that local data is never silently overwritten or destroyed:

1. **Identifier Matching:** The system checks whether the imported session's `id` or `reference` already exists in the local IndexedDB database.
2. **Pre-Resolution Safety Checks:**
   - **Finalized Session Protection:** If the existing local session is finalized (`finalized !== null`), overwrite is strictly prohibited. The overwrite option in `ImportConflictDialog` is disabled and explains the blocker. Furthermore, the underlying import functions (`prepareImportedSession` and `importSessionPayload`) enforce this check and throw an error if an overwrite of a finalized session is attempted.
   - **Local Audit Loss Prevention:** The system executes `detectLocalAuditLoss(existingSession, backupSession)` to determine whether the existing local session contains audit events absent from the backup. If local audit events would be lost, overwrite is blocked and disabled, and the dialog clearly displays the count of unexported local audit events at risk.
3. **Interactive Conflict Dialog:** If a conflict is discovered, import pauses and presents the operator with the `ImportConflictDialog`:
   - **Option A: Import as separate copy (Default & Only Permitted Option when Finalized or Local Audit Loss Detected)**:
     - The imported session is assigned a fresh local UUID.
     - Its reference identifier is amended with a `-COPY` suffix (or `-COPY-1`, `-COPY-2` if `-COPY` exists).
     - The original reference is retained in an audit record documenting the import event.
     - The existing local session remains completely untouched.
   - **Option B: Explicit Overwrite (Safe Overwrite Only)**:
     - Permitted ONLY when the existing session is unfinalized AND the backup session contains all existing local audit trail events.
     - Requires conscious operator selection.
     - Overwrites the existing local record with the imported data.
     - Appends an audit event to the imported record documenting the local overwrite operation and recording source backup metadata (`exportedAt`, `exportedBy`).
   - **Option C: Cancel**:
     - Aborts the import process without modifying storage.

---

## 6. Derived Calculation Integrity Gate

**Core Principle:** Imported derived calculations are treated as untrusted data.

Upon successful schema validation, the calculation engine (`recalculateSession`) independently executes full IEEE 754 recomputation across all rides, CPK values, working constants, course distances, and pre/post differences using the imported raw readings and setup rules.

The system then executes `detectDerivedDiscrepancies(session, recalculated)`:
- Compares each ride CPK and WC against recalculated values.
- Compares aggregate pre-cal and post-cal CPK and WC.
- Compares course distance calculation and applicable constant.
- Tolerance threshold: `1e-6` floating-point epsilon.

If any discrepancy is detected:
- The session is flagged with an audit event (`'derived_discrepancy_detected'`).
- The imported session's review state is reset to `'stale'`, requiring operator review.
- The discrepancy details are preserved in the audit log for inspection.

---

## 7. Review and Finalization Blockers

Imported sessions **never bypass finalization blockers**:
1. If the imported session is finalized, but references unratified policies (`ws-0.3`, unapproved final constant rules, or unapproved rollover rules), the finalization lock is preserved as historical data, but all printable and exportable reports continue to display prominent `PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION` notices.
2. An unfinalized imported session cannot be finalized if any mandatory checklist item fails, including the governing measurement policy blocker (MP-01 through MP-09).
3. If raw readings or setup parameters do not match downstream review signatures, the session review status is set to `'stale'`, requiring explicit re-review.

---

## 8. Offline Reliability

The export and import workflows are fully client-side:
- Data is converted to and parsed from JSON directly in browser memory.
- File downloading uses client-generated Blob URLs (`URL.createObjectURL(blob)`).
- File reading uses the standard HTML5 `FileReader` API.
- All operations succeed in complete isolation without network or external server access.
