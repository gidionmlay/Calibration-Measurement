import { Notice } from './Notice';

interface ErrorSummaryProps {
  id: string;
  title: string;
  items: {label: string;targetId: string;}[];
}

export function ErrorSummary({ id, title, items }: ErrorSummaryProps) {
  if (!items.length) return null;
  return (
    <Notice id={id} tone="error" title={title} live>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((item) =>
        <li key={item.targetId + item.label}>
            <button
            type="button"
            className="text-left font-medium text-ink underline underline-offset-2"
            onClick={() => {
              const el = document.getElementById(item.targetId);
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              el?.focus({ preventScroll: true });
            }}>
            
              {item.label}
            </button>
          </li>
        )}
      </ul>
    </Notice>);

}