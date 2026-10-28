import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon, LockIcon } from 'lucide-react';
import type { SessionState } from '../../types/session';

const icons: Record<SessionState, typeof LockIcon> = {
  Draft: CircleDashedIcon,
  'In progress': CircleDotIcon,
  'Needs review': CircleAlertIcon,
  'Ready for final review': CircleCheckIcon,
  Finalized: LockIcon
};

export function SessionStateBadge({ state }: {state: SessionState;}) {
  const Icon = icons[state];
  const strong = state === 'Finalized';
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${strong ? 'bg-ink text-white' : 'border border-line bg-panel text-ink'} ${state === 'Needs review' ? 'border-ink' : ''}`}>
      
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">Session state: </span>
      {state}
    </span>);

}