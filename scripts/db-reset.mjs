// Rebuilds the LOCAL dev database: drop, create, migrate, seed (database/seed/dev.sql). Refuses non-local URLs.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnvFile(path.join(root, 'backend', '.env'));
const url = new URL(process.env.DATABASE_URL ?? env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
  console.error(`Refusing to reset a non-local database (${url.hostname}).`);
  process.exit(1);
}
const dbName = url.pathname.slice(1);
const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [dbName]);
await admin.query(`drop database if exists ${dbName}`);
await admin.query(`create database ${dbName}`);
await admin.end();
console.log(`[db:reset] recreated ${dbName}`);
execSync('npm run db:migrate', { cwd: root, stdio: 'inherit' });
const seed = fs.readFileSync(path.join(root, 'database', 'seed', 'dev.sql'), 'utf8');
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
await c.query(seed);
await c.end();
console.log('[db:reset] seeded database/seed/dev.sql — run `npm run seed:dev -w @campushub/backend` for users and bookings');
