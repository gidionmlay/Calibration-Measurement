import type { FinalConstantRule, RideInput, RolloverMode } from '../types/session';

export const CORRECTION_FACTOR = 1.001;
export const ENGINE_VERSION = 'Calculation engine 0.9.2 (prototype)';
export const DISTANCE_DISPLAY_DECIMALS = 3;
export const WC_DISPLAY_DECIMALS = 4;

export type ReadingCheck = {ok: true;value: number;} | {ok: false;reason: 'missing' | 'invalid';};
export type LengthCheck = {ok: true;value: number;} | {ok: false;reason: 'missing' | 'invalid' | 'notPositive';};
export type CountResult = {ok: true;count: number;adjustment: number;} | {ok: false;message: string;};

export interface RolloverConfig {
  mode: RolloverMode;
  max: string;
}

export interface ResolvedRide {
  index: number;
  linked: boolean;
  linkedValue: string;
  startRaw: string;
  finishRaw: string;
  overridden: boolean;
  overrideReason: string;
  start: ReadingCheck;
  finish: ReadingCheck;
  count: CountResult | null;
}

export interface CalibrationResult {
  rides: ResolvedRide[];
  counts: (number | null)[];
  complete: boolean;
  total: number | null;
  average: number | null;
  courseLengthM: number | null;
  courseKm: number | null;
  cpk: number | null;
  wc: number | null;
  spread: {high: {ride: number;count: number;};low: {ride: number;count: number;};range: number;} | null;
}

export interface ConstantBasis {
  wc: number | null;
  source: 'none' | 'pre' | 'final';
  provisional: boolean;
  reasons: ('preIncomplete' | 'postIncomplete' | 'ruleNotConfigured' | 'ruleNotApproved')[];
}

export interface DistanceResult {
  start: ReadingCheck;
  finish: ReadingCheck;
  count: CountResult | null;
  wc: number | null;
  km: number | null;
  complete: boolean;
  basis: ConstantBasis;
}

export interface Comparison {
  pre: number | null;
  post: number | null;
  difference: number | null;
  percent: number | null;
}

export function parseReading(raw: string): ReadingCheck {
  const t = raw.trim();
  if (t === '') return { ok: false, reason: 'missing' };
  if (!/^\d+$/.test(t)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: Number(t) };
}

export function parseCourseLength(raw: string): LengthCheck {
  const t = raw.trim();
  if (t === '') return { ok: false, reason: 'missing' };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, reason: 'invalid' };
  const value = Number(t);
  if (value <= 0) return { ok: false, reason: 'notPositive' };
  return { ok: true, value };
}

export function lengthMessage(check: LengthCheck): string | null {
  if (check.ok) return null;
  if (check.reason === 'missing') return 'Enter the calibration course length in metres.';
  if (check.reason === 'invalid') return 'Use numbers only, for example 200 or 200.5.';
  return 'Course length must be greater than zero.';
}

export function readingError(check: ReadingCheck, showMissing: boolean, missingText: string): string | null {
  if (check.ok) return null;
  if (check.reason === 'invalid') return 'Use whole counter counts only (digits 0–9).';
  return showMissing ? missingText : null;
}

export function countBetween(start: number, finish: number, rollover: RolloverConfig): CountResult {
  if (finish >= start) return { ok: true, count: finish - start, adjustment: 0 };
  if (rollover.mode === 'notConfigured') {
    return {
      ok: false,
      message:
      'Finish is lower than start. Rollover handling is not configured, so no rollover is assumed. Verify both readings or configure rollover in Setup.'
    };
  }
  if (rollover.mode === 'none') {
    return { ok: false, message: 'Finish is lower than start, and this counter is set as non-wrapping. Verify both readings.' };
  }
  const max = parseReading(rollover.max);
  if (!max.ok) {
    return { ok: false, message: 'Finish is lower than start, but the counter maximum is not set. Add it in Setup to resolve the rollover.' };
  }
  if (start > max.value || finish > max.value) {
    return { ok: false, message: 'A reading exceeds the configured counter maximum. Verify the readings.' };
  }
  const adjustment = max.value + 1;
  return { ok: true, count: finish + adjustment - start, adjustment };
}

export function resolveRides(rides: RideInput[], rollover: RolloverConfig): ResolvedRide[] {
  return rides.map((ride, index) => {
    const linked = index > 0 && !ride.startOverridden;
    const linkedValue = index > 0 ? rides[index - 1].finish : '';
    const startRaw = linked ? linkedValue : ride.start;
    const start = parseReading(startRaw);
    const finish = parseReading(ride.finish);
    const count = start.ok && finish.ok ? countBetween(start.value, finish.value, rollover) : null;
    return {
      index,
      linked,
      linkedValue,
      startRaw,
      finishRaw: ride.finish,
      overridden: index > 0 && ride.startOverridden,
      overrideReason: ride.overrideReason,
      start,
      finish,
      count
    };
  });
}

export function computeCalibration(rides: RideInput[], courseLengthRaw: string, rollover: RolloverConfig): CalibrationResult {
  const resolved = resolveRides(rides, rollover);
  const counts = resolved.map((r) => r.count && r.count.ok ? r.count.count : null);
  const length = parseCourseLength(courseLengthRaw);
  const courseLengthM = length.ok ? length.value : null;
  const allCounts = counts.every((c) => c !== null);
  const nums = counts.filter((c): c is number => c !== null);
  const total = allCounts ? nums.reduce((a, b) => a + b, 0) : null;
  const average = total !== null ? total / 4 : null;
  const courseKm = courseLengthM !== null ? courseLengthM / 1000 : null;
  // Equivalent to Average ÷ km, computed as Average × 1000 ÷ metres to avoid binary rounding noise.
  const cpk = average !== null && courseLengthM !== null ? average * 1000 / courseLengthM : null;
  const wc = cpk !== null ? cpk * CORRECTION_FACTOR : null;

  let spread: CalibrationResult['spread'] = null;
  if (allCounts) {
    let hi = 0;
    let lo = 0;
    nums.forEach((c, i) => {
      if (c > nums[hi]) hi = i;
      if (c < nums[lo]) lo = i;
    });
    spread = {
      high: { ride: hi + 1, count: nums[hi] },
      low: { ride: lo + 1, count: nums[lo] },
      range: nums[hi] - nums[lo]
    };
  }

  return { rides: resolved, counts, complete: wc !== null, total, average, courseLengthM, courseKm, cpk, wc, spread };
}

export function resolveApplicableConstant(
  rule: FinalConstantRule,
  pre: number | null,
  post: number | null,
  isApproved = false
): ConstantBasis {
  if (pre === null) {
    return { wc: null, source: 'none', provisional: true, reasons: ['preIncomplete'] };
  }
  if (post === null) {
    return { wc: pre, source: 'pre', provisional: true, reasons: ['postIncomplete'] };
  }
  if (rule === 'notConfigured') {
    return { wc: pre, source: 'pre', provisional: true, reasons: ['ruleNotConfigured'] };
  }

  const finalVal = selectFinalConstant(rule, pre, post);
  if (finalVal === null) {
    return { wc: pre, source: 'pre', provisional: true, reasons: ['ruleNotConfigured'] };
  }

  return {
    wc: finalVal,
    source: 'final',
    provisional: !isApproved,
    reasons: !isApproved ? ['ruleNotApproved'] : []
  };
}

export function computeDistance(
  startRaw: string,
  finishRaw: string,
  wcOrBasis: number | ConstantBasis | null,
  rollover: RolloverConfig
): DistanceResult {
  const start = parseReading(startRaw);
  const finish = parseReading(finishRaw);
  const count = start.ok && finish.ok ? countBetween(start.value, finish.value, rollover) : null;
  const basis: ConstantBasis = typeof wcOrBasis === 'object' && wcOrBasis !== null
    ? wcOrBasis
    : {
        wc: wcOrBasis,
        source: wcOrBasis === null ? 'none' : 'pre',
        provisional: true,
        reasons: wcOrBasis === null ? ['preIncomplete'] : []
      };

  const wc = basis.wc;
  const km = count && count.ok && wc ? count.count / wc : null;
  return { start, finish, count, wc, km, complete: km !== null, basis };
}

export function compareConstants(pre: number | null, post: number | null): Comparison {
  if (pre === null || post === null) return { pre, post, difference: null, percent: null };
  const difference = post - pre;
  return { pre, post, difference, percent: difference / pre * 100 };
}

export function selectFinalConstant(rule: FinalConstantRule, pre: number | null, post: number | null): number | null {
  if (pre === null || post === null) return null;
  if (rule === 'larger') return Math.max(pre, post);
  if (rule === 'average') return (pre + post) / 2;
  return null;
}

/** Display formatting only — never feeds back into stored values. */
export function fmt(n: number | null | undefined, decimals?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (decimals === undefined) return String(Number(n.toPrecision(15)));
  return n.toFixed(decimals);
}

export function fmtSigned(n: number | null, decimals: number): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(decimals)}`;
}