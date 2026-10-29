import { describe, it, expect } from 'vitest';
import {
  generateReportText,
  exportReportToJSON,
  PROVISIONAL_REPORT_NOTICE,
  UNRATIFIED_POLICY_STATEMENT,
} from './reportExport';
import { buildSeedSessions } from './sessionFactory';
import { deriveSession } from './sessionRules';
import type { SessionData } from '../types/session';

describe('Workstream C: Provisional Notice on Every Report Output', () => {
  const session: SessionData = JSON.parse(JSON.stringify(buildSeedSessions('online', 'examples')[0]));
  const derived = deriveSession(session, 'online');
  const snapshotAt = '2026-10-28T18:00:00.000Z';

  it('embeds prominent provisional notice at top and bottom of plain text / markdown report', () => {
    const reportText = generateReportText(session, derived, snapshotAt);

    expect(reportText).toContain(PROVISIONAL_REPORT_NOTICE);
    expect(reportText).toContain(UNRATIFIED_POLICY_STATEMENT);

    // Verify header notice
    const firstLines = reportText.slice(0, 300);
    expect(firstLines).toContain(`*** ${PROVISIONAL_REPORT_NOTICE} ***`);

    // Verify footer notice
    const lastLines = reportText.slice(-300);
    expect(lastLines).toContain(`*** ${PROVISIONAL_REPORT_NOTICE} ***`);
  });

  it('distinguishes calculated, reviewed, finalized, and officially certified states in text report', () => {
    const reportText = generateReportText(session, derived, snapshotAt);

    expect(reportText).toContain('Calculated State: Completed');
    expect(reportText).toContain(`Review State: ${derived.state}`);
    expect(reportText).toContain('Finalization State: Draft / Unfinalized');
    expect(reportText).toContain('Official Certification: PROHIBITED & BLOCKED');
  });

  it('includes prominent provisional notice and unratified policies in JSON report export', () => {
    const jsonStr = exportReportToJSON(session, derived, snapshotAt);
    const json = JSON.parse(jsonStr);

    expect(json.notice).toBe(PROVISIONAL_REPORT_NOTICE);
    expect(json.regulatoryPolicy.ratified).toBe(false);
    expect(json.regulatoryPolicy.governingStandard).toBe(session.ruleSet);
    expect(json.regulatoryPolicy.statement).toBe(UNRATIFIED_POLICY_STATEMENT);

    // Verify open policy register items are enumerated
    expect(json.regulatoryPolicy.unresolvedPolicies).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MP-01'),
        expect.stringContaining('MP-02'),
        expect.stringContaining('MP-03'),
      ])
    );

    // Distinct states
    expect(json.states.calculated).toBe(true);
    expect(json.states.reviewState).toBe(derived.state);
    expect(json.states.localFinalized).toBe(false);
    expect(json.states.officialCertification).toBe('BLOCKED_AND_PROHIBITED');
  });

  it('reflects local finalization state accurately without claiming official certification', () => {
    const finalizedSession: SessionData = JSON.parse(JSON.stringify(session));
    finalizedSession.finalized = {
      at: '2026-10-28T20:00:00.000Z',
      by: 'J. Okafor',
    };
    const finalizedDerived = deriveSession(finalizedSession, 'online');

    const reportText = generateReportText(finalizedSession, finalizedDerived, snapshotAt);
    expect(reportText).toContain('Locally finalized by J. Okafor');
    expect(reportText).toContain('Official Certification: PROHIBITED & BLOCKED');

    const json = JSON.parse(exportReportToJSON(finalizedSession, finalizedDerived, snapshotAt));
    expect(json.states.localFinalized).toBe(true);
    expect(json.states.officialCertification).toBe('BLOCKED_AND_PROHIBITED');
  });
});
