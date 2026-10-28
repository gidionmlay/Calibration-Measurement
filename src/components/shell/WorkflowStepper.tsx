import { CheckIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';
import { workflowSteps } from '../../data/options';
import type { StepId } from '../../types/session';
import type { StepStatus } from '../../utils/sessionRules';

function statusText(id: StepId, st: StepStatus): string {
  if (id === 'setup') return st === 'done' ? 'Saved' : 'Incomplete';
  if (id === 'review') return st === 'done' ? 'Finalized' : st === 'attention' ? 'Ready' : 'Pending';
  return { done: 'Reviewed', attention: 'To review', stale: 'Stale', todo: 'Incomplete' }[st];
}

export function WorkflowStepper() {
  const { view, derived, goTo } = useSession();
  if (!derived || view === 'list') return null;
  const currentIndex = workflowSteps.findIndex((s) => s.id === view);
  const current = workflowSteps[currentIndex];

  return (
    <nav aria-label="Workflow steps">
      <ol className="hidden items-center lg:flex">
        {workflowSteps.map((step, i) => {
          const st = derived.steps[step.id];
          const isCurrent = step.id === view;
          const marker = isCurrent ?
          'border-ink bg-ink text-white' :
          st === 'done' ?
          'border-ink bg-panel text-ink' :
          st === 'stale' ?
          'border-dotted border-ink bg-panel text-ink' :
          'border-dashed border-line bg-panel text-sub';
          return (
            <li key={step.id} className={`flex items-center ${i < workflowSteps.length - 1 ? 'flex-1' : ''}`}>
              <button
                type="button"
                onClick={() => goTo(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex items-center gap-2.5 rounded px-1.5 py-1 text-left hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
                
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold ${marker}`}>
                  {st === 'done' && !isCurrent ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> : st === 'stale' ? '!' : i + 1}
                </span>
                <span className="leading-tight">
                  <span className={`block whitespace-nowrap text-sm ${isCurrent ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{step.label}</span>
                  <span className="block whitespace-nowrap text-xs text-sub">{statusText(step.id, st)}</span>
                </span>
              </button>
              {i < workflowSteps.length - 1 && <span className="mx-3 h-px min-w-4 flex-1 bg-line" aria-hidden="true" />}
            </li>);

        })}
      </ol>

      <div className="lg:hidden">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold text-ink">{current?.label}</span>
          <span className="whitespace-nowrap text-xs text-sub">
            Step {currentIndex + 1} of {workflowSteps.length} · {current ? statusText(current.id, derived.steps[current.id]) : ''}
          </span>
        </div>
        <ol className="mt-2 grid grid-cols-5 gap-1">
          {workflowSteps.map((step, i) => {
            const st = derived.steps[step.id];
            const bar = i === currentIndex ? 'bg-ink' : st === 'done' ? 'bg-sub' : st === 'stale' ? 'bg-faint' : 'bg-shade';
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => goTo(step.id)}
                  aria-current={i === currentIndex ? 'step' : undefined}
                  aria-label={`${step.label}: ${statusText(step.id, st)}`}
                  className="flex h-6 w-full items-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
                  
                  <span className={`h-1.5 w-full rounded-full ${bar}`} />
                </button>
              </li>);

          })}
        </ol>
      </div>
    </nav>);

}