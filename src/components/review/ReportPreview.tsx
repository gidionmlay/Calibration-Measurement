import React from 'react';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import type { SessionData } from '../../types/session';
import type { Derived } from '../../utils/sessionRules';
import { DISTANCE_DISPLAY_DECIMALS, ENGINE_VERSION, WC_DISPLAY_DECIMALS, fmt, fmtSigned } from '../../utils/calibration';
import { formatDateTime, optionLabel } from '../../utils/format';
import { consistencyOptions, finalRuleOptions, rolloverOptions, ruleSetOptions } from '../../data/options';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RidesReadout } from './RidesReadout';
import {
  PROVISIONAL_REPORT_NOTICE,
  UNRATIFIED_POLICY_STATEMENT,
  exportReportToJSON,
  generateReportText,
} from '../../utils/reportExport';
import { triggerFileDownload } from '../../utils/auditExport';

export interface ReportSnapshot {
  session: SessionData;
  derived: Derived;
  at: string;
}

function Section({ title, children }: {title: string;children: React.ReactNode;}) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">{title}</h3>
      {children}
    </section>);

}

function Pairs({ rows }: {rows: [string, string][];}) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[220px_minmax(0,1fr)]">
      {rows.map(([k, v]) =>
        <React.Fragment key={k}>
          <dt className="text-sub">{k}</dt>
          <dd className="font-mono text-ink">{v}</dd>
        </React.Fragment>
      )}
    </dl>);

}

export function ReportPreview({ snapshot, onClose }: {snapshot: ReportSnapshot | null;onClose: () => void;}) {
  const downloadText = () => {
    if (!snapshot) return;
    const content = generateReportText(snapshot.session, snapshot.derived, snapshot.at);
    triggerFileDownload(`${snapshot.session.reference}_provisional_report.txt`, content, 'text/plain');
  };

  const downloadJson = () => {
    if (!snapshot) return;
    const content = exportReportToJSON(snapshot.session, snapshot.derived, snapshot.at);
    triggerFileDownload(`${snapshot.session.reference}_provisional_report.json`, content, 'application/json');
  };

  return (
    <Modal
      open={!!snapshot}
      onClose={onClose}
      size="xl"
      title="Report preview"
      description="Generated from a single snapshot of the session."
      footer={
        <>
          <Button icon={<DownloadIcon />} onClick={downloadText} data-testid="download-report-txt-btn">
            Export text
          </Button>
          <Button icon={<DownloadIcon />} onClick={downloadJson} data-testid="download-report-json-btn">
            Export JSON
          </Button>
          <Button icon={<PrinterIcon />} onClick={() => window.print()} data-testid="print-report-btn">
            Print
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close preview
          </Button>
        </>
      }>
      
      {snapshot && <ReportBody {...snapshot} />}
    </Modal>);

}

function ReportBody({ session: s, derived: d, at }: ReportSnapshot) {
  const dc = d.distance.count && d.distance.count.ok ? d.distance.count : null;
  const notable = s.audit.filter((e) => ['override', 'acknowledgement', 'conflict', 'invalidation', 'finalization'].includes(e.kind));

  return (
    <article className="mx-auto max-w-[760px] space-y-5 border border-line bg-panel p-6 text-ink md:p-8">
      {/* Prominent Provisional Notice Header */}
      <div
        className="rounded border-2 border-dashed border-amber-600 bg-amber-50/90 p-4 text-amber-950 print:border-black print:bg-gray-100"
        data-testid="provisional-report-notice"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/80 pb-2 print:border-black">
          <span className="rounded bg-amber-700 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white print:bg-black">
            {PROVISIONAL_REPORT_NOTICE}
          </span>
          <span className="font-mono text-xs text-amber-800 print:text-black">
            Standard: {optionLabel(ruleSetOptions, s.ruleSet)} (Unratified)
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed print:text-black">
          {UNRATIFIED_POLICY_STATEMENT}
        </p>
        <div className="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-amber-200/80 pt-2 text-[11px] sm:grid-cols-2 print:border-black print:text-black">
          <div>
            <span className="font-semibold">Calculated state:</span> Complete ({ENGINE_VERSION})
          </div>
          <div>
            <span className="font-semibold">Review state:</span> {d.state}
          </div>
          <div>
            <span className="font-semibold">Finalized state:</span>{' '}
            {s.finalized ? `Locally finalized (${formatDateTime(s.finalized.at)})` : 'Draft / Unfinalized'}
          </div>
          <div>
            <span className="font-semibold">Official certification:</span>{' '}
            <span className="font-bold text-red-700 print:text-black">PROHIBITED & BLOCKED</span>
          </div>
        </div>
      </div>

      <header>
        <p className="text-xs text-sub">Road course measurement report</p>
        <h2 className="mt-1 font-mono text-xl font-semibold">{s.reference}</h2>
        <div className={`mt-3 p-3 text-sm ${s.finalized ? 'border border-ink' : 'border-2 border-dashed border-ink'}`}>
          {s.finalized ?
          <p>
              <span className="font-semibold">Finalized record.</span> Finalized {formatDateTime(s.finalized.at)} by {s.finalized.by}.
            </p> :

          <p>
              <span className="font-semibold">Preview only — not finalized.</span> This document is not a final measurement report. Status: {d.state}.
            </p>
          }
          <p className="mt-1 text-xs text-sub">Snapshot taken {formatDateTime(at)}</p>
        </div>
      </header>

      {!s.finalized && d.blockers.length > 0 &&
      <Section title="Outstanding issues">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {d.blockers.map((b) =>
          <li key={b.id}>
                <span className="font-medium">{b.label}:</span> {b.detail}
              </li>
          )}
          </ul>
        </Section>
      }

      <Section title="Session">
        <Pairs
          rows={[
          ['Operator', s.operator],
          ['Created', formatDateTime(s.createdAt)],
          ['Last updated', formatDateTime(s.updatedAt)],
          ['Calibration course length', d.length.ok ? `${fmt(d.length.value)} m` : '—'],
          ['Counter rollover', optionLabel(rolloverOptions, s.rolloverMode)],
          ['Ride-consistency rule', optionLabel(consistencyOptions, s.consistencyRule)]]
          } />
        
      </Section>

      <Section title="Pre-calibration">
        <RidesReadout result={d.pre} caption="Pre-calibration rides" />
        <div className="mt-3">
          <Pairs
            rows={[
            ['Total (D)', fmt(d.pre.total)],
            ['Average = D ÷ 4', fmt(d.pre.average)],
            ['Course length (km)', fmt(d.pre.courseKm)],
            ['CPK = Average ÷ km', fmt(d.pre.cpk)],
            ['WC = CPK × 1.001', fmt(d.pre.wc)]]
            } />
          
        </div>
      </Section>

      <Section title="Course distance">
        <Pairs
          rows={[
          ['Start reading', s.distStart || '—'],
          ['Finish reading', s.distFinish || '—'],
          ['Rollover adjustment', dc ? dc.adjustment ? `+${dc.adjustment}` : 'None' : '—'],
          ['Total count (T)', dc ? String(dc.count) : '—'],
          ['WC used', `${fmt(d.distance.wc)} (${d.distance.basis.source === 'final' ? 'final constant' : 'pre-cal WC'}${d.distance.basis.provisional ? ' · provisional' : ''})`],
          ['Distance = T ÷ WC', d.distance.km !== null ? `${fmt(d.distance.km, DISTANCE_DISPLAY_DECIMALS)} km (full ${fmt(d.distance.km)})` : '—']]
          } />
        
      </Section>

      <Section title="Post-calibration and comparison">
        <RidesReadout result={d.post} caption="Post-calibration rides" />
        <div className="mt-3">
          <Pairs
            rows={[
            ['Post-calibration WC', fmt(d.post.wc)],
            ['Difference (post − pre)', fmtSigned(d.comparison.difference, WC_DISPLAY_DECIMALS)],
            ['Percentage difference', d.comparison.percent !== null ? `${fmtSigned(d.comparison.percent, 4)} %` : '—'],
            ['Comparison status', 'Descriptive only — no acceptance rule configured']]
            } />
          
        </div>
      </Section>

      <Section title="Final constant">
        <Pairs
          rows={[
          ['Selection rule', optionLabel(finalRuleOptions, s.finalRule)],
          ['Final constant', s.finalRule === 'notConfigured' ? 'Not selected — rule not configured' : fmt(d.finalConstant)]]
          } />
        
      </Section>

      <Section title="Warnings, corrections and acknowledgements">
        {d.warnings.length === 0 && notable.length === 0 ?
        <p className="text-sm text-sub">None recorded.</p> :

        <ul className="space-y-1.5 text-sm">
            {d.warnings.map((w) =>
          <li key={w.id}>
                <span className="font-medium">{w.title}</span> — {w.ack === 'current' ? 'reviewed (not a confirmation of correctness)' : w.ack === 'stale' ? 'review out of date' : 'not reviewed'}
              </li>
          )}
            {notable.map((e) =>
          <li key={e.id} className="text-sub">
                {formatDateTime(e.at)} · {e.actor} · {e.summary}
                {e.reason ? ` — reason: ${e.reason}` : ''}
              </li>
          )}
          </ul>
        }
      </Section>

      <Section title="Versions">
        <Pairs
          rows={[
          ['Rule set', optionLabel(ruleSetOptions, s.ruleSet)],
          ['Calculation engine', ENGINE_VERSION],
          ['Record status', s.finalized ? 'Finalized' : `Not finalized (${d.state})`]]
          } />
        
      </Section>

      {/* Prominent Provisional Notice Footer */}
      <footer
        className="border-t-2 border-dashed border-amber-600/60 pt-4 text-center text-xs text-sub print:border-black print:text-black"
        data-testid="provisional-report-footer"
      >
        <p className="font-bold uppercase tracking-wider text-amber-950 print:text-black">
          {PROVISIONAL_REPORT_NOTICE}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed">
          Generated by {ENGINE_VERSION}. Client-side stored record for verification and pilot data collection only.
          Not approved for race course certification or record ratifications.
        </p>
      </footer>
    </article>);

}