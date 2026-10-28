import { useState } from 'react';
import { useSession } from '../../contexts/SessionContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatDateTime } from '../../utils/format';
import type { AuditEntry, AuditKind } from '../../types/session';
import { Disclosure } from '../ui/Disclosure';
import { SelectField } from '../ui/SelectField';
import { Button } from '../ui/Button';

type Filter = 'all' | 'changes' | 'calculations' | 'reviews' | 'sync' | 'lifecycle';

const filterKinds: Record<Exclude<Filter, 'all'>, AuditKind[]> = {
  changes: ['edit', 'override', 'conflict'],
  calculations: ['recalculation', 'invalidation', 'version'],
  reviews: ['review', 'acknowledgement'],
  sync: ['sync', 'conflict'],
  lifecycle: ['created', 'finalization']
};

const filterOptions = [
{ value: 'all', label: 'All events' },
{ value: 'changes', label: 'Changes and overrides' },
{ value: 'calculations', label: 'Recalculations and versions' },
{ value: 'reviews', label: 'Reviews and acknowledgements' },
{ value: 'sync', label: 'Sync' },
{ value: 'lifecycle', label: 'Creation and finalization' }];


const kindLabels: Record<AuditKind, string> = {
  created: 'Created',
  edit: 'Change',
  override: 'Override',
  recalculation: 'Recalculation',
  review: 'Review',
  invalidation: 'Review invalidated',
  acknowledgement: 'Warning reviewed',
  sync: 'Sync',
  conflict: 'Conflict resolved',
  finalization: 'Finalization',
  version: 'Rules / version'
};

const PAGE = 10;

function changeText(e: AuditEntry) {
  if (e.from === undefined && e.to === undefined) return '—';
  return `${e.from ?? '—'} → ${e.to ?? '—'}`;
}

export function AuditTrail() {
  const { active } = useSession();
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  if (!active) return null;

  const entries = [...active.audit].reverse().filter((e) => filter === 'all' || filterKinds[filter].includes(e.kind));
  const visible = showAll ? entries : entries.slice(0, PAGE);

  return (
    <Disclosure id="audit-trail" title="Audit trail" summary={`${active.audit.length} events · newest first`}>
      <div className="mb-4 max-w-xs">
        <SelectField compact id="audit-filter" label="Show" value={filter} options={filterOptions} onChange={(v) => setFilter(v as Filter)} />
      </div>
      {entries.length === 0 ?
      <p className="text-sm text-sub">No events of this type.</p> :
      isWide ?
      <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-sub">
              <th scope="col" className="py-2 pr-3 font-semibold">Time</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Actor</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Event</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Previous → new</th>
              <th scope="col" className="py-2 font-semibold">Reason / note</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) =>
          <tr key={e.id} className="border-b border-hair align-top last:border-b-0">
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-sub">{formatDateTime(e.at)}</td>
                <td className="whitespace-nowrap py-2 pr-3">{e.actor}</td>
                <td className="py-2 pr-3">
                  <span className="block text-xs font-semibold text-sub">{kindLabels[e.kind]}</span>
                  <span className="text-ink">{e.summary}</span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{changeText(e)}</td>
                <td className="py-2 text-xs text-sub">{e.reason ?? e.note ?? '—'}</td>
              </tr>
          )}
          </tbody>
        </table> :

      <ol className="divide-y divide-hair">
          {visible.map((e) =>
        <li key={e.id} className="py-2.5 text-sm">
              <p className="text-xs text-sub">
                {formatDateTime(e.at)} · {e.actor} · <span className="font-semibold">{kindLabels[e.kind]}</span>
              </p>
              <p className="mt-0.5 text-ink">{e.summary}</p>
              {(e.from !== undefined || e.to !== undefined) && <p className="font-mono text-xs">{changeText(e)}</p>}
              {(e.reason || e.note) && <p className="text-xs text-sub">{e.reason ?? e.note}</p>}
            </li>
        )}
        </ol>
      }
      {entries.length > PAGE &&
      <Button size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show latest 10' : `Show all ${entries.length} events`}
        </Button>
      }
    </Disclosure>);

}