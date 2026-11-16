// Admin cancel (E23). Bookings need no approval (docs/BOOKINGS.md): cancelling is the one admin action, and a freed
// slot goes to the next request in the queue automatically.
import * as React from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { diffDays, type AdminBookingListItem } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';

import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/form-field';
import { RoleBadge, StatusBadge } from '@/components/common/badges';
import { invalidateBookingViews, useAdminCancel } from '../api';
import { formatBookingWhen, formatDuration, formatNumber } from '@/lib/format';

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
    ['When', `${formatBookingWhen(b)} (${formatDuration(b.durationMinutes)}${b.days > 1 ? ' a day' : ''})`],
    ['Attendees', b.expectedAttendees ? `${formatNumber(b.expectedAttendees)} of ${formatNumber(b.venue.capacity)}` : `Not specified (capacity ${formatNumber(b.venue.capacity)})`],
    ...(b.idNumber ? [['ID', b.idNumber]] : []),
  ];
  return (
    <div className="rounded-[12px] bg-surface-muted p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{b.requester.fullName}</span>
        <RoleBadge role={b.requester.role} />
        <StatusBadge status={b.status} queuePosition={b.queuePosition} size="sm" />
      </div>
      <dl className="grid gap-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular break-words text-ink">{v}</dd>
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
  CANCELLATION_WINDOW_CLOSED: (e) => e.message,
};

/** Opens while `booking` is set. */
export function CancelBookingDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: AdminBookingListItem | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [text, setText] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const qc = useQueryClient();
  const cancel = useAdminCancel();
  React.useEffect(() => {
    setText('');
    setTouched(false);
  }, [booking?.id]);
  if (!booking) return null;

  const queued = booking.status === 'queued';
  const reasonError = touched && text.trim().length < 3 ? 'Please provide a reason' : undefined;

  const confirm = async () => {
    if (text.trim().length < 3) {
      setTouched(true);
      throw new Error('Please provide a reason');
    }
    try {
      await cancel.mutateAsync({ id: booking.id, body: { version: booking.version, reason: text.trim() } });
      toast.success(queued ? 'Queued request cancelled.' : 'Booking cancelled. The slot went to the next request in the queue, if any.');
      onDone?.();
    } catch (e) {
      if (e instanceof ApiError && RACE_MESSAGES[e.code]) {
        toast.error(RACE_MESSAGES[e.code]!(e));
        invalidateBookingViews(qc, booking);
        return; // close: the list refreshes with the current state
      }
      throw e;
    }
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      onConfirm={confirm}
      size="lg"
      destructive
      title={queued ? 'Cancel this queued request?' : 'Cancel this booking?'}
      description={
        queued
          ? `${booking.requester.fullName} leaves the queue and will see this reason.`
          : `${booking.requester.fullName} will see this reason. If anyone queued for this time, the first in line gets the slot automatically.`
      }
      confirmLabel={queued ? 'Cancel request' : 'Cancel booking'}
      cancelLabel="Keep it"
    >
      <Summary b={booking} />
      <Field label="Reason (required)" error={reasonError} hint={`${text.length}/500`}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={500}
            value={text}
            onBlur={() => setTouched(true)}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Emergency maintenance in the hall."
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
