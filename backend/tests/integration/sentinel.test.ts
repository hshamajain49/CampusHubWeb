// CampusHub → Sentinel (Phase 7) against a fake Sentinel that checks every signature the way the real one does.
// Covers: what is reported for sign-ins, refused requests, injection-like input, admin changes and rate limits;
// blocklist enforcement; and that CampusHub keeps working, unchanged, while Sentinel is down.
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { sentinel } from '../../src/lib/sentinel.js';
import { app, as, closePools, createUser, member, ORIGIN, PASSWORD, resetDb } from '../helpers/app.js';

const KEY = 'ik_test';
const SECRET = 'test-ingest-secret-0123456789abcdef';

type Event = Record<string, any>;
const fake = {
  server: null as http.Server | null,
  url: '',
  events: [] as Event[],
  traffic: [] as Event[],
  rejected: 0,
  blocks: [] as { cidr: string; expiresAt: string }[],
};

function verify(req: http.IncomingMessage, body: string): boolean {
  if (req.headers['x-sentinel-key'] !== KEY) return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(req.headers['x-sentinel-signature'] ?? ''));
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const want = createHmac('sha256', SECRET).update(`${m[1]}.${req.method}.${req.url}.`).update(body).digest();
  return timingSafeEqual(want, Buffer.from(m[2]!, 'hex'));
}

const flushAll = async () => {
  await new Promise((r) => setTimeout(r, 30)); // 'finish' listeners and after-commit hooks
  await sentinel.flush();
};
const ofCategory = (c: string) => fake.events.filter((e) => e.category === c);
const signInRaw = (email: string, password: string) => request(app).post('/api/auth/sign-in/email').set('origin', ORIGIN).send({ email, password });

beforeAll(async () => {
  await resetDb();
  fake.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!verify(req, body)) {
        fake.rejected++;
        res.writeHead(401).end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/ingest/v1/events') {
        const b = JSON.parse(body);
        fake.events.push(...b.events);
        fake.traffic.push(...b.traffic);
        res.writeHead(202).end(JSON.stringify({ data: { accepted: b.events.length } }));
      } else if (req.method === 'GET' && req.url === '/ingest/v1/blocklist') {
        res.writeHead(200).end(JSON.stringify({ data: { blocks: fake.blocks } }));
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => fake.server!.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(fake.server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  sentinel.configure(null);
  await new Promise((r) => fake.server?.close(r));
  await closePools();
});

beforeEach(() => {
  sentinel.configure({ url: fake.url, keyId: KEY, secret: SECRET });
  fake.events = [];
  fake.traffic = [];
});

describe('what CampusHub reports', () => {
  it('reports failed and successful sign-ins with a hashed account key, never the email', async () => {
    const id = await createUser('watched@sen.edu');
    expect((await signInRaw('watched@sen.edu', 'Wrong-pass-1')).status).toBe(401);
    expect((await signInRaw('watched@sen.edu', PASSWORD)).status).toBe(200);
    await flushAll();
    const [failed] = ofCategory('auth.login_failed');
    const [ok] = ofCategory('auth.login_succeeded');
    expect(failed).toMatchObject({ severity: 'low', sourceIp: '127.0.0.1', route: '/api/auth/sign-in/email', statusCode: 401 });
    expect(failed!.details.accountKey).toMatch(/^acct:/);
    expect(ok).toMatchObject({ severity: 'info', userRef: id, actorRole: 'student' });
    expect(ok!.details.accountKey).toBe(failed!.details.accountKey);
    expect(JSON.stringify(fake.events)).not.toContain('watched@sen.edu');
    expect(fake.rejected).toBe(0);
  });

  it('reports a member refused on the admin API, with the route template and role', async () => {
    const m = await member('nosy@sen.edu');
    fake.events = [];
    expect((await as(m.token).get('/admin/users')).status).toBe(403);
    await flushAll();
    const [denied] = ofCategory('authz.denied');
    expect(denied).toMatchObject({ severity: 'medium', userRef: m.id, actorRole: 'student', method: 'GET', statusCode: 403, details: { code: 'FORBIDDEN' } });
    expect(denied!.route).toMatch(/^\/api\/v1\/admin/);
  });

  it('reports anonymous admin probing and record lookups that miss', async () => {
    expect((await request(app).get('/api/v1/admin/settings').set('origin', ORIGIN)).status).toBe(401);
    const m = await member('guesser@sen.edu');
    expect((await as(m.token).get('/bookings/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    await flushAll();
    expect(ofCategory('authz.denied')[0]).toMatchObject({ severity: 'low', statusCode: 401 });
    const [miss] = ofCategory('object.not_found');
    expect(miss).toMatchObject({ userRef: m.id, details: { code: 'BOOKING_NOT_FOUND' } });
    expect(miss!.path).toBe('/api/v1/bookings/:id'); // record ids never leave CampusHub
  });

  it('reports injection-like input without the input itself, and still handles the request normally', async () => {
    const m = await member('probe@sen.edu');
    const res = await as(m.token).get("/venues?q=x'%20OR%20'1'%3D'1");
    expect(res.status).toBe(200);
    await flushAll();
    const [e] = ofCategory('input.suspicious');
    expect(e).toMatchObject({ severity: 'medium', statusCode: 200, details: { patterns: ['sql_injection'], fields: ['query.q'] } });
    expect(JSON.stringify(e)).not.toContain("'1'='1");
  });

  it('reports admin changes after they commit: role changes and settings changes get their own categories', async () => {
    const admin = await member('boss@sen.edu', 'super_admin');
    const target = await createUser('promoted@sen.edu');
    fake.events = [];
    expect((await as(admin.token).patch(`/admin/users/${target}`, { role: 'faculty_staff' })).status).toBe(200);
    expect((await as(admin.token).patch('/admin/settings', { maxActivePerUser: 7 })).status).toBe(200);
    await flushAll();
    expect(ofCategory('privilege.changed')[0]).toMatchObject({ severity: 'high', userRef: admin.id, details: { fromRole: 'student', toRole: 'faculty_staff', targetRef: target } });
    expect(ofCategory('config.changed')[0]).toMatchObject({ severity: 'medium', details: { fields: ['maxActivePerUser'] } });
    expect(JSON.stringify(fake.events)).not.toContain('promoted@sen.edu');
  });

  it("doesn't report an admin change that failed", async () => {
    const admin = await member('boss2@sen.edu', 'super_admin');
    fake.events = [];
    // The transaction fails (the target doesn't exist), so nothing commits and nothing is reported.
    expect((await as(admin.token).patch('/admin/users/00000000-0000-4000-8000-000000000000', { role: 'faculty_staff' })).status).toBe(404);
    await flushAll();
    expect(ofCategory('privilege.changed')).toEqual([]);
  });

  it('counts traffic per minute by status class', async () => {
    await request(app).get('/api/v1/settings/public');
    await request(app).get('/api/v1/nope');
    await flushAll();
    const minute = fake.traffic.at(-1)!;
    expect(minute.requests).toBeGreaterThanOrEqual(2);
    expect(minute.status2xx).toBeGreaterThanOrEqual(1);
    expect(minute.status4xx).toBeGreaterThanOrEqual(1);
  });

  it('marks test traffic as simulated (outside production only)', async () => {
    await request(app).get('/api/v1/admin/users').set('origin', ORIGIN).set('x-sentinel-simulated', '1');
    await flushAll();
    expect(ofCategory('authz.denied')[0]?.simulated).toBe(true);
  });
});

describe('blocklist', () => {
  it('refuses a blocked address with ACCESS_BLOCKED, but never /health', async () => {
    fake.blocks = [{ cidr: '127.0.0.1/32', expiresAt: new Date(Date.now() + 60_000).toISOString() }];
    expect(await sentinel.pullBlocklist()).toBe(true);
    try {
      const res = await request(app).get('/api/v1/settings/public');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCESS_BLOCKED');
      expect((await request(app).get('/health')).status).toBe(200);
      await flushAll();
      expect(ofCategory('blocklist.hit')).toHaveLength(1);
    } finally {
      fake.blocks = [];
      await sentinel.pullBlocklist();
    }
    expect((await request(app).get('/api/v1/settings/public')).status).toBe(200);
  });

  it('keeps the last list while Sentinel is unreachable, until each block expires', async () => {
    // Windows takes ~2 s to give up on a refused local port, so the block outlives that.
    const expiresAt = Date.now() + 5_000;
    fake.blocks = [{ cidr: '127.0.0.1/32', expiresAt: new Date(expiresAt).toISOString() }];
    await sentinel.pullBlocklist();
    sentinel.configure({ url: 'http://127.0.0.1:1', keyId: KEY, secret: SECRET });
    expect(await sentinel.pullBlocklist()).toBe(false);
    expect((await request(app).get('/api/v1/settings/public')).status).toBe(403);
    await new Promise((r) => setTimeout(r, Math.max(0, expiresAt - Date.now()) + 50));
    expect((await request(app).get('/api/v1/settings/public')).status).toBe(200);
    fake.blocks = [];
  });
});

describe('when Sentinel is down', () => {
  it('CampusHub answers exactly as before, events wait in the queue, and are delivered once Sentinel is back', async () => {
    await createUser('steady@sen.edu');
    sentinel.configure({ url: 'http://127.0.0.1:1', keyId: KEY, secret: SECRET });
    const started = Date.now();
    expect((await signInRaw('steady@sen.edu', 'Wrong-pass-1')).status).toBe(401);
    expect((await signInRaw('steady@sen.edu', PASSWORD)).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3_000); // no request waits on Sentinel
    expect(await sentinel.flush()).toBeNull(); // the send fails…
    expect(sentinel.queued).toBeGreaterThanOrEqual(2); // …and the events are kept
    sentinel.configure({ url: fake.url, keyId: KEY, secret: SECRET }); // (re-configuring also clears the back-off)
    await flushAll();
    expect(ofCategory('auth.login_failed').length + ofCategory('auth.login_succeeded').length).toBeGreaterThanOrEqual(2);
    expect(sentinel.queued).toBe(0);
  });
});
