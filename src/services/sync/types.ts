/**
 * Type definitions for the offline synchronization manager,
 * queued operations, state events, and conflict resolution.
 */

import {
  MeasurementSession,
  SessionCreatePayload,
  SessionSubmitPayload,
  SessionUpdatePayload,
} from '../api/types';

export type SyncOpType = 'create_session' | 'update_session' | 'submit_session';

export type SyncOpStatus = 'pending' | 'syncing' | 'failed' | 'conflict' | 'completed';

export interface ConflictDetails {
  expectedVersion: number;
  currentVersion: number;
  message: string;
  detectedAt: string;
}

export type SyncOpPayload =
  | SessionCreatePayload
  | SessionUpdatePayload
  | SessionSubmitPayload
  | Record<string, unknown>;

export interface QueuedSyncOp {
  id: string;
  sessionRef: string;
  backendId?: string;
  type: SyncOpType;
  payload: SyncOpPayload;
  expectedVersion?: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  status: SyncOpStatus;
  lastError?: string;
  conflictDetails?: ConflictDetails;
}

export type ConflictResolutionChoice = 'local' | 'server';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export type SyncStatusListener = (status: SyncStatus) => void;

export type ConflictListener = (op: QueuedSyncOp, conflict: ConflictDetails) => void;

export type SessionSyncedListener = (sessionRef: string, remote: MeasurementSession) => void;

