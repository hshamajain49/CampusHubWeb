// Event → notification matrix (§10.18, docs/BOOKINGS.md). Pure: unit-tested without a database.
import type { BookingStatus, NotificationType } from '@campushub/shared';
import { dayMonth, relativeDay, timeRange, truncate, weekdayDayMonth } from '../../lib/format.js';

export type DomainEventType =
  | 'booking.confirmed'
  | 'booking.queued'
  | 'booking.promoted'
  | 'booking.modified'
  | 'booking.cancelled'
  | 'booking.expired'
  | 'booking.reminder';

export interface DomainEvent {
  type: DomainEventType;
  bookingId: string;
  actorId: string | null;
  data?: {
    cancelledBy?: 'requester' | 'admin' | 'system';
    previousStatus?: BookingStatus;
    /** booking.queued: the place taken in the queue. */
    queuePosition?: number | null;
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
  status: BookingStatus;
}

export interface NotificationPlan {
  audience: 'requester' | 'admins';
  type: NotificationType;
  title: string;
  body: string;
  email: boolean;
  push: boolean;
  /** Also notify the member who caused the event (their own booking confirmation, kept in the bell and inbox). */
  includeActor?: boolean;
}

/**
 * Admins approve nothing any more: every new booking and every change reaches them in-app only (no email or push),
 * so they keep the details without being asked to act.
 */
export function planNotifications(e: DomainEvent, b: EventBooking, today: string): NotificationPlan[] {
  const time = timeRange(b.startTime, b.endTime);
  const day = dayMonth(b.date);
  const reason = e.data?.note ? truncate(e.data.note, 300) : '';
  const fit = (p: NotificationPlan): NotificationPlan => ({ ...p, title: truncate(p.title, 120), body: truncate(p.body, 500) });
  const plan = (...ps: NotificationPlan[]) => ps.map(fit);
  const adminNotice = (title: string, body: string): NotificationPlan => ({
    audience: 'admins',
    type: 'admin_new_booking',
    title,
    body,
    email: false,
    push: false,
  });

  switch (e.type) {
    case 'booking.confirmed':
      return plan(
        {
          audience: 'requester',
          type: 'booking_confirmed',
          title: 'Booking confirmed',
          body: `${b.venueName} · ${weekdayDayMonth(b.date)} · ${time}. Reference ${b.reference}.`,
          email: true,
          push: false,
          includeActor: true,
        },
        adminNotice('New booking', `${b.requesterName} booked ${b.venueName} on ${day} · ${time} (confirmed).`),
      );
    case 'booking.queued': {
      const pos = e.data?.queuePosition;
      return plan(
        {
          audience: 'requester',
          type: 'booking_queued',
          title: pos ? `You're #${pos} in the queue` : "You're in the queue",
          body: `${b.venueName} · ${weekdayDayMonth(b.date)} · ${time} is taken. If it frees up, the slot is yours automatically and we'll let you know.`,
          email: true,
          push: false,
          includeActor: true,
        },
        adminNotice('New booking (queued)', `${b.requesterName} joined the queue for ${b.venueName} on ${day} · ${time}${pos ? ` (#${pos})` : ''}.`),
      );
    }
    case 'booking.promoted':
      return plan({
        audience: 'requester',
        type: 'booking_promoted',
        title: 'Good news: your booking is confirmed',
        body: `The slot you queued for freed up. ${b.venueName} · ${weekdayDayMonth(b.date)} · ${time} is now yours.`,
        email: true,
        push: true,
      });
    case 'booking.modified':
      return plan({
        audience: 'admins',
        type: 'admin_request_modified',
        title: 'Booking changed',
        body: `${b.requesterName} changed ${b.reference} (${b.venueName}, ${day} · ${time}${b.status === 'queued' ? ', in queue' : ''}).`,
        email: false,
        push: false,
      });
    case 'booking.cancelled':
      if (e.data?.cancelledBy === 'requester') {
        if (e.data.previousStatus !== 'confirmed') return []; // a queued request freed nothing: realtime hint only
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
        title: e.data?.previousStatus === 'queued' ? 'Queued request cancelled by the administrator' : 'Booking cancelled by the administrator',
        body: `${b.venueName} · ${day} · ${time}.${reason ? ` Reason: ${reason}` : ''}`,
        email: true,
        push: true,
      });
    case 'booking.expired':
      return plan({
        audience: 'requester',
        type: 'booking_expired',
        title: "Queued slot didn't free up",
        body: `${b.venueName} on ${day} · ${time} stayed booked, so your queued request has expired.`,
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
