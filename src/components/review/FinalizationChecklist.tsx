import { CheckIcon, XIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';

export function FinalizationChecklist() {
  const { derived, goTo, active } = useSession();
  if (!derived || !active) return null;
  const failing = derived.blockers.length;

  return (
    <section id="finalize-checklist" tabIndex={-1} aria-labelledby="checklist-heading" className="rounded border border-line bg-panel outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
      <div className="border-b border-line px-4 py-3">
        <h2 id="checklist-heading" className="text-base font-semibold">
          Finalization checklist
        </h2>
        <p className="mt-0.5 text-xs text-sub">
          {active.finalized ? 'Session finalized.' : failing ? `${failing} item${failing === 1 ? '' : 's'} blocking finalization` : 'All checks passed — ready to finalize.'}
        </p>
      </div>
      <ul className="divide-y divide-hair">
        {derived.checklist.map((c) =>
        <li key={c.id} className="flex gap-3 px-4 py-3">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm ${c.ok ? 'border border-ink' : 'bg-ink text-white'}`}>
              {c.ok ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <XIcon className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink">
                <span className="sr-only">{c.ok ? 'Passed: ' : 'Blocked: '}</span>
                {c.label}
              </p>
              <p className="mt-0.5 text-xs text-sub">{c.detail}</p>
              {!c.ok && c.step && !active.finalized &&
            <button type="button" onClick={() => goTo(c.step!, c.focusId)} className="mt-1 text-xs font-semibold text-ink underline underline-offset-2">
                  Resolve
                </button>
            }
            </div>
          </li>
        )}
      </ul>
    </section>);

}