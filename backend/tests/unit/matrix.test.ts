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
    const [member, admins] = planNotifications(ev('booking.confirmed'), b, '2026-11-09');
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

  it('skips requester cancellations of queued requests and tells admins about confirmed ones', () => {
    expect(planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'queued' }), b, '2026-11-09')).toEqual([]);
    const [p] = planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'confirmed' }), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'admins', email: false, push: false });
  });

  it('includes the admin reason on cancellations', () => {
    const [p] = planNotifications(ev('booking.cancelled', { cancelledBy: 'admin', previousStatus: 'confirmed', note: 'Exam moved' }), b, '2026-11-09');
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
