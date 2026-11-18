// Visitor analytics for CampusHub Sentinel (the developers' monitoring site).
//
// What is sent, and only when VITE_SENTINEL_URL and VITE_SENTINEL_SITE_KEY are set:
//   - a page view when the page (pathname) changes: the path without its query string or fragment, record ids
//     replaced by :id; on the first page of a visit also the referring site and any utm_* campaign tags;
//   - a heartbeat every 30 s while the tab is visible and the visitor has used it in the last 5 minutes (session
//     length; nothing about what they did);
//   - a random visitor id kept in this browser (new vs returning), the viewport width (phone/tablet/laptop).
// Never sent: names, emails, what anyone types, cookies, the CampusHub session. Page views are linked to an account
// only when VITE_SENTINEL_LINK_USERS=true. Nothing is sent when the browser asks not to be tracked (Do-Not-Track,
// Global Privacy Control) or the visitor switched it off on the Privacy page. Failures are silent: analytics can
// never break or slow down CampusHub.
const ENDPOINT = ((import.meta.env.VITE_SENTINEL_URL as string | undefined) ?? '').replace(/\/+$/, '');
const SITE_KEY = (import.meta.env.VITE_SENTINEL_SITE_KEY as string | undefined) ?? '';
const LINK_USERS = import.meta.env.VITE_SENTINEL_LINK_USERS === 'true';

const VISITOR_KEY = 'campushub.vid';
const OPT_OUT_KEY = 'campushub.analytics-off';
const HEARTBEAT_MS = 30_000;
const IDLE_MS = 5 * 60_000;

export function analyticsConfigured(): boolean {
  return !!ENDPOINT && /^sk_[A-Za-z0-9_-]{16,64}$/.test(SITE_KEY);
}

export function browserAsksNotToTrack(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || w.doNotTrack === '1' || nav.msDoNotTrack === '1';
}

export function isAnalyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(off: boolean): void {
  try {
    if (off) {
      localStorage.setItem(OPT_OUT_KEY, '1');
      localStorage.removeItem(VISITOR_KEY); // forget this browser's visitor id too
    } else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage unavailable: nothing is tracked anyway without a visitor id */
  }
}

export function trackingAllowed(): boolean {
  return analyticsConfigured() && !browserAsksNotToTrack() && !isAnalyticsOptedOut();
}

function visitorId(): string | null {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null; // private mode without storage: don't track rather than invent a new visitor per page
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The page's path without query string or fragment, ids replaced by :id (Sentinel normalises again). */
export function analyticsPath(pathname: string): string {
  const p = (pathname.split(/[?#]/)[0] || '/')
    .replace(UUID, ':id')
    .split('/')
    .map((seg) => (/^\d{2,}$/.test(seg) ? ':id' : seg))
    .join('/');
  return p.slice(0, 300) || '/';
}

let lastPath: string | null = null;
let firstHit = true;
let userRef: string | null = null;
let lastActivity = Date.now();
let started = false;

function send(type: 'pageview' | 'heartbeat', path: string): void {
  if (!trackingAllowed()) return;
  const v = visitorId();
  if (!v) return;
  const body: Record<string, unknown> = { k: SITE_KEY, v, t: type, p: path, w: Math.round(window.innerWidth) };
  if (firstHit && type === 'pageview') {
    firstHit = false;
    if (document.referrer) body.r = document.referrer.slice(0, 1000);
    const q = new URLSearchParams(window.location.search);
    const utm = { us: q.get('utm_source'), um: q.get('utm_medium'), uc: q.get('utm_campaign') };
    for (const [k, val] of Object.entries(utm)) if (val) body[k] = val.slice(0, 100);
  }
  if (LINK_USERS && userRef) body.u = userRef;
  const url = `${ENDPOINT}/collect`;
  const data = JSON.stringify(body);
  // text/plain keeps it a "simple" cross-origin request: no preflight, and no answer is read.
  try {
    if (navigator.sendBeacon?.(url, new Blob([data], { type: 'text/plain;charset=UTF-8' }))) return;
  } catch {
    /* fall through to fetch */
  }
  void fetch(url, { method: 'POST', body: data, mode: 'no-cors', keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(
    () => undefined,
  );
}

/** Call on every navigation; only a change of page (pathname) is reported. */
export function trackPageview(pathname: string): void {
  const p = analyticsPath(pathname);
  if (p === lastPath) return;
  lastPath = p;
  send('pageview', p);
}

/** Links page views to the signed-in account only when VITE_SENTINEL_LINK_USERS=true. */
export function setAnalyticsUser(id: string | null): void {
  userRef = LINK_USERS ? id : null;
}

/** Heartbeats while the tab is visible and in use. Activity is only timestamped locally, never sent. */
export function startAnalytics(): void {
  if (started || !analyticsConfigured()) return;
  started = true;
  const touch = () => {
    lastActivity = Date.now();
  };
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true });
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && lastPath && Date.now() - lastActivity < IDLE_MS) send('heartbeat', lastPath);
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    // Back to the tab: Sentinel continues the session, or starts a new one after 30 idle minutes.
    if (document.visibilityState === 'visible' && lastPath) {
      touch();
      send('heartbeat', lastPath);
    }
  });
}

/** Test hook: forget module state. */
export function resetAnalyticsForTests(): void {
  lastPath = null;
  firstHit = true;
  userRef = null;
}
