import React from 'react';
import { useSession } from '../../contexts/SessionContext';
import { WC_DISPLAY_DECIMALS, fmt, fmtSigned } from '../../utils/calibration';
import { optionLabel } from '../../utils/format';
import { finalRuleOptions } from '../../data/options';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

export function ComparisonPanel() {
  const { active, derived, goTo } = useSession();
  if (!active || !derived) return null;
  const c = derived.comparison;
  const rows = [
  { label: 'Pre-calibration WC', value: fmt(c.pre, WC_DISPLAY_DECIMALS), full: fmt(c.pre) },
  { label: 'Post-calibration WC', value: fmt(c.post, WC_DISPLAY_DECIMALS), full: fmt(c.post) },
  { label: 'Difference (post − pre)', value: fmtSigned(c.difference, WC_DISPLAY_DECIMALS), full: fmt(c.difference) },
  { label: 'Percentage difference (difference ÷ pre × 100)', value: c.percent !== null ? `${fmtSigned(c.percent, 4)} %` : '—', full: fmt(c.percent) }];

  const reviewText = { none: 'Not yet reviewed', current: 'Reviewed', stale: 'Stale — a calibration set changed after review' }[derived.reviews.comparison];

  return (
    <section aria-labelledby="comparison-heading" className="space-y-4">
      <h2 id="comparison-heading" className="text-base font-semibold text-ink">
        Comparison of constants
      </h2>
      <div className="rounded border border-line bg-panel">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Pre and post calibration comparison</caption>
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-sub">
              <th scope="col" className="px-4 py-2.5 font-semibold">Measure</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Value</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold md:table-cell">Full precision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
            <tr key={r.label} className="border-b border-hair last:border-b-0">
                <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">{r.label}</th>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">{r.value}</td>
                <td className="hidden px-4 py-2.5 text-right font-mono text-sub md:table-cell">{r.full}</td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="grid gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-sm md:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="text-sub">Comparison status</dt>
          <dd className="text-ink">
            {c.difference === null ?
            'Incomplete — needs both working constants.' :
            'Descriptive only. No acceptance rule is configured, so this comparison is not judged acceptable or unacceptable.'}
          </dd>
          <dt className="text-sub">Review</dt>
          <dd className="text-ink">{reviewText}</dd>
        </dl>
      </div>

      {active.finalRule === 'notConfigured' ?
      <Notice
        tone="warning"
        title="Final constant selection rule not configured"
        actions={
        <Button size="sm" onClick={() => goTo('setup', 'final-rule')}>
              Open rule in Setup
            </Button>
        }>
        
          The governing standard has not confirmed whether the final constant is the larger value, the average, or another value. No final constant is selected, and the session cannot be finalized until a rule is configured.
        </Notice> :

      <div className="rounded border border-ink bg-panel p-4">
          <p className="text-xs font-medium text-sub">Final constant</p>
          <p className="mt-1 font-mono text-xl font-semibold">{fmt(derived.finalConstant, WC_DISPLAY_DECIMALS)}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm md:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-sub">Rule applied</dt>
            <dd>{optionLabel(finalRuleOptions, active.finalRule)}</dd>
            <dt className="text-sub">Source values</dt>
            <dd className="font-mono">
              pre {fmt(c.pre)} · post {fmt(c.post)}
            </dd>
            <dt className="text-sub">Full precision</dt>
            <dd className="font-mono">{fmt(derived.finalConstant)}</dd>
          </dl>
        </div>
      }
    </section>);

}