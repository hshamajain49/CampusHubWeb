// Session verification and the guard chain (§10.6, §16.10).
import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Role } from '@campushub/shared';
import { auth } from '../lib/auth.js';
import { pool } from '../db/pool.js';
import { appError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import type { ProfileRow } from '../types/express.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header || !/^Bearer\s+\S+/i.test(header)) return next(appError('UNAUTHENTICATED', 'Sign in to continue.'));
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!result) {
    logger.debug({ reqId: req.id }, 'session not found or expired');
    return next(appError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.'));
  }
  req.auth = { userId: result.user.id, sessionId: result.session.id };
  next();
};

/** Profile + its service department (department_staff), as used by /me and the staff guard. */
export const PROFILE_SELECT = `
  select p.*, sd.name as service_department_name, sd.is_active as service_department_active
    from public.profiles p
    left join public.service_departments sd on sd.id = p.service_department_id`;

export async function loadProfileRow(id: string): Promise<ProfileRow | null> {
  const { rows } = await pool.query<ProfileRow>(`${PROFILE_SELECT} where p.id = $1`, [id]);
  return rows[0] ?? null;
}

export const loadProfile: RequestHandler = async (req, _res, next) => {
  const profile = await loadProfileRow(req.auth!.userId);
  if (!profile) return next(appError('UNAUTHENTICATED', 'Your account is not set up. Contact the administrator.'));
  req.profile = profile;
  next();
};

export const requireActive: RequestHandler = (req, _res, next) => {
  if (!req.profile!.is_active) return next(appError('ACCOUNT_DEACTIVATED'));
  next();
};

export const requirePasswordFresh: RequestHandler = (req, _res, next) => {
  if (req.profile!.must_change_password) return next(appError('PASSWORD_CHANGE_REQUIRED'));
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    if (!roles.includes(req.profile!.role)) return next(appError('FORBIDDEN'));
    next();
  };
  (handler as any).__roles = roles; // read by the route self-check (§21.5)
  return handler;
}

/** authenticate → loadProfile → requireActive (→ requirePasswordFresh → requireRole). */
export function guard(opts: { roles?: Role[]; passwordFresh?: boolean } = {}): RequestHandler[] {
  const chain: RequestHandler[] = [authenticate, loadProfile, requireActive];
  if (opts.passwordFresh !== false) chain.push(requirePasswordFresh);
  if (opts.roles) chain.push(requireRole(...opts.roles));
  return chain;
}

export interface Actor {
  id: string;
  role: Role;
  fullName: string;
  ip: string | null;
  userAgent: string | null;
}

export function actorOf(req: Parameters<RequestHandler>[0]): Actor {
  return {
    id: req.profile!.id,
    role: req.profile!.role,
    fullName: req.profile!.full_name,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  };
}
