import { useSession } from '../../contexts/SessionContext';
import { setLabels } from '../../data/options';
import type { CalibrationSet } from '../../types/session';
import { ErrorSummary } from '../ui/ErrorSummary';
import { RideTable } from './RideTable';
import { CalibrationSummary } from './CalibrationSummary';
import { WarningCard } from './WarningCard';

interface CalibrationWorkspaceProps {
  set: CalibrationSet;
  showErrors: boolean;
}

/** Shared four-ride workspace used by pre- and post-calibration — one component, one formula engine. */
export function CalibrationWorkspace({ set, showErrors }: CalibrationWorkspaceProps) {
  const { active, derived } = useSession();
  if (!active || !derived) return null;
  const result = derived[set];
  const warnings = derived.warnings.filter((w) => w.step === set);

  const errorItems: {label: string;targetId: string;}[] = [];
  if (showErrors && !result.complete) {
    result.rides.forEach((r) => {
      const n = r.index + 1;
      if (!r.linked && !r.start.ok) errorItems.push({ label: `Ride ${n} start: ${r.start.reason === 'invalid' ? 'invalid number' : 'missing'}`, targetId: `${set}-ride-${n}-start` });
      if (!r.finish.ok) errorItems.push({ label: `Ride ${n} finish: ${r.finish.reason === 'invalid' ? 'invalid number' : 'missing'}`, targetId: `${set}-ride-${n}-finish` });
      if (r.count && !r.count.ok) errorItems.push({ label: `Ride ${n}: finish is lower than start`, targetId: `${set}-ride-${n}-finish` });
    });
  }

  return (
    <div className="space-y-8">
      {errorItems.length > 0 &&
      <ErrorSummary id={`${set}-error-summary`} title={`${errorItems.length} reading${errorItems.length === 1 ? '' : 's'} must be fixed before continuing`} items={errorItems} />
      }

      <section aria-labelledby={`${set}-rides-heading`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${set}-rides-heading`} className="text-base font-semibold text-ink">
            {setLabels[set]} rides
          </h2>
          <p className="text-xs text-sub">
            Difference = Finish − Start{active.example ? ' · Illustrative prototype data' : ''}
          </p>
        </div>
        <RideTable set={set} result={result} showErrors={showErrors} />
      </section>

      {warnings.length > 0 &&
      <section aria-labelledby={`${set}-warnings-heading`}>
          <h2 id={`${set}-warnings-heading`} className="mb-3 text-base font-semibold text-ink">
            Warnings ({warnings.filter((w) => w.ack !== 'current').length} open)
          </h2>
          <div className="space-y-3">
            {warnings.map((w) =>
          <WarningCard key={w.id} warning={w} />
          )}
          </div>
        </section>
      }

      <CalibrationSummary set={set} result={result} />
    </div>);

}