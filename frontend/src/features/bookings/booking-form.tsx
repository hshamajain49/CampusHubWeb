// U10 / U15 booking form. Local rules first, then a debounced non-binding server check (E10),
// then the authoritative submit (E11/E14) with every documented error mapped to a field or alert.
import * as React from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CircleCheck, CircleX, Clock, Info, MapPin, Send, Sun, TriangleAlert, Users } from 'lucide-react';
import {
  ROLE_LABELS,
  addDays,
  collectSlotViolations,
  durationMinutes,
  formatDuration,
  localDateTimeToMinutes,
  timeToMinutes,
  toLocalDateTime,
  type AvailabilityInterval,
  type Booking,
  type VenueSummary,
} from '@campushub/shared';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/hooks/misc';
import { useCampusNow, usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/menus';
import { Field } from '@/components/common/form-field';
import { DatePicker, TimeSelect } from '@/components/common/pickers';
import { DayAvailabilityBar, AvailabilityLegend } from '@/components/common/day-availability-bar';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { RoleBadge } from '@/components/common/badges';
import { UserAvatar } from '@/components/common/small';
import { VenueBanner } from '@/components/common/venue-visuals';
import { useAvailability, useAvailabilityCheck } from '@/features/venues/api';
import { useCreateBooking, useUpdateBooking } from './api';
import { buildBookingFormSchema, type BookingFormValues } from './lib/booking-form-schema';
import { formatNumber } from '@/lib/format';
import { VenueCombobox } from './venue-combobox';

type ServerAlert = { variant: 'error' | 'warning'; title: string; body?: React.ReactNode; action?: React.ReactNode } | null;

function intervalText(i: AvailabilityInterval) {
  const kind = i.isMine ? 'Your pending request' : i.kind === 'booked' ? 'Booked' : i.kind === 'on_hold' ? 'On hold' : i.label;
  return `${i.start.slice(11, 16)}–${i.end.slice(11, 16)} · ${kind}`;
}

export function BookingForm({
  mode,
  initial,
  venue: initialVenue,
  allowChangeVenue,
  booking,
}: {
  mode: 'create' | 'edit';
  initial: BookingFormValues;
  venue: VenueSummary | null;
  allowChangeVenue: boolean;
  booking?: Booking;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = useCampusNow();
  const { data: settings, refetch: refetchSettings } = usePublicSettings();
  const rules = settings?.bookingRules;
  const [venue, setVenue] = React.useState<VenueSummary | null>(initialVenue);
  const [venueLocked, setVenueLocked] = React.useState(!!initialVenue);
  const [serverAlert, setServerAlert] = React.useState<ServerAlert>(null);
  const [changedDialog, setChangedDialog] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const idempotencyKey = React.useRef(crypto.randomUUID());

  const schema = React.useMemo(
    () => buildBookingFormSchema(rules, venue?.capacity ?? null, now?.localDateTime ?? null, venue?.name),
    [rules, venue, now?.localDateTime],
  );
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(schema as any),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: initial,
  });
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState;
  const [date, startTime, endTime, purpose] = form.watch(['date', 'startTime', 'endTime', 'purpose']);

  const create = useCreateBooking();
  const update = useUpdateBooking(booking?.id ?? '');

  // Day availability for the chosen date (the bar) and the debounced live check.
  const avail = useAvailability(venue?.id, date || undefined, date || undefined);
  const others = (avail.data?.intervals ?? []).filter((i) => !(booking && i.bookingId === booking.id));
  const localViolations =
    rules && now && date && startTime && endTime ? collectSlotViolations({ date, startTime, endTime }, rules, now.localDateTime) : [];
  const slot = venue && date && startTime && endTime && localViolations.length === 0 ? { date, startTime, endTime, ...(booking ? { excludeBookingId: booking.id } : {}) } : null;
  const debouncedSlot = useDebouncedValue(slot, 400);
  const sameSlot = JSON.stringify(slot) === JSON.stringify(debouncedSlot);
  const check = useAvailabilityCheck(venue?.id, debouncedSlot);
  const hardConflict = !!slot && sameSlot && !!check.data && check.data.conflicts.length > 0;

  // Unsaved-changes guard (D-14).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && !done && !isSubmitting && currentLocation.pathname !== nextLocation.pathname);

  if (!rules || !now) return null;
  const { operatingHoursStart: open, operatingHoursEnd: close, timeStepMinutes: step, minDurationMinutes: minD, maxDurationMinutes: maxD } = rules;

  const startDisabled = (t: string) => {
    if (timeToMinutes(t) > timeToMinutes(close) - minD) return 'too late';
    if (date && localDateTimeToMinutes(toLocalDateTime(date, t)) <= localDateTimeToMinutes(now.localDateTime)) return 'past';
    return false;
  };
  const endDisabled = (t: string) => {
    if (!startTime) return false;
    const d = timeToMinutes(t) - timeToMinutes(startTime);
    if (d <= 0) return 'before start';
    if (d < minD) return 'too short';
    if (d > maxD) return 'too long';
    return false;
  };

  const windowMinutes = timeToMinutes(close) - timeToMinutes(open);
  const fullDayBusy = date && others.some((i) => i.start.slice(0, 10) <= date && i.end.slice(0, 10) >= date);
  const fullDayReason =
    windowMinutes > maxD
      ? `The operating day is longer than the ${formatDuration(maxD)} maximum.`
      : !date
        ? 'Pick a date first.'
        : fullDayBusy
          ? 'Part of the day is already taken.'
          : date === now.date && localDateTimeToMinutes(toLocalDateTime(date, open)) <= localDateTimeToMinutes(now.localDateTime)
            ? 'The day has already started.'
            : null;

  const setTime = (field: 'startTime' | 'endTime', v: string) => {
    form.setValue(field, v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted || !!errors[field] });
    if (field === 'startTime') {
      const d = endTime ? timeToMinutes(endTime) - timeToMinutes(v) : -1;
      if (d < minD || d > maxD) {
        // Keep the pair valid: suggest a sensible end after the new start.
        const suggested = Math.min(timeToMinutes(v) + Math.max(minD, 60), timeToMinutes(close));
        const sm = `${String(Math.floor(suggested / 60)).padStart(2, '0')}:${String(suggested % 60).padStart(2, '0')}`;
        form.setValue('endTime', sm, { shouldDirty: true });
      }
    }
    setServerAlert(null);
  };

  const handleError = (err: unknown) => {
    if (!(err instanceof ApiError)) return toast.error("Couldn't submit your request. Check your connection and try again.");
    const d = err.details ?? {};
    switch (err.code) {
      case 'BOOKING_CONFLICT':
        void qc.invalidateQueries({ queryKey: ['venue', venue?.id, 'availability'] });
        return setServerAlert({
          variant: 'error',
          title: err.message,
          body: d.conflicts?.length ? (
            <ul className="mt-1 grid gap-0.5">
              {d.conflicts.map((c: AvailabilityInterval, i: number) => (
                <li key={i} className="tabular">
                  {intervalText(c)}
                  {c.isMine && c.bookingId && (
                    <Link to={`/bookings/${c.bookingId}`} className="ml-2 font-semibold underline">
                      View it
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : undefined,
        });
      case 'VENUE_BLOCKED':
        return setServerAlert({ variant: 'error', title: err.message });
      case 'VENUE_INACTIVE':
        return setServerAlert({
          variant: 'error',
          title: mode === 'edit' ? err.message : 'This venue is no longer accepting bookings.',
          action: (
            <Button size="sm" variant="outline" asChild>
              <Link to="/venues">Browse venues</Link>
            </Button>
          ),
        });
      case 'PENDING_LIMIT_REACHED':
        return setServerAlert({
          variant: 'warning',
          title: err.message,
          action: (
            <Button size="sm" variant="outline" asChild>
              <Link to="/bookings?status=pending">My bookings</Link>
            </Button>
          ),
        });
      case 'BOOKING_CHANGED':
        return setChangedDialog(true);
      case 'INVALID_STATUS_TRANSITION':
      case 'MODIFICATION_WINDOW_CLOSED':
        return setServerAlert({ variant: 'error', title: err.message });
      case 'VALIDATION_ERROR': {
        const fe = err.fieldErrors;
        const keys = Object.keys(fe);
        if (!keys.length) return setServerAlert({ variant: 'error', title: err.message });
        for (const k of keys) form.setError(k as keyof BookingFormValues, { message: fe[k]![0] });
        form.setFocus(keys[0] as keyof BookingFormValues);
        return;
      }
      default:
        if (d.field) {
          void refetchSettings(); // rules may have changed since the page loaded (EC-32)
          form.setError(d.field, { message: err.message });
          return form.setFocus(d.field);
        }
        if (err.status === 0 || err.status >= 500) return toast.error("Couldn't submit your request. Check your connection and try again.");
        return setServerAlert({ variant: 'error', title: err.message });
    }
  };

  const onSubmit = form.handleSubmit(
    async (v) => {
      setServerAlert(null);
      try {
        if (mode === 'create') {
          const b = await create.mutateAsync({ input: { ...v, expectedAttendees: v.expectedAttendees ?? null }, idempotencyKey: idempotencyKey.current });
          idempotencyKey.current = crypto.randomUUID();
          setDone(true);
          navigate(`/bookings/${b.id}/submitted`, { replace: true });
        } else if (booking) {
          const body: Record<string, unknown> = { version: booking.version };
          for (const k of ['date', 'startTime', 'endTime', 'purpose', 'expectedAttendees'] as const) {
            if (dirtyFields[k] && v[k] !== initial[k]) body[k] = v[k];
          }
          const b = await update.mutateAsync(body);
          setDone(true);
          toast.success(booking.status === 'approved' && b.status === 'pending' ? 'Booking updated — pending re-approval.' : 'Booking updated.');
          navigate(`/bookings/${booking.id}`, { replace: true });
        }
      } catch (err) {
        handleError(err);
      }
    },
    (errs) => {
      const first = Object.keys(errs)[0] as keyof BookingFormValues | undefined;
      if (first) form.setFocus(first);
    },
  );

  const duration = startTime && endTime && timeToMinutes(endTime) > timeToMinutes(startTime) ? durationMinutes(startTime, endTime) : null;
  const purposeLen = (purpose ?? '').length;
  const timeError = errors.startTime?.message ?? errors.endTime?.message;

  const live = (() => {
    if (!venue || !date || !startTime || !endTime || localViolations.length) return null;
    if (!sameSlot || check.isFetching) return <span className="text-muted">Checking availability…</span>;
    if (check.isError) return null;
    const c = check.data;
    if (!c) return null;
    if (c.available)
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-success-text">
          <CircleCheck className="size-4" /> This time is available
        </span>
      );
    if (c.conflicts.length)
      return (
        <span className="inline-flex items-start gap-1.5 font-semibold text-destructive-text">
          <CircleX className="mt-px size-4 shrink-0" /> Conflicts with {c.conflicts.map(intervalText).join(', ')}
        </span>
      );
    return (
      <span className="inline-flex items-start gap-1.5 font-semibold text-warning-text">
        <TriangleAlert className="mt-px size-4 shrink-0" /> {c.violations[0]?.message}
      </span>
    );
  })();

  const summary = (
    <div className="card overflow-hidden">
      {venue ? (
        <VenueBanner venueId={venue.id} imageUrl={venue.imageThumbUrl} rounded={false} className="h-20" />
      ) : (
        <div className="h-20 bg-[linear-gradient(135deg,#E8EDFA,#E1F4F1)]" />
      )}
      <div className="p-5">
        <p className="font-display text-[16px] font-semibold text-ink">{venue?.name ?? 'Choose a venue'}</p>
        {venue && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {venue.building}
            </span>
            <span className="tabular inline-flex items-center gap-1">
              <Users className="size-3.5" /> {formatNumber(venue.capacity)} people
            </span>
          </div>
        )}
        <p className="eyebrow mt-5">What happens next</p>
        <ol className="mt-2.5 grid gap-2.5">
          {['The administrator reviews your request.', "You'll see the decision under My bookings.", 'Once approved, download your confirmation.'].map((t, i) => (
            <li key={t} className="flex gap-2.5 text-[13px] leading-5 text-ink">
              <span className="tabular grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <p className="mt-5 flex items-start gap-2 rounded-[10px] bg-surface-muted px-3 py-2.5 text-[12.5px] text-muted">
          <Clock className="mt-px size-3.5 shrink-0" />
          <span>
            Bookable {open}–{close}, in {formatDuration(step)} steps. Times are campus time ({settings!.campusTimezone}).
          </span>
        </p>
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <details className="card group lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">Venue &amp; next steps{venue ? ` · ${venue.name}` : ''}</span>
          <span className="text-[12px] font-semibold text-primary group-open:hidden">Show</span>
          <span className="hidden text-[12px] font-semibold text-primary group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-border p-3">{summary}</div>
      </details>

      <form onSubmit={onSubmit} noValidate className="card relative grid gap-5 p-5 md:p-6 lg:col-span-7">
        <div>
          <h2 className="font-display text-[17px] font-semibold text-ink">{mode === 'create' ? 'Request a booking' : 'Your booking'}</h2>
          <p className="mt-0.5 text-[13px] text-muted">Fields marked optional can be left empty.</p>
        </div>

        {serverAlert && (
          <Alert variant={serverAlert.variant} title={serverAlert.title} action={serverAlert.action}>
            {serverAlert.body}
          </Alert>
        )}

        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold text-ink">Requested by</span>
          <div className="flex items-center gap-3 rounded-[12px] bg-surface-muted px-3.5 py-3">
            <UserAvatar name={me.fullName} role={me.role} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{me.fullName}</p>
              <p className="truncate text-[12.5px] text-muted">{me.email}</p>
            </div>
            <div className="hidden sm:block">
              <RoleBadge role={me.role} />
            </div>
            <Link to="/profile" className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline" aria-label={`Edit profile (${ROLE_LABELS[me.role]})`}>
              Edit profile
            </Link>
          </div>
        </div>

        <Field
          label="Venue"
          error={errors.venueId?.message}
          labelAction={
            venueLocked && allowChangeVenue ? (
              <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setVenueLocked(false)}>
                Change
              </button>
            ) : undefined
          }
        >
          {(p) =>
            venueLocked && venue ? (
              <div id={p.id} className="flex h-11 items-center gap-2 rounded-[10px] border border-border bg-surface-muted px-3 text-sm font-semibold text-ink md:h-10">
                <MapPin className="size-4 text-muted" /> <span className="truncate">{venue.name}</span>
                <span className="ml-auto truncate text-[12.5px] font-normal text-muted">{venue.building}</span>
              </div>
            ) : (
              <VenueCombobox
                {...p}
                invalid={!!p['aria-invalid']}
                describedBy={p['aria-describedby']}
                value={venue}
                onChange={(v) => {
                  setVenue(v);
                  form.setValue('venueId', v.id, { shouldDirty: true, shouldValidate: true });
                  setServerAlert(null);
                }}
              />
            )
          }
        </Field>

        <Field label="Date" error={errors.date?.message}>
          {(p) => (
            <Controller
              control={form.control}
              name="date"
              render={({ field }) => (
                <DatePicker
                  id={p.id}
                  invalid={!!p['aria-invalid']}
                  describedBy={p['aria-describedby']}
                  value={field.value || null}
                  onChange={(d) => {
                    field.onChange(d);
                    setServerAlert(null);
                  }}
                  min={now.date}
                  max={addDays(now.date, rules.maxAdvanceDays)}
                />
              )}
            />
          )}
        </Field>

        <fieldset className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <legend className="text-[13px] font-semibold text-ink">Time</legend>
            <Tooltip content={fullDayReason}>
              <span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!!fullDayReason}
                  onClick={() => {
                    form.setValue('startTime', open, { shouldDirty: true });
                    form.setValue('endTime', close, { shouldDirty: true, shouldValidate: true });
                  }}
                >
                  <Sun className="size-4" /> Full day
                </Button>
              </span>
            </Tooltip>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <TimeSelect
              aria-label="Start time"
              placeholder="Start"
              value={startTime}
              onChange={(v) => setTime('startTime', v)}
              open={open}
              close={close}
              step={step}
              isDisabled={startDisabled}
              invalid={!!errors.startTime}
            />
            <TimeSelect
              aria-label="End time"
              placeholder="End"
              value={endTime}
              onChange={(v) => setTime('endTime', v)}
              open={open}
              close={close}
              step={step}
              isDisabled={endDisabled}
              invalid={!!errors.endTime}
            />
          </div>
          <div className="flex min-h-5 flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className="tabular text-muted">{duration !== null ? `Duration: ${formatDuration(duration)}` : `Between ${formatDuration(minD)} and ${formatDuration(maxD)}`}</span>
          </div>
          <div aria-live="polite">
            {timeError && (
              <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-destructive-text">
                <CircleX className="mt-px size-3.5 shrink-0" /> {timeError}
              </p>
            )}
          </div>
          {venue && date && (
            <div className="mt-1 grid gap-2 rounded-[12px] border border-border p-3">
              <DayAvailabilityBar
                date={date}
                open={open}
                close={close}
                intervals={others}
                selection={startTime && endTime && timeToMinutes(endTime) > timeToMinutes(startTime) ? { start: startTime, end: endTime } : null}
                conflict={hardConflict}
              />
              <AvailabilityLegend className="text-[11.5px]" />
            </div>
          )}
          <div aria-live="polite" className="min-h-5 text-[13px]">
            {live}
          </div>
        </fieldset>

        <Field
          label="Purpose of booking"
          error={errors.purpose?.message}
          labelAction={<span className={cn('tabular text-[12px]', purposeLen > 500 ? 'font-semibold text-destructive-text' : 'text-subtle')}>{purposeLen}/500</span>}
        >
          {(p) => <Textarea {...p} rows={3} autoGrow maxRows={6} maxLength={500} placeholder="e.g. Department seminar" {...form.register('purpose')} />}
        </Field>

        <Field label="Approximate attendees" optional error={errors.expectedAttendees?.message} hint={venue ? `Venue capacity: ${formatNumber(venue.capacity)}` : undefined}>
          {(p) => (
            <Controller
              control={form.control}
              name="expectedAttendees"
              render={({ field }) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  className="tabular sm:max-w-[200px]"
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    field.onChange(digits ? Number(digits) : null);
                  }}
                />
              )}
            />
          )}
        </Field>

        <div className="-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-[14px] border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-end md:-mx-6 md:-mb-6 md:px-6 max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:safe-bottom">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            {mode === 'create' ? 'Cancel' : 'Discard'}
          </Button>
          <Button type="submit" size="lg" loading={isSubmitting} disabled={hardConflict || (mode === 'edit' && !isDirty)}>
            {mode === 'create' ? <Send /> : <CalendarCheck2 />}
            {mode === 'create' ? 'Submit request' : 'Save changes'}
          </Button>
        </div>
      </form>

      <aside className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-[88px] grid gap-4">
          {summary}
          {mode === 'edit' && (
            <p className="flex gap-2 px-1 text-[12.5px] leading-5 text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> The venue can't be changed. To move venues, cancel this booking and book again.
            </p>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard changes?"
        description="Your edits will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      />
      <ConfirmDialog
        open={changedDialog}
        onOpenChange={setChangedDialog}
        title="This booking was updated"
        description="This booking was updated while you were editing. Review the latest details and try again."
        confirmLabel="Reload"
        hideCancel
        onConfirm={async () => {
          // The edit page keys the form by version, so fresh data resets it.
          await qc.refetchQueries({ queryKey: ['booking', booking?.id] });
          setServerAlert(null);
        }}
      />
    </div>
  );
}
