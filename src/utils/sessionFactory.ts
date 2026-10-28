import type {
  AuditEntry,
  CalibrationSet,
  Connectivity,
  RideInput,
  SessionData,
  SessionListScenario,
  SessionSeed } from
'../types/session';
import { conflictSeed, exampleOverride, exampleReadings, sessionSeeds, syncIssueReference } from '../data/sessions';
import { ACK_NOTE, makeEntry } from './audit';
import { deriveSession, type Derived } from './sessionRules';
import { ENGINE_VERSION, fmt } from './calibration';

export function blankRides(): RideInput[] {
  return Array.from({ length: 4 }, () => ({ start: '', finish: '', startOverridden: false, overrideReason: '' }));
}

export function withRides(s: SessionData, set: CalibrationSet, rides: RideInput[]): SessionData {
  return set === 'pre' ? { ...s, pre: rides } : { ...s, post: rides };
}

export function blankSession(reference: string, operator: string, at = new Date().toISOString()): SessionData {
  return {
    reference,
    operator,
    example: false,
    createdAt: at,
    updatedAt: at,
    courseLength: '',
    rolloverMode: 'notConfigured',
    rolloverMax: '',
    consistencyRule: 'pending',
    finalRule: 'notConfigured',
    ruleSet: 'notConfigured',
    pre: blankRides(),
    post: blankRides(),
    distStart: '',
    distFinish: '',
    reviews: {},
    acknowledgements: {},
    setupSaved: false,
    finalized: null,
    lastStep: 'setup',
    save: 'saved',
    sync: 'pending',
    syncQueued: true,
    conflict: null,
    audit: [makeEntry({ kind: 'created', actor: operator, summary: 'Session created as a local draft on this device', at })],
    logged: { preWC: '—', distance: '—', postWC: '—' }
  };
}

function ridesFrom(start: string, finishes: string[], filled: number): RideInput[] {
  return blankRides().map((r, i) => ({ ...r, start: i === 0 ? start : '', finish: i < filled ? finishes[i] : '' }));
}

function seedAudit(seed: SessionSeed, d: Derived): AuditEntry[] {
  const base = new Date(seed.updatedAt).getTime() - 4 * 60 * 60 * 1000;
  let step = 0;
  const op = seed.operator;
  const e = (p: Omit<AuditEntry, 'id' | 'at'>) => makeEntry({ ...p, at: new Date(base + step++ * 9 * 60000).toISOString() });
  const full = seed.stage !== 'postPartial';

  const list: AuditEntry[] = [
  e({ kind: 'created', actor: op, summary: 'Session created as a local draft on this device' }),
  e({ kind: 'version', actor: 'System', summary: `Setup saved · Working specification v0.3 (pending approval) · ${ENGINE_VERSION}` }),
  e({ kind: 'edit', actor: op, summary: 'Pre-calibration readings entered', field: 'Pre-calibration Rides 1–4', note: 'Start 11082; finishes 12021, 13042, 14052, 15052' }),
  e({ kind: 'recalculation', actor: 'System', summary: 'Pre-calibration WC recalculated', field: 'Pre-calibration WC', from: '—', to: fmt(d.pre.wc) }),
  e({ kind: 'acknowledgement', actor: op, summary: 'Warning reviewed: Rule set pending approval', note: ACK_NOTE }),
  e({ kind: 'acknowledgement', actor: op, summary: 'Warning reviewed: Pre-calibration ride consistency not verified', note: ACK_NOTE }),
  e({ kind: 'review', actor: op, summary: `Pre-calibration calculation reviewed (WC ${fmt(d.pre.wc)})` }),
  e({ kind: 'edit', actor: op, summary: 'Course distance readings entered', field: 'Course distance', note: 'Start 124002; finish 320456' }),
  e({ kind: 'recalculation', actor: 'System', summary: 'Course distance recalculated', field: 'Course distance (km)', from: '—', to: fmt(d.distance.km) }),
  e({ kind: 'review', actor: op, summary: `Course distance reviewed (${fmt(d.distance.km, 3)} km)` }),
  e({ kind: 'edit', actor: op, summary: full ? 'Post-calibration readings entered' : 'Post-calibration Rides 1–2 entered', field: 'Post-calibration rides' })];

  if (seed.stage === 'needsReview') {
    list.push(
      e({
        kind: 'override',
        actor: op,
        summary: 'Linked start overridden',
        field: 'Post-calibration Ride 3 start',
        from: exampleReadings.postFinishes[1],
        to: exampleOverride.value,
        reason: exampleOverride.reason
      })
    );
  }
  if (full) {
    list.push(e({ kind: 'recalculation', actor: 'System', summary: 'Post-calibration WC recalculated', field: 'Post-calibration WC', from: '—', to: fmt(d.post.wc) }));
  }
  if (seed.stage === 'ready' || seed.stage === 'finalized') {
    list.push(
      e({ kind: 'version', actor: op, summary: 'Final constant rule set: Larger of pre and post WC (placeholder, pending approval)', field: 'Final constant selection rule', from: 'Not configured', to: 'Larger of pre and post WC' }),
      e({ kind: 'acknowledgement', actor: op, summary: 'Warning reviewed: Post-calibration ride consistency not verified', note: ACK_NOTE }),
      e({ kind: 'review', actor: op, summary: `Calibration comparison reviewed (difference ${fmt(d.comparison.difference, 4)})` })
    );
  }
  if (seed.stage === 'finalized') {
    list.push(e({ kind: 'finalization', actor: op, summary: `Session finalized — course distance ${fmt(d.distance.km, 3)} km` }));
  }
  return list;
}

function buildSeedSession(seed: SessionSeed, connectivity: Connectivity): SessionData {
  const r = exampleReadings;
  const full = seed.stage !== 'postPartial';
  let s: SessionData = {
    ...blankSession(seed.reference, seed.operator, seed.updatedAt),
    example: true,
    updatedAt: seed.updatedAt,
    courseLength: r.courseLength,
    rolloverMode: 'none',
    ruleSet: 'ws-0.3',
    setupSaved: true,
    pre: ridesFrom(r.preStart, r.preFinishes, 4),
    post: ridesFrom(r.postStart, r.postFinishes, full ? 4 : 2),
    distStart: r.distStart,
    distFinish: r.distFinish,
    finalRule: seed.stage === 'ready' || seed.stage === 'finalized' ? 'larger' : 'notConfigured',
    lastStep: seed.stage === 'postPartial' ? 'post' : 'review',
    sync: seed.stage === 'postPartial' ? 'pending' : 'synced',
    syncQueued: false
  };
  if (seed.stage === 'needsReview') {
    s = {
      ...s,
      post: s.post.map((ride, i) =>
      i === exampleOverride.index ? { ...ride, startOverridden: true, start: exampleOverride.value, overrideReason: exampleOverride.reason } : ride
      )
    };
  }

  const d = deriveSession(s, 'online');
  const at = seed.updatedAt;
  const reviewed = seed.stage === 'ready' || seed.stage === 'finalized';
  s.reviews = {
    pre: { signature: d.signatures.pre, at },
    distance: { signature: d.signatures.distance, at },
    ...(reviewed ? { comparison: { signature: d.signatures.comparison, at } } : {})
  };
  const ackIds = reviewed ? d.warnings.map((w) => w.id) : ['config-ruleset', 'pre-consistency'];
  s.acknowledgements = Object.fromEntries(
    d.warnings.filter((w) => ackIds.includes(w.id)).map((w) => [w.id, { signature: w.signature, at }])
  );
  s.logged = { preWC: fmt(d.pre.wc), distance: fmt(d.distance.km), postWC: fmt(d.post.wc) };
  s.audit = seedAudit(seed, d);
  if (seed.stage === 'finalized') s.finalized = { at, by: seed.operator };

  if (connectivity === 'syncIssue' && seed.reference === syncIssueReference) s.sync = 'issue';
  if (connectivity === 'syncConflict' && seed.reference === conflictSeed.reference) {
    const { reference: _ref, ...conflict } = conflictSeed;
    s.conflict = conflict;
    s.sync = 'issue';
  }
  return s;
}

export function buildSeedSessions(connectivity: Connectivity, scenario: SessionListScenario): SessionData[] {
  if (scenario === 'empty') return [];
  return sessionSeeds.map((seed) => buildSeedSession(seed, connectivity));
}