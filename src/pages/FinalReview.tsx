import React, { useState } from 'react';
import { FileTextIcon } from 'lucide-react';
import { useSession } from '../contexts/SessionContext';
import { formatDateTime } from '../utils/format';
import { PageHeader } from '../components/shell/PageHeader';
import { StepFooter } from '../components/shell/StepFooter';
import { Notice } from '../components/ui/Notice';
import { Button } from '../components/ui/Button';
import { WarningCard } from '../components/measurement/WarningCard';
import { ResultsSummary } from '../components/review/ResultsSummary';
import { RecordSections } from '../components/review/RecordSections';
import { AuditTrail } from '../components/review/AuditTrail';
import { FinalizationChecklist } from '../components/review/FinalizationChecklist';
import { FinalizeDialog } from '../components/review/FinalizeDialog';
import { ReportPreview, type ReportSnapshot } from '../components/review/ReportPreview';

export function FinalReview() {
  const { active, derived, goTo, saveDraft, readOnly } = useSession();
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  if (!active || !derived) return null;

  const openCount = derived.openWarnings.length;
  const blockers = derived.blockers;

  const onFinalize = () => {
    if (blockers.length) {
      setShowBlocked(true);
      window.setTimeout(() => document.getElementById('finalize-blocked')?.focus(), 30);
      return;
    }
    setConfirmOpen(true);
  };

  const generatePreview = () =>
  setSnapshot({ session: JSON.parse(JSON.stringify(active)) as typeof active, derived, at: new Date().toISOString() });

  return (
    <div>
      <PageHeader title="Review and report" description="Check the complete record, resolve open items, then preview and finalize the report." />

      <div className="mb-6 space-y-3 empty:hidden">
        {active.finalized &&
        <Notice
          tone="success"
          title="Finalized — read-only record"
          actions={
          <Button size="sm" disabled>
                Start formal revision
              </Button>
          }>
          
            Finalized {formatDateTime(active.finalized.at)} by {active.finalized.by}. Corrections require an authorized formal revision that preserves this original. Your account does not have revision permission in this prototype.
          </Notice>
        }
        {!active.finalized && showBlocked && blockers.length > 0 &&
        <Notice id="finalize-blocked" tone="error" title={`Finalization blocked — ${blockers.length} item${blockers.length === 1 ? '' : 's'} need attention`} live>
            <ul className="list-disc space-y-1 pl-5">
              {blockers.map((b) =>
            <li key={b.id}>
                  <span className="font-medium text-ink">{b.label}:</span> {b.detail}
                </li>
            )}
            </ul>
          </Notice>
        }
      </div>

      {!active.finalized &&
      <p className="mb-4 text-sm text-ink">
          <span className="font-semibold">{blockers.length === 0 ? 'No blocking issues' : `${blockers.length} blocking issue${blockers.length === 1 ? '' : 's'}`}</span>
          <span className="text-sub"> · {openCount} warning{openCount === 1 ? '' : 's'} awaiting review</span>
        </p>
      }

      <ResultsSummary />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          <section id="warnings-panel" tabIndex={-1} aria-labelledby="warnings-heading" className="outline-none">
            <h2 id="warnings-heading" className="mb-3 text-base font-semibold">
              Warnings and review items
            </h2>
            {derived.warnings.length === 0 ?
            <p className="rounded border border-line bg-panel p-4 text-sm text-sub">No warnings for this session.</p> :

            <div className="space-y-3">
                {[...derived.openWarnings, ...derived.warnings.filter((w) => w.ack === 'current')].map((w) =>
              <WarningCard key={w.id} warning={w} />
              )}
              </div>
            }
          </section>

          <section aria-labelledby="record-heading">
            <h2 id="record-heading" className="mb-3 text-base font-semibold">
              Measurement record
            </h2>
            <RecordSections />
          </section>

          <AuditTrail />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <FinalizationChecklist />
        </aside>
      </div>

      <StepFooter
        backLabel="Back to post-calibration"
        onBack={() => goTo('post')}
        onSaveDraft={readOnly ? undefined : saveDraft}
        secondary={
        <Button icon={<FileTextIcon />} onClick={generatePreview}>
            Generate preview
          </Button>
        }
        primaryLabel={active.finalized ? 'Back to sessions' : 'Finalize session'}
        onPrimary={active.finalized ? () => goTo('list') : onFinalize} />
      

      <ReportPreview snapshot={snapshot} onClose={() => setSnapshot(null)} />
      <FinalizeDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} />
    </div>);

}