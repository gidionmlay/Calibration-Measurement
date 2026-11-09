/**
 * Session Wire Adapter.
 *
 * Bi-directional mapping between frontend SessionData (IndexedDB/UI state)
 * and authoritative backend API contracts (MeasurementSession, SessionCreatePayload, SessionUpdatePayload).
 */

import {
  MeasurementSession,
  SessionCreatePayload,
  SessionRideInput,
  SessionUpdatePayload,
} from '../api/types';
import { RideInput, SessionData } from '../../types/session';

/**
 * Format course length string to exact Decimal with up to 4 decimal places.
 */
export function formatCourseLength(lenStr: string): string {
  const parsed = parseFloat(lenStr);
  if (isNaN(parsed) || parsed <= 0) {
    return '1000.0000';
  }
  // Ensure max 4 decimal places
  const parts = lenStr.trim().split('.');
  if (parts.length === 1) {
    return `${parts[0]}.0000`;
  }
  const decimals = parts[1].slice(0, 4).padEnd(4, '0');
  return `${parts[0]}.${decimals}`;
}

/**
 * Convert frontend RideInput array into backend SessionRideInput array.
 */
export function mapRidesToBackend(
  rides: RideInput[],
  rideType: 'pre_calibration' | 'post_calibration',
): SessionRideInput[] {
  const result: SessionRideInput[] = [];

  rides.forEach((r, idx) => {
    const startCount = parseInt(r.start, 10);
    const finishCount = parseInt(r.finish, 10);

    // Only map rides that have valid numbers
    if (!isNaN(startCount) && !isNaN(finishCount)) {
      result.push({
        ride_type: rideType,
        ride_number: idx + 1,
        start_count: startCount,
        finish_count: finishCount,
        is_linked_override: r.startOverridden,
        override_reason: r.startOverridden ? (r.overrideReason || 'Operator override') : undefined,
      });
    }
  });

  return result;
}

/**
 * Build backend SessionCreatePayload from frontend SessionData.
 */
export function toSessionCreatePayload(
  session: SessionData,
  actorId?: string,
): SessionCreatePayload {
  const preRides = mapRidesToBackend(session.pre || [], 'pre_calibration');
  const postRides = mapRidesToBackend(session.post || [], 'post_calibration');

  const rolloverMode = session.rolloverMode === 'wrap' ? 'wrap' : session.rolloverMode === 'none' ? 'none' : 'notConfigured';
  const finalRule = session.finalRule === 'larger' ? 'larger' : session.finalRule === 'average' ? 'average' : 'notConfigured';

  return {
    name: session.reference,
    description: `Calibration session for ${session.operator}`,
    measurer_id: actorId || session.operator,
    course_name: session.courseName?.trim() || `Course ${session.courseLength}m`,
    course_length_m: formatCourseLength(session.courseLength),
    course_length_unit: 'm',
    rollover: {
      mode: rolloverMode,
      max_reading: rolloverMode === 'wrap' ? parseInt(session.rolloverMax, 10) || 99999 : undefined,
    },
    constant_selection_rule: finalRule,
    working_spec_version: session.ruleSet === 'ws-0.3' ? 'ws-0.3-provisional' : 'ws-0.3-provisional',
    rides: [...preRides, ...postRides],
  };
}

/**
 * Build backend SessionUpdatePayload from frontend SessionData with optimistic locking.
 */
export function toSessionUpdatePayload(
  session: SessionData,
  expectedVersion: number,
  changeReason?: string,
): SessionUpdatePayload {
  const preRides = mapRidesToBackend(session.pre || [], 'pre_calibration');
  const postRides = mapRidesToBackend(session.post || [], 'post_calibration');

  const rolloverMode = session.rolloverMode === 'wrap' ? 'wrap' : session.rolloverMode === 'none' ? 'none' : 'notConfigured';
  const finalRule = session.finalRule === 'larger' ? 'larger' : session.finalRule === 'average' ? 'average' : 'notConfigured';

  return {
    expected_version: expectedVersion,
    name: session.reference,
    course_name: session.courseName?.trim() || undefined,
    course_length_m: formatCourseLength(session.courseLength),
    rollover: {
      mode: rolloverMode,
      max_reading: rolloverMode === 'wrap' ? parseInt(session.rolloverMax, 10) || 99999 : undefined,
    },
    constant_selection_rule: finalRule,
    rides: [...preRides, ...postRides],
    change_reason: changeReason || 'Frontend session synchronization',
  };
}

/**
 * Update frontend SessionData with authoritative backend results.
 */
export function mergeBackendSession(
  local: SessionData,
  remote: MeasurementSession,
): SessionData {
  return {
    ...local,
    courseName: local.courseName || remote.course_name || undefined,
    backendId: remote.id,
    backendVersion: remote.version,
    serverCalculations: {
      preWC: remote.pre_cal_working_constant ? String(remote.pre_cal_working_constant) : undefined,
      postWC: remote.post_cal_working_constant ? String(remote.post_cal_working_constant) : undefined,
      finalWC: remote.final_working_constant ? String(remote.final_working_constant) : undefined,
      drift: remote.cal_drift_percent ? String(remote.cal_drift_percent) : undefined,
      distanceKm: remote.course_distance_km ? String(remote.course_distance_km) : undefined,
      isProvisional: remote.is_provisional,
    },
    sync: 'synced',
    syncQueued: false,
    supersedesRef: remote.supersedes_id ?? local.supersedesRef,
    supersededByRef: remote.superseded_by_id ?? local.supersededByRef,
    revisionReason: remote.revision_reason ?? local.revisionReason,
  };
}

/**
 * Build authoritative CalibrationCalculationRequest for a specific ride set (pre or post).
 */
export function toCalibrationCalculationRequest(
  session: SessionData,
  set: 'pre' | 'post',
): import('../api/types').CalibrationCalculationRequest | null {
  const rides = set === 'pre' ? session.pre : session.post;
  if (!rides || rides.length === 0) return null;

  const pureRides: import('../api/types').PureRideInput[] = [];
  for (const r of rides) {
    const start = parseInt(r.start, 10);
    const finish = parseInt(r.finish, 10);
    if (isNaN(start) || isNaN(finish)) {
      return null;
    }
    pureRides.push({
      start,
      finish,
      start_overridden: r.startOverridden,
      override_reason: r.overrideReason,
    });
  }

  const rolloverMode =
    session.rolloverMode === 'wrap' ? 'wrap' : session.rolloverMode === 'none' ? 'none' : 'notConfigured';

  return {
    rides: pureRides,
    course_length_m: formatCourseLength(session.courseLength),
    rollover: {
      mode: rolloverMode,
      max_reading: rolloverMode === 'wrap' ? parseInt(session.rolloverMax, 10) || 99999 : undefined,
    },
  };
}

/**
 * Build authoritative CourseDistanceCalculationRequest from frontend session and working constant.
 */
export function toCourseDistanceCalculationRequest(
  session: SessionData,
  workingConstant: string | number,
): import('../api/types').CourseDistanceCalculationRequest | null {
  const start = parseInt(session.distStart, 10);
  const finish = parseInt(session.distFinish, 10);

  if (isNaN(start) || isNaN(finish) || !workingConstant) {
    return null;
  }

  const rolloverMode =
    session.rolloverMode === 'wrap' ? 'wrap' : session.rolloverMode === 'none' ? 'none' : 'notConfigured';

  return {
    start_count: start,
    finish_count: finish,
    working_constant: workingConstant,
    rollover: {
      mode: rolloverMode,
      max_reading: rolloverMode === 'wrap' ? parseInt(session.rolloverMax, 10) || 99999 : undefined,
    },
  };
}

