import type { SessionData } from '../types/session';
import type { Derived } from './sessionRules';
import {
  DISTANCE_DISPLAY_DECIMALS,
  ENGINE_VERSION,
  WC_DISPLAY_DECIMALS,
  fmt,
  fmtSigned,
} from './calibration';
import { formatDateTime, optionLabel } from './format';
import {
  consistencyOptions,
  finalRuleOptions,
  rolloverOptions,
  ruleSetOptions,
} from '../data/options';

export const PROVISIONAL_REPORT_NOTICE = 'PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION';
export const UNRATIFIED_POLICY_STATEMENT =
  'Governing road race measurement standard (ws-0.3) and calculation policies (MP-01 through MP-09) are pending formal ratification by an accredited standards authority (e.g. World Athletics / AIMS / USATF). This report is strictly PROVISIONAL and does not confer official certification or course record ratification.';

/**
 * Generates an authoritative plain text / markdown export of the measurement report.
 * Guaranteed to embed the provisional notice prominently at top and bottom.
 */
export function generateReportText(
  session: SessionData,
  derived: Derived,
  snapshotAt: string
): string {
  const dc = derived.distance.count && derived.distance.count.ok ? derived.distance.count : null;
  const notable = session.audit.filter((e) =>
    ['override', 'acknowledgement', 'conflict', 'invalidation', 'finalization'].includes(e.kind)
  );

  const divider = '='.repeat(80);
  const subDivider = '-'.repeat(80);

  const lines: string[] = [
    divider,
    `*** ${PROVISIONAL_REPORT_NOTICE} ***`,
    divider,
    `APPLICATION: Bicycle Calibration Calculation (${ENGINE_VERSION})`,
    `DOCUMENT: Road Course Measurement Report (Provisional Testing Record)`,
    `SESSION REFERENCE: ${session.reference}`,
    `SNAPSHOT TAKEN: ${formatDateTime(snapshotAt)}`,
    '',
    `LEGAL & REGULATORY NOTICE:`,
    UNRATIFIED_POLICY_STATEMENT,
    '',
    `RECORD STATE:`,
    `- Calculated State: Completed`,
    `- Review State: ${derived.state}`,
    `- Finalization State: ${session.finalized ? `Locally finalized by ${session.finalized.by} on ${formatDateTime(session.finalized.at)}` : 'Draft / Unfinalized'}`,
    `- Official Certification: PROHIBITED & BLOCKED (Requires ratified standard & accredited authority)`,
    subDivider,
    '',
    `1. SESSION SETUP & CONFIGURATION`,
    `Operator: ${session.operator}`,
    `Created: ${formatDateTime(session.createdAt)}`,
    `Last Updated: ${formatDateTime(session.updatedAt)}`,
    `Reference Course Length: ${derived.length.ok ? `${fmt(derived.length.value)} m` : '—'}`,
    `Counter Rollover: ${optionLabel(rolloverOptions, session.rolloverMode)}`,
    `Ride-consistency Rule: ${optionLabel(consistencyOptions, session.consistencyRule)}`,
    `Governing Rule Set: ${optionLabel(ruleSetOptions, session.ruleSet)} (Unratified)`,
    '',
    `2. PRE-CALIBRATION RIDES`,
  ];

  derived.pre.rides.forEach((r, idx) => {
    lines.push(
      `  Ride ${idx + 1}: Start=${r.startRaw || '—'}, Finish=${r.finishRaw || '—'}, Count=${r.count && r.count.ok ? r.count.count : '—'}${r.overridden ? ` [OVERRIDE: ${r.overrideReason}]` : ''}`
    );
  });

  lines.push(
    `  Total Count (D): ${fmt(derived.pre.total)}`,
    `  Average Count (D / 4): ${fmt(derived.pre.average)}`,
    `  Course Length (km): ${fmt(derived.pre.courseKm)}`,
    `  Counts Per Km (CPK): ${fmt(derived.pre.cpk)}`,
    `  Pre-calibration Constant (WC = CPK * 1.001): ${fmt(derived.pre.wc)}`,
    '',
    `3. COURSE DISTANCE MEASUREMENT`,
    `  Course Start Reading: ${session.distStart || '—'}`,
    `  Course Finish Reading: ${session.distFinish || '—'}`,
    `  Rollover Adjustment: ${dc ? (dc.adjustment ? `+${dc.adjustment}` : 'None') : '—'}`,
    `  Total Course Count (T): ${dc ? String(dc.count) : '—'}`,
    `  Working Constant Applied: ${fmt(derived.distance.wc)} (${derived.distance.basis.source === 'final' ? 'Final Constant' : 'Pre-cal Constant'}${derived.distance.basis.provisional ? ' [PROVISIONAL]' : ''})`,
    `  Calculated Distance (T / WC): ${derived.distance.km !== null ? `${fmt(derived.distance.km, DISTANCE_DISPLAY_DECIMALS)} km (Full precision: ${fmt(derived.distance.km)})` : '—'}`,
    '',
    `4. POST-CALIBRATION AND COMPARISON`,
  );

  derived.post.rides.forEach((r, idx) => {
    lines.push(
      `  Ride ${idx + 1}: Start=${r.startRaw || '—'}, Finish=${r.finishRaw || '—'}, Count=${r.count && r.count.ok ? r.count.count : '—'}${r.overridden ? ` [OVERRIDE: ${r.overrideReason}]` : ''}`
    );
  });

  lines.push(
    `  Post-calibration Constant: ${fmt(derived.post.wc)}`,
    `  Difference (Post - Pre): ${fmtSigned(derived.comparison.difference, WC_DISPLAY_DECIMALS)}`,
    `  Percentage Difference: ${derived.comparison.percent !== null ? `${fmtSigned(derived.comparison.percent, 4)} %` : '—'}`,
    `  Comparison Status: Descriptive only — tolerance policy unratified (MP-05)`,
    '',
    `5. FINAL CONSTANT SELECTION`,
    `  Selection Rule: ${optionLabel(finalRuleOptions, session.finalRule)}`,
    `  Final Working Constant: ${session.finalRule === 'notConfigured' ? 'Not selected — rule not configured' : fmt(derived.finalConstant)}`,
    '',
    `6. AUDIT HIGHLIGHTS & WARNINGS`,
  );

  if (derived.warnings.length === 0 && notable.length === 0) {
    lines.push('  None recorded.');
  } else {
    derived.warnings.forEach((w) => {
      lines.push(`  - Warning: ${w.title} (${w.ack === 'current' ? 'Reviewed' : 'Awaiting Review'})`);
    });
    notable.forEach((e) => {
      lines.push(
        `  - Audit: ${formatDateTime(e.at)} | ${e.actor} | ${e.summary}${e.reason ? ` (Reason: ${e.reason})` : ''}`
      );
    });
  }

  lines.push(
    '',
    subDivider,
    `*** ${PROVISIONAL_REPORT_NOTICE} ***`,
    `This measurement report was generated for testing and verification only.`,
    `Engine Version: ${ENGINE_VERSION}. Rule set: ${session.ruleSet}.`,
    divider
  );

  return lines.join('\n');
}

/**
 * Generates structured JSON export of the measurement report.
 */
export function exportReportToJSON(
  session: SessionData,
  derived: Derived,
  snapshotAt: string
): string {
  const dc = derived.distance.count && derived.distance.count.ok ? derived.distance.count : null;

  const payload = {
    format: 'bicycle-calibration-report-export',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    snapshotAt,
    notice: PROVISIONAL_REPORT_NOTICE,
    regulatoryPolicy: {
      ratified: false,
      governingStandard: session.ruleSet,
      unresolvedPolicies: [
        'MP-01: Standard ratification pending',
        'MP-02: Calibration course length bounds unratified',
        'MP-03: Working constant selection rule unconfirmed',
        'MP-04: Ride consistency tolerance unconfirmed',
        'MP-05: Pre/post discrepancy tolerance unconfirmed',
        'MP-06: Hardware rollover profile unconfirmed',
        'MP-07: Rounding and precision convention unconfirmed',
        'MP-08: Measurer accreditation authentication unconfirmed',
        'MP-09: Revision branching protocol unconfirmed',
      ],
      statement: UNRATIFIED_POLICY_STATEMENT,
    },
    states: {
      calculated: true,
      reviewState: derived.state,
      localFinalized: !!session.finalized,
      officialCertification: 'BLOCKED_AND_PROHIBITED',
    },
    session: {
      reference: session.reference,
      operator: session.operator,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      courseLengthM: derived.length.ok ? derived.length.value : null,
      ruleSet: session.ruleSet,
      finalRule: session.finalRule,
      rolloverMode: session.rolloverMode,
      consistencyRule: session.consistencyRule,
    },
    results: {
      preWC: derived.pre.wc,
      postWC: derived.post.wc,
      finalConstant: derived.finalConstant,
      distanceCount: dc ? dc.count : null,
      distanceKm: derived.distance.km,
      distanceDisplay: derived.distance.km !== null ? fmt(derived.distance.km, DISTANCE_DISPLAY_DECIMALS) : null,
      constantBasis: derived.distance.basis,
      comparisonPercent: derived.comparison.percent,
    },
  };

  return JSON.stringify(payload, null, 2);
}
