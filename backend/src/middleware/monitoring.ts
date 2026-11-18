// Request-level hooks for CampusHub Sentinel (lib/sentinel.ts). All of them are no-ops while reporting is off,
// and none of them can fail a request: every hook is wrapped so a monitoring bug only costs a log line.
import type { Request, RequestHandler } from 'express';
import type { AppError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import { cleanIp, sentinel } from '../lib/sentinel.js';

function safe(what: string, fn: () => void) {
  try {
    fn();
  } catch (err) {
    logger.warn({ err }, `sentinel hook failed: ${what}`);
  }
}

// ─────────────────────────── blocklist ───────────────────────────
const lastBlockReport = new Map<string, number>();

/**
 * Refuses addresses that Sentinel has temporarily blocked (a developer's decision, or an automatic block for a
 * critical attack). /health stays reachable so Render's health check can never be blocked.
 */
export const blocklistGuard: RequestHandler = (req, res, next) => {
  if (!sentinel.enabled || req.path.startsWith('/health')) return next();
  let blocked = false;
  safe('blocklist', () => {
    blocked = sentinel.isBlocked(req.ip);
  });
  if (!blocked) return next();
  safe('blocklist report', () => {
    // One event per address per minute: a blocked client hammering the API must not flood the queue.
    const ip = cleanIp(req.ip) ?? 'unknown';
    const now = Date.now();
    if ((lastBlockReport.get(ip) ?? 0) > now - 60_000) return;
    lastBlockReport.set(ip, now);
    if (lastBlockReport.size > 5_000) lastBlockReport.clear();
    sentinel.reportRequest(req, { category: 'blocklist.hit', severity: 'low', description: 'A request from a blocked address was refused.', statusCode: 403 });
  });
  res.status(403).json({
    error: {
      code: 'ACCESS_BLOCKED',
      message: 'Access from your network is temporarily blocked. Try again later or contact the administrator.',
      details: null,
      requestId: req.id,
    },
  });
};

// ─────────────────────────── traffic ───────────────────────────
/** Counts every finished response per minute (status class only). */
export const countTraffic: RequestHandler = (req, res, next) => {
  if (sentinel.enabled && !req.path.startsWith('/health')) res.on('finish', () => safe('traffic', () => sentinel.countResponse(res.statusCode)));
  next();
};

// ─────────────────────────── input inspection (observe only) ───────────────────────────
// These patterns never block anything: CampusHub uses parameterised SQL and React escaping, so the input is harmless
// to it. They tell developers someone is *trying*. Only the pattern name and the field name are reported, never the
// value (it might be personal data, or a password typed into the wrong box).
const PATTERNS: [name: string, re: RegExp][] = [
  ['sql_injection', /('|")\s*(or|and)\s+('?\w+'?)\s*(=|like)\s*('?\w+'?)|\bunion\s+(all\s+)?select\b|;\s*(drop|truncate|alter|delete|insert|update)\s+\w|\b(pg_)?sleep\s*\(\s*\d+\s*\)|\binformation_schema\b|'\s*;?\s*--/i],
  ['script_injection', /<\s*script\b|<\s*\/\s*script\s*>|javascript\s*:|<[^>]+\son(error|load|click|mouseover|focus)\s*=|<\s*(iframe|object|embed)\b/i],
  ['path_traversal', /(\.\.[/\\]){2,}|%2e%2e(%2f|%5c|\/)|\/etc\/(passwd|shadow)|\\windows\\win\.ini|\bfile:\/\//i],
  ['template_injection', /\{\{\s*[\w.]*(constructor|__proto__|process)\b|\$\{\s*jndi:/i],
];
const SKIP_FIELDS = /pass(word)?|secret|token|code$|^code$/i;

function scan(value: unknown, field: string, hits: Map<string, Set<string>>, budget: { n: number }, depth = 0) {
  if (budget.n <= 0 || depth > 5) return;
  if (typeof value === 'string') {
    budget.n--;
    if (value.length < 4 || SKIP_FIELDS.test(field.split('.').pop() ?? '')) return;
    const v = value.length > 4_000 ? value.slice(0, 4_000) : value;
    for (const [name, re] of PATTERNS) {
      if (re.test(v)) {
        if (!hits.has(name)) hits.set(name, new Set());
        hits.get(name)!.add(field.slice(0, 80));
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((x, i) => scan(x, `${field}[${i}]`, hits, budget, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, x] of Object.entries(value).slice(0, 100)) scan(x, field ? `${field}.${k}` : k, hits, budget, depth + 1);
  }
}

/** Pattern names found in a request's path, query and JSON body, with the fields they were in. */
export function suspiciousInput(req: Pick<Request, 'originalUrl' | 'query' | 'body'>): { patterns: string[]; fields: string[] } | null {
  const hits = new Map<string, Set<string>>();
  const budget = { n: 500 };
  let path = req.originalUrl.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  scan(path, 'path', hits, budget);
  scan(req.query, 'query', hits, budget);
  scan(req.body, 'body', hits, budget);
  if (!hits.size) return null;
  return { patterns: [...hits.keys()], fields: [...new Set([...hits.values()].flatMap((s) => [...s]))].slice(0, 10) };
}

export const inspectInput: RequestHandler = (req, res, next) => {
  if (sentinel.enabled) {
    safe('input inspection', () => {
      const found = suspiciousInput(req);
      if (!found) return;
      // Reported when the response finishes, so the route template and the outcome are known.
      res.on('finish', () =>
        safe('input report', () =>
          sentinel.reportRequest(req, {
            category: 'input.suspicious',
            severity: 'medium',
            description: `Request contained ${found.patterns.join(', ').replace(/_/g, ' ')}-like input (observed only; nothing was executed).`,
            statusCode: res.statusCode,
            details: { patterns: found.patterns, fields: found.fields },
          }),
        ),
      );
    });
  }
  next();
};

// ─────────────────────────── refused and failed requests ───────────────────────────
const NOT_FOUND_RECORDS = new Set(['BOOKING_NOT_FOUND', 'COMPLAINT_NOT_FOUND', 'SUGGESTION_NOT_FOUND', 'NOTIFICATION_NOT_FOUND', 'USER_NOT_FOUND']);
const UPLOAD_REJECTED = new Set(['IMAGE_INVALID', 'IMAGE_TOO_LARGE', 'IMAGE_UNREADABLE', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'TOO_MANY_FILES']);
const DB_DOWN = new Set(['SERVICE_UNAVAILABLE']);

/** Called by the error handler for every error response. */
export function reportError(req: Request, e: AppError): void {
  if (!sentinel.enabled) return;
  safe('error report', () => {
    const base = { statusCode: e.status, details: { code: e.code } };
    const path = req.originalUrl.split('?')[0] ?? '';
    if (e.code === 'MFA_INVALID_CODE') {
      sentinel.reportRequest(req, { ...base, category: 'auth.mfa_failed', severity: 'medium', description: 'A wrong two-step verification code was entered for a Super Admin account.' });
    } else if (e.code === 'MFA_LOCKED') {
      sentinel.reportRequest(req, { ...base, category: 'auth.mfa_failed', severity: 'high', description: 'Two-step verification was paused for a Super Admin account after repeated wrong codes.' });
    } else if (e.status === 403 && (e.code === 'FORBIDDEN' || e.code === 'MFA_REQUIRED' || e.code === 'MFA_ENROLLMENT_REQUIRED')) {
      sentinel.reportRequest(req, {
        ...base,
        category: 'authz.denied',
        severity: path.startsWith('/api/v1/admin') ? 'medium' : 'low',
        description: req.profile ? `A ${req.profile.role.replace('_', ' ')} was refused access (${e.code}).` : `Access was refused (${e.code}).`,
      });
    } else if (e.status === 401 && path.startsWith('/api/v1/admin')) {
      sentinel.reportRequest(req, { ...base, category: 'authz.denied', severity: 'low', description: 'An unauthenticated request to the admin API was refused.' });
    } else if (NOT_FOUND_RECORDS.has(e.code)) {
      sentinel.reportRequest(req, { ...base, category: 'object.not_found', severity: 'low', description: `A request named a record that doesn't exist or isn't the caller's (${e.code}).` });
    } else if (UPLOAD_REJECTED.has(e.code)) {
      sentinel.reportRequest(req, { ...base, category: 'upload.rejected', severity: 'low', description: `An upload was rejected (${e.code}).` });
    } else if (DB_DOWN.has(e.code)) {
      sentinel.reportRequest(req, { ...base, category: 'db.error', severity: 'high', description: 'The database was unavailable for a request.' });
    } else if (e.status >= 500) {
      sentinel.reportRequest(req, { ...base, category: 'server.error', severity: 'high', description: `A request failed with ${e.status} (${e.code}).` });
    }
  });
}

/** Called by the rate limiters when they refuse a request. */
export function reportRateLimited(req: Request, limiter: string): void {
  if (!sentinel.enabled) return;
  safe('rate-limit report', () =>
    sentinel.reportRequest(req, { category: 'ratelimit.exceeded', severity: 'low', description: `Rate limit "${limiter}" refused a request.`, statusCode: 429, details: { limiter } }),
  );
}
