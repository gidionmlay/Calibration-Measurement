import React from 'react';
import { CORRECTION_FACTOR, ENGINE_VERSION, WC_DISPLAY_DECIMALS, fmt, type CalibrationResult } from '../../utils/calibration';
import { setLabels } from '../../data/options';
import type { CalibrationSet } from '../../types/session';
import { Disclosure } from '../ui/Disclosure';

interface CalibrationSummaryProps {
  set: CalibrationSet;
  result: CalibrationResult;
}

export function CalibrationSummary({ set, result }: CalibrationSummaryProps) {
  const { total, average, courseLengthM, courseKm, cpk, wc, counts } = result;
  const stats = [
  { label: 'Total counts (D)', value: fmt(total) },
  { label: 'Average per ride', value: fmt(average) },
  { label: 'Course length', value: courseKm !== null ? `${fmt(courseKm)} km` : '—' },
  { label: 'Counts per km (CPK)', value: fmt(cpk) }];

  const countText = counts.map((c) => c === null ? '?' : String(c)).join(' + ');
  const steps = [
  { label: 'Total counts', formula: 'D = sum of the four ride differences', working: countText, result: fmt(total) },
  { label: 'Average per ride', formula: 'Average = D ÷ 4', working: `${fmt(total)} ÷ 4`, result: fmt(average) },
  { label: 'Course length in km', formula: 'km = metres ÷ 1000', working: `${courseLengthM ?? '?'} ÷ 1000`, result: fmt(courseKm) },
  { label: 'Counts per km', formula: 'CPK = Average ÷ km', working: `${fmt(average)} ÷ ${fmt(courseKm)}`, result: fmt(cpk) },
  { label: 'Working constant', formula: `WC = CPK × ${CORRECTION_FACTOR}`, working: `${fmt(cpk)} × ${CORRECTION_FACTOR}`, result: fmt(wc) }];

  const headingId = `${set}-summary-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-base font-semibold text-ink">
        {setLabels[set]} working constant
      </h2>
      <div className="rounded border border-line bg-panel">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-4">
            {stats.map((s) =>
            <div key={s.label}>
                <dt className="text-xs text-sub">{s.label}</dt>
                <dd className="mt-1 font-mono text-base text-ink">{s.value}</dd>
              </div>
            )}
          </dl>
          <dl className="border-t border-line p-4 lg:border-l lg:border-t-0">
            <dt className="text-xs font-medium text-sub">Working constant (WC)</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-ink">{fmt(wc, WC_DISPLAY_DECIMALS)}</dd>
            <dd className="mt-1 text-xs text-sub">counts per km · shown to {WC_DISPLAY_DECIMALS} dp</dd>
          </dl>
        </div>
        {!result.complete &&
        <p className="border-t border-line px-4 py-2.5 text-sm text-sub">Incomplete — results appear when all four rides and the course length are valid.</p>
        }
      </div>

      <div className="mt-3">
        <Disclosure id={`${set}-calc-details`} title="Calculation details" summary="Formulas, values and full precision">
          <ol className="divide-y divide-hair">
            {steps.map((s, i) =>
            <li key={s.label} className="grid gap-1 py-2.5 text-sm md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_140px] md:items-baseline md:gap-4">
                <span className="font-medium text-ink">
                  {i + 1}. {s.label}
                </span>
                <span className="font-mono text-[13px] text-sub">{s.formula}</span>
                <span className="font-mono text-[13px] text-ink">{s.working}</span>
                <span className="font-mono font-semibold text-ink md:text-right">= {s.result}</span>
              </li>
            )}
          </ol>
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-sub">
            <li>Correction factor {CORRECTION_FACTOR} (+0.1%) per the working specification. It is applied once, to CPK.</li>
            <li>All values are stored at full precision. Rounding is for display only and never changes the stored result.</li>
            <li>{ENGINE_VERSION}</li>
          </ul>
        </Disclosure>
      </div>
    </section>);

}