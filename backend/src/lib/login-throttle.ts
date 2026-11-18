// Failed sign-in throttling per account (security/AUDIT.md F-02). Better Auth's own limiter is per IP only, so an
// attacker with many addresses could keep guessing one account's password; this adds two counters in Postgres:
//
//   account + IP  5 failures within 15 min → locked for 1 min, doubling with each further failure, at most 15 min.
//                 Stops one source hammering one account without affecting the owner signing in from elsewhere.
//   account       20 failures within 60 min from any mix of IPs → locked for 15 min (distributed guessing).
//
// Keys are HMACs of the normalised email, so unknown emails are throttled exactly like real ones (no existence
// oracle) and no address is stored. A successful sign-in clears its account+IP counter; a password reset clears
// every counter of the account, so a locked-out owner always has a way back in.
import { createHmac } from 'node:crypto';
import { config } from '../config/env.js';
import type { DbClient } from '../db/pool.js';
import { pool } from '../db/pool.js';

export const THROTTLE = {
  pair: { threshold: 5, windowMinutes: 15, baseLockSeconds: 60, maxLockSeconds: 15 * 60 },
  account: { threshold: 20, windowMinutes: 60, lockSeconds: 15 * 60 },
} as const;

const hmac = (value: string) => createHmac('sha256', config.BETTER_AUTH_SECRET).update(value).digest('base64url');
export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const accountKey = (email: string) => `acct:${hmac(`acct\n${normaliseEmail(email)}`)}`;
const pairKey = (email: string, ip: string) => `pair:${hmac(`pair\n${normaliseEmail(email)}\n${ip}`)}`;

/**
 * The client address as Express computes it with `trust proxy = N`: the Nth entry from the right of
 * X-Forwarded-For (left-hand entries are client-supplied and can be forged). With no trusted proxy, every request
 * shares one bucket ('direct'), which is right for local development.
 */
export function clientIpFromHeaders(headers: Headers | undefined, trustProxy = config.TRUST_PROXY): string {
  if (trustProxy < 1) return 'direct';
  const list = (headers?.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list[list.length - trustProxy] ?? 'unknown';
}

export interface ThrottleState {
  locked: boolean;
  retryAfterSeconds: number;
}

export async function checkSignInThrottle(email: string, ip: string, db: DbClient = pool): Promise<ThrottleState> {
  const { rows } = await db.query<{ wait: number | null }>(
    `select ceil(extract(epoch from max(locked_until) - now()))::int as wait
       from public.auth_login_throttle where key = any($1::text[]) and locked_until > now()`,
    [[accountKey(email), pairKey(email, ip)]],
  );
  const wait = rows[0]?.wait ?? null;
  return wait && wait > 0 ? { locked: true, retryAfterSeconds: wait } : { locked: false, retryAfterSeconds: 0 };
}

/** Counts one failure on both counters (one statement each; concurrent failures can't lose an increment). */
export async function recordSignInFailure(email: string, ip: string, db: DbClient = pool): Promise<void> {
  const acct = accountKey(email);
  const p = THROTTLE.pair;
  const a = THROTTLE.account;
  // $2 = window (min), $3 threshold; the lock for the pair grows as base × 2^(failures − threshold), capped.
  await db.query(
    `insert into public.auth_login_throttle as t (key, account_key, failures, window_started_at, locked_until)
     values ($1, $5, 1, now(), case when 1 >= $3 then now() + make_interval(secs => $4) end)
     on conflict (key) do update set
       failures = case when t.window_started_at < now() - make_interval(mins => $2) then 1 else t.failures + 1 end,
       window_started_at = case when t.window_started_at < now() - make_interval(mins => $2) then now() else t.window_started_at end,
       locked_until = case
         when (case when t.window_started_at < now() - make_interval(mins => $2) then 1 else t.failures + 1 end) >= $3
         then now() + make_interval(secs => least($6::float8, $4::float8 * power(2, (case when t.window_started_at < now() - make_interval(mins => $2) then 1 else t.failures + 1 end) - $3)))
         else t.locked_until end,
       updated_at = now()`,
    [pairKey(email, ip), p.windowMinutes, p.threshold, p.baseLockSeconds, acct, p.maxLockSeconds],
  );
  await db.query(
    `insert into public.auth_login_throttle as t (key, account_key, failures, window_started_at)
     values ($1, $1, 1, now())
     on conflict (key) do update set
       failures = case when t.window_started_at < now() - make_interval(mins => $2) then 1 else t.failures + 1 end,
       window_started_at = case when t.window_started_at < now() - make_interval(mins => $2) then now() else t.window_started_at end,
       locked_until = case
         when (case when t.window_started_at < now() - make_interval(mins => $2) then 1 else t.failures + 1 end) >= $3
         then now() + make_interval(secs => $4)
         else t.locked_until end,
       updated_at = now()`,
    [acct, a.windowMinutes, a.threshold, a.lockSeconds],
  );
}

/** A successful sign-in from this address: its account+IP counter starts over. */
export async function recordSignInSuccess(email: string, ip: string, db: DbClient = pool): Promise<void> {
  await db.query('delete from public.auth_login_throttle where key = $1', [pairKey(email, ip)]);
}

/** After a password reset: every counter and lock of the account is cleared. */
export async function clearSignInThrottle(email: string, db: DbClient = pool): Promise<void> {
  await db.query('delete from public.auth_login_throttle where account_key = $1', [accountKey(email)]);
}
