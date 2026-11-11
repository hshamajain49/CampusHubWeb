// Server-side display formatting for notifications, emails, PDFs and CSV (campus wall-clock, en-GB).
import { addDays, dateToDayNumber, formatDuration } from '@campushub/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(date: string) {
  const d = new Date(dateToDayNumber(date) * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
}

/** '20 Nov' */
export const dayMonth = (date: string) => {
  const p = parts(date);
  return `${p.d} ${MONTHS[p.m]}`;
};
/** 'Fri 20 Nov' */
export const weekdayDayMonth = (date: string) => {
  const p = parts(date);
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m]}`;
};
/** 'Friday, 20 November 2026' */
export const longDate = (date: string) => {
  const p = parts(date);
  return `${DAYS_LONG[p.dow]}, ${p.d} ${MONTHS_LONG[p.m]} ${p.y}`;
};
/** '10:00–12:00' */
export const timeRange = (start: string, end: string) => `${start.slice(0, 5)}–${end.slice(0, 5)}`;

export function relativeDay(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return `on ${weekdayDayMonth(date)}`;
}

/** Instant → 'd MMM yyyy, HH:mm' in the campus timezone. */
export function campusTimestamp(at: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return `${g('day')} ${g('month')} ${g('year')}, ${g('hour')}:${g('minute')}`;
}

/** Instant → 'YYYY-MM-DD HH:mm' in the campus timezone (CSV). */
export function campusIsoMinute(at: Date | null, timeZone: string): string {
  if (!at) return '';
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

export { formatDuration };

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
