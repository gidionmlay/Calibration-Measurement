import React, { useEffect, useState } from 'react';
import { useSession } from '../../contexts/SessionContext';
import { DISTANCE_DISPLAY_DECIMALS, WC_DISPLAY_DECIMALS, fmt } from '../../utils/calibration';
import { optionLabel } from '../../utils/format';
import { finalRuleOptions } from '../../data/options';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export function FinalizeDialog({ open, onClose }: {open: boolean;onClose: () => void;}) {
  const { active, derived, finalize } = useSession();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) setConfirmed(false);
  }, [open]);

  if (!active || !derived) return null;
  const rows = [
  { label: 'Session reference', value: active.reference },
  { label: 'Calibration course length', value: derived.length.ok ? `${fmt(derived.length.value)} m` : '—' },
  { label: 'Measured course distance', value: `${fmt(derived.distance.km, DISTANCE_DISPLAY_DECIMALS)} km (full: ${fmt(derived.distance.km)})` },
  { label: 'Pre-calibration WC', value: fmt(derived.pre.wc, WC_DISPLAY_DECIMALS) },
  { label: 'Post-calibration WC', value: fmt(derived.post.wc, WC_DISPLAY_DECIMALS) },
  { label: 'Final constant', value: `${fmt(derived.finalConstant, WC_DISPLAY_DECIMALS)} — ${optionLabel(finalRuleOptions, active.finalRule)}` }];


  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Finalize ${active.reference}?`}
      description="Finalization is recorded in the audit trail and makes the session read-only."
      footer={
      <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
          variant="primary"
          disabled={!confirmed}
          onClick={() => {
            finalize();
            onClose();
          }}>
          
            Finalize session
          </Button>
        </>
      }>
      
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[190px_minmax(0,1fr)]">
        {rows.map((r) =>
        <React.Fragment key={r.label}>
            <dt className="text-sub">{r.label}</dt>
            <dd className="font-mono text-ink">{r.value}</dd>
          </React.Fragment>
        )}
      </dl>
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded border border-line p-3 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-ink" />
        <span>I have reviewed this record. Finalized sessions are read-only; later corrections need an authorized formal revision that keeps this original.</span>
      </label>
    </Modal>);

}