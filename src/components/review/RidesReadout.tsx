import React from 'react';
import type { CalibrationResult } from '../../utils/calibration';

export function RidesReadout({ result, caption }: {result: CalibrationResult;caption: string;}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-sub">
          <th scope="col" className="py-1.5 pr-3 font-semibold">Ride</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Start</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Finish</th>
          <th scope="col" className="py-1.5 text-right font-semibold">Difference</th>
        </tr>
      </thead>
      <tbody>
        {result.rides.map((r) =>
        <tr key={r.index} className="border-b border-hair last:border-b-0">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              Ride {r.index + 1}
              {r.overridden && <span className="ml-1.5 text-xs font-semibold">(start overridden)</span>}
            </th>
            <td className="py-1.5 pr-3 text-right font-mono">{r.startRaw || '—'}</td>
            <td className="py-1.5 pr-3 text-right font-mono">{r.finishRaw || '—'}</td>
            <td className="py-1.5 text-right font-mono font-semibold">{r.count && r.count.ok ? r.count.count : '—'}</td>
          </tr>
        )}
      </tbody>
    </table>);

}