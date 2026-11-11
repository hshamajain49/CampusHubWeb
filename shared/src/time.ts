// Pure date/time helpers on naive campus wall-clock values (§9.9, §11.3).
// Dates are 'YYYY-MM-DD', times 'HH:mm', LocalDateTimes 'YYYY-MM-DDTHH:mm:ss' — never converted between zones.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const LDT_RE = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** '14:30' → 870. Accepts 'HH:mm:ss' (seconds ignored). */
export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 870 → '14:30'. Clamps to 00:00–23:59. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalises 'HH:mm:ss' or 'HH:mm' to 'HH:mm'. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function isAligned(time: string, stepMinutes: number): boolean {
  return timeToMinutes(time) % stepMinutes === 0;
}

export function durationMinutes(start: string, end: string): number {
  return timeToMinutes(end) - timeToMinutes(start);
}

/** Every step from open to close inclusive, e.g. ('08:00','09:00',30) → ['08:00','08:30','09:00']. */
export function buildTimeOptions(open: string, close: string, step: number): string[] {
  const out: string[] = [];
  for (let m = timeToMinutes(open); m <= timeToMinutes(close); m += step) out.push(minutesToTime(m));
  return out;
}

/** Days since 1970-01-01 for a calendar date (timezone-free). */
export function dateToDayNumber(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

export function dayNumberToDate(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  return dayNumberToDate(dateToDayNumber(date) + n);
}

export function diffDays(a: string, b: string): number {
  return dateToDayNumber(a) - dateToDayNumber(b);
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(date: string): number {
  const dow = new Date(dateToDayNumber(date) * 86_400_000).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function toLocalDateTime(date: string, time: string): string {
  return `${date}T${hhmm(time)}:00`;
}

/** 'YYYY-MM-DDTHH:mm:ss' → minutes since epoch on a naive timeline. */
export function localDateTimeToMinutes(ldt: string): number {
  const m = LDT_RE.exec(ldt);
  if (!m) throw new Error(`Invalid local date-time: ${ldt}`);
  return dateToDayNumber(m[1]!) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

export function minutesToLocalDateTime(total: number): string {
  const day = Math.floor(total / 1440);
  const rest = total - day * 1440;
  return `${dayNumberToDate(day)}T${minutesToTime(rest)}:00`;
}

export function compareLocalDateTime(a: string, b: string): number {
  return localDateTimeToMinutes(a) - localDateTimeToMinutes(b);
}

export function splitLocalDateTime(ldt: string): { date: string; time: string } {
  const m = LDT_RE.exec(ldt);
  if (!m) throw new Error(`Invalid local date-time: ${ldt}`);
  return { date: m[1]!, time: `${m[2]}:${m[3]}` };
}

export interface CampusNow {
  date: string;
  time: string;
  minutesOfDay: number;
  localDateTime: string;
}

/**
 * Campus "now" built with Intl — never `new Date().toISOString().slice(0, 10)`, which is the UTC date.
 * `offsetMs` corrects for client clock skew (serverTimestamp − Date.now()).
 */
export function campusNow(timeZone: string, offsetMs = 0, at: number = Date.now()): CampusNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at + offsetMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}`;
  return {
    date,
    time,
    minutesOfDay: Number(get('hour')) * 60 + Number(get('minute')),
    localDateTime: `${date}T${time}:${get('second')}`,
  };
}

/** '45 min', '2 h', '2 h 30 min'. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
