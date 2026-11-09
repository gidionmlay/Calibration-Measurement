import { useState } from 'react';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '../contexts/SessionContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTime } from '../utils/format';
import { triggerFileDownload } from '../utils/auditExport';
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
import { RevisionDialog } from '../components/review/RevisionDialog';
import { ReportPreview, type ReportSnapshot } from '../components/review/ReportPreview';

export function FinalReview() {
  const { active, derived, goTo, saveDraft, readOnly, exportSession, openSession } = useSession();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
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
    setSnapshot({
      session: JSON.parse(JSON.stringify(active)) as typeof active,
      derived,
      at: new Date().toISOString(),
      measurer: {
        name: active.finalized?.by || user?.display_name || user?.email || active.operator,
        email: active.finalized?.email || user?.email || undefined,
        organization: active.finalized?.organization || user?.organization || undefined,
      },
    });

  const handleExportSession = () => {
    try {
      const json = exportSession(active.reference);
      triggerFileDownload(`${active.reference}_session_backup.json`, json, 'application/json');
      toast('Session exported', { description: `Session ${active.reference} downloaded as JSON backup.` });
    } catch (e) {
      toast('Export failed', { description: e instanceof Error ? e.message : 'Export failed' });
    }
  };

  return (
    <div>
      <PageHeader title="Review and report" description="Check the complete record, resolve open items, then preview and finalize the report." />

      <div className="mb-6 space-y-3 empty:hidden">
        {active.finalized && !active.supersededByRef && (
          <Notice
            tone="success"
            title="Finalized — read-only record"
            actions={
              <Button size="sm" onClick={() => setRevisionOpen(true)} data-testid="start-revision-btn">
                Start formal revision
              </Button>
            }
          >
            <div>
              Finalized {formatDateTime(active.finalized.at)} by <strong>{active.finalized.by}</strong>
              {active.finalized.organization ? ` · ${active.finalized.organization}` : ''}. Corrections require an authorized formal revision that preserves this original.
            </div>
            {active.finalized.certificateHash && (
              <div className="mt-1 font-mono text-xs text-emerald-800">
                Cryptographic Seal: SHA-256 <span className="font-semibold">{active.finalized.certificateHash}</span>
              </div>
            )}
          </Notice>
        )}
        {active.supersededByRef && (
          <Notice
            tone="warning"
            title={`Superseded by formal revision ${active.supersededByRef}`}
            actions={
              <Button size="sm" onClick={() => {
                if (active.supersededByRef) openSession(active.supersededByRef);
              }}>
                View active revision
              </Button>
            }
          >
            This finalized session has been superseded by a formal revision. It remains permanently archived as an immutable audit record.
          </Notice>
        )}
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<DownloadIcon className="h-4 w-4" />}
              onClick={handleExportSession}
              data-testid="final-review-export-btn"
            >
              Export session
            </Button>
            <Button
              icon={<FileTextIcon />}
              onClick={generatePreview}
              data-testid="final-review-preview-btn"
            >
              Generate preview
            </Button>
          </div>
        }
        primaryLabel={active.finalized ? 'Back to sessions' : 'Finalize session'}
        onPrimary={active.finalized ? () => goTo('list') : onFinalize} />
      

      <ReportPreview snapshot={snapshot} onClose={() => setSnapshot(null)} />
      <FinalizeDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} />
      <RevisionDialog open={revisionOpen} onClose={() => setRevisionOpen(false)} />
    </div>);

}