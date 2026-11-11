import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config/env.js';
import { appError } from '../errors/app-error.js';

export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // keep timing similar for wrong-length input
    return false;
  }
  return timingSafeEqual(a, b);
}

export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
  if (!m || !secretMatches(m[1]!.trim(), config.CRON_SECRET)) return next(appError('UNAUTHENTICATED', 'Invalid cron secret.'));
  next();
};
