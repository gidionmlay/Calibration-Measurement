import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, UserIcon } from 'lucide-react';
import { prototypeOperator } from '../../data/sessions';

export function OperatorMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded px-2 text-sm hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
        
        <span className="grid h-7 w-7 place-items-center rounded-full border border-line bg-fill">
          <UserIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="hidden whitespace-nowrap sm:inline">{prototypeOperator}</span>
        <ChevronDownIcon className="h-4 w-4 text-sub" aria-hidden="true" />
      </button>
      {open &&
      <div role="menu" className="absolute right-0 top-11 z-40 w-60 rounded border border-line bg-panel py-1 text-sm">
          <div className="border-b border-hair px-3 py-2">
            <p className="font-medium text-ink">{prototypeOperator}</p>
            <p className="text-xs text-sub">Course measurer · signed in</p>
          </div>
          <button type="button" role="menuitem" disabled className="block w-full px-3 py-2 text-left text-faint">
            Sign out (not in prototype)
          </button>
        </div>
      }
    </div>);

}