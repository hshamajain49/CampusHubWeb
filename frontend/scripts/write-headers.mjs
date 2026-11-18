// Writes dist/_headers for Cloudflare Pages from headers.template, inserting the API origin (and, when visitor
// analytics is configured, the CampusHub Sentinel origin) into the CSP's connect-src (spec 30.4).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** process.env first, then the Vite env files in Vite's order of precedence. */
function envValue(name) {
  if (process.env[name]) return process.env[name];
  for (const f of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const m = new RegExp(`^${name}=(.*)$`, 'm').exec(fs.readFileSync(p, 'utf8'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return undefined;
}

const api = envValue('VITE_API_ORIGIN');
if (!api) throw new Error('VITE_API_ORIGIN is required to write the CSP');
const sentinel = envValue('VITE_SENTINEL_URL');

const out = fs
  .readFileSync(path.join(dir, 'headers.template'), 'utf8')
  .replace('__API_ORIGIN__', new URL(api).origin)
  .replace(' __SENTINEL_ORIGIN__', sentinel ? ` ${new URL(sentinel).origin}` : '');
fs.writeFileSync(path.join(dir, 'dist', '_headers'), out);
console.log(`[headers] dist/_headers written (connect-src ${new URL(api).origin}${sentinel ? ` + ${new URL(sentinel).origin}` : ''})`);
