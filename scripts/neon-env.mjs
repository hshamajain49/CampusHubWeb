// Points the API at the Neon branch the CLI last pulled into the repo-root .env.local
// (written by `neon deploy`, `neon checkout <branch>` and `neon env pull`).
//
//   npm run neon:env          write/refresh the managed Neon block in backend/.env
//   npm run neon:env -- --off remove it and restore the local-cluster values
//
// Mapping: DATABASE_URL ← DATABASE_URL_UNPOOLED (the API and migrations need the direct endpoint, see backend/src/db/pool.ts);
// AWS_* are copied as-is for IMAGE_STORE=neon. Conflicting earlier lines are commented out with a marker, so --off can
// restore them. No secret is printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from './env-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const neonFile = path.join(root, '.env.local');
const backendFile = path.join(root, 'backend', '.env');
const BEGIN = '# >>> neon (managed by `npm run neon:env`; source: ../.env.local) >>>';
const END = '# <<< neon <<<';
const MARK = '#neon-off# ';
const MANAGED = ['DATABASE_URL', 'DATABASE_SSL', 'IMAGE_STORE', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'NEON_BRANCH'];

if (!fs.existsSync(backendFile)) {
  console.error('[neon:env] backend/.env not found — copy backend/.env.example first.');
  process.exit(1);
}

// Drop any previous block and restore lines it had commented out.
const lines = [];
let inBlock = false;
for (const line of fs.readFileSync(backendFile, 'utf8').split(/\r?\n/)) {
  if (line === BEGIN) { inBlock = true; continue; }
  if (line === END) { inBlock = false; continue; }
  if (inBlock) continue;
  lines.push(line.startsWith(MARK) ? line.slice(MARK.length) : line);
}
while (lines.length && lines.at(-1) === '') lines.pop();

if (process.argv.includes('--off')) {
  fs.writeFileSync(backendFile, `${lines.join('\n')}\n`);
  console.log('[neon:env] removed the Neon block; backend/.env uses its own DATABASE_URL and IMAGE_STORE again.');
  process.exit(0);
}

const neon = readEnvFile(neonFile);
const direct = neon.DATABASE_URL_UNPOOLED;
if (!direct) {
  console.error('[neon:env] .env.local has no DATABASE_URL_UNPOOLED — run `neon env pull` (or `neon deploy`) first.');
  process.exit(1);
}
const block = {
  DATABASE_URL: direct,
  DATABASE_SSL: 'true',
  NEON_BRANCH: neon.NEON_BRANCH ?? '',
};
if (neon.AWS_ENDPOINT_URL_S3) {
  Object.assign(block, {
    IMAGE_STORE: 'neon',
    AWS_ENDPOINT_URL_S3: neon.AWS_ENDPOINT_URL_S3,
    AWS_REGION: neon.AWS_REGION ?? '',
    AWS_ACCESS_KEY_ID: neon.AWS_ACCESS_KEY_ID ?? '',
    AWS_SECRET_ACCESS_KEY: neon.AWS_SECRET_ACCESS_KEY ?? '',
  });
}

const out = lines.map((line) => {
  const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
  return key && MANAGED.includes(key) && key in block ? `${MARK}${line}` : line;
});
out.push('', BEGIN, ...Object.entries(block).map(([k, v]) => `${k}=${v}`), END);
fs.writeFileSync(backendFile, `${out.join('\n')}\n`);

const host = new URL(direct).hostname;
console.log(`[neon:env] backend/.env → Neon branch "${block.NEON_BRANCH || '?'}" (${host})${block.IMAGE_STORE ? ', IMAGE_STORE=neon' : ''}`);
