// Production demo-data guard (F-05) and the client address used by the sign-in throttle (F-02).
import { describe, expect, it } from 'vitest';
import { checkDemoData } from '../../src/lib/demo-guard.js';
import { clientIpFromHeaders } from '../../src/lib/login-throttle.js';

const fakeDb = (n: number | Error) =>
  ({
    query: async () => {
      if (n instanceof Error) throw n;
      return { rows: [{ n }] };
    },
  }) as any;

describe('checkDemoData', () => {
  it('only runs in production', async () => {
    expect(await checkDemoData(fakeDb(7), { nodeEnv: 'development', allowDemoData: false })).toEqual({ action: 'skip', reason: 'not production' });
  });
  it('refuses a production start on seeded demo accounts', async () => {
    expect(await checkDemoData(fakeDb(7), { nodeEnv: 'production', allowDemoData: false })).toEqual({ action: 'refuse', demoAccounts: 7 });
  });
  it('starts on a clean database', async () => {
    expect(await checkDemoData(fakeDb(0), { nodeEnv: 'production', allowDemoData: false })).toEqual({ action: 'start', demoAccounts: 0 });
  });
  it('can be overridden for a deliberate demo', async () => {
    expect((await checkDemoData(fakeDb(7), { nodeEnv: 'production', allowDemoData: true })).action).toBe('skip');
  });
  it('does not block start-up when the database is unreachable', async () => {
    const r = await checkDemoData(fakeDb(new Error('ECONNREFUSED')), { nodeEnv: 'production', allowDemoData: false });
    expect(r).toEqual({ action: 'unchecked', error: 'ECONNREFUSED' });
  });
});

describe('clientIpFromHeaders (same rule as Express trust proxy)', () => {
  const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});
  it('ignores X-Forwarded-For when no proxy is trusted (it is client-controlled)', () => {
    expect(clientIpFromHeaders(h('203.0.113.9'), 0)).toBe('direct');
  });
  it('takes the address the trusted proxy appended, not a forged left-hand entry', () => {
    expect(clientIpFromHeaders(h('198.51.100.1'), 1)).toBe('198.51.100.1');
    expect(clientIpFromHeaders(h('6.6.6.6, 198.51.100.1'), 1)).toBe('198.51.100.1');
    expect(clientIpFromHeaders(h('6.6.6.6, 198.51.100.1, 10.0.0.2'), 2)).toBe('198.51.100.1');
  });
  it('falls back to one shared bucket when the header is missing', () => {
    expect(clientIpFromHeaders(h(), 1)).toBe('unknown');
  });
});
