/**
 * SyncStatusBanner: Persistent banner communicating network state,
 * offline queue status, synchronization activity, and conflict alerts.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangleIcon,
  CloudUploadIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from 'lucide-react';
import { syncManager } from '../../services/sync';
import type { SyncStatus } from '../../services/sync';
import { useSession } from '../../contexts/SessionContext';
import { Button } from '../ui/Button';

export function SyncStatusBanner(): React.ReactElement | null {
  const { connectivity, openSyncDialog, active } = useSession();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => syncManager.getStatus());

  useEffect(() => {
    return syncManager.subscribe((status) => {
      setSyncStatus(status);
    });
  }, []);

  const isOffline = connectivity === 'offline' || !syncStatus.isOnline;

  // 1. Conflict Alert (Highest priority warning)
  if (syncStatus.conflictCount > 0) {
    return (
      <aside
        role="alert"
        aria-live="assertive"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-ink bg-panel p-3 shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangleIcon className="h-5 w-5 flex-shrink-0 text-ink" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">
              Sync conflict detected ({syncStatus.conflictCount} session{syncStatus.conflictCount === 1 ? '' : 's'})
            </p>
            <p className="text-xs text-sub">
              This device and the server disagree on recent values. Both versions are preserved.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (active) {
                openSyncDialog(active.reference);
              } else {
                const conflictOp = syncManager.getQueue().find((o) => o.status === 'conflict');
                if (conflictOp) openSyncDialog(conflictOp.sessionRef);
              }
            }}
          >
            Resolve conflict
          </Button>
        </div>
      </aside>
    );
  }

  // 2. Offline Notice
  if (isOffline) {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-fill p-3 text-ink"
      >
        <div className="flex items-center gap-2.5">
          <WifiOffIcon className="h-4 w-4 flex-shrink-0 text-sub" aria-hidden="true" />
          <p className="text-xs font-medium">
            Working offline. All changes are saved locally to this device and queued for sync. Finalization is disabled until connected.
          </p>
        </div>
        {syncStatus.pendingCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-panel px-2 py-0.5 text-xs font-mono font-medium text-sub">
            <CloudUploadIcon className="h-3 w-3" aria-hidden="true" />
            {syncStatus.pendingCount} queued
          </span>
        )}
      </aside>
    );
  }

  // 3. Failed Sync / Paused with retry
  if (syncStatus.failedCount > 0) {
    return (
      <aside
        role="alert"
        aria-live="assertive"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-ink/40 bg-panel p-3 text-ink"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangleIcon className="h-4 w-4 flex-shrink-0 text-ink" aria-hidden="true" />
          <div>
            <p className="text-xs font-medium text-ink">
              Synchronization paused ({syncStatus.failedCount} operation{syncStatus.failedCount === 1 ? '' : 's'} pending)
            </p>
            <p className="text-xs text-sub">{syncStatus.lastError ?? 'Network communication issue'}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void syncManager.retry();
          }}
        >
          <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Retry sync
        </Button>
      </aside>
    );
  }

  // 4. In-progress sync indicator
  if (syncStatus.isSyncing) {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="mb-4 flex items-center gap-2 rounded border border-line bg-fill px-3 py-2 text-xs text-sub"
      >
        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>Syncing {syncStatus.pendingCount} queued change{syncStatus.pendingCount === 1 ? '' : 's'} with server…</span>
      </aside>
    );
  }

  return null;
}

