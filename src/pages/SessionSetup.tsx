import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { lengthMessage, parseReading } from '../utils/calibration';
import { optionLabel } from '../utils/format';
import { consistencyOptions, finalRuleOptions, rolloverHelp, rolloverOptions, ruleSetOptions, type Option } from '../data/options';
import type { SessionData } from '../types/session';
import { PageHeader } from '../components/shell/PageHeader';
import { StepFooter } from '../components/shell/StepFooter';
import { NumericField } from '../components/ui/NumericField';
import { SelectField } from '../components/ui/SelectField';
import { ErrorSummary } from '../components/ui/ErrorSummary';
import { WarningCard } from '../components/measurement/WarningCard';

type ConfigKey = 'rolloverMode' | 'consistencyRule' | 'finalRule' | 'ruleSet';

function FormSection({ title, description, children }: {title: string;description: string;children: React.ReactNode;}) {
  return (
    <section className="grid gap-5 border-t border-line py-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-sub">{description}</p>
      </div>
      <div className="max-w-xl space-y-6">{children}</div>
    </section>);

}

export function SessionSetup() {
  const { active, derived, update, logEdit, goTo, saveDraft, saveSetup, readOnly } = useSession();
  const [showErrors, setShowErrors] = useState(false);
  if (!active || !derived) return null;

  const lengthErr = active.courseLength.trim() === '' ? showErrors ? lengthMessage(derived.length) : null : lengthMessage(derived.length);
  const ruleSetErr = showErrors && active.ruleSet === 'notConfigured' ? 'Select the rule set these calculations follow.' : null;
  const maxInvalid = active.rolloverMode === 'wrap' && !parseReading(active.rolloverMax).ok;
  const maxErr = maxInvalid && (showErrors || active.rolloverMax.trim() !== '') ? 'Enter the highest value the counter shows before returning to 0.' : null;

  const errorItems = [
  !derived.length.ok && { label: `Calibration course length: ${lengthMessage(derived.length)}`, targetId: 'course-length' },
  active.ruleSet === 'notConfigured' && { label: 'Rule set: select the rule set to apply', targetId: 'rule-set' },
  maxInvalid && { label: 'Counter maximum: enter the counter’s highest value', targetId: 'rollover-max' }].
  filter((x): x is {label: string;targetId: string;} => !!x);

  const setConfig = <K extends ConfigKey,>(key: K, label: string, options: Option<SessionData[K]>[], value: SessionData[K]) => {
    const prev = active[key];
    update((s) => ({ ...s, [key]: value }));
    logEdit(label, optionLabel(options, prev), optionLabel(options, value));
  };

  const onContinue = () => {
    if (errorItems.length) {
      setShowErrors(true);
      window.setTimeout(() => document.getElementById('setup-error-summary')?.focus(), 30);
      return;
    }
    if (!readOnly) saveSetup();
    goTo('pre');
  };

  const ruleWarning = derived.warnings.find((w) => w.id === 'config-ruleset');

  return (
    <div>
      <PageHeader title="Session setup" description="Define the calibration context before entering readings." />

      {showErrors && errorItems.length > 0 &&
      <div className="mb-6">
          <ErrorSummary id="setup-error-summary" title="Complete these fields to continue. You can still save this as a draft." items={errorItems} />
        </div>
      }

      <FormSection title="Session details" description="Identifies the session and the reference course used for calibration.">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Session reference</p>
          <p className="flex h-10 items-center rounded border border-line bg-fill px-3 font-mono text-sm text-sub">{active.reference}</p>
          <p className="mt-1 text-xs text-sub">Generated automatically. Cannot be changed.</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Operator</p>
          <p className="flex h-10 items-center rounded border border-line bg-fill px-3 text-sm text-sub">{active.operator} (signed in)</p>
          <p className="mt-1 text-xs text-sub">Taken from the signed-in account and recorded with every change.</p>
        </div>
        <NumericField
          id="course-length"
          label="Calibration course length"
          required
          decimal
          unit="m"
          value={active.courseLength}
          readOnly={readOnly}
          hint="Measured length of the reference course in metres. A 200–500 m range is under discussion and is not enforced."
          onChange={(v) => update((s) => ({ ...s, courseLength: v }))}
          onCommit={(f, t) => logEdit('Calibration course length (m)', f, t)}
          error={lengthErr} />
        
      </FormSection>

      <FormSection title="Measurement configuration" description="Rules applied to every calculation in this session. Unconfirmed rules are shown as pending — no official values are assumed.">
        <div>
          <SelectField
            id="rollover-mode"
            label="Counter rollover"
            value={active.rolloverMode}
            options={rolloverOptions}
            disabled={readOnly}
            hint={rolloverHelp[active.rolloverMode]}
            onChange={(v) => setConfig('rolloverMode', 'Counter rollover', rolloverOptions, v as SessionData['rolloverMode'])} />
          
          {active.rolloverMode === 'notConfigured' &&
          <p className="mt-1.5 text-xs text-sub">Only needed if a finish reading is lower than its start. Readings that need it will be blocked until it is resolved.</p>
          }
        </div>
        {active.rolloverMode === 'wrap' &&
        <NumericField
          id="rollover-max"
          label="Counter maximum value"
          required
          value={active.rolloverMax}
          readOnly={readOnly}
          hint="The highest reading before the counter returns to 0, e.g. 999999."
          onChange={(v) => update((s) => ({ ...s, rolloverMax: v }))}
          onCommit={(f, t) => logEdit('Counter maximum value', f, t)}
          error={maxErr} />

        }
        <SelectField
          id="consistency-rule"
          label="Ride-consistency rule"
          value={active.consistencyRule}
          options={consistencyOptions}
          disabled={readOnly}
          hint="The official tolerance between rides is not confirmed. Ride spread is shown as a warning for manual review; nothing is blocked automatically."
          onChange={(v) => setConfig('consistencyRule', 'Ride-consistency rule', consistencyOptions, v as SessionData['consistencyRule'])} />
        
        <SelectField
          id="final-rule"
          label="Final calibration constant selection rule"
          value={active.finalRule}
          options={finalRuleOptions}
          disabled={readOnly}
          hint="Not yet confirmed by the governing standard. While “Not configured”, no final constant is selected and the session cannot be finalized. The placeholder options exist only to demonstrate the prototype."
          onChange={(v) => setConfig('finalRule', 'Final constant selection rule', finalRuleOptions, v as SessionData['finalRule'])} />
        
        <SelectField
          id="rule-set"
          label="Applicable rule-set version"
          required
          value={active.ruleSet}
          options={ruleSetOptions}
          disabled={readOnly}
          hint="Recorded with every calculation and in the report. No approved rule set is published yet."
          error={ruleSetErr}
          onChange={(v) => setConfig('ruleSet', 'Rule-set version', ruleSetOptions, v as SessionData['ruleSet'])} />
        
        {ruleWarning && <WarningCard warning={ruleWarning} />}
      </FormSection>

      <StepFooter
        backLabel="Back to sessions"
        onBack={() => goTo('list')}
        onSaveDraft={readOnly ? undefined : saveDraft}
        primaryLabel={readOnly ? 'Next' : 'Save and continue'}
        onPrimary={onContinue} />
      
    </div>);

}