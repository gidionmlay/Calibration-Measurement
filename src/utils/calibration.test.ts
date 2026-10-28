import { describe, it, expect } from 'vitest';
import {
  parseReading,
  parseCourseLength,
  lengthMessage,
  readingError,
  countBetween,
  resolveRides,
  computeCalibration,
  computeDistance,
  compareConstants,
  selectFinalConstant,
  fmt,
  fmtSigned,
  CORRECTION_FACTOR,
  type RolloverConfig
} from './calibration';
import type { RideInput } from '../types/session';

describe('Calibration Calculation Engine', () => {
  describe('parseReading', () => {
    it('parses valid whole non-negative counter readings', () => {
      expect(parseReading('11082')).toEqual({ ok: true, value: 11082 });
      expect(parseReading('0')).toEqual({ ok: true, value: 0 });
      expect(parseReading('  320456  ')).toEqual({ ok: true, value: 320456 });
    });

    it('rejects empty or whitespace strings as missing', () => {
      expect(parseReading('')).toEqual({ ok: false, reason: 'missing' });
      expect(parseReading('   ')).toEqual({ ok: false, reason: 'missing' });
    });

    it('rejects non-numeric characters, decimals, and negative numbers as invalid', () => {
      expect(parseReading('12a')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseReading('-100')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseReading('120.5')).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  describe('parseCourseLength', () => {
    it('parses valid positive integer and decimal lengths in metres', () => {
      expect(parseCourseLength('200')).toEqual({ ok: true, value: 200 });
      expect(parseCourseLength('500.25')).toEqual({ ok: true, value: 500.25 });
    });

    it('rejects empty or whitespace inputs', () => {
      expect(parseCourseLength('')).toEqual({ ok: false, reason: 'missing' });
      expect(parseCourseLength('  ')).toEqual({ ok: false, reason: 'missing' });
    });

    it('rejects zero and negative numbers', () => {
      expect(parseCourseLength('0')).toEqual({ ok: false, reason: 'notPositive' });
      expect(parseCourseLength('-200')).toEqual({ ok: false, reason: 'notPositive' });
    });

    it('rejects invalid numeric formats', () => {
      expect(parseCourseLength('200m')).toEqual({ ok: false, reason: 'invalid' });
      expect(parseCourseLength('abc')).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  describe('lengthMessage and readingError messages', () => {
    it('returns null for valid length and proper error texts for invalid', () => {
      expect(lengthMessage({ ok: true, value: 200 })).toBeNull();
      expect(lengthMessage({ ok: false, reason: 'missing' })).toContain('Enter the calibration course length');
      expect(lengthMessage({ ok: false, reason: 'invalid' })).toContain('Use numbers only');
      expect(lengthMessage({ ok: false, reason: 'notPositive' })).toContain('greater than zero');
    });

    it('returns null for valid reading and handles missing visibility toggle', () => {
      expect(readingError({ ok: true, value: 100 }, true, 'Missing reading')).toBeNull();
      expect(readingError({ ok: false, reason: 'invalid' }, false, 'Missing reading')).toContain('whole counter counts');
      expect(readingError({ ok: false, reason: 'missing' }, false, 'Missing reading')).toBeNull();
      expect(readingError({ ok: false, reason: 'missing' }, true, 'Missing reading')).toBe('Missing reading');
    });
  });

  describe('countBetween & Rollover Handling', () => {
    const noWrapConfig: RolloverConfig = { mode: 'none', max: '' };
    const notConfigured: RolloverConfig = { mode: 'notConfigured', max: '' };
    const wrapConfig: RolloverConfig = { mode: 'wrap', max: '999999' };

    it('computes standard difference when finish >= start', () => {
      const res = countBetween(1000, 2050, noWrapConfig);
      expect(res).toEqual({ ok: true, count: 1050, adjustment: 0 });
    });

    it('blocks finish < start when rollover is not configured', () => {
      const res = countBetween(2000, 500, notConfigured);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('Rollover handling is not configured');
    });

    it('blocks finish < start when counter is configured as non-wrapping', () => {
      const res = countBetween(2000, 500, noWrapConfig);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('non-wrapping');
    });

    it('applies (max + 1) adjustment when finish < start and mode is wrap', () => {
      // Counter wraps at 999999: start 999950, finish 50 -> count is 50 + 1000000 - 999950 = 100
      const res = countBetween(999950, 50, wrapConfig);
      expect(res).toEqual({ ok: true, count: 100, adjustment: 1000000 });
    });

    it('rejects rollover if reading exceeds configured counter maximum', () => {
      const res = countBetween(1000005, 50, wrapConfig);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('exceeds the configured counter maximum');
    });
  });

  describe('resolveRides', () => {
    const rollover: RolloverConfig = { mode: 'none', max: '' };

    it('links start of Ride i to finish of Ride i-1 by default', () => {
      const rides: RideInput[] = [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '', finish: '13042', startOverridden: false, overrideReason: '' },
        { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
        { start: '', finish: '15052', startOverridden: false, overrideReason: '' }
      ];

      const resolved = resolveRides(rides, rollover);
      expect(resolved[0].linked).toBe(false);
      expect(resolved[0].startRaw).toBe('11082');

      expect(resolved[1].linked).toBe(true);
      expect(resolved[1].startRaw).toBe('12021');
      expect(resolved[1].linkedValue).toBe('12021');

      expect(resolved[2].linked).toBe(true);
      expect(resolved[2].startRaw).toBe('13042');

      expect(resolved[3].linked).toBe(true);
      expect(resolved[3].startRaw).toBe('14052');
    });

    it('uses explicit start when startOverridden is true', () => {
      const rides: RideInput[] = [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '12030', finish: '13042', startOverridden: true, overrideReason: 'Moved bike across line' }
      ];

      const resolved = resolveRides(rides, rollover);
      expect(resolved[1].linked).toBe(false);
      expect(resolved[1].overridden).toBe(true);
      expect(resolved[1].startRaw).toBe('12030');
      expect(resolved[1].overrideReason).toBe('Moved bike across line');
      expect(resolved[1].linkedValue).toBe('12021');
    });
  });

  describe('Reference Arithmetic Case: 200m Course', () => {
    const rollover: RolloverConfig = { mode: 'none', max: '' };
    const rides: RideInput[] = [
      { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
      { start: '', finish: '13042', startOverridden: false, overrideReason: '' },
      { start: '', finish: '14052', startOverridden: false, overrideReason: '' },
      { start: '', finish: '15052', startOverridden: false, overrideReason: '' }
    ];

    it('calculates expected ride differences: 939, 1021, 1010, 1000', () => {
      const cal = computeCalibration(rides, '200', rollover);
      expect(cal.counts).toEqual([939, 1021, 1010, 1000]);
    });

    it('calculates total D = 3970 and average C_avg = 992.5', () => {
      const cal = computeCalibration(rides, '200', rollover);
      expect(cal.total).toBe(3970);
      expect(cal.average).toBe(992.5);
    });

    it('calculates course length km = 0.2 and CPK = 4962.5', () => {
      const cal = computeCalibration(rides, '200', rollover);
      expect(cal.courseKm).toBe(0.2);
      expect(cal.cpk).toBe(4962.5);
    });

    it('applies 1.001 correction factor for WC = 4967.4625', () => {
      const cal = computeCalibration(rides, '200', rollover);
      expect(CORRECTION_FACTOR).toBe(1.001);
      expect(cal.wc).toBe(4967.4625);
      expect(fmt(cal.wc, 4)).toBe('4967.4625');
    });

    it('computes correct ride spread metrics', () => {
      const cal = computeCalibration(rides, '200', rollover);
      expect(cal.spread).toEqual({
        high: { ride: 2, count: 1021 },
        low: { ride: 1, count: 939 },
        range: 82
      });
    });

    it('calculates course distance with counts = 196454 and distance ≈ 39.548 km', () => {
      const cal = computeCalibration(rides, '200', rollover);
      const dist = computeDistance('124002', '320456', cal.wc, rollover);
      expect(dist.complete).toBe(true);
      expect(dist.count?.ok).toBe(true);
      if (dist.count?.ok) {
        expect(dist.count.count).toBe(196454);
      }
      expect(dist.km).toBeCloseTo(39.5481596489, 6);
      expect(fmt(dist.km, 3)).toBe('39.548');
    });
  });

  describe('Edge cases and incomplete inputs', () => {
    const rollover: RolloverConfig = { mode: 'none', max: '' };

    it('handles incomplete calibration rides gracefully', () => {
      const incompleteRides: RideInput[] = [
        { start: '11082', finish: '12021', startOverridden: false, overrideReason: '' },
        { start: '', finish: '', startOverridden: false, overrideReason: '' },
        { start: '', finish: '', startOverridden: false, overrideReason: '' },
        { start: '', finish: '', startOverridden: false, overrideReason: '' }
      ];

      const cal = computeCalibration(incompleteRides, '200', rollover);
      expect(cal.complete).toBe(false);
      expect(cal.wc).toBeNull();
      expect(cal.total).toBeNull();
      expect(cal.average).toBeNull();
      expect(cal.counts[0]).toBe(939);
      expect(cal.counts[1]).toBeNull();
    });

    it('handles distance computation with null working constant', () => {
      const dist = computeDistance('1000', '2000', null, rollover);
      expect(dist.complete).toBe(false);
      expect(dist.km).toBeNull();
    });
  });

  describe('Comparison and Final Constant Selection', () => {
    it('compares pre and post working constants', () => {
      const cmp = compareConstants(4967.4625, 4970.0);
      expect(cmp.pre).toBe(4967.4625);
      expect(cmp.post).toBe(4970.0);
      expect(cmp.difference).toBeCloseTo(2.5375, 4);
      expect(cmp.percent).toBeCloseTo((2.5375 / 4967.4625) * 100, 4);
    });

    it('returns null comparison when either constant is missing', () => {
      expect(compareConstants(4967.4625, null).difference).toBeNull();
      expect(compareConstants(null, 4970.0).difference).toBeNull();
    });

    it('selects larger constant when rule is "larger"', () => {
      expect(selectFinalConstant('larger', 4967.4625, 4970.0)).toBe(4970.0);
      expect(selectFinalConstant('larger', 5000.0, 4970.0)).toBe(5000.0);
    });

    it('selects average constant when rule is "average"', () => {
      expect(selectFinalConstant('average', 4000.0, 5000.0)).toBe(4500.0);
    });

    it('returns null when rule is "notConfigured"', () => {
      expect(selectFinalConstant('notConfigured', 4967.4625, 4970.0)).toBeNull();
    });
  });

  describe('Formatting Utilities', () => {
    it('formats numbers with fixed decimals and nulls with em-dash', () => {
      expect(fmt(39.548159, 3)).toBe('39.548');
      expect(fmt(null)).toBe('—');
      expect(fmt(undefined)).toBe('—');
    });

    it('formats signed values with plus and minus symbols', () => {
      expect(fmtSigned(2.5375, 4)).toBe('+2.5375');
      expect(fmtSigned(-2.5375, 4)).toBe('−2.5375');
      expect(fmtSigned(null, 4)).toBe('—');
    });
  });
});
