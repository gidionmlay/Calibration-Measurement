import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncManager } from './syncManager';
import { clearStorage } from '../../utils/storage';
import { api } from '../api';
import { ConflictError, NetworkError } from '../api/errors';
import { MeasurementSession } from '../api/types';

describe('SyncManager: Offline Operation Queue and Conflict Resolution', () => {
  let manager: SyncManager;

  const sampleRemoteSession: MeasurementSession = {
    id: 'backend-uuid-001',
    name: 'BC-2026-001',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:05:00Z',
    version: 1,
    schema_version: 1,
    status: 'draft',
    course_length_m: '1000.0000',
    course_length_unit: 'm',
    rollover_mode: 'rollover_6digit',
    constant_selection_rule: 'larger',
    working_spec_version: 'ws-0.3',
    policy_approval_status: 'provisional',
    is_provisional: true,
    pre_cal_working_constant: '10000.0000',
    post_cal_working_constant: '10005.0000',
    final_working_constant: '10005.0000',
    rides: [],
    reviews: [],
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearStorage();
    manager = new SyncManager({ baseBackoffMs: 10, maxBackoffMs: 100 });
  });

  it('enqueues an operation and persists it to IndexedDB', async () => {
    manager.setOnline(false); // keep offline so it stays in queue
    await manager.init();

    const op = await manager.enqueue({
      sessionRef: 'BC-2026-001',
      type: 'create_session',
      payload: { reference: 'BC-2026-001', operator: 'J. Measurer' },
    });

    expect(op.id).toBeDefined();
    expect(op.idempotencyKey).toBeDefined();
    expect(op.status).toBe('pending');
    expect(op.attempts).toBe(0);

    const queue = manager.getQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].sessionRef).toBe('BC-2026-001');

    const status = manager.getStatus();
    expect(status.pendingCount).toBe(1);
    expect(status.isOnline).toBe(false);
  });

  it('coalesces multiple pending update operations for the same session', async () => {
    manager.setOnline(false);
    await manager.init();

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'backend-uuid-001',
      type: 'update_session',
      payload: { course_length_m: '500.0000' },
      expectedVersion: 1,
    });

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'backend-uuid-001',
      type: 'update_session',
      payload: { course_length_m: '1000.0000' },
      expectedVersion: 1,
    });

    const queue = manager.getQueue();
    expect(queue.length).toBe(1);
    expect((queue[0].payload as { course_length_m?: string }).course_length_m).toBe('1000.0000');
  });

  it('flushes queued create operation when online and notifies synced listeners', async () => {
    const createSpy = vi.spyOn(api.sessions, 'create').mockResolvedValue(sampleRemoteSession);
    const syncedCallback = vi.fn();
    manager.onSessionSynced(syncedCallback);

    manager.setOnline(true);
    await manager.init();

    const op = await manager.enqueue({
      sessionRef: 'BC-2026-001',
      type: 'create_session',
      payload: { reference: 'BC-2026-001', operator: 'J. Measurer' },
    });
    await manager.waitForIdle();

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'BC-2026-001' }),
      expect.objectContaining({ operationId: op.idempotencyKey }),
    );

    expect(syncedCallback).toHaveBeenCalledWith('BC-2026-001', sampleRemoteSession);
    expect(manager.getQueue().length).toBe(0);
    expect(manager.getStatus().pendingCount).toBe(0);
    expect(manager.getStatus().lastSyncedAt).not.toBeNull();
  });

  it('cascades backendId and expectedVersion to subsequent queued updates', async () => {
    manager.setOnline(false);
    await manager.init();

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      type: 'create_session',
      payload: { reference: 'BC-2026-001' },
    });

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      type: 'update_session',
      payload: { course_length_m: '1000.0000' },
    });

    const createSpy = vi.spyOn(api.sessions, 'create').mockResolvedValue(sampleRemoteSession);
    const updateSpy = vi.spyOn(api.sessions, 'update').mockResolvedValue({
      ...sampleRemoteSession,
      version: 2,
    });

    manager.setOnline(true);
    await manager.processQueue();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      'backend-uuid-001',
      expect.objectContaining({ course_length_m: '1000.0000', expected_version: 1 }),
      expect.any(Object),
    );
    expect(manager.getQueue().length).toBe(0);
  });

  it('handles HTTP 409 Conflict: marks op as conflict, notifies listener, and pauses session', async () => {
    vi.spyOn(api.sessions, 'update').mockRejectedValue(
      new ConflictError(
        'Version conflict: session was modified concurrently (expected v1, current database version is 2)',
        { expectedVersion: 1, currentVersion: 2 },
      ),
    );

    const conflictCallback = vi.fn();
    manager.onConflict(conflictCallback);

    manager.setOnline(true);
    await manager.init();

    const op = await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'backend-uuid-001',
      type: 'update_session',
      payload: { course_length_m: '1000.0000', expected_version: 1 },
      expectedVersion: 1,
    });
    await manager.waitForIdle();

    expect(conflictCallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: op.id, status: 'conflict' }),
      expect.objectContaining({ expectedVersion: 1, currentVersion: 2 }),
    );

    const queue = manager.getQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe('conflict');
    expect(manager.getStatus().conflictCount).toBe(1);
  });

  it('resolves conflict using choice "server" by discarding local op and adopting server session', async () => {
    vi.spyOn(api.sessions, 'update').mockRejectedValue(
      new ConflictError('Version conflict', { expectedVersion: 1, currentVersion: 2 }),
    );

    manager.setOnline(true);
    await manager.init();

    const op = await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'backend-uuid-001',
      type: 'update_session',
      payload: { course_length_m: '1000.0000', expected_version: 1 },
      expectedVersion: 1,
    });
    await manager.waitForIdle();

    const syncedCallback = vi.fn();
    manager.onSessionSynced(syncedCallback);

    const serverSession: MeasurementSession = {
      ...sampleRemoteSession,
      version: 2,
      course_length_m: '1000.0000',
    };

    await manager.resolveConflict(op.id, 'server', serverSession);

    expect(manager.getQueue().length).toBe(0);
    expect(manager.getStatus().conflictCount).toBe(0);
    expect(syncedCallback).toHaveBeenCalledWith('BC-2026-001', serverSession);
  });

  it('resolves conflict using choice "local" by adopting server version and resyncing local value', async () => {
    let callCount = 0;
    vi.spyOn(api.sessions, 'update').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new ConflictError('Version conflict', { expectedVersion: 1, currentVersion: 2 });
      }
      return { ...sampleRemoteSession, version: 3 };
    });

    manager.setOnline(true);
    await manager.init();

    const op = await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'backend-uuid-001',
      type: 'update_session',
      payload: { course_length_m: '1000.0000', expected_version: 1 },
      expectedVersion: 1,
    });
    await manager.waitForIdle();

    expect(manager.getQueue()[0].status).toBe('conflict');

    // User chooses to keep local changes
    await manager.resolveConflict(op.id, 'local', { ...sampleRemoteSession, version: 2 });
    await manager.waitForIdle();

    expect(callCount).toBe(2);
    expect(manager.getQueue().length).toBe(0);
    expect(manager.getStatus().conflictCount).toBe(0);
  });

  it('isolates conflicts so a conflict in Session A does not block Session B', async () => {
    vi.spyOn(api.sessions, 'update').mockImplementation(async (id) => {
      if (id === 'session-a-id') {
        throw new ConflictError('Version conflict', { expectedVersion: 1, currentVersion: 2 });
      }
      return { ...sampleRemoteSession, id: 'session-b-id', reference: 'BC-2026-002' };
    });

    manager.setOnline(false);
    await manager.init();

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      backendId: 'session-a-id',
      type: 'update_session',
      payload: { course_length_m: '1000.0000' },
      expectedVersion: 1,
    });

    await manager.enqueue({
      sessionRef: 'BC-2026-002',
      backendId: 'session-b-id',
      type: 'update_session',
      payload: { course_length_m: '2000.0000' },
      expectedVersion: 1,
    });

    manager.setOnline(true);
    await manager.processQueue();

    const queue = manager.getQueue();
    // Session A remains in conflict, Session B succeeded and was removed
    expect(queue.length).toBe(1);
    expect(queue[0].sessionRef).toBe('BC-2026-001');
    expect(queue[0].status).toBe('conflict');
  });

  it('handles network error with retry tracking and manual retry capability', async () => {
    const errorSpy = vi.spyOn(api.sessions, 'create').mockRejectedValue(
      new NetworkError('Network connection failed'),
    );

    manager.setOnline(true);
    await manager.init();

    await manager.enqueue({
      sessionRef: 'BC-2026-001',
      type: 'create_session',
      payload: { reference: 'BC-2026-001' },
      maxAttempts: 2,
    });
    await manager.waitForIdle();

    // First attempt failed
    const currentOp = manager.getQueue()[0];
    expect(currentOp.attempts).toBe(1);
    expect(manager.getStatus().lastError).toContain('Network connection failed');

    // Simulate second failed attempt
    await manager.processQueue();
    expect(manager.getQueue()[0].status).toBe('failed');
    expect(manager.getStatus().failedCount).toBe(1);

    // Now network recovers and user clicks "Retry"
    errorSpy.mockResolvedValue(sampleRemoteSession);
    await manager.retry();

    expect(manager.getQueue().length).toBe(0);
    expect(manager.getStatus().failedCount).toBe(0);
    expect(manager.getStatus().pendingCount).toBe(0);
  });
});
