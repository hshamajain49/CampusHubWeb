import * as React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { diffDays, type AdminBookingListItem } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { formatDuration, formatLongDate, formatTimeRange, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/form-field';
import { RoleBadge } from '@/components/common/badges';
import { invalidateBookingViews, useDecision } from '../api';

export type DecisionMode = 'approve' | 'reject' | 'cancel';

export function StartsInChip({ date, today, className }: { date: string; today?: string; className?: string }) {
  if (!today) return null;
  const n = diffDays(date, today);
  const label = n <= 0 ? 'Starts today' : n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
  return (
    <span
      className={cn(
        'chip tabular inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold',
        n <= 1 ? 'bg-warning-soft text-warning-text' : n <= 7 ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-muted',
        className,
      )}
    >
      {label}
    </span>
  );
}

function Summary({ b }: { b: AdminBookingListItem }) {
  const rows = [
    ['Venue', b.venue.name],
    ['When', `${formatLongDate(b.date)} · ${formatTimeRange(b.startTime, b.endTime)} (${formatDuration(b.durationMinutes)})`],
    ['Attendees', b.expectedAttendees ? `${formatNumber(b.expectedAttendees)} of ${formatNumber(b.venue.capacity)}` : `Not specified (capacity ${formatNumber(b.venue.capacity)})`],
  ];
  return (
    <div className="rounded-[12px] bg-surface-muted p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{b.requester.fullName}</span>
        <RoleBadge role={b.requester.role} />
      </div>
      <dl className="grid gap-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 line-clamp-3 text-[13px] text-ink">{b.purpose}</p>
    </div>
  );
}

const RACE_MESSAGES: Record<string, (e: ApiError) => string> = {
  INVALID_STATUS_TRANSITION: (e) => e.message,
  BOOKING_CHANGED: () => 'The requester changed this booking. Review the updated details.',
  BOOKING_IN_PAST: () => "This request's start time has passed; it can only be rejected.",
  VENUE_INACTIVE: () => 'The venue is inactive. Reactivate it before approving.',
  REQUESTER_INACTIVE: () => "The requester's account is deactivated.",
};

export function DecisionDialog({
  booking,
  mode,
  onClose,
  onDone,
}: {
  booking: AdminBookingListItem | null;
  mode: DecisionMode | null;
  onClose: () => void;
  onDone?: (mode: DecisionMode) => void;
}) {
  const [text, setText] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const qc = useQueryClient();
  const d = useDecision();
  React.useEffect(() => {
    setText('');
    setTouched(false);
  }, [booking?.id, mode]);
  if (!booking || !mode) return null;

  const reasonRequired = mode !== 'approve';
  const reasonError = reasonRequired && touched && text.trim().length < 3 ? 'Please provide a reason' : undefined;

  const confirm = async () => {
    if (reasonRequired && text.trim().length < 3) {
      setTouched(true);
      throw new Error('Please provide a reason');
    }
    try {
      if (mode === 'approve') await d.approve.mutateAsync({ id: booking.id, body: { version: booking.version, ...(text.trim() ? { note: text.trim() } : {}) } });
      if (mode === 'reject') await d.reject.mutateAsync({ id: booking.id, body: { version: booking.version, reason: text.trim() } });
      if (mode === 'cancel') await d.cancel.mutateAsync({ id: booking.id, body: { version: booking.version, reason: text.trim() } });
      toast.success(mode === 'approve' ? 'Booking approved.' : mode === 'reject' ? 'Booking rejected.' : 'Booking cancelled.');
      onDone?.(mode);
    } catch (e) {
      if (e instanceof ApiError && RACE_MESSAGES[e.code]) {
        toast.error(RACE_MESSAGES[e.code]!(e));
        invalidateBookingViews(qc, booking);
        return; // close: the queue refreshes with the current state
      }
      throw e;
    }
  };

  const common = { open: true, onOpenChange: (o: boolean) => !o && onClose(), onConfirm: confirm, size: 'lg' as const };

  if (mode === 'approve') {
    return (
      <ConfirmDialog {...common} title={`Approve booking ${booking.reference}?`} confirmLabel="Approve">
        <Summary b={booking} />
        <Field label="Note to requester" optional hint={`Shown on their booking page and timeline · ${text.length}/500`}>
          {(p) => <Textarea {...p} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Please collect the keys from the admin office." />}
        </Field>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      {...common}
      destructive
      title={mode === 'reject' ? 'Reject booking' : 'Cancel this approved booking?'}
      description={`${booking.requester.fullName} will see this reason.`}
      confirmLabel={mode === 'reject' ? 'Reject' : 'Cancel booking'}
      cancelLabel={mode === 'reject' ? 'Cancel' : 'Keep booking'}
    >
      <Summary b={booking} />
      <Field label={mode === 'reject' ? 'Reason for rejection (required)' : 'Reason (required)'} error={reasonError} hint={`${text.length}/500`}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={500}
            value={text}
            onBlur={() => setTouched(true)}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'reject' ? 'e.g. The hall is reserved for examinations that week.' : 'e.g. Emergency maintenance in the hall.'}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
