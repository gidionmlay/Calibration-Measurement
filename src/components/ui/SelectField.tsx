import React from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { ErrorText } from './ErrorText';

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: {value: string;label: string;}[];
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
}

export function SelectField({ id, label, value, options, onChange, hint, error, disabled, required, compact }: SelectFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className={`block font-medium text-ink ${compact ? 'mb-1 text-xs' : 'mb-1.5 text-sm'}`}>
        {label}
        {required && <span className="font-normal text-sub"> (required)</span>}
      </label>
      {hint &&
      <p id={hintId} className="-mt-0.5 mb-1.5 text-xs text-sub">
          {hint}
        </p>
      }
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className={`h-10 w-full appearance-none rounded bg-panel pl-3 pr-9 text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink disabled:bg-fill disabled:text-sub ${error ? 'border-2 border-ink' : 'border border-line'}`}>
          
          {options.map((o) =>
          <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub" aria-hidden="true" />
      </div>
      {error && errorId && <ErrorText id={errorId}>{error}</ErrorText>}
    </div>);

}