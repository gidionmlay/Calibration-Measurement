import { describe, it, expect } from 'vitest';
import { fmt, resolveApplicableConstant, selectFinalConstant } from './calibration';
import { deriveSession, type MeasurementPolicy } from './sessionRules';
import { appendAudit, loggedResults } from './audit';
import { blankSession } from './sessionFactory';
import type { RideInput, SessionData } from '../types/session';

/**
 * DEF-02 regression suite — course distance must use the applicable working constant
 * determined by the selected final-constant rule, not the pre-calibration WC unconditionally.
 *
 * NOTE: none of the final-constant rules are approved. These tests assert the *mechanics* of each
 * provisional option; they do not assert that any option is officially required.
 */

const ride = (start: string, finish: string): RideInput => ({ start, finish, startOverridden: false, overrideReason: '' });
const ridesFromCounts = (start: number, counts: number[]): RideInput[] => {
  let cursor = start;
  return counts.map((c, i) => {
    const s = cursor;
    cursor += c;
    return ride(i === 0 ? String(s) : '', String(cursor));
  });
};

// Pre: 939, 1021, 1010, 1000 over 200 m → WC 4967.4625 (known reference case)
const PRE = [ride('11082', '12021'), ride('', '13042'), ride('', '14052'), ride('', '15052')];
// Post A: 1000 × 4 → WC ≈ 5005 (larger than pre)
const POST_HIGH = ridesFromCounts(321000, [1000, 1000, 1000, 1000]);
// Post B: 990 × 4 → WC ≈ 4954.95 (smaller than pre)
const POST_LOW = ridesFromCounts(321000, [990, 990, 990, 990]);
const T = 196454; // 320456 − 124002

const APPROVE_ALL: MeasurementPolicy = { isFinalRuleApproved: (r) => r !== 'notConfigured' };

function session(over: Partial<SessionData> = {}): SessionData {
  return {
    ...blankSession('BC-2026-TEST', 'Tester', '2026-10-28T10:00:00.000Z'),
    courseLength: '200',
    ruleSet: 'ws-0.3',
    rolloverMode: 'none',
    pre: PRE,
    post: POST_HIGH,
    distStart: '124002',
    distFinish: '320456',
    ...over
  };
}

describe('resolveApplicableConstant — single authoritative WC selection', () => {
  const pre = 4967.4625;
  const post = 5005;

  it('returns no constant when pre-calibration is unavailable', () => {
    const b = resolveApplicableConstant('larger', null, post, false);
    expect(b.wc).toBeNull();
    expect(b.source).toBe('none');
    expect(b.provisional).toBe(true);
    expect(b.reasons).toContain('preIncomplete');
  });

  it.each(['larger', 'average', 'notConfigured'] as const)('falls back to provisional pre WC when post is missing (rule %s)', (rule) => {
    const b = resolveApplicableConstant(rule, pre, null, false);
    expect(b.wc).toBe(pre);
    expect(b.source).toBe('pre');
    expect(b.provisional).toBe(true);
    expect(b.reasons).toContain('postIncomplete');
  });

  it('uses provisional pre WC and flags ruleNotConfigured when no rule is configured', () => {
    const b = resolveApplicableConstant('notConfigured', pre, post, false);
    expect(b.wc).toBe(pre);
    expect(b.source).toBe('pre');
    expect(b.reasons).toEqual(['ruleNotConfigured']);
  });

  it('applies the larger constant under the "larger" rule, still provisional while unapproved', () => {
    const b = resolveApplicableConstant('larger', pre, post, false);
    expect(b.wc).toBe(post);
    expect(b.source).toBe('final');
    expect(b.provisional).toBe(true);
    expect(b.reasons).toEqual(['ruleNotApproved']);
  });

  it('applies the mean constant under the "average" rule', () => {
    const b = resolveApplicableConstant('average', pre, post, false);
    expect(b.wc).toBe((pre + post) / 2);
    expect(b.wc).toBe(selectFinalConstant('average', pre, post));
  });

  it('is not provisional only when both results exist and the rule is approved', () => {
    const b = resolveApplicableConstant('larger', pre, post, true);
    expect(b.provisional).toBe(false);
    expect(b.reasons).toEqual([]);
  });
});

describe('deriveSession — course distance follows the applicable constant (DEF-02)', () => {
  it('Case 1: post incomplete → provisional pre WC', () => {
    const d = deriveSession(session({ post: [POST_HIGH[0], ride('', ''), ride('', ''), ride('', '')], finalRule: 'larger' }), 'online');
    expect(d.post.complete).toBe(false);
    expect(d.distance.basis.source).toBe('pre');
    expect(d.distance.wc).toBe(d.pre.wc);
    expect(d.distance.km).toBe(T / d.pre.wc!);
    expect(d.distance.basis.provisional).toBe(true);
  });

  it('Case 2: rule notConfigured → provisional pre WC and finalization blocked', () => {
    const d = deriveSession(session({ finalRule: 'notConfigured' }), 'online');
    expect(d.post.complete).toBe(true);
    expect(d.finalConstant).toBeNull();
    expect(d.distance.wc).toBe(d.pre.wc);
    expect(d.distance.basis.reasons).toContain('ruleNotConfigured');
    expect(d.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['finalRule', 'policyApproval']));
  });

  it('Case 3: rule "larger" with post > pre → distance uses post WC, not pre WC', () => {
    const d = deriveSession(session({ finalRule: 'larger' }), 'online');
    expect(d.post.wc!).toBeGreaterThan(d.pre.wc!);
    expect(d.distance.wc).toBe(d.post.wc);
    expect(d.distance.wc).toBe(d.finalConstant);
    expect(d.distance.km).toBe(T / d.post.wc!);
    expect(d.distance.km).not.toBe(T / d.pre.wc!);
    expect(d.distance.basis.source).toBe('final');
  });

  it('Case 3b: rule "larger" with pre > post → distance equals pre-based value', () => {
    const d = deriveSession(session({ finalRule: 'larger', post: POST_LOW }), 'online');
    expect(d.pre.wc!).toBeGreaterThan(d.post.wc!);
    expect(d.distance.wc).toBe(d.pre.wc);
    expect(d.distance.basis.source).toBe('final');
  });

  it('Case 4: rule "average" → distance uses mean constant at full precision', () => {
    const d = deriveSession(session({ finalRule: 'average' }), 'online');
    const mean = (d.pre.wc! + d.post.wc!) / 2;
    expect(d.distance.wc).toBe(mean);
    expect(d.distance.km).toBe(T / mean);
    expect(fmt(d.distance.km, 3)).toBe((T / mean).toFixed(3));
  });

  it('distance changes only when the applicable WC changes', () => {
    // notConfigured: changing post readings must not move the (pre-based) distance
    const a = deriveSession(session({ finalRule: 'notConfigured', post: POST_HIGH }), 'online');
    const b = deriveSession(session({ finalRule: 'notConfigured', post: POST_LOW }), 'online');
    expect(a.distance.km).toBe(b.distance.km);
    // larger with post < pre: applicable WC stays pre, so distance is unchanged from notConfigured
    const c = deriveSession(session({ finalRule: 'larger', post: POST_LOW }), 'online');
    expect(c.distance.km).toBe(a.distance.km);
    // larger with post > pre: applicable WC changes, so distance changes
    const e = deriveSession(session({ finalRule: 'larger', post: POST_HIGH }), 'online');
    expect(e.distance.km).not.toBe(a.distance.km);
  });

  it('marks results as provisional for every currently selectable rule (none approved)', () => {
    (['notConfigured', 'larger', 'average'] as const).forEach((finalRule) => {
      const d = deriveSession(session({ finalRule }), 'online');
      expect(d.distance.basis.provisional).toBe(true);
      expect(d.blockers.map((x) => x.id)).toContain('policyApproval');
    });
  });

  it('removes the policy blocker only when an approval policy is supplied', () => {
    const d = deriveSession(session({ finalRule: 'larger' }), 'online', APPROVE_ALL);
    expect(d.distance.basis.provisional).toBe(false);
    expect(d.checklist.find((c) => c.id === 'policyApproval')?.ok).toBe(true);
  });
});

describe('review invalidation and audit consistency', () => {
  function reviewed(s: SessionData): SessionData {
    const d = deriveSession(s, 'online');
    return { ...s, reviews: { distance: { signature: d.signatures.distance, at: '2026-10-28T10:00:00.000Z' } } };
  }

  it('Case 5: switching larger → average makes the distance review stale', () => {
    const s = reviewed(session({ finalRule: 'larger' }));
    expect(deriveSession(s, 'online').reviews.distance).toBe('current');
    expect(deriveSession({ ...s, finalRule: 'average' }, 'online').reviews.distance).toBe('stale');
  });

  it('a post reading change invalidates the distance review only when it changes the applicable WC', () => {
    const notConfigured = reviewed(session({ finalRule: 'notConfigured' }));
    expect(deriveSession({ ...notConfigured, post: POST_LOW }, 'online').reviews.distance).toBe('current');
    const larger = reviewed(session({ finalRule: 'larger' }));
    expect(deriveSession({ ...larger, post: POST_LOW }, 'online').reviews.distance).toBe('stale');
  });

  it('a rule change logs one recalculation and one invalidation event, without duplicates on later edits', () => {
    const base = reviewed(session({ finalRule: 'notConfigured' }));
    const start = { ...base, logged: loggedResults(base, 'online') };
    const changed = appendAudit({ ...start, finalRule: 'larger' }, [], 'online');
    const kinds = changed.audit.slice(start.audit.length).map((e) => `${e.kind}:${e.field ?? e.summary}`);
    expect(kinds).toContain('recalculation:Course distance (km)');
    expect(kinds.filter((k) => k.startsWith('invalidation')).length).toBe(1);
    const again = appendAudit(changed, [], 'online');
    expect(again.audit.length).toBe(changed.audit.length);
  });

  it('logged/audited distance equals the derived distance used by every screen', () => {
    const s = session({ finalRule: 'average' });
    const d = deriveSession(s, 'online');
    expect(loggedResults(s, 'online').distance).toBe(fmt(d.distance.km));
    expect(d.distance.km).toBe(d.distance.count && d.distance.count.ok ? d.distance.count.count / d.distance.basis.wc! : NaN);
  });
});
