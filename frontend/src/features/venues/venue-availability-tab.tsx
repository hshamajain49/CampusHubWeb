// U09: member availability calendar. Busy time is background events; selection snaps to the step
// and is validated against the booking rules before offering "Continue".
import * as React from 'react';
import { useNavigate } from 'react-router';
import { format, parseISO, startOfWeek } from 'date-fns';
import { toast } from 'sonner';
import { ArrowRight, X } from 'lucide-react';
import type { EventInput } from '@fullcalendar/core';
import { addDays, collectSlotViolations, formatDuration, timeToMinutes, minutesToTime, type PublicSettings } from '@campushub/shared';
import { useIsMdUp } from '@/hooks/misc';
import { useCampusNow } from '@/hooks/use-public-settings';
import { formatShortDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { AvailabilityLegend } from '@/components/common/day-availability-bar';
import { ErrorState } from '@/components/common/states';
import { BookingCalendar, type CalendarView } from '@/features/calendar/booking-calendar';
import { useAvailability } from './api';

export default function VenueAvailabilityTab({ venueId, settings, initialDate }: { venueId: string; settings: PublicSettings; initialDate?: string }) {
  const rules = settings.bookingRules;
  const mdUp = useIsMdUp();
  const now = useCampusNow();
  const navigate = useNavigate();
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);
  const [pick, setPick] = React.useState<{ date: string; start: string; end: string } | null>(null);
  const avail = useAvailability(venueId, range?.from, range?.to);

  const events: EventInput[] = React.useMemo(
    () =>
      (avail.data?.intervals ?? []).map((i, idx) => {
        const range = `${i.start.slice(11, 16)} to ${i.end.slice(11, 16)}`;
        if (i.isMine) {
          return {
            id: `mine-${idx}`,
            start: i.start,
            end: i.end,
            title: i.label,
            classNames: ['ev-mine'],
            extendedProps: { bookingId: i.bookingId, clickable: true, ariaLabel: `${i.label} ${range}` },
          };
        }
        return {
          id: `busy-${idx}`,
          start: i.start,
          end: i.end,
          title: i.label,
          display: 'background',
          classNames: [i.kind === 'booked' ? 'ev-booked' : i.kind === 'on_hold' ? 'ev-hold' : 'ev-blocked'],
          extendedProps: { ariaLabel: `${i.label} ${range}` },
        };
      }),
    [avail.data],
  );

  const offer = (start: Date, end: Date) => {
    const date = format(start, 'yyyy-MM-dd');
    const s = format(start, 'HH:mm');
    let e = format(end, 'HH:mm');
    if (format(end, 'yyyy-MM-dd') !== date) e = '23:59';
    const step = rules.timeStepMinutes;
    const sm = Math.floor(timeToMinutes(s) / step) * step;
    const em = Math.ceil(timeToMinutes(e) / step) * step;
    const slot = { date, startTime: minutesToTime(sm), endTime: minutesToTime(em) };
    const violation = now ? collectSlotViolations(slot, rules, now.localDateTime)[0] : null;
    if (violation) {
      toast.error(
        violation.code === 'DURATION_OUT_OF_RANGE'
          ? `Selections must be between ${formatDuration(rules.minDurationMinutes)} and ${formatDuration(rules.maxDurationMinutes)}.`
          : violation.message,
      );
      setPick(null);
      return;
    }
    setPick({ date, start: slot.startTime, end: slot.endTime });
  };

  if (avail.isError && !avail.data) return <ErrorState compact onRetry={() => avail.refetch()} />;

  const maxDate = now ? addDays(now.date, rules.maxAdvanceDays + 1) : undefined;
  // Navigation starts at this week (past days stay visible, hatched); past selections are refused.
  const weekStart = now ? format(startOfWeek(parseISO(now.date), { weekStartsOn: 1 }), 'yyyy-MM-dd') : undefined;
  const view: CalendarView = mdUp ? 'timeGridWeek' : 'timeGridDay';

  return (
    <div className="grid gap-3">
      <AvailabilityLegend />
      <BookingCalendar
        views={['timeGridWeek', 'timeGridDay', 'dayGridMonth']}
        initialView={view}
        initialDate={initialDate}
        events={events}
        slotMinTime={rules.operatingHoursStart}
        slotMaxTime={rules.operatingHoursEnd}
        slotDuration={rules.timeStepMinutes}
        validRange={weekStart && maxDate ? { start: weekStart, end: maxDate } : undefined}
        selectAllow={(start) => !now || format(start, "yyyy-MM-dd'T'HH:mm") > now.localDateTime.slice(0, 16)}
        selectable={mdUp}
        loading={avail.isFetching && !avail.data}
        onRangeChange={(from, to) => setRange({ from, to })}
        onSelect={offer}
        onDateClick={(d, allDay) => {
          if (allDay) return;
          if (mdUp) return; // desktop uses drag selection
          offer(d, new Date(d.getTime() + rules.minDurationMinutes * 60_000)); // tap selects one minimum block
        }}
        onEventClick={(ev) => ev.extendedProps.bookingId && navigate(`/bookings/${ev.extendedProps.bookingId}`)}
      />
      {pick && (
        <div role="status" className="card rise-in-once sticky bottom-3 z-20 flex flex-wrap items-center gap-3 p-3 pl-4 shadow-raised safe-bottom">
          <p className="tabular min-w-0 flex-1 text-sm font-semibold text-ink">
            Book {formatShortDay(pick.date)} {pick.start}–{pick.end}?
          </p>
          <Button variant="ghost" size="sm" onClick={() => setPick(null)} aria-label="Clear selection">
            <X /> Clear
          </Button>
          <Button size="sm" onClick={() => navigate(`/bookings/new?venueId=${venueId}&date=${pick.date}&start=${pick.start}&end=${pick.end}`)}>
            Continue <ArrowRight />
          </Button>
        </div>
      )}
    </div>
  );
}
