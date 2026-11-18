// Runs once before the e2e suite. Better Auth's sign-in limits live in Postgres (security/AUDIT.md F-06), so they
// survive an API restart: one run signs in about 60 times, and a second run within 5 minutes would trip the dev
// limit (100 per 5 minutes per address). This clears the loopback windows, on a local database only.
import pg from 'pg';

export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return;
  const db = new pg.Client({ connectionString: url });
  try {
    await db.connect();
    await db.query(`delete from public.auth_rate_limits where key like '127.0.0.1|%' or key like '::1|%'`);
  } catch {
    // Older schema without the table, or the database isn't up yet: the tests will say so themselves.
  } finally {
    await db.end().catch(() => undefined);
  }
}
