import { describe, it, expect } from 'vitest';
import {
  parseReading,
  parseCourseLength,
  countBetween,
  resolveRides,
  computeCalibration,
  computeDistance,
  resolveApplicableConstant,
  fmt,
  DISTANCE_DISPLAY_DECIMALS,
  WC_DISPLAY_DECIMALS,
  type RolloverConfig,
} from './calibration';
import { deriveSession } from './sessionRules';
import { blankSession } from './sessionFactory';
import { generateReportText, exportReportToJSON } from './reportExport';
import type { RideInput, SessionData } from '../types/session';

/**
 * PHASE 8 INDEPENDENT CALCULATION VALIDATION TEST SUITE
 *
 * This module establishes an independent mathematical reference model
 * implemented from first principles (formal specification formulas).
 * None of the reference functions call the production calculation functions
 * to derive expected results.
 */

/* ========================================================================= */
/* 1. INDEPENDENT REFERENCE CALCULATION HELPER FUNCTIONS                     */
/* ========================================================================= */

/** Reference formula: d_i = B_i - A_i */
function refRideDifference(start: number, finish: number, rolloverMax?: number): number {
  if (finish >= start) {
    return finish - start;
  }
  if (rolloverMax !== undefined) {
    return finish + (rolloverMax + 1) - start;
  }
  throw new Error('Rollover encountered without configured max');
}

/** Reference formula: D = sum(d_i) */
function refTotalDifference(diffs: number[]): number {
  return diffs.reduce((acc, d) => acc + d, 0);
}

/** Reference formula: C_avg = D / 4 */
function refAverageCount(diffs: number[]): number {
  return refTotalDifference(diffs) / diffs.length;
}

/** Reference formula: L_km = L / 1000 */
function refCourseKm(courseMetres: number): number {
  return courseMetres / 1000;
}

/**
 * Reference formula: CPK = C_avg / L_km
 * Implemented using exact rational arithmetic (average * 1000 / metres)
 * to verify precision against IEEE 754 double precision.
 */
function refCPK(average: number, courseMetres: number): number {
  return (average * 1000) / courseMetres;
}

/** Reference formula: WC = CPK * 1.001 */
function refWorkingConstant(cpk: number): number {
  return cpk * 1.001;
}

/** Reference formula: T = F - S */
function refCourseCount(start: number, finish: number, rolloverMax?: number): number {
  return refRideDifference(start, finish, rolloverMax);
}

/** Reference formula: distance = T / WC */
function refCourseDistance(courseCount: number, workingConstant: number): number {
  return courseCount / workingConstant;
}

/** Helper to construct test rides */
const createRide = (start: string, finish: string, overridden = false, reason = ''): RideInput => ({
  start,
  finish,
  startOverridden: overridden,
  overrideReason: reason,
});

/* ========================================================================= */
/* 2. KNOWN REFERENCE TEST CASE VALIDATION                                    */
/* ========================================================================= */

describe('Phase 8 — Independent Reference Calculation: Known 200m Course', () => {
  // Course: 200m
  // Start: 11082, Finishes: 12021, 13042, 14052, 15052
  const courseMetres = 200;
  const startReading = 11082;
  const finishReadings = [12021, 13042, 14052, 15052];

  // Independent manual derivation:
  // Ride 1: 12021 - 11082 = 939
  // Ride 2: 13042 - 12021 = 1021
  // Ride 3: 14052 - 13042 = 1010
  // Ride 4: 15052 - 14052 = 1000
  const expectedDiffs = [939, 1021, 1010, 1000];
  const expectedTotal = 939 + 1021 + 1010 + 1000; // 3970
  const expectedAvg = 3970 / 4; // 992.5
  const expectedCourseKm = 200 / 1000; // 0.2
  const expectedCPK = 992.5 / 0.2; // 4962.5
  const expectedWC = 4962.5 * 1.001; // 4967.4625

  // Course distance readings: start 124002, finish 320456
  const courseStart = 124002;
  const courseFinish = 320456;
  const expectedCount = 320456 - 124002; // 196454
  const expectedDistanceKm = 196454 / 4967.4625; // 39.54815964887823...

  const rides: RideInput[] = [
    createRide(String(startReading), String(finishReadings[0])),
    createRide('', String(finishReadings[1])),
    createRide('', String(finishReadings[2])),
    createRide('', String(finishReadings[3])),
  ];
  const rollover: RolloverConfig = { mode: 'none', max: '' };

  it('independently verifies individual ride counts match the reference derivation', () => {
    // Assert reference helper matches manual arithmetic
    expect(refRideDifference(11082, 12021)).toBe(939);
    expect(refRideDifference(12021, 13042)).toBe(1021);
    expect(refRideDifference(13042, 14052)).toBe(1010);
    expect(refRideDifference(14052, 15052)).toBe(1000);

    // Assert production engine reproduces reference derivation
    const prod = computeCalibration(rides, String(courseMetres), rollover);
    expect(prod.counts).toEqual(expectedDiffs);
  });

  it('independently verifies total D = 3970 and average C_avg = 992.5', () => {
    expect(refTotalDifference(expectedDiffs)).toBe(expectedTotal);
    expect(refAverageCount(expectedDiffs)).toBe(expectedAvg);

    const prod = computeCalibration(rides, String(courseMetres), rollover);
    expect(prod.total).toBe(expectedTotal);
    expect(prod.average).toBe(expectedAvg);
  });

  it('independently verifies course length in km = 0.2 and CPK = 4962.5', () => {
    expect(refCourseKm(courseMetres)).toBe(expectedCourseKm);
    expect(refCPK(expectedAvg, courseMetres)).toBe(expectedCPK);

    const prod = computeCalibration(rides, String(courseMetres), rollover);
    expect(prod.courseKm).toBe(expectedCourseKm);
    expect(prod.cpk).toBe(expectedCPK);
  });

  it('independently verifies working constant WC = 4967.4625', () => {
    expect(refWorkingConstant(expectedCPK)).toBe(expectedWC);

    const prod = computeCalibration(rides, String(courseMetres), rollover);
    expect(prod.wc).toBe(expectedWC);
    // Display rounding at 4 decimals
    expect(fmt(prod.wc, WC_DISPLAY_DECIMALS)).toBe('4967.4625');
  });

  it('independently verifies course count T = 196454 and distance = 39.548 km', () => {
    expect(refCourseCount(courseStart, courseFinish)).toBe(expectedCount);
    expect(refCourseDistance(expectedCount, expectedWC)).toBeCloseTo(expectedDistanceKm, 10);

    const prodDist = computeDistance(String(courseStart), String(courseFinish), expectedWC, rollover);
    expect(prodDist.complete).toBe(true);
    expect(prodDist.count?.ok).toBe(true);
    if (prodDist.count?.ok) {
      expect(prodDist.count.count).toBe(expectedCount);
    }
    expect(prodDist.km).toBeCloseTo(expectedDistanceKm, 10);

    // Display formatting
    expect(fmt(prodDist.km, DISTANCE_DISPLAY_DECIMALS)).toBe('39.548');
  });
});

/* ========================================================================= */
/* 3. EDGE CASES AND NUMERICAL BOUNDARY VALIDATION                           */
/* ========================================================================= */

describe('Phase 8 — Edge Cases and Numerical Robustness', () => {
  const rolloverNone: RolloverConfig = { mode: 'none', max: '' };
  const rolloverNotConfigured: RolloverConfig = { mode: 'notConfigured', max: '' };
  const rolloverWrap999k: RolloverConfig = { mode: 'wrap', max: '999999' };

  describe('Zero and Negative Differences', () => {
    it('handles identical start and finish reading as zero count', () => {
      const res = countBetween(5000, 5000, rolloverNone);
      expect(res).toEqual({ ok: true, count: 0, adjustment: 0 });
    });

    it('rejects finish < start when counter is configured as non-wrapping', () => {
      const res = countBetween(5000, 4999, rolloverNone);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('non-wrapping');
    });

    it('rejects finish < start when rollover is not configured', () => {
      const res = countBetween(5000, 4999, rolloverNotConfigured);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('Rollover handling is not configured');
    });

    it('correctly calculates wrapped count when finish < start and mode is wrap', () => {
      // 999980 to 20 on 999999 counter: 20 + 1000000 - 999980 = 40
      const refCount = refCourseCount(999980, 20, 999999);
      expect(refCount).toBe(40);

      const res = countBetween(999980, 20, rolloverWrap999k);
      expect(res).toEqual({ ok: true, count: 40, adjustment: 1000000 });
    });

    it('rejects wrap when either reading exceeds the configured max', () => {
      const res = countBetween(1000005, 50, rolloverWrap999k);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('exceeds the configured counter maximum');
    });
  });

  describe('Course Length Edge Cases and Parsing', () => {
    it('rejects zero and negative course lengths', () => {
      expect(parseCourseLength('0')).toEqual({ ok: false, reason: 'notPositive' });
      expect(parseCourseLength('-1')).toEqual({ ok: false, reason: 'notPositive' });
      expect(parseCourseLength('-500.5')).toEqual({ ok: false, reason: 'notPositive' });
    });

    it('rejects missing or empty course lengths', () => {
      expect(parseCourseLength('')).toEqual({ ok: false, reason: 'missing' });
      expect(parseCourseLength('   ')).toEqual({ ok: false, reason: 'missing' });
    });

    it('rejects malformed text for course length', () => {
      expect(parseCourseLength('200m')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseCourseLength('two hundred')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('accepts integer and decimal course lengths', () => {
      expect(parseCourseLength('200')).toEqual({ ok: true, value: 200 });
      expect(parseCourseLength('333.333')).toEqual({ ok: true, value: 333.333 });
    });

    it('handles extremely small course lengths without crashing', () => {
      const check = parseCourseLength('0.001');
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.value).toBe(0.001);
        const cpk = refCPK(1000, 0.001);
        expect(cpk).toBe(1000000000); // 1 billion counts/km
      }
    });

    it('handles unusually large course lengths without precision loss', () => {
      const check = parseCourseLength('50000');
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.value).toBe(50000);
        const cpk = refCPK(1000, 50000);
        expect(cpk).toBe(20);
      }
    });
  });

  describe('Reading Parsing and Format Validation', () => {
    it('accepts only non-negative integer readings', () => {
      expect(parseReading('0')).toEqual({ ok: true, value: 0 });
      expect(parseReading('124002')).toEqual({ ok: true, value: 124002 });
      expect(parseReading('  54321  ')).toEqual({ ok: true, value: 54321 });
    });

    it('rejects decimal numbers because counter displays discrete whole counts', () => {
      expect(parseReading('124002.5')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects negative numbers and alphabetical characters', () => {
      expect(parseReading('-100')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseReading('10A20')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseReading('count')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects empty and whitespace strings', () => {
      expect(parseReading('')).toEqual({ ok: false, reason: 'missing' });
      expect(parseReading('  ')).toEqual({ ok: false, reason: 'missing' });
    });
  });

  describe('Large Readings and IEEE 754 Safety', () => {
    it('operates well within JavaScript Number.MAX_SAFE_INTEGER', () => {
      const largeReading = 999999999; // 1 billion - 1
      expect(largeReading).toBeLessThan(Number.MAX_SAFE_INTEGER);

      const res = countBetween(100000000, largeReading, rolloverNone);
      expect(res).toEqual({ ok: true, count: 899999999, adjustment: 0 });
    });
  });
});

/* ========================================================================= */
/* 4. POLICY-DEPENDENT BEHAVIOR & FINAL CONSTANT RESOLUTION                  */
/* ========================================================================= */

describe('Phase 8 — Working Constant Resolution and Provisional Policy Governance', () => {
  const preWC = 4967.4625;
  const postWCHigh = 5005.0;
  const postWCLow = 4950.0;

  it('selects pre WC when post-calibration is incomplete', () => {
    const basis = resolveApplicableConstant('larger', preWC, null, false);
    expect(basis.wc).toBe(preWC);
    expect(basis.source).toBe('pre');
    expect(basis.provisional).toBe(true);
    expect(basis.reasons).toContain('postIncomplete');
  });

  it('flags ruleNotConfigured and uses pre WC when rule is notConfigured', () => {
    const basis = resolveApplicableConstant('notConfigured', preWC, postWCHigh, false);
    expect(basis.wc).toBe(preWC);
    expect(basis.source).toBe('pre');
    expect(basis.provisional).toBe(true);
    expect(basis.reasons).toEqual(['ruleNotConfigured']);
  });

  it('selects larger constant under "larger" rule (post > pre)', () => {
    const basis = resolveApplicableConstant('larger', preWC, postWCHigh, false);
    expect(basis.wc).toBe(postWCHigh);
    expect(basis.source).toBe('final');
    expect(basis.provisional).toBe(true); // unratified
    expect(basis.reasons).toEqual(['ruleNotApproved']);
  });

  it('selects larger constant under "larger" rule (pre > post)', () => {
    const basis = resolveApplicableConstant('larger', preWC, postWCLow, false);
    expect(basis.wc).toBe(preWC);
    expect(basis.source).toBe('final');
    expect(basis.provisional).toBe(true);
    expect(basis.reasons).toEqual(['ruleNotApproved']);
  });

  it('selects exact arithmetic average under "average" rule', () => {
    const expectedAvg = (preWC + postWCHigh) / 2;
    const basis = resolveApplicableConstant('average', preWC, postWCHigh, false);
    expect(basis.wc).toBe(expectedAvg);
    expect(basis.source).toBe('final');
    expect(basis.provisional).toBe(true);
  });

  it('marks constant as non-provisional ONLY when policy is explicitly approved', () => {
    const basis = resolveApplicableConstant('larger', preWC, postWCHigh, true);
    expect(basis.provisional).toBe(false);
    expect(basis.reasons).toEqual([]);
  });

  it('blocks finalization when policy is unratified in session derivation', () => {
    const s: SessionData = {
      ...blankSession('BC-TEST', 'Tester', '2026-10-29T00:00:00Z'),
      courseLength: '200',
      ruleSet: 'ws-0.3',
      rolloverMode: 'none',
      finalRule: 'larger',
      pre: [
        createRide('11082', '12021'),
        createRide('', '13042'),
        createRide('', '14052'),
        createRide('', '15052'),
      ],
      post: [
        createRide('321000', '322000'),
        createRide('', '323000'),
        createRide('', '324000'),
        createRide('', '325000'),
      ],
      distStart: '124002',
      distFinish: '320456',
    };

    const derived = deriveSession(s, 'online');
    // Without approved policy, policyApproval blocker is active
    const policyBlocker = derived.blockers.find((b) => b.id === 'policyApproval');
    expect(policyBlocker).toBeDefined();
    expect(policyBlocker?.ok).toBe(false);
    expect(derived.state).not.toBe('Finalized');
  });
});

/* ========================================================================= */
/* 5. SEQUENTIAL LINKAGE, OVERRIDES & DOWNSTREAM REVIEW INVALIDATION         */
/* ========================================================================= */

describe('Phase 8 — Sequential Propagation and Review Invalidation', () => {
  const rollover: RolloverConfig = { mode: 'none', max: '' };

  it('automatically propagates finish reading to next ride start reading', () => {
    const rides: RideInput[] = [
      createRide('1000', '2000'),
      createRide('', '3000'),
      createRide('', '4000'),
      createRide('', '5000'),
    ];

    const resolved = resolveRides(rides, rollover);
    expect(resolved[1].startRaw).toBe('2000');
    expect(resolved[1].linked).toBe(true);
    expect(resolved[2].startRaw).toBe('3000');
    expect(resolved[2].linked).toBe(true);
    expect(resolved[3].startRaw).toBe('4000');
    expect(resolved[3].linked).toBe(true);
  });

  it('honors explicit start override and records override reason', () => {
    const rides: RideInput[] = [
      createRide('1000', '2000'),
      createRide('2050', '3000', true, 'Relocated front wheel'),
      createRide('', '4000'),
      createRide('', '5000'),
    ];

    const resolved = resolveRides(rides, rollover);
    expect(resolved[1].linked).toBe(false);
    expect(resolved[1].overridden).toBe(true);
    expect(resolved[1].startRaw).toBe('2050');
    expect(resolved[1].overrideReason).toBe('Relocated front wheel');
    expect(resolved[1].linkedValue).toBe('2000');
    // Ride 3 links to Ride 2 finish
    expect(resolved[2].startRaw).toBe('3000');
  });

  it('invalidates downstream reviews when an upstream reading is modified', () => {
    const s: SessionData = {
      ...blankSession('BC-TEST', 'Tester', '2026-10-29T00:00:00Z'),
      courseLength: '200',
      ruleSet: 'ws-0.3',
      rolloverMode: 'none',
      finalRule: 'larger',
      pre: [
        createRide('11082', '12021'),
        createRide('', '13042'),
        createRide('', '14052'),
        createRide('', '15052'),
      ],
      post: [
        createRide('321000', '322000'),
        createRide('', '323000'),
        createRide('', '324000'),
        createRide('', '325000'),
      ],
      distStart: '124002',
      distFinish: '320456',
    };

    // Simulate reviews completed on initial readings
    const dInitial = deriveSession(s, 'online');
    s.reviews = {
      pre: { at: '2026-10-29T01:00:00Z', signature: dInitial.signatures.pre },
      distance: { at: '2026-10-29T01:05:00Z', signature: dInitial.signatures.distance },
      comparison: { at: '2026-10-29T01:10:00Z', signature: dInitial.signatures.comparison },
    };

    const dReviewed = deriveSession(s, 'online');
    expect(dReviewed.reviews.pre).toBe('current');
    expect(dReviewed.reviews.distance).toBe('current');
    expect(dReviewed.reviews.comparison).toBe('current');

    // When intermediate finish reading s.pre[0].finish changes from 12021 to 12025:
    // Ride 1 count increases by 4 (943), but sequentially linked Ride 2 count decreases by 4 (1017).
    // The sum D remains 3970 and pre.wc remains 4967.4625, so comparison signature is unchanged.
    // However, pre review signature includes individual raw readings, so pre review becomes stale!
    s.pre[0].finish = '12025';
    const dPreIntModified = deriveSession(s, 'online');
    expect(dPreIntModified.reviews.pre).toBe('stale');
    // Comparison review remains current because total pre.wc did not change
    expect(dPreIntModified.reviews.comparison).toBe('current');

    // When the terminal finish reading s.pre[3].finish is modified, total D and pre.wc change,
    // which invalidates the comparison review as well!
    s.pre[3].finish = '15060';
    const dTerminalModified = deriveSession(s, 'online');
    expect(dTerminalModified.reviews.pre).toBe('stale');
    expect(dTerminalModified.reviews.comparison).toBe('stale');

    // When the governing constant changes (e.g. under 'average' rule or modifying post reading),
    // distance review also transitions to stale
    s.finalRule = 'average';
    const dAverageRule = deriveSession(s, 'online');
    expect(dAverageRule.reviews.distance).toBe('stale');

    // Finalization is blocked by the 'current' checklist item
    const currentBlocker = dAverageRule.blockers.find((b) => b.id === 'current');
    expect(currentBlocker).toBeDefined();
    expect(currentBlocker?.ok).toBe(false);
  });
});

/* ========================================================================= */
/* 6. PROVISIONAL NOTICE RETENTION IN EXPORTS                                */
/* ========================================================================= */

describe('Phase 8 — Export and Report Provisional Notice Retention', () => {
  const s: SessionData = {
    ...blankSession('BC-TEST', 'Tester', '2026-10-29T00:00:00Z'),
    courseLength: '200',
    ruleSet: 'ws-0.3',
    rolloverMode: 'none',
    finalRule: 'larger',
    pre: [
      createRide('11082', '12021'),
      createRide('', '13042'),
      createRide('', '14052'),
      createRide('', '15052'),
    ],
    post: [
      createRide('321000', '322000'),
      createRide('', '323000'),
      createRide('', '324000'),
      createRide('', '325000'),
    ],
    distStart: '124002',
    distFinish: '320456',
  };

  it('guarantees text export contains PROVISIONAL notice and unratified statement', () => {
    const derived = deriveSession(s, 'online');
    const text = generateReportText(s, derived, '2026-10-29T02:00:00Z');

    expect(text).toContain('PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION');
    expect(text).toContain('Governing road race measurement standard (ws-0.3)');
    expect(text).toContain('PROHIBITED & BLOCKED');
  });

  it('guarantees JSON report export includes provisional metadata and blocker list', () => {
    const derived = deriveSession(s, 'online');
    const jsonStr = exportReportToJSON(s, derived, '2026-10-29T02:00:00Z');
    const parsed = JSON.parse(jsonStr);

    expect(parsed.notice).toBe('PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION');
    expect(parsed.states.officialCertification).toBe('BLOCKED_AND_PROHIBITED');
    expect(parsed.regulatoryPolicy.ratified).toBe(false);
    expect(parsed.regulatoryPolicy.unresolvedPolicies.length).toBe(9);
  });
});
