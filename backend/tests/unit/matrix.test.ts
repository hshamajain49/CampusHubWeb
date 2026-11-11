// §10.18 notification matrix — pure, no database.
import { describe, expect, it } from 'vitest';
import { planNotifications, type DomainEvent } from '../../src/modules/notifications/matrix.js';

const b = {
  id: 'b1',
  reference: 'BK-2026-000123',
  venueName: 'Seminar Hall A',
  requesterName: 'Priya Sharma',
  date: '2026-11-20',
  startTime: '10:00',
  endTime: '12:00',
};
const ev = (type: DomainEvent['type'], data?: DomainEvent['data']): DomainEvent => ({ type, bookingId: 'b1', actorId: null, data });

describe('planNotifications', () => {
  it('notifies admins of new requests by email and push', () => {
    const [p] = planNotifications(ev('booking.submitted'), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'admins', type: 'admin_new_request', email: true, push: true });
    expect(p!.body).toBe('Priya Sharma requested Seminar Hall A on 20 Nov · 10:00–12:00.');
  });

  it('distinguishes approved-returned-to-pending from pending edits', () => {
    expect(planNotifications(ev('booking.modified', { returnedToPending: true }), b, '2026-11-09')[0]).toMatchObject({
      title: 'Approved booking changed',
      email: true,
    });
    expect(planNotifications(ev('booking.modified', { previousStatus: 'pending' }), b, '2026-11-09')[0]).toMatchObject({
      title: 'Booking request updated',
      email: false,
      push: true,
    });
  });

  it('skips requester cancellations of pending requests and tells admins about approved ones', () => {
    expect(planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'pending' }), b, '2026-11-09')).toEqual([]);
    const [p] = planNotifications(ev('booking.cancelled', { cancelledBy: 'requester', previousStatus: 'approved' }), b, '2026-11-09');
    expect(p).toMatchObject({ audience: 'admins', email: false, push: false });
  });

  it('includes the admin reason on cancellations, rejections and approvals', () => {
    expect(planNotifications(ev('booking.cancelled', { cancelledBy: 'admin', note: 'Exam moved' }), b, '2026-11-09')[0]!.body).toContain(
      'Reason: Exam moved',
    );
    expect(planNotifications(ev('booking.rejected', { note: 'Clashes with convocation' }), b, '2026-11-09')[0]!.body).toBe(
      'Seminar Hall A · 20 Nov · 10:00–12:00. Reason: Clashes with convocation',
    );
    expect(planNotifications(ev('booking.approved', { note: 'Collect keys at front desk' }), b, '2026-11-09')[0]!.body).toBe(
      'Seminar Hall A · Fri 20 Nov · 10:00–12:00. Note: Collect keys at front desk',
    );
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
    const [p] = planNotifications(ev('booking.submitted'), long, '2026-11-09');
    expect(p!.body.length).toBe(500);
    expect(p!.body.endsWith('…')).toBe(true);
  });
});
