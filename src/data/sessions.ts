import type { ConflictRecord, SessionSeed } from '../types/session';

// Illustrative prototype data — not real measurement records.
export const prototypeOperator = 'J. Okafor';

export const exampleReadings = {
  courseLength: '200',
  preStart: '11082',
  preFinishes: ['12021', '13042', '14052', '15052'],
  distStart: '124002',
  distFinish: '320456',
  postStart: '320510',
  postFinishes: ['321502', '322497', '323488', '324484']
};

export const sessionSeeds: SessionSeed[] = [
{ reference: 'BC-2026-004', operator: 'J. Okafor', updatedAt: '2026-10-28T09:42:00', stage: 'postPartial' },
{ reference: 'BC-2026-003', operator: 'J. Okafor', updatedAt: '2026-10-26T16:10:00', stage: 'needsReview' },
{ reference: 'BC-2026-002', operator: 'M. Lindqvist', updatedAt: '2026-10-21T14:05:00', stage: 'ready' },
{ reference: 'BC-2026-001', operator: 'M. Lindqvist', updatedAt: '2026-10-14T11:30:00', stage: 'finalized' }];


export const exampleOverride = {
  index: 2,
  value: '322500',
  reason: 'Counter advanced while repositioning at the start line'
};

export const syncIssueReference = 'BC-2026-004';

export const conflictSeed: ConflictRecord & {reference: string;} = {
  reference: 'BC-2026-003',
  label: 'Post-calibration Ride 4 finish reading',
  set: 'post',
  index: 3,
  local: '324484',
  server: '324494',
  localAt: '2026-10-26T16:10:00',
  serverAt: '2026-10-27T08:15:00',
  serverActor: 'M. Lindqvist (office workstation)'
};