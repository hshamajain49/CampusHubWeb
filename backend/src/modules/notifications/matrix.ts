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

/** What happened to a cancelled booking's time. */
export type SlotOutcome = 'queue' | 'free' | 'unavailable' | 'left_queue';

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
    /** booking.cancelled: whether the time went to the queue, is free again, is blocked, or a queued request left. */
    slot?: SlotOutcome;
  };
}

export interface EventBooking {
  id: string;
  reference: string;
  venueName: string;
  requesterName: string;
  date: string;
  /** Last day (= date for a single day). */
  endDate?: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
}

export interface NotificationPlan {
  /** everyone = every active member except the booker (venue bookings only, never complaints); in-app only. */
  audience: 'requester' | 'admins' | 'everyone';
  type: NotificationType;
  title: string;
  body: string;
  email: boolean;
  push: boolean;
  /** Also notify the member who caused the event (their own booking confirmation, kept in the bell and inbox). */
  includeActor?: boolean;
}

/** "Thu 19 Nov · 10:00–12:00" or, for several days, "19 Nov – 21 Nov · 10:00–12:00 daily". */
export function whenText(b: Pick<EventBooking, 'date' | 'endDate' | 'startTime' | 'endTime'>, weekday = true): string {
  const time = timeRange(b.startTime, b.endTime);
  if (b.endDate && b.endDate !== b.date) return `${dayMonth(b.date)} – ${dayMonth(b.endDate)} · ${time} daily`;
  return `${weekday ? weekdayDayMonth(b.date) : dayMonth(b.date)} · ${time}`;
}

const AVAILABILITY: Record<SlotOutcome, string> = {
  free: 'The time is available again: anyone can book it.',
  queue: 'The time went to the next person in the queue.',
  unavailable: 'The venue is unavailable at that time.',
  left_queue: 'You left the queue for this time.',
};

/**
 * Admins approve nothing: every new booking and every change reaches them in-app only (no email or push), so they keep
 * the details without being asked to act. Every member hears in-app when a venue is booked or becomes free again.
 */
export function planNotifications(e: DomainEvent, b: EventBooking, today: string): NotificationPlan[] {
  const when = whenText(b);
  const short = whenText(b, false);
  const reason = e.data?.note ? truncate(e.data.note, 300) : '';
  const fit = (p: NotificationPlan): NotificationPlan => ({ ...p, title: truncate(p.title, 120), body: truncate(p.body, 500) });
  const plan = (...ps: (NotificationPlan | null)[]) => ps.filter((p): p is NotificationPlan => !!p).map(fit);
  const adminNotice = (title: string, body: string): NotificationPlan => ({
    audience: 'admins',
    type: 'admin_new_booking',
    title,
    body,
    email: false,
    push: false,
  });
  const venueBooked: NotificationPlan = {
    audience: 'everyone',
    type: 'venue_booked',
    title: `${b.venueName} is booked`,
    body: `${b.venueName} · ${when} is now booked. You can still join the queue for it.`,
    email: false,
    push: false,
  };

  switch (e.type) {
    case 'booking.confirmed':
      return plan(
        {
          audience: 'requester',
          type: 'booking_confirmed',
          title: 'Booking confirmed',
          body: `${b.venueName} · ${when}. Reference ${b.reference}.`,
          email: true,
          push: false,
          includeActor: true,
        },
        adminNotice('New booking', `${b.requesterName} booked ${b.venueName} on ${short} (confirmed).`),
        venueBooked,
      );
    case 'booking.queued': {
      const pos = e.data?.queuePosition;
      return plan(
        {
          audience: 'requester',
          type: 'booking_queued',
          title: pos ? `You're #${pos} in the queue` : "You're in the queue",
          body: `${b.venueName} · ${when} is taken. If it frees up, the slot is yours automatically and we'll let you know.`,
          email: true,
          push: false,
          includeActor: true,
        },
        adminNotice('New booking (queued)', `${b.requesterName} joined the queue for ${b.venueName} on ${short}${pos ? ` (#${pos})` : ''}.`),
      );
    }
    case 'booking.promoted':
      return plan(
        {
          audience: 'requester',
          type: 'booking_promoted',
          title: 'Good news: your booking is confirmed',
          body: `The slot you queued for freed up. ${b.venueName} · ${when} is now yours.`,
          email: true,
          push: true,
        },
        venueBooked,
      );
    case 'booking.modified':
      return plan({
        audience: 'admins',
        type: 'admin_request_modified',
        title: 'Booking changed',
        body: `${b.requesterName} changed ${b.reference} (${b.venueName}, ${short}${b.status === 'queued' ? ', in queue' : ''}).`,
        email: false,
        push: false,
      });
    case 'booking.cancelled': {
      const by = e.data?.cancelledBy ?? 'requester';
      const slot = e.data?.slot ?? (e.data?.previousStatus === 'queued' ? 'left_queue' : 'free');
      const queued = e.data?.previousStatus === 'queued';
      const what = queued ? 'Queued request' : 'Booking';
      // The member always gets the details: venue, when, the status, and what happened to the time.
      const member: NotificationPlan = {
        audience: 'requester',
        type: 'booking_cancelled',
        title: by === 'requester' ? `${what} cancelled` : `${what} cancelled by the administrator`,
        body:
          `${b.venueName} · ${when} · Reference ${b.reference}. Status: Cancelled. ` +
          `${slot === 'left_queue' && by !== 'requester' ? 'You are no longer in the queue for this time.' : AVAILABILITY[slot]}` +
          `${reason ? ` Reason: ${reason}` : ''}`,
        email: true,
        push: by !== 'requester',
        includeActor: true,
      };
      const admins: NotificationPlan | null =
        by === 'requester' && !queued
          ? {
              audience: 'admins',
              type: 'admin_booking_cancelled',
              title: 'Booking cancelled by requester',
              body: `${b.requesterName} cancelled ${b.reference} (${b.venueName}, ${short}). ${AVAILABILITY[slot]}`,
              email: false,
              push: false,
            }
          : null;
      const available: NotificationPlan | null =
        slot === 'free'
          ? {
              audience: 'everyone',
              type: 'venue_available',
              title: `${b.venueName} is available again`,
              body: `${b.venueName} · ${when} was cancelled and is free to book.`,
              email: false,
              push: false,
            }
          : null;
      return plan(member, admins, available);
    }
    case 'booking.expired':
      return plan({
        audience: 'requester',
        type: 'booking_expired',
        title: "Queued slot didn't free up",
        body: `${b.venueName} on ${short} stayed booked, so your queued request has expired.`,
        email: true,
        push: true,
      });
    case 'booking.reminder': {
      const rel = relativeDay(b.date, today);
      const day = rel.startsWith('on ') ? rel.slice(3) : rel;
      return plan({
        audience: 'requester',
        type: 'booking_reminder',
        title: 'Upcoming booking',
        body: `${b.venueName} · ${day} at ${b.startTime}${b.endDate && b.endDate !== b.date ? ` (until ${dayMonth(b.endDate)})` : ''}. Reference ${b.reference}.`,
        email: true,
        push: true,
      });
    }
  }
}
