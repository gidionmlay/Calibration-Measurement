import React from 'react';
import { OctagonXIcon } from 'lucide-react';

export function ErrorText({ id, children }: {id: string;children: React.ReactNode;}) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-ink">
      <OctagonXIcon className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">Error: </span>
        {children}
      </span>
    </p>);

}