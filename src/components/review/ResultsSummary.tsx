import { useSession } from '../../contexts/SessionContext';
import { DISTANCE_DISPLAY_DECIMALS, WC_DISPLAY_DECIMALS, fmt, fmtSigned } from '../../utils/calibration';

export function ResultsSummary() {
  const { active, derived } = useSession();
  if (!active || !derived) return null;
  const d = derived.distance;

  const items = [
  { label: 'Calibration course length', value: derived.length.ok ? `${fmt(derived.length.value)} m` : '—' },
  { label: 'Pre-calibration WC', value: fmt(derived.pre.wc, WC_DISPLAY_DECIMALS) },
  { label: 'Post-calibration WC', value: fmt(derived.post.wc, WC_DISPLAY_DECIMALS) },
  { label: 'Difference (post − pre)', value: fmtSigned(derived.comparison.difference, WC_DISPLAY_DECIMALS) },
  {
    label: 'Final constant',
    value: active.finalRule === 'notConfigured' ? 'Not selected — rule not configured' : fmt(derived.finalConstant, WC_DISPLAY_DECIMALS),
    text: active.finalRule === 'notConfigured'
  },
  {
    label: 'Overall review status',
    value: `${derived.state}${derived.blockers.length && !active.finalized ? ` · ${derived.blockers.length} open item${derived.blockers.length === 1 ? '' : 's'}` : ''}`,
    text: true
  }];


  return (
    <section aria-label="Key results" className="rounded border border-line bg-panel">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="border-b border-line p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2">
            <p className="text-sm text-sub">Measured course distance</p>
            {d.basis.provisional && (
              <span className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sub">
                Provisional
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-4xl font-semibold text-ink">
            {d.km !== null ? fmt(d.km, DISTANCE_DISPLAY_DECIMALS) : '—'}
            <span className="ml-1.5 font-sans text-lg font-normal text-sub">km</span>
          </p>
          <p className="mt-2 text-xs text-sub">
            {d.km !== null && d.count && d.count.ok ? `Full precision ${fmt(d.km)} km · T ${d.count.count} ÷ WC ${fmt(d.wc)} (${d.basis.source === 'final' ? 'final constant' : 'provisional pre WC'})` : 'Not available until course readings and pre-calibration are complete.'}
          </p>
          {derived.reviews.distance === 'stale' && <p className="mt-2 text-xs font-semibold text-ink">Stale — recalculated after review</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
          {items.map((it) =>
          <div key={it.label}>
              <dt className="text-xs text-sub">{it.label}</dt>
              <dd className={`mt-1 ${it.text ? 'text-sm font-medium' : 'font-mono text-base'} text-ink`}>{it.value}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>);

}