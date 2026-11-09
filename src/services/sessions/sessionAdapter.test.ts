import { describe, it, expect } from 'vitest';
import {
  formatCourseLength,
  mapRidesToBackend,
  mergeBackendSession,
  toCalibrationCalculationRequest,
  toCourseDistanceCalculationRequest,
  toSessionCreatePayload,
  toSessionUpdatePayload,
} from './sessionAdapter';
import { RideInput, SessionData } from '../../types/session';
import { MeasurementSession } from '../api/types';

describe('Session Wire Adapter (Frontend <-> Backend)', () => {
  describe('formatCourseLength', () => {
    it('formats whole number strings to 4 decimal places', () => {
      expect(formatCourseLength('1000')).toBe('1000.0000');
      expect(formatCourseLength('400')).toBe('400.0000');
    });

    it('pads short decimals to 4 decimal places', () => {
      expect(formatCourseLength('500.5')).toBe('500.5000');
      expect(formatCourseLength('250.25')).toBe('250.2500');
    });

    it('truncates excess decimal places exceeding 4 places (scale <= 4)', () => {
      expect(formatCourseLength('1000.123456')).toBe('1000.1234');
    });

    it('falls back to safe default for invalid or negative lengths', () => {
      expect(formatCourseLength('invalid')).toBe('1000.0000');
      expect(formatCourseLength('-50')).toBe('1000.0000');
      expect(formatCourseLength('0')).toBe('1000.0000');
    });
  });

  describe('mapRidesToBackend', () => {
    it('converts discrete string count inputs to integer readings', () => {
      const rides: RideInput[] = [
        { start: '1000', finish: '5000', startOverridden: false, overrideReason: '' },
        { start: '5000', finish: '9002', startOverridden: false, overrideReason: '' },
      ];

      const mapped = mapRidesToBackend(rides, 'pre_calibration');
      expect(mapped).toHaveLength(2);
      expect(mapped[0]).toEqual({
        ride_type: 'pre_calibration',
        ride_number: 1,
        start_count: 1000,
        finish_count: 5000,
        is_linked_override: false,
        override_reason: undefined,
      });
      expect(mapped[1]).toEqual({
        ride_type: 'pre_calibration',
        ride_number: 2,
        start_count: 5000,
        finish_count: 9002,
        is_linked_override: false,
        override_reason: undefined,
      });
    });

    it('preserves start override and reason', () => {
      const rides: RideInput[] = [
        { start: '1000', finish: '5000', startOverridden: false, overrideReason: '' },
        {
          start: '5050',
          finish: '9050',
          startOverridden: true,
          overrideReason: 'Counter bumped during turnaround',
        },
      ];

      const mapped = mapRidesToBackend(rides, 'post_calibration');
      expect(mapped[1].is_linked_override).toBe(true);
      expect(mapped[1].override_reason).toBe('Counter bumped during turnaround');
    });

    it('filters out incomplete or empty ride entries', () => {
      const rides: RideInput[] = [
        { start: '1000', finish: '5000', startOverridden: false, overrideReason: '' },
        { start: '', finish: '', startOverridden: false, overrideReason: '' },
      ];

      const mapped = mapRidesToBackend(rides, 'pre_calibration');
      expect(mapped).toHaveLength(1);
    });
  });

  describe('toSessionCreatePayload', () => {
    it('generates valid backend creation payload with normalized attributes', () => {
      const session: SessionData = {
        reference: 'BC-2026-001',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '1000',
        rolloverMode: 'wrap',
        rolloverMax: '99999',
        consistencyRule: 'notConfigured',
        finalRule: 'larger',
        ruleSet: 'ws-0.3',
        pre: [
          { start: '1000', finish: '5000', startOverridden: false, overrideReason: '' },
          { start: '5000', finish: '9000', startOverridden: false, overrideReason: '' },
        ],
        post: [],
        distStart: '',
        distFinish: '',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'setup',
        save: 'saved',
        sync: 'pending',
        syncQueued: true,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const payload = toSessionCreatePayload(session, 'user-uuid-123');

      expect(payload.name).toBe('BC-2026-001');
      expect(payload.measurer_id).toBe('user-uuid-123');
      expect(payload.course_length_m).toBe('1000.0000');
      expect(payload.rollover?.mode).toBe('wrap');
      expect(payload.rollover?.max_reading).toBe(99999);
      expect(payload.constant_selection_rule).toBe('larger');
      expect(payload.rides).toHaveLength(2);
    });
  });

  describe('toSessionUpdatePayload', () => {
    it('embeds mandatory expected_version for optimistic concurrency', () => {
      const session: SessionData = {
        reference: 'BC-2026-002',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '500',
        rolloverMode: 'none',
        rolloverMax: '',
        consistencyRule: 'notConfigured',
        finalRule: 'average',
        ruleSet: 'ws-0.3',
        pre: [],
        post: [],
        distStart: '',
        distFinish: '',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'setup',
        save: 'saved',
        sync: 'pending',
        syncQueued: true,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const payload = toSessionUpdatePayload(session, 3, 'Pre-calibration ride additions');

      expect(payload.expected_version).toBe(3);
      expect(payload.change_reason).toBe('Pre-calibration ride additions');
      expect(payload.course_length_m).toBe('500.0000');
      expect(payload.constant_selection_rule).toBe('average');
    });
  });

  describe('mergeBackendSession', () => {
    it('updates frontend session with authoritative calculations and server version', () => {
      const local: SessionData = {
        reference: 'BC-2026-003',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '1000',
        rolloverMode: 'none',
        rolloverMax: '',
        consistencyRule: 'notConfigured',
        finalRule: 'larger',
        ruleSet: 'ws-0.3',
        pre: [],
        post: [],
        distStart: '',
        distFinish: '',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'setup',
        save: 'saved',
        sync: 'pending',
        syncQueued: true,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const remote: MeasurementSession = {
        id: 'remote-uuid-999',
        version: 2,
        schema_version: 1,
        status: 'draft',
        name: 'BC-2026-003',
        course_length_m: '1000.0000',
        course_length_unit: 'm',
        rollover_mode: 'none',
        constant_selection_rule: 'larger',
        working_spec_version: 'ws-0.3-provisional',
        policy_approval_status: 'provisional',
        pre_cal_working_constant: '11234.5678',
        post_cal_working_constant: '11236.1234',
        final_working_constant: '11236.1234',
        cal_drift_percent: '0.0138',
        course_distance_km: '10.5000',
        calculation_engine_version: '10.1.0-provisional',
        is_provisional: true,
        rides: [],
        reviews: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const merged = mergeBackendSession(local, remote);

      expect(merged.backendId).toBe('remote-uuid-999');
      expect(merged.backendVersion).toBe(2);
      expect(merged.sync).toBe('synced');
      expect(merged.syncQueued).toBe(false);
      expect(merged.serverCalculations?.preWC).toBe('11234.5678');
      expect(merged.serverCalculations?.postWC).toBe('11236.1234');
      expect(merged.serverCalculations?.finalWC).toBe('11236.1234');
      expect(merged.serverCalculations?.drift).toBe('0.0138');
      expect(merged.serverCalculations?.distanceKm).toBe('10.5000');
      expect(merged.serverCalculations?.isProvisional).toBe(true);
    });

    it('merges revision lineage fields (supersedes_id, superseded_by_id, revision_reason)', () => {
      const local: SessionData = {
        reference: 'BC-2026-003-R1',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '1000',
        rolloverMode: 'none',
        rolloverMax: '',
        consistencyRule: 'notConfigured',
        finalRule: 'larger',
        ruleSet: 'ws-0.3',
        pre: [],
        post: [],
        distStart: '',
        distFinish: '',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'setup',
        save: 'saved',
        sync: 'pending',
        syncQueued: true,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const remote: MeasurementSession = {
        id: 'child-uuid-1',
        version: 1,
        schema_version: 1,
        status: 'draft',
        name: 'BC-2026-003-R1',
        course_length_m: '1000.0000',
        course_length_unit: 'm',
        rollover_mode: 'none',
        constant_selection_rule: 'larger',
        working_spec_version: 'ws-0.3-provisional',
        policy_approval_status: 'provisional',
        is_provisional: true,
        supersedes_id: 'parent-uuid-0',
        superseded_by_id: null,
        revision_reason: 'Updated temperature coefficient',
        rides: [],
        reviews: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const merged = mergeBackendSession(local, remote);
      expect(merged.backendId).toBe('child-uuid-1');
      expect(merged.supersedesRef).toBe('parent-uuid-0');
      expect(merged.revisionReason).toBe('Updated temperature coefficient');
    });
  });

  describe('Calculation Request Builders', () => {
    it('builds CalibrationCalculationRequest for pre rides', () => {
      const session: SessionData = {
        reference: 'BC-2026-004',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '1000',
        rolloverMode: 'none',
        rolloverMax: '',
        consistencyRule: 'notConfigured',
        finalRule: 'larger',
        ruleSet: 'ws-0.3',
        pre: [
          { start: '1000', finish: '5000', startOverridden: false, overrideReason: '' },
          { start: '5000', finish: '9000', startOverridden: false, overrideReason: '' },
        ],
        post: [],
        distStart: '',
        distFinish: '',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'setup',
        save: 'saved',
        sync: 'synced',
        syncQueued: false,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const req = toCalibrationCalculationRequest(session, 'pre');
      expect(req).not.toBeNull();
      expect(req?.rides).toHaveLength(2);
      expect(req?.course_length_m).toBe('1000.0000');
    });

    it('builds CourseDistanceCalculationRequest when readings are populated', () => {
      const session: SessionData = {
        reference: 'BC-2026-005',
        operator: 'Alex Rivera',
        example: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        courseLength: '1000',
        rolloverMode: 'none',
        rolloverMax: '',
        consistencyRule: 'notConfigured',
        finalRule: 'larger',
        ruleSet: 'ws-0.3',
        pre: [],
        post: [],
        distStart: '10000',
        distFinish: '110000',
        reviews: {},
        acknowledgements: {},
        setupSaved: true,
        finalized: null,
        lastStep: 'distance',
        save: 'saved',
        sync: 'synced',
        syncQueued: false,
        conflict: null,
        audit: [],
        logged: { preWC: '', distance: '', postWC: '' },
      };

      const req = toCourseDistanceCalculationRequest(session, '10000.0000');
      expect(req).not.toBeNull();
      expect(req?.start_count).toBe(10000);
      expect(req?.finish_count).toBe(110000);
      expect(req?.working_constant).toBe('10000.0000');
    });
  });
});

