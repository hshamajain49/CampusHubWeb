// The Express request being handled, for code that only sees a Fetch-style Request (Better Auth hooks and its
// rate-limit store): it gives them the client address exactly as Express resolved it with `trust proxy`.
import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import type { Request } from 'express';

export const currentRequest = new AsyncLocalStorage<Request>();

/** "203.0.113.9" from "::ffff:203.0.113.9"; null for anything that isn't an IP. */
export function cleanIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/i, '');
  return isIP(v) ? v : null;
}
