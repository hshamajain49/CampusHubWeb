// UI audit harness: every route × role × viewport (16 sizes, 320 px → 2560 px). Records page-level horizontal
// overflow and its offending elements, table-cell content spilling into the next column, touch targets under 24 px
// (WCAG 2.2 2.5.8), unnamed controls, images without
// alt, heading-outline problems, console/page errors and failed requests; optional full-page screenshots.
// Needs `npm run local` (seeded demo data). Restarts the API (touches server.ts under tsx watch) between roles so the
// audit's own traffic never hits the in-memory rate limits.
//   node e2e/scripts/ui-audit.mjs [--out=ui-audit] [--roles=public,student,staff,admin] [--vps=all|key] [--shots] [--only=/path]
// Output: <out>/summary.md (grouped by issue) and <out>/results.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = process.env.E2E_API_ORIGIN ?? 'http://localhost:4000';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=')[1];
const OUT = path.resolve(arg('out', 'ui-audit'));
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const ROLES = arg('roles', 'public,student,staff,admin').split(',');
const SHOTS = process.argv.includes('--shots');
const ONLY = arg('only', '');

const ALL_VPS = [
  [320, 568], [360, 800], [375, 812], [390, 844], [414, 896], [430, 932],
  [600, 960], [768, 1024], [820, 1180], [1024, 768],
  [1280, 720], [1366, 768], [1440, 900],
  [1600, 900], [1920, 1080], [2560, 1440],
];
const KEY_VPS = [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [2560, 1440]];
const VPS = arg('vps', 'all') === 'key' ? KEY_VPS : ALL_VPS;
const SHOT_VPS = new Set(['320x568', '768x1024', '1024x768', '1440x900', '2560x1440']);

async function token(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: JSON.stringify({ email, password }) });
  return r.headers.get('set-auth-token');
}
async function api(t, p) {
  const r = await fetch(`${API}/api/v1${p}`, { headers: { authorization: `Bearer ${t}` } });
  return (await r.json()).data;
}
async function restartApi() {
  const f = path.join(ROOT, 'backend', 'src', 'server.ts');
  const now = new Date();
  fs.utimesSync(f, now, now);
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {
      /* the API is restarting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ── in-page checks ──
function inspect(isMobileVp) {
  const W = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
  };
  // Inside an intentional scroll container (overflow-x auto/scroll) or a clipping ancestor?
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  const overflow = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !contained(el) && getComputedStyle(el).position !== 'fixed') overflow.push(`${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  const interactive = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=radio],[role=checkbox],[role=switch],[role=combobox],[role=menuitem]')].filter(visible);
  const small = [];
  const unnamed = [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (el.closest('.sr-only')) continue;
    // WCAG 2.2 AA 2.5.8: 24×24 (inline links in text are exempt).
    const inlineText = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (isMobileVp && !inlineText && (r.width < 24 || r.height < 24)) small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    const name =
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) ||
      el.innerText?.trim() ||
      el.getAttribute('title') ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) ||
      el.closest('label')?.innerText ||
      el.getAttribute('placeholder') ||
      (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type) && el.value) ||
      el.querySelector('img[alt]')?.getAttribute('alt');
    if (!name || !String(name).trim()) unnamed.push(label(el));
  }
  const imgs = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map(label);
  const brokenImgs = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(0, 80));
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => Number(h.tagName[1]));
  const headingIssues = [];
  const h1s = hs.filter((h) => h === 1).length;
  if (h1s !== 1) headingIssues.push(`h1 count ${h1s}`);
  for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) headingIssues.push(`h${hs[i - 1]}→h${hs[i]}`);
  // Table cells whose content spills past the cell edge and paints over the next column. Page-level overflow misses
  // this: the table sits in its own scroll container, so the page itself never overflows.
  const cellSpill = [];
  for (const td of document.querySelectorAll('td, th')) {
    if (!visible(td)) continue;
    const cell = td.getBoundingClientRect();
    for (const el of td.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !visible(el)) continue;
      // Only the painted part counts: clip to any overflow-clipping ancestor inside the cell.
      let { left, right } = r;
      for (let a = el.parentElement; a && a !== td; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const ar = a.getBoundingClientRect();
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
      if (right > cell.right + 1 || left < cell.left - 1) {
        cellSpill.push(`${label(el)} ${Math.round(r.width)}px in a ${Math.round(cell.width)}px cell`);
        break;
      }
    }
  }
  // Truncated text (ellipsis actually applied) — for review, not necessarily a bug.
  const truncated = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!el.childNodes.length || !visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.title && !el.closest('[title]')) truncated.push(label(el));
  }
  return {
    W, sw, overflow: overflow.slice(0, 8), small: [...new Set(small)].slice(0, 12), unnamed: [...new Set(unnamed)].slice(0, 10),
    imgs, brokenImgs, headingIssues: [...new Set(headingIssues)], truncated: truncated.slice(0, 10), cellSpill: [...new Set(cellSpill)].slice(0, 10),
  };
}

const results = [];
const browser = await chromium.launch();

async function runRole(role, who, routes) {
  const t = who ? await token(who.email, who.password) : null;
  for (const [w, h] of VPS) {
    const mobile = w < 768;
    const tablet = w >= 600 && w <= 1180 && h >= 600 && !mobile ? true : false;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile || tablet, deviceScaleFactor: 1 });
    if (t) await ctx.addInitScript((tok) => localStorage.setItem('campushub.session', tok), t);
    const page = await ctx.newPage();
    let consoleMsgs = [];
    let failed = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    page.on('pageerror', (e) => consoleMsgs.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`));
    page.on('requestfailed', (r) => !/aborted/i.test(r.failure()?.errorText ?? '') && failed.push(`FAILED ${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
    for (const [name, url, expect404] of routes) {
      if (ONLY && !url.startsWith(ONLY)) continue;
      consoleMsgs = [];
      failed = [];
      try {
        await page.goto(WEB + url, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (e) {
        consoleMsgs.push(`goto: ${e.message.slice(0, 120)}`);
      }
      await page.waitForTimeout(350);
      const r = await page.evaluate(inspect, mobile);
      const vp = `${w}x${h}`;
      if (SHOTS && SHOT_VPS.has(vp)) await page.screenshot({ path: path.join(OUT, 'shots', `${role}-${name}-${vp}.png`), fullPage: true });
      results.push({ role, name, url, vp, ...r, console: [...new Set(consoleMsgs)], failed: [...new Set(failed)].filter((f) => !(expect404 && f.startsWith('404'))) });
    }
    await ctx.close();
  }
}

// ── route tables (ids from the API) ──
const who = {
  student: { email: 'student@demo.edu', password: 'Student12345' },
  staff: { email: 'staff.electrical@demo.edu', password: 'Staff12345' },
  admin: { email: 'admin@demo.edu', password: 'Admin12345' },
};
const st = await token(who.student.email, who.student.password);
const sf = await token(who.staff.email, who.staff.password);
const ad = await token(who.admin.email, who.admin.password);
const venues = await api(st, '/venues?pageSize=50');
const venue = venues.find((v) => v.name === 'Seminar Hall A') ?? venues[0];
const myBookings = await api(st, '/bookings?scope=all&pageSize=50');
const bk = myBookings.find((b) => b.status === 'approved') ?? myBookings[0];
const editable = myBookings.find((b) => b.permissions.canEdit) ?? bk;
const myC = await api(st, '/complaints?tab=all&pageSize=50');
const cAwait = myC.find((c) => c.status === 'awaiting_confirmation') ?? myC[0];
const cPhotos = myC.find((c) => c.photoCount > 0) ?? myC[0];
const staffC = await api(sf, '/staff/complaints?tab=all&pageSize=50');
const sC = staffC.find((c) => c.photoCount > 0) ?? staffC[0];
const adBookings = await api(ad, '/admin/bookings?pageSize=50');
const adBk = adBookings.find((b) => b.status === 'pending') ?? adBookings[0];
const adC = await api(ad, '/admin/complaints?pageSize=50');
const adCr = adC.find((c) => c.reassignmentRequested) ?? adC[0];
const users = await api(ad, '/admin/users?pageSize=50');
const user = users.find((u) => u.role === 'department_staff') ?? users[0];

const ROUTES = {
  public: [
    ['login', '/login'], ['admin-login', '/admin/login'], ['register', '/register'], ['forgot', '/forgot-password'],
    ['reset', '/reset-password?token=invalid'], ['404', '/no-such-page', true],
  ],
  student: [
    ['dashboard', '/dashboard'], ['venues', '/venues'], ['venue', `/venues/${venue.id}`], ['venue-avail', `/venues/${venue.id}?tab=availability`],
    ['bookings', '/bookings'], ['history', '/bookings/history'], ['book-new', `/bookings/new?venueId=${venue.id}`],
    ['booking', `/bookings/${bk.id}`], ['booking-edit', `/bookings/${editable.id}/edit`], ['booking-submitted', `/bookings/${bk.id}/submitted`],
    ['profile', '/profile'], ['notifications', '/notifications'],
    ['complaints', '/complaints'], ['complaints-closed', '/complaints?tab=closed'], ['complaint-new', '/complaints/new'],
    ['complaint-await', `/complaints/${cAwait.id}`], ['complaint-photos', `/complaints/${cPhotos.id}`],
  ],
  staff: [
    ['staff-dash', '/staff'], ['staff-queue', '/staff/complaints'], ['staff-queue-ip', '/staff/complaints?tab=in_progress'],
    ['staff-detail', `/staff/complaints/${sC.id}`], ['staff-member-dash', '/dashboard'],
  ],
  admin: [
    ['dash', '/admin/dashboard'], ['approvals', '/admin/approvals'], ['bookings', '/admin/bookings'], ['booking', `/admin/bookings/${adBk.id}`],
    ['calendar', '/admin/calendar'], ['venues', '/admin/venues'], ['venue-new', '/admin/venues/new'], ['venue', `/admin/venues/${venue.id}`],
    ['venue-issues', `/admin/venues/${venue.id}?tab=issues`], ['venue-edit', `/admin/venues/${venue.id}/edit`],
    ['users', '/admin/users'], ['user-new', '/admin/users/new'], ['user', `/admin/users/${user.id}`],
    ['reports', '/admin/reports'], ['reports-c', '/admin/reports?tab=complaints'], ['settings', '/admin/settings'], ['audit', '/admin/settings/audit-log'],
    ['complaints', '/admin/complaints'], ['complaint-new', '/admin/complaints/new'], ['complaint', `/admin/complaints/${adCr.id}`],
    ['setup', '/admin/complaint-setup'], ['setup-cat', '/admin/complaint-setup?tab=categories'], ['profile', '/admin/profile'], ['notifications', '/admin/notifications'],
  ],
};

for (const role of ROLES) {
  await restartApi(); // fresh in-memory rate limits per role batch
  console.log(`[audit] ${role}…`);
  await runRole(role, who[role] ?? null, ROUTES[role]);
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));

// ── summary: group by issue signature across viewports ──
const agg = {};
const add = (kind, key, where) => ((agg[kind] ??= {})[key] ??= new Set()).add(where);
for (const r of results) {
  if (r.sw > r.W + 1) add('page-overflow', `${r.role}/${r.name} sw=${r.sw} W=${r.W}`, r.vp);
  for (const o of r.overflow) add('overflow-el', `${r.role}/${r.name}: ${o.replace(/\[.*\]$/, '')}`, r.vp);
  for (const c of r.cellSpill ?? []) add('cell-spill', `${r.role}/${r.name}: ${c.replace(/ \d+px in a \d+px cell$/, '')}`, `${r.vp} ${c.match(/\d+px in a \d+px cell$/)?.[0]}`);
  for (const s of r.small) add('small-target', `${r.role}/${r.name}: ${s.replace(/ \d+×\d+$/, '')}`, `${r.vp} ${s.match(/\d+×\d+$/)?.[0]}`);
  for (const u of r.unnamed) add('unnamed', `${r.role}/${r.name}: ${u}`, r.vp);
  for (const i of r.imgs) add('img-no-alt', `${r.role}/${r.name}: ${i}`, r.vp);
  for (const i of r.brokenImgs) add('img-broken', `${r.role}/${r.name}: ${i}`, r.vp);
  for (const h of r.headingIssues) add('headings', `${r.role}/${r.name}: ${h}`, r.vp);
  for (const c of r.console) add('console', `${r.role}/${r.name}: ${c}`, r.vp);
  for (const f of r.failed) add('network', `${r.role}/${r.name}: ${f}`, r.vp);
  for (const t of r.truncated) add('truncated', `${r.role}/${r.name}: ${t}`, r.vp);
}
const lines = [];
for (const [kind, m] of Object.entries(agg)) {
  lines.push(`\n## ${kind} (${Object.keys(m).length})`);
  for (const [k, v] of Object.entries(m)) lines.push(`- ${k}  ⟶ ${[...v].slice(0, 6).join(', ')}${v.size > 6 ? ` (+${v.size - 6})` : ''}`);
}
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
console.log(`[audit] ${results.length} page checks → ${OUT}/summary.md`);
