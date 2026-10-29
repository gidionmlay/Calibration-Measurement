import type { AuditEntry, SessionData } from '../types/session';
import { ENGINE_VERSION } from './calibration';

export const AUDIT_EXPORT_SCHEMA_VERSION = 1;
export const AUDIT_FORMAT_IDENTIFIER = 'bicycle-calibration-audit-trail-export';

export interface AuditExportPayload {
  format: typeof AUDIT_FORMAT_IDENTIFIER;
  schemaVersion: number;
  exportedAt: string;
  sessionReference: string;
  operator: string;
  ruleSetVersion: string;
  calculationEngineVersion: string;
  provisionalNotice: string;
  disclaimer: string;
  totalEvents: number;
  events: NormalizedAuditEvent[];
}

export interface NormalizedAuditEvent {
  sequence: number;
  id: string;
  at: string;
  actor: string;
  kind: string;
  summary: string;
  field: string | null;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
  note: string | null;
}

/**
 * Exports a session's audit history as structured machine-readable JSON.
 * Preserves chronological event order and does not mutate the session.
 */
export function exportAuditTrailToJSON(session: SessionData): string {
  // Deep clone to guarantee non-mutation
  const auditCopy: AuditEntry[] = JSON.parse(JSON.stringify(session.audit || []));

  const events: NormalizedAuditEvent[] = auditCopy.map((entry, idx) => ({
    sequence: idx + 1,
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    kind: entry.kind,
    summary: entry.summary,
    field: entry.field ?? null,
    previousValue: entry.from ?? null,
    newValue: entry.to ?? null,
    reason: entry.reason ?? null,
    note: entry.note ?? null,
  }));

  const payload: AuditExportPayload = {
    format: AUDIT_FORMAT_IDENTIFIER,
    schemaVersion: AUDIT_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessionReference: session.reference,
    operator: session.operator,
    ruleSetVersion: session.ruleSet,
    calculationEngineVersion: ENGINE_VERSION,
    provisionalNotice: 'PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION',
    disclaimer:
      'This audit trail is locally stored in client-side browser storage (IndexedDB). It is not cryptographically signed, immutable, or tamper-proof.',
    totalEvents: events.length,
    events,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Escapes a cell value according to RFC 4180 CSV specifications, with spreadsheet formula injection mitigation.
 *
 * Mitigation details:
 * Spreadsheet applications (e.g. Microsoft Excel, LibreOffice Calc, Google Sheets) interpret
 * cells beginning with '=', '+', '-', or '@' as executable formulas or external commands.
 * When untrusted text starts with any of these characters (even when preceded by whitespace/tabs),
 * this function prepends a single apostrophe ("'"), which instructs spreadsheet engines to treat
 * the content strictly as literal text rather than an active expression.
 *
 * Limitations:
 * Prepending an apostrophe is effective in common desktop spreadsheet suites (Excel, Calc),
 * but presentation of the leading quote may vary across non-standard CSV consumers. Pure numeric
 * literals (including normal negative numbers like -0.0024 or -12) are preserved as numbers without
 * apostrophe prefixes.
 */
export function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '';
  }

  let s = String(val);

  // Check if string represents a pure numeric literal (e.g. "-12", "3.5", "-0.0024")
  // Leading '+' is treated as a formula trigger in Excel/Calc and is not treated as a pure number.
  const isPureNumber = /^[\t\r\n ]*-?\d+(\.\d+)?([eE][-+]?\d+)?[\t\r\n ]*$/.test(s);

  if (!isPureNumber) {
    // Detect formula injection triggers at beginning of cell, including after leading whitespace/control characters
    // Formula triggers: '=', '+', '-', '@'
    const trimmedLeading = s.replace(/^[\t\r\n ]+/, '');
    if (trimmedLeading.length > 0 && ['=', '+', '-', '@'].includes(trimmedLeading[0])) {
      // Prepend single quote to neutralize formula execution in spreadsheets
      s = "'" + s;
    }
  }

  // RFC 4180 escaping: if cell contains quotes, commas, newlines, or single quotes, enclose in double quotes
  if (/[",\n\r']/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Exports a session's audit history as a review-friendly RFC 4180 CSV.
 * Includes metadata comments at the header and clear columns.
 */
export function exportAuditTrailToCSV(session: SessionData): string {
  const auditCopy: AuditEntry[] = JSON.parse(JSON.stringify(session.audit || []));

  const lines: string[] = [
    `# Format: bicycle-calibration-audit-trail-csv`,
    `# Session Reference: ${session.reference}`,
    `# Operator: ${session.operator}`,
    `# Rule Set: ${session.ruleSet}`,
    `# Engine Version: ${ENGINE_VERSION}`,
    `# Status: PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION`,
    `# Exported At: ${new Date().toISOString()}`,
    `# Disclaimer: Locally stored audit trail; not cryptographically signed, immutable, or tamper-proof.`,
    `Sequence,Event ID,Timestamp,Actor,Event Kind,Summary,Affected Field,Previous Value,New Value,Reason,Note`,
  ];

  auditCopy.forEach((entry, idx) => {
    const row = [
      escapeCsvCell(idx + 1),
      escapeCsvCell(entry.id),
      escapeCsvCell(entry.at),
      escapeCsvCell(entry.actor),
      escapeCsvCell(entry.kind),
      escapeCsvCell(entry.summary),
      escapeCsvCell(entry.field ?? null),
      escapeCsvCell(entry.from ?? null),
      escapeCsvCell(entry.to ?? null),
      escapeCsvCell(entry.reason ?? null),
      escapeCsvCell(entry.note ?? null),
    ].join(',');
    lines.push(row);
  });

  return lines.join('\r\n');
}

/**
 * Triggers a browser download for exported content without network connectivity.
 */
export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
