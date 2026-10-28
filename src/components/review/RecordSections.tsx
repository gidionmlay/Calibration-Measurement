import React from 'react';
import { useSession } from '../../contexts/SessionContext';
import { DISTANCE_DISPLAY_DECIMALS, ENGINE_VERSION, WC_DISPLAY_DECIMALS, fmt, fmtSigned } from '../../utils/calibration';
import { optionLabel } from '../../utils/format';
import { consistencyOptions, finalRuleOptions, rolloverOptions, ruleSetOptions } from '../../data/options';
import type { StepId } from '../../types/session';
import { Disclosure } from '../ui/Disclosure';
import { Button } from '../ui/Button';
import { RidesReadout } from './RidesReadout';

function Pairs({ rows }: {rows: {label: string;value: string;}[];}) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[200px_minmax(0,1fr)]">
      {rows.map((r) =>
      <React.Fragment key={r.label}>
          <dt className="text-sub">{r.label}</dt>
          <dd className="font-mono text-ink">{r.value}</dd>
        </React.Fragment>
      )}
    </dl>);

}

const reviewText = { none: 'Not reviewed', current: 'Reviewed', stale: 'Stale' };

export function RecordSections() {
  const { active, derived, goTo, readOnly } = useSession();
  if (!active || !derived) return null;
  const action = (step: StepId) =>
  <Button size="sm" onClick={() => goTo(step)}>
      {readOnly ? 'View details' : 'Edit step'}
    </Button>;

  const warningsFor = (step: StepId) => {
    const ws = derived.warnings.filter((w) => w.step === step);
    if (!ws.length) return 'None';
    return ws.map((w) => `${w.title} (${w.ack === 'current' ? 'reviewed' : w.ack === 'stale' ? 'review out of date' : 'not reviewed'})`).join('; ');
  };
  const { pre, post, distance, comparison } = derived;
  const dc = distance.count && distance.count.ok ? distance.count : null;

  return (
    <div className="space-y-3">
      <Disclosure id="record-setup" title="1. Session setup" summary={`${derived.length.ok ? `${fmt(derived.length.value)} m` : 'Length missing'} · ${optionLabel(ruleSetOptions, active.ruleSet)}`}>
        <Pairs
          rows={[
          { label: 'Course length', value: derived.length.ok ? `${fmt(derived.length.value)} m` : '—' },
          { label: 'Operator', value: active.operator },
          { label: 'Counter rollover', value: `${optionLabel(rolloverOptions, active.rolloverMode)}${active.rolloverMode === 'wrap' ? ` (max ${active.rolloverMax || '—'})` : ''}` },
          { label: 'Ride-consistency rule', value: optionLabel(consistencyOptions, active.consistencyRule) },
          { label: 'Final constant rule', value: optionLabel(finalRuleOptions, active.finalRule) },
          { label: 'Rule-set version', value: `${optionLabel(ruleSetOptions, active.ruleSet)} · ${ENGINE_VERSION}` }]
          } />
        
        <div className="mt-4">{action('setup')}</div>
      </Disclosure>

      <Disclosure id="record-pre" title="2. Pre-calibration" summary={`WC ${fmt(pre.wc, WC_DISPLAY_DECIMALS)} · ${reviewText[derived.reviews.pre]}`}>
        <RidesReadout result={pre} caption="Pre-calibration rides" />
        <div className="mt-4">
          <Pairs
            rows={[
            { label: 'Total (D)', value: fmt(pre.total) },
            { label: 'Average', value: fmt(pre.average) },
            { label: 'CPK', value: fmt(pre.cpk) },
            { label: 'WC (full precision)', value: fmt(pre.wc) }]
            } />
          
        </div>
        <p className="mt-3 text-sm text-sub">Warnings and overrides: {warningsFor('pre')}</p>
        <div className="mt-4">{action('pre')}</div>
      </Disclosure>

      <Disclosure id="record-distance" title="3. Course distance" summary={`${distance.km !== null ? `${fmt(distance.km, DISTANCE_DISPLAY_DECIMALS)} km` : 'Incomplete'} · ${reviewText[derived.reviews.distance]}`}>
        <Pairs
          rows={[
          { label: 'Start reading', value: active.distStart || '—' },
          { label: 'Finish reading', value: active.distFinish || '—' },
          { label: 'Rollover adjustment', value: dc ? dc.adjustment ? `+${dc.adjustment}` : 'None' : '—' },
          { label: 'Total count (T)', value: dc ? String(dc.count) : '—' },
          { label: 'WC used', value: `${fmt(distance.wc)} (${distance.basis.source === 'final' ? 'final constant' : 'pre-cal WC'}${distance.basis.provisional ? ' · provisional' : ''})` },
          { label: 'Distance (full precision)', value: distance.km !== null ? `${fmt(distance.km)} km` : '—' }]
          } />
        
        <div className="mt-4">{action('distance')}</div>
      </Disclosure>

      <Disclosure id="record-post" title="4. Post-calibration" summary={`WC ${fmt(post.wc, WC_DISPLAY_DECIMALS)} · ${reviewText[derived.reviews.comparison]}`}>
        <RidesReadout result={post} caption="Post-calibration rides" />
        <div className="mt-4">
          <Pairs
            rows={[
            { label: 'Post-calibration WC', value: fmt(post.wc) },
            { label: 'Difference (post − pre)', value: fmtSigned(comparison.difference, WC_DISPLAY_DECIMALS) },
            { label: 'Percentage difference', value: comparison.percent !== null ? `${fmtSigned(comparison.percent, 4)} %` : '—' },
            {
              label: 'Final constant rule',
              value: active.finalRule === 'notConfigured' ? 'Not configured — no final constant selected' : `${optionLabel(finalRuleOptions, active.finalRule)} → ${fmt(derived.finalConstant)}`
            }]
            } />
          
        </div>
        <p className="mt-3 text-sm text-sub">Warnings and overrides: {warningsFor('post')}</p>
        <div className="mt-4">{action('post')}</div>
      </Disclosure>
    </div>);

}