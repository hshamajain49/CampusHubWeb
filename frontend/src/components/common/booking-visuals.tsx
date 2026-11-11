import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { diffDays, type BookingSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatDate, formatTimeRange } from '@/lib/format';
import { StatusBadge } from './badges';

/** Calendar-page date block: month abbreviation over day number (§19.6). */
export function BookingDateBlock({ date, className, muted = false }: { date: string; className?: string; muted?: boolean }) {
  const d = parseISO(date);
  return (
    <div
      className={cn(
        'flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-[12px] border',
        muted ? 'border-border bg-surface-muted' : 'border-[#CDEBE6] bg-secondary-soft',
        className,
      )}
      aria-hidden
    >
      <span className={cn('w-full py-0.5 text-center text-[10.5px] font-bold uppercase tracking-[0.8px]', muted ? 'bg-[#E3E7EF] text-muted' : 'bg-[#CDEBE6] text-secondary-text')}>
        {format(d, 'MMM')}
      </span>
      <span className={cn('tabular py-1 font-display text-[22px] font-semibold leading-7', muted ? 'text-muted' : 'text-ink')}>{format(d, 'd')}</span>
    </div>
  );
}

/** "Today", "Happening now", "In N days" (U12). */
export function TimingChip({ booking, today }: { booking: Pick<BookingSummary, 'date' | 'isHappeningNow' | 'isUpcoming' | 'status'>; today: string | undefined }) {
  if (!today || !booking.isUpcoming) return null;
  if (booking.isHappeningNow)
    return (
      <span className="chip inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success-text">
        <span className="size-1.5 rounded-full bg-success" aria-hidden /> Happening now
      </span>
    );
  const n = diffDays(booking.date, today);
  const label = n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
  return <span className={cn('chip tabular rounded-full px-2 py-0.5 text-[11.5px] font-semibold', n <= 1 ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-muted')}>{label}</span>;
}

export function BookingCard({ booking, to, today }: { booking: BookingSummary; to: string; today?: string }) {
  const final = booking.status === 'rejected' || booking.status === 'cancelled' || booking.status === 'expired';
  return (
    <Link to={to} className="card lift press group flex gap-4 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <BookingDateBlock date={booking.date} muted={final} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-w-0 break-words text-[15px] font-semibold leading-[21px] text-ink" title={booking.venue.name}>{booking.venue.name}</h3>
          <StatusBadge status={booking.status} size="sm" className="mt-px" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted">{booking.purpose}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="tabular inline-flex flex-wrap items-center gap-x-1 text-[12.5px] font-medium text-ink">
            <Clock className="size-3.5 text-muted" aria-hidden />
            <span className="whitespace-nowrap">{formatDate(booking.date)} ·</span>
            <span className="whitespace-nowrap">{formatTimeRange(booking.startTime, booking.endTime)}</span>
          </span>
          <TimingChip booking={booking} today={today} />
        </div>
      </div>
    </Link>
  );
}
