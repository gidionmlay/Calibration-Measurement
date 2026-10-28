import { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { fmt } from '../utils/calibration';
import { PageHeader } from '../components/shell/PageHeader';
import { StepFooter } from '../components/shell/StepFooter';
import { Notice } from '../components/ui/Notice';
import { Button } from '../components/ui/Button';
import { CalibrationWorkspace } from '../components/measurement/CalibrationWorkspace';

export function PreCalibration() {
  const { active, derived, goTo, markReviewed, saveDraft, readOnly } = useSession();
  const [showErrors, setShowErrors] = useState(false);
  if (!active || !derived) return null;

  const onPrimary = () => {
    if (!derived.pre.complete) {
      setShowErrors(true);
      window.setTimeout(() => document.getElementById(derived.length.ok ? 'pre-error-summary' : 'pre-length-error')?.focus(), 30);
      return;
    }
    if (!readOnly && derived.reviews.pre !== 'current') markReviewed('pre');
    goTo('distance');
  };

  return (
    <div>
      <PageHeader
        title="Pre-calibration"
        description="Record four rides over the reference course."
        aside={
        <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-xs text-sub">Reference course</dt>
              <dd className="font-mono font-semibold">{derived.length.ok ? `${fmt(derived.length.value)} m` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-sub">In km</dt>
              <dd className="font-mono font-semibold">{derived.pre.courseKm !== null ? fmt(derived.pre.courseKm) : '—'}</dd>
            </div>
          </dl>
        } />
      

      <div className="mb-6 space-y-3 empty:hidden">
        {!derived.length.ok &&
        <Notice
          id="pre-length-error"
          tone="error"
          title="Calibration course length is missing or invalid"
          actions={
          <Button size="sm" onClick={() => goTo('setup', 'course-length')}>
                Fix in Setup
              </Button>
          }>
          
            The working constant cannot be calculated without a valid course length. Ride differences are still shown.
          </Notice>
        }
        {derived.reviews.pre === 'stale' &&
        <Notice tone="stale" title="Changed after review">
            A reading or setup value changed since you reviewed this calculation. Course distance and the comparison depend on it and are marked stale. Review again to continue.
          </Notice>
        }
      </div>

      <CalibrationWorkspace set="pre" showErrors={showErrors} />

      <StepFooter
        backLabel="Back"
        onBack={() => goTo('setup')}
        onSaveDraft={readOnly ? undefined : saveDraft}
        primaryLabel={readOnly ? 'Next' : 'Review and continue'}
        note={!derived.pre.complete ? 'Needs all four rides and a valid working constant' : undefined}
        onPrimary={onPrimary} />
      
    </div>);

}