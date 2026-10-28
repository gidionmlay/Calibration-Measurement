import React from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { workflowSteps } from '../../data/options';
import type { WarningItem } from '../../utils/sessionRules';
import { Button } from '../ui/Button';

const ackText = {
  none: 'Not reviewed',
  current: 'Reviewed. This records that you inspected it — it does not confirm the data is correct.',
  stale: 'Review out of date — the data changed after it was reviewed.'
};

export function WarningCard({ warning }: {warning: WarningItem;}) {
  const { acknowledge, goTo, view, readOnly } = useSession();
  const here = view === warning.step;
  const stepLabel = workflowSteps.find((s) => s.id === warning.step)?.label ?? '';
  const done = warning.ack === 'current';
  const titleId = `${warning.id}-title`;

  return (
    <article aria-labelledby={titleId} className={`rounded bg-panel p-4 ${done ? 'border border-line' : 'border-2 border-dashed border-ink'}`}>
      <div className="flex gap-3">
        <TriangleAlertIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-ink">
            <span className="mr-2 inline-block rounded-sm bg-ink px-1.5 py-px align-[1px] text-[11px] font-semibold uppercase tracking-wide text-white">{done ? 'Reviewed' : 'Warning'}</span>
            {warning.title}
          </h3>
          <dl className="mt-2.5 grid gap-x-4 gap-y-1.5 text-sm md:grid-cols-[130px_minmax(0,1fr)]">
            <dt className="text-sub">Affected</dt>
            <dd className="text-ink">{warning.affected}</dd>
            <dt className="text-sub">Why it matters</dt>
            <dd className="text-ink">{warning.explanation}</dd>
            <dt className="text-sub">What you can do</dt>
            <dd className="text-ink">{warning.action}</dd>
            <dt className="text-sub">Review status</dt>
            <dd className={warning.ack === 'none' ? 'font-medium text-ink' : 'text-ink'}>{ackText[warning.ack]}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {warning.focusId &&
            <Button size="sm" onClick={() => goTo(warning.step, warning.focusId)}>
                {here ? 'Go to affected reading' : `Open ${stepLabel}`}
              </Button>
            }
            {!readOnly && !done &&
            <Button size="sm" variant="primary" onClick={() => acknowledge(warning.id)}>
                Mark as reviewed
              </Button>
            }
          </div>
        </div>
      </div>
    </article>);

}