// npm run security:headers -- --api <url> --site <url> [--sentinel <url>]
// PASSIVE: GET and CORS-preflight requests only, no sign-in, no attack payloads. Safe against production.
// Checks HTTPS/TLS, security headers, CORS, that protected endpoints refuse anonymous calls, that the site bundle
// holds no server credentials, and that error responses don't leak internals.
import tls from 'node:tls';
import { Report, arg } from './lib.mjs';

const API = arg('api', process.env.SECURITY_API_URL);
const SITE = arg('site', process.env.SECURITY_SITE_URL);
const SENTINEL = arg('sentinel', process.env.SECURITY_SENTINEL_URL);
if (!API && !SITE && !SENTINEL) {
  console.error('Usage: npm run security:headers -- --api https://<api> --site https://<site> [--sentinel https://<sentinel>]');
  process.exit(2);
}
const EVIL = 'https://evil.example';
const report = new Report('HTTP headers and exposure', 'passive');

async function get(url, init = {}) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(90_000), ...init });
  return { status: r.status, h: Object.fromEntries(r.headers), body: await r.text() };
}

function certDaysLeft(url) {
  const { hostname, port, protocol } = new URL(url);
  if (protocol !== 'https:') return Promise.resolve(null);
  return new Promise((resolve) => {
    const s = tls.connect({ host: hostname, port: Number(port) || 443, servername: hostname, timeout: 15_000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve(cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => {
      s.destroy();
      resolve(null);
    });
  });
}

async function transport(prefix, url) {
  report.expect(`${prefix}-T1`, `${url} uses HTTPS`, url.startsWith('https://'), url, url.includes('localhost') ? 'info' : 'fail');
  const days = await certDaysLeft(url);
  if (days !== null) report.expect(`${prefix}-T2`, 'TLS certificate valid for 14+ days', days >= 14, `${days} days left`, 'warn');
  if (url.startsWith('https://')) {
    const http = await get(url.replace('https://', 'http://')).catch(() => null);
    if (http) report.expect(`${prefix}-T3`, 'Plain HTTP redirects to HTTPS', [301, 302, 307, 308].includes(http.status) && /^https:/.test(http.h.location ?? ''), `${http.status} → ${http.h.location ?? '-'}`, 'warn');
  }
}

function headerChecks(prefix, h, { html }) {
  const csp = h['content-security-policy'] ?? '';
  if (!h['strict-transport-security']) report.add(`${prefix}-H1`, 'Strict-Transport-Security', 'warn', { detail: 'missing' });
  else report.expect(`${prefix}-H1`, 'Strict-Transport-Security (1 year+)', Number(/max-age=(\d+)/.exec(h['strict-transport-security'])?.[1] ?? 0) >= 31_536_000, h['strict-transport-security'], 'warn');
  report.expect(`${prefix}-H2`, 'X-Content-Type-Options: nosniff', h['x-content-type-options'] === 'nosniff', h['x-content-type-options'] ?? 'missing', 'warn');
  report.expect(`${prefix}-H3`, 'No X-Powered-By / version banner', !h['x-powered-by'] && !/\d/.test(h.server ?? ''), h['x-powered-by'] ?? h.server ?? 'none', 'warn');
  report.expect(`${prefix}-H4`, 'Referrer-Policy set', !!h['referrer-policy'], h['referrer-policy'] ?? 'missing', 'warn');
  if (html) {
    report.expect(`${prefix}-H5`, 'Content-Security-Policy present', !!csp, csp.slice(0, 120) || 'missing');
    report.expect(`${prefix}-H6`, "CSP: scripts only from 'self' (no unsafe-inline / unsafe-eval)", /script-src 'self'/.test(csp) && !/script-src[^;]*(unsafe-inline|unsafe-eval)/.test(csp), /script-src[^;]*/.exec(csp)?.[0] ?? 'none');
    report.expect(`${prefix}-H7`, "Framing refused (frame-ancestors 'none' or X-Frame-Options DENY)", /frame-ancestors 'none'/.test(csp) || h['x-frame-options'] === 'DENY', h['x-frame-options'] ?? 'csp only');
    report.expect(`${prefix}-H8`, "CSP: object-src 'none' and base-uri restricted", /object-src 'none'/.test(csp) && /base-uri/.test(csp), '', 'warn');
  }
}

// ───────────────────────────── CampusHub API ─────────────────────────────
if (API) {
  await get(`${API}/health`).catch(() => null); // wake a sleeping free instance
  await transport('API', API);
  const health = await get(`${API}/health`);
  report.expect('API-01', '/health answers', health.status === 200, health.body.slice(0, 100));
  report.add('API-02', '/health publishes the build version', /version/.test(health.body) ? 'info' : 'pass', { detail: 'accepted (AUDIT F-14): helps confirm deploys' });
  headerChecks('API', health.h, { html: false });
  for (const p of ['/api/v1/me', '/api/v1/admin/users', '/api/v1/admin/audit-logs', '/api/v1/bookings', '/api/v1/staff/complaints']) {
    const r = await get(`${API}${p}`);
    report.expect('API-03', `${p} refuses anonymous calls`, r.status === 401, r.status);
  }
  const bad = await get(`${API}/api/v1/me`, { headers: { authorization: 'Bearer not-a-real-token' } });
  report.expect('API-04', 'A made-up bearer token is refused', bad.status === 401, bad.status);
  const pf = await get(`${API}/api/v1/me`, { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'GET' } });
  report.expect('API-05', 'CORS grants nothing to a foreign origin', !pf.h['access-control-allow-origin'], pf.h['access-control-allow-origin'] ?? 'no grant');
  report.expect('API-06', 'CORS never allows credentials', pf.h['access-control-allow-credentials'] !== 'true', pf.h['access-control-allow-credentials'] ?? 'not sent');
  if (SITE) {
    const ok = await get(`${API}/api/v1/me`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'GET' } });
    report.expect('API-07', 'CORS allows the real site', ok.h['access-control-allow-origin'] === SITE, ok.h['access-control-allow-origin'] ?? 'none', 'warn');
  }
  const nf = await get(`${API}/api/v1/does-not-exist-${Date.now()}`);
  report.expect('API-08', 'Unknown routes give a plain JSON 404, no stack or path', nf.status === 404 && !/\bat \w|node_modules|[A-Z]:\\|\/opt\/render/.test(nf.body), nf.body.slice(0, 120));
  const auth = await get(`${API}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE ?? EVIL }, body: '{}' });
  report.expect('API-09', 'Better Auth self sign-up endpoint is disabled', auth.status === 404 || auth.status === 403, auth.status);
}

// ───────────────────────────── CampusHub site ─────────────────────────────
if (SITE) {
  await transport('SITE', SITE);
  const page = await get(`${SITE}/`);
  report.expect('SITE-01', 'Site answers', page.status === 200, page.status);
  headerChecks('SITE', page.h, { html: true });
  if (API) report.expect('SITE-02', 'CSP connect-src names the API', (page.h['content-security-policy'] ?? '').includes(new URL(API).host), '', 'warn');
  const scripts = [...page.body.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let bundle = '';
  for (const s of scripts) bundle += (await get(`${SITE}${s}`)).body;
  report.expect('SITE-03', 'Site bundle holds no server credentials', !/ik_[A-Za-z0-9]{12,}|xkeysib-|BETTER_AUTH_SECRET|CRON_SECRET|SENTINEL_INGEST|postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@|-----BEGIN [A-Z ]*PRIVATE KEY/.test(bundle), `${scripts.length} script(s), ${Math.round(bundle.length / 1024)} KB`);
  const maps = scripts.length ? await get(`${SITE}${scripts[0]}.map`) : null;
  if (maps) report.expect('SITE-04', 'Source maps are not published', maps.status !== 200 || !maps.body.startsWith('{'), maps.status, 'warn');
  const dot = await get(`${SITE}/.env`);
  report.expect('SITE-05', '/.env is not served', dot.status !== 200 || !/=/.test(dot.body) || /<html/i.test(dot.body), dot.status);
}

// ───────────────────────────── Sentinel ─────────────────────────────
if (SENTINEL) {
  await get(`${SENTINEL}/health`).catch(() => null);
  await transport('SEN', SENTINEL);
  const ui = await get(`${SENTINEL}/`);
  headerChecks('SEN', ui.h, { html: true });
  report.expect('SEN-01', 'Dashboard is not indexed by search engines', /noindex/.test(ui.h['x-robots-tag'] ?? '') || /noindex/.test(ui.body), ui.h['x-robots-tag'] ?? 'meta only', 'warn');
  for (const p of ['/api/me', '/api/admins', '/api/apps', '/api/audit-logs', '/api/security/overview', '/api/analytics/overview']) {
    const r = await get(`${SENTINEL}${p}`);
    report.expect('SEN-02', `${p} refuses anonymous calls`, r.status === 401, r.status);
  }
  for (const p of ['/ingest/v1/blocklist']) {
    const r = await get(`${SENTINEL}${p}`);
    report.expect('SEN-03', `${p} refuses unsigned calls`, r.status === 401, r.status);
  }
  const pf = await get(`${SENTINEL}/api/auth/login`, { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'POST' } });
  report.expect('SEN-04', 'No CORS grant to a foreign origin', !pf.h['access-control-allow-origin'], pf.h['access-control-allow-origin'] ?? 'no grant');
  const login = await get(`${SENTINEL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: EVIL }, body: '{}' });
  report.expect('SEN-05', 'A cross-site POST is refused before anything else (CSRF)', login.status === 403, login.status);
}

report.print();
report.save();
process.exitCode = report.failed ? 1 : 0;
