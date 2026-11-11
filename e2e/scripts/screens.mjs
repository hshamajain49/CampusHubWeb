// Visual QA harness: signs in through the real API, screenshots every screen at the given viewports,
// and reports console/page errors. Usage: node e2e/scripts/screens.mjs <outDir> [filter] [--mobile] [--full]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = process.env.E2E_API_ORIGIN ?? 'http://localhost:4000';
const out = process.argv[2] ?? 'screens';
const filter = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '';
const mobile = process.argv.includes('--mobile');
const full = process.argv.includes('--full');
fs.mkdirSync(out, { recursive: true });

async function token(email, password) {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB },
    body: JSON.stringify({ email, password }),
  });
  const t = res.headers.get('set-auth-token');
  if (!t) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return t;
}
async function api(tok, p) {
  const r = await fetch(`${API}/api/v1${p}`, { headers: { authorization: `Bearer ${tok}` } });
  return (await r.json()).data;
}

const student = await token('student@demo.edu', 'Student12345');
const admin = await token('admin@demo.edu', 'Admin12345');
const venues = await api(student, '/venues?pageSize=50');
const seminar = venues.find((v) => v.name === 'Seminar Hall A') ?? venues[0];
const myBookings = await api(student, '/bookings?scope=all&pageSize=50');
const approved = myBookings.find((b) => b.status === 'approved' && b.isUpcoming) ?? myBookings[0];
const rejected = myBookings.find((b) => b.status === 'rejected');
const adminList = await fetch(`${API}/api/v1/admin/bookings?status=pending&pageSize=5`, { headers: { authorization: `Bearer ${admin}` } }).then((r) => r.json());
const pending = adminList.data[0];

const pages = [
  { name: 'login', path: '/login', tok: null },
  { name: 'register', path: '/register', tok: null },
  { name: 'forgot', path: '/forgot-password', tok: null },
  { name: 'm-dashboard', path: '/dashboard', tok: student },
  { name: 'm-venues', path: '/venues', tok: student },
  { name: 'm-venue', path: `/venues/${seminar.id}`, tok: student },
  { name: 'm-venue-avail', path: `/venues/${seminar.id}?tab=availability`, tok: student },
  { name: 'm-new-booking', path: `/bookings/new?venueId=${seminar.id}`, tok: student },
  { name: 'm-bookings', path: '/bookings', tok: student },
  { name: 'm-history', path: '/bookings/history', tok: student },
  { name: 'm-booking', path: `/bookings/${approved.id}`, tok: student },
  ...(rejected ? [{ name: 'm-booking-rejected', path: `/bookings/${rejected.id}`, tok: student }] : []),
  { name: 'm-profile', path: '/profile', tok: student },
  { name: 'm-notifications', path: '/notifications', tok: student },
  { name: 'a-dashboard', path: '/admin/dashboard', tok: admin },
  { name: 'a-approvals', path: '/admin/approvals', tok: admin },
  { name: 'a-bookings', path: '/admin/bookings', tok: admin },
  ...(pending ? [{ name: 'a-booking', path: `/admin/bookings/${pending.id}`, tok: admin }] : []),
  { name: 'a-calendar', path: '/admin/calendar', tok: admin },
  { name: 'a-venues', path: '/admin/venues', tok: admin },
  { name: 'a-venue', path: `/admin/venues/${seminar.id}`, tok: admin },
  { name: 'a-venue-edit', path: `/admin/venues/${seminar.id}/edit`, tok: admin },
  { name: 'a-users', path: '/admin/users', tok: admin },
  { name: 'a-user-new', path: '/admin/users/new', tok: admin },
  { name: 'a-reports', path: '/admin/reports', tok: admin },
  { name: 'a-settings', path: '/admin/settings', tok: admin },
  { name: 'a-audit', path: '/admin/settings/audit-log', tok: admin },
  { name: 'not-found', path: '/nope', tok: student },
].filter((p) => !filter || p.name.includes(filter));

const browser = await chromium.launch();
const errors = [];
for (const p of pages) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } },
  );
  if (p.tok) await ctx.addInitScript((t) => localStorage.setItem('campushub.session', t), p.tok);
  await ctx.addInitScript(() => localStorage.setItem('tzBannerDismissed', '1'));
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${p.name}] console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${p.name}] pageerror: ${e.message}`));
  await page.goto(WEB + p.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const file = path.join(out, `${p.name}${mobile ? '-m' : ''}.png`);
  await page.screenshot({ path: file, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) errors.push(`[${p.name}] horizontal overflow at ${mobile ? 390 : 1440}px`);
  console.log(`shot ${file}`);
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `\n${errors.length} issue(s):\n${errors.join('\n')}` : '\nNo console errors, page errors or horizontal overflow.');
