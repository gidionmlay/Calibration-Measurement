import { LockIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { ENGINE_VERSION, WC_DISPLAY_DECIMALS, fmt } from '../../utils/calibration';
import { optionLabel } from '../../utils/format';
import { finalRuleOptions, ruleSetOptions } from '../../data/options';
import { Button } from '../ui/Button';

const reviewText = { none: 'Not yet reviewed', current: 'Reviewed', stale: 'Stale — changed after review' };

/** Read-only reference to the applicable working constant governing course distance. */
export function ConstantReference({ id }: {id: string;}) {
  const { active, derived, goTo } = useSession();
  if (!active || !derived) return null;
  const basis = derived.distance.basis;
  const wc = basis.wc;
  const isFinal = basis.source === 'final';

  return (
    <section id={id} tabIndex={-1} aria-label="Governing working constant (read-only)" className="rounded border border-line bg-canvas p-4 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <LockIcon className="mt-1 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-sub">
                {isFinal
                  ? `Final working constant (${optionLabel(finalRuleOptions, active.finalRule)}) · read-only`
                  : 'Pre-calibration working constant (provisional) · read-only'}
              </p>
              {basis.provisional && (
                <span className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sub">
                  Provisional
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xl font-semibold text-ink">
              {fmt(wc, WC_DISPLAY_DECIMALS)} <span className="font-sans text-sm font-normal text-sub">counts per km</span>
            </p>
            <p className="mt-0.5 text-xs text-sub">
              {reviewText[isFinal ? derived.reviews.comparison : derived.reviews.pre]} · {optionLabel(ruleSetOptions, active.ruleSet)} · {ENGINE_VERSION}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => goTo(isFinal ? 'post' : 'pre', isFinal ? 'comparison-panel' : 'pre-calc-details')}>
          {isFinal ? 'Inspect final comparison' : 'Inspect pre-calibration breakdown'}
        </Button>
      </div>
    </section>);
}