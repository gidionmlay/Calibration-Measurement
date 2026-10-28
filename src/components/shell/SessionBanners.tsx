import React from 'react';
import { useSession } from '../../contexts/SessionContext';
import { workflowSteps } from '../../data/options';
import { formatDateTime } from '../../utils/format';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

/** Restore, read-only and sync-problem banners shared by every step page. */
export function SessionBanners() {
  const { active, derived, view, restoreInfo, dismissRestore, openSyncDialog, goTo } = useSession();
  if (!active || !derived || view === 'list') return null;

  const stepLabel = workflowSteps.find((s) => s.id === restoreInfo?.step)?.label;
  const openCount = derived.openWarnings.length;

  return (
    <div className="mb-6 space-y-3 empty:hidden">
      {restoreInfo && restoreInfo.reference === active.reference &&
      <Notice
        tone="info"
        title={`Session restored at ${stepLabel}`}
        actions={
        <>
              {openCount > 0 &&
          <Button size="sm" onClick={() => goTo('review', 'warnings-panel')}>
                  View {openCount} open warning{openCount === 1 ? '' : 's'}
                </Button>
          }
              <Button size="sm" variant="ghost" onClick={dismissRestore}>
                Dismiss
              </Button>
            </>
        }>
        
          Restored from the copy saved on this device ({formatDateTime(restoreInfo.savedAt)}). Inputs were revalidated and every calculation was rerun.
          {active.sync !== 'synced' && ' Unsynced work has been kept.'}
        </Notice>
      }
      {active.finalized && view !== 'review' &&
      <Notice tone="success" title="Finalized record — read-only">
          Finalized {formatDateTime(active.finalized.at)} by {active.finalized.by}. Corrections require an authorized formal revision that preserves this original.
        </Notice>
      }
      {active.conflict &&
      <Notice
        tone="error"
        title="Sync conflict — this device and the server disagree"
        actions={
        <Button size="sm" variant="primary" onClick={() => openSyncDialog(active.reference)}>
              Resolve conflict
            </Button>
        }>
        
          {active.conflict.label}: this device has {active.conflict.local}, the server has {active.conflict.server}. Both are kept until you choose.
        </Notice>
      }
      {!active.conflict && active.sync === 'issue' &&
      <Notice
        tone="warning"
        title="Sync issue"
        actions={
        <Button size="sm" onClick={() => openSyncDialog(active.reference)}>
              Retry sync
            </Button>
        }>
        
          Your work is saved on this device, but the server has not received the latest changes.
        </Notice>
      }
    </div>);

}