import { useEffect, useRef, useState } from 'react';
import { BarChart3Icon, ChevronDownIcon, LogInIcon, LogOutIcon, ShieldCheckIcon, UserIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';
import { prototypeOperator } from '../../data/sessions';
import { SystemRoleName } from '../../services/auth/types';

const ROLE_LABELS: Record<string, string> = {
  measurer: 'Measurer',
  reviewer: 'Reviewer',
  supervisor: 'Supervisor',
  auditor: 'Auditor',
  admin: 'Admin',
};

export function OperatorMenu() {
  const { user, isAuthenticated, logout, isMockAuth, switchMockRole, hasRole, openAuthModal } = useAuth();
  const { goTo } = useSession();
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

  const displayName = user?.display_name || (isAuthenticated ? 'Authenticated Operator' : prototypeOperator);
  const roles = user?.roles || [];

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openAuthModal('signin')}
          className="flex h-10 items-center gap-2 rounded px-2 text-sm hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-line bg-fill">
            <LogInIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="whitespace-nowrap">Sign In</span>
        </button>
        <button
          type="button"
          onClick={() => openAuthModal('register')}
          className="hidden sm:inline-flex h-8 items-center rounded bg-ink px-2.5 text-xs font-semibold text-white hover:bg-black">
          Register
        </button>
      </div>
    );
  }

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
        <span className="hidden whitespace-nowrap sm:inline">{displayName}</span>
        <ChevronDownIcon className="h-4 w-4 text-sub" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-64 rounded border border-line bg-panel py-1 text-sm shadow-sm">
          <div className="border-b border-hair px-3 py-2">
            <p className="font-medium text-ink">{displayName}</p>
            {user?.email && <p className="truncate text-xs text-sub">{user.email}</p>}
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-0.5 rounded bg-fill px-1.5 py-0.5 text-[11px] font-medium text-ink">
                  <ShieldCheckIcon className="h-3 w-3 text-sub" aria-hidden="true" />
                  {ROLE_LABELS[r.toLowerCase()] || r}
                </span>
              ))}
            </div>
            {user?.status && user.status !== 'active' && (
              <p className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                Account Status: {user.status}
              </p>
            )}
          </div>

          {(hasRole('admin') || hasRole('supervisor')) && (
            <div className="border-b border-hair py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  goTo('admin');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-fill"
              >
                <BarChart3Icon className="h-4 w-4 text-sub" aria-hidden="true" />
                <span>Admin Overview</span>
              </button>
            </div>
          )}

          {/* Development Role Switcher */}
          {isMockAuth && switchMockRole && (
            <div className="border-b border-hair px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sub">Dev Role Switcher</p>
              <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                {(['measurer', 'reviewer', 'supervisor', 'auditor', 'admin'] as SystemRoleName[]).map((r) => {
                  const isActive = roles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        switchMockRole(r);
                        setOpen(false);
                      }}
                      className={`rounded px-1.5 py-1 text-left ${
                        isActive ? 'bg-ink font-semibold text-white' : 'hover:bg-fill text-ink'
                      }`}>
                      {ROLE_LABELS[r]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              logout();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink hover:bg-fill">
            <LogOutIcon className="h-4 w-4 text-sub" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
