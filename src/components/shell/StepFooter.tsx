import React from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { Button } from '../ui/Button';

interface StepFooterProps {
  backLabel?: string;
  onBack?: () => void;
  onSaveDraft?: () => void;
  secondary?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  note?: string;
}

export function StepFooter({ backLabel = 'Back', onBack, onSaveDraft, secondary, primaryLabel, onPrimary, note }: StepFooterProps) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-10 border-t border-line bg-panel px-4 py-3 md:-mx-8 md:px-8">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {onBack &&
        <Button variant="ghost" icon={<ArrowLeftIcon />} onClick={onBack} className="self-start sm:mr-auto">
            {backLabel}
          </Button>
        }
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {note && <p className="w-full text-xs text-sub sm:mr-2 sm:w-auto">{note}</p>}
          {onSaveDraft && <Button onClick={onSaveDraft}>Save draft</Button>}
          {secondary}
          <Button variant="primary" onClick={onPrimary} iconRight={<ArrowRightIcon />} className="flex-1 sm:flex-none">
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>);

}