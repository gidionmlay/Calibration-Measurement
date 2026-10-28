import React from 'react';
import { useSession } from '../../contexts/SessionContext';
import { SessionStateBadge } from '../status/SessionStateBadge';
import { SaveSyncText } from '../status/SaveSyncText';

interface PageHeaderProps {
  title: string;
  description: string;
  aside?: React.ReactNode;
}

export function PageHeader({ title, description, aside }: PageHeaderProps) {
  const { active, derived, view, openSyncDialog } = useSession();
  const inSession = !!active && !!derived && view !== 'list';

  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {inSession && active && derived &&
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:hidden">
            <span className="font-mono text-sm font-medium md:hidden">{active.reference}</span>
            <span className="md:hidden">
              <SessionStateBadge state={derived.state} />
            </span>
            <button type="button" onClick={() => openSyncDialog(active.reference)} className="rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
              <SaveSyncText save={active.save} sync={active.sync} />
            </button>
          </div>
        }
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-sub">{description}</p>
      </div>
      {aside}
    </div>);

}