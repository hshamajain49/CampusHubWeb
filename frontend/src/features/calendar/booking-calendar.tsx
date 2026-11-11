// FullCalendar wrapper for U09, A06 and A10 (§9.10). MIT plugins only.
// API intervals are naive campus-local strings; with timeZone 'local' FullCalendar renders them unchanged.
import * as React from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventInput, DateSelectArg } from '@fullcalendar/core';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMdUp } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/common/small';
import { Spinner } from '@/components/ui/spinner';

export type CalendarView = 'timeGridWeek' | 'timeGridDay' | 'dayGridMonth' | 'listWeek';
const VIEW_LABELS: Record<CalendarView, string> = { dayGridMonth: 'Month', timeGridWeek: 'Week', timeGridDay: 'Day', listWeek: 'List' };

export interface BookingCalendarProps {
  views: CalendarView[];
  initialView: CalendarView;
  initialDate?: string;
  events: EventInput[];
  slotMinTime?: string;
  slotMaxTime?: string;
  slotDuration?: number;
  validRange?: { start: string; end: string };
  selectable?: boolean;
  loading?: boolean;
  onRangeChange: (from: string, to: string, view: CalendarView) => void;
  onSelect?: (start: Date, end: Date) => void;
  /** Blocks selections (e.g. in the past) without hiding those days from view. */
  selectAllow?: (start: Date, end: Date) => boolean;
  onDateClick?: (date: Date, allDay: boolean) => void;
  onEventClick?: (event: EventClickArg['event']) => void;
  toolbarExtra?: React.ReactNode;
  className?: string;
}

export function BookingCalendar({
  views,
  initialView,
  initialDate,
  events,
  slotMinTime = '08:00',
  slotMaxTime = '20:00',
  slotDuration = 15,
  validRange,
  selectable = false,
  loading = false,
  onRangeChange,
  onSelect,
  selectAllow,
  onDateClick,
  onEventClick,
  toolbarExtra,
  className,
}: BookingCalendarProps) {
  const ref = React.useRef<FullCalendar>(null);
  const mdUp = useIsMdUp();
  const [view, setView] = React.useState<CalendarView>(initialView);
  const [title, setTitle] = React.useState('');
  const api = () => ref.current?.getApi();

  React.useEffect(() => {
    if (!views.includes(view)) setView(initialView);
  }, [views, view, initialView]);

  const handleDates = (arg: DatesSetArg) => {
    setTitle(arg.view.title);
    const from = format(arg.start, 'yyyy-MM-dd');
    const end = new Date(arg.end.getTime() - 86_400_000);
    onRangeChange(from, format(end, 'yyyy-MM-dd'), arg.view.type as CalendarView);
  };

  const changeView = (v: CalendarView) => {
    setView(v);
    api()?.changeView(v);
  };

  const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;

  return (
    <div className={cn('relative', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => api()?.prev()}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => api()?.today()}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => api()?.next()}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <h2 className="tabular min-w-0 flex-1 truncate font-display text-[15px] font-semibold text-ink sm:text-base" aria-live="polite">
          {title}
        </h2>
        {toolbarExtra}
        {views.length > 1 && (
          <Segmented aria-label="Calendar view" value={view} onChange={changeView} options={views.map((v) => ({ value: v, label: VIEW_LABELS[v] }))} />
        )}
      </div>
      <div className="relative rounded-[14px] border border-border bg-surface p-1 sm:p-2">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={initialView}
          initialDate={initialDate}
          headerToolbar={false}
          timeZone="local"
          locale="en-GB"
          firstDay={1}
          height={mdUp ? 'auto' : view === 'listWeek' || view === 'dayGridMonth' ? 'auto' : '70vh'}
          expandRows
          allDaySlot={false}
          nowIndicator
          slotMinTime={slotMinTime.length === 5 ? `${slotMinTime}:00` : slotMinTime}
          slotMaxTime={slotMaxTime.length === 5 ? `${slotMaxTime}:00` : slotMaxTime}
          slotDuration={pad(slotDuration)}
          slotLabelInterval="01:00"
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayHeaderFormat={mdUp ? { weekday: 'short', day: 'numeric' } : { weekday: 'narrow', day: 'numeric' }}
          validRange={validRange}
          selectable={selectable}
          selectMirror
          selectOverlap={false}
          selectAllow={selectAllow ? (info) => selectAllow(info.start, info.end) : undefined}
          unselectAuto
          longPressDelay={350}
          selectLongPressDelay={350}
          events={events}
          datesSet={handleDates}
          select={(arg: DateSelectArg) => onSelect?.(arg.start, arg.end)}
          dateClick={(arg) => onDateClick?.(arg.date, arg.allDay)}
          eventClick={(arg) => onEventClick?.(arg.event)}
          eventDidMount={(info) => {
            const label = info.event.extendedProps.ariaLabel as string | undefined;
            if (label) info.el.setAttribute('aria-label', label);
            if (info.event.extendedProps.clickable) {
              info.el.setAttribute('role', 'button');
              info.el.setAttribute('tabindex', '0');
            }
          }}
          dayMaxEvents={3}
          noEventsContent="Nothing scheduled in this range."
          fixedWeekCount={false}
        />
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-[14px] bg-white/40">
            <Spinner className="size-6 text-primary" label="Loading calendar" />
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingCalendar;
