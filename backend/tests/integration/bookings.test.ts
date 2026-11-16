// §28.3 integration: auth guards, booking lifecycle with the FIFO queue (docs/BOOKINGS.md), admin cancel, jobs, health.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, as, campusDate, closePools, createVenue, member, resetDb, slot } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

let stu: { id: string; token: string };
let other: { id: string; token: string };
let third: { id: string; token: string };
let admin: { id: string; token: string };
let venueId: string;
let day: string;

beforeAll(async () => {
  await resetDb();
  stu = await member('priya@int.edu');
  other = await member('daniel@int.edu', 'faculty_staff');
  third = await member('ananya@int.edu');
  admin = await member('admin@int.edu', 'super_admin');
  venueId = await createVenue();
  day = await campusDate(7);
});
afterAll(closePools);

const notes = async (userId: string, type: string) =>
  (await pool.query('select title, body from notifications where recipient_id = $1 and type = $2 order by created_at', [userId, type])).rows;

describe('auth and role guards', () => {
  it('BT-AUTH-01: missing, unknown and revoked tokens get 401', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await as('not-a-real-token').get('/me')).status).toBe(401);
    const victim = await member('revoked@int.edu');
    expect((await as(victim.token).get('/me')).status).toBe(200);
    await pool.query('delete from auth_sessions where user_id = $1', [victim.id]);
    const res = await as(victim.token).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('BT-AUTH-06: members cannot reach /admin; the Super Admin can also book for themselves', async () => {
    expect((await as(stu.token).get('/admin/dashboard')).status).toBe(403);
    expect((await as(admin.token).get('/bookings')).status).toBe(200);
    expect((await as(admin.token).get('/venues')).status).toBe(200);
    expect((await as(admin.token).get('/admin/dashboard')).status).toBe(200);
  });

  it('BT-AUTH-05: public sign-up through Better Auth is refused', async () => {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('origin', 'http://localhost:5173')
      .send({ email: 'sneaky@int.edu', password: 'Testing12345', name: 'Sneaky' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await pool.query("select 1 from auth_users where email = 'sneaky@int.edu'")).rowCount).toBe(0);
  });

  it('BT-ADM-00: the approval endpoints are gone', async () => {
    const id = randomUUID();
    expect((await as(admin.token).post(`/admin/bookings/${id}/approve`, { version: 1 })).status).toBe(404);
    expect((await as(admin.token).post(`/admin/bookings/${id}/reject`, { version: 1, reason: 'No' })).status).toBe(404);
  });
});

describe('validation', () => {
  it('BT-VAL-01: rejects unknown fields, impossible dates, bad times and a missing or malformed USN / faculty ID', async () => {
    const { idNumber: _omit, ...noId } = slot(venueId, day);
    const bad = [
      { ...slot(venueId, day), extra: true },
      slot(venueId, '2026-02-30'),
      slot(venueId, day, '24:00', '25:00'),
      slot(venueId, day, '9:5', '10:00'),
      slot('not-a-uuid', day),
      noId,
      slot(venueId, day, '10:00', '12:00', 'Seminar', 'ab'),
      slot(venueId, day, '10:00', '12:00', 'Seminar', 'has space'),
    ];
    for (const body of bad) {
      const res = await as(stu.token).post('/bookings', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('booking lifecycle and queue', () => {
  let bookingId: string;
  let version: number;
  let queuedId: string;
  let secondQueuedId: string;

  it('BT-BKG-01: the first valid request is confirmed immediately, with the ID stored upper case', async () => {
    const res = await as(stu.token).post('/bookings', slot(venueId, day, '10:00', '12:00', 'Integration seminar', '1rv22cs045'));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/bookings/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({ status: 'confirmed', queuePosition: null, idNumber: '1RV22CS045', date: day, startTime: '10:00' });
    expect(res.body.data.confirmedAt).not.toBeNull();
    expect(res.body.data.reference).toMatch(/^BK-\d{4}-\d{6}$/);
    expect(res.body.data.history.map((h: { eventType: string }) => h.eventType)).toEqual(['confirmed']);
    bookingId = res.body.data.id;
    version = res.body.data.version;
    // The member gets a confirmation; admins are informed in-app only (no email).
    expect(await notes(stu.id, 'booking_confirmed')).toHaveLength(1);
    const adminNote = await pool.query("select email_status, push_status from notifications where recipient_id = $1 and type = 'admin_new_booking'", [admin.id]);
    expect(adminNote.rows).toEqual([{ email_status: 'none', push_status: 'none' }]);
    expect((await as(stu.token).get('/me')).body.data.lastIdNumber).toBe('1RV22CS045');
  });

  it('BT-BKG-03: overlapping requests join the queue in arrival order; adjacent slots are confirmed', async () => {
    const q1 = await as(other.token).post('/bookings', slot(venueId, day, '11:00', '13:00', 'Faculty meeting', 'FAC-1024'));
    expect(q1.status).toBe(201);
    expect(q1.body.data).toMatchObject({ status: 'queued', queuePosition: 1 });
    queuedId = q1.body.data.id;
    // Overlaps both the holder (10–12) and #1 (11–13), so it queues behind #1.
    const q2 = await as(third.token).post('/bookings', slot(venueId, day, '11:30', '12:30', 'Debate practice', '1RV22EC017'));
    expect(q2.body.data).toMatchObject({ status: 'queued', queuePosition: 2 });
    secondQueuedId = q2.body.data.id;
    expect((await notes(other.id, 'booking_queued'))[0]!.title).toBe("You're #1 in the queue");
    const adjacent = await as(third.token).post('/bookings', slot(venueId, day, '14:00', '15:00', 'Adjacent', '1RV22EC017'));
    expect(adjacent.body.data.status).toBe('confirmed');
  });

  it('BT-BKG-04: a member cannot hold two bookings for the same time at one venue', async () => {
    const dup = await as(stu.token).post('/bookings', slot(venueId, day, '11:00', '11:30'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('BT-BKG-06: the availability check predicts confirm vs queue', async () => {
    const free = await as(stu.token).get(`/venues/${venueId}/availability/check?date=${day}&startTime=16:00&endTime=17:00`);
    expect(free.body.data, JSON.stringify(free.body)).toMatchObject({ available: true, outcome: 'confirm', queuePosition: null });
    const taken = await as(admin.token).get(`/venues/${venueId}/availability/check?date=${day}&startTime=10:00&endTime=11:00`);
    expect(taken.body.data).toMatchObject({ outcome: 'queue' }); // the admin can book too
    const queued = await as(stu.token).get(`/venues/${venueId}/availability/check?date=${day}&startTime=14:00&endTime=15:00`);
    expect(queued.body.data, JSON.stringify(queued.body)).toMatchObject({ available: true, outcome: 'queue', queuePosition: 1 });
  });

  it('BT-BKG-05: an Idempotency-Key replays the same booking', async () => {
    const key = randomUUID();
    const body = slot(venueId, day, '16:00', '17:00');
    const first = await as(stu.token).post('/bookings', body).set('idempotency-key', key);
    const again = await as(stu.token).post('/bookings', body).set('idempotency-key', key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);
    const different = await as(stu.token).post('/bookings', body).set('idempotency-key', randomUUID());
    expect(different.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('BT-BKG-14: my bookings list works for every scope', async () => {
    for (const scope of ['upcoming', 'history', 'all']) {
      const res = await as(stu.token).get(`/bookings?scope=${scope}&pageSize=50`);
      expect(res.status, `${scope}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const all = (await as(stu.token).get('/bookings?scope=all&pageSize=50')).body.data;
    expect(all.some((b: { id: string }) => b.id === bookingId)).toBe(true);
  });

  it("BT-BKG-07: another member's booking is a 404", async () => {
    expect((await as(other.token).get(`/bookings/${bookingId}`)).status).toBe(404);
    expect((await as(stu.token).get(`/bookings/${bookingId}`)).status).toBe(200);
  });

  it('BT-BKG-11: a confirmed booking downloads a PDF; a queued one has none', async () => {
    const res = await as(stu.token)
      .get(`/bookings/${bookingId}/confirmation.pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/booking-confirmation-BK-\d{4}-\d{6}\.pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await as(other.token).get(`/bookings/${queuedId}/confirmation.pdf`)).status).toBe(409);
  });

  it('BT-BKG-08/09: details change in place; a stale version is refused; a confirmed booking never moves onto a taken time', async () => {
    const stale = await as(stu.token).patch(`/bookings/${bookingId}`, { purpose: 'Updated agenda', version: version + 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BOOKING_CHANGED');
    const res = await as(stu.token).patch(`/bookings/${bookingId}`, { purpose: 'Updated agenda', version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'confirmed', purpose: 'Updated agenda' });
    version = res.body.data.version;
    const onto = await as(stu.token).patch(`/bookings/${bookingId}`, { startTime: '14:00', endTime: '15:00', version });
    expect(onto.status, JSON.stringify(onto.body)).toBe(409);
    expect(onto.body.error.code).toBe('BOOKING_CONFLICT');
  });

  it('BT-BKG-10: cancelling a confirmed booking promotes the queue first-in, first-out and notifies the new holder', async () => {
    const res = await as(stu.token).post(`/bookings/${bookingId}/cancel`, { reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    // #1 (11:00–13:00) gets the slot; #2 (11:30–12:30) still clashes with #1, so it stays queued and moves up.
    const first = (await as(other.token).get(`/bookings/${queuedId}`)).body.data;
    expect(first).toMatchObject({ status: 'confirmed', queuePosition: null });
    expect(first.history.map((h: { eventType: string }) => h.eventType)).toEqual(['queued', 'promoted']);
    expect(first.history[1].actor).toBeNull(); // the promoted member never sees who cancelled
    const second = (await as(third.token).get(`/bookings/${secondQueuedId}`)).body.data;
    expect(second).toMatchObject({ status: 'queued', queuePosition: 1 });
    expect(await notes(other.id, 'booking_promoted')).toHaveLength(1);
    expect(await notes(third.id, 'booking_promoted')).toHaveLength(0);
    // Admins hear about the cancellation in-app.
    expect((await notes(admin.id, 'admin_booking_cancelled')).length).toBe(1);
    // Cancelling again is a no-op; final bookings can't be changed.
    expect((await as(stu.token).post(`/bookings/${bookingId}/cancel`, {})).status).toBe(200);
    expect((await as(stu.token).patch(`/bookings/${bookingId}`, { purpose: 'Too late', version: res.body.data.version })).status).toBe(409);
  });

  it('BT-BKG-12: a queued request moved to a free time is confirmed', async () => {
    const q = await as(stu.token).post('/bookings', slot(venueId, day, '11:30', '12:30', 'Waiting', '1RV22CS045'));
    expect(q.body.data.status).toBe('queued');
    const moved = await as(stu.token).patch(`/bookings/${q.body.data.id}`, { startTime: '17:30', endTime: '18:30', version: q.body.data.version });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ status: 'confirmed', startTime: '17:30' });
  });

  it('BT-ADM-03: an admin cancels a confirmed booking with a reason; the queue moves up', async () => {
    const holder = await as(third.token).post('/bookings', slot(venueId, day, '19:00', '20:00', 'Rehearsal', '1RV22EC017'));
    const waiter = await as(other.token).post('/bookings', slot(venueId, day, '19:00', '20:00', 'Review', 'FAC-1024'));
    expect([holder.body.data.status, waiter.body.data.status]).toEqual(['confirmed', 'queued']);
    const noReason = await as(admin.token).post(`/admin/bookings/${holder.body.data.id}/cancel`, {});
    expect(noReason.status).toBe(400);
    const res = await as(admin.token).post(`/admin/bookings/${holder.body.data.id}/cancel`, { reason: 'Exams moved here' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', cancellationReason: 'Exams moved here' });
    expect(Object.keys(res.body.data.permissions).sort()).toEqual(['canCancel', 'canDownloadConfirmation']);
    expect((await as(other.token).get(`/bookings/${waiter.body.data.id}`)).body.data.status).toBe('confirmed');
    const audit = await pool.query("select 1 from audit_logs where action = 'booking.cancelled_by_admin' and entity_id = $1", [holder.body.data.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('BT-BKG-13: the upcoming-bookings limit counts confirmed and queued bookings', async () => {
    await pool.query('update app_settings set max_active_per_user = 2 where id = 1');
    try {
      const lim = await member('limit@int.edu');
      const d2 = await campusDate(8);
      expect((await as(lim.token).post('/bookings', slot(venueId, d2, '08:00', '09:00'))).body.data.status).toBe('confirmed');
      expect((await as(lim.token).post('/bookings', slot(venueId, d2, '09:00', '10:00'))).body.data.status).toBe('confirmed');
      const third = await as(lim.token).post('/bookings', slot(venueId, d2, '10:00', '11:00'));
      expect(third.status).toBe(422);
      expect(third.body.error.code).toBe('BOOKING_LIMIT_REACHED');
    } finally {
      await pool.query('update app_settings set max_active_per_user = 5 where id = 1');
    }
  });
});

describe('scheduled jobs and health', () => {
  it('BT-EXP-01: a wrong cron secret is refused', async () => {
    const res = await request(app).post('/internal/jobs/run').set('authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('BT-EXP-01: the job expires past queued requests (with a notification) and completes ended bookings', async () => {
    const ins = (status: string, purpose: string) =>
      pool.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
         values ($1, $2, (now() at time zone 'UTC')::date - 1, '10:00', '11:00', $3, $4) returning id`,
        [venueId, stu.id, purpose, status],
      );
    const queued = await ins('queued', 'Stale queue');
    const done = await ins('confirmed', 'Already happened');
    const res = await request(app)
      .post('/internal/jobs/run?tasks=expire')
      .set('authorization', `Bearer ${process.env.CRON_SECRET ?? 'test-cron-secret-test-cron-secret-0123456789'}`);
    expect(res.status).toBe(200);
    const status = async (id: string) => (await pool.query('select status from bookings where id = $1', [id])).rows[0].status;
    expect(await status(queued.rows[0].id)).toBe('expired');
    expect(await status(done.rows[0].id)).toBe('completed');
    expect((await notes(stu.id, 'booking_expired')).length).toBe(1);
    const future = await pool.query("select count(*)::int as n from bookings where status = 'confirmed' and booking_date > now()::date");
    expect(future.rows[0].n).toBeGreaterThan(0);
  });

  it('BT-HLT-01: /health and /health/ready respond', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/health/ready')).body.db).toBe('ok');
  });
});
