import { format } from 'date-fns';
import type { Option } from '../data/options';

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'd MMM yyyy, HH:mm');
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'HH:mm');
}

export function optionLabel<T extends string>(options: Option<T>[], value: T): string {
  return options.find((o) => o.value === value)?.label ?? value;
}