import React from 'react';
import { MenuIcon, WifiOffIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { SessionStateBadge } from '../status/SessionStateBadge';
import { SaveSyncText } from '../status/SaveSyncText';
import { OperatorMenu } from './OperatorMenu';

export function Header({ onMenu }: {onMenu: () => void;}) {
  const { active, derived, view, connectivity, openSyncDialog } = useSession();
  const inSession = !!active && !!derived && view !== 'list';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-panel px-3 md:px-5">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="grid h-10 w-10 place-items-center rounded hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink md:hidden">
        
        <MenuIcon className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-ink">Bicycle Calibration</p>
        <p className="truncate text-xs text-sub">Road Course Measurement</p>
      </div>

      {inSession && active && derived &&
      <div className="ml-3 hidden items-center gap-2 border-l border-line pl-4 md:flex">
          <span className="sr-only">Current session</span>
          <span className="font-mono text-sm font-medium text-ink">{active.reference}</span>
          <SessionStateBadge state={derived.state} />
        </div>
      }

      <div className="ml-auto flex items-center gap-2">
        {connectivity === 'offline' &&
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-dashed border-ink px-2 py-1 text-xs font-medium text-ink">
            <WifiOffIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Working offline
          </span>
        }
        {inSession && active &&
        <button
          type="button"
          onClick={() => openSyncDialog(active.reference)}
          className="hidden rounded px-2 py-1.5 hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink lg:block">
          
            <SaveSyncText save={active.save} sync={active.sync} />
            <span className="sr-only"> — view save and sync details</span>
          </button>
        }
        <OperatorMenu />
      </div>
    </header>);

}