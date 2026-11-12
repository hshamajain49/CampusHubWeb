// §14.10 helpers: each DB test runs in a rolled-back transaction; expected failures run in a savepoint.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function testUrl(): string {
  const file = path.resolve(process.cwd(), '.env.test');
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('TEST_DATABASE_URL='));
  const url = new URL(process.env.TEST_DATABASE_URL ?? line!.split('=').slice(1).join('='));
  url.searchParams.delete('sslmode');
  return url.toString();
}

export const pool = new pg.Pool({ connectionString: testUrl(), max: 4 });

export async function withRollback(fn: (c: pg.PoolClient) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** Runs sql in a savepoint and returns the SQLSTATE it failed with, or null on success. */
export async function attempt(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query('savepoint t');
  try {
    await c.query(sql, params);
    await c.query('release savepoint t');
    return null;
  } catch (e: any) {
    await c.query('rollback to savepoint t');
    return e.code ?? 'unknown';
  }
}

export const ID = {
  stu1: '00000000-0000-0000-0000-0000000000a1',
  stu2: '00000000-0000-0000-0000-0000000000a2',
  admin: '00000000-0000-0000-0000-0000000000ad',
  venue: '00000000-0000-0000-0000-000000000101',
  booking1: '00000000-0000-0000-0000-000000000b01',
};

/** Inserts auth users (the trigger creates profiles), promotes the admin, and adds one venue. */
export async function baseFixtures(c: pg.PoolClient) {
  await c.query(
    `insert into auth_users (id, name, email, email_verified) values
      ($1, 'Student One', 'stu1@test.edu', true), ($2, 'Student Two', 'stu2@test.edu', true),
      ($3, 'Admin User', 'admin@test.edu', true)`,
    [ID.stu1, ID.stu2, ID.admin],
  );
  await c.query(`update profiles set role = 'super_admin' where id = $1`, [ID.admin]);
  await c.query(
    `insert into venues (id, name, venue_type, building, capacity, description)
     values ($1, 'Test Hall', 'seminar_hall', 'Block T', 100, 'Test venue')`,
    [ID.venue],
  );
}

/** Wipes mutable data between integration files (§28.9). */
export async function truncateAll() {
  await pool.query(
    `truncate notifications, email_log, booking_reminders, push_subscriptions, booking_history, bookings,
              venue_blocks, audit_logs, complaint_history, complaint_attachments, complaints, venues restart identity cascade`,
  );
  await pool.query('update app_settings set updated_by = null where id = 1');
  await pool.query('delete from auth_users');
  await resetComplaintSetup();
  await pool.query(
    `update app_settings set campus_timezone = 'UTC', self_registration_enabled = true, allowed_email_domains = '{}',
            max_pending_per_user = 5, min_lead_time_minutes = 0, cancellation_cutoff_minutes = 0,
            modification_cutoff_minutes = 0, complaint_auto_resolve_days = 7, complaint_reopen_window_days = 7,
            complaint_max_open_per_user = 10 where id = 1`,
  );
}

/** The 7 departments and categories seeded by 20261112000100_complaints_core.sql (§10.1). */
export const SEED_CATEGORIES = [
  ['electrical', 'Electrical', 'zap', '#E09B10', 'Electrical Department', 10],
  ['plumbing', 'Plumbing', 'droplets', '#2F7BD8', 'Plumbing Department', 20],
  ['it_network', 'IT/Network', 'wifi', '#5B5BD6', 'IT Department', 30],
  ['furniture', 'Furniture', 'armchair', '#B0703A', 'Furniture/Carpentry Department', 40],
  ['cleanliness', 'Cleanliness', 'spray-can', '#1F9D63', 'Housekeeping Department', 50],
  ['civil_infrastructure', 'Civil/Infrastructure', 'brick-wall', '#64748B', 'Civil/Maintenance Department', 60],
  ['other', 'Other', 'ellipsis', '#E5654B', 'General Administration', 70],
] as const;

/** Restores the seeded departments/categories and removes ones created by tests (complaints must be gone first). */
export async function resetComplaintSetup() {
  const slugs = SEED_CATEGORIES.map((c) => c[0]);
  const depts = SEED_CATEGORIES.map((c) => c[4]);
  await pool.query('delete from complaint_categories where slug <> all($1::text[])', [slugs]);
  await pool.query('update service_departments set is_active = true, description = null where name = any($1::text[])', [depts]);
  for (const [slug, name, icon, color, dept, order] of SEED_CATEGORIES) {
    await pool.query(
      `update complaint_categories set name = $2, icon = $3, color = $4, sort_order = $6, is_active = true, description = null,
              department_id = (select id from service_departments where name = $5)
        where slug = $1`,
      [slug, name, icon, color, dept, order],
    );
  }
  await pool.query('delete from service_departments where name <> all($1::text[])', [depts]);
}
