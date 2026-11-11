// Creates (or promotes) a Super Admin on the Neon production branch.
//
//   neon env pull --branch production --file .env.production.local     (once; the file is gitignored)
//   npm run create-super-admin:prod -- --email admin@college.edu --name "Venue Administrator"
//
// Why a wrapper: backend/.env points at the dev branch and its values win over shell variables (see
// backend/src/config/env.ts), so `DATABASE_URL=... npm run create-super-admin` would silently hit dev. This passes
// the production values straight to the script with ENV_FILE=none. Nothing is written to disk.
// `--env <file>` targets another branch's pulled env file instead (e.g. --env .env.local for dev).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const envFile = path.resolve(root, envFlag >= 0 ? args.splice(envFlag, 2)[1] ?? '' : '.env.production.local');

if (!fs.existsSync(envFile)) {
  console.error(`${path.relative(root, envFile)} not found. Run: neon env pull --branch production --file .env.production.local`);
  process.exit(1);
}
const file = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('#'))
    .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
);

const databaseUrl = file.DATABASE_URL_UNPOOLED; // direct endpoint: the pool sets startup options PgBouncer rejects
if (!databaseUrl) {
  console.error(`${path.relative(root, envFile)} has no DATABASE_URL_UNPOOLED (re-run neon env pull).`);
  process.exit(1);
}
const host = new URL(databaseUrl).hostname;
console.log(`Target: Neon branch "${file.NEON_BRANCH ?? 'unknown'}" (${host.replace(/^(ep-[a-z]+-[a-z]+)-[^.]+/, '$1-…')})`);

const random = () => randomBytes(32).toString('hex');
const env = {
  ...process.env,
  ENV_FILE: 'none',
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: 'true',
  NEON_BRANCH: file.NEON_BRANCH ?? '',
  // The script only hashes a password and writes rows; these satisfy config validation and are never used.
  // (Better Auth hashes passwords with scrypt; the secret plays no part in the hash.)
  BETTER_AUTH_SECRET: file.BETTER_AUTH_SECRET || random(),
  CRON_SECRET: file.CRON_SECRET || random(),
  BETTER_AUTH_URL: 'http://localhost:4000',
  FRONTEND_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  EMAIL_TRANSPORT: 'console',
  IMAGE_STORE: 'neon',
  AWS_ENDPOINT_URL_S3: file.AWS_ENDPOINT_URL_S3 ?? '',
  AWS_REGION: file.AWS_REGION ?? '',
  AWS_ACCESS_KEY_ID: file.AWS_ACCESS_KEY_ID ?? '',
  AWS_SECRET_ACCESS_KEY: file.AWS_SECRET_ACCESS_KEY ?? '',
};

const tsx = createRequire(path.join(root, 'backend', 'package.json')).resolve('tsx/cli');
const result = spawnSync(process.execPath, [tsx, 'src/scripts/create-super-admin.ts', ...args], {
  cwd: path.join(root, 'backend'),
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
