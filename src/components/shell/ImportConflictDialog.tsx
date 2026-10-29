import { AlertTriangleIcon, CopyIcon, LockIcon, RefreshCwIcon, ShieldAlertIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ImportConflictDialogProps {
  open: boolean;
  reference: string;
  copyReference: string;
  existingFinalized?: boolean;
  auditLossDetected?: boolean;
  auditLossCount?: number;
  auditLossReason?: string;
  onResolve: (strategy: 'copy' | 'overwrite') => void;
  onCancel: () => void;
}

export function ImportConflictDialog({
  open,
  reference,
  copyReference,
  existingFinalized = false,
  auditLossDetected = false,
  auditLossCount = 0,
  auditLossReason,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  const overwriteBlocked = existingFinalized || auditLossDetected;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="md"
      title="Session import conflict"
      description={`A calibration session with reference "${reference}" already exists on this device.`}
      footer={
        <>
          <Button onClick={onCancel} data-testid="import-conflict-cancel-btn">
            Cancel
          </Button>
          <Button
            icon={<CopyIcon className="h-4 w-4" />}
            variant="primary"
            onClick={() => onResolve('copy')}
            data-testid="import-conflict-copy-btn"
          >
            Import as copy ({copyReference})
          </Button>
          {overwriteBlocked ? (
            <Button
              icon={<LockIcon className="h-4 w-4" />}
              disabled
              data-testid="import-conflict-overwrite-disabled"
              className="cursor-not-allowed opacity-50 border-gray-300 text-gray-400"
              title={
                existingFinalized
                  ? 'Cannot overwrite a finalized record'
                  : 'Cannot overwrite: local audit events would be lost'
              }
            >
              Overwrite blocked
            </Button>
          ) : (
            <Button
              icon={<RefreshCwIcon className="h-4 w-4" />}
              onClick={() => onResolve('overwrite')}
              data-testid="import-conflict-overwrite-btn"
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
            >
              Overwrite existing
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink">
        {existingFinalized && (
          <div
            className="flex items-start gap-3 rounded border border-red-300 bg-red-50 p-3 text-red-900"
            data-testid="conflict-finalized-warning"
          >
            <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-red-950">Finalized record protection (Overwrite Prohibited)</p>
              <p>
                The existing local session <strong className="font-mono">{reference}</strong> is <strong>finalized and locked</strong>.
                Overwriting finalized measurement records is strictly prohibited to prevent data alteration or unlocking of reviewed work.
                You must import this backup file as a separate copy or cancel.
              </p>
            </div>
          </div>
        )}

        {!existingFinalized && auditLossDetected && (
          <div
            className="flex items-start gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"
            data-testid="conflict-audit-loss-warning"
          >
            <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-amber-950">Audit history protection (Overwrite Prohibited)</p>
              <p>
                {auditLossReason ? (
                  <span>{auditLossReason} </span>
                ) : (
                  <span>
                    The existing local session contains <strong>{auditLossCount} local audit event(s)</strong> or edits that are absent from the incoming backup file.{' '}
                  </span>
                )}
                Overwriting would silently erase or alter local audit history.
                To preserve complete measurement provenance, import this backup as a separate copy.
              </p>
            </div>
          </div>
        )}

        {!existingFinalized && !auditLossDetected && (
          <div className="flex items-start gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-amber-950">Safety conflict protection</p>
              <p>
                To protect historical measurements from accidental data loss, existing records are never silently replaced.
              </p>
            </div>
          </div>
        )}

        <div className="rounded border border-line bg-panel p-3 space-y-2 text-xs">
          <div>
            <span className="font-semibold text-ink">Option 1: Import as new copy (Recommended)</span>
            <p className="text-sub">
              Creates a separate copy assigned to reference <strong className="font-mono text-ink">{copyReference}</strong>. The original user readings, overrides, and audit history are retained, and an audit entry documents the lineage from <strong className="font-mono text-ink">{reference}</strong>.
            </p>
          </div>
          <div className="border-t border-hair pt-2">
            <span className="font-semibold text-ink">
              Option 2: Explicit overwrite {overwriteBlocked ? '(Unavailable)' : ''}
            </span>
            <p className="text-sub">
              {existingFinalized
                ? 'Unavailable: Finalized records cannot be overwritten.'
                : auditLossDetected
                ? 'Unavailable: Local session has unexported audit events that would be lost.'
                : `Replaces the local session draft ${reference} with the backup file. All existing audit entries match the backup.`}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
