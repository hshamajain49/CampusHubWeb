// Better Auth's rate-limit store in Postgres (security/AUDIT.md F-06).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authRateLimitStore, rateLimitKey } from '../../src/lib/auth-rate-limit.js';
import { closePools, resetDb } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

beforeAll(resetDb);
afterAll(closePools);

const rule = { window: 300, max: 10 };

describe('rateLimitKey', () => {
  it("keeps Better Auth's address when it resolved one, and re-keys the shared bucket with Express's", () => {
    expect(rateLimitKey('198.51.100.4|/sign-in/email', '::ffff:203.0.113.9')).toBe('198.51.100.4|/sign-in/email');
    expect(rateLimitKey('no-trusted-ip|/sign-in/email', '::ffff:203.0.113.9')).toBe('203.0.113.9|/sign-in/email');
    expect(rateLimitKey('no-trusted-ip|/sign-in/email', undefined)).toBe('no-trusted-ip|/sign-in/email');
    expect(rateLimitKey('2001:db8::1|/reset-password', null)).toBe('2001:db8::1|/reset-password');
  });
});

describe('authRateLimitStore', () => {
  it('allows max requests per window, then refuses with the time left, without counting forever', async () => {
    const key = '203.0.113.20|/sign-in/email';
    for (let i = 0; i < 10; i++) expect((await authRateLimitStore.consume(key, rule)).allowed).toBe(true);
    for (let i = 0; i < 5; i++) {
      const r = await authRateLimitStore.consume(key, rule);
      expect(r.allowed).toBe(false);
      expect(r.retryAfter).toBeGreaterThan(290);
      expect(r.retryAfter).toBeLessThanOrEqual(300);
    }
    const { rows } = await pool.query('select count from auth_rate_limits where key = $1', [key]);
    expect(rows[0].count).toBe(11); // capped at max + 1
  });

  it('starts a fresh window once the old one has passed (state survives a restart: it lives in Postgres)', async () => {
    const key = '203.0.113.21|/sign-in/email';
    for (let i = 0; i < 11; i++) await authRateLimitStore.consume(key, rule);
    expect((await authRateLimitStore.consume(key, rule)).allowed).toBe(false);
    await pool.query("update auth_rate_limits set window_start = now() - interval '301 seconds' where key = $1", [key]);
    expect((await authRateLimitStore.consume(key, rule)).allowed).toBe(true);
    expect((await pool.query('select count from auth_rate_limits where key = $1', [key])).rows[0].count).toBe(1);
  });

  it('counts concurrent requests exactly (no stale-read bypass)', async () => {
    const key = '203.0.113.22|/sign-in/email';
    const results = await Promise.all(Array.from({ length: 25 }, () => authRateLimitStore.consume(key, rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('keeps separate addresses and paths apart', async () => {
    for (let i = 0; i < 11; i++) await authRateLimitStore.consume('203.0.113.23|/sign-in/email', rule);
    expect((await authRateLimitStore.consume('203.0.113.24|/sign-in/email', rule)).allowed).toBe(true);
    expect((await authRateLimitStore.consume('203.0.113.23|/request-password-reset', rule)).allowed).toBe(true);
  });
});
