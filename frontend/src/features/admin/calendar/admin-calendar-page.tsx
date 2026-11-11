import * as React from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Check, Construction, ExternalLink, Pencil, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { EventInput } from '@fullcalendar/core';
import { BLOCK_TYPE_LABELS, type AdminBookingListItem, type CalendarEvent, type VenueBlock } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatShortDay } from '@/lib/format';
import { venuePalette } from '@/lib/venue-palette';
import { useDocumentTitle, useIsMdUp } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/controls';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { PageHeader } from '@/components/common/layout-bits';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { RoleBadge, StatusBadge } from '@/components/common/badges';
import { BookingCalendar, type CalendarView } from '@/features/calendar/booking-calendar';
import { useAdminBooking, useAllVenueOptions, useBlockMutations, useCalendar } from '../api';
import { DecisionDialog, type DecisionMode } from '../bookings/decision-dialogs';
import { BlockDialog, type BlockDialogInitial } from '../blocks/block-dialog';

function toEvents(events: CalendarEvent[], allVenues: boolean): EventInput[] {
  return events.map((e) => {
    const color = venuePalette(e.venue.id)[0];
    const base = {
      id: e.id,
      start: e.start,
      end: e.end,
      extendedProps: { source: e, clickable: true, ariaLabel: `${e.title}, ${e.start.slice(11, 16)} to ${e.end.slice(11, 16)}` },
      borderColor: allVenues ? color : undefined,
    };
    if (e.kind === 'booking')
      return {
        ...base,
        title: allVenues ? e.title : e.requester.fullName,
        classNames: [e.status === 'approved' ? 'ev-approved' : 'ev-pending', allVenues ? 'border-l-4' : ''],
      };
    return { ...base, title: allVenues ? e.title : `${BLOCK_TYPE_LABELS[e.blockType]}: ${e.reason}`, classNames: ['ev-block', allVenues ? 'border-l-4' : ''] };
  });
}

/** Admin calendar — reusable on the venue detail page (locked venue). */
export function AdminCalendar({ lockedVenueId }: { lockedVenueId?: string }) {
  const mdUp = useIsMdUp();
  const { data: settings } = usePublicSettings();
  const venues = useAllVenueOptions();
  const [venueId, setVenueId] = React.useState(lockedVenueId ?? '');
  const [statuses, setStatuses] = React.useState<string[]>(['approved', 'pending']);
  const [includeBlocks, setIncludeBlocks] = React.useState(true);
  const [range, setRange] = React.useState<{ from: string; to: string; view: CalendarView } | null>(null);
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [decision, setDecision] = React.useState<{ b: AdminBookingListItem; mode: DecisionMode } | null>(null);
  const [blockDialog, setBlockDialog] = React.useState<{ block?: VenueBlock | null; initial?: BlockDialogInitial } | null>(null);
  const [deleteBlock, setDeleteBlock] = React.useState<CalendarEvent | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const blocksM = useBlockMutations();

  const cal = useCalendar({ from: range?.from, to: range?.to, venueId: venueId || undefined, statuses, includeBlocks });
  const events = React.useMemo(() => toEvents(cal.data?.events ?? [], !venueId), [cal.data, venueId]);
  const selectedBooking = useAdminBooking(selected?.kind === 'booking' ? selected.bookingId : undefined);
  const rules = settings?.bookingRules;

  const toggles = (
    <div className="flex flex-wrap items-center gap-2">
      {[
        ['approved', 'Approved', 'bg-secondary'],
        ['pending', 'Pending', 'slot-hold'],
      ].map(([key, label, swatch]) => (
        <label key={key} className="chip flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12.5px] font-semibold text-ink">
          <Checkbox checked={statuses.includes(key!)} onCheckedChange={(c) => setStatuses((s) => (c ? [...s, key!] : s.filter((x) => x !== key)))} />
          <span className={cn('h-2.5 w-4 rounded-[3px]', swatch)} aria-hidden />
          {label}
        </label>
      ))}
      <label className="chip flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={includeBlocks} onCheckedChange={(c) => setIncludeBlocks(!!c)} />
        <span className="slot-blocked h-2.5 w-4 rounded-[3px]" aria-hidden />
        Blocks
      </label>
    </div>
  );

  const venueSelect = !lockedVenueId && (
    <div className="w-full sm:w-[240px]">
      <Select
        aria-label="Venue"
        value={venueId || 'all'}
        onValueChange={(v) => setVenueId(v === 'all' ? '' : v)}
        options={[{ value: 'all', label: 'All venues' }, ...(venues.data?.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
      />
    </div>
  );

  const singleVenueTimeView = !!venueId && (range?.view === 'timeGridWeek' || range?.view === 'timeGridDay');

  return (
    <div className="grid gap-3">
      {mdUp ? (
        <div className="flex flex-wrap items-center gap-3">
          {venueSelect}
          {toggles}
          {singleVenueTimeView && <span className="text-[12.5px] text-muted">Drag across empty time to block it.</span>}
        </div>
      ) : (
        <>
          <Button variant="outline" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal /> Filters
          </Button>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="bottom" title="Calendar filters">
              <div className="grid gap-4 px-5 pb-4">
                {venueSelect}
                {toggles}
                <Button onClick={() => setFiltersOpen(false)}>Done</Button>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      <BookingCalendar
        views={['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek']}
        initialView={mdUp ? 'timeGridWeek' : 'listWeek'}
        events={events}
        slotMinTime={rules ? (rules.operatingHoursStart < '07:00' ? rules.operatingHoursStart : '07:00') : '07:00'}
        slotMaxTime={rules ? (rules.operatingHoursEnd > '21:00' ? rules.operatingHoursEnd : '21:00') : '21:00'}
        slotDuration={30}
        selectable={singleVenueTimeView}
        loading={cal.isFetching && !cal.data}
        onRangeChange={(from, to, view) => setRange({ from, to, view })}
        onEventClick={(ev) => setSelected(ev.extendedProps.source as CalendarEvent)}
        onSelect={(start, end) =>
          setBlockDialog({
            initial: {
              venueId,
              startDate: format(start, 'yyyy-MM-dd'),
              startTime: format(start, 'HH:mm'),
              endDate: format(end, 'yyyy-MM-dd'),
              endTime: format(end, 'HH:mm'),
            },
          })
        }
      />

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side={mdUp ? 'right' : 'bottom'} title={selected?.kind === 'block' ? 'Venue block' : 'Booking'}>
          {selected && (
            <div className="grid gap-4 px-5 pb-6">
              <div className="rounded-[12px] bg-surface-muted p-4">
                <p className="font-display text-[16px] font-semibold text-ink">{selected.venue.name}</p>
                <p className="tabular mt-1 text-[13px] text-muted">
                  {formatShortDay(selected.start.slice(0, 10))} {selected.start.slice(11, 16)} → {selected.end.slice(0, 10) !== selected.start.slice(0, 10) ? `${formatShortDay(selected.end.slice(0, 10))} ` : ''}
                  {selected.end.slice(11, 16)}
                </p>
              </div>
              {selected.kind === 'booking' ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selected.status} />
                    <span className="font-mono text-[12.5px] text-muted">{selected.reference}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{selected.requester.fullName}</p>
                    <RoleBadge role={selected.requester.role} className="mt-1" />
                  </div>
                  <p className="whitespace-pre-line text-sm text-ink">{selected.purpose}</p>
                  {selected.status === 'pending' && selectedBooking.data && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button disabled={!selectedBooking.data.permissions.canApprove} onClick={() => setDecision({ b: selectedBooking.data!, mode: 'approve' })}>
                        <Check /> Approve
                      </Button>
                      <Button variant="destructive-outline" onClick={() => setDecision({ b: selectedBooking.data!, mode: 'reject' })}>
                        <X /> Reject
                      </Button>
                    </div>
                  )}
                  <Button variant="outline" asChild>
                    <Link to={`/admin/bookings/${selected.bookingId}`}>
                      <ExternalLink /> Open details
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Construction className="size-4 text-muted" /> {BLOCK_TYPE_LABELS[selected.blockType]}
                  </p>
                  <p className="text-sm text-ink">{selected.reason}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setBlockDialog({
                          block: {
                            id: selected.blockId,
                            venue: selected.venue,
                            blockType: selected.blockType,
                            reason: selected.reason,
                            start: selected.start,
                            end: selected.end,
                            createdBy: { id: '', fullName: '' },
                            createdAt: '',
                            updatedAt: '',
                          },
                        })
                      }
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button variant="destructive-outline" onClick={() => setDeleteBlock(selected)}>
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <DecisionDialog
        booking={decision?.b ?? null}
        mode={decision?.mode ?? null}
        onClose={() => setDecision(null)}
        onDone={() => setSelected(null)}
      />
      <BlockDialog
        open={!!blockDialog}
        onOpenChange={(o) => {
          if (!o) setBlockDialog(null);
          if (!o) setSelected(null);
        }}
        block={blockDialog?.block}
        initial={blockDialog?.initial}
        lockVenue={!!venueId || !!lockedVenueId}
      />
      <ConfirmDialog
        open={!!deleteBlock}
        onOpenChange={(o) => !o && setDeleteBlock(null)}
        destructive
        title="Remove this block?"
        description="The time becomes bookable again."
        confirmLabel="Remove block"
        onConfirm={async () => {
          if (deleteBlock?.kind !== 'block') return;
          await blocksM.remove.mutateAsync({
            id: deleteBlock.blockId,
            venue: deleteBlock.venue,
            blockType: deleteBlock.blockType,
            reason: deleteBlock.reason,
            start: deleteBlock.start,
            end: deleteBlock.end,
            createdBy: { id: '', fullName: '' },
            createdAt: '',
            updatedAt: '',
          });
          toast.success('Block removed.');
          setSelected(null);
        }}
      />
    </div>
  );
}

export default function AdminCalendarPage() {
  useDocumentTitle('Calendar');
  return (
    <div>
      <PageHeader title="Calendar" description="Bookings and blocks across your venues, in campus time." />
      <AdminCalendar />
    </div>
  );
}

