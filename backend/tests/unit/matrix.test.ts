// §10.18 notification matrix (docs/BOOKINGS.md) — pure, no database.
import { describe, expect, it } from 'vitest';
import { planNotifications, type DomainEvent, type EventBooking } from '../../src/modules/notifications/matrix.js';

const b: EventBooking = {
  id: 'b1',
  reference: 'BK-2026-000123',
  venueName: 'Seminar Hall A',
  requesterName: 'Priya Sharma',
  date: '2026-11-20',
  startTime: '10:00',
  endTime: '12:00',
  status: 'confirmed',
};
const ev = (type: DomainEvent['type'], data?: DomainEvent['data']): DomainEvent => ({ type, bookingId: 'b1', actorId: 'u1', data });

describe('planNotifications', () => {
  it('confirms a new booking to the member (email, kept in the bell) and informs admins in-app only', () => {
    const [member, admins] = planNotifications(ev('booking.confirmed'), b, '2026-11-09').filter((p) => p.audience !== 'everyone');
    expect(member).toMatchObject({ audience: 'requester', type: 'booking_confirmed', email: true, push: false, includeActor: true });
    expect(member!.body).toBe('Seminar Hall A · Fri 20 Nov · 10:00–12:00. Reference BK-2026-000123.');
    expect(admins).toMatchObject({ audience: 'admins', type: 'admin_new_booking', email: false, push: false });
    expect(admins!.body).toBe('Priya Sharma booked Seminar Hall A on 20 Nov · 10:00–12:00 (confirmed).');
  });

  it('tells a queued member their place, and admins that the request is queued', () => {
    const [member, admins] = planNotifications(ev('booking.queued', { queuePosition: 2 }), { ...b, status: 'queued' }, '2026-11-09');
    expect(member).toMatchObject({ type: 'booking_queued', title: "You're #2 in the queue", includeActor: true });
    expect(member!.body).toContain('If it frees up, the slot is yours automatically');
    expect(admins!.title).toBe('New booking (queued)');
    expect(admins!.body).toContain('(#2)');
  });

  it('announces a promotion from the queue by email and push', () => {
    const [p] = planNotifications(ev('booking.promoted'), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'requester', type: 'booking_promoted', email: true, push: true });
    expect(p!.includeActor).toBeUndefined();
  });

  it('keeps admins informed of changes without email', () => {
    const [p] = planNotifications(ev('booking.modified', { previousStatus: 'confirmed' }), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'admins', type: 'admin_request_modified', title: 'Booking changed', email: false, push: false });
  });

  it('tells the member who cancelled: venue, when, status and what happened to the time', () => {
    const queued = planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'queued', slot: 'left_queue' }), b, '2026-11-09');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ audience: 'requester', type: 'booking_cancelled', title: 'Queued request cancelled', includeActor: true });
    expect(queued[0]!.body).toBe('Seminar Hall A · Fri 20 Nov · 10:00–12:00 · Reference BK-2026-000123. Status: Cancelled. You left the queue for this time.');

    const handedOn = planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'confirmed', slot: 'queue' }), b, '2026-11-09');
    expect(handedOn.map((p) => p.audience)).toEqual(['requester', 'admins']);
    expect(handedOn[0]!.body).toContain('The time went to the next person in the queue.');
    expect(handedOn[1]).toMatchObject({ type: 'admin_booking_cancelled', email: false, push: false });
  });

  it('announces a freed time to every member (in-app only)', () => {
    const free = planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'confirmed', slot: 'free' }), b, '2026-11-09');
    expect(free.map((p) => p.audience)).toEqual(['requester', 'admins', 'everyone']);
    expect(free[0]!.body).toContain('The time is available again: anyone can book it.');
    expect(free[2]).toMatchObject({ type: 'venue_available', title: 'Seminar Hall A is available again', email: false, push: false });
    // A blocked or deactivated venue's time is not offered.
    const blocked = planNotifications(ev('booking.cancelled', { cancelledBy: 'system', previousStatus: 'confirmed', slot: 'unavailable' }), b, '2026-11-09');
    expect(blocked.map((p) => p.audience)).toEqual(['requester']);
    expect(blocked[0]!.body).toContain('The venue is unavailable at that time.');
  });

  it('announces every new booking to every member, never a queued request', () => {
    const confirmed = planNotifications(ev('booking.confirmed'), b, '2026-11-09');
    expect(confirmed.find((p) => p.audience === 'everyone')).toMatchObject({ type: 'venue_booked', title: 'Seminar Hall A is booked', email: false });
    expect(planNotifications(ev('booking.promoted'), b, '2026-11-09').some((p) => p.type === 'venue_booked')).toBe(true);
    expect(planNotifications(ev('booking.queued', { queuePosition: 1 }), b, '2026-11-09').some((p) => p.audience === 'everyone')).toBe(false);
  });

  it('describes multi-day bookings as a date range with a daily time', () => {
    const multi = { ...b, endDate: '2026-11-22' };
    expect(planNotifications(ev('booking.confirmed'), multi, '2026-11-09')[0]!.body).toBe(
      'Seminar Hall A · 20 Nov – 22 Nov · 10:00–12:00 daily. Reference BK-2026-000123.',
    );
  });

  it('includes the admin reason on cancellations', () => {
    const [p] = planNotifications(ev('booking.cancelled', { cancelledBy: 'admin', previousStatus: 'confirmed', note: 'Exam moved', slot: 'free' }), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'requester', type: 'booking_cancelled', email: true, push: true });
    expect(p!.body).toContain('Reason: Exam moved');
    expect(planNotifications(ev('booking.cancelled', { cancelledBy: 'admin', previousStatus: 'queued' }), b, '2026-11-09')[0]!.title).toBe(
      'Queued request cancelled by the administrator',
    );
  });

  it('explains an expired queued request', () => {
    const [p] = planNotifications(ev('booking.expired'), { ...b, status: 'expired' }, '2026-11-09');
    expect(p).toMatchObject({ type: 'booking_expired', title: "Queued slot didn't free up" });
  });

  it('phrases reminders relative to campus today', () => {
    expect(planNotifications(ev('booking.reminder'), b, '2026-11-19')[0]!.body).toBe(
      'Seminar Hall A · tomorrow at 10:00. Reference BK-2026-000123.',
    );
    expect(planNotifications(ev('booking.reminder'), b, '2026-11-20')[0]!.body).toContain('today at 10:00');
    expect(planNotifications(ev('booking.reminder'), b, '2026-11-09')[0]!.body).toContain('Fri 20 Nov at 10:00');
  });

  it('truncates long titles and bodies', () => {
    const long = { ...b, venueName: 'V'.repeat(600) };
    const [p] = planNotifications(ev('booking.confirmed'), long, '2026-11-09');
    expect(p!.body.length).toBe(500);
    expect(p!.body.endsWith('…')).toBe(true);
  });
});
