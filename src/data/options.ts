import type {
  CalibrationSet,
  ConsistencyRule,
  FinalConstantRule,
  ReviewKey,
  RolloverMode,
  RuleSetVersion,
  StepId } from
'../types/session';

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const workflowSteps: {id: StepId;label: string;}[] = [
{ id: 'setup', label: 'Setup' },
{ id: 'pre', label: 'Pre-calibration' },
{ id: 'distance', label: 'Course distance' },
{ id: 'post', label: 'Post-calibration' },
{ id: 'review', label: 'Review & report' }];


export const rolloverOptions: Option<RolloverMode>[] = [
{ value: 'notConfigured', label: 'Not configured' },
{ value: 'none', label: 'Counter does not wrap' },
{ value: 'wrap', label: 'Counter wraps at a maximum value' }];


export const rolloverHelp: Record<RolloverMode, string> = {
  notConfigured: 'No rollover is assumed. A finish reading below its start is flagged for you to verify.',
  none: 'A finish reading below its start is always treated as a reading to verify.',
  wrap: 'When finish is below start, (maximum + 1) is added. The adjustment is shown in every calculation.'
};

export const consistencyOptions: Option<ConsistencyRule>[] = [
{ value: 'notConfigured', label: 'Not configured' },
{ value: 'pending', label: 'Pending approval — no tolerance applied' }];


export const ruleSetOptions: Option<RuleSetVersion>[] = [
{ value: 'notConfigured', label: 'Not configured' },
{ value: 'ws-0.3', label: 'Working specification v0.3 — pending approval' }];


export const finalRuleOptions: Option<FinalConstantRule>[] = [
{ value: 'notConfigured', label: 'Not configured' },
{ value: 'larger', label: 'Larger of pre and post WC — placeholder, pending approval' },
{ value: 'average', label: 'Average of pre and post WC — placeholder, pending approval' }];


export const reviewLabels: Record<ReviewKey, string> = {
  pre: 'Pre-calibration',
  distance: 'Course distance',
  comparison: 'Calibration comparison'
};

export const reviewSteps: Record<ReviewKey, StepId> = {
  pre: 'pre',
  distance: 'distance',
  comparison: 'post'
};

export const setLabels: Record<CalibrationSet, string> = {
  pre: 'Pre-calibration',
  post: 'Post-calibration'
};