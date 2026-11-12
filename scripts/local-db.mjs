// Local PostgreSQL 17 without Docker (embedded-postgres). Starts a dev cluster on :5432 (db "campushub")
// and a test cluster on :5433 (db "campushub_test") with user/password campushub/campushub, then exits —
// the servers keep running in the background. `node scripts/local-db.mjs stop` stops them.
// With Docker available, `npm run db:up` (docker-compose.yml) is the equivalent.
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLUSTERS = [
  { name: 'dev', port: 5432, db: 'campushub', dir: path.join(root, '.localdb', 'dev') },
  { name: 'test', port: 5433, db: 'campushub_test', dir: path.join(root, '.localdb', 'test') },
];
const USER = 'campushub';
const PASSWORD = 'campushub';

async function canConnect(port, database = 'postgres') {
  const c = new pg.Client({ host: 'localhost', port, user: USER, password: PASSWORD, database, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

// pg_ctl starts a detached server that outlives this script (embedded-postgres' own start() is a child process).
function pgCtl() {
  const pkg = { win32: '@embedded-postgres/windows-x64', darwin: process.arch === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64', linux: process.arch === 'arm64' ? '@embedded-postgres/linux-arm64' : '@embedded-postgres/linux-x64' }[process.platform];
  const dir = path.join(root, 'node_modules', pkg);
  return path.join(dir, 'native', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
}

function server(c) {
  return new EmbeddedPostgres({
    databaseDir: c.dir, user: USER, password: PASSWORD, port: c.port, persistent: true,
    // UTF-8 like Neon; Windows initdb otherwise picks the ANSI codepage (WIN1252), which can't store emoji or
    // non-Latin text. Applies to new clusters only (delete .localdb/ to recreate existing ones).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: (e) => { if (process.env.LOCALDB_VERBOSE) console.error(String(e)); },
  });
}

async function start(c) {
  if (await canConnect(c.port)) {
    console.log(`[db] ${c.name} cluster already running on :${c.port}`);
  } else {
    const s = server(c);
    if (!fs.existsSync(path.join(c.dir, 'PG_VERSION'))) {
      console.log(`[db] initialising ${c.name} cluster in ${path.relative(root, c.dir)} …`);
      await s.initialise();
    }
    const pid = path.join(c.dir, 'postmaster.pid');
    if (fs.existsSync(pid)) fs.rmSync(pid); // stale after an unclean shutdown (the port is free)
    execFileSync(pgCtl(), ['-D', c.dir, '-l', path.join(c.dir, 'server.log'), '-o', `-p ${c.port}`, '-w', 'start'], { stdio: 'ignore' });
    console.log(`[db] ${c.name} cluster started on :${c.port}`);
  }
  const admin = new pg.Client({ host: 'localhost', port: c.port, user: USER, password: PASSWORD, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [c.db]);
  if (exists.rowCount === 0) {
    await admin.query(`create database ${c.db}`);
    console.log(`[db] created database ${c.db}`);
  }
  await admin.end();
}

async function stop(c) {
  if (!(await canConnect(c.port))) return console.log(`[db] ${c.name} cluster is not running`);
  execFileSync(pgCtl(), ['-D', c.dir, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  console.log(`[db] ${c.name} cluster stopped`);
}

const cmd = process.argv[2] ?? 'start';
try {
  for (const c of CLUSTERS) await (cmd === 'stop' ? stop(c) : start(c));
  if (cmd !== 'stop') console.log('[db] ready: postgresql://campushub:campushub@localhost:5432/campushub (test: :5433/campushub_test)');
  process.exit(0);
} catch (err) {
  console.error('[db] failed:', err?.message ?? err);
  console.error('    If port 5432/5433 is used by another PostgreSQL, stop it or use Docker (npm run db:up).');
  process.exit(1);
}
