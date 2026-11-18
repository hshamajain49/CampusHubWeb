// lib/sentinel.ts and middleware/monitoring.ts: signing, event shaping, queue limits, blocklist, input inspection.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanIp, sentinel, signBody } from '../../src/lib/sentinel.js';
import { suspiciousInput } from '../../src/middleware/monitoring.js';
import { auditEvent } from '../../src/modules/audit/audit-writer.js';

afterEach(() => {
  sentinel.configure(null);
  sentinel.setBlocks([]);
});

describe('signBody', () => {
  it('matches the Sentinel protocol: hex HMAC-SHA256 of "<t>.<METHOD>.<path>.<body>"', () => {
    const body = '{"events":[],"traffic":[]}';
    const expected = createHmac('sha256', 'shh').update(`1700000000.POST./ingest/v1/events.${body}`).digest('hex');
    expect(signBody('shh', 'post', '/ingest/v1/events', body, 1700000000)).toBe(`t=1700000000,v1=${expected}`);
  });

  it('signs an empty body for GET', () => {
    const expected = createHmac('sha256', 'k').update('5.GET./ingest/v1/blocklist.').digest('hex');
    expect(signBody('k', 'GET', '/ingest/v1/blocklist', '', 5)).toBe(`t=5,v1=${expected}`);
  });
});

describe('cleanIp', () => {
  it('unwraps IPv4-mapped addresses and rejects non-IPs', () => {
    expect(cleanIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(cleanIp('2001:db8::1')).toBe('2001:db8::1');
    expect(cleanIp('direct')).toBeNull();
    expect(cleanIp(undefined)).toBeNull();
  });
});

describe('client', () => {
  it('does nothing at all until all three settings are present', () => {
    expect(sentinel.configure({ url: 'https://s.example', keyId: 'ik_1' })).toBe(false);
    sentinel.report({ category: 'auth.login_failed', severity: 'low', description: 'x' });
    expect(sentinel.queued).toBe(0);
    expect(sentinel.isBlocked('203.0.113.9')).toBe(false);
  });

  it('caps the queue at 1 000 events, dropping the oldest', async () => {
    // A closed port: flushes fail fast and put events back, so the cap is what's being tested.
    sentinel.configure({ url: 'http://127.0.0.1:9', keyId: 'ik_1', secret: 's' });
    const before = sentinel.dropped;
    for (let i = 0; i < 1_050; i++) sentinel.report({ category: 'test.event', severity: 'info', description: `e${i}` });
    await new Promise((r) => setTimeout(r, 50));
    expect(sentinel.queued).toBeLessThanOrEqual(1_000);
    expect(sentinel.dropped).toBeGreaterThan(before);
  });

  it('blocks addresses inside an active CIDR only, and forgets a block at its expiry', () => {
    sentinel.configure({ url: 'https://s.example', keyId: 'ik_1', secret: 's' });
    sentinel.setBlocks([
      { cidr: '203.0.113.0/24', expiresAt: Date.now() + 60_000 },
      { cidr: '2001:db8::/64', expiresAt: Date.now() + 60_000 },
      { cidr: '198.51.100.7/32', expiresAt: Date.now() - 1 },
    ]);
    expect(sentinel.isBlocked('203.0.113.200')).toBe(true);
    expect(sentinel.isBlocked('::ffff:203.0.113.5')).toBe(true);
    expect(sentinel.isBlocked('2001:db8::abcd')).toBe(true);
    expect(sentinel.isBlocked('203.0.114.1')).toBe(false);
    expect(sentinel.isBlocked('198.51.100.7')).toBe(false); // already expired
  });
});

describe('suspiciousInput', () => {
  const req = (url: string, body: unknown = {}, query: Record<string, unknown> = {}) => ({ originalUrl: url, body, query }) as never;

  it('spots common SQL, script, traversal and template probes, naming only the field', () => {
    expect(suspiciousInput(req('/api/v1/venues', { purpose: "x' OR '1'='1" }))).toEqual({ patterns: ['sql_injection'], fields: ['body.purpose'] });
    expect(suspiciousInput(req('/api/v1/venues', { title: '<img src=x onerror=alert(1)>' }))?.patterns).toEqual(['script_injection']);
    expect(suspiciousInput(req('/api/v1/../../../etc/passwd'))?.patterns).toContain('path_traversal');
    expect(suspiciousInput(req('/api/v1/x', {}, { q: '1 UNION SELECT password FROM auth_accounts' }))?.fields).toEqual(['query.q']);
    expect(suspiciousInput(req('/api/v1/x', { note: '{{constructor.constructor("x")()}}' }))?.patterns).toEqual(['template_injection']);
  });

  it('leaves ordinary text alone', () => {
    for (const text of ["Rahul's farewell — union hall, 5 o'clock", 'Projector broken in room 2, please fix', 'Q&A: 1 = 1 hour?', 'select a slot after lunch']) {
      expect(suspiciousInput(req('/api/v1/bookings', { purpose: text })), text).toBeNull();
    }
  });

  it('never looks inside password, token or code fields', () => {
    expect(suspiciousInput(req('/api/v1/me/password', { currentPassword: "' or 1=1 --", newPassword: '<script>', code: "' or 1=1" }))).toBeNull();
  });
});

describe('auditEvent', () => {
  const actor = { id: 'a1', role: 'super_admin' as const, fullName: 'Admin', ip: '::ffff:203.0.113.9', userAgent: null };

  it('turns a role change into privilege.changed with roles, not names', () => {
    const e = auditEvent(actor, { action: 'user.updated', entityType: 'user', entityId: 'u1', summary: 'Updated x@y.edu', metadata: { before: { role: 'student' }, after: { role: 'faculty' } } });
    expect(e).toMatchObject({ category: 'privilege.changed', severity: 'high', sourceIp: '203.0.113.9', userRef: 'a1', details: { fromRole: 'student', toRole: 'faculty', targetRef: 'u1' } });
    expect(JSON.stringify(e)).not.toContain('x@y.edu');
  });

  it('turns a settings change into config.changed with the field names only', () => {
    const e = auditEvent(actor, { action: 'settings.updated', entityType: 'settings', entityId: '1', summary: 's', metadata: { before: { institutionName: 'Old' }, after: { institutionName: 'New' } } });
    expect(e).toMatchObject({ category: 'config.changed', severity: 'medium', details: { fields: ['institutionName'] } });
    expect(JSON.stringify(e)).not.toContain('New');
  });

  it('records everything else as admin.action', () => {
    const e = auditEvent(actor, { action: 'venue.deleted', entityType: 'venue', entityId: 'v1', summary: 'Deleted Hall' });
    expect(e).toMatchObject({ category: 'admin.action', severity: 'low', details: { action: 'venue.deleted' } });
    expect(JSON.stringify(e)).not.toContain('Hall');
  });
});
