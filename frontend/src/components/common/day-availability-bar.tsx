// The product's core motif: a day's operating hours as a bar, busy segments in the calendar colours,
// the chosen interval outlined. Includes a text fallback for screen readers (§19.6).
import { localDateTimeToMinutes, minutesToTime, timeToMinutes, toLocalDateTime, type AvailabilityInterval } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { useIsMdUp } from '@/hooks/misc';

interface Props {
  date: string;
  open: string;
  close: string;
  intervals: AvailabilityInterval[];
  selection?: { start: string; end: string } | null;
  conflict?: boolean;
  compact?: boolean;
  showTicks?: boolean;
  className?: string;
}

const kindClass = (i: AvailabilityInterval) =>
  i.isMine ? 'bg-secondary-soft ring-1 ring-inset ring-secondary' : i.kind === 'booked' ? 'slot-booked' : i.kind === 'on_hold' ? 'slot-hold' : 'slot-blocked';

const kindWord = (i: AvailabilityInterval) => (i.isMine ? 'your booking' : i.kind === 'booked' ? 'booked' : i.kind === 'on_hold' ? 'on hold' : 'blocked');

export function DayAvailabilityBar({ date, open, close, intervals, selection, conflict, compact, showTicks = true, className }: Props) {
  const mdUp = useIsMdUp();
  const dayStart = localDateTimeToMinutes(toLocalDateTime(date, open));
  const dayEnd = localDateTimeToMinutes(toLocalDateTime(date, close));
  const span = Math.max(1, dayEnd - dayStart);
  const pct = (m: number) => `${(Math.min(Math.max(m - dayStart, 0), span) / span) * 100}%`;

  const segments = intervals
    .map((i) => ({ i, s: Math.max(localDateTimeToMinutes(i.start), dayStart), e: Math.min(localDateTimeToMinutes(i.end), dayEnd) }))
    .filter((x) => x.e > x.s);

  const firstHour = Math.ceil(timeToMinutes(open) / 60);
  const lastHour = Math.floor(timeToMinutes(close) / 60);
  const step = mdUp ? 1 : 2;
  const ticks: number[] = [];
  for (let h = firstHour; h <= lastHour; h += step) ticks.push(h);

  const summary = segments.length
    ? `Busy: ${segments.map((x) => `${minutesToTime(x.s - dayStart + timeToMinutes(open))}–${minutesToTime(x.e - dayStart + timeToMinutes(open))} (${kindWord(x.i)})`).join(', ')}`
    : 'Free all day';

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn('relative w-full overflow-hidden rounded-[8px] bg-[var(--slot-free)] ring-1 ring-inset ring-[#D7EBE7]', compact ? 'h-2.5' : 'h-7')}
        aria-hidden
      >
        {segments.map(({ i, s, e }, idx) => (
          <span
            key={idx}
            className={cn('absolute inset-y-0', kindClass(i), !compact && 'border-x border-white/70')}
            style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
            title={compact ? undefined : `${i.label} ${i.start.slice(11, 16)}–${i.end.slice(11, 16)}`}
          />
        ))}
        {selection && (
          <span
            className={cn(
              'absolute inset-y-0 rounded-[6px] border-2',
              conflict ? 'border-destructive bg-destructive/15' : 'border-primary bg-primary/15',
            )}
            style={{
              left: pct(localDateTimeToMinutes(toLocalDateTime(date, selection.start))),
              width: `calc(${pct(localDateTimeToMinutes(toLocalDateTime(date, selection.end)))} - ${pct(localDateTimeToMinutes(toLocalDateTime(date, selection.start)))})`,
            }}
          />
        )}
      </div>
      {showTicks && !compact && (
        <div className="relative mt-1 h-4" aria-hidden>
          {ticks.map((h) => {
            const m = h * 60;
            const left = ((m - timeToMinutes(open)) / span) * 100;
            return (
              <span key={h} className="tabular absolute -translate-x-1/2 text-[10.5px] font-medium text-subtle first:translate-x-0" style={{ left: `${left}%` }}>
                {String(h).padStart(2, '0')}
              </span>
            );
          })}
        </div>
      )}
      <p className="sr-only">{summary}</p>
    </div>
  );
}

export function AvailabilityLegend({ className }: { className?: string }) {
  const items = [
    ['slot-booked', 'Booked'],
    ['slot-hold', 'On hold (awaiting approval)'],
    ['slot-blocked', 'Unavailable'],
    ['bg-secondary-soft ring-1 ring-inset ring-secondary', 'Your booking'],
  ];
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted', className)}>
      {items.map(([cls, label]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <span className={cn('h-3 w-5 rounded-[4px]', cls)} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}
