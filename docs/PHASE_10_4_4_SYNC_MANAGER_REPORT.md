# Phase 10.4.4 Implementation Report: Offline Operation Queue, SyncManager, and Conflict Resolution

**Project:** Bicycle Calibration & Course Measurement Application  
**Branch:** `feature/phase-6-controlled-pilot`  
**Milestone:** Phase 10.4.4 — Offline Operation Queue, SyncManager, and Conflict Resolution  
**Status:** IMPLEMENTED AND VERIFIED  
**Date:** 2026-11-08  

---

## 1. Executive Summary

Phase 10.4.4 delivers a resilient, authoritative offline-first synchronization architecture connecting the React frontend with the PostgreSQL-persisted FastAPI backend. The system introduces an authoritative `SyncManager` service backed by an IndexedDB persistent queue (`sync_operations`), ensuring zero data loss during network partitions, automatic idempotent replays, exponential backoff retries, and comprehensive concurrency conflict protection under optimistic locking.

All core quality gates have passed:
- **Unit & Integration Tests:** 212 passed across 13 test files (`npm run test -- --run`).
- **TypeScript Static Verification:** 0 errors (`npx tsc --noEmit`).
- **Code Quality & Linter:** 0 errors (`npm run lint`).
- **Production Build:** Succeeded without bundle or packaging errors (`npx vite build`).
- **Playwright End-to-End Suite:** 14 passed in 1.6m (`npm run test:e2e`).
- **Backend Test Suite:** 144 passed in 12.15s (`pytest backend/tests/ -q`).

---

## 2. Architecture & Design Principles

### 2.1 Persistent Operation Queue (IndexedDB Schema v2)
Offline resilience requires that queued mutations survive page reloads, tab closures, and device reboots. In [`src/utils/storage.ts`](file:///media/sda3/Projects/Calibration/src/utils/storage.ts), the database schema was upgraded from version 1 to 2, introducing the `sync_operations` store with index paths on `sessionRef` and `status`:

```ts
export const STORAGE_SCHEMA_VERSION = 2;
export const DB_NAME = 'bicycle_calibration_db';
export const SESSIONS_STORE = 'sessions';
export const META_STORE = 'meta';
export const SYNC_STORE = 'sync_operations';
```

Helper functions provide ACID storage access:
- `saveSyncOpToStorage(op: QueuedSyncOp): Promise<void>`
- `loadSyncOpsFromStorage(): Promise<QueuedSyncOp[]>`
- `removeSyncOpFromStorage(id: string): Promise<void>`
- `clearSyncOpsFromStorage(): Promise<void>`

### 2.2 Queued Operation Lifecycle
Each mutation is represented by a strongly typed `QueuedSyncOp`:

| Field | Type | Purpose |
| :--- | :--- | :--- |
| `id` | `string` (UUID v4) | Primary key for IndexedDB storage. |
| `sessionRef` | `string` | Local session identifier (e.g., `BC-2026-001`). |
| `backendId` | `string?` | Canonical PostgreSQL UUID for existing sessions. |
| `type` | `SyncOpType` | Operation type: `create_session`, `update_session`, `submit_session`. |
| `payload` | `SyncOpPayload` | Wire payload conforming to backend Pydantic schemas. |
| `expectedVersion` | `number?` | Optimistic concurrency control lock version. |
| `idempotencyKey` | `string` (UUID v4) | Passed via `X-Operation-ID` HTTP header for server-side deduplication. |
| `attempts` | `number` | Counter for retry attempts. |
| `status` | `SyncOpStatus` | State machine: `pending` → `syncing` → `completed` \| `conflict` \| `failed`. |
| `conflictDetails` | `ConflictDetails?` | Contains expected vs server version and conflict reason. |

### 2.3 Operation Coalescing
When operators perform rapid sequential edits (e.g., entering counter digits or adjusting course parameters) while offline, queuing every keystroke would flood the backend with dozens of obsolete intermediate updates upon reconnection. 

`SyncManager.enqueue()` automatically coalesces consecutive pending updates for the same session:
```ts
const existingIndex = this.queue.findIndex(
  (op) =>
    op.sessionRef === item.sessionRef &&
    op.type === item.type &&
    item.type === 'update_session' &&
    op.status === 'pending',
);

if (existingIndex >= 0) {
  // Update payload, expectedVersion, and updatedAt in-place
  this.queue[existingIndex] = { ...existing, payload: item.payload, ... };
}
```

### 2.4 Sequential Processing & Multi-Session Isolation
The `processQueue()` engine processes pending operations FIFO per session. If a session encounters an HTTP 409 conflict, its queue is isolated and paused (`status = 'conflict'`), preventing cascading version errors on that session while **allowing all other independent sessions to continue syncing without interruption**.

### 2.5 Exponential Backoff Retry Strategy
When transient network failures or HTTP 5xx errors occur:
1. `op.attempts` increments.
2. If `attempts < maxAttempts` (default 5), op returns to `pending`.
3. An exponential backoff delay is calculated: $t = \min(60000, 2000 \times 2^{\text{attempts} - 1})$ ms.
4. A timer schedules the next flush cycle, or the operator can trigger immediate retry via `<SyncStatusBanner>`.

---

## 3. Concurrency Conflict Protection & Resolution

### 3.1 HTTP 409 Conflict Detection
When the backend rejects a write due to a version mismatch (`session.version != expected_version`), the API client normalizes the response into a `ConflictError` containing `expectedVersion` and `currentVersion`.

`SyncManager` captures the conflict:
```ts
const conflict: ConflictDetails = {
  expectedVersion: expVer,
  currentVersion: curVer,
  message: err.message,
  detectedAt: new Date().toISOString(),
};
pendingOp.status = 'conflict';
pendingOp.conflictDetails = conflict;
```

### 3.2 Operator Resolution Workflow
The operator is notified via `<SyncStatusBanner>` and can open `<SyncDialog>` to resolve the conflict with two non-destructive options:
1. **"Use server value" (`choice = 'server'`):**
   - Discards uncommitted local changes from the queue.
   - Adopts the authoritative server record.
   - Re-runs calculations and updates review statuses.
2. **"Keep this device's value" (`choice = 'local'`):**
   - Adopts the server's current version as the new base version (`expected_version = serverSession.version`).
   - Retains the local user edits.
   - Re-enqueues the operation as `pending` with `attempts = 0` and triggers an immediate sync flush.
   - Logs the conflict resolution into the session's audit trail.

---

## 4. UI Architecture & Accessibility

### 4.1 `<SyncStatusBanner />`
Rendered prominently in [`src/components/shell/AppShell.tsx`](file:///media/sda3/Projects/Calibration/src/components/shell/AppShell.tsx) above all views, providing continuous, non-intrusive visibility:
- **Conflict Warning (`role="alert"`):** Warns of version conflicts with a direct "Resolve conflict" button.
- **Offline Indicator (`role="status"`):** Informs the measurer that work is safely preserved locally and displays queued item count.
- **Sync Paused Alert (`role="alert"`):** Displays network error message with a "Retry sync" button.
- **Active Sync Indicator:** Shows an animated spinner and active progress when flushing changes.

### 4.2 Reactive `SessionContext` Integration
[`src/contexts/SessionContext.tsx`](file:///media/sda3/Projects/Calibration/src/contexts/SessionContext.tsx) subscribes to `syncManager.onSessionSynced` and `syncManager.onConflict`. On state mutations, changes are queued through `syncManager`, eliminating ad-hoc timers and coupling state updates to verifiable backend synchronization.

---

## 5. Verification Evidence

### 5.1 Unit Tests (`src/services/sync/syncManager.test.ts`)
```
 ✓ SyncManager: Offline Operation Queue and Conflict Resolution (9)
   ✓ enqueues an operation and persists it to IndexedDB
   ✓ coalesces multiple pending update operations for the same session
   ✓ flushes queued create operation when online and notifies synced listeners
   ✓ cascades backendId and expectedVersion to subsequent queued updates
   ✓ handles HTTP 409 Conflict: marks op as conflict, notifies listener, and pauses session
   ✓ resolves conflict using choice "server" by discarding local op and adopting server session
   ✓ resolves conflict using choice "local" by adopting server version and resyncing local value
   ✓ isolates conflicts so a conflict in Session A does not block Session B
   ✓ handles network error with retry tracking and manual retry capability
```

### 5.2 Full Test Suite Summary
- **Vitest:** 13 test files, 212 tests passed (14.36s).
- **TypeScript:** `npx tsc --noEmit` returned 0 errors.
- **ESLint:** `npm run lint` returned 0 errors.
- **Vite Build:** Produced production assets cleanly (517.12 kB bundle).
- **Playwright E2E:** 14 test suites, 14 passed (1.6m).
- **Backend Pytest:** 144 tests passed (12.15s).

---

## 6. Implementation Deliverables

| File | Purpose |
| :--- | :--- |
| [`src/services/sync/types.ts`](file:///media/sda3/Projects/Calibration/src/services/sync/types.ts) | Operation, queue, and conflict data contracts. |
| [`src/services/sync/syncManager.ts`](file:///media/sda3/Projects/Calibration/src/services/sync/syncManager.ts) | Authoritative `SyncManager` service implementation. |
| [`src/services/sync/index.ts`](file:///media/sda3/Projects/Calibration/src/services/sync/index.ts) | Clean module export namespace. |
| [`src/services/sync/syncManager.test.ts`](file:///media/sda3/Projects/Calibration/src/services/sync/syncManager.test.ts) | 9 automated unit tests verifying queue, backoff, and conflict mechanics. |
| [`src/utils/storage.ts`](file:///media/sda3/Projects/Calibration/src/utils/storage.ts) | Upgraded IndexedDB schema to v2 with `sync_operations` store and CRUD methods. |
| [`src/components/shell/SyncStatusBanner.tsx`](file:///media/sda3/Projects/Calibration/src/components/shell/SyncStatusBanner.tsx) | Accessible, real-time sync and offline status banner. |
| [`src/components/shell/AppShell.tsx`](file:///media/sda3/Projects/Calibration/src/components/shell/AppShell.tsx) | Global layout wiring of `<SyncStatusBanner />`. |
| [`src/contexts/SessionContext.tsx`](file:///media/sda3/Projects/Calibration/src/contexts/SessionContext.tsx) | Synchronized context event subscription, queueing, and conflict resolution. |
| [`e2e/e2e-09-storage-recovery.spec.ts`](file:///media/sda3/Projects/Calibration/e2e/e2e-09-storage-recovery.spec.ts) | Version-agnostic IndexedDB corruption recovery verification. |
| [`docs/FEATURE_IMPLEMENTATION_MATRIX.md`](file:///media/sda3/Projects/Calibration/docs/FEATURE_IMPLEMENTATION_MATRIX.md) | Matrix updated to reflect verified Phase 10.4.4 implementation. |

