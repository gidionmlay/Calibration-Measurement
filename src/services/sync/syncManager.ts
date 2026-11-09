/**
 * SyncManager: Offline Operation Queue, Background Synchronization,
 * Exponential Backoff Retries, and Concurrency Conflict Protection.
 *
 * Implements an authoritative local-first queue persisted in IndexedDB,
 * ensuring resilient operation during network partitions and graceful
 * recovery with version-controlled optimistic concurrency.
 */

import { api } from '../api';
import { ConflictError } from '../api/errors';
import {
  MeasurementSession,
  SessionCreatePayload,
  SessionSubmitPayload,
  SessionUpdatePayload,
} from '../api/types';
import {
  loadSyncOpsFromStorage,
  removeSyncOpFromStorage,
  saveSyncOpToStorage,
} from '../../utils/storage';
import {
  ConflictDetails,
  ConflictListener,
  ConflictResolutionChoice,
  QueuedSyncOp,
  SessionSyncedListener,
  SyncOpPayload,
  SyncOpType,
  SyncStatus,
  SyncStatusListener,
} from './types';

function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const SILENT_IGNORE = () => {
  // Ignored storage errors during cleanup
};

export class SyncManager {
  private queue: QueuedSyncOp[] = [];
  private isOnline: boolean;
  private isSyncing = false;
  private isInitialized = false;
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private syncPromise: Promise<void> | null = null;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private baseBackoffMs = 2000;
  private maxBackoffMs = 60000;

  private statusListeners: Set<SyncStatusListener> = new Set();
  private conflictListeners: Set<ConflictListener> = new Set();
  private sessionSyncedListeners: Set<SessionSyncedListener> = new Set();

  private handleOnline = () => {
    this.setOnline(true);
  };

  private handleOffline = () => {
    this.setOnline(false);
  };

  constructor(options?: { baseBackoffMs?: number; maxBackoffMs?: number }) {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (options?.baseBackoffMs) this.baseBackoffMs = options.baseBackoffMs;
    if (options?.maxBackoffMs) this.maxBackoffMs = options.maxBackoffMs;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Initialize SyncManager by loading persisted operations from IndexedDB.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    try {
      this.queue = await loadSyncOpsFromStorage();
    } catch {
      this.queue = [];
    }
    this.isInitialized = true;
    this.notifyStatus();

    if (this.isOnline && this.hasPendingOperations()) {
      void this.processQueue();
    }
  }

  /**
   * Update online status and trigger synchronization when network returns.
   */
  public setOnline(online: boolean): void {
    const changed = this.isOnline !== online;
    this.isOnline = online;

    if (changed) {
      if (online) {
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        void this.processQueue();
      }
      this.notifyStatus();
    }
  }

  /**
   * Enqueue a new operation. Coalesces consecutive pending updates for the same session.
   */
  public async enqueue(item: {
    sessionRef: string;
    backendId?: string;
    type: SyncOpType;
    payload: SyncOpPayload;
    expectedVersion?: number;
    maxAttempts?: number;
  }): Promise<QueuedSyncOp> {
    const now = new Date().toISOString();

    // Check if an existing pending update for this session can be coalesced
    const existingIndex = this.queue.findIndex(
      (op) =>
        op.sessionRef === item.sessionRef &&
        op.type === item.type &&
        item.type === 'update_session' &&
        op.status === 'pending',
    );

    let op: QueuedSyncOp;

    if (existingIndex >= 0) {
      const existing = this.queue[existingIndex];
      op = {
        ...existing,
        backendId: item.backendId ?? existing.backendId,
        payload: item.payload,
        expectedVersion: item.expectedVersion ?? existing.expectedVersion,
        updatedAt: now,
      };
      this.queue[existingIndex] = op;
    } else {
      op = {
        id: generateUUID(),
        sessionRef: item.sessionRef,
        backendId: item.backendId,
        type: item.type,
        payload: item.payload,
        expectedVersion: item.expectedVersion,
        idempotencyKey: generateUUID(),
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        maxAttempts: item.maxAttempts ?? 5,
        status: 'pending',
      };
      this.queue.push(op);
    }

    try {
      await saveSyncOpToStorage(op);
    } catch (e) {
      // Storage error logged, queue in memory remains functional
      this.lastError = e instanceof Error ? e.message : 'Storage write failed';
    }

    this.notifyStatus();

    if (this.isOnline && !this.isSyncing) {
      void this.processQueue();
    }

    return op;
  }

  /**
   * Process all pending operations in the queue in FIFO order per session.
   */
  public async processQueue(): Promise<void> {
    if (!this.isOnline) {
      return;
    }
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this.runProcessQueue();
    try {
      await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }

  /**
   * Waits until current sync processing finishes.
   */
  public async waitForIdle(): Promise<void> {
    while (this.syncPromise) {
      await this.syncPromise;
    }
  }

  private async runProcessQueue(): Promise<void> {
    this.isSyncing = true;
    this.notifyStatus();

    try {
      while (this.isOnline) {
        // Collect session references currently blocked by conflicts
        const blockedSessions = new Set(
          this.queue
            .filter((op) => op.status === 'conflict')
            .map((op) => op.sessionRef),
        );

        // Find next eligible pending operation
        const pendingOp = this.queue.find(
          (op) => op.status === 'pending' && !blockedSessions.has(op.sessionRef),
        );

        if (!pendingOp) {
          break;
        }

        // Mark in-progress
        pendingOp.status = 'syncing';
        pendingOp.updatedAt = new Date().toISOString();
        await this.persistOp(pendingOp);
        this.notifyStatus();

        try {
          const remote = await this.executeOperation(pendingOp);

          // Success: remove operation from queue and storage
          this.queue = this.queue.filter((op) => op.id !== pendingOp.id);
          await removeSyncOpFromStorage(pendingOp.id).catch(SILENT_IGNORE);

          this.lastSyncedAt = new Date().toISOString();
          this.lastError = null;

          // Cascade backendId / expectedVersion to subsequent queued ops for this session
          for (const nextOp of this.queue) {
            if (nextOp.sessionRef === pendingOp.sessionRef) {
              if (!nextOp.backendId && remote.id) {
                nextOp.backendId = remote.id;
              }
              if (pendingOp.type === 'create_session' || pendingOp.type === 'update_session') {
                nextOp.expectedVersion = remote.version;
                if (nextOp.payload && 'expected_version' in nextOp.payload) {
                  nextOp.payload.expected_version = remote.version;
                }
              }
              await this.persistOp(nextOp);
            }
          }

          // Notify session synced listeners
          this.notifySessionSynced(pendingOp.sessionRef, remote);
        } catch (err: unknown) {
          if (err instanceof ConflictError) {
            // Version Conflict (HTTP 409)
            const expVer = err.expectedVersion ?? pendingOp.expectedVersion ?? 1;
            const curVer = err.currentVersion ?? expVer + 1;

            const conflict: ConflictDetails = {
              expectedVersion: expVer,
              currentVersion: curVer,
              message: err.message,
              detectedAt: new Date().toISOString(),
            };

            pendingOp.status = 'conflict';
            pendingOp.conflictDetails = conflict;
            pendingOp.updatedAt = new Date().toISOString();
            await this.persistOp(pendingOp);

            this.notifyConflict(pendingOp, conflict);
            // This session is now blocked, loop continues to process other non-conflicting sessions
          } else {
            // Network or transient server error
            pendingOp.attempts += 1;
            const errMsg = err instanceof Error ? err.message : String(err);
            pendingOp.lastError = errMsg;
            pendingOp.updatedAt = new Date().toISOString();
            this.lastError = errMsg;

            if (pendingOp.attempts >= pendingOp.maxAttempts) {
              pendingOp.status = 'failed';
            } else {
              pendingOp.status = 'pending';
            }

            await this.persistOp(pendingOp);

            // Schedule backoff retry and pause current flush
            const delay = Math.min(
              this.maxBackoffMs,
              this.baseBackoffMs * Math.pow(2, pendingOp.attempts - 1),
            );
            this.scheduleRetry(delay);
            break;
          }
        }
      }
    } finally {
      this.isSyncing = false;
      this.notifyStatus();
    }
  }

  /**
   * Resolve a concurrency conflict on a queued operation.
   */
  public async resolveConflict(
    opId: string,
    choice: ConflictResolutionChoice,
    serverSession?: MeasurementSession,
    localUpdatedPayload?: Record<string, unknown>,
  ): Promise<void> {
    const opIndex = this.queue.findIndex((o) => o.id === opId);
    if (opIndex < 0) return;

    const op = this.queue[opIndex];

    if (choice === 'server') {
      // Discard this local queued operation
      this.queue.splice(opIndex, 1);
      await removeSyncOpFromStorage(op.id).catch(SILENT_IGNORE);

      if (serverSession) {
        this.notifySessionSynced(op.sessionRef, serverSession);
      }
    } else {
      // Keep local version: update expectedVersion to current server version and re-queue
      const nextVersion = serverSession
        ? serverSession.version
        : (op.conflictDetails?.currentVersion ?? 1);

      op.status = 'pending';
      op.attempts = 0;
      op.conflictDetails = undefined;
      op.expectedVersion = nextVersion;
      op.updatedAt = new Date().toISOString();

      if (localUpdatedPayload) {
        op.payload = localUpdatedPayload;
      }
      if (op.payload && 'expected_version' in op.payload) {
        op.payload.expected_version = nextVersion;
      }

      await this.persistOp(op);
    }

    this.notifyStatus();

    if (this.isOnline && !this.isSyncing) {
      void this.processQueue();
    }
  }

  /**
   * Manually retry all failed operations.
   */
  public async retry(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    for (const op of this.queue) {
      if (op.status === 'failed') {
        op.status = 'pending';
        op.attempts = 0;
        op.lastError = undefined;
        op.updatedAt = new Date().toISOString();
        await this.persistOp(op);
      }
    }

    this.notifyStatus();

    if (this.isOnline) {
      await this.processQueue();
    }
  }

  /**
   * Execute single API call matching op type.
   */
  private async executeOperation(op: QueuedSyncOp): Promise<MeasurementSession> {
    const options = { operationId: op.idempotencyKey };

    switch (op.type) {
      case 'create_session':
        return api.sessions.create(op.payload as unknown as SessionCreatePayload, options);

      case 'update_session': {
        if (!op.backendId) {
          throw new Error(`Cannot update session ${op.sessionRef} without backendId`);
        }
        const updatePayload = {
          ...op.payload,
          expected_version:
            (op.payload as { expected_version?: number }).expected_version ??
            op.expectedVersion ??
            1,
        };
        return api.sessions.update(
          op.backendId,
          updatePayload as unknown as SessionUpdatePayload,
          options,
        );
      }

      case 'submit_session':
        if (!op.backendId) {
          throw new Error(`Cannot submit session ${op.sessionRef} without backendId`);
        }
        return api.sessions.submit(
          op.backendId,
          op.payload as unknown as SessionSubmitPayload,
          options,
        );

      default:
        throw new Error(`Unsupported sync operation type: ${op.type}`);
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isOnline) {
        void this.processQueue();
      }
    }, delayMs);
  }

  private async persistOp(op: QueuedSyncOp): Promise<void> {
    try {
      await saveSyncOpToStorage(op);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'Storage persistence failed';
    }
  }

  public getStatus(): SyncStatus {
    const pendingCount = this.queue.filter(
      (o) => o.status === 'pending' || o.status === 'syncing',
    ).length;
    const failedCount = this.queue.filter((o) => o.status === 'failed').length;
    const conflictCount = this.queue.filter((o) => o.status === 'conflict').length;

    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount,
      failedCount,
      conflictCount,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
    };
  }

  public getQueue(): QueuedSyncOp[] {
    return [...this.queue];
  }

  public hasPendingOperations(): boolean {
    return this.queue.some((o) => o.status === 'pending');
  }

  public subscribe(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public onConflict(listener: ConflictListener): () => void {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  public onSessionSynced(listener: SessionSyncedListener): () => void {
    this.sessionSyncedListeners.add(listener);
    return () => {
      this.sessionSyncedListeners.delete(listener);
    };
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Listener safety
      }
    });
  }

  private notifyConflict(op: QueuedSyncOp, conflict: ConflictDetails): void {
    this.conflictListeners.forEach((listener) => {
      try {
        listener(op, conflict);
      } catch {
        // Listener safety
      }
    });
  }

  private notifySessionSynced(ref: string, session: MeasurementSession): void {
    this.sessionSyncedListeners.forEach((listener) => {
      try {
        listener(ref, session);
      } catch {
        // Listener safety
      }
    });
  }

  public dispose(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.statusListeners.clear();
    this.conflictListeners.clear();
    this.sessionSyncedListeners.clear();
  }
}

// Singleton application instance
export const syncManager = new SyncManager();
