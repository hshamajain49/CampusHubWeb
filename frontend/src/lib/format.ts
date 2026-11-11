// Display formats (§9.9). Dates are naive campus dates — parsed with parseISO, never shifted.
import { format, parseISO } from 'date-fns';
import { formatDuration as fmtDuration } from '@campushub/shared';

export const formatDuration = fmtDuration;

export function formatDate(date: string): string {
  return format(parseISO(date), 'd MMM yyyy');
}

export function formatLongDate(date: string): string {
  return format(parseISO(date), 'EEEE, d MMM yyyy');
}

export function formatShortDay(date: string): string {
  return format(parseISO(date), 'EEE d MMM');
}

export function formatDateRange(a: string, b: string): string {
  if (a === b) return formatDate(a);
  const da = parseISO(a);
  const db = parseISO(b);
  if (da.getFullYear() !== db.getFullYear()) return `${format(da, 'd MMM yyyy')} – ${format(db, 'd MMM yyyy')}`;
  if (da.getMonth() !== db.getMonth()) return `${format(da, 'd MMM')} – ${format(db, 'd MMM yyyy')}`;
  return `${format(da, 'd')} – ${format(db, 'd MMM yyyy')}`;
}

export function formatTimeRange(start: string, end: string): string {
  return `${start.slice(0, 5)} – ${end.slice(0, 5)}`;
}

/** Instant (ISO with Z) → 'd MMM yyyy · HH:mm' in campus time. */
export function formatTimestamp(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('day')} ${g('month')} ${g('year')} · ${g('hour')}:${g('minute')}`;
}

/** Instant → campus calendar date 'YYYY-MM-DD'. */
export function campusDateOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return format(new Date(iso), 'd MMM yyyy');
}

export function greetingFor(minutesOfDay: number): string {
  if (minutesOfDay < 12 * 60) return 'Good morning';
  if (minutesOfDay < 17 * 60) return 'Good afternoon';
  return 'Good evening';
}

export function monthKey(date: string): string {
  return format(parseISO(date), 'MMMM yyyy');
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n);
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}
