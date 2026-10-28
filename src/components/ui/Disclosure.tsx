import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRightIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';

interface DisclosureProps {
  id: string;
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Disclosure({ id, title, summary, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { focusRequest } = useSession();

  useEffect(() => {
    if (focusRequest?.id === id) setOpen(true);
  }, [focusRequest, id]);

  return (
    <section id={id} tabIndex={-1} className="rounded border border-line bg-panel outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded px-4 py-3 text-left transition-colors duration-150 hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
          
          <ChevronRightIcon className={`h-4 w-4 shrink-0 transition-transform duration-150 ease-out ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          <span className="text-sm font-semibold text-ink">{title}</span>
          {summary && <span className="ml-auto text-xs text-sub">{summary}</span>}
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open &&
        <motion.div
          id={`${id}-panel`}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="overflow-hidden">
          
            <div className="border-t border-line px-4 py-4">{children}</div>
          </motion.div>
        }
      </AnimatePresence>
    </section>);

}