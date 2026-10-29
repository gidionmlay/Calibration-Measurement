import { useMemo, useRef, useState } from 'react';
import { DownloadIcon, PlusIcon, SearchIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '../contexts/SessionContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { deriveSession } from '../utils/sessionRules';
import { formatDateTime } from '../utils/format';
import { triggerFileDownload } from '../utils/auditExport';
import {
  generateCopyReference,
  validateSessionImport,
  detectLocalAuditLoss,
  type SessionExportPayload,
} from '../utils/sessionExport';
import { ImportConflictDialog } from '../components/shell/ImportConflictDialog';
import { Button } from '../components/ui/Button';
import { SelectField } from '../components/ui/SelectField';
import { Notice } from '../components/ui/Notice';
import { SessionStateBadge } from '../components/status/SessionStateBadge';
import { SaveSyncText } from '../components/status/SaveSyncText';
import type { SessionData, SessionState, SyncStatus } from '../types/session';

type StateFilter = 'all' | SessionState;
type SyncFilter = 'all' | SyncStatus;

interface Row {
  session: SessionData;
  state: SessionState;
}

const quickFilters: {value: StateFilter;label: string;}[] = [
{ value: 'all', label: 'All sessions' },
{ value: 'In progress', label: 'In progress' },
{ value: 'Needs review', label: 'Needs review' },
{ value: 'Ready for final review', label: 'Ready for final review' }];


const stateOptions = [
{ value: 'all', label: 'All states' },
...(['Draft', 'In progress', 'Needs review', 'Ready for final review', 'Finalized'] as SessionState[]).map((s) => ({ value: s, label: s }))];


const syncOptions = [
{ value: 'all', label: 'All sync statuses' },
{ value: 'pending', label: 'Sync pending' },
{ value: 'synced', label: 'Synced' },
{ value: 'issue', label: 'Sync issue' }];


export function SessionList() {
  const {
    sessions,
    connectivity,
    createSession,
    openSession,
    openSyncDialog,
    exportSession,
    importSessionPayload,
  } = useSession();
  const isWide = useMediaQuery('(min-width: 768px)');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [conflictPayload, setConflictPayload] = useState<SessionExportPayload | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [syncFilter, setSyncFilter] = useState<SyncFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [operator, setOperator] = useState('all');

  const handleExport = (reference: string) => {
    try {
      const json = exportSession(reference);
      triggerFileDownload(`${reference}_session_backup.json`, json, 'application/json');
      toast('Session exported', { description: `Session ${reference} downloaded as JSON backup.` });
    } catch (e) {
      toast('Export failed', { description: e instanceof Error ? e.message : 'Unknown export error' });
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const text = await file.text();
      const validation = validateSessionImport(text);
      if (!validation.valid) {
        toast('Import failed', { description: validation.error });
        return;
      }

      const payload = validation.payload;
      const originalRef = payload.session.reference;
      const exists = sessions.some((s) => s.reference.toLowerCase() === originalRef.toLowerCase());

      if (exists) {
        setConflictPayload(payload);
        return;
      }

      const result = await importSessionPayload(payload, 'overwrite');
      let desc = `Session ${result.session.reference} successfully restored.`;
      if (result.discrepancies.length > 0) {
        desc += ` Recalculation notice: ${result.discrepancies.join('; ')}`;
      }
      toast('Session imported', { description: desc });
    } catch (err) {
      toast('Import failed', { description: err instanceof Error ? err.message : 'Unexpected file read failure' });
    }
  };

  const handleResolveConflict = async (strategy: 'copy' | 'overwrite') => {
    if (!conflictPayload) return;
    try {
      const existing = sessions.find(
        (s) => s.reference.toLowerCase() === conflictPayload.session.reference.toLowerCase()
      );
      if (existing && strategy === 'overwrite') {
        if (existing.finalized) {
          toast('Overwrite blocked', { description: 'Cannot overwrite a finalized session.' });
          return;
        }
        const lossCheck = detectLocalAuditLoss(existing, conflictPayload.session);
        if (lossCheck.hasLoss) {
          toast('Overwrite blocked', {
            description: `Local session contains ${lossCheck.missingEventsCount} audit event(s) not present in backup.`,
          });
          return;
        }
      }

      const result = await importSessionPayload(conflictPayload, strategy);
      setConflictPayload(null);
      let desc = result.isCopy
        ? `Imported as new copy "${result.session.reference}" (preserving original reference "${result.originalRef}").`
        : `Existing session "${result.session.reference}" was safely replaced.`;
      if (result.discrepancies.length > 0) {
        desc += ` Note: ${result.discrepancies.join('; ')}`;
      }
      toast('Session imported', { description: desc });
    } catch (err) {
      toast('Import failed', { description: err instanceof Error ? err.message : 'Failed to import session.' });
    }
  };

  const rows: Row[] = useMemo(() => sessions.map((s) => ({ session: s, state: deriveSession(s, connectivity).state })), [sessions, connectivity]);
  const operators = Array.from(new Set(sessions.map((s) => s.operator)));
  const countFor = (f: StateFilter) => f === 'all' ? rows.length : rows.filter((r) => r.state === f).length;

  const filtered = rows.filter(({ session: s, state }) => {
    const day = s.updatedAt.slice(0, 10);
    if (query && !`${s.reference} ${s.operator}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (stateFilter !== 'all' && state !== stateFilter) return false;
    if (syncFilter !== 'all' && s.sync !== syncFilter) return false;
    if (operator !== 'all' && s.operator !== operator) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const filtersActive = query || stateFilter !== 'all' || syncFilter !== 'all' || operator !== 'all' || from || to;
  const clearFilters = () => {
    setQuery('');
    setStateFilter('all');
    setSyncFilter('all');
    setOperator('all');
    setFrom('');
    setTo('');
  };

  const actionFor = (state: SessionState) => state === 'Finalized' ? 'Open' : state === 'Needs review' || state === 'Ready for final review' ? 'Review' : 'Resume';

  const syncCell = (s: SessionData) =>
  <div className="flex flex-col items-start gap-1">
      <SaveSyncText save={s.save} sync={s.sync} />
      {s.sync === 'issue' &&
    <button type="button" onClick={() => openSyncDialog(s.reference)} className="text-xs font-semibold text-ink underline underline-offset-2">
          {s.conflict ? 'Resolve conflict' : 'Retry sync'}
        </button>
    }
      {s.sync === 'pending' && connectivity === 'offline' && <span className="text-xs text-sub">Sends when back online</span>}
    </div>;


  return (
    <div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json,application/json"
        className="hidden"
        data-testid="import-file-input"
      />

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Calibration sessions</h1>
          <p className="mt-1 text-sm text-sub">Create, continue, and review measurement sessions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <Button
            icon={<UploadIcon className="h-4 w-4" />}
            onClick={() => fileInputRef.current?.click()}
            data-testid="import-backup-btn"
          >
            Import backup
          </Button>
          {sessions.length > 0 &&
            <Button
              variant="primary"
              icon={<PlusIcon />}
              onClick={createSession}
              className="self-start md:self-auto"
              data-testid="new-session-btn"
            >
              New session
            </Button>
          }
        </div>
      </div>

      {connectivity === 'offline' &&
      <div className="mb-6">
          <Notice tone="info" title="Working offline">
            Sessions stored on this device can be opened and new drafts created. Changes are marked “Sync pending” and are sent when the connection returns.
          </Notice>
        </div>
      }

      {sessions.length === 0 ?
      <div className="rounded border-2 border-dashed border-line bg-panel px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-ink">No calibration sessions yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-sub">
            A session holds the setup, four pre-calibration rides, the course-distance readings, four post-calibration rides and the final report. It is created on this device and works without a connection.
          </p>
          <Button variant="primary" icon={<PlusIcon />} onClick={createSession} className="mt-6">
            Create your first session
          </Button>
        </div> :

      <>
          <div role="group" aria-label="Filter by session state" className="mb-4 flex flex-wrap gap-2">
            {quickFilters.map((f) => {
            const pressed = stateFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={pressed}
                onClick={() => setStateFilter(f.value)}
                className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded border px-3 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink ${pressed ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink hover:bg-fill'}`}>
                
                  {f.label}
                  <span className={`font-mono text-xs ${pressed ? 'text-white' : 'text-sub'}`}>{countFor(f.value)}</span>
                </button>);

          })}
          </div>

          <div className="mb-4 grid gap-3 rounded border border-line bg-panel p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
            <div>
              <label htmlFor="session-search" className="mb-1 block text-xs font-medium text-ink">
                Search
              </label>
              <div className="flex h-10 items-center gap-2 rounded border border-line px-3 focus-within:outline focus-within:outline-2 focus-within:outline-ink">
                <SearchIcon className="h-4 w-4 text-sub" aria-hidden="true" />
                <input id="session-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference or operator" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
              </div>
            </div>
            <SelectField compact id="filter-state" label="Session state" value={stateFilter} options={stateOptions} onChange={(v) => setStateFilter(v as StateFilter)} />
            <SelectField compact id="filter-sync" label="Save/sync status" value={syncFilter} options={syncOptions} onChange={(v) => setSyncFilter(v as SyncFilter)} />
            <SelectField compact id="filter-operator" label="Operator" value={operator} options={[{ value: 'all', label: 'All operators' }, ...operators.map((o) => ({ value: o, label: o }))]} onChange={setOperator} />
            <fieldset className="min-w-0">
              <legend className="mb-1 text-xs font-medium text-ink">Last updated (optional)</legend>
              <div className="flex items-center gap-2">
                <label htmlFor="filter-from" className="sr-only">From date</label>
                <input id="filter-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 min-w-0 flex-1 rounded border border-line px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" />
                <span className="text-xs text-sub" aria-hidden="true">to</span>
                <label htmlFor="filter-to" className="sr-only">To date</label>
                <input id="filter-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 min-w-0 flex-1 rounded border border-line px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" />
              </div>
            </fieldset>
          </div>

          <div className="mb-2 flex items-center justify-between text-xs text-sub">
            <span aria-live="polite">
              Showing {filtered.length} of {rows.length} sessions
            </span>
            {filtersActive &&
          <button type="button" onClick={clearFilters} className="font-medium text-ink underline underline-offset-2">
                Clear filters
              </button>
          }
          </div>

          {filtered.length === 0 ?
        <div className="rounded border border-dashed border-line bg-panel px-6 py-10 text-center">
              <p className="text-sm font-semibold text-ink">No sessions match these filters</p>
              <Button size="sm" className="mt-3" onClick={clearFilters}>
                Clear filters
              </Button>
            </div> :
        isWide ?
        <div className="overflow-hidden rounded border border-line bg-panel">
              <table className="w-full border-collapse text-sm">
                <caption className="border-b border-line bg-canvas px-4 py-2 text-left text-xs text-sub">Illustrative prototype data</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold text-sub">
                    <th scope="col" className="px-4 py-2.5">Session reference</th>
                    <th scope="col" className="px-4 py-2.5">Operator</th>
                    <th scope="col" className="px-4 py-2.5">Last updated</th>
                    <th scope="col" className="px-4 py-2.5">Session state</th>
                    <th scope="col" className="px-4 py-2.5">Save/sync status</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ session: s, state }) => {
                const action = actionFor(state);
                return (
                  <tr key={s.reference} className="border-b border-hair align-top last:border-b-0">
                        <th scope="row" className="px-4 py-3 text-left font-mono font-semibold text-ink">{s.reference}</th>
                        <td className="px-4 py-3 text-ink">{s.operator}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDateTime(s.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <SessionStateBadge state={state} />
                        </td>
                        <td className="px-4 py-3">{syncCell(s)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" onClick={() => openSession(s.reference)} aria-label={`${action} ${s.reference}`}>
                              {action}
                            </Button>
                            <Button
                              size="sm"
                              icon={<DownloadIcon className="h-3.5 w-3.5" />}
                              onClick={() => handleExport(s.reference)}
                              aria-label={`Export backup for ${s.reference}`}
                              data-testid={`export-session-${s.reference}`}
                            >
                              Export
                            </Button>
                          </div>
                        </td>
                      </tr>);

              })}
                </tbody>
              </table>
            </div> :

        <ul className="space-y-3" aria-label="Sessions — illustrative prototype data">
              {filtered.map(({ session: s, state }) => {
            const action = actionFor(state);
            return (
              <li key={s.reference} className="rounded border border-line bg-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono font-semibold text-ink">{s.reference}</p>
                        <p className="mt-0.5 text-xs text-sub">
                          {s.operator} · {formatDateTime(s.updatedAt)}
                        </p>
                      </div>
                      <SessionStateBadge state={state} />
                    </div>
                    <div className="mt-3">{syncCell(s)}</div>
                    <div className="mt-3 flex gap-2">
                      <Button className="flex-1" onClick={() => openSession(s.reference)} aria-label={`${action} ${s.reference}`}>
                        {action}
                      </Button>
                      <Button
                        className="flex-1"
                        icon={<DownloadIcon className="h-3.5 w-3.5" />}
                        onClick={() => handleExport(s.reference)}
                        aria-label={`Export backup for ${s.reference}`}
                        data-testid={`export-session-mobile-${s.reference}`}
                      >
                        Export
                      </Button>
                    </div>
                  </li>);

          })}
            </ul>
        }
        </>
      }

      {conflictPayload && (() => {
        const existing = sessions.find(
          (s) => s.reference.toLowerCase() === conflictPayload.session.reference.toLowerCase()
        );
        const existingFinalized = Boolean(existing?.finalized);
        const auditLoss = existing
          ? detectLocalAuditLoss(existing, conflictPayload.session)
          : { hasLoss: false, missingEventsCount: 0 };

        return (
          <ImportConflictDialog
            open={!!conflictPayload}
            reference={conflictPayload.session.reference}
            copyReference={generateCopyReference(conflictPayload.session.reference, sessions)}
            existingFinalized={existingFinalized}
            auditLossDetected={auditLoss.hasLoss}
            auditLossCount={auditLoss.missingEventsCount}
            auditLossReason={auditLoss.reason}
            onResolve={handleResolveConflict}
            onCancel={() => setConflictPayload(null)}
          />
        );
      })()}
    </div>);

}