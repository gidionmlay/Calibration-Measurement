import type {
  CalibrationSet,
  ConsistencyRule,
  Connectivity,
  ReviewKey,
  ReviewRecord,
  SessionData,
  SessionState,
  StepId } from
'../types/session';
import {
  compareConstants,
  computeCalibration,
  computeDistance,
  parseCourseLength,
  selectFinalConstant,
  type CalibrationResult,
  type Comparison,
  type DistanceResult,
  type LengthCheck } from
'./calibration';
import { reviewLabels, reviewSteps, setLabels } from '../data/options';

export type ReviewCurrency = 'none' | 'current' | 'stale';
export type StepStatus = 'done' | 'attention' | 'stale' | 'todo';

export interface WarningItem {
  id: string;
  title: string;
  affected: string;
  explanation: string;
  action: string;
  step: StepId;
  focusId?: string;
  signature: string;
  ack: ReviewCurrency;
}

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  step?: StepId;
  focusId?: string;
}

export interface Derived {
  length: LengthCheck;
  pre: CalibrationResult;
  post: CalibrationResult;
  distance: DistanceResult;
  comparison: Comparison;
  finalConstant: number | null;
  signatures: Record<ReviewKey, string>;
  reviews: Record<ReviewKey, ReviewCurrency>;
  warnings: WarningItem[];
  openWarnings: WarningItem[];
  checklist: CheckItem[];
  blockers: CheckItem[];
  state: SessionState;
  steps: Record<StepId, StepStatus>;
  hasReadings: boolean;
}

type RawWarning = Omit<WarningItem, 'ack'>;

function currency(record: ReviewRecord | undefined, signature: string, complete: boolean): ReviewCurrency {
  if (!record) return 'none';
  return record.signature === signature && complete ? 'current' : 'stale';
}

function calibrationWarnings(set: CalibrationSet, result: CalibrationResult, rule: ConsistencyRule): RawWarning[] {
  const out: RawWarning[] = [];
  const name = setLabels[set];
  if (result.spread) {
    const { high, low, range } = result.spread;
    out.push({
      id: `${set}-consistency`,
      title: `${name} ride consistency not verified`,
      affected: `Ride ${high.ride} (${high.count} counts) and Ride ${low.ride} (${low.count} counts) — spread of ${range} counts`,
      explanation:
      rule === 'pending' ?
      'The ride-consistency tolerance is pending approval, so the app cannot judge whether this spread is acceptable. Large variation can indicate a misread counter or a ride that left the course line.' :
      'No ride-consistency rule is configured, so the app cannot judge whether this spread is acceptable. Large variation can indicate a misread counter or a ride that left the course line.',
      action: 'Check the affected readings. Correct any misread value, or mark as reviewed after manual inspection.',
      step: set,
      focusId: `${set}-ride-${high.ride}-finish`,
      signature: `${result.counts.join(',')}|${rule}`
    });
  }
  result.rides.forEach((r) => {
    if (!r.overridden) return;
    const n = r.index + 1;
    out.push({
      id: `${set}-override-${n}`,
      title: `Linked start overridden — ${name} Ride ${n}`,
      affected: `Ride ${n} start is ${r.startRaw || 'empty'}; Ride ${n - 1} finish is ${r.linkedValue || 'empty'}`,
      explanation:
      'This start no longer follows the previous finish. Counts between the two rides are excluded, which changes the working constant if the override is wrong.',
      action: r.overrideReason ?
      `Recorded reason: “${r.overrideReason}”. Confirm the value, or re-link the start.` :
      'Record a reason, or re-link the start.',
      step: set,
      focusId: `${set}-ride-${n}-start`,
      signature: `${r.startRaw}|${r.linkedValue}|${r.overrideReason}`
    });
  });
  return out;
}

export function deriveSession(s: SessionData, connectivity: Connectivity): Derived {
  const rollover = { mode: s.rolloverMode, max: s.rolloverMax };
  const length = parseCourseLength(s.courseLength);
  const pre = computeCalibration(s.pre, s.courseLength, rollover);
  const post = computeCalibration(s.post, s.courseLength, rollover);
  const distance = computeDistance(s.distStart, s.distFinish, pre.wc, rollover);
  const comparison = compareConstants(pre.wc, post.wc);
  const finalConstant = selectFinalConstant(s.finalRule, pre.wc, post.wc);

  const signatures: Record<ReviewKey, string> = {
    pre: JSON.stringify([s.courseLength, s.rolloverMode, s.rolloverMax, pre.rides.map((r) => [r.startRaw, r.finishRaw])]),
    distance: JSON.stringify([pre.wc, s.distStart, s.distFinish, s.rolloverMode, s.rolloverMax]),
    comparison: JSON.stringify([pre.wc, post.wc, s.finalRule])
  };
  const complete: Record<ReviewKey, boolean> = {
    pre: pre.complete,
    distance: distance.complete,
    comparison: post.complete && comparison.difference !== null
  };
  const reviews: Record<ReviewKey, ReviewCurrency> = {
    pre: currency(s.reviews.pre, signatures.pre, complete.pre),
    distance: currency(s.reviews.distance, signatures.distance, complete.distance),
    comparison: currency(s.reviews.comparison, signatures.comparison, complete.comparison)
  };

  const raw: RawWarning[] = [];
  if (s.ruleSet === 'ws-0.3') {
    raw.push({
      id: 'config-ruleset',
      title: 'Rule set pending approval',
      affected: 'All calculations in this session',
      explanation:
      'Working specification v0.3 has not been approved as the governing rule set. Calculations follow it, but results may change if the approved values differ.',
      action: 'Mark as reviewed to continue. Re-check this session when the approved rule set is published.',
      step: 'setup',
      focusId: 'rule-set',
      signature: s.ruleSet
    });
  }
  raw.push(...calibrationWarnings('pre', pre, s.consistencyRule));
  if (distance.count && distance.count.ok && distance.count.adjustment > 0) {
    raw.push({
      id: 'distance-rollover',
      title: 'Counter rollover adjustment applied',
      affected: `Course distance — +${distance.count.adjustment} counts added`,
      explanation: 'The finish reading is lower than the start, so the configured counter maximum was used. A misread reading would look the same.',
      action: 'Confirm the counter actually wrapped during the ride, or correct the readings.',
      step: 'distance',
      focusId: 'distance-finish',
      signature: `${distance.count.adjustment}|${s.distStart}|${s.distFinish}`
    });
  }
  raw.push(...calibrationWarnings('post', post, s.consistencyRule));

  const warnings: WarningItem[] = raw.map((w) => ({ ...w, ack: currency(s.acknowledgements[w.id], w.signature, true) }));
  const openWarnings = warnings.filter((w) => w.ack !== 'current');

  const hasReadings = [
  s.distStart,
  s.distFinish,
  ...s.pre.flatMap((r) => [r.start, r.finish]),
  ...s.post.flatMap((r) => [r.start, r.finish])].
  some((v) => v.trim() !== '');

  const missing: {label: string;step: StepId;focusId?: string;}[] = [];
  if (!length.ok) missing.push({ label: 'calibration course length', step: 'setup', focusId: 'course-length' });
  if (s.ruleSet === 'notConfigured') missing.push({ label: 'rule set', step: 'setup', focusId: 'rule-set' });
  if (!pre.complete) missing.push({ label: 'pre-calibration rides', step: 'pre' });
  if (!distance.complete) missing.push({ label: 'course-distance readings', step: 'distance' });
  if (!post.complete) missing.push({ label: 'post-calibration rides', step: 'post' });

  const keys: ReviewKey[] = ['pre', 'distance', 'comparison'];
  const staleReviews = keys.filter((k) => reviews[k] === 'stale');
  const staleAcks = warnings.filter((w) => w.ack === 'stale');
  const notReviewed = keys.filter((k) => reviews[k] !== 'current');
  const staleNames = [...staleReviews.map((k) => reviewLabels[k]), ...staleAcks.map((w) => w.title)];

  const checklist: CheckItem[] = [
  {
    id: 'inputs',
    label: 'Required fields are valid',
    ok: missing.length === 0,
    detail: missing.length ? `Missing or invalid: ${missing.map((m) => m.label).join(', ')}.` : 'Setup and all readings are complete and valid.',
    step: missing[0]?.step,
    focusId: missing[0]?.focusId
  },
  {
    id: 'current',
    label: 'Calculations are current',
    ok: staleNames.length === 0,
    detail: staleNames.length ? `Changed after review: ${staleNames.join('; ')}.` : 'No source value changed after it was reviewed.',
    step: staleReviews[0] ? reviewSteps[staleReviews[0]] : staleAcks[0]?.step
  },
  {
    id: 'reviews',
    label: 'Mandatory reviews complete',
    ok: notReviewed.length === 0,
    detail: notReviewed.length ?
    `Not reviewed: ${notReviewed.map((k) => reviewLabels[k]).join(', ')}.` :
    'Pre-calibration, course distance and comparison are reviewed.',
    step: notReviewed[0] ? reviewSteps[notReviewed[0]] : undefined
  },
  {
    id: 'warnings',
    label: 'No warnings awaiting review',
    ok: openWarnings.length === 0,
    detail: openWarnings.length ?
    `${openWarnings.length} warning${openWarnings.length === 1 ? '' : 's'} awaiting review.` :
    'All warnings have been reviewed.',
    step: 'review',
    focusId: 'warnings-panel'
  },
  {
    id: 'finalRule',
    label: 'Final constant rule configured',
    ok: s.finalRule !== 'notConfigured',
    detail:
    s.finalRule !== 'notConfigured' ?
    'A selection rule is configured and applied.' :
    'Final constant selection rule not configured. No final constant can be selected.',
    step: 'setup',
    focusId: 'final-rule'
  },
  {
    id: 'sync',
    label: 'No unresolved sync conflict',
    ok: !s.conflict,
    detail: s.conflict ? 'This device and the server hold different values. Resolve the conflict first.' : 'No conflicting versions.'
  },
  {
    id: 'connection',
    label: 'Offline finalization policy',
    ok: connectivity !== 'offline',
    detail:
    connectivity === 'offline' ?
    'Whether sessions may be finalized offline is an unresolved policy decision. Reconnect to finalize.' :
    'Online — finalization will be sent to the server.'
  },
  {
    id: 'permission',
    label: 'Permission to finalize',
    ok: true,
    detail: `${s.operator} — finalize permitted (prototype assumption).`
  }];

  const blockers = checklist.filter((c) => !c.ok);
  const coreOk = checklist.filter((c) => c.id !== 'connection' && c.id !== 'permission').every((c) => c.ok);
  const anyStale = staleNames.length > 0;

  let state: SessionState;
  if (s.finalized) state = 'Finalized';else
  if (!hasReadings) state = 'Draft';else
  if (coreOk) state = 'Ready for final review';else
  if (anyStale || s.conflict || missing.length === 0) state = 'Needs review';else
  state = 'In progress';

  const stepFor = (key: ReviewKey): StepStatus =>
  reviews[key] === 'current' ? 'done' : reviews[key] === 'stale' ? 'stale' : complete[key] ? 'attention' : 'todo';

  const steps: Record<StepId, StepStatus> = {
    setup: length.ok && s.ruleSet !== 'notConfigured' && s.setupSaved ? 'done' : 'todo',
    pre: stepFor('pre'),
    distance: stepFor('distance'),
    post: stepFor('comparison'),
    review: s.finalized ? 'done' : state === 'Ready for final review' ? 'attention' : 'todo'
  };

  return {
    length,
    pre,
    post,
    distance,
    comparison,
    finalConstant,
    signatures,
    reviews,
    warnings,
    openWarnings,
    checklist,
    blockers,
    state,
    steps,
    hasReadings
  };
}