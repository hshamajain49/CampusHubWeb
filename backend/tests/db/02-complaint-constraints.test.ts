// COMPLAINT_REGISTRATION_SPEC.md §19 CDT-01…11: complaint invariants hold even when every API check is bypassed.
// CDT-08 (RLS) and the Supabase auth-trigger half of CDT-10 don't apply: this app has no client-side database access,
// and Better Auth's trigger creates students that the API raises to other roles (see the migration comments).
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { attempt, baseFixtures, ID, pool, SEED_CATEGORIES, withRollback } from '../helpers/db.js';

afterAll(() => pool.end());

const STAFF = '00000000-0000-0000-0000-0000000000c1';

async function catId(c: pg.PoolClient, slug: string): Promise<{ id: string; department_id: string }> {
  return (await c.query('select id, department_id from complaint_categories where slug = $1', [slug])).rows[0];
}

async function actAs(c: pg.PoolClient, actor: string | null, note: string | null = null) {
  await c.query("select set_config('app.actor_id', $1, true), set_config('app.change_note', $2, true)", [actor ?? '', note ?? '']);
}

/** A pending complaint by stu1 in the given category. */
async function newComplaint(c: pg.PoolClient, slug = 'electrical'): Promise<string> {
  const cat = await catId(c, slug);
  await actAs(c, ID.stu1);
  const { rows } = await c.query(
    `insert into complaints (reporter_id, category_id, department_id, title) values ($1, $2, $3, 'Fan not working') returning id`,
    [ID.stu1, cat.id, cat.department_id],
  );
  return rows[0].id;
}

const setStatus = (c: pg.PoolClient, id: string, status: string, extra = '') =>
  attempt(c, `update complaints set status = $2${extra} where id = $1`, [id, status]);

async function row(c: pg.PoolClient, id: string) {
  return (await c.query('select * from complaints where id = $1', [id])).rows[0];
}

async function staffFixture(c: pg.PoolClient) {
  await c.query(`insert into auth_users (id, name, email, email_verified) values ($1, 'Ravi Kumar', 'ravi@test.edu', true)`, [STAFF]);
  const dept = (await catId(c, 'electrical')).department_id;
  await c.query(`update profiles set role = 'department_staff', service_department_id = $2 where id = $1`, [STAFF, dept]);
}

describe('complaint schema (02)', () => {
  it('CDT-01: seeds the 7 Flutter departments and categories', () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select c.slug, c.name, c.icon, c.color, d.name as dept, c.sort_order
           from complaint_categories c join service_departments d on d.id = c.department_id order by c.sort_order`,
      );
      expect(rows.map((r) => [r.slug, r.name, r.icon, r.color, r.dept, r.sort_order])).toEqual(SEED_CATEGORIES.map((c) => [...c]));
      expect((await c.query('select count(*)::int as n from service_departments')).rows[0].n).toBe(7);
    }));

  it('CDT-02 / CDT-10: department_staff needs exactly one service department', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const dept = (await catId(c, 'plumbing')).department_id;
      // A new auth user always starts as a student without a department.
      expect((await c.query('select role, service_department_id from profiles where id = $1', [ID.stu1])).rows[0]).toEqual({
        role: 'student',
        service_department_id: null,
      });
      expect(await attempt(c, `update profiles set role = 'department_staff' where id = $1`, [ID.stu1])).toBe('23514');
      expect(await attempt(c, `update profiles set service_department_id = $2 where id = $1`, [ID.stu1, dept])).toBe('23514');
      expect(await attempt(c, `update profiles set role = 'department_staff', service_department_id = $2 where id = $1`, [ID.stu1, dept])).toBeNull();
      expect(await attempt(c, `update profiles set role = 'student' where id = $1`, [ID.stu1])).toBe('23514');
      expect(await attempt(c, `update profiles set role = 'student', service_department_id = null where id = $1`, [ID.stu1])).toBeNull();
      expect(await attempt(c, `update profiles set role = 'janitor' where id = $1`, [ID.stu1])).toBe('23514');
    }));

  it('CDT-03: allows exactly the §6.2 transitions; withdrawn and closed are final', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await actAs(c, ID.admin);
      // pending_review → in_progress → awaiting → in_progress (rejected) → awaiting → resolved → in_progress (reopen)
      const a = await newComplaint(c);
      expect(await setStatus(c, a, 'awaiting_confirmation')).toBe('CC001');
      expect(await setStatus(c, a, 'resolved')).toBe('CC001');
      expect(await setStatus(c, a, 'pending_review')).toBeNull(); // no-op (same status)
      expect(await setStatus(c, a, 'in_progress')).toBeNull();
      expect(await setStatus(c, a, 'resolved')).toBe('CC001');
      expect(await setStatus(c, a, 'withdrawn')).toBe('CC001');
      expect(await setStatus(c, a, 'pending_review')).toBe('CC001'); // only together with a reassignment (CDT-04)
      expect(await setStatus(c, a, 'awaiting_confirmation')).toBeNull();
      expect(await setStatus(c, a, 'pending_review')).toBe('CC001');
      expect(await setStatus(c, a, 'in_progress', ", rejection_reason = 'Still noisy'")).toBeNull();
      expect(await setStatus(c, a, 'awaiting_confirmation')).toBeNull();
      expect(await setStatus(c, a, 'resolved')).toBeNull();
      expect(await setStatus(c, a, 'awaiting_confirmation')).toBe('CC001');
      expect(await setStatus(c, a, 'closed', ", closure_type = 'other', closure_reason = 'Late'")).toBe('CC001');
      expect(await setStatus(c, a, 'in_progress')).toBeNull();

      // withdrawn is final
      const b = await newComplaint(c);
      expect(await setStatus(c, b, 'withdrawn')).toBeNull();
      expect(await setStatus(c, b, 'in_progress')).toBe('CC001');
      expect(await attempt(c, `update complaints set title = 'Changed title' where id = $1`, [b])).toBe('CC001');

      // closed (needs a type and reason) is final, from pending, in progress and awaiting
      const d = await newComplaint(c);
      expect(await setStatus(c, d, 'closed')).toBe('23514');
      expect(await setStatus(c, d, 'closed', ", closure_type = 'duplicate', closure_reason = 'Same as CMP-1'")).toBeNull();
      expect(await setStatus(c, d, 'pending_review')).toBe('CC001');
      for (const from of ['in_progress', 'awaiting_confirmation']) {
        const e = await newComplaint(c);
        await setStatus(c, e, 'in_progress');
        if (from === 'awaiting_confirmation') await setStatus(c, e, 'awaiting_confirmation');
        expect(await setStatus(c, e, 'closed', ", closure_type = 'invalid', closure_reason = 'Spam report'")).toBeNull();
      }
    }));

  it('CDT-04: in_progress → pending_review only together with a reassignment; never once awaiting or later', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await actAs(c, ID.admin);
      const plumbing = await catId(c, 'plumbing');
      const id = await newComplaint(c);
      await setStatus(c, id, 'in_progress');
      expect(await setStatus(c, id, 'pending_review')).toBe('CC001');
      expect(
        await attempt(c, `update complaints set status = 'pending_review', category_id = $2, department_id = $3 where id = $1`, [
          id,
          plumbing.id,
          plumbing.department_id,
        ]),
      ).toBeNull();
      // Reassigning a pending complaint keeps it pending.
      const it2 = await catId(c, 'it_network');
      expect(await attempt(c, `update complaints set category_id = $2, department_id = $3 where id = $1`, [id, it2.id, it2.department_id])).toBeNull();
      await setStatus(c, id, 'in_progress');
      await setStatus(c, id, 'awaiting_confirmation');
      expect(
        await attempt(c, `update complaints set category_id = $2, department_id = $3 where id = $1`, [id, plumbing.id, plumbing.department_id]),
      ).toBe('CC001');
    }));

  it('CDT-05: maintains timestamps, handler, reason and flags', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await staffFixture(c);
      await actAs(c, STAFF);
      const id = await newComplaint(c);
      expect((await row(c, id)).reference).toMatch(/^CMP-\d{4}-\d{6}$/);
      await c.query(`update complaints set status = 'in_progress', handled_by = $2 where id = $1`, [id, STAFF]);
      let r = await row(c, id);
      expect(r.work_started_at).not.toBeNull();
      expect(r.version).toBe(2);
      await setStatus(c, id, 'awaiting_confirmation', ", resolution_note = 'Replaced the regulator'");
      expect((await row(c, id)).work_completed_at).not.toBeNull();
      await setStatus(c, id, 'in_progress', ", rejection_reason = 'Still noisy'");
      await setStatus(c, id, 'awaiting_confirmation');
      await setStatus(c, id, 'resolved');
      r = await row(c, id);
      expect(r.resolved_at).not.toBeNull();
      expect(r.rejection_reason).toBeNull();
      await setStatus(c, id, 'in_progress');
      expect((await row(c, id)).resolved_at).toBeNull();

      // Reassignment clears the handler, the start time and the request flag.
      await c.query(`update complaints set reassignment_requested = true, reassignment_note = 'Water leak' where id = $1`, [id]);
      const plumbing = await catId(c, 'plumbing');
      await c.query(`update complaints set status = 'pending_review', category_id = $2, department_id = $3 where id = $1`, [
        id,
        plumbing.id,
        plumbing.department_id,
      ]);
      r = await row(c, id);
      expect([r.handled_by, r.work_started_at, r.reassignment_requested, r.reassignment_note]).toEqual([null, null, false, null]);
      expect(await attempt(c, `update complaints set reassignment_requested = true where id = $1`, [id])).toBe('23514');
      expect(await attempt(c, `update complaints set reporter_id = $2 where id = $1`, [id, ID.stu2])).toBe('CC003');
      expect(await attempt(c, `update complaints set reference = 'CMP-X' where id = $1`, [id])).toBe('CC003');
    }));

  it('CDT-06: writes one history row per change with the right event type', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await staffFixture(c);
      const id = await newComplaint(c);
      await actAs(c, STAFF, 'Will check after 2 pm');
      await setStatus(c, id, 'in_progress');
      await actAs(c, STAFF, 'Wrong department');
      await c.query(`update complaints set reassignment_requested = true, reassignment_note = 'Water leak' where id = $1`, [id]);
      await actAs(c, ID.admin, 'Electrical after all');
      await c.query(`update complaints set reassignment_requested = false, reassignment_note = null where id = $1`, [id]);
      await actAs(c, STAFF);
      await setStatus(c, id, 'awaiting_confirmation');
      await actAs(c, ID.stu1, 'Still noisy');
      await setStatus(c, id, 'in_progress', ", rejection_reason = 'Still noisy'");
      await actAs(c, STAFF);
      await setStatus(c, id, 'awaiting_confirmation');
      await actAs(c, null); // the auto-resolve job
      await setStatus(c, id, 'resolved');
      await actAs(c, ID.stu1, 'Broken again');
      await setStatus(c, id, 'in_progress');
      await actAs(c, ID.stu1);
      await c.query(`update complaints set title = 'Fan not working at all' where id = $1`, [id]); // no event
      const plumbing = await catId(c, 'plumbing');
      await actAs(c, ID.admin, 'Moved');
      await c.query(`update complaints set status = 'pending_review', category_id = $2, department_id = $3 where id = $1`, [
        id,
        plumbing.id,
        plumbing.department_id,
      ]);
      const { rows } = await c.query(
        'select event_type, from_status, to_status, actor_id, note, changes from complaint_history where complaint_id = $1 order by id',
        [id],
      );
      expect(rows.map((r) => r.event_type)).toEqual([
        'submitted',
        'work_started',
        'reassignment_requested',
        'reassignment_dismissed',
        'work_completed',
        'rejected',
        'work_completed',
        'auto_resolved',
        'reopened',
        'reassigned',
      ]);
      expect(rows[0].actor_id).toBe(ID.stu1);
      expect(rows[1].note).toBe('Will check after 2 pm');
      expect(rows[7].actor_id).toBeNull();
      expect(rows[8].actor_id).toBe(ID.stu1);
      expect(rows[9].changes.departmentId.to).toBe(plumbing.department_id);
    }));

  it('CDT-07: at most 3 attachments per complaint and kind', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const id = await newComplaint(c);
      const insert = (kind: string, n: number) =>
        attempt(
          c,
          `insert into complaint_attachments (complaint_id, kind, storage_path, thumb_path, size_bytes, width, height, uploaded_by)
           values ($1, $2, $3, $4, 1000, 640, 480, $5)`,
          [id, kind, `complaints/${id}/${kind}${n}.webp`, `complaints/${id}/${kind}${n}_thumb.webp`, ID.stu1],
        );
      for (const n of [1, 2, 3]) expect(await insert('report', n)).toBeNull();
      expect(await insert('report', 4)).toBe('CC002');
      for (const n of [1, 2, 3]) expect(await insert('resolution', n)).toBeNull();
      expect(await insert('resolution', 4)).toBe('CC002');
      expect(await insert('other', 5)).toBe('23514');
    }));

  it('CDT-09: auto_resolve_complaints() resolves only stale awaiting complaints, and does nothing when off', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      await actAs(c, ID.admin);
      const stale = await newComplaint(c);
      const fresh = await newComplaint(c);
      const working = await newComplaint(c);
      for (const id of [stale, fresh, working]) await setStatus(c, id, 'in_progress');
      for (const id of [stale, fresh]) await setStatus(c, id, 'awaiting_confirmation');
      // Age the stale one (work_completed_at is maintained by the guard only on status changes).
      await c.query(`update complaints set work_completed_at = now() - interval '8 days' where id = $1`, [stale]);
      await c.query('update app_settings set complaint_auto_resolve_days = null where id = 1');
      expect((await c.query('select auto_resolve_complaints() as n')).rows[0].n).toBe(0);
      await c.query('update app_settings set complaint_auto_resolve_days = 7 where id = 1');
      expect((await c.query('select auto_resolve_complaints() as n')).rows[0].n).toBe(1);
      expect((await row(c, stale)).status).toBe('resolved');
      expect((await row(c, fresh)).status).toBe('awaiting_confirmation');
      expect((await row(c, working)).status).toBe('in_progress');
      const h = (await c.query(`select event_type, actor_id, note from complaint_history where complaint_id = $1 order by id desc limit 1`, [stale])).rows[0];
      expect(h).toEqual({ event_type: 'auto_resolved', actor_id: null, note: 'Automatically resolved: no response from the reporter within 7 days.' });
    }));

  it('CDT-11: complaint settings constraints', () =>
    withRollback(async (c) => {
      const set = (sql: string) => attempt(c, `update app_settings set ${sql} where id = 1`);
      expect(await set('complaint_reopen_window_days = 0')).toBeNull();
      expect(await set('complaint_reopen_window_days = 60')).toBeNull();
      expect(await set('complaint_reopen_window_days = 61')).toBe('23514');
      expect(await set('complaint_auto_resolve_days = null')).toBeNull();
      expect(await set('complaint_auto_resolve_days = 1')).toBeNull();
      expect(await set('complaint_auto_resolve_days = 0')).toBe('23514');
      expect(await set('complaint_max_open_per_user = 0')).toBe('23514');
      expect(await attempt(c, `insert into audit_logs (action, entity_type, summary) values ('complaint.closed', 'complaint', 'x')`)).toBeNull();
    }));

  it('validates text lengths, slugs, icons and colours', () =>
    withRollback(async (c) => {
      await baseFixtures(c);
      const cat = await catId(c, 'electrical');
      const ins = (title: string) =>
        attempt(c, `insert into complaints (reporter_id, category_id, department_id, title) values ($1, $2, $3, $4)`, [ID.stu1, cat.id, cat.department_id, title]);
      expect(await ins('ab')).toBe('23514');
      expect(await ins('x'.repeat(121))).toBe('23514');
      // Counted in characters, not bytes (CEC-28). Older local clusters were created as WIN1252 and can't store emoji.
      const utf8 = (await c.query('show server_encoding')).rows[0].server_encoding === 'UTF8';
      if (utf8) expect(await ins('🔌🔌🔌')).toBeNull();
      expect(await ins('Fan é')).toBeNull();
      const dept = cat.department_id;
      const cat2 = (slug: string, icon = 'zap', color = '#112233') =>
        attempt(c, `insert into complaint_categories (slug, name, icon, color, department_id) values ($1, $1, $2, $3, $4)`, [slug, icon, color, dept]);
      expect(await cat2('Bad Slug')).toBe('23514');
      expect(await cat2('ok_slug', 'not-an-icon')).toBe('23514');
      expect(await cat2('ok_slug', 'zap', 'red')).toBe('23514');
      expect(await cat2('ok_slug')).toBeNull();
      expect(await attempt(c, `insert into service_departments (name) values ('electrical department ')`)).toBe('23505');
    }));
});
