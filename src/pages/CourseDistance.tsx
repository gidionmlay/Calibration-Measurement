import { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { DISTANCE_DISPLAY_DECIMALS, fmt, readingError } from '../utils/calibration';
import { optionLabel } from '../utils/format';
import { rolloverOptions, ruleSetOptions } from '../data/options';
import { ENGINE_VERSION } from '../utils/calibration';
import { PageHeader } from '../components/shell/PageHeader';
import { StepFooter } from '../components/shell/StepFooter';
import { NumericField } from '../components/ui/NumericField';
import { Notice } from '../components/ui/Notice';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { ErrorSummary } from '../components/ui/ErrorSummary';
import { ConstantReference } from '../components/measurement/ConstantReference';
import { WarningCard } from '../components/measurement/WarningCard';

export function CourseDistance() {
  const { active, derived, goTo, update, logEdit, markReviewed, saveDraft, readOnly } = useSession();
  const [showErrors, setShowErrors] = useState(false);
  if (!active || !derived) return null;

  const d = derived.distance;
  const wc = d.basis.wc;
  const startErr = readingError(d.start, showErrors, 'Enter the start counter reading.');
  const finishErr = readingError(d.finish, showErrors, 'Enter the finish counter reading.') ?? (d.count && !d.count.ok ? d.count.message : null);
  const count = d.count && d.count.ok ? d.count : null;
  const warning = derived.warnings.find((w) => w.id === 'distance-rollover');

  const status = !wc ?
  'Blocked — working constant unavailable' :
  d.count && !d.count.ok ?
  'Blocked — verify readings' :
  !d.complete ?
  'Incomplete — enter both readings' :
  derived.reviews.distance === 'current' ?
  'Calculated · reviewed' :
  derived.reviews.distance === 'stale' ?
  'Recalculated · review again' :
  'Calculated · not yet reviewed';

  const errorItems = [
  startErr && { label: `Start counter reading: ${startErr}`, targetId: 'distance-start' },
  finishErr && { label: `Finish counter reading: ${finishErr}`, targetId: 'distance-finish' }].
  filter((x): x is {label: string;targetId: string;} => !!x);

  const onPrimary = () => {
    if (!wc) {
      setShowErrors(true);
      window.setTimeout(() => document.getElementById('distance-wc-missing')?.focus(), 30);
      return;
    }
    if (!d.complete) {
      setShowErrors(true);
      window.setTimeout(() => document.getElementById('distance-error-summary')?.focus(), 30);
      return;
    }
    if (!readOnly && derived.reviews.distance !== 'current') markReviewed('distance');
    goTo('post');
  };

  const wcLabel = d.basis.source === 'final'
    ? `Working constant used (Final WC · ${d.basis.provisional ? 'provisional' : 'approved'})`
    : 'Working constant used (Pre-calibration WC · provisional)';

  const details = [
  { label: 'Start reading', value: d.start.ok ? String(d.start.value) : '—' },
  { label: 'Finish reading', value: d.finish.ok ? String(d.finish.value) : '—' },
  { label: 'Rollover adjustment', value: count ? count.adjustment ? `+${count.adjustment}` : 'None (finish ≥ start)' : '—' },
  { label: 'Total count  T = Finish − Start' + (count?.adjustment ? ' + adjustment' : ''), value: count ? String(count.count) : '—' },
  { label: wcLabel, value: fmt(wc) },
  { label: 'Distance = T ÷ WC (full precision)', value: d.km !== null ? `${fmt(d.km)} km` : '—' },
  { label: `Displayed distance (${DISTANCE_DISPLAY_DECIMALS} dp)`, value: d.km !== null ? `${fmt(d.km, DISTANCE_DISPLAY_DECIMALS)} km` : '—' },
  { label: 'Calculation rule version', value: `${optionLabel(ruleSetOptions, active.ruleSet)} · ${ENGINE_VERSION}` }];


  return (
    <div>
      <PageHeader title="Course distance" description="Enter the counter readings for the course measurement." />

      <div className="space-y-6">
        {wc === null ?
        <Notice
          id="distance-wc-missing"
          tone="error"
          title="Working constant unavailable — distance cannot be calculated"
          actions={
          <Button size="sm" variant="primary" onClick={() => goTo('pre')}>
                Resolve pre-calibration
              </Button>
          }>
          
            Complete all four pre-calibration rides with a valid course length. Readings entered here are kept.
          </Notice> :

        <ConstantReference id="distance-wc" />
        }

        {derived.reviews.distance === 'stale' &&
        <Notice tone="stale" title="Distance recalculated after review">
            The working constant or a counter reading changed after you reviewed this distance. Check the new result and review again.
          </Notice>
        }

        {showErrors && errorItems.length > 0 && <ErrorSummary id="distance-error-summary" title="Fix these readings to calculate the distance" items={errorItems} />}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="readings-heading" className="rounded border border-line bg-panel p-5">
            <h2 id="readings-heading" className="mb-4 text-base font-semibold">
              Counter readings
            </h2>
            <div className="space-y-5">
              <NumericField
                id="distance-start"
                label="Start counter reading"
                required
                size="lg"
                value={active.distStart}
                readOnly={readOnly}
                onChange={(v) => update((s) => ({ ...s, distStart: v }))}
                onCommit={(f, t) => logEdit('Course distance start reading', f, t)}
                error={startErr} />
              
              <NumericField
                id="distance-finish"
                label="Finish counter reading"
                required
                size="lg"
                value={active.distFinish}
                readOnly={readOnly}
                onChange={(v) => update((s) => ({ ...s, distFinish: v }))}
                onCommit={(f, t) => logEdit('Course distance finish reading', f, t)}
                error={finishErr} />
              
              <div className="border-t border-hair pt-4 text-sm">
                <p className="font-medium text-ink">Counter rollover handling</p>
                <p className="mt-0.5 text-sub">
                  {optionLabel(rolloverOptions, active.rolloverMode)}
                  {active.rolloverMode === 'wrap' && active.rolloverMax ? ` (maximum ${active.rolloverMax})` : ''} · set for this session.{' '}
                  {!readOnly &&
                  <button type="button" onClick={() => goTo('setup', 'rollover-mode')} className="font-medium text-ink underline underline-offset-2">
                      Change in Setup
                    </button>
                  }
                </p>
                <p className="mt-1 text-xs text-sub">A finish below the start is never assumed to be a rollover.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="result-heading" aria-live="polite" className="rounded border border-line bg-panel p-5">
            <h2 id="result-heading" className="text-base font-semibold">
              Result
            </h2>
            <p className="mt-4 text-xs font-medium text-sub">Measured course distance</p>
            <p className="mt-1 font-mono text-4xl font-semibold text-ink">
              {d.km !== null ? fmt(d.km, DISTANCE_DISPLAY_DECIMALS) : '—'}
              <span className="ml-1.5 font-sans text-lg font-normal text-sub">km</span>
            </p>
            <dl className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-hair pt-4 text-sm">
              <dt className="text-sub">Total count (T)</dt>
              <dd className="text-right font-mono">{count ? count.count : '—'}</dd>
              <dt className="text-sub">Rollover adjustment</dt>
              <dd className="text-right font-mono">{count ? count.adjustment ? `+${count.adjustment}` : 'None' : '—'}</dd>
              <dt className="text-sub">Calculation status</dt>
              <dd className="text-right font-medium">{status}</dd>
            </dl>
          </section>
        </div>

        {warning && <WarningCard warning={warning} />}

        <Disclosure id="distance-calc-details" title="Calculation details" summary="Readings, formula and full precision">
          <dl className="divide-y divide-hair text-sm">
            {details.map((row) =>
            <div key={row.label} className="grid gap-1 py-2 md:grid-cols-[300px_minmax(0,1fr)]">
                <dt className="text-sub">{row.label}</dt>
                <dd className="font-mono text-ink">{row.value}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-sub">Stored at full precision. Rounding applies only to display and the report.</p>
        </Disclosure>
      </div>

      <StepFooter
        backLabel="Back to pre-calibration"
        onBack={() => goTo('pre')}
        onSaveDraft={readOnly ? undefined : saveDraft}
        primaryLabel={readOnly ? 'Next' : 'Review distance'}
        onPrimary={onPrimary} />
      
    </div>);

}