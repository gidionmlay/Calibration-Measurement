import { AnimatePresence, motion } from 'framer-motion';
import { FolderOpenIcon, ListIcon, PlusIcon, SettingsIcon, XIcon } from 'lucide-react';
import { useSession } from '../../contexts/SessionContext';

interface NavItem {
  key: string;
  label: string;
  Icon: typeof ListIcon;
  active: boolean;
  disabled?: boolean;
  note?: string;
  onSelect: () => void;
}

function NavList({ items, compact, onAfterSelect }: {items: NavItem[];compact: boolean;onAfterSelect?: () => void;}) {
  return (
    <ul className="space-y-1 p-2">
      {items.map(({ key, label, Icon, active, disabled, note, onSelect }) =>
      <li key={key}>
          <button
          type="button"
          disabled={disabled}
          aria-current={active ? 'page' : undefined}
          title={compact ? label : undefined}
          onClick={() => {
            onSelect();
            onAfterSelect?.();
          }}
          className={`relative flex h-10 w-full items-center gap-3 rounded px-3 text-left text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:text-faint ${active ? 'bg-fill font-semibold text-ink' : 'text-ink hover:bg-fill disabled:hover:bg-transparent'} ${compact ? 'md:justify-center lg:justify-start' : ''}`}>
          
            {active && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-ink" aria-hidden="true" />}
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className={compact ? 'sr-only lg:not-sr-only lg:truncate' : 'truncate'}>{label}</span>
            {note && <span className={`ml-auto text-[11px] font-normal text-faint ${compact ? 'hidden lg:inline' : ''}`}>{note}</span>}
          </button>
        </li>
      )}
    </ul>);

}

export function Sidebar({ open, onClose }: {open: boolean;onClose: () => void;}) {
  const { view, active, goTo, createSession, openSession } = useSession();

  const items: NavItem[] = [
  { key: 'sessions', label: 'Sessions', Icon: ListIcon, active: view === 'list', onSelect: () => goTo('list') },
  { key: 'new', label: 'New session', Icon: PlusIcon, active: false, onSelect: createSession }];

  if (active) {
    items.push({
      key: 'current',
      label: active.reference,
      Icon: FolderOpenIcon,
      active: view !== 'list',
      note: 'Open',
      onSelect: () => openSession(active.reference)
    });
  }
  items.push({ key: 'settings', label: 'Settings', Icon: SettingsIcon, active: false, disabled: true, note: 'Later', onSelect: () => undefined });

  return (
    <>
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-line bg-panel md:block md:w-16 lg:w-60" aria-label="Primary">
        <nav aria-label="Main">
          <NavList items={items} compact />
        </nav>
      </aside>

      <AnimatePresence>
        {open &&
        <motion.div className="fixed inset-0 z-40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
            <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 w-72 border-r border-line bg-panel"
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
            
              <div className="flex h-14 items-center justify-between border-b border-line px-4">
                <span className="text-sm font-semibold">Navigation</span>
                <button type="button" onClick={onClose} aria-label="Close navigation" className="grid h-10 w-10 place-items-center rounded hover:bg-fill">
                  <XIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <nav aria-label="Main">
                <NavList items={items} compact={false} onAfterSelect={onClose} />
              </nav>
            </motion.div>
          </motion.div>
        }
      </AnimatePresence>
    </>);

}