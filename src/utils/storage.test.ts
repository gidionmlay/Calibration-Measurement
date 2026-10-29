import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clearStorage,
  isValidSessionRecord,
  loadSessionsFromStorage,
  saveSessionsToStorage,
  STORAGE_SCHEMA_VERSION,
  DB_NAME,
  SESSIONS_STORE,
} from './storage';
import { blankSession } from './sessionFactory';
import { deriveSession } from './sessionRules';
import type { SessionData } from '../types/session';

describe('Local-First IndexedDB Persistence Suite', () => {
  beforeEach(async () => {
    await clearStorage();
  });

  it('persists and restores a complete session draft without data loss', async () => {
    const session: SessionData = {
      ...blankSession('BC-2026-PERSIST-1', 'J. Okafor', '2026-10-28T12:00:00.000Z'),
      courseLength: '200',
      ruleSet: 'ws-0.3',
      finalRule: 'larger',
      pre: [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '', finish: '13042', startOverridden: false, overrideReason: '' },
        { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
        { start: '', finish: '15052', startOverridden: false, overrideReason: '' }
      ],
      distStart: '124002',
      distFinish: '320456',
      post: [
        { start: '321000', finish: '322000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '323000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '324000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '325000', startOverridden: false, overrideReason: '' }
      ]
    };

    await saveSessionsToStorage([session]);

    const result = await loadSessionsFromStorage();
    expect(result.sessions.length).toBe(1);
    expect(result.corruptCount).toBe(0);
    expect(result.metadata?.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);

    const restored = result.sessions[0];
    expect(restored.reference).toBe('BC-2026-PERSIST-1');
    expect(restored.courseLength).toBe('200');
    expect(restored.finalRule).toBe('larger');
    expect(restored.pre[0].finish).toBe('12021');
    expect(restored.post[3].finish).toBe('325000');
    expect(restored.distStart).toBe('124002');
    expect(restored.distFinish).toBe('320456');

    // Re-deriving recalculates valid identical outputs
    const d = deriveSession(restored, 'online');
    expect(d.distance.km).toBeCloseTo(196454 / 5005.0, 6);
  });

  it('persists and restores linked start overrides and reason strings', async () => {
    const session: SessionData = {
      ...blankSession('BC-2026-OVERRIDE', 'J. Okafor'),
      courseLength: '200',
      pre: [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '12025', finish: '13042', startOverridden: true, overrideReason: 'Bumped meter' },
        { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
        { start: '', finish: '15052', startOverridden: false, overrideReason: '' }
      ]
    };

    await saveSessionsToStorage([session]);
    const { sessions: restored } = await loadSessionsFromStorage();

    expect(restored[0].pre[1].startOverridden).toBe(true);
    expect(restored[0].pre[1].start).toBe('12025');
    expect(restored[0].pre[1].overrideReason).toBe('Bumped meter');
  });

  it('preserves complete audit trail history across saves', async () => {
    const session = blankSession('BC-2026-AUDIT', 'J. Okafor');
    session.audit.push({
      id: 'a-test-1',
      at: '2026-10-28T12:05:00.000Z',
      actor: 'J. Okafor',
      kind: 'edit',
      summary: 'Course length entered',
      field: 'courseLength',
      from: '',
      to: '200'
    });

    await saveSessionsToStorage([session]);
    const { sessions: restored } = await loadSessionsFromStorage();

    expect(restored[0].audit.length).toBe(session.audit.length);
    expect(restored[0].audit[1].summary).toBe('Course length entered');
    expect(restored[0].audit[1].kind).toBe('edit');
  });

  it('manages multiple independent sessions with unique stable IDs', async () => {
    const s1 = blankSession('BC-2026-001', 'Operator A');
    const s2 = blankSession('BC-2026-002', 'Operator B');
    const s3 = blankSession('BC-2026-003', 'Operator C');

    await saveSessionsToStorage([s1, s2, s3]);
    const { sessions: restored, metadata } = await loadSessionsFromStorage();

    expect(restored.length).toBe(3);
    expect(metadata?.sessionCount).toBe(3);
    const refs = restored.map((s) => s.reference);
    expect(refs).toContain('BC-2026-001');
    expect(refs).toContain('BC-2026-002');
    expect(refs).toContain('BC-2026-003');
  });

  it('filters out malformed or corrupt session records gracefully', async () => {
    // Test validation helper directly
    expect(isValidSessionRecord(null)).toBe(false);
    expect(isValidSessionRecord({})).toBe(false);
    expect(isValidSessionRecord({ reference: '' })).toBe(false);
    expect(isValidSessionRecord({ reference: 'BC-TEST', operator: 123 })).toBe(false);

    const valid = blankSession('BC-VALID', 'Tester');
    expect(isValidSessionRecord(valid)).toBe(true);
  });

  it('preserves finalized state and lock attributes upon restoration', async () => {
    const finalizedAt = '2026-10-28T13:00:00.000Z';
    const finalizedSession: SessionData = {
      ...blankSession('BC-2026-FINAL', 'J. Okafor'),
      finalized: { at: finalizedAt, by: 'J. Okafor' }
    };

    await saveSessionsToStorage([finalizedSession]);
    const { sessions: restored } = await loadSessionsFromStorage();

    expect(restored[0].finalized).not.toBeNull();
    expect(restored[0].finalized?.at).toBe(finalizedAt);
    expect(restored[0].finalized?.by).toBe('J. Okafor');
  });

  it('handles rapid sequential saves without corrupting stored sessions', async () => {
    const s = blankSession('BC-2026-RAPID', 'Tester');
    const promises = [
      saveSessionsToStorage([{ ...s, courseLength: '100' }]),
      saveSessionsToStorage([{ ...s, courseLength: '200' }]),
      saveSessionsToStorage([{ ...s, courseLength: '300' }])
    ];

    await Promise.all(promises);
    const { sessions: restored } = await loadSessionsFromStorage();
    expect(restored.length).toBe(1);
    expect(['100', '200', '300']).toContain(restored[0].courseLength);
  });

  it('preserves metadata and schema version accurately', async () => {
    const s = blankSession('BC-2026-META', 'Tester');
    await saveSessionsToStorage([s]);

    const { metadata } = await loadSessionsFromStorage();
    expect(metadata).not.toBeNull();
    expect(metadata?.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(metadata?.sessionCount).toBe(1);
    expect(new Date(metadata!.lastPersistedAt).getTime()).toBeGreaterThan(0);
  });

  it('discards corrupt records directly from IndexedDB while preserving valid sessions', async () => {
    const valid = blankSession('BC-VALID', 'Tester');
    await saveSessionsToStorage([valid]);

    // Inject a corrupt object into SESSIONS_STORE directly using fake-indexeddb
    const req = indexedDB.open(DB_NAME, STORAGE_SCHEMA_VERSION);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(SESSIONS_STORE, 'readwrite');
        tx.objectStore(SESSIONS_STORE).put({ reference: 'CORRUPT', invalidData: true });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const result = await loadSessionsFromStorage();
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].reference).toBe('BC-VALID');
    expect(result.corruptCount).toBe(1);
  });

  it('handles database open failure gracefully when IndexedDB is unavailable', async () => {
    const originalIDB = globalThis.indexedDB;
    // @ts-expect-error simulating runtime without IndexedDB
    globalThis.indexedDB = undefined;

    try {
      await expect(saveSessionsToStorage([blankSession('BC-TEST', 'Tester')])).rejects.toThrow(
        /IndexedDB is not available/
      );
    } finally {
      globalThis.indexedDB = originalIDB;
    }
  });
});
