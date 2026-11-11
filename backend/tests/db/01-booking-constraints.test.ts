// §14.10 / §28.4: database invariants hold even when every API check is bypassed.
import { afterAll, describe, expect, it } from 'vitest';
import { attempt, baseFixtures, ID, pool, withRollback } from '../helpers/db.js';

const insertBooking = `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
                       values ($1, $2, $3, $4, $5, $6)`;

afterAll(() => pool.end());

describe('booking constraints (01)', () => {
  it('enforces overlap, adjacency, cancellation and block rules', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      expect((await c.query('select role from profiles where id = $1', [ID.admin])).rows[0].role).toBe('super_admin');
      expect((await c.query('select role from profiles where id = $1', [ID.stu1])).rows[0].role).toBe('student');

      expect(
        await attempt(
          c,
          `insert into bookings (id, venue_id, requester_id, booking_date, start_time, end_time, purpose)
           values ($1, $2, $3, '2099-01-15', '10:00', '12:00', 'Seminar')`,
          [ID.booking1, ID.venue, ID.stu1],
        ),
      ).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '11:00', '13:00', 'Overlap'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:00', '12:00', 'Identical'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:30', '11:30', 'Contained'])).toBe('23P01');
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '12:00', '14:00', 'Back to back'])).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-16', '12:00', '12:00', 'Zero length'])).toBe('23514');

      expect(
        await attempt(c, `update bookings set status = 'cancelled', cancelled_by = requester_id, cancelled_at = now() where id = $1`, [ID.booking1]),
      ).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu2, '2099-01-15', '10:00', '12:00', 'Freed slot'])).toBeNull();
      expect(await attempt(c, `update bookings set status = 'approved' where id = $1`, [ID.booking1])).toBe('CB003');

      expect(
        await attempt(
          c,
          `insert into venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
           values ($1, 'maintenance', 'Projector repair', '2099-01-15 14:00', '2099-01-15 18:00', $2)`,
          [ID.venue, ID.admin],
        ),
      ).toBeNull();
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-01-15', '15:00', '16:00', 'Inside block'])).toBe('CB001');
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
      expect(await attempt(c, insertBooking, [ID.venue, ID.stu1, '2099-02-01', '10:00', '11:00', 'Inactive venue'])).toBe('CB005');
    }));
});

describe('transitions and history (03, 04)', () => {
  it('allows only the transition table and records history with actor and note', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const { rows } = await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
         values ($1, $2, '2099-03-01', '09:00', '10:00', 'History check') returning id, version`,
        [ID.venue, ID.stu1],
      );
      const id = rows[0].id;
      expect(rows[0].version).toBe(1);
      await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', 'Bring keys', true)", [ID.admin]);
      await c.query(`update bookings set status = 'approved', decided_by = $2, decided_at = now() where id = $1`, [id, ID.admin]);
      await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', '', true)", [ID.stu1]);
      await c.query(`update bookings set start_time = '09:30', status = 'pending' where id = $1`, [id]);
      const b = (await c.query('select status, decided_by, version from bookings where id = $1', [id])).rows[0];
      expect(b).toMatchObject({ status: 'pending', decided_by: null, version: 3 });

      const h = (await c.query('select event_type, actor_id, note, changes from booking_history where booking_id = $1 order by id', [id])).rows;
      expect(h.map((x) => x.event_type)).toEqual(['submitted', 'approved', 'modified']);
      expect(h[1]).toMatchObject({ actor_id: ID.admin, note: 'Bring keys' });
      expect(h[2].changes).toEqual({ startTime: { from: '09:00', to: '09:30' } });

      expect(await attempt(c, `update bookings set status = 'expired' where id = $1`, [id])).toBeNull();
      expect(await attempt(c, `update bookings set purpose = 'changed after expiry' where id = $1`, [id])).toBe('CB003');
      expect(await attempt(c, `update bookings set requester_id = $2 where id = $1`, [id, ID.stu2])).toBe('CB003');
    }));

  it('blocks changing immutable columns on active bookings (CB004)', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const { rows } = await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose)
         values ($1, $2, '2099-03-02', '09:00', '10:00', 'Immutable') returning id`,
        [ID.venue, ID.stu1],
      );
      expect(await attempt(c, `update bookings set requester_id = $2 where id = $1`, [rows[0].id, ID.stu2])).toBe('CB004');
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
    }));

  it('expires stale pending requests in campus time (09)', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await c.query(
        `insert into bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose) values
           ($1, $2, current_date - 1, '10:00', '11:00', 'Stale'), ($1, $2, current_date + 2, '10:00', '11:00', 'Future')`,
        [ID.venue, ID.stu1],
      );
      const expired = (await c.query('select booking_id from public.expire_stale_bookings()')).rows;
      expect(expired).toHaveLength(1);
      // Scoped to this booking: rows committed by other suites (e.g. BT-EXP-01) may already be in the test database.
      const h = (await c.query("select actor_id from booking_history where event_type = 'expired' and booking_id = $1", [expired[0].booking_id]))
        .rows;
      expect(h).toEqual([{ actor_id: null }]);
    }));
});
