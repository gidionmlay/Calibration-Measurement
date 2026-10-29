import { describe, it, expect } from 'vitest';
import {
  exportSessionToJSON,
  validateSessionImport,
  detectDerivedDiscrepancies,
  detectLocalAuditLoss,
  prepareImportedSession,
  CURRENT_EXPORT_SCHEMA_VERSION,
  EXPORT_FORMAT_IDENTIFIER,
  type SessionExportPayload,
} from './sessionExport';
import { buildSeedSessions } from './sessionFactory';
import { deriveSession } from './sessionRules';
import type { SessionData } from '../types/session';

describe('Workstream A: Session Export and Backup Suite', () => {
  function createTestSession(): SessionData {
    const sessions = buildSeedSessions('online', 'examples');
    return JSON.parse(JSON.stringify(sessions.find((s) => s.reference === 'BC-2026-002') || sessions[0]));
  }

  it('exports a valid session preserving reference, raw readings, overrides, and audit history', () => {
    const sampleSession = createTestSession();
    // Inject an override with valid start value and reason to verify preservation
    sampleSession.pre[1].startOverridden = true;
    sampleSession.pre[1].start = '12025';
    sampleSession.pre[1].overrideReason = 'Mechanical counter reset test';
    sampleSession.audit.push({
      id: 'audit-test-99',
      at: '2026-10-28T15:30:00.000Z',
      actor: 'J. Okafor',
      kind: 'override',
      summary: 'Ride 2 start overridden',
      reason: 'Mechanical counter reset test',
    });

    const jsonStr = exportSessionToJSON(sampleSession);
    expect(jsonStr).toBeTypeOf('string');

    const parsed = JSON.parse(jsonStr) as SessionExportPayload;
    expect(parsed.format).toBe(EXPORT_FORMAT_IDENTIFIER);
    expect(parsed.schemaVersion).toBe(CURRENT_EXPORT_SCHEMA_VERSION);
    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.application.name).toBe('Bicycle Calibration Calculation');
    expect(parsed.application.ruleSet).toBe(sampleSession.ruleSet);
    expect(parsed.application.provisionalNotice).toContain('PROVISIONAL');

    // Verify session data fidelity
    expect(parsed.session.reference).toBe(sampleSession.reference);
    expect(parsed.session.pre[1].startOverridden).toBe(true);
    expect(parsed.session.pre[1].start).toBe('12025');
    expect(parsed.session.pre[1].overrideReason).toBe('Mechanical counter reset test');
    expect(parsed.session.audit.some((e) => e.id === 'audit-test-99')).toBe(true);

    // Verify derived snapshot inclusion
    expect(parsed.derivedSnapshot.preWC).toBeTypeOf('number');
    expect(parsed.derivedSnapshot.state).toBeTruthy();
  });

  it('validates a valid exported session string successfully', () => {
    const sampleSession = createTestSession();
    const jsonStr = exportSessionToJSON(sampleSession);
    const result = validateSessionImport(jsonStr);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.session.reference).toBe(sampleSession.reference);
    }
  });

  it('rejects empty input or malformed JSON with an actionable error message', () => {
    const emptyResult = validateSessionImport('');
    expect(emptyResult.valid).toBe(false);
    if (!emptyResult.valid) {
      expect(emptyResult.error).toContain('empty');
    }

    const malformedResult = validateSessionImport('{ invalid json syntax ...');
    expect(malformedResult.valid).toBe(false);
    if (!malformedResult.valid) {
      expect(malformedResult.error).toContain('Invalid JSON syntax');
    }
  });

  it('rejects unsupported schema versions', () => {
    const session = createTestSession();
    const jsonStr = exportSessionToJSON(session);
    const obj = JSON.parse(jsonStr);
    obj.schemaVersion = 999;
    const result = validateSessionImport(JSON.stringify(obj));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Unsupported schema version 999');
    }
  });

  it('rejects unrecognized format identifier', () => {
    const session = createTestSession();
    const jsonStr = exportSessionToJSON(session);
    const obj = JSON.parse(jsonStr);
    obj.format = 'unrecognized-file-type';
    const result = validateSessionImport(JSON.stringify(obj));

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Unrecognized file format');
    }
  });

  it('rejects payloads with missing required session fields or invalid ride structures', () => {
    const session = createTestSession();
    const jsonStr = exportSessionToJSON(session);
    const obj = JSON.parse(jsonStr);
    delete obj.session.reference;
    const res1 = validateSessionImport(JSON.stringify(obj));
    expect(res1.valid).toBe(false);
    if (!res1.valid) {
      expect(res1.error).toContain('Session reference is missing');
    }

    // Invalid pre-cal ride count
    const obj2 = JSON.parse(jsonStr);
    obj2.session.pre = [obj2.session.pre[0]]; // only 1 ride instead of 4
    const res2 = validateSessionImport(JSON.stringify(obj2));
    expect(res2.valid).toBe(false);
    if (!res2.valid) {
      expect(res2.error).toContain('must contain exactly 4 ride entries');
    }
  });

  it('never silently overwrites on duplicate reference: supports safe copy generation', () => {
    const session = createTestSession();
    const existingSessions: SessionData[] = [session];
    const jsonStr = exportSessionToJSON(session);
    const validation = validateSessionImport(jsonStr);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    // Import as copy
    const preparedCopy = prepareImportedSession(
      validation.payload,
      existingSessions,
      'copy',
      'Test Operator'
    );

    expect(preparedCopy.isCopy).toBe(true);
    expect(preparedCopy.originalRef).toBe(session.reference);
    expect(preparedCopy.session.reference).toBe(`${session.reference}-COPY`);
    // Original reference documented in audit trail
    const lastAudit = preparedCopy.session.audit[preparedCopy.session.audit.length - 1];
    expect(lastAudit.summary).toContain(`Session imported as copy '${session.reference}-COPY'`);
    expect(lastAudit.note).toContain(`Original reference was preserved as '${session.reference}'`);

    // Import as overwrite
    const preparedOverwrite = prepareImportedSession(
      validation.payload,
      existingSessions,
      'overwrite',
      'Test Operator'
    );
    expect(preparedOverwrite.isCopy).toBe(false);
    expect(preparedOverwrite.session.reference).toBe(session.reference);
  });

  it('recomputes derived results and detects tampered or discrepant derived values', () => {
    const session = createTestSession();
    const jsonStr = exportSessionToJSON(session);
    const payload: SessionExportPayload = JSON.parse(jsonStr);

    // Tamper with the exported derived snapshot (e.g. fraudulent distance)
    payload.derivedSnapshot.distanceKm = 42.195;
    payload.derivedSnapshot.preWC = 9999.9999;

    const recomputed = deriveSession(payload.session, 'online');
    const discrepancies = detectDerivedDiscrepancies(payload, recomputed);

    expect(discrepancies.length).toBeGreaterThan(0);
    expect(discrepancies.some((d) => d.includes('Course Distance'))).toBe(true);
    expect(discrepancies.some((d) => d.includes('Pre-calibration Working Constant'))).toBe(true);
    expect(discrepancies[0]).toContain('Recomputed value governs');
  });

  it('guarantees imported sessions cannot bypass finalization and policy blockers', () => {
    const session = createTestSession();
    const tampered = JSON.parse(JSON.stringify(session));
    tampered.finalized = null;
    tampered.ruleSet = 'ws-0.3';

    const d = deriveSession(tampered, 'online');
    // Policy approval blocker MUST be present because ws-0.3 is unratified
    const policyBlocker = d.blockers.find((b) => b.id === 'policyApproval');
    expect(policyBlocker).toBeDefined();
    expect(policyBlocker?.ok).toBe(false);
    expect(policyBlocker?.detail).toContain('provisional and official finalization is blocked');
  });

  describe('Remediation A: Finalized Session Overwrite Protection', () => {
    it('blocks overwrite when the existing local session is finalized and locked', () => {
      const finalizedSession = createTestSession();
      finalizedSession.finalized = {
        at: '2026-10-28T18:00:00.000Z',
        by: 'J. Okafor',
      };

      const draftSession = createTestSession();
      draftSession.finalized = null;
      const draftPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(draftSession));

      // Attempting to overwrite a finalized session with draft backup MUST throw
      expect(() =>
        prepareImportedSession(draftPayload, [finalizedSession], 'overwrite', 'Test Operator')
      ).toThrow(/finalized and locked/i);

      // Attempting to overwrite a finalized session with another finalized backup MUST also throw
      const otherFinalizedPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(finalizedSession));
      expect(() =>
        prepareImportedSession(otherFinalizedPayload, [finalizedSession], 'overwrite', 'Test Operator')
      ).toThrow(/finalized and locked/i);
    });

    it('allows import-as-copy when the existing local session is finalized', () => {
      const finalizedSession = createTestSession();
      finalizedSession.finalized = {
        at: '2026-10-28T18:00:00.000Z',
        by: 'J. Okafor',
      };

      const draftSession = createTestSession();
      draftSession.finalized = null;
      const draftPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(draftSession));

      const preparedCopy = prepareImportedSession(draftPayload, [finalizedSession], 'copy', 'Test Operator');
      expect(preparedCopy.isCopy).toBe(true);
      expect(preparedCopy.session.reference).toBe(`${draftSession.reference}-COPY`);
      // Existing session was not touched
      expect(finalizedSession.finalized).not.toBeNull();
    });
  });

  describe('Remediation B: Local Audit History Loss Protection', () => {
    it('detects local audit events that are absent from the backup and blocks overwrite', () => {
      const localSession = createTestSession();
      // Add local edit and audit event made after the backup was created
      localSession.audit.push({
        id: 'local-post-backup-audit-1',
        at: '2026-10-28T19:00:00.000Z',
        actor: 'J. Okafor',
        kind: 'edit',
        summary: 'Local calibration reading adjusted',
      });

      // Backup lacks 'local-post-backup-audit-1'
      const backupSession = createTestSession();
      const backupPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(backupSession));

      // prepareImportedSession must throw on overwrite when local session has unexported audit events
      expect(() =>
        prepareImportedSession(backupPayload, [localSession], 'overwrite', 'Test Operator')
      ).toThrow(/audit event\(s\) not present in the backup file/i);

      // But copy MUST succeed without modifying localSession
      const preparedCopy = prepareImportedSession(backupPayload, [localSession], 'copy', 'Test Operator');
      expect(preparedCopy.isCopy).toBe(true);
      expect(localSession.audit.some((e) => e.id === 'local-post-backup-audit-1')).toBe(true);
    });

    it('allows safe overwrite when the backup contains all local audit events', () => {
      const session = createTestSession();
      const backupPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(session));

      // Overwrite is safe because backup has all events from local session
      const prepared = prepareImportedSession(backupPayload, [session], 'overwrite', 'Test Operator');
      expect(prepared.isCopy).toBe(false);
      expect(prepared.session.reference).toBe(session.reference);
    });

    it('detects altered audit event contents with matching IDs and blocks overwrite', () => {
      const localSession = createTestSession();
      localSession.audit = [
        {
          id: 'test-evt-1',
          at: '2026-10-28T10:00:00.000Z',
          actor: 'J. Okafor',
          kind: 'created',
          summary: 'Session created',
        },
      ];
      const backupSession = JSON.parse(JSON.stringify(localSession));

      // Backup modifies an existing event's actor and summary while keeping same ID
      backupSession.audit[0].actor = 'Eve';
      backupSession.audit[0].summary = 'Tampered summary';

      const backupPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(backupSession));

      const lossCheck = detectLocalAuditLoss(localSession, backupSession);
      expect(lossCheck.hasLoss).toBe(true);
      expect(lossCheck.hasAlteredEvents).toBe(true);
      expect(lossCheck.reason).toMatch(/differs from backup records with matching IDs/i);

      expect(() =>
        prepareImportedSession(backupPayload, [localSession], 'overwrite', 'Test Operator')
      ).toThrow(/differs from backup records with matching IDs/i);
    });

    it('detects duplicate event IDs in audit trails and blocks overwrite', () => {
      const localSession = createTestSession();
      localSession.audit = [
        {
          id: 'test-evt-1',
          at: '2026-10-28T10:00:00.000Z',
          actor: 'J. Okafor',
          kind: 'created',
          summary: 'Session created',
        },
      ];
      const backupSession = JSON.parse(JSON.stringify(localSession));

      // Introduce duplicate ID into backup audit trail
      backupSession.audit.push({ ...backupSession.audit[0] });
      const backupPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(backupSession));

      const lossCheck = detectLocalAuditLoss(localSession, backupSession);
      expect(lossCheck.hasLoss).toBe(true);
      expect(lossCheck.hasDuplicateIds).toBe(true);
      expect(lossCheck.reason).toMatch(/duplicate event IDs/i);

      expect(() =>
        prepareImportedSession(backupPayload, [localSession], 'overwrite', 'Test Operator')
      ).toThrow(/duplicate event IDs/i);
    });

    it('detects unexported local reading/setup edits made after backup export and blocks overwrite', () => {
      const localSession = createTestSession();
      const backupSession = JSON.parse(JSON.stringify(localSession));
      backupSession.updatedAt = '2026-10-28T10:00:00.000Z';
      const backupPayload: SessionExportPayload = JSON.parse(exportSessionToJSON(backupSession));

      localSession.updatedAt = '2026-10-28T12:00:00.000Z'; // Newer local edit
      localSession.courseLength = '600'; // Changed locally

      const lossCheck = detectLocalAuditLoss(localSession, backupSession);
      expect(lossCheck.hasLoss).toBe(true);
      expect(lossCheck.reason).toMatch(/reading or configuration edits made after this backup was created/i);

      expect(() =>
        prepareImportedSession(backupPayload, [localSession], 'overwrite', 'Test Operator')
      ).toThrow(/reading or configuration edits made after this backup was created/i);
    });
  });

  describe('Remediation D: Comprehensive Import Schema Validation', () => {
    it('accepts valid nullable finalized (null) and populated finalized records', () => {
      const session = createTestSession();
      session.finalized = null;
      const res1 = validateSessionImport(exportSessionToJSON(session));
      expect(res1.valid).toBe(true);

      session.finalized = {
        at: '2026-10-28T20:00:00.000Z',
        by: 'Chief Measurer',
      };
      const res2 = validateSessionImport(exportSessionToJSON(session));
      expect(res2.valid).toBe(true);
    });

    it('rejects malformed finalized structures (wrong types, invalid timestamps, missing by)', () => {
      const session = createTestSession();
      const jsonStr = exportSessionToJSON(session);

      // Primitive string instead of null/object
      const obj1 = JSON.parse(jsonStr);
      obj1.session.finalized = 'yes';
      const res1 = validateSessionImport(JSON.stringify(obj1));
      expect(res1.valid).toBe(false);
      if (!res1.valid) expect(res1.error).toContain('finalized');

      // Object with invalid timestamp
      const obj2 = JSON.parse(jsonStr);
      obj2.session.finalized = { at: 'not-a-date', by: 'Tester' };
      const res2 = validateSessionImport(JSON.stringify(obj2));
      expect(res2.valid).toBe(false);
      if (!res2.valid) expect(res2.error).toContain('timestamp');

      // Object missing 'by'
      const obj3 = JSON.parse(jsonStr);
      obj3.session.finalized = { at: '2026-10-28T20:00:00.000Z', by: '' };
      const res3 = validateSessionImport(JSON.stringify(obj3));
      expect(res3.valid).toBe(false);
      if (!res3.valid) expect(res3.error).toContain('operator name');
    });

    it('rejects malformed review records and unsupported review keys', () => {
      const session = createTestSession();
      const jsonStr = exportSessionToJSON(session);

      // Unsupported review key
      const obj1 = JSON.parse(jsonStr);
      obj1.session.reviews = { unsupportedKey: { signature: 'sig1', at: '2026-10-28T20:00:00.000Z' } };
      const res1 = validateSessionImport(JSON.stringify(obj1));
      expect(res1.valid).toBe(false);
      if (!res1.valid) expect(res1.error).toContain('Unsupported review key');

      // Review missing signature
      const obj2 = JSON.parse(jsonStr);
      obj2.session.reviews = { pre: { signature: '', at: '2026-10-28T20:00:00.000Z' } };
      const res2 = validateSessionImport(JSON.stringify(obj2));
      expect(res2.valid).toBe(false);
      if (!res2.valid) expect(res2.error).toContain('signature');
    });

    it('rejects malformed acknowledgements', () => {
      const session = createTestSession();
      const jsonStr = exportSessionToJSON(session);

      const obj = JSON.parse(jsonStr);
      obj.session.acknowledgements = { 'warn-1': { signature: '', at: 'not-a-date' } };
      const res = validateSessionImport(JSON.stringify(obj));
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.error).toContain('signature');
    });
  });
});
