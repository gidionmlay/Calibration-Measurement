import { describe, it, expect } from 'vitest';
import {
  exportAuditTrailToJSON,
  exportAuditTrailToCSV,
  AUDIT_FORMAT_IDENTIFIER,
  AUDIT_EXPORT_SCHEMA_VERSION,
  type AuditExportPayload,
} from './auditExport';
import { buildSeedSessions } from './sessionFactory';
import type { SessionData } from '../types/session';

describe('Workstream B: Audit-Trail Export Suite', () => {
  const baseSession: SessionData = JSON.parse(JSON.stringify(buildSeedSessions('online', 'examples')[0]));

  it('exports structured JSON preserving exact event order, timestamps, and fields', () => {
    const jsonStr = exportAuditTrailToJSON(baseSession);
    expect(jsonStr).toBeTypeOf('string');

    const payload = JSON.parse(jsonStr) as AuditExportPayload;
    expect(payload.format).toBe(AUDIT_FORMAT_IDENTIFIER);
    expect(payload.schemaVersion).toBe(AUDIT_EXPORT_SCHEMA_VERSION);
    expect(payload.sessionReference).toBe(baseSession.reference);
    expect(payload.operator).toBe(baseSession.operator);
    expect(payload.ruleSetVersion).toBe(baseSession.ruleSet);
    expect(payload.provisionalNotice).toBe('PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION');
    expect(payload.disclaimer).toContain('locally stored in client-side browser storage');
    expect(payload.disclaimer).toContain('not cryptographically signed, immutable, or tamper-proof');
    expect(payload.totalEvents).toBe(baseSession.audit.length);

    // Verify ordering and field mapping
    payload.events.forEach((ev, idx) => {
      const original = baseSession.audit[idx];
      expect(ev.sequence).toBe(idx + 1);
      expect(ev.id).toBe(original.id);
      expect(ev.at).toBe(original.at);
      expect(ev.actor).toBe(original.actor);
      expect(ev.kind).toBe(original.kind);
      expect(ev.summary).toBe(original.summary);
      expect(ev.previousValue).toBe(original.from ?? null);
      expect(ev.newValue).toBe(original.to ?? null);
    });
  });

  it('exports RFC 4180 CSV with headers, metadata comments, and proper escaping', () => {
    // Add special characters, commas, and quotes in reasons
    const sessionWithSpecialChars: SessionData = JSON.parse(JSON.stringify(baseSession));
    sessionWithSpecialChars.audit.push({
      id: 'audit-special-1',
      at: '2026-10-28T16:00:00.000Z',
      actor: 'O\'Connor, "Chief Measurer"',
      kind: 'override',
      summary: 'Ride 2 start adjusted, counter slipped',
      reason: 'Slipped counter; "re-zeroed" on 400m mark, line 2',
      note: 'Note with\nnewline and "quotes", plus, commas',
    });

    const csv = exportAuditTrailToCSV(sessionWithSpecialChars);
    expect(csv).toContain('# Format: bicycle-calibration-audit-trail-csv');
    expect(csv).toContain(`# Session Reference: ${sessionWithSpecialChars.reference}`);
    expect(csv).toContain('# Status: PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION');
    expect(csv).toContain('Sequence,Event ID,Timestamp,Actor,Event Kind,Summary,Affected Field,Previous Value,New Value,Reason,Note');

    // Verify escaping of quotes and commas
    expect(csv).toContain('""re-zeroed""');
    expect(csv).toContain('"O\'Connor, ""Chief Measurer"""');
    expect(csv).toContain('"Ride 2 start adjusted, counter slipped"');
  });

  it('handles empty audit trails cleanly without crashing or inventing events', () => {
    const emptySession: SessionData = JSON.parse(JSON.stringify(baseSession));
    emptySession.audit = [];

    const jsonStr = exportAuditTrailToJSON(emptySession);
    const jsonPayload = JSON.parse(jsonStr) as AuditExportPayload;
    expect(jsonPayload.totalEvents).toBe(0);
    expect(jsonPayload.events).toEqual([]);

    const csv = exportAuditTrailToCSV(emptySession);
    expect(csv).toContain('# Session Reference:');
    // Only metadata and header lines present
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(9); // 8 metadata comments + 1 header line
  });

  it('guarantees export operations are strictly non-mutating', () => {
    const originalJson = JSON.stringify(baseSession);
    exportAuditTrailToJSON(baseSession);
    exportAuditTrailToCSV(baseSession);
    expect(JSON.stringify(baseSession)).toBe(originalJson);
  });

  describe('Remediation C: CSV Formula Injection Mitigation', () => {
    it('sanitizes cells starting with formula triggers =, +, -, @ by prefixing with single quote', () => {
      const maliciousSession: SessionData = JSON.parse(JSON.stringify(baseSession));
      maliciousSession.audit.push({
        id: 'audit-inj-1',
        at: '2026-10-28T17:00:00.000Z',
        actor: '=cmd|\' /C calc\'!A0',
        kind: 'edit',
        summary: '+SUM(1,2)',
        reason: '-2+3+cmd',
        note: '@IMPORTXML("https://example.com","//")',
      });

      const csv = exportAuditTrailToCSV(maliciousSession);
      // Verify all formula triggers are sanitized with leading single quote inside quotes
      expect(csv).toContain('"\'=cmd|\' /C calc\'!A0"');
      expect(csv).toContain('"\'=cmd|\' /C calc\'!A0",edit,"\'+SUM(1,2)",,,,"\'-2+3+cmd"');
      expect(csv).toContain('"\'@IMPORTXML(""https://example.com"",""//"")"');

      // Verify underlying session was not mutated
      expect(maliciousSession.audit[maliciousSession.audit.length - 1].actor).toBe('=cmd|\' /C calc\'!A0');
      expect(maliciousSession.audit[maliciousSession.audit.length - 1].summary).toBe('+SUM(1,2)');
    });

    it('sanitizes formula triggers preceded by leading spaces, tabs, or carriage returns', () => {
      const whitespaceSession: SessionData = JSON.parse(JSON.stringify(baseSession));
      whitespaceSession.audit.push({
        id: 'audit-inj-2',
        at: '2026-10-28T17:05:00.000Z',
        actor: '   =1+1',
        kind: 'override',
        summary: '\t@SUM(B1:B10)',
        reason: ' \r -DDE("cmd")',
        note: '\n+12345',
      });

      const csv = exportAuditTrailToCSV(whitespaceSession);
      expect(csv).toContain('"\'   =1+1"');
      expect(csv).toContain('"\'\t@SUM(B1:B10)"');
      expect(csv).toContain('"\' \r -DDE(""cmd"")"');
      expect(csv).toContain(`"'\n+12345"`);
    });

    it('preserves normal negative numbers, ordinary text, and Unicode without single quote prefix', () => {
      const normalSession: SessionData = JSON.parse(JSON.stringify(baseSession));
      normalSession.audit.push({
        id: 'audit-norm-1',
        at: '2026-10-28T17:10:00.000Z',
        actor: 'J. Okafor',
        kind: 'edit',
        summary: 'Normal measurement update',
        field: 'diff',
        from: '-0.0024',
        to: '-12',
        reason: 'Unicode: 🚴 Calibração do percurso rodoviário',
        note: 'Normal text with "quotes", commas, and words.',
      });

      const csv = exportAuditTrailToCSV(normalSession);
      // Pure numbers (including negative numbers) must NOT be prefixed with apostrophe
      expect(csv).toContain(',-0.0024,');
      expect(csv).toContain(',-12,');
      // Ordinary text and Unicode preserved
      expect(csv).toContain('Normal measurement update');
      expect(csv).toContain('Unicode: 🚴 Calibração do percurso rodoviário');
      expect(csv).toContain('"Normal text with ""quotes"", commas, and words."');
    });

    it('handles empty cells and missing optional fields cleanly', () => {
      const minimalSession: SessionData = JSON.parse(JSON.stringify(baseSession));
      minimalSession.audit = [
        {
          id: 'audit-min-1',
          at: '2026-10-28T17:15:00.000Z',
          actor: 'Measurer',
          kind: 'created',
          summary: 'Session created',
          // field, from, to, reason, note omitted
        },
      ];

      const csv = exportAuditTrailToCSV(minimalSession);
      const row = csv.split('\r\n')[9];
      expect(row).toBe('1,audit-min-1,2026-10-28T17:15:00.000Z,Measurer,created,Session created,,,,,');
    });
  });
});
