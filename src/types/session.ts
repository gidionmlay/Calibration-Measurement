export type ViewId = 'list' | 'setup' | 'pre' | 'distance' | 'post' | 'review';
export type StepId = Exclude<ViewId, 'list'>;
export type Connectivity = 'online' | 'offline' | 'syncIssue' | 'syncConflict';
export type SessionListScenario = 'examples' | 'empty';
export type SessionState = 'Draft' | 'In progress' | 'Needs review' | 'Ready for final review' | 'Finalized';
export type SaveStatus = 'saving' | 'saved';
export type SyncStatus = 'pending' | 'synced' | 'issue';
export type RolloverMode = 'notConfigured' | 'none' | 'wrap';
export type RuleSetVersion = 'notConfigured' | 'ws-0.3';
export type ConsistencyRule = 'notConfigured' | 'pending';
export type FinalConstantRule = 'notConfigured' | 'larger' | 'average';
export type CalibrationSet = 'pre' | 'post';
export type ReviewKey = 'pre' | 'distance' | 'comparison';

export interface RideInput {
  start: string;
  finish: string;
  startOverridden: boolean;
  overrideReason: string;
}

export interface ReviewRecord {
  signature: string;
  at: string;
  invalidationLogged?: boolean;
}

export type AuditKind =
'created' |
'edit' |
'override' |
'recalculation' |
'review' |
'invalidation' |
'acknowledgement' |
'sync' |
'conflict' |
'finalization' |
'version';

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  kind: AuditKind;
  summary: string;
  field?: string;
  from?: string;
  to?: string;
  reason?: string;
  note?: string;
}

export interface ConflictRecord {
  label: string;
  set: CalibrationSet;
  index: number;
  local: string;
  server: string;
  localAt: string;
  serverAt: string;
  serverActor: string;
}

export interface LoggedResults {
  preWC: string;
  distance: string;
  postWC: string;
}

export interface SessionData {
  reference: string;
  operator: string;
  example: boolean;
  createdAt: string;
  updatedAt: string;
  courseLength: string;
  rolloverMode: RolloverMode;
  rolloverMax: string;
  consistencyRule: ConsistencyRule;
  finalRule: FinalConstantRule;
  ruleSet: RuleSetVersion;
  pre: RideInput[];
  post: RideInput[];
  distStart: string;
  distFinish: string;
  reviews: Partial<Record<ReviewKey, ReviewRecord>>;
  acknowledgements: Record<string, ReviewRecord>;
  setupSaved: boolean;
  finalized: {at: string;by: string;} | null;
  lastStep: StepId;
  save: SaveStatus;
  sync: SyncStatus;
  syncQueued: boolean;
  conflict: ConflictRecord | null;
  audit: AuditEntry[];
  logged: LoggedResults;
}

export type SeedStage = 'postPartial' | 'needsReview' | 'ready' | 'finalized';

export interface SessionSeed {
  reference: string;
  operator: string;
  updatedAt: string;
  stage: SeedStage;
}