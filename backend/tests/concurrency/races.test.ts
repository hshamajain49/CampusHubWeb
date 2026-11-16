// §28.5 / §18.4 race scenarios (docs/BOOKINGS.md): the database, not the API, has the last word.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, campusDate, closePools, createVenue, member, resetDb, signIn, slot } from '../helpers/app.js';
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
  it('CT-01: 20 members race for one slot — exactly one is confirmed, the rest queue in a strict order', async () => {
    const members = await Promise.all(Array.from({ length: 20 }, (_, i) => member(`racer${i}@int.edu`)));
    const results = await Promise.all(members.map((m) => as(m.token).post('/bookings', slot(venueId, day, '09:00', '11:00'))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const statuses = results.map((r) => r.body.data.status);
    expect(statuses.filter((s) => s === 'confirmed')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'queued')).toHaveLength(19);
    // Positions are 1..19 with no ties: arrival order is total.
    const positions = results.filter((r) => r.body.data.status === 'queued').map((r) => r.body.data.queuePosition).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    const confirmed = await pool.query(
      "select count(*)::int as n from bookings where venue_id = $1 and booking_date = $2 and status = 'confirmed'",
      [venueId, day],
    );
    expect(confirmed.rows[0].n).toBe(1);
  });

  it('CT-02: the holder cancels — exactly the first in the queue is promoted, and the queue shifts up', async () => {
    const rows = (
      await pool.query(
        `select b.id, b.requester_id, b.status from bookings b
          where b.venue_id = $1 and b.booking_date = $2 and b.start_time = '09:00'
          order by (b.status = 'confirmed') desc, b.queued_at, b.id`,
        [venueId, day],
      )
    ).rows;
    const holder = rows[0]!;
    const next = rows[1]!;
    const email = (await pool.query('select email from profiles where id = $1', [holder.requester_id])).rows[0].email;
    const outsider = await member('outsider@int.edu');
    expect((await as(outsider.token).post(`/bookings/${holder.id}/cancel`, {})).status).toBe(404);

    const holderToken = await signIn(email);
    expect((await as(holderToken).post(`/bookings/${holder.id}/cancel`, {})).status).toBe(200);
    const after = await pool.query("select id from bookings where venue_id = $1 and booking_date = $2 and status = 'confirmed'", [venueId, day]);
    expect(after.rows.map((r) => r.id)).toEqual([next.id]);
    const left = await pool.query("select count(*)::int as n from bookings where venue_id = $1 and booking_date = $2 and status = 'queued'", [venueId, day]);
    expect(left.rows[0].n).toBe(18);
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

  it('CT-05: a cancellation and new requests race — never two confirmed bookings for the slot', async () => {
    const holder = await member('holder@int.edu');
    const created = await as(holder.token).post('/bookings', slot(venueId, day, '15:00', '16:00'));
    expect(created.body.data.status).toBe('confirmed');
    const others = await Promise.all(Array.from({ length: 6 }, (_, i) => member(`late${i}@int.edu`)));
    const [cancel, ...requests] = await Promise.all([
      as(holder.token).post(`/bookings/${created.body.data.id}/cancel`, {}),
      ...others.map((m) => as(m.token).post('/bookings', slot(venueId, day, '15:00', '16:00'))),
    ]);
    expect(cancel!.status).toBe(200);
    expect(requests.every((r) => r.status === 201)).toBe(true);
    const confirmed = await pool.query(
      "select count(*)::int as n from bookings where venue_id = $1 and booking_date = $2 and start_time = '15:00' and status = 'confirmed'",
      [venueId, day],
    );
    expect(confirmed.rows[0].n).toBe(1);
  });

  it('CT-09: two raw transactions insert overlapping confirmed rows — the second fails with 23P01 after waiting', async () => {
    const requester = (await pool.query('select id from profiles where email = $1', ['retry@int.edu'])).rows[0].id;
    const url = pool.options.connectionString as string;
    const c1 = new pg.Client({ connectionString: url });
    const c2 = new pg.Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    const insert = `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
                    values ($1, $2, $3, '17:00', '18:00', 'Raw race', 'confirmed')`;
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
