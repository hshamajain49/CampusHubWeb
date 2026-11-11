// pg (node-postgres) pool on Neon's DIRECT endpoint (§10.5). Per-connection settings need a session-mode connection.
import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Campus wall-clock values stay naive strings — never converted through the process timezone.
pg.types.setTypeParser(1082, (v) => v); // date        → 'YYYY-MM-DD'
pg.types.setTypeParser(1083, (v) => v); // time        → 'HH:mm:ss'
pg.types.setTypeParser(1114, (v) => v); // timestamp   → 'YYYY-MM-DD HH:mm:ss'
(pg.types.setTypeParser as (oid: number, fn: (v: string) => unknown) => void)(3908, (v) => v); // tsrange     → '["…","…")'
pg.types.setTypeParser(20, (v) => Number(v)); // int8 (count(*), identity ids) → number

// Neon's pooled (-pooler) endpoint is PgBouncer in transaction mode and rejects the startup `options` below
// ("unsupported startup parameter"), so DATABASE_URL must be the direct endpoint. A long-running API with a pool of
// DATABASE_POOL_MAX connections doesn't need PgBouncer.
const dbUrl = new URL(config.DATABASE_URL);
if (dbUrl.hostname.includes('-pooler.')) {
  throw new Error('DATABASE_URL points at a Neon -pooler endpoint; use the direct (DATABASE_URL_UNPOOLED) string');
}
// sslmode/channel_binding are libpq options; TLS is configured below with certificate verification instead.
const sslRequested = config.DATABASE_SSL || ['require', 'verify-ca', 'verify-full'].includes(dbUrl.searchParams.get('sslmode') ?? '');
dbUrl.searchParams.delete('sslmode');
dbUrl.searchParams.delete('channel_binding');

/** Host of the configured database, for startup logs (no credentials). */
export const databaseHost = dbUrl.hostname;

export const pool = new pg.Pool({
  connectionString: dbUrl.toString(),
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: sslRequested ? { rejectUnauthorized: true } : false,
  application_name: 'campushub-api',
  // Session settings applied at connection startup (no extra round trip, no race with the first query).
  options: '-c statement_timeout=10s -c lock_timeout=5s -c idle_in_transaction_session_timeout=15s -c TimeZone=UTC',
});

// Neon closes idle connections when compute scales to zero; the pool replaces them on the next query.
pool.on('error', (err) => logger.warn({ err: err.message }, 'idle database client error'));

export type DbClient = pg.Pool | pg.PoolClient;
