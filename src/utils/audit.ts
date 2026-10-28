import type { AuditEntry, Connectivity, LoggedResults, ReviewKey, SessionData } from '../types/session';
import { deriveSession } from './sessionRules';
import { fmt } from './calibration';
import { reviewLabels } from '../data/options';

export const ACK_NOTE = 'Records that the warning was inspected. It does not confirm the data is correct.';

let counter = 0;

export function makeEntry(partial: Omit<AuditEntry, 'id' | 'at'> & {at?: string;}): AuditEntry {
  counter += 1;
  return { ...partial, id: `a-${Date.now().toString(36)}-${counter}`, at: partial.at ?? new Date().toISOString() };
}

const resultLabels: Record<keyof LoggedResults, string> = {
  preWC: 'Pre-calibration WC',
  distance: 'Course distance (km)',
  postWC: 'Post-calibration WC'
};

export function loggedResults(s: SessionData, connectivity: Connectivity): LoggedResults {
  const d = deriveSession(s, connectivity);
  return { preWC: fmt(d.pre.wc), distance: fmt(d.distance.km), postWC: fmt(d.post.wc) };
}

/** Appends entries plus any recalculation and review-invalidation events the change caused. */
export function appendAudit(s: SessionData, entries: AuditEntry[], connectivity: Connectivity): SessionData {
  const d = deriveSession(s, connectivity);
  const next: LoggedResults = { preWC: fmt(d.pre.wc), distance: fmt(d.distance.km), postWC: fmt(d.post.wc) };
  const extra: AuditEntry[] = [];

  (Object.keys(next) as (keyof LoggedResults)[]).forEach((k) => {
    if (next[k] !== s.logged[k]) {
      extra.push(
        makeEntry({ kind: 'recalculation', actor: 'System', summary: `${resultLabels[k]} recalculated`, field: resultLabels[k], from: s.logged[k], to: next[k] })
      );
    }
  });

  const reviews = { ...s.reviews };
  (['pre', 'distance', 'comparison'] as ReviewKey[]).forEach((k) => {
    const r = reviews[k];
    if (r && d.reviews[k] === 'stale' && !r.invalidationLogged) {
      reviews[k] = { ...r, invalidationLogged: true };
      extra.push(makeEntry({ kind: 'invalidation', actor: 'System', summary: `${reviewLabels[k]} review invalidated — a source value changed` }));
    }
  });

  return { ...s, reviews, logged: next, audit: [...s.audit, ...entries, ...extra] };
}