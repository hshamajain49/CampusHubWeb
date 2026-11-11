// Event → notification matrix (§10.18). Pure: unit-tested without a database.
import type { NotificationType } from '@campushub/shared';
import { dayMonth, relativeDay, timeRange, truncate, weekdayDayMonth } from '../../lib/format.js';

export type DomainEventType =
  | 'booking.submitted'
  | 'booking.modified'
  | 'booking.approved'
  | 'booking.rejected'
  | 'booking.cancelled'
  | 'booking.expired'
  | 'booking.reminder';

export interface DomainEvent {
  type: DomainEventType;
  bookingId: string;
  actorId: string | null;
  data?: {
    returnedToPending?: boolean;
    cancelledBy?: 'requester' | 'admin' | 'system';
    previousStatus?: 'pending' | 'approved';
    note?: string | null;
  };
}

export interface EventBooking {
  id: string;
  reference: string;
  venueName: string;
  requesterName: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface NotificationPlan {
  audience: 'requester' | 'admins';
  type: NotificationType;
  title: string;
  body: string;
  email: boolean;
  push: boolean;
}

export function planNotifications(e: DomainEvent, b: EventBooking, today: string): NotificationPlan[] {
  const time = timeRange(b.startTime, b.endTime);
  const day = dayMonth(b.date);
  const reason = e.data?.note ? truncate(e.data.note, 300) : '';
  const plan = (p: NotificationPlan) => [{ ...p, title: truncate(p.title, 120), body: truncate(p.body, 500) }];

  switch (e.type) {
    case 'booking.submitted':
      return plan({
        audience: 'admins',
        type: 'admin_new_request',
        title: 'New booking request',
        body: `${b.requesterName} requested ${b.venueName} on ${day} · ${time}.`,
        email: true,
        push: true,
      });
    case 'booking.modified':
      if (e.data?.returnedToPending)
        return plan({
          audience: 'admins',
          type: 'admin_request_modified',
          title: 'Approved booking changed',
          body: `${b.requesterName} changed ${b.reference}. It needs your approval again.`,
          email: true,
          push: true,
        });
      if (e.data?.previousStatus === 'pending')
        return plan({
          audience: 'admins',
          type: 'admin_request_modified',
          title: 'Booking request updated',
          body: `${b.requesterName} updated ${b.reference} (${b.venueName}, ${day} · ${time}).`,
          email: false,
          push: true,
        });
      return [];
    case 'booking.cancelled':
      if (e.data?.cancelledBy === 'requester') {
        if (e.data.previousStatus !== 'approved') return []; // realtime hint only
        return plan({
          audience: 'admins',
          type: 'admin_booking_cancelled',
          title: 'Booking cancelled by requester',
          body: `${b.requesterName} cancelled ${b.reference} (${b.venueName}, ${day} · ${time}).`,
          email: false,
          push: false,
        });
      }
      return plan({
        audience: 'requester',
        type: 'booking_cancelled',
        title: 'Booking cancelled by the administrator',
        body: `${b.venueName} · ${day} · ${time}.${reason ? ` Reason: ${reason}` : ''}`,
        email: true,
        push: true,
      });
    case 'booking.approved':
      return plan({
        audience: 'requester',
        type: 'booking_approved',
        title: 'Booking approved',
        body: `${b.venueName} · ${weekdayDayMonth(b.date)} · ${time}.${reason ? ` Note: ${reason}` : ''}`,
        email: true,
        push: true,
      });
    case 'booking.rejected':
      return plan({
        audience: 'requester',
        type: 'booking_rejected',
        title: 'Booking request rejected',
        body: `${b.venueName} · ${day} · ${time}. Reason: ${reason || 'Not specified'}`,
        email: true,
        push: true,
      });
    case 'booking.expired':
      return plan({
        audience: 'requester',
        type: 'booking_expired',
        title: 'Booking request expired',
        body: `Your request for ${b.venueName} on ${day} · ${time} wasn't reviewed before it started.`,
        email: true,
        push: true,
      });
    case 'booking.reminder': {
      const rel = relativeDay(b.date, today);
      const when = rel.startsWith('on ') ? rel.slice(3) : rel;
      return plan({
        audience: 'requester',
        type: 'booking_reminder',
        title: 'Upcoming booking',
        body: `${b.venueName} · ${when} at ${b.startTime}. Reference ${b.reference}.`,
        email: true,
        push: true,
      });
    }
  }
}
