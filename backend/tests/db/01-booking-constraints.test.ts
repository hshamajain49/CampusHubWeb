// §14.10 / §28.4: database invariants hold even when every API check is bypassed (docs/BOOKINGS.md).
import { afterAll, describe, expect, it } from 'vitest';
import { attempt, baseFixtures, ID, pool, withRollback } from '../helpers/db.js';

const insertBooking = `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
                       values ($1, $2, $3, $4, $5, $6, $7)`;

afterAll(() => pool.end());

describe('booking constraints (01)', () => {
  it('allows one confirmed booking per slot, any number of queued requests, and block rules', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      expect((await c.query('select role from profiles where id = $1', [ID.admin])).rows[0].role).toBe('super_admin');

      expect(
        await attempt(
          c,
          `insert into bookings (id, venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
           values ($1, $2, $3, '2099-01-15', '10:00', '12:00', 'Seminar', 'confirmed')`,
          [ID.booking1, ID.venue, ID.stu1],
        ),
      ).toBeNull();
      // A second confirmed booking can never overlap: the exclusion constraint covers confirmed rows.
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '11:00', '13:00', 'Overlap', 'confirmed'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:00', '12:00', 'Identical', 'confirmed'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:30', '11:30', 'Contained', 'confirmed'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '12:00', '14:00', 'Back to back', 'confirmed'])).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-16', '12:00', '12:00', 'Zero length', 'confirmed'])).toBe('23514');
      // Queued requests hold no time and may overlap anything.
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:00', '12:00', 'Queued', 'queued'])).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.admin, '2099-01-15', '10:30', '11:00', 'Queued too', 'queued'])).toBeNull();
      // Status is always explicit, and old statuses are gone.
      expect(await attempt(c, `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
                               values ($1, $2, '2099-01-20', '10:00', '11:00', 'No status')`, [ID.venue, ID.stu1])).toBe('23502');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-01-20', '10:00', '11:00', 'Old status', 'pending'])).toBe('23514');
      // The USN / faculty ID is upper case letters and digits (plus - / .), 3–30 characters.
      expect(await attempt(c, `${insertBooking.replace('status)', 'status, id_number)').replace('$7)', "$7, '1rv22cs045')")}`, [
        ID.venue, ID.stu1, '2099-01-21', '10:00', '11:00', 'Lower-case ID', 'confirmed',
      ])).toBe('23514');

      expect(
        await attempt(c, `update bookings set status = 'cancelled', cancelled_by = requester_id, cancelled_at = now() where id = $1`, [ID.booking1]),
      ).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-01-15', '10:00', '12:00', 'Freed slot', 'confirmed'])).toBeNull();
      expect(await attempt(c, `update bookings set status = 'confirmed' where id = $1`, [ID.booking1])).toBe('CB003');

      expect(
        await attempt(
          c,
          `insert into venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
           values ($1, 'maintenance', 'Projector repair', '2099-01-15 14:00', '2099-01-15 18:00', $2)`,
          [ID.venue, ID.admin],
        ),
      ).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-01-15', '15:00', '16:00', 'Inside block', 'confirmed'])).toBe('CB001');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-01-15', '15:00', '16:00', 'Queued in block', 'queued'])).toBe('CB001');
      // Blocks can't cover confirmed bookings or queued requests.
      expect(
        await attempt(
          c,
          `insert into venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
           values ($1, 'special_event', 'Exam', '2099-01-15 09:00', '2099-01-15 11:00', $2)`,
          [ID.venue, ID.admin],
        ),
      ).toBe('CB002');
      expect(
        await attempt(
          c,
          `insert into venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
           values ($1, 'other', 'Overlapping block', '2099-01-15 17:00', '2099-01-15 19:00', $2)`,
          [ID.venue, ID.admin],
        ),
      ).toBe('23P01');
    }));

  it('rejects bookings on inactive venues (CB005)', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await c.query('update venues set is_active = false where id = $1', [ID.venue]);
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-02-01', '10:00', '11:00', 'Inactive venue', 'confirmed'])).toBe('CB005');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-02-01', '10:00', '11:00', 'Inactive venue', 'queued'])).toBe('CB005');
    }));
});

describe('transitions and history (03, 04)', () => {
  it('allows only the transition table, stamps times and records history with actor and note', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const { rows } = await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
         values ($1, $2, '2099-03-01', '09:00', '10:00', 'History check', 'queued') returning id, version, queued_at, confirmed_at`,
        [ID.venue, ID.stu1],
      );
      const id = rows[0].id;
      expect(rows[0]).toMatchObject({ version: 1, confirmed_at: null });
      expect(rows[0].queued_at).not.toBeNull();

      await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', 'Slot freed', true)", [ID.admin]);
      await c.query(`update bookings set status = 'confirmed' where id = $1`, [id]);
      await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', '', true)", [ID.stu1]);
      await c.query(`update bookings set start_time = '09:30', id_number = 'FAC-1024' where id = $1`, [id]);
      const b = (await c.query('select status, version, confirmed_at from bookings where id = $1', [id])).rows[0];
      expect(b).toMatchObject({ status: 'confirmed', version: 3 });
      expect(b.confirmed_at).not.toBeNull();

      const h = (await c.query('select event_type, actor_id, note, changes from booking_history where booking_id = $1 order by id', [id])).rows;
      expect(h.map((x) => x.event_type)).toEqual(['queued', 'promoted', 'modified']);
      expect(h[1]).toMatchObject({ actor_id: ID.admin, note: 'Slot freed' });
      expect(h[2].changes).toEqual({ startTime: { from: '09:00', to: '09:30' }, idNumber: { from: null, to: 'FAC-1024' } });

      // confirmed can't go back to the queue; completed is final.
      expect(await attempt(c, `update bookings set status = 'queued' where id = $1`, [id])).toBe('CB003');
      expect(await attempt(c, `update bookings set status = 'completed' where id = $1`, [id])).toBeNull();
      expect(await attempt(c, `update bookings set purpose = 'changed after completion' where id = $1`, [id])).toBe('CB003');
      expect(await attempt(c, `update bookings set requester_id = $2 where id = $1`, [id, ID.stu2])).toBe('CB003');
    }));

  it('blocks changing immutable columns on active bookings (CB004)', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const { rows } = await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status)
         values ($1, $2, '2099-03-02', '09:00', '10:00', 'Immutable', 'confirmed') returning id`,
        [ID.venue, ID.stu1],
      );
      expect(await attempt(c, `update bookings set requester_id = $2 where id = $1`, [rows[0].id, ID.stu2])).toBe('CB004');
    }));
});

describe('queue promotion (FIFO)', () => {
  it('promotes the oldest queued request whose time is free, as the system, skipping ones that still clash', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const ins = async (who: string, start: string, end: string, status: string, queuedAt?: string) =>
        (
          await c.query(
            `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status, queued_at)
             values ($1, $2, '2099-04-01', $3, $4, 'Queue test', $5, $6) returning id`,
            [ID.venue, who, start, end, status, queuedAt ?? null],
          )
        ).rows[0].id as string;
      const held = await ins(ID.stu1, '10:00', '12:00', 'confirmed');
      await ins(ID.stu1, '12:00', '13:00', 'confirmed'); // `third` still clashes with this one
      const first = await ins(ID.stu2, '10:00', '11:00', 'queued', '2099-01-01 08:00'); // free once `held` goes
      const second = await ins(ID.admin, '10:30', '11:30', 'queued', '2099-01-01 09:00'); // clashes with `first`
      const third = await ins(ID.admin, '11:00', '12:30', 'queued', '2099-01-01 10:00'); // still clashes with `later`

      expect((await c.query('select booking_id from promote_queued_bookings($1)', [ID.venue])).rows).toEqual([]);

      await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', 'Plans changed', true)", [ID.stu1]);
      await c.query(`update bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now() where id = $1`, [held, ID.stu1]);
      const promoted = (await c.query('select booking_id from promote_queued_bookings($1)', [ID.venue])).rows.map((r) => r.booking_id);
      expect(promoted).toEqual([first]);

      const status = async (id: string) => (await c.query('select status from bookings where id = $1', [id])).rows[0].status;
      expect(await status(second)).toBe('queued');
      expect(await status(third)).toBe('queued');
      // History of the promotion names no member, and the caller's actor and note are restored afterwards.
      const h = (await c.query(`select actor_id, note from booking_history where booking_id = $1 and event_type = 'promoted'`, [first])).rows;
      expect(h).toEqual([{ actor_id: null, note: 'The slot became free.' }]);
      const setting = (await c.query("select current_setting('app.actor_id', true) as a, current_setting('app.change_note', true) as n")).rows[0];
      expect(setting).toEqual({ a: ID.stu1, n: 'Plans changed' });

      // Inactive venues promote nothing.
      await c.query(`update bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now() where id = $1`, [first, ID.stu2]);
      await c.query('update venues set is_active = false where id = $1', [ID.venue]);
      expect((await c.query('select booking_id from promote_queued_bookings($1)', [ID.venue])).rows).toEqual([]);
    }));

  it('settles bookings in campus time: past queued → expired, ended confirmed → completed (09)', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, status) values
           ($1, $2, current_date - 1, '10:00', '11:00', 'Stale queue', 'queued'),
           ($1, $3, current_date - 1, '10:00', '11:00', 'Done', 'confirmed'),
           ($1, $2, current_date + 2, '10:00', '11:00', 'Future', 'confirmed')`,
        [ID.venue, ID.stu1, ID.stu2],
      );
      const settled = (await c.query('select booking_id, new_status from public.settle_bookings()')).rows;
      const mine = await c.query("select id, status from bookings where venue_id = $1 and purpose in ('Stale queue', 'Done', 'Future') order by purpose", [ID.venue]);
      expect(mine.rows.map((r) => r.status)).toEqual(['completed', 'confirmed', 'expired']);
      // Scoped to these bookings: rows committed by other suites may already be in the test database.
      const ids = new Set(mine.rows.map((r) => r.id));
      expect(settled.filter((r) => ids.has(r.booking_id)).map((r) => r.new_status).sort()).toEqual(['completed', 'expired']);
      const expiredId = mine.rows.find((r) => r.status === 'expired')!.id;
      const h = (await c.query("select actor_id from booking_history where event_type = 'expired' and booking_id = $1", [expiredId])).rows;
      expect(h).toEqual([{ actor_id: null }]);
    }));
});

describe('auth integration, settings and provisioning (02, 07, 08)', () => {
  it('creates a student profile, syncs names, and provisions super admins only via SQL', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const p = (await c.query('select email, role, full_name from profiles where id = $1', [ID.stu1])).rows[0];
      expect(p).toEqual({ email: 'stu1@test.edu', role: 'student', full_name: 'Student One' });
      await c.query("update profiles set full_name = 'Student Renamed' where id = $1", [ID.stu1]);
      expect((await c.query('select name from auth_users where id = $1', [ID.stu1])).rows[0].name).toBe('Student Renamed');
      expect(await attempt(c, "insert into auth_users (name, email) values ('Dup', 'STU1@test.edu')")).toBe('23505');
      expect((await c.query("select public.provision_super_admin('STU2@TEST.EDU') as id")).rows[0].id).toBe(ID.stu2);
      expect((await c.query("select count(*)::int as n from audit_logs where action = 'user.super_admin_provisioned'")).rows[0].n).toBe(1);
      expect(await attempt(c, "select public.provision_super_admin('nobody@test.edu')")).toBe('P0001');
    }));

  it('validates the settings singleton and timezone, and normalises domains', () =>
    withRollback(async (c) => {
      expect(await attempt(c, 'insert into app_settings (id) values (2)')).toBe('23514');
      expect(await attempt(c, "update app_settings set campus_timezone = 'Mars/Olympus' where id = 1")).toBe('22023');
      await c.query("update app_settings set allowed_email_domains = array[' College.EDU ', 'college.edu', ''] where id = 1");
      expect((await c.query('select allowed_email_domains from app_settings where id = 1')).rows[0].allowed_email_domains).toEqual(['college.edu']);
      expect(await attempt(c, "update app_settings set operating_hours_end = '07:00' where id = 1")).toBe('23514');
      expect(await attempt(c, 'update app_settings set max_active_per_user = 0 where id = 1')).toBe('23514');
    }));
});
