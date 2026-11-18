// Visitor analytics beacon: what is sent, when, and when nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SITE_KEY = 'sk_abcdefghijklmnopqrstuvwx';

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_SENTINEL_URL', env.VITE_SENTINEL_URL ?? 'https://sentinel.example/');
  vi.stubEnv('VITE_SENTINEL_SITE_KEY', env.VITE_SENTINEL_SITE_KEY ?? SITE_KEY);
  vi.stubEnv('VITE_SENTINEL_LINK_USERS', env.VITE_SENTINEL_LINK_USERS ?? 'false');
  return import('./analytics');
}

let beacon: ReturnType<typeof vi.fn>;
/** jsdom's Blob has no .text(); FileReader works. */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
const sent = async () =>
  Promise.all(
    beacon.mock.calls.map(async (call) => {
      const [url, blob] = call as [string, Blob];
      return { url, body: JSON.parse(await readBlob(blob)), type: blob.type };
    }),
  );

beforeEach(() => {
  localStorage.clear();
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  window.history.replaceState(null, '', '/venues?utm_source=newsletter&utm_campaign=fest&q=hall');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('analytics beacon', () => {
  it('sends one page view per page, without query strings or record ids', async () => {
    const a = await load();
    a.trackPageview('/venues');
    a.trackPageview('/venues'); // same page (e.g. a filter changed the query string): not counted again
    a.trackPageview('/bookings/3f2b6c1e-9a4d-4e8f-b1c2-0d9e8f7a6b5c');
    const calls = await sent();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://sentinel.example/collect');
    expect(calls[0]!.type).toBe('text/plain;charset=utf-8');
    expect(calls[0]!.body).toMatchObject({ k: SITE_KEY, t: 'pageview', p: '/venues', us: 'newsletter', uc: 'fest' });
    expect(calls[0]!.body.v).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]!.body).toMatchObject({ p: '/bookings/:id' });
    expect(calls[1]!.body.us).toBeUndefined(); // campaign tags only on the first page
    expect(JSON.stringify(calls)).not.toContain('q=hall');
  });

  it('keeps one visitor id per browser', async () => {
    const a = await load();
    a.trackPageview('/a');
    a.resetAnalyticsForTests();
    a.trackPageview('/b');
    const [x, y] = await sent();
    expect(x!.body.v).toBe(y!.body.v);
  });

  it('sends nothing when the browser asks not to be tracked', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    (await load()).trackPageview('/a');
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    (await load()).trackPageview('/b');
    expect(beacon).not.toHaveBeenCalled();
  });

  it('sends nothing after opting out, and forgets the visitor id', async () => {
    const a = await load();
    a.trackPageview('/a');
    expect(localStorage.getItem('campushub.vid')).toBeTruthy();
    a.setAnalyticsOptOut(true);
    expect(localStorage.getItem('campushub.vid')).toBeNull();
    a.trackPageview('/b');
    expect(beacon).toHaveBeenCalledTimes(1);
    a.setAnalyticsOptOut(false);
    a.trackPageview('/c');
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it('is off when not configured', async () => {
    const a = await load({ VITE_SENTINEL_URL: '', VITE_SENTINEL_SITE_KEY: '' });
    expect(a.analyticsConfigured()).toBe(false);
    a.trackPageview('/a');
    expect(beacon).not.toHaveBeenCalled();
  });

  it('links the account only when VITE_SENTINEL_LINK_USERS=true', async () => {
    let a = await load();
    a.setAnalyticsUser('user-123');
    a.trackPageview('/a');
    a = await load({ VITE_SENTINEL_LINK_USERS: 'true' });
    a.setAnalyticsUser('user-123');
    a.trackPageview('/b');
    const [off, on] = await sent();
    expect(off!.body.u).toBeUndefined();
    expect(on!.body.u).toBe('user-123');
  });
});
