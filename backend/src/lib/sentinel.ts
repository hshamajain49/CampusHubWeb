// CampusHub → CampusHub Sentinel (the developers' monitoring service).
//
// Sends security events and per-minute request counts to Sentinel's ingestion API, signed with HMAC-SHA256
// ("t=<unix>,v1=<hex HMAC(secret, '<t>.<METHOD>.<path>.<body>')>"), and pulls the list of temporarily blocked IPs.
//
// Never in CampusHub's way:
//  - report() only appends to an in-memory queue; nothing waits on the network inside a request;
//  - batches go out every 2 s (or at 50 events) with a 3 s timeout; failures back off exponentially (max 60 s);
//  - the queue holds at most 1 000 events; beyond that the oldest are dropped and counted;
//  - if Sentinel is unreachable, CampusHub keeps its last blocklist until each block's own expiry, then nothing is
//    blocked (fails open). CampusHub's own controls (authorisation, rate limits, sign-in back-off) never depend on it;
//  - with SENTINEL_URL / SENTINEL_INGEST_KEY_ID / SENTINEL_INGEST_SECRET unset, everything here is a no-op.
import { createHmac, randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { cleanIp } from './request-context.js';
import { logger } from './logger.js';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEvent {
  category: string; // "<area>.<what>", e.g. auth.login_failed
  severity: Severity;
  description: string;
  sourceIp?: string | null;
  userRef?: string | null;
  actorRole?: string | null;
  method?: string;
  route?: string | null;
  path?: string | null;
  statusCode?: number;
  details?: Record<string, unknown>;
  simulated?: boolean;
}

interface Settings {
  url: string;
  keyId: string;
  secret: string;
}

const MAX_QUEUE = 1_000;
const BATCH = 500;
const FLUSH_MS = 2_000;
const TIMEOUT_MS = 3_000;
const BLOCKLIST_MS = 60_000;
const SUPER_ADMIN_WATCH_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function signBody(secret: string, method: string, path: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${method.toUpperCase()}.${path}.`).update(body).digest('hex')}`;
}

export { cleanIp };

/** The route template when Express matched one (/api/v1/bookings/:bookingId), else the path with ids as :id. */
export function routeOf(req: Request): string {
  const tpl = req.route?.path;
  if (typeof tpl === 'string') return `${req.baseUrl}${tpl}`.slice(0, 200);
  return (req.originalUrl.split('?')[0] ?? '').replace(UUID, ':id').slice(0, 200);
}

class SentinelClient {
  private settings: Settings | null = null;
  private queue: Record<string, unknown>[] = [];
  private traffic = new Map<number, { requests: number; status2xx: number; status3xx: number; status4xx: number; status5xx: number }>();
  private dirtyMinutes = new Set<number>();
  private blocks: { cidr: string; expiresAt: number }[] = [];
  private blockList = new BlockList();
  private timers: NodeJS.Timeout[] = [];
  private flushing = false;
  private backoffUntil = 0;
  private failures = 0;
  private lastSent = 0;
  private superAdmins: Set<string> | null = null;
  dropped = 0;

  get enabled() {
    return this.settings !== null;
  }

  /** From the environment (server start) or explicitly (tests). Returns whether reporting is on. */
  configure(s: Partial<Settings> | null = { url: config.SENTINEL_URL, keyId: config.SENTINEL_INGEST_KEY_ID, secret: config.SENTINEL_INGEST_SECRET }): boolean {
    this.settings = s?.url && s.keyId && s.secret ? { url: s.url.replace(/\/+$/, ''), keyId: s.keyId, secret: s.secret } : null;
    this.failures = 0;
    this.backoffUntil = 0;
    return this.enabled;
  }

  start() {
    if (!this.enabled || this.timers.length) return;
    const every = (ms: number, fn: () => Promise<unknown>) => {
      const t = setInterval(() => void fn().catch(() => undefined), ms);
      t.unref();
      this.timers.push(t);
    };
    every(FLUSH_MS, () => this.flush());
    every(BLOCKLIST_MS, () => this.pullBlocklist());
    every(SUPER_ADMIN_WATCH_MS, () => this.watchSuperAdmins());
    void this.pullBlocklist().catch(() => undefined);
    void this.watchSuperAdmins().catch(() => undefined);
    logger.info({ url: this.settings!.url }, 'Sentinel reporting on');
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ─────────────────────────── events ───────────────────────────
  report(e: SecurityEvent): void {
    if (!this.enabled) return;
    const event: Record<string, unknown> = {
      id: randomUUID().replace(/-/g, ''),
      occurredAt: new Date().toISOString(),
      category: e.category,
      severity: e.severity,
      description: e.description.slice(0, 500),
    };
    if (e.sourceIp) event.sourceIp = e.sourceIp;
    if (e.userRef) event.userRef = e.userRef.slice(0, 64);
    if (e.actorRole) event.actorRole = e.actorRole.slice(0, 40);
    if (e.method && METHODS.has(e.method)) event.method = e.method;
    if (e.route) event.route = e.route.slice(0, 200);
    if (e.path) event.path = e.path.replace(UUID, ':id').slice(0, 300);
    if (e.statusCode && e.statusCode >= 100 && e.statusCode <= 599) event.statusCode = e.statusCode;
    if (e.details && Object.keys(e.details).length) event.details = e.details;
    if (e.simulated) event.simulated = true;
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
      this.dropped++;
    }
    if (this.queue.length >= 50) void this.flush().catch(() => undefined);
  }

  /** report() with the request's context: client IP, user, role, method, route, and the test-traffic flag. */
  reportRequest(req: Request, e: Omit<SecurityEvent, 'sourceIp' | 'method' | 'route' | 'path'> & { route?: string }): void {
    if (!this.enabled) return;
    this.report({
      sourceIp: cleanIp(req.ip),
      userRef: req.profile?.id ?? req.auth?.userId ?? null,
      actorRole: req.profile?.role ?? null,
      method: req.method,
      route: e.route ?? routeOf(req),
      path: req.originalUrl.split('?')[0],
      simulated: isSimulated(req),
      ...e,
    });
  }

  /** One finished response, counted per minute (traffic spikes, "total requests"). */
  countResponse(status: number): void {
    if (!this.enabled) return;
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    let m = this.traffic.get(minute);
    if (!m) {
      m = { requests: 0, status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0 };
      this.traffic.set(minute, m);
    }
    m.requests++;
    const cls = Math.floor(status / 100);
    if (cls === 2) m.status2xx++;
    else if (cls === 3) m.status3xx++;
    else if (cls === 4) m.status4xx++;
    else if (cls === 5) m.status5xx++;
    this.dirtyMinutes.add(minute);
  }

  private async send(method: 'GET' | 'POST', path: string, body: string): Promise<Response> {
    const s = this.settings!;
    return fetch(`${s.url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-sentinel-key': s.keyId, 'x-sentinel-signature': signBody(s.secret, method, path, body) },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** Sends queued events and changed traffic minutes. Safe to call any time; one flush runs at a time. */
  async flush(): Promise<{ sent: number } | null> {
    if (!this.enabled || this.flushing || Date.now() < this.backoffUntil) return null;
    // Nothing new: send only a heartbeat (an empty batch: "CampusHub is up and reporting"), once a minute.
    if (!this.queue.length && !this.dirtyMinutes.size && Date.now() - this.lastSent < HEARTBEAT_MS) return { sent: 0 };
    const events = this.queue.splice(0, BATCH);
    const minutes = [...this.dirtyMinutes].sort((a, b) => a - b).slice(-120);
    this.dirtyMinutes.clear();
    const traffic = minutes.map((m) => ({ minute: new Date(m).toISOString(), ...this.traffic.get(m)! }));
    this.flushing = true;
    try {
      const res = await this.send('POST', '/ingest/v1/events', JSON.stringify({ events, traffic }));
      if (!res.ok) throw new Error(`Sentinel answered ${res.status}`);
      this.failures = 0;
      this.lastSent = Date.now();
      // Keep only the current minute's counter (its total is re-sent as it grows; Sentinel overwrites it).
      const current = Math.floor(Date.now() / 60_000) * 60_000;
      for (const m of this.traffic.keys()) if (m < current) this.traffic.delete(m);
      return { sent: events.length };
    } catch (err) {
      // Put the batch back in front (within the cap) and wait before the next try.
      this.queue.unshift(...events);
      if (this.queue.length > MAX_QUEUE) {
        this.dropped += this.queue.length - MAX_QUEUE;
        this.queue.splice(0, this.queue.length - MAX_QUEUE);
      }
      for (const m of minutes) this.dirtyMinutes.add(m);
      this.failures++;
      this.backoffUntil = Date.now() + Math.min(60_000, 2_000 * 2 ** Math.min(this.failures, 5));
      if (this.failures === 1 || this.failures % 20 === 0) logger.warn({ err: (err as Error).message, queued: this.queue.length }, 'Sentinel unreachable; events kept for retry');
      return null;
    } finally {
      this.flushing = false;
    }
  }

  get queued() {
    return this.queue.length;
  }

  // ─────────────────────────── blocklist ───────────────────────────
  async pullBlocklist(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await this.send('GET', '/ingest/v1/blocklist', '');
      if (!res.ok) throw new Error(`Sentinel answered ${res.status}`);
      const body = (await res.json()) as { data: { blocks: { cidr: string; expiresAt: string }[] } };
      this.setBlocks(body.data.blocks.map((b) => ({ cidr: b.cidr, expiresAt: Date.parse(b.expiresAt) })));
      return true;
    } catch (err) {
      // Keep the last list (each block still ends at its own expiry).
      logger.debug({ err: (err as Error).message }, 'Sentinel blocklist not refreshed');
      this.setBlocks(this.blocks);
      return false;
    }
  }

  setBlocks(blocks: { cidr: string; expiresAt: number }[]) {
    const now = Date.now();
    this.blocks = blocks.filter((b) => b.expiresAt > now);
    const list = new BlockList();
    for (const b of this.blocks) {
      const [net, bits] = b.cidr.split('/');
      const family = isIP(net ?? '');
      if (!family || !bits) continue;
      list.addSubnet(net!, Number(bits), family === 6 ? 'ipv6' : 'ipv4');
    }
    this.blockList = list;
  }

  /** Is this address under an active block? (An expired block never matches, even before the next refresh.) */
  isBlocked(ip: string | null | undefined): boolean {
    const v = cleanIp(ip);
    if (!v || !this.blocks.length) return false;
    if (this.blocks.some((b) => b.expiresAt <= Date.now())) this.setBlocks(this.blocks);
    return this.blockList.check(v, isIP(v) === 6 ? 'ipv6' : 'ipv4');
  }

  // ─────────────────────────── intrusion: new Super Admins ───────────────────────────
  /**
   * Super Admins can only be created out of band (provisioning script or SQL), never through the API. Any new one
   * is reported as a critical privilege change, however it was made, so a database-level intrusion shows up too.
   */
  async watchSuperAdmins(): Promise<void> {
    if (!this.enabled) return;
    const { rows } = await pool.query<{ id: string; email: string }>("select id, email from public.profiles where role = 'super_admin' and is_active");
    const now = new Set(rows.map((r) => r.id));
    if (this.superAdmins) {
      for (const r of rows) {
        if (this.superAdmins.has(r.id)) continue;
        this.report({
          category: 'privilege.changed',
          severity: 'critical',
          description: 'A new active Super Admin account appeared. Super Admins are only created out of band: confirm this was planned.',
          userRef: r.id,
          actorRole: 'super_admin',
          details: { change: 'super_admin_added', superAdmins: rows.length },
        });
      }
    }
    this.superAdmins = now;
  }
}

export const sentinel = new SentinelClient();

/**
 * Test traffic (Phase 8 simulations) is marked so Sentinel shows it as simulated and never emails about it.
 * Honoured only outside production: a real attacker can't hide behind it.
 */
export function isSimulated(req: Request): boolean {
  return config.NODE_ENV !== 'production' && req.get('x-sentinel-simulated') === '1';
}
