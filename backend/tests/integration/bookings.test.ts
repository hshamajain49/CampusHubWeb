// §28.3 integration: auth guards, booking lifecycle, admin decisions, jobs, health.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, as, campusDate, closePools, createVenue, member, resetDb, slot } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

let stu: { id: string; token: string };
let other: { id: string; token: string };
let admin: { id: string; token: string };
let venueId: string;
let day: string;

beforeAll(async () => {
  await resetDb();
  stu = await member('priya@int.edu');
  other = await member('daniel@int.edu', 'faculty_staff');
  admin = await member('admin@int.edu', 'super_admin');
  venueId = await createVenue();
  day = await campusDate(7);
});
afterAll(closePools);

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

  it('BT-AUTH-06: members cannot reach /admin and admins cannot reach /bookings', async () => {
    expect((await as(stu.token).get('/admin/dashboard')).status).toBe(403);
    expect((await as(admin.token).get('/bookings')).status).toBe(403);
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
});

describe('validation', () => {
  it('BT-VAL-01: rejects unknown fields, impossible dates and bad times', async () => {
    const bad = [
      { ...slot(venueId, day), extra: true },
      slot(venueId, '2026-02-30'),
      slot(venueId, day, '24:00', '25:00'),
      slot(venueId, day, '9:5', '10:00'),
      slot('not-a-uuid', day),
    ];
    for (const body of bad) {
      const res = await as(stu.token).post('/bookings', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('booking lifecycle', () => {
  let bookingId: string;
  let version: number;

  it('BT-BKG-01: creates a pending booking with a reference and submitted history', async () => {
    const res = await as(stu.token).post('/bookings', slot(venueId, day));
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/bookings/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({ status: 'pending', date: day, startTime: '10:00', endTime: '12:00' });
    expect(res.body.data.reference).toMatch(/^BK-\d{4}-\d{6}$/);
    expect(res.body.data.history.map((h: { eventType: string }) => h.eventType)).toEqual(['submitted']);
    bookingId = res.body.data.id;
    version = res.body.data.version;
  });

  it('BT-BKG-03: overlapping requests conflict; adjacent slots are allowed', async () => {
    const res = await as(other.token).post('/bookings', slot(venueId, day, '11:00', '13:00'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_CONFLICT');
    const adjacent = await as(other.token).post('/bookings', slot(venueId, day, '12:00', '13:00'));
    expect(adjacent.status).toBe(201);
  });

  it('BT-BKG-05: an Idempotency-Key replays the same booking', async () => {
    const key = randomUUID();
    const body = slot(venueId, day, '14:00', '15:00');
    const first = await as(stu.token).post('/bookings', body).set('idempotency-key', key);
    const again = await as(stu.token).post('/bookings', body).set('idempotency-key', key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);
    const different = await as(stu.token).post('/bookings', body).set('idempotency-key', randomUUID());
    expect(different.status).toBe(409);
  });

  it("BT-BKG-07: another member's booking is a 404", async () => {
    expect((await as(other.token).get(`/bookings/${bookingId}`)).status).toBe(404);
    expect((await as(stu.token).get(`/bookings/${bookingId}`)).status).toBe(200);
  });

  it('BT-BKG-11: a pending booking has no confirmation PDF', async () => {
    const res = await as(stu.token).get(`/bookings/${bookingId}/confirmation.pdf`);
    expect(res.status).toBe(409);
  });

  it('BT-ADM-01: approve once, then a second approve names the approver', async () => {
    const ok = await as(admin.token).post(`/admin/bookings/${bookingId}/approve`, { version, note: 'Keys at reception' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('approved');
    version = ok.body.data.version;
    const again = await as(admin.token).post(`/admin/bookings/${bookingId}/approve`, { version });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    const audit = await pool.query("select 1 from audit_logs where action = 'booking.approved' and entity_id = $1", [bookingId]);
    expect(audit.rowCount).toBe(1);
    const notes = await pool.query("select type from notifications where recipient_id = $1 and type = 'booking_approved'", [stu.id]);
    expect(notes.rowCount).toBe(1);
  });

  it('BT-BKG-11: an approved booking downloads a PDF named after its reference', async () => {
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
  });

  it('BT-BKG-08/09: editing an approved booking returns it to pending; a stale version is refused', async () => {
    const stale = await as(stu.token).patch(`/bookings/${bookingId}`, { purpose: 'Updated agenda', version: version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BOOKING_CHANGED');
    const res = await as(stu.token).patch(`/bookings/${bookingId}`, { purpose: 'Updated agenda', version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'pending', purpose: 'Updated agenda' });
    version = res.body.data.version;
  });

  it('BT-ADM-02: rejecting requires a reason and stores it', async () => {
    const noReason = await as(admin.token).post(`/admin/bookings/${bookingId}/reject`, { version });
    expect(noReason.status).toBe(400);
    const res = await as(admin.token).post(`/admin/bookings/${bookingId}/reject`, { version, reason: 'Venue reserved for exams' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'Venue reserved for exams' });
  });

  it('BT-BKG-10: a rejected booking cannot be cancelled, and the slot is free again', async () => {
    expect((await as(stu.token).post(`/bookings/${bookingId}/cancel`, {})).status).toBe(409);
    expect((await as(other.token).post('/bookings', slot(venueId, day, '10:00', '11:00'))).status).toBe(201);
  });
});

describe('scheduled jobs and health', () => {
  it('BT-EXP-01: a wrong cron secret is refused', async () => {
    const res = await request(app).post('/internal/jobs/run').set('authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('BT-EXP-01: the expiry job expires past pending requests only', async () => {
    const past = await pool.query(
      `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
       values ($1, $2, (now() at time zone 'UTC')::date - 1, '10:00', '11:00', 'Stale request') returning id`,
      [venueId, stu.id],
    );
    const res = await request(app)
      .post('/internal/jobs/run?tasks=expire')
      .set('authorization', `Bearer ${process.env.CRON_SECRET ?? 'test-cron-secret-test-cron-secret-0123456789'}`);
    expect(res.status).toBe(200);
    const row = await pool.query('select status from bookings where id = $1', [past.rows[0].id]);
    expect(row.rows[0].status).toBe('expired');
    const future = await pool.query("select count(*)::int as n from bookings where status = 'pending' and booking_date > now()::date");
    expect(future.rows[0].n).toBeGreaterThan(0);
  });

  it('BT-HLT-01: /health and /health/ready respond', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/health/ready')).body.db).toBe('ok');
  });
});
