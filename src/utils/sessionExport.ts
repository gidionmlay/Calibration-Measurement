import type {
  AuditEntry,
  ConsistencyRule,
  FinalConstantRule,
  RideInput,
  RolloverMode,
  RuleSetVersion,
  SessionData,
  SessionState,
} from '../types/session';
import {
  ENGINE_VERSION,
  type ConstantBasis,
} from './calibration';
import { deriveSession, type Derived } from './sessionRules';
import { makeEntry } from './audit';

export const CURRENT_EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT_IDENTIFIER = 'bicycle-calibration-session-export';

export interface DerivedSnapshot {
  preWC: number | null;
  postWC: number | null;
  finalConstant: number | null;
  distanceKm: number | null;
  applicableConstant: number | null;
  constantBasis: ConstantBasis;
  state: SessionState;
}

export interface SessionExportPayload {
  format: typeof EXPORT_FORMAT_IDENTIFIER;
  schemaVersion: number;
  exportedAt: string;
  application: {
    name: string;
    engineVersion: string;
    ruleSet: RuleSetVersion;
    provisionalNotice: string;
    disclaimer: string;
  };
  session: SessionData;
  derivedSnapshot: DerivedSnapshot;
  integrity: {
    auditEventsCount: number;
    hasOverrides: boolean;
  };
}

export interface ValidationSuccess {
  valid: true;
  payload: SessionExportPayload;
}

export interface ValidationFailure {
  valid: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Serializes a session into a structured, validated backup payload.
 * Original user-entered values and audit events are strictly preserved.
 */
export function exportSessionToJSON(session: SessionData, derived?: Derived | null): string {
  const d = derived ?? deriveSession(session, 'online');
  const hasOverrides =
    session.pre.some((r) => r.startOverridden) || session.post.some((r) => r.startOverridden);

  const payload: SessionExportPayload = {
    format: EXPORT_FORMAT_IDENTIFIER,
    schemaVersion: CURRENT_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    application: {
      name: 'Bicycle Calibration Calculation',
      engineVersion: ENGINE_VERSION,
      ruleSet: session.ruleSet,
      provisionalNotice: 'PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION',
      disclaimer:
        'Measurement standard and rules are unratified. Stored results are provisional and not valid for official race certification.',
    },
    // Deep clone to guarantee non-mutation of session state
    session: JSON.parse(JSON.stringify(session)) as SessionData,
    derivedSnapshot: {
      preWC: d.pre.wc,
      postWC: d.post.wc,
      finalConstant: d.finalConstant,
      distanceKm: d.distance.km,
      applicableConstant: d.distance.wc,
      constantBasis: d.distance.basis,
      state: d.state,
    },
    integrity: {
      auditEventsCount: session.audit.length,
      hasOverrides,
    },
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Validates the file structure, schema version, field types, and required properties of an imported session JSON string.
 */
export function validateSessionImport(rawJson: string): ValidationResult {
  if (typeof rawJson !== 'string' || rawJson.trim() === '') {
    return { valid: false, error: 'Import failed: The selected file is empty.' };
  }

  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch (e) {
    return {
      valid: false,
      error: 'Import failed: Invalid JSON syntax. The file could not be parsed.',
    };
  }

  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Import failed: File content is not a valid JSON object.' };
  }

  const obj = data as Record<string, unknown>;

  if (obj.format !== EXPORT_FORMAT_IDENTIFIER) {
    return {
      valid: false,
      error: `Import failed: Unrecognized file format "${String(obj.format ?? 'unknown')}". Expected "${EXPORT_FORMAT_IDENTIFIER}".`,
    };
  }

  if (typeof obj.schemaVersion !== 'number') {
    return {
      valid: false,
      error: 'Import failed: Missing or invalid schema version.',
    };
  }

  if (obj.schemaVersion !== CURRENT_EXPORT_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Import failed: Unsupported schema version ${obj.schemaVersion}. This software supports schema version ${CURRENT_EXPORT_SCHEMA_VERSION}.`,
    };
  }

  if (!obj.session || typeof obj.session !== 'object') {
    return {
      valid: false,
      error: 'Import failed: Missing session payload in export file.',
    };
  }

  const s = obj.session as Record<string, unknown>;

  // Check required core properties
  if (typeof s.reference !== 'string' || s.reference.trim() === '') {
    return { valid: false, error: 'Import failed: Session reference is missing or empty.' };
  }

  if (typeof s.operator !== 'string') {
    return { valid: false, error: 'Import failed: Operator is missing or invalid.' };
  }

  if (typeof s.courseLength !== 'string') {
    return { valid: false, error: 'Import failed: Course length is missing or invalid.' };
  }

  const validRolloverModes: RolloverMode[] = ['notConfigured', 'none', 'wrap'];
  if (typeof s.rolloverMode !== 'string' || !validRolloverModes.includes(s.rolloverMode as RolloverMode)) {
    return { valid: false, error: `Import failed: Invalid rollover mode "${String(s.rolloverMode)}".` };
  }

  const validFinalRules: FinalConstantRule[] = ['notConfigured', 'larger', 'average'];
  if (typeof s.finalRule !== 'string' || !validFinalRules.includes(s.finalRule as FinalConstantRule)) {
    return { valid: false, error: `Import failed: Invalid final constant rule "${String(s.finalRule)}".` };
  }

  const validRuleSets: RuleSetVersion[] = ['notConfigured', 'ws-0.3'];
  if (typeof s.ruleSet !== 'string' || !validRuleSets.includes(s.ruleSet as RuleSetVersion)) {
    return { valid: false, error: `Import failed: Invalid rule set version "${String(s.ruleSet)}".` };
  }

  const validConsistencyRules: ConsistencyRule[] = ['notConfigured', 'pending'];
  if (typeof s.consistencyRule !== 'string' || !validConsistencyRules.includes(s.consistencyRule as ConsistencyRule)) {
    return { valid: false, error: `Import failed: Invalid consistency rule "${String(s.consistencyRule)}".` };
  }

  // Check ride arrays
  if (!Array.isArray(s.pre) || s.pre.length !== 4) {
    return { valid: false, error: 'Import failed: Pre-calibration must contain exactly 4 ride entries.' };
  }

  for (let i = 0; i < s.pre.length; i++) {
    const r = s.pre[i] as Partial<RideInput>;
    if (
      !r ||
      typeof r.start !== 'string' ||
      typeof r.finish !== 'string' ||
      typeof r.startOverridden !== 'boolean' ||
      typeof r.overrideReason !== 'string'
    ) {
      return { valid: false, error: `Import failed: Pre-calibration ride ${i + 1} has invalid structure.` };
    }
  }

  if (!Array.isArray(s.post) || s.post.length !== 4) {
    return { valid: false, error: 'Import failed: Post-calibration must contain exactly 4 ride entries.' };
  }

  for (let i = 0; i < s.post.length; i++) {
    const r = s.post[i] as Partial<RideInput>;
    if (
      !r ||
      typeof r.start !== 'string' ||
      typeof r.finish !== 'string' ||
      typeof r.startOverridden !== 'boolean' ||
      typeof r.overrideReason !== 'string'
    ) {
      return { valid: false, error: `Import failed: Post-calibration ride ${i + 1} has invalid structure.` };
    }
  }

  if (typeof s.distStart !== 'string' || typeof s.distFinish !== 'string') {
    return { valid: false, error: 'Import failed: Course distance readings are missing or invalid.' };
  }

  // Validate timestamps
  if (typeof s.createdAt !== 'string' || isNaN(Date.parse(s.createdAt))) {
    return { valid: false, error: 'Import failed: Session missing or invalid "createdAt" timestamp.' };
  }
  if (typeof s.updatedAt !== 'string' || isNaN(Date.parse(s.updatedAt))) {
    return { valid: false, error: 'Import failed: Session missing or invalid "updatedAt" timestamp.' };
  }

  // Validate finalized structure
  if (s.finalized !== null && s.finalized !== undefined) {
    if (typeof s.finalized !== 'object' || Array.isArray(s.finalized)) {
      return { valid: false, error: 'Import failed: "finalized" field must be null or an object.' };
    }
    const fin = s.finalized as Record<string, unknown>;
    if (typeof fin.at !== 'string' || fin.at.trim() === '' || isNaN(Date.parse(fin.at))) {
      return { valid: false, error: 'Import failed: Finalized record missing or invalid "at" timestamp.' };
    }
    if (typeof fin.by !== 'string' || fin.by.trim() === '') {
      return { valid: false, error: 'Import failed: Finalized record missing or invalid "by" operator name.' };
    }
  } else if (s.finalized === undefined) {
    return { valid: false, error: 'Import failed: Missing "finalized" property (expected null or object).' };
  }

  // Validate reviews structure
  if (s.reviews !== undefined && s.reviews !== null) {
    if (typeof s.reviews !== 'object' || Array.isArray(s.reviews)) {
      return { valid: false, error: 'Import failed: "reviews" must be an object.' };
    }
    const revs = s.reviews as Record<string, unknown>;
    const allowedReviewKeys = ['pre', 'distance', 'comparison'];
    for (const [k, v] of Object.entries(revs)) {
      if (!allowedReviewKeys.includes(k)) {
        return { valid: false, error: `Import failed: Unsupported review key "${k}".` };
      }
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { valid: false, error: `Import failed: Review entry for "${k}" must be an object.` };
      }
      const rRecord = v as Record<string, unknown>;
      if (typeof rRecord.signature !== 'string' || rRecord.signature.trim() === '') {
        return { valid: false, error: `Import failed: Review entry for "${k}" is missing a valid signature.` };
      }
      if (typeof rRecord.at !== 'string' || rRecord.at.trim() === '' || isNaN(Date.parse(rRecord.at))) {
        return { valid: false, error: `Import failed: Review entry for "${k}" has an invalid timestamp.` };
      }
      if (rRecord.invalidationLogged !== undefined && typeof rRecord.invalidationLogged !== 'boolean') {
        return { valid: false, error: `Import failed: Review entry for "${k}" has invalid "invalidationLogged" flag.` };
      }
    }
  }

  // Validate acknowledgements structure
  if (s.acknowledgements !== undefined && s.acknowledgements !== null) {
    if (typeof s.acknowledgements !== 'object' || Array.isArray(s.acknowledgements)) {
      return { valid: false, error: 'Import failed: "acknowledgements" must be an object.' };
    }
    const acks = s.acknowledgements as Record<string, unknown>;
    for (const [k, v] of Object.entries(acks)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { valid: false, error: `Import failed: Acknowledgement entry for "${k}" must be an object.` };
      }
      const aRecord = v as Record<string, unknown>;
      if (typeof aRecord.signature !== 'string' || aRecord.signature.trim() === '') {
        return { valid: false, error: `Import failed: Acknowledgement for "${k}" is missing a valid signature.` };
      }
      if (typeof aRecord.at !== 'string' || aRecord.at.trim() === '' || isNaN(Date.parse(aRecord.at))) {
        return { valid: false, error: `Import failed: Acknowledgement for "${k}" has an invalid timestamp.` };
      }
    }
  }

  // Check audit history
  if (!Array.isArray(s.audit)) {
    return { valid: false, error: 'Import failed: Session audit history is missing or not an array.' };
  }

  for (let i = 0; i < s.audit.length; i++) {
    const e = s.audit[i] as Record<string, unknown>;
    if (!e || typeof e.id !== 'string' || typeof e.at !== 'string' || typeof e.actor !== 'string' || typeof e.kind !== 'string' || typeof e.summary !== 'string') {
      return { valid: false, error: `Import failed: Audit entry ${i + 1} is missing required fields.` };
    }
  }

  return {
    valid: true,
    payload: data as SessionExportPayload,
  };
}

/**
 * Recomputes derived results using the authoritative calculation engine and compares them against any included derived values.
 * Returns an array of descriptive discrepancy messages if differences are detected.
 */
export function detectDerivedDiscrepancies(
  payload: SessionExportPayload,
  recomputed: Derived
): string[] {
  const discrepancies: string[] = [];
  const snapshot = payload.derivedSnapshot;
  if (!snapshot) return discrepancies;

  const EPSILON = 1e-6;

  const compareNums = (label: string, exportedVal: number | null | undefined, recomputedVal: number | null | undefined, unit = '') => {
    if (exportedVal === undefined) return;
    if (exportedVal === null && recomputedVal === null) return;
    if (exportedVal === null && recomputedVal !== null) {
      discrepancies.push(`${label}: Exported file had no value (null), but calculation engine computed ${recomputedVal}${unit}.`);
      return;
    }
    if (exportedVal !== null && recomputedVal === null) {
      discrepancies.push(`${label}: Exported file recorded ${exportedVal}${unit}, but calculation engine determined it cannot be computed from raw readings.`);
      return;
    }
    if (
      exportedVal !== null &&
      exportedVal !== undefined &&
      recomputedVal !== null &&
      recomputedVal !== undefined
    ) {
      if (Math.abs(exportedVal - recomputedVal) > EPSILON) {
        discrepancies.push(
          `${label} discrepancy: Exported file recorded ${exportedVal}${unit}, but recomputed value is ${recomputedVal}${unit}. Recomputed value governs.`
        );
      }
    }
  };

  compareNums('Pre-calibration Working Constant', snapshot.preWC, recomputed.pre.wc);
  compareNums('Post-calibration Working Constant', snapshot.postWC, recomputed.post.wc);
  compareNums('Final Constant', snapshot.finalConstant, recomputed.finalConstant);
  compareNums('Course Distance', snapshot.distanceKm, recomputed.distance.km, ' km');
  compareNums('Applicable Working Constant', snapshot.applicableConstant, recomputed.distance.wc);

  return discrepancies;
}

/**
 * Generates an incremented or copy reference for duplicate session resolution.
 */
export function generateCopyReference(originalRef: string, existingSessions: SessionData[]): string {
  const base = originalRef.trim();
  const existingRefs = new Set(existingSessions.map((s) => s.reference.toLowerCase()));

  // Attempt pattern: BC-YYYY-NNN-COPY or similar
  let copyRef = `${base}-COPY`;
  let counter = 1;
  while (existingRefs.has(copyRef.toLowerCase())) {
    counter++;
    copyRef = `${base}-COPY-${counter}`;
  }
  return copyRef;
}

export interface AuditLossCheck {
  hasLoss: boolean;
  missingEventsCount: number;
  reason?: string;
  hasAlteredEvents?: boolean;
  hasDuplicateIds?: boolean;
}

function normalizeAuditField(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  return String(val);
}

/**
 * Computes canonical content serialization for an audit entry.
 * Normalizes undefined/null fields and stringifies all core audit properties.
 */
export function canonicalAuditContent(entry: Partial<AuditEntry>): string {
  return JSON.stringify({
    id: entry.id ?? '',
    at: entry.at ?? '',
    actor: entry.actor ?? '',
    kind: entry.kind ?? '',
    summary: entry.summary ?? '',
    field: normalizeAuditField(entry.field),
    from: normalizeAuditField(entry.from),
    to: normalizeAuditField(entry.to),
    reason: normalizeAuditField(entry.reason),
    note: normalizeAuditField(entry.note),
  });
}

/**
 * Checks whether an existing local session contains audit events or local edits absent from the incoming backup.
 * Used to prevent silent loss or silent alteration of local audit history on overwrite.
 *
 * Verifies:
 * 1. Absence of duplicate event IDs in local and backup audit trails.
 * 2. Complete event presence: every local audit event must be present in the backup.
 * 3. Content equivalence: matching event IDs must have identical canonical contents (timestamps, actors, kind, summary, details).
 * 4. Local edit preservation: detects whether local readings/setup were updated after the backup was created.
 */
export function detectLocalAuditLoss(
  existingSession: SessionData,
  backupSession: SessionData
): AuditLossCheck {
  const localAudit = existingSession.audit || [];
  const backupAudit = backupSession.audit || [];

  // 1. Check for duplicate IDs in local audit trail
  const seenLocalIds = new Set<string>();
  for (const e of localAudit) {
    if (seenLocalIds.has(e.id)) {
      return {
        hasLoss: true,
        missingEventsCount: 0,
        hasDuplicateIds: true,
        reason: 'Local audit trail contains duplicate event IDs. Equivalence cannot be established, blocking overwrite.',
      };
    }
    seenLocalIds.add(e.id);
  }

  // 2. Check for duplicate IDs in backup audit trail
  const backupMap = new Map<string, AuditEntry>();
  for (const e of backupAudit) {
    if (backupMap.has(e.id)) {
      return {
        hasLoss: true,
        missingEventsCount: 0,
        hasDuplicateIds: true,
        reason: 'Backup audit trail contains duplicate event IDs. Equivalence cannot be established, blocking overwrite.',
      };
    }
    backupMap.set(e.id, e);
  }

  // 3. Check for missing local events and altered event contents
  let missingCount = 0;
  let alteredCount = 0;

  for (const localEvent of localAudit) {
    const backupEvent = backupMap.get(localEvent.id);
    if (!backupEvent) {
      missingCount++;
    } else if (canonicalAuditContent(localEvent) !== canonicalAuditContent(backupEvent)) {
      alteredCount++;
    }
  }

  if (missingCount > 0) {
    return {
      hasLoss: true,
      missingEventsCount: missingCount,
      reason: `Local session contains ${missingCount} audit event(s) not present in the backup file. Overwrite is blocked to prevent silent audit history loss.`,
    };
  }

  if (alteredCount > 0) {
    return {
      hasLoss: true,
      missingEventsCount: alteredCount,
      hasAlteredEvents: true,
      reason: `Local session contains ${alteredCount} audit event(s) whose content (timestamp, actor, kind, summary, or details) differs from backup records with matching IDs. Equivalence cannot be verified, blocking overwrite.`,
    };
  }

  // 4. Check for local reading or configuration edits made after backup was created
  if (existingSession.updatedAt && backupSession.updatedAt) {
    const existingTime = Date.parse(existingSession.updatedAt);
    const backupTime = Date.parse(backupSession.updatedAt);
    if (!isNaN(existingTime) && !isNaN(backupTime) && existingTime > backupTime) {
      const inputsDiffer =
        existingSession.courseLength !== backupSession.courseLength ||
        existingSession.rolloverMode !== backupSession.rolloverMode ||
        existingSession.rolloverMax !== backupSession.rolloverMax ||
        existingSession.consistencyRule !== backupSession.consistencyRule ||
        existingSession.finalRule !== backupSession.finalRule ||
        existingSession.ruleSet !== backupSession.ruleSet ||
        existingSession.distStart !== backupSession.distStart ||
        existingSession.distFinish !== backupSession.distFinish ||
        JSON.stringify(existingSession.pre) !== JSON.stringify(backupSession.pre) ||
        JSON.stringify(existingSession.post) !== JSON.stringify(backupSession.post);

      if (inputsDiffer) {
        return {
          hasLoss: true,
          missingEventsCount: 1,
          reason: 'Local session contains reading or configuration edits made after this backup was created. Overwrite is blocked to prevent losing unexported changes.',
        };
      }
    }
  }

  return { hasLoss: false, missingEventsCount: 0 };
}

export interface PreparedImport {
  session: SessionData;
  isCopy: boolean;
  originalRef: string;
  discrepancies: string[];
}

/**
 * Prepares an imported session for storage injection with conflict resolution and discrepancy logging.
 * Preserves user entered readings, overrides, reasons, and historical audit events.
 */
export function prepareImportedSession(
  payload: SessionExportPayload,
  existingSessions: SessionData[],
  conflictStrategy: 'copy' | 'overwrite',
  currentOperator = 'Import Manager'
): PreparedImport {
  const originalRef = payload.session.reference;
  const existing = existingSessions.find((s) => s.reference.toLowerCase() === originalRef.toLowerCase());
  const exists = Boolean(existing);

  if (exists && conflictStrategy === 'overwrite') {
    // 1. Guard against overwriting finalized sessions
    if (existing?.finalized) {
      throw new Error(
        `Cannot overwrite session "${originalRef}": The existing local session is finalized and locked. Overwriting finalized records is prohibited.`
      );
    }

    // 2. Guard against silent loss of local audit history
    if (existing) {
      const lossCheck = detectLocalAuditLoss(existing, payload.session);
      if (lossCheck.hasLoss) {
        throw new Error(
          `Cannot overwrite session "${originalRef}": ${lossCheck.reason || 'Local session audit loss detected.'}`
        );
      }
    }
  }

  let targetRef = originalRef;
  let isCopy = false;

  if (exists && conflictStrategy === 'copy') {
    targetRef = generateCopyReference(originalRef, existingSessions);
    isCopy = true;
  }

  // Clone session to avoid mutating payload
  const importedSession: SessionData = JSON.parse(JSON.stringify(payload.session));
  importedSession.reference = targetRef;

  // Recompute with engine
  const recomputed = deriveSession(importedSession, 'online');
  const discrepancies = detectDerivedDiscrepancies(payload, recomputed);

  // Append audit events to document import and any discrepancy
  const now = new Date().toISOString();
  const auditEntries = [...importedSession.audit];

  const importSummary = isCopy
    ? `Session imported as copy '${targetRef}' from original reference '${originalRef}'`
    : `Session imported from backup file (${originalRef})`;

  const notes: string[] = [];
  if (isCopy) {
    notes.push(`Original reference was preserved as '${originalRef}'.`);
  }
  if (discrepancies.length > 0) {
    notes.push(`Derived discrepancies flagged: ${discrepancies.join('; ')}`);
  }

  auditEntries.push(
    makeEntry({
      kind: 'created',
      actor: currentOperator,
      summary: importSummary,
      note: notes.length ? notes.join(' ') : 'Derived calculations verified by engine.',
    })
  );

  importedSession.audit = auditEntries;
  importedSession.updatedAt = now;

  return {
    session: importedSession,
    isCopy,
    originalRef,
    discrepancies,
  };
}
