import React from 'react';
import { useSession } from '../../contexts/SessionContext';
import { formatDateTime } from '../../utils/format';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { SaveSyncText } from '../status/SaveSyncText';

export function SyncDialog() {
  const { sessions, syncDialogRef, openSyncDialog, requestSync, resolveConflict, connectivity } = useSession();
  const s = sessions.find((x) => x.reference === syncDialogRef) ?? null;
  const close = () => openSyncDialog(null);
  const offline = connectivity === 'offline';

  if (!s) return <Modal open={false} onClose={close} title="">{null}</Modal>;

  if (s.conflict) {
    const c = s.conflict;
    return (
      <Modal
        open
        onClose={close}
        size="lg"
        title={`Resolve sync conflict — ${s.reference}`}
        description="This device and the server have different values. Both versions are kept until you choose."
        footer={
        <>
            <Button onClick={close}>Decide later</Button>
            <Button onClick={() => resolveConflict(s.reference, 'server')}>Use server value</Button>
            <Button variant="primary" onClick={() => resolveConflict(s.reference, 'local')}>
              Keep this device’s value
            </Button>
          </>
        }>
        
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Conflicting values</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-sub">
              <th scope="col" className="py-2 pr-3 font-semibold">Field</th>
              <th scope="col" className="py-2 pr-3 font-semibold">This device</th>
              <th scope="col" className="py-2 font-semibold">Server</th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <th scope="row" className="py-3 pr-3 text-left font-medium">{c.label}</th>
              <td className="py-3 pr-3">
                <span className="block font-mono text-base">{c.local}</span>
                <span className="text-xs text-sub">Saved {formatDateTime(c.localAt)} · {s.operator}</span>
              </td>
              <td className="py-3">
                <span className="block font-mono text-base">{c.server}</span>
                <span className="text-xs text-sub">Saved {formatDateTime(c.serverAt)} · {c.serverActor}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4">
          <Notice tone="info" title="What happens when you choose">
            The chosen value is applied, results are recalculated, and any review that depended on the old value becomes stale. The value you do not keep is preserved in the audit trail.
          </Notice>
        </div>
      </Modal>);

  }

  const title = s.sync === 'issue' ? `Sync issue — ${s.reference}` : `Save and sync — ${s.reference}`;
  return (
    <Modal
      open
      onClose={close}
      title={title}
      footer={
      <>
          <Button onClick={close}>Close</Button>
          {s.sync === 'issue' &&
        <Button variant="primary" disabled={offline} onClick={() => requestSync(s.reference)}>
              Retry sync
            </Button>
        }
          {s.sync === 'pending' && !offline &&
        <Button variant="primary" onClick={() => requestSync(s.reference)}>
              Sync now
            </Button>
        }
        </>
      }>
      
      <div className="space-y-4 text-sm text-sub">
        <SaveSyncText save={s.save} sync={s.sync} />
        <dl className="grid grid-cols-[140px_1fr] gap-y-2">
          <dt>On this device</dt>
          <dd className="text-ink">Last saved {formatDateTime(s.updatedAt)}</dd>
          <dt>On the server</dt>
          <dd className="text-ink">
            {s.sync === 'synced' ? 'Up to date' : s.sync === 'issue' ? 'Not updated — last attempt failed' : offline ? 'Waiting for a connection' : 'Waiting to send'}
          </dd>
        </dl>
        {s.sync === 'issue' &&
        <Notice tone="error" title="The last sync attempt failed">
            The server did not confirm the update. All work is saved on this device and nothing has been lost. Retry, or keep working — changes stay queued.
          </Notice>
        }
        {offline &&
        <Notice tone="info" title="Working offline">
            Saving on this device continues as normal. Changes are sent automatically when the connection returns.
          </Notice>
        }
      </div>
    </Modal>);

}