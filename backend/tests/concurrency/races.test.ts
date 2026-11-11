// §28.5 / §18.4 race scenarios: the database, not the API, has the last word.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, campusDate, closePools, createVenue, member, resetDb, slot } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

let venueId: string;
let day: string;

beforeAll(async () => {
  await resetDb();
  venueId = await createVenue('Race Hall');
  day = await campusDate(9);
});
afterAll(closePools);

describe('concurrency', () => {
  it('CT-01: 20 members race for one slot — exactly one wins', async () => {
    const members = await Promise.all(Array.from({ length: 20 }, (_, i) => member(`racer${i}@int.edu`)));
    const results = await Promise.all(members.map((m) => as(m.token).post('/bookings', slot(venueId, day, '09:00', '11:00'))));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('BOOKING_CONFLICT');
    const active = await pool.query(
      "select count(*)::int as n from bookings where venue_id = $1 and booking_date = $2 and status in ('pending', 'approved')",
      [venueId, day],
    );
    expect(active.rows[0].n).toBe(1);
  });

  it('CT-03: one member, five parallel retries with the same Idempotency-Key — one row', async () => {
    const m = await member('retry@int.edu');
    const key = randomUUID();
    const body = slot(venueId, day, '13:00', '14:00');
    const results = await Promise.all(Array.from({ length: 5 }, () => as(m.token).post('/bookings', body).set('idempotency-key', key)));
    const ids = new Set(results.filter((r) => r.status < 300).map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    const rows = await pool.query('select count(*)::int as n from bookings where requester_id = $1', [m.id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('CT-05: two admins approve the same booking — one 200, one 409', async () => {
    const m = await member('approve-race@int.edu');
    const a1 = await member('admin1@int.edu', 'super_admin');
    const a2 = await member('admin2@int.edu', 'super_admin');
    const created = await as(m.token).post('/bookings', slot(venueId, day, '15:00', '16:00'));
    expect(created.status).toBe(201);
    const { id, version } = created.body.data;
    const results = await Promise.all([
      as(a1.token).post(`/admin/bookings/${id}/approve`, { version }),
      as(a2.token).post(`/admin/bookings/${id}/approve`, { version }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['INVALID_STATUS_TRANSITION', 'BOOKING_CHANGED']).toContain(results.find((r) => r.status === 409)!.body.error.code);
    const history = await pool.query("select count(*)::int as n from booking_history where booking_id = $1 and event_type = 'approved'", [id]);
    expect(history.rows[0].n).toBe(1);
  });

  it('CT-09: two raw transactions insert overlapping rows — the second fails with 23P01 after waiting', async () => {
    const requester = (await pool.query('select id from profiles where email = $1', ['retry@int.edu'])).rows[0].id;
    const url = pool.options.connectionString as string;
    const c1 = new pg.Client({ connectionString: url });
    const c2 = new pg.Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    const insert = `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
                    values ($1, $2, $3, '17:00', '18:00', 'Raw race')`;
    try {
      await c1.query('begin');
      await c2.query('begin');
      await c1.query(insert, [venueId, requester, day]);
      const second = c2.query(insert, [venueId, requester, day]).then(
        () => null,
        (e: { code?: string }) => e.code,
      );
      await new Promise((r) => setTimeout(r, 300)); // c2 is now blocked on c1's uncommitted row
      await c1.query('commit');
      expect(await second).toBe('23P01');
      await c2.query('rollback');
    } finally {
      await Promise.allSettled([c1.end(), c2.end()]);
    }
  });
});
