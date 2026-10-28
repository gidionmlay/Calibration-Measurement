import React from 'react';
import { CircleCheckIcon, InfoIcon, OctagonXIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';

export type NoticeTone = 'error' | 'warning' | 'info' | 'stale' | 'success';

const toneConfig: Record<NoticeTone, {label: string;Icon: typeof InfoIcon;cls: string;}> = {
  error: { label: 'Error', Icon: OctagonXIcon, cls: 'border-2 border-ink bg-panel' },
  warning: { label: 'Warning', Icon: TriangleAlertIcon, cls: 'border-2 border-dashed border-ink bg-panel' },
  info: { label: 'Note', Icon: InfoIcon, cls: 'border border-line bg-panel' },
  stale: { label: 'Stale', Icon: RefreshCwIcon, cls: 'border-2 border-dotted border-ink bg-panel' },
  success: { label: 'Recorded', Icon: CircleCheckIcon, cls: 'border border-ink bg-panel' }
};

interface NoticeProps {
  tone: NoticeTone;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  live?: boolean;
}

export function Notice({ tone, title, children, actions, id, live }: NoticeProps) {
  const { label, Icon, cls } = toneConfig[tone];
  return (
    <div id={id} tabIndex={id ? -1 : undefined} role={live ? tone === 'error' ? 'alert' : 'status' : undefined} className={`rounded p-4 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${cls}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            <span className="mr-2 inline-block rounded-sm bg-ink px-1.5 py-px align-[1px] text-[11px] font-semibold uppercase tracking-wide text-white">{label}</span>
            {title}
          </p>
          {children && <div className="mt-1.5 text-sm leading-relaxed text-sub">{children}</div>}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>);

}