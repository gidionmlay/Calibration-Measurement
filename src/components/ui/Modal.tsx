import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { XIcon } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

const sizes = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open &&
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}>
        
          <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className={`flex max-h-[92vh] w-full flex-col rounded-t-lg border border-line bg-panel outline-none sm:rounded-lg ${sizes[size]}`}>
          
            <div className="flex items-start gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold text-ink">
                  {title}
                </h2>
                {description && <p className="mt-1 text-sm text-sub">{description}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close dialog" className="grid h-9 w-9 place-items-center rounded hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      }
    </AnimatePresence>);

}