import { describe, it, expect } from 'vitest';
import { deriveSession } from './sessionRules';
import { blankSession } from './sessionFactory';
import type { SessionData } from '../types/session';

describe('Session Rules and Workflow State Engine', () => {
  it('initializes a blank session in Draft state with blockers', () => {
    const session = blankSession('BC-2026-TEST', 'Tester');
    const derived = deriveSession(session, 'online');

    expect(derived.state).toBe('Draft');
    expect(derived.hasReadings).toBe(false);
    expect(derived.blockers.length).toBeGreaterThan(0);
    expect(derived.blockers.map((b) => b.id)).toContain('inputs');
  });

  it('detects invalidations and sets review status to stale when inputs change', () => {
    const session: SessionData = {
      ...blankSession('BC-2026-TEST', 'Tester'),
      courseLength: '200',
      ruleSet: 'ws-0.3',
      finalRule: 'larger',
      pre: [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '', finish: '13042', startOverridden: false, overrideReason: '' },
        { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
        { start: '', finish: '15052', startOverridden: false, overrideReason: '' }
      ]
    };

    const derivedInitial = deriveSession(session, 'online');
    expect(derivedInitial.pre.complete).toBe(true);

    // Simulate reviewed state with recorded signature
    const reviewedSession: SessionData = {
      ...session,
      reviews: {
        pre: {
          signature: derivedInitial.signatures.pre,
          at: new Date().toISOString()
        }
      }
    };

    const derivedReviewed = deriveSession(reviewedSession, 'online');
    expect(derivedReviewed.reviews.pre).toBe('current');

    // Modify a source reading in Ride 1 finish
    const modifiedSession: SessionData = {
      ...reviewedSession,
      pre: [
        { ...reviewedSession.pre[0], finish: '12025' },
        ...reviewedSession.pre.slice(1)
      ]
    };

    const derivedModified = deriveSession(modifiedSession, 'online');
    expect(derivedModified.reviews.pre).toBe('stale');
  });

  it('blocks finalization when connectivity is offline', () => {
    const session = blankSession('BC-2026-TEST', 'Tester');
    const derivedOffline = deriveSession(session, 'offline');
    const connCheck = derivedOffline.checklist.find((c) => c.id === 'connection');
    expect(connCheck?.ok).toBe(false);
  });

  it('blocks finalization when governing measurement policy is unapproved (MP-01..MP-09)', () => {
    const session = blankSession('BC-2026-TEST', 'Tester');
    const derived = deriveSession(session, 'online');
    const policyCheck = derived.checklist.find((c) => c.id === 'policyApproval');
    expect(policyCheck).toBeDefined();
    expect(policyCheck?.ok).toBe(false);
    expect(derived.blockers.map((b) => b.id)).toContain('policyApproval');
  });

  it('prohibits finalization bypass when callers do not supply accredited policy approval', () => {
    const session: SessionData = {
      ...blankSession('BC-2026-FULL', 'Tester'),
      courseLength: '200',
      ruleSet: 'ws-0.3',
      rolloverMode: 'none',
      finalRule: 'larger',
      pre: [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '', finish: '13042', startOverridden: false, overrideReason: '' },
        { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
        { start: '', finish: '15052', startOverridden: false, overrideReason: '' },
      ],
      post: [
        { start: '321000', finish: '322000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '323000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '324000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '325000', startOverridden: false, overrideReason: '' },
      ],
      distStart: '124002',
      distFinish: '320456',
    };

    const d = deriveSession(session, 'online');
    expect(d.pre.complete).toBe(true);
    expect(d.post.complete).toBe(true);
    expect(d.distance.complete).toBe(true);

    // Populate all reviews and acknowledgements
    session.reviews = {
      pre: { signature: d.signatures.pre, at: new Date().toISOString() },
      distance: { signature: d.signatures.distance, at: new Date().toISOString() },
      comparison: { signature: d.signatures.comparison, at: new Date().toISOString() },
    };
    for (const w of d.warnings) {
      session.acknowledgements[w.id] = { signature: w.signature, at: new Date().toISOString() };
    }

    const dAllComplete = deriveSession(session, 'online');
    // Even when all steps, reviews, and warnings are resolved, policyApproval still blocks finalization
    const remainingBlockers = dAllComplete.blockers.map((b) => b.id);
    expect(remainingBlockers).toEqual(['policyApproval']);
    expect(dAllComplete.state).not.toBe('Finalized');
  });
});

