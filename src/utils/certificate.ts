import type { SessionData } from '../types/session';
import type { Derived } from './sessionRules';
import { sha256 } from './crypto';

export interface MeasurerAttribution {
  name: string;
  email?: string;
  organization?: string;
}

export interface CertificateInfo {
  hash: string;
  shortHash: string;
  canonicalPayload: string;
  measurer: MeasurerAttribution;
  finalizedAt?: string;
  isFinalized: boolean;
}

/**
 * Builds a deterministic canonical string binding all authoritative calibration results,
 * audit ledger state, and measurer identity.
 */
export function buildCertificateCanonicalPayload(
  session: SessionData,
  derived: Derived,
  finalizedAt?: string,
  measurer?: MeasurerAttribution
): string {
  const opName = measurer?.name || session.finalized?.by || session.operator;
  const opOrg = measurer?.organization || session.finalized?.organization || 'Independent Accredited Measurer';
  const opEmail = measurer?.email || session.finalized?.email || '';

  return [
    `SESSION_REF:${session.reference}`,
    `MEASURER_NAME:${opName}`,
    `MEASURER_EMAIL:${opEmail}`,
    `ORGANIZATION:${opOrg}`,
    `RULESET:${session.ruleSet}`,
    `FINAL_RULE:${session.finalRule}`,
    `COURSE_NAME:${session.courseName || ''}`,
    `COURSE_LENGTH_M:${derived.length.ok ? derived.length.value : '0'}`,
    `PRE_WC:${derived.pre.wc || '0'}`,
    `POST_WC:${derived.post.wc || '0'}`,
    `FINAL_WC:${derived.finalConstant || '0'}`,
    `DISTANCE_KM:${derived.distance.km || '0'}`,
    `AUDIT_COUNT:${session.audit.length}`,
    `TIMESTAMP:${finalizedAt || session.finalized?.at || 'PREVIEW_DRAFT'}`,
  ].join('\n');
}

/**
 * Computes standard SHA-256 certificate digest from the canonical session payload.
 */
export function computeCertificateHash(
  session: SessionData,
  derived: Derived,
  finalizedAt?: string,
  measurer?: MeasurerAttribution
): string {
  if (session.finalized?.certificateHash && !finalizedAt) {
    return session.finalized.certificateHash;
  }
  const payload = buildCertificateCanonicalPayload(session, derived, finalizedAt, measurer);
  return sha256(payload);
}

/**
 * Resolves full certificate metadata for rendering badges and exports.
 */
export function getCertificateInfo(
  session: SessionData,
  derived: Derived,
  measurer?: MeasurerAttribution
): CertificateInfo {
  const hash = computeCertificateHash(session, derived, undefined, measurer);
  const isFinalized = !!session.finalized;

  const opName = measurer?.name || session.finalized?.by || session.operator;
  const opOrg = measurer?.organization || session.finalized?.organization || 'Independent Accredited Measurer';
  const opEmail = measurer?.email || session.finalized?.email;

  return {
    hash,
    shortHash: `${hash.slice(0, 10)}...${hash.slice(-8)}`,
    canonicalPayload: buildCertificateCanonicalPayload(session, derived, undefined, measurer),
    measurer: {
      name: opName,
      email: opEmail,
      organization: opOrg,
    },
    finalizedAt: session.finalized?.at,
    isFinalized,
  };
}

