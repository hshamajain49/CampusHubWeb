// /me (E03–E05), registration (E02), push subscriptions (E52/E53).
import { domainAllowed, domainRestrictionMessage, type Me, type RegisterBody } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { appError } from '../../errors/app-error.js';
import { loadCampus } from '../../domain/settings.js';
import { createCredentialUser, hashPassword, revokeSessions, setPassword, verifyPassword } from '../../lib/auth-accounts.js';
import { pushEnabled } from '../../lib/push.js';
import type { ProfileRow } from '../../types/express.js';
import { loadProfileRow } from '../../middleware/authenticate.js';

export function toMe(p: ProfileRow): Me {
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    department: p.department,
    serviceDepartment: p.service_department_id
      ? { id: p.service_department_id, name: p.service_department_name ?? '', isActive: !!p.service_department_active }
      : null,
    isActive: p.is_active,
    mustChangePassword: p.must_change_password,
    emailNotifications: p.email_notifications,
    createdAt: new Date(p.created_at).toISOString(),
    lastSignInAt: p.last_sign_in_at ? new Date(p.last_sign_in_at).toISOString() : null,
  };
}

export async function register(body: RegisterBody) {
  const { settings } = await loadCampus(pool);
  if (!settings.selfRegistrationEnabled) throw appError('REGISTRATION_DISABLED');
  if (!domainAllowed(body.email, settings.allowedEmailDomains)) {
    throw appError('EMAIL_DOMAIN_NOT_ALLOWED', domainRestrictionMessage(settings.allowedEmailDomains), { field: 'email' });
  }
  const hash = await hashPassword(body.password);
  const userId = await withTransaction({ actorId: null }, async (tx) => {
    const id = await createCredentialUser(tx, { email: body.email, name: body.fullName, passwordHash: hash });
    await tx.query('update public.profiles set department = $2 where id = $1', [id, body.department ?? null]);
    return id;
  });
  return { userId, email: body.email };
}

export async function updateMe(p: ProfileRow, body: { fullName?: string; department?: string | null; emailNotifications?: boolean }): Promise<Me> {
  const department = p.role === 'super_admin' ? p.department : body.department !== undefined ? body.department : p.department;
  await pool.query(`update public.profiles set full_name = $2, department = $3, email_notifications = $4 where id = $1`, [
    p.id,
    body.fullName ?? p.full_name,
    department,
    body.emailNotifications ?? p.email_notifications,
  ]);
  return toMe((await loadProfileRow(p.id))!);
}

export async function changePassword(userId: string, sessionId: string, body: { currentPassword: string; newPassword: string }) {
  if (!(await verifyPassword(userId, body.currentPassword))) {
    throw appError('INVALID_CURRENT_PASSWORD', 'Current password is incorrect.', { field: 'currentPassword' });
  }
  const hash = await hashPassword(body.newPassword);
  await withTransaction({ actorId: userId }, async (tx) => {
    await setPassword(tx, userId, hash);
    await revokeSessions(tx, userId, sessionId);
    await tx.query('update public.profiles set must_change_password = false where id = $1', [userId]);
  });
}

export async function addPushSubscription(
  userId: string,
  userAgent: string | null,
  body: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  if (!pushEnabled) throw appError('NOT_FOUND', 'Push notifications are not configured.');
  await pool.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret, user_agent)
     values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
       auth_secret = excluded.auth_secret, user_agent = excluded.user_agent`,
    [userId, body.endpoint, body.keys.p256dh, body.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
  await pool.query(
    `delete from public.push_subscriptions where id in (
       select id from public.push_subscriptions where user_id = $1 order by created_at desc offset 10)`,
    [userId],
  );
}

export async function removePushSubscription(userId: string, endpoint: string) {
  await pool.query('delete from public.push_subscriptions where endpoint = $1 and user_id = $2', [endpoint, userId]);
}
