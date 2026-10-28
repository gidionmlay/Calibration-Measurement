import React from 'react';
import { CloudIcon, CloudUploadIcon, HardDriveIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import type { SaveStatus, SyncStatus } from '../../types/session';

const syncMeta: Record<SyncStatus, {Icon: typeof CloudIcon;label: string;}> = {
  pending: { Icon: CloudUploadIcon, label: 'Sync pending' },
  synced: { Icon: CloudIcon, label: 'Synced' },
  issue: { Icon: TriangleAlertIcon, label: 'Sync issue' }
};

export function SaveSyncText({ save, sync }: {save: SaveStatus;sync: SyncStatus;}) {
  const SyncIcon = syncMeta[sync].Icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {save === 'saving' ?
        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> :

        <HardDriveIcon className="h-3.5 w-3.5" aria-hidden="true" />
        }
        {save === 'saving' ? 'Saving…' : 'Saved on this device'}
      </span>
      <span aria-hidden="true">·</span>
      <span className={`inline-flex items-center gap-1 whitespace-nowrap ${sync === 'issue' ? 'font-semibold text-ink' : ''}`}>
        <SyncIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {syncMeta[sync].label}
      </span>
    </span>);

}