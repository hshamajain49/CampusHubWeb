// Session verification and the guard chain (§10.6, §16.10).
import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Role } from '@campushub/shared';
import { auth } from '../lib/auth.js';
import { pool } from '../db/pool.js';
import { config } from '../config/env.js';
import { appError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';
import { mfaRequiredFor, mfaStatus } from '../modules/mfa/mfa.service.js';
import type { ProfileRow } from '../types/express.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header || !/^Bearer\s+\S+/i.test(header)) return next(appError('UNAUTHENTICATED', 'Sign in to continue.'));
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!result) {
    logger.debug({ reqId: req.id }, 'session not found or expired');
    return next(appError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.'));
  }
  req.auth = { userId: result.user.id, sessionId: result.session.id, sessionCreatedAt: new Date(result.session.createdAt) };
  next();
};

/** Profile + its service department (department_staff), as used by /me and the staff guard. */
export const PROFILE_SELECT = `
  select p.*, sd.name as service_department_name, sd.is_active as service_department_active,
         (select b.id_number from public.bookings b
           where b.requester_id = p.id and b.id_number is not null
           order by b.created_at desc limit 1) as last_id_number
    from public.profiles p
    left join public.service_departments sd on sd.id = p.service_department_id`;

export async function loadProfileRow(id: string): Promise<ProfileRow | null> {
  const { rows } = await pool.query<ProfileRow>(`${PROFILE_SELECT} where p.id = $1`, [id]);
  return rows[0] ?? null;
}

export const loadProfile: RequestHandler = async (req, _res, next) => {
  const profile = await loadProfileRow(req.auth!.userId);
  if (!profile) return next(appError('UNAUTHENTICATED', 'Your account is not set up. Contact the administrator.'));
  // Super Admin sessions end after SUPER_ADMIN_SESSION_HOURS whatever their activity (security/AUDIT.md F-10).
  const age = Date.now() - req.auth!.sessionCreatedAt.getTime();
  if (profile.role === 'super_admin' && age > config.SUPER_ADMIN_SESSION_HOURS * 3_600_000) {
    await pool.query('delete from public.auth_sessions where id = $1', [req.auth!.sessionId]);
    return next(appError('UNAUTHENTICATED', 'Your admin session has ended. Please sign in again.'));
  }
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

/**
 * Two-step verification (Super Admins in production): the session must have passed it. allowUnenrolled lets an
 * account that hasn't set it up yet through (changing a temporary password comes before enrolment).
 */
export function requireMfa(opts: { allowUnenrolled?: boolean } = {}): RequestHandler {
  return async (req, _res, next) => {
    const p = req.profile!;
    if (!mfaRequiredFor(p.role)) return next();
    req.mfa ??= await mfaStatus(p.id, p.role, req.auth!.sessionId);
    if (req.mfa.verified) return next();
    if (!req.mfa.enrolled) return next(opts.allowUnenrolled ? undefined : appError('MFA_ENROLLMENT_REQUIRED'));
    next(appError('MFA_REQUIRED'));
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    if (!roles.includes(req.profile!.role)) return next(appError('FORBIDDEN'));
    next();
  };
  (handler as any).__roles = roles; // read by the route self-check (§21.5)
  return handler;
}

/** authenticate → loadProfile → requireActive (→ requirePasswordFresh → requireMfa → requireRole). */
export function guard(opts: { roles?: Role[]; passwordFresh?: boolean } = {}): RequestHandler[] {
  const chain: RequestHandler[] = [authenticate, loadProfile, requireActive];
  if (opts.passwordFresh !== false) chain.push(requirePasswordFresh, requireMfa());
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
