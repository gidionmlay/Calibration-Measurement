import { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { PageHeader } from '../components/shell/PageHeader';
import { StepFooter } from '../components/shell/StepFooter';
import { Notice } from '../components/ui/Notice';
import { Button } from '../components/ui/Button';
import { ConstantReference } from '../components/measurement/ConstantReference';
import { CalibrationWorkspace } from '../components/measurement/CalibrationWorkspace';
import { ComparisonPanel } from '../components/measurement/ComparisonPanel';

export function PostCalibration() {
  const { active, derived, goTo, markReviewed, saveDraft, readOnly } = useSession();
  const [showErrors, setShowErrors] = useState(false);
  if (!active || !derived) return null;

  const onPrimary = () => {
    if (!derived.post.complete || derived.pre.wc === null) {
      setShowErrors(true);
      window.setTimeout(() => document.getElementById(derived.pre.wc === null ? 'post-pre-missing' : 'post-error-summary')?.focus(), 30);
      return;
    }
    if (!readOnly && derived.reviews.comparison !== 'current') markReviewed('comparison');
    goTo('review');
  };

  return (
    <div>
      <PageHeader title="Post-calibration" description="Repeat the four-ride procedure and compare the constants." />

      <div className="mb-8 space-y-3">
        {derived.pre.wc === null ?
        <Notice
          id="post-pre-missing"
          tone="error"
          title="Pre-calibration constant unavailable"
          actions={
          <Button size="sm" onClick={() => goTo('pre')}>
                Resolve pre-calibration
              </Button>
          }>
          
            Post-calibration rides can be recorded, but the comparison needs a valid pre-calibration working constant.
          </Notice> :

        <ConstantReference id="post-pre-reference" />
        }
        {derived.reviews.comparison === 'stale' &&
        <Notice tone="stale" title="Comparison changed after review">
            One of the calibration sets changed since you reviewed the comparison. Check the values and review again.
          </Notice>
        }
      </div>

      <CalibrationWorkspace set="post" showErrors={showErrors} />

      <div className="mt-8">
        <ComparisonPanel />
      </div>

      <StepFooter
        backLabel="Back to course distance"
        onBack={() => goTo('distance')}
        onSaveDraft={readOnly ? undefined : saveDraft}
        primaryLabel={readOnly ? 'Next' : 'Review comparison'}
        note={!derived.post.complete ? 'Needs all four post-calibration rides' : undefined}
        onPrimary={onPrimary} />
      
    </div>);

}