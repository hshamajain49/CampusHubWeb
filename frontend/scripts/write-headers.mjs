// Writes dist/_headers for Cloudflare Pages from headers.template, inserting the API origin into the CSP (spec 30.4).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let origin = process.env.VITE_API_ORIGIN;
if (!origin) {
  for (const f of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const m = /^VITE_API_ORIGIN=(.*)$/m.exec(fs.readFileSync(p, 'utf8'));
    if (m) {
      origin = m[1].trim();
      break;
    }
  }
}
if (!origin) throw new Error('VITE_API_ORIGIN is required to write the CSP');
const out = fs.readFileSync(path.join(dir, 'headers.template'), 'utf8').replace('__API_ORIGIN__', new URL(origin).origin);
fs.writeFileSync(path.join(dir, 'dist', '_headers'), out);
console.log(`[headers] dist/_headers written (connect-src ${new URL(origin).origin})`);
