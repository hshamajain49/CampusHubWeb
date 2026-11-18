// 20261118000100_least_privilege_rate_limits.sql (security/AUDIT.md F-04, F-06): the audit log is append-only for
// every role, campushub_app has data access only, and the rate-limit upsert counts atomically.
import { afterAll, describe, expect, it } from 'vitest';
import { attempt, baseFixtures, ID, pool, withRollback } from '../helpers/db.js';

afterAll(() => pool.end());

async function auditRow(c: Parameters<Parameters<typeof withRollback>[0]>[0], actor: string | null = ID.admin): Promise<number> {
  const { rows } = await c.query(
    `insert into audit_logs (actor_id, action, entity_type, entity_id, summary) values ($1, 'venue.updated', 'venue', $2, 'Updated Hall') returning id`,
    [actor, ID.venue],
  );
  return rows[0].id;
}

describe('audit_logs is append-only (F-04)', () => {
  it('refuses UPDATE and DELETE, even for the owner', async () => {
    await withRollback(async (c) => {
      await baseFixtures(c);
      const id = await auditRow(c);
      expect(await attempt(c, `update audit_logs set summary = 'Nothing happened' where id = $1`, [id])).toBe('CA001');
      expect(await attempt(c, `update audit_logs set actor_id = null, summary = 'x' where id = $1`, [id])).toBe('CA001');
      expect(await attempt(c, `update audit_logs set actor_id = $2 where id = $1`, [id, ID.stu1])).toBe('CA001');
      expect(await attempt(c, `delete from audit_logs where id = $1`, [id])).toBe('CA001');
    });
  });

  it('still lets account deletion null the actor (the foreign key), keeping the entry', async () => {
    await withRollback(async (c) => {
      await baseFixtures(c);
      const id = await auditRow(c, ID.stu1);
      expect(await attempt(c, 'delete from auth_users where id = $1', [ID.stu1])).toBeNull();
      const { rows } = await c.query('select actor_id, summary from audit_logs where id = $1', [id]);
      expect(rows[0]).toEqual({ actor_id: null, summary: 'Updated Hall' });
    });
  });
});

describe('campushub_app has data access only (F-04)', () => {
  it('can read and write application tables and append to the audit log', async () => {
    await withRollback(async (c) => {
      await baseFixtures(c);
      await c.query('set local role campushub_app');
      expect(await attempt(c, 'select count(*) from bookings')).toBeNull();
      expect(await attempt(c, `update venues set capacity = 90 where id = $1`, [ID.venue])).toBeNull();
      expect(await attempt(c, `insert into audit_logs (action, entity_type, summary) values ('venue.updated', 'venue', 'x')`)).toBeNull();
      expect(await attempt(c, `insert into auth_rate_limits (key, count) values ('203.0.113.9|/sign-in/email', 1)`)).toBeNull();
    });
  });

  it('cannot change or erase the audit log, run DDL, or touch the migration history', async () => {
    await withRollback(async (c) => {
      await baseFixtures(c);
      await auditRow(c);
      await c.query('set local role campushub_app');
      expect(await attempt(c, `update audit_logs set summary = 'x'`)).toBe('42501');
      expect(await attempt(c, 'delete from audit_logs')).toBe('42501');
      expect(await attempt(c, 'truncate audit_logs')).toBe('42501');
      expect(await attempt(c, 'truncate bookings cascade')).toBe('42501');
      expect(await attempt(c, 'drop table venues cascade')).toBe('42501');
      expect(await attempt(c, 'alter table bookings disable trigger all')).toBe('42501');
      expect(await attempt(c, 'create table public.evil (id int)')).toBe('42501');
      expect(await attempt(c, 'select * from schema_migrations')).toBe('42501');
    });
  });
});
