// Better Auth rate-limit store in Postgres (security/AUDIT.md F-06): sign-in and password-reset limits survive
// restarts, deploys and free-plan spin-downs. Check and count happen in one atomic upsert, so concurrent requests
// can't all slip through on a stale read.
//
// The key is Better Auth's "<ip>|<path>". Better Auth only trusts a single-entry X-Forwarded-For, so behind Render
// a client that sends its own X-Forwarded-For lands in one shared "no-trusted-ip" bucket; that bucket is re-keyed
// here with the address Express resolved (`trust proxy`), giving every client its own limit again.
import { pool } from '../db/pool.js';
import { logger } from './logger.js';
import { cleanIp, currentRequest } from './request-context.js';
import { sentinel } from './sentinel.js';

const CONSUME_SQL = `
  insert into public.auth_rate_limits as r (key, count, window_start) values ($1, 1, now())
  on conflict (key) do update set
    count = case when r.window_start <= now() - make_interval(secs => $2) then 1 else least(r.count + 1, $3 + 1) end,
    window_start = case when r.window_start <= now() - make_interval(secs => $2) then now() else r.window_start end
  returning count, ceil(extract(epoch from (window_start + make_interval(secs => $2) - now())))::int as retry_after`;

export function rateLimitKey(key: string, expressIp: string | null | undefined): string {
  const sep = key.lastIndexOf('|');
  const ip = sep >= 0 ? key.slice(0, sep) : '';
  const path = sep >= 0 ? key.slice(sep + 1) : key;
  const resolved = ip && ip !== 'no-trusted-ip' ? ip : (cleanIp(expressIp) ?? 'no-trusted-ip');
  return `${resolved}|${path}`.slice(0, 300);
}

export const authRateLimitStore = {
  async consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> {
    const req = currentRequest.getStore();
    const k = rateLimitKey(key, req?.ip);
    try {
      const { rows } = await pool.query<{ count: number; retry_after: number }>(CONSUME_SQL, [k, rule.window, rule.max]);
      const allowed = rows[0]!.count <= rule.max;
      if (!allowed && req && sentinel.enabled) {
        sentinel.reportRequest(req, {
          category: 'ratelimit.exceeded',
          severity: 'low',
          statusCode: 429,
          route: `/api/auth${k.slice(k.lastIndexOf('|') + 1)}`,
          description: `Rate limit on ${k.slice(k.lastIndexOf('|') + 1)} refused a request.`,
          details: { limiter: 'auth' },
        });
      }
      return { allowed, retryAfter: allowed ? null : Math.max(1, rows[0]!.retry_after) };
    } catch (err) {
      // Fail open: a database hiccup must not lock everyone out. The per-account sign-in back-off still applies.
      logger.error({ err }, 'auth rate limit check failed');
      return { allowed: true, retryAfter: null };
    }
  },
};
