// U10 / U15 booking form. Local rules first, then a debounced non-binding server check (E10),
// then the authoritative submit (E11/E14) with every documented error mapped to a field or alert.
import * as React from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CircleCheck, CircleX, Clock, Info, ListOrdered, MapPin, Sun, TriangleAlert, Users } from 'lucide-react';
import {
  MAX_BOOKING_DAYS,
  ROLE_LABELS,
  addDays,
  bookingDays,
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
import { Alert, Switch } from '@/components/ui/controls';
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
import { buildBookingFormSchema, formEndDate, type BookingFormValues } from './lib/booking-form-schema';
import { formatBookingDates, formatNumber, formatShortDay } from '@/lib/format';
import { VenueCombobox } from './venue-combobox';
import { useBookingPaths } from './paths';

type ServerAlert = { variant: 'error' | 'warning'; title: string; body?: React.ReactNode; action?: React.ReactNode } | null;

/** "10:00–12:00 · Booked"; multi-day requests prefix the day ("Wed 20 Nov 10:00–12:00 · Booked"). */
function intervalText(i: AvailabilityInterval, withDay = false) {
  const kind = i.isMine ? (i.kind === 'queued' ? 'Your queued request' : 'Your booking') : i.kind === 'booked' ? 'Booked' : i.label;
  const day = withDay ? `${formatShortDay(i.start.slice(0, 10))} ` : '';
  return `${day}${i.start.slice(11, 16)}–${i.end.slice(11, 16)} · ${kind}`;
}

/** Every date from a to b inclusive. */
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b && out.length < MAX_BOOKING_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

const ID_PLACEHOLDER: Record<string, string> = { student: 'e.g. 1RV22CS045', faculty_staff: 'e.g. FAC-1024', department_staff: 'e.g. STF-0042' };

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
  const paths = useBookingPaths();
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
  const [date, multiDay, endDateValue, startTime, endTime, purpose] = form.watch(['date', 'multiDay', 'endDate', 'startTime', 'endTime', 'purpose']);
  // The effective last day (undefined = one day) and the number of days booked.
  const endDate = formEndDate({ date, multiDay, endDate: endDateValue });
  const lastDay = endDate ?? date;
  const days = date ? bookingDays(date, endDate) : 1;

  const create = useCreateBooking();
  const update = useUpdateBooking(booking?.id ?? '');

  // Availability for the chosen day(s) (the bars) and the debounced live check.
  const avail = useAvailability(venue?.id, date || undefined, lastDay || undefined);
  const others = (avail.data?.intervals ?? []).filter((i) => !(booking && i.bookingId === booking.id));
  const localViolations =
    rules && now && date && startTime && endTime ? collectSlotViolations({ date, endDate, startTime, endTime }, rules, now.localDateTime) : [];
  const multiDayIncomplete = multiDay && !endDate;
  const slot =
    venue && date && startTime && endTime && localViolations.length === 0 && !multiDayIncomplete
      ? { date, ...(endDate ? { endDate } : {}), startTime, endTime, ...(booking ? { excludeBookingId: booking.id } : {}) }
      : null;
  const debouncedSlot = useDebouncedValue(slot, 400);
  const sameSlot = JSON.stringify(slot) === JSON.stringify(debouncedSlot);
  const check = useAvailabilityCheck(venue?.id, debouncedSlot);
  // A booked time only queues the request; blocks, rule violations and (when editing a confirmed booking) a booked
  // time stop it.
  const hardConflict = !!slot && sameSlot && !!check.data && check.data.outcome === 'unavailable';
  const willQueue = !!slot && sameSlot && check.data?.outcome === 'queue';

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
  const fullDayBusy = date && others.some((i) => i.start.slice(0, 10) <= lastDay && i.end.slice(0, 10) >= date);
  /** Latest last day for a booking starting on d: MAX_BOOKING_DAYS in all, inside the advance window. */
  const maxEndFor = (d: string) => {
    const a = addDays(d, MAX_BOOKING_DAYS - 1);
    const b = addDays(now.date, rules.maxAdvanceDays);
    return a < b ? a : b;
  };
  const revalidateEnd = () => form.formState.isSubmitted || !!errors.endDate;
  const setMultiDay = (on: boolean) => {
    form.setValue('multiDay', on, { shouldDirty: true });
    if (!on) form.setValue('endDate', '', { shouldDirty: true });
    else if (date && !endDateValue) {
      const next = addDays(date, 1);
      if (next <= maxEndFor(date)) form.setValue('endDate', next, { shouldDirty: true });
    }
    form.clearErrors('endDate');
    setServerAlert(null);
  };
  /** Moving the first day keeps the number of days (clamped to the limits). */
  const onStartDate = (d: string, change: (v: string) => void) => {
    const span = endDate ? days - 1 : multiDay ? 1 : 0;
    change(d);
    if (multiDay && d) {
      const next = addDays(d, span);
      const max = maxEndFor(d);
      form.setValue('endDate', next > max ? max : next, { shouldDirty: true, shouldValidate: revalidateEnd() });
    }
    setServerAlert(null);
  };
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
                  {intervalText(c, days > 1)}
                  {c.isMine && c.bookingId && (
                    <Link to={paths.detail(c.bookingId)} className="ml-2 font-semibold underline">
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
              <Link to={paths.venues}>Browse venues</Link>
            </Button>
          ),
        });
      case 'BOOKING_LIMIT_REACHED':
        return setServerAlert({
          variant: 'warning',
          title: err.message,
          action: (
            <Button size="sm" variant="outline" asChild>
              <Link to={paths.list}>My bookings</Link>
            </Button>
          ),
        });
      case 'DUPLICATE_BOOKING':
        return setServerAlert({
          variant: 'warning',
          title: err.message,
          action: d.bookingId ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={paths.detail(d.bookingId)}>View it</Link>
            </Button>
          ) : undefined,
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
          const { multiDay: _multi, endDate: _end, ...rest } = v;
          const end = formEndDate(v);
          const b = await create.mutateAsync({
            input: { ...rest, ...(end ? { endDate: end } : {}), expectedAttendees: v.expectedAttendees ?? null },
            idempotencyKey: idempotencyKey.current,
          });
          idempotencyKey.current = crypto.randomUUID();
          setDone(true);
          navigate(paths.submitted(b.id), { replace: true });
        } else if (booking) {
          const body: Record<string, unknown> = { version: booking.version };
          for (const k of ['date', 'startTime', 'endTime', 'purpose', 'expectedAttendees', 'idNumber'] as const) {
            if (dirtyFields[k] && v[k] !== initial[k]) body[k] = v[k];
          }
          // The last day is always explicit when it moves (turning multi-day off books just the first day).
          const nextEnd = formEndDate(v) ?? v.date;
          if (nextEnd !== (formEndDate(initial) ?? initial.date)) body.endDate = nextEnd;
          const b = await update.mutateAsync(body);
          setDone(true);
          toast.success(
            booking.status === 'queued' && b.status === 'confirmed'
              ? 'Moved to a free time: your booking is confirmed.'
              : b.status === 'queued' && (body.date || body.endDate || body.startTime || body.endTime)
                ? `Booking updated. You're #${b.queuePosition ?? '?'} in the queue for the new time.`
                : 'Booking updated.',
          );
          navigate(paths.detail(booking.id), { replace: true });
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
    const multi = days > 1;
    const list = (xs: AvailabilityInterval[]) => xs.map((x) => intervalText(x, multi)).join(', ');
    if (c.outcome === 'confirm')
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-success-text">
          <CircleCheck className="size-4" /> {multi ? `Free on all ${days} days: it will be confirmed instantly` : 'This time is free: it will be confirmed instantly'}
        </span>
      );
    if (c.outcome === 'queue')
      return (
        <span className="inline-flex items-start gap-1.5 font-semibold text-warning-text">
          <ListOrdered className="mt-px size-4 shrink-0" />
          <span>
            {multi
              ? `Already booked on some days (${list(c.conflicts)}). The whole booking joins the queue as #${c.queuePosition ?? 1}, and is confirmed automatically once every day is free.`
              : `Already booked (${list(c.conflicts)}). You'll join the queue as #${c.queuePosition ?? 1}, and get the slot automatically if it frees up.`}
          </span>
        </span>
      );
    const blocked = c.conflicts.filter((x) => x.kind === 'blocked');
    if (blocked.length)
      return (
        <span className="inline-flex items-start gap-1.5 font-semibold text-destructive-text">
          <CircleX className="mt-px size-4 shrink-0" /> Unavailable: {list(blocked)}
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
        <p className="eyebrow mt-5">How booking works</p>
        <ol className="mt-2.5 grid gap-2.5">
          {[
            'A free time is confirmed instantly: no approval needed.',
            "A booked time puts you in the queue, first come, first served. If it frees up, it's yours automatically.",
            'Cancel any time from My bookings; the next person in the queue gets the slot.',
            `Need several days in a row? Turn on "Multiple days" to book the same time on up to ${MAX_BOOKING_DAYS} consecutive days at once.`,
          ].map((t, i) => (
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
          <h2 className="font-display text-[17px] font-semibold text-ink">{mode === 'create' ? 'Booking details' : 'Your booking'}</h2>
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
            <Link to={paths.profile} className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline" aria-label={`Edit profile (${ROLE_LABELS[me.role]})`}>
              Edit profile
            </Link>
          </div>
        </div>

        <Field
          label="USN / Faculty ID"
          error={errors.idNumber?.message}
          hint={me.role === 'student' ? 'Your university seat number (USN).' : 'Your faculty or staff ID number.'}
        >
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              placeholder={ID_PLACEHOLDER[me.role] ?? 'e.g. 1RV22CS045'}
              className="font-mono uppercase placeholder:normal-case sm:max-w-[260px]"
              {...form.register('idNumber')}
            />
          )}
        </Field>

        <Field
          label="Venue"
          error={errors.venueId?.message}
          labelAction={
            venueLocked && allowChangeVenue ? (
              <button type="button" className="-my-1 min-h-6 px-1 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setVenueLocked(false)}>
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

        <div className="grid gap-2">
          <div className={cn('grid gap-4', multiDay && 'sm:grid-cols-2')}>
            <Field
              label={multiDay ? 'First day' : 'Date'}
              error={errors.date?.message}
              labelAction={
                <label className="-my-1 flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink sm:hidden">
                  <Switch checked={multiDay} onCheckedChange={setMultiDay} aria-label="Multiple days" /> Multiple days
                </label>
              }
            >
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
                      onChange={(d) => onStartDate(d ?? '', field.onChange)}
                      min={now.date}
                      max={addDays(now.date, rules.maxAdvanceDays)}
                    />
                  )}
                />
              )}
            </Field>
            {multiDay && (
              <Field label="Last day" error={errors.endDate?.message}>
                {(p) => (
                  <Controller
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <DatePicker
                        id={p.id}
                        invalid={!!p['aria-invalid']}
                        describedBy={p['aria-describedby']}
                        value={field.value || null}
                        onChange={(d) => {
                          field.onChange(d ?? '');
                          setServerAlert(null);
                        }}
                        min={date ? addDays(date, 1) : now.date}
                        max={maxEndFor(date || now.date)}
                      />
                    )}
                  />
                )}
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label className="hidden cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink sm:flex">
              <Switch checked={multiDay} onCheckedChange={setMultiDay} aria-label="Multiple days" /> Multiple days
            </label>
            <p className="text-[12.5px] text-muted">
              {multiDay
                ? endDate
                  ? `${days} days · ${formatBookingDates({ date, endDate })}. The same time is booked on every day, all together.`
                  : `Up to ${MAX_BOOKING_DAYS} consecutive days, same time each day.`
                : 'Turn on Multiple days to book consecutive days.'}
            </p>
          </div>
        </div>

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
            <span className="tabular text-muted">
              {duration !== null
                ? `Duration: ${formatDuration(duration)}${days > 1 ? ` each day · ${days} days` : ''}`
                : `Between ${formatDuration(minD)} and ${formatDuration(maxD)}${multiDay ? ' each day' : ''}`}
            </span>
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
              {days > 1 ? (
                <ul className="grid gap-1.5" aria-label="Availability by day">
                  {daysBetween(date, lastDay).map((d) => (
                    <li key={d} className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
                      <span className="tabular text-[12px] font-semibold text-muted">{formatShortDay(d)}</span>
                      <DayAvailabilityBar
                        date={d}
                        open={open}
                        close={close}
                        intervals={others}
                        selection={startTime && endTime && timeToMinutes(endTime) > timeToMinutes(startTime) ? { start: startTime, end: endTime } : null}
                        conflict={hardConflict}
                        compact
                        showTicks={false}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <DayAvailabilityBar
                  date={date}
                  open={open}
                  close={close}
                  intervals={others}
                  selection={startTime && endTime && timeToMinutes(endTime) > timeToMinutes(startTime) ? { start: startTime, end: endTime } : null}
                  conflict={hardConflict}
                />
              )}
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

        {/* One row at every width: a stacked pair took ~130 px of a 568 px phone screen and hid the field being edited. */}
        <div className="-mx-5 -mb-5 flex gap-2 rounded-b-[14px] border-t border-border bg-surface px-5 py-3 sm:justify-end sm:py-4 md:-mx-6 md:-mb-6 md:px-6 max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:safe-bottom">
          <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)}>
            {mode === 'create' ? 'Cancel' : 'Discard'}
          </Button>
          <Button type="submit" size="lg" className="flex-1 sm:flex-none" loading={isSubmitting} disabled={hardConflict || (mode === 'edit' && !isDirty)}>
            {mode === 'create' && willQueue ? <ListOrdered /> : <CalendarCheck2 />}
            {mode === 'create' ? (willQueue ? 'Join the queue' : 'Book now') : 'Save changes'}
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
