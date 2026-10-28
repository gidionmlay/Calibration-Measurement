import React, { Fragment, useId, useState } from 'react';
import { CheckIcon, CircleDashedIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { readingError, type CalibrationResult, type ResolvedRide } from '../../utils/calibration';
import { withRides } from '../../utils/sessionFactory';
import { setLabels } from '../../data/options';
import type { CalibrationSet } from '../../types/session';
import { NumericField } from '../ui/NumericField';
import { Button } from '../ui/Button';
import { ErrorText } from '../ui/ErrorText';

interface RideTableProps {
  set: CalibrationSet;
  result: CalibrationResult;
  showErrors: boolean;
}

type StatusTone = 'ok' | 'error' | 'pending' | 'flag';

function rideStatus(r: ResolvedRide, showErrors: boolean): {tone: StatusTone;text: string;} {
  if (r.start.ok && r.finish.ok) {
    if (r.count && !r.count.ok) return { tone: 'error', text: 'Finish below start' };
    if (r.overridden) return { tone: 'flag', text: 'Valid · start overridden' };
    return { tone: 'ok', text: 'Valid' };
  }
  if (!r.start.ok && r.start.reason === 'invalid' || !r.finish.ok && r.finish.reason === 'invalid') return { tone: 'error', text: 'Invalid reading' };
  if (showErrors) return { tone: 'error', text: 'Missing reading' };
  if (r.linked && !r.start.ok) return { tone: 'pending', text: `Waiting for Ride ${r.index} finish` };
  return { tone: 'pending', text: 'Awaiting readings' };
}

const statusIcons: Record<StatusTone, typeof CheckIcon> = {
  ok: CheckIcon,
  error: OctagonXIcon,
  pending: CircleDashedIcon,
  flag: TriangleAlertIcon
};

function StatusTag({ tone, text }: {tone: StatusTone;text: string;}) {
  const Icon = statusIcons[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${tone === 'pending' ? 'text-sub' : 'font-medium text-ink'}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {text}
    </span>);

}

function OverrideEditor({ rideNumber, linkedValue, onConfirm, onCancel }: {rideNumber: number;linkedValue: string;onConfirm: (reason: string) => void;onCancel: () => void;}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const id = useId();
  const invalid = tried && !reason.trim();
  return (
    <div className="rounded border-2 border-dashed border-ink bg-panel p-4">
      <p className="text-sm font-semibold text-ink">Override Ride {rideNumber} linked start</p>
      <p className="mt-1 max-w-2xl text-sm text-sub">
        The start will stop following Ride {rideNumber - 1} finish ({linkedValue || 'not entered'}). The override stays until you re-link it and is recorded in the audit trail. Policy: overrides are permitted with a reason (prototype assumption).
      </p>
      <label htmlFor={id} className="mt-3 block text-sm font-medium text-ink">
        Reason for override <span className="font-normal text-sub">(required)</span>
      </label>
      <input
        id={id}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={`mt-1.5 h-10 w-full max-w-lg rounded bg-panel px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink ${invalid ? 'border-2 border-ink' : 'border border-line'}`}
        placeholder="e.g. Counter advanced while repositioning" />
      
      {invalid && <ErrorText id={`${id}-error`}>Enter a reason before overriding.</ErrorText>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (!reason.trim()) {
              setTried(true);
              return;
            }
            onConfirm(reason.trim());
          }}>
          
          Override start
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>);

}

export function RideTable({ set, result, showErrors }: RideTableProps) {
  const { update, logEdit, overrideStart, relinkStart, readOnly } = useSession();
  const isWide = useMediaQuery('(min-width: 768px)');
  const [overrideFor, setOverrideFor] = useState<number | null>(null);
  const setLabel = setLabels[set];

  const setValue = (index: number, key: 'start' | 'finish', value: string) =>
  update((s) => withRides(s, set, s[set].map((r, i) => i === index ? { ...r, [key]: value } : r)));

  const finishError = (r: ResolvedRide) =>
  readingError(r.finish, showErrors, 'Enter the finish reading.') ?? (r.count && !r.count.ok ? r.count.message : null);

  const startCell = (r: ResolvedRide, compact: boolean) => {
    const n = r.index + 1;
    const id = `${set}-ride-${n}-start`;
    const label = compact ? 'Start reading' : `${setLabel} Ride ${n} start reading`;
    if (r.linked) {
      return (
        <div>
          <NumericField id={id} label={`${label} (linked)`} hideLabel={!compact} value={r.linkedValue} mode="linked" placeholder={`Awaiting Ride ${r.index} finish`} hint={compact ? undefined : `Copied from Ride ${r.index} finish`} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-sub">
            <span>Linked to Ride {r.index} finish</span>
            {!readOnly &&
            <button type="button" onClick={() => setOverrideFor(r.index)} aria-expanded={overrideFor === r.index} className="font-medium text-ink underline underline-offset-2">
                Override
              </button>
            }
          </div>
        </div>);

    }
    return (
      <div>
        <NumericField
          id={id}
          label={label}
          hideLabel={!compact}
          value={r.startRaw}
          mode={r.overridden ? 'overridden' : 'input'}
          readOnly={readOnly}
          onChange={(v) => setValue(r.index, 'start', v)}
          onCommit={(f, t) => logEdit(`${setLabel} Ride ${n} start`, f, t)}
          error={readingError(r.start, showErrors, 'Enter the start reading.')} />
        
        {r.overridden &&
        <div className="mt-1 space-y-0.5 text-xs text-sub">
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="font-semibold text-ink">Overridden</span>
              <span>· linked value {r.linkedValue || '—'}</span>
              {!readOnly &&
            <button type="button" onClick={() => relinkStart(set, r.index)} className="font-medium text-ink underline underline-offset-2">
                  Re-link
                </button>
            }
            </p>
            {r.overrideReason && <p>Reason: {r.overrideReason}</p>}
          </div>
        }
      </div>);

  };

  const finishCell = (r: ResolvedRide, compact: boolean) =>
  <NumericField
    id={`${set}-ride-${r.index + 1}-finish`}
    label={compact ? 'Finish reading' : `${setLabel} Ride ${r.index + 1} finish reading`}
    hideLabel={!compact}
    value={r.finishRaw}
    readOnly={readOnly}
    onChange={(v) => setValue(r.index, 'finish', v)}
    onCommit={(f, t) => logEdit(`${setLabel} Ride ${r.index + 1} finish`, f, t)}
    error={finishError(r)} />;



  const diffValue = (r: ResolvedRide) =>
  r.count && r.count.ok ?
  <span>
        <span className="font-mono text-base font-semibold text-ink">{r.count.count}</span>
        {r.count.adjustment > 0 && <span className="block text-xs text-sub">incl. rollover +{r.count.adjustment}</span>}
      </span> :

  <span className="font-mono text-sub" aria-label="Not calculated">—</span>;


  const editor = (r: ResolvedRide) =>
  overrideFor === r.index ?
  <OverrideEditor
    rideNumber={r.index + 1}
    linkedValue={r.linkedValue}
    onCancel={() => setOverrideFor(null)}
    onConfirm={(reason) => {
      overrideStart(set, r.index, reason);
      setOverrideFor(null);
    }} /> :

  null;

  if (!isWide) {
    return (
      <ol className="space-y-3">
        {result.rides.map((r) => {
          const status = rideStatus(r, showErrors);
          return (
            <li key={r.index}>
              <fieldset className={`rounded border bg-panel p-4 ${status.tone === 'error' ? 'border-2 border-ink' : 'border-line'}`}>
                <legend className="sr-only">
                  {setLabel} Ride {r.index + 1}
                </legend>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold" aria-hidden="true">
                    Ride {r.index + 1}
                  </span>
                  <StatusTag {...status} />
                </div>
                <div className="space-y-3">
                  {startCell(r, true)}
                  {finishCell(r, true)}
                  <div className="flex items-baseline justify-between border-t border-hair pt-3">
                    <span className="text-sm text-sub">Difference</span>
                    {diffValue(r)}
                  </div>
                </div>
                {overrideFor === r.index && <div className="mt-3">{editor(r)}</div>}
              </fieldset>
            </li>);

        })}
      </ol>);

  }

  return (
    <div className="overflow-hidden rounded border border-line bg-panel">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{setLabel} rides</caption>
        <thead>
          <tr className="border-b border-line bg-canvas text-left text-xs font-semibold text-sub">
            <th scope="col" className="w-20 px-4 py-2.5">Ride</th>
            <th scope="col" className="px-3 py-2.5">Start reading</th>
            <th scope="col" className="px-3 py-2.5">Finish reading</th>
            <th scope="col" className="px-3 py-2.5 text-right">Difference</th>
            <th scope="col" className="px-4 py-2.5">Validation status</th>
          </tr>
        </thead>
        <tbody>
          {result.rides.map((r) =>
          <Fragment key={r.index}>
              <tr className="border-b border-hair align-top last:border-b-0">
                <th scope="row" className="px-4 py-3.5 text-left font-medium">
                  <span className="block pt-2.5">Ride {r.index + 1}</span>
                </th>
                <td className="w-[28%] px-3 py-3">{startCell(r, false)}</td>
                <td className="w-[28%] px-3 py-3">{finishCell(r, false)}</td>
                <td className="px-3 py-3 text-right">
                  <span className="block pt-2">{diffValue(r)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="block pt-2.5">
                    <StatusTag {...rideStatus(r, showErrors)} />
                  </span>
                </td>
              </tr>
              {overrideFor === r.index &&
            <tr className="border-b border-hair">
                  <td colSpan={5} className="px-4 pb-4">
                    {editor(r)}
                  </td>
                </tr>
            }
            </Fragment>
          )}
        </tbody>
      </table>
    </div>);

}