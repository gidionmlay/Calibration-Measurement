import React, { useEffect, useState } from 'react';
import { useSession } from '../../contexts/SessionContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface RevisionDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RevisionDialog({ open, onClose }: RevisionDialogProps) {
  const { active, createRevision } = useSession();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
      setSubmitting(false);
    }
  }, [open]);

  if (!active) return null;

  const trimmed = reason.trim();
  const isValid = trimmed.length >= 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    try {
      const child = await createRevision(trimmed);
      if (child) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create formal revision for ${active.reference}?`}
      description="Formal revisions create a new editable draft child linked to this record. The original finalized record remains permanently preserved and marked superseded."
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!isValid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Creating revision...' : 'Create formal revision'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="revision-reason" className="block text-sm font-medium text-ink">
            Mandatory revision justification
          </label>
          <p className="mt-0.5 text-xs text-sub">
            Explain the regulatory, mathematical, or environmental basis for revising this finalized record (minimum 10 characters).
          </p>
          <textarea
            id="revision-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Temperature correction recalibration following updated meteorological reports..."
            className="mt-2 w-full rounded border border-line bg-surface p-2.5 text-sm text-ink outline-none transition focus:border-ink"
            required
            autoFocus
          />
          <div className="mt-1 flex justify-between text-xs">
            <span className={trimmed.length < 10 ? 'text-amber-600' : 'text-emerald-600'}>
              {trimmed.length < 10
                ? `${10 - trimmed.length} more character${10 - trimmed.length === 1 ? '' : 's'} required`
                : 'Justification length met'}
            </span>
            <span className="text-sub">{trimmed.length} chars</span>
          </div>
        </div>
      </form>
    </Modal>
  );
}

