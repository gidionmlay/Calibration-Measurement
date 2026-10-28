import React, { useRef } from 'react';
import { Link2Icon } from 'lucide-react';
import { ErrorText } from './ErrorText';

type FieldMode = 'input' | 'linked' | 'overridden';

interface NumericFieldProps {
  id: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onCommit?: (from: string, to: string) => void;
  error?: string | null;
  hint?: string;
  unit?: string;
  mode?: FieldMode;
  readOnly?: boolean;
  decimal?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  size?: 'md' | 'lg';
  required?: boolean;
}

export function NumericField({
  id,
  label,
  value,
  onChange,
  onCommit,
  error,
  hint,
  unit,
  mode = 'input',
  readOnly = false,
  decimal = false,
  hideLabel = false,
  placeholder,
  size = 'md',
  required = false
}: NumericFieldProps) {
  const focusValue = useRef(value);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const isLinked = mode === 'linked';
  const locked = readOnly || isLinked;

  const frame = error ?
  'border-2 border-ink' :
  isLinked ?
  'border border-dashed border-sub bg-fill' :
  mode === 'overridden' ?
  'border border-line border-l-4 border-l-ink' :
  locked ?
  'border border-line bg-fill' :
  'border border-line';

  return (
    <div>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-sm font-medium text-ink'}>
        {label}
        {required && !hideLabel && <span className="font-normal text-sub"> (required)</span>}
      </label>
      {hint && !hideLabel &&
      <p id={hintId} className="-mt-0.5 mb-1.5 text-xs text-sub">
          {hint}
        </p>
      }
      <div
        className={`flex items-center rounded bg-panel focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ink ${frame} ${size === 'lg' ? 'h-12' : 'h-10'}`}>
        
        {isLinked && <Link2Icon className="ml-2.5 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />}
        <input
          id={id}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          readOnly={locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onFocus={() => {
            focusValue.current = value;
          }}
          onBlur={() => {
            if (onCommit && !locked && focusValue.current !== value) onCommit(focusValue.current, value);
          }}
          onChange={(e) => onChange?.(e.target.value)}
          className={`h-full w-full min-w-0 flex-1 bg-transparent px-3 font-mono outline-none placeholder:font-sans placeholder:text-faint ${size === 'lg' ? 'text-lg' : 'text-sm'} ${locked ? 'cursor-default text-sub' : 'text-ink'}`} />
        
        {unit && <span className="pr-3 text-sm text-sub">{unit}</span>}
      </div>
      {hint && hideLabel &&
      <p id={hintId} className="sr-only">
          {hint}
        </p>
      }
      {error && errorId && <ErrorText id={errorId}>{error}</ErrorText>}
    </div>);

}