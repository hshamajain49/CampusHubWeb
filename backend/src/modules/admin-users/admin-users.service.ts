// Admin user management E37–E43 with algorithms I (deactivate) and J (activate).
import {
  domainAllowed,
  domainRestrictionMessage,
  ROLE_LABELS,
  type CreateUserBody,
  type Role,
  type UpdateUserBody,
  type UserDetail,
  type UserListItem,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError, validationError } from '../../errors/app-error.js';
import type { DbClient } from '../../db/pool.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { createCredentialUser, hashPassword, revokeSessions, sendPasswordReset } from '../../lib/auth-accounts.js';
import { audit } from '../audit/audit-writer.js';
import { BOOKING_SELECT } from '../bookings/booking.queries.js';
import { toAdminListItem } from '../bookings/booking.mapper.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const COUNTS = `
  (select count(*) from public.bookings b where b.requester_id = p.id) as total,
  (select count(*) from public.bookings b where b.requester_id = p.id and b.status in ('pending','approved') and (b.booking_date + b.end_time) > $NOW::timestamp) as upcoming,
  (select count(*) from public.bookings b where b.requester_id = p.id and b.status = 'pending') as pending`;

function baseUser(r: any) {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    department: r.department,
    serviceDepartment: r.service_department_id ? { id: r.service_department_id, name: r.sd_name, isActive: !!r.sd_active } : null,
    isActive: r.is_active,
    mustChangePassword: r.must_change_password,
    createdAt: iso(r.created_at)!,
    lastSignInAt: iso(r.last_sign_in_at),
  };
}

/** Joined into every user query: the service department of department_staff accounts. */
const SD_JOIN = 'left join public.service_departments sd on sd.id = p.service_department_id';

/**
 * The service department a role needs (E38/E40, CEC-18): department_staff requires an active one; every other role
 * has none, and sending one is an error.
 */
async function serviceDepartmentFor(db: DbClient, role: Role, requested: string | null | undefined, current: string | null = null) {
  if (role !== 'department_staff') {
    if (requested) throw validationError({ serviceDepartmentId: ['Only department staff belong to a service department.'] });
    return null;
  }
  const id = requested !== undefined ? requested : current;
  if (!id) throw appError('SERVICE_DEPARTMENT_REQUIRED', undefined, { field: 'serviceDepartmentId' });
  if (id === current) return id;
  const { rows } = await db.query<{ is_active: boolean }>('select is_active from public.service_departments where id = $1', [id]);
  if (!rows[0]?.is_active) throw appError('SERVICE_DEPARTMENT_REQUIRED', 'Choose an active department.', { field: 'serviceDepartmentId' });
  return id;
}

const SORTS: Record<string, string> = { 'createdAt:desc': 'p.created_at desc', 'name:asc': 'lower(p.full_name) asc' };

export async function listUsers(q: {
  q?: string;
  role?: string;
  serviceDepartmentId?: string;
  isActive?: boolean;
  sort: string;
  page: number;
  pageSize: number;
}) {
  const campus = await loadCampus(pool);
  const w = new Where();
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(`(p.full_name ilike ${like} or p.email ilike ${like})`);
  }
  if (q.role) w.add('p.role = $?', q.role);
  if (q.serviceDepartmentId) w.add('p.service_department_id = $?', q.serviceDepartmentId);
  if (q.isActive !== undefined) w.add('p.is_active = $?', q.isActive);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.profiles p ${where}`, w.params)).rows[0]!.n;
  const nowP = w.param(campus.localNow.replace('T', ' '));
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `select p.*, sd.name as sd_name, sd.is_active as sd_active, ${COUNTS.replaceAll('$NOW', nowP)}
       from public.profiles p ${SD_JOIN} ${where}
      order by ${SORTS[q.sort] ?? SORTS['createdAt:desc']}, p.id limit ${limit} offset ${offset}`,
    w.params,
  );
  const data: UserListItem[] = rows.map((r) => ({
    ...baseUser(r),
    bookingCounts: { total: r.total, upcoming: r.upcoming, pending: r.pending },
  }));
  return { data, meta: listMeta(q.page, q.pageSize, total) };
}

export async function getUser(actor: Actor, id: string): Promise<UserDetail> {
  const campus = await loadCampus(pool);
  const now = campus.localNow.replace('T', ' ');
  const { rows } = await pool.query(
    `select p.*, ${COUNTS.replaceAll('$NOW', '$2')},
            (select count(*) from public.bookings b where b.requester_id = p.id and b.status = 'approved') as approved,
            (select count(*) from public.bookings b where b.requester_id = p.id and b.status = 'rejected') as rejected,
            (select count(*) from public.bookings b where b.requester_id = p.id and b.status = 'cancelled') as cancelled,
            (select count(*) from public.bookings b where b.requester_id = p.id and b.status = 'expired') as expired,
            sd.name as sd_name, sd.is_active as sd_active
       from public.profiles p ${SD_JOIN} where p.id = $1`,
    [id, now],
  );
  const r = rows[0];
  if (!r) throw appError('USER_NOT_FOUND');
  const recent = await pool.query(`${BOOKING_SELECT} where b.requester_id = $1 order by b.created_at desc limit 10`, [id]);
  const editable = r.role !== 'super_admin' && r.id !== actor.id;
  return {
    ...baseUser(r),
    bookingCounts: {
      total: r.total,
      upcoming: r.upcoming,
      pending: r.pending,
      approved: r.approved,
      rejected: r.rejected,
      cancelled: r.cancelled,
      expired: r.expired,
    },
    recentBookings: recent.rows.map((b) => toAdminListItem(b, campus.localNow)),
    permissions: {
      canEdit: editable,
      canDeactivate: editable && r.is_active,
      canActivate: editable && !r.is_active,
      canSendPasswordReset: editable && r.is_active,
    },
  };
}

export async function createUser(actor: Actor, body: CreateUserBody): Promise<UserDetail> {
  const { settings } = await loadCampus(pool);
  if (!domainAllowed(body.email, settings.allowedEmailDomains)) {
    throw appError('EMAIL_DOMAIN_NOT_ALLOWED', domainRestrictionMessage(settings.allowedEmailDomains), { field: 'email' });
  }
  const serviceDepartmentId = await serviceDepartmentFor(pool, body.role, body.serviceDepartmentId);
  const hash = await hashPassword(body.temporaryPassword);
  const id = await withTransaction({ actorId: actor.id }, async (tx) => {
    const userId = await createCredentialUser(tx, { email: body.email, name: body.fullName, passwordHash: hash });
    // Role and service department change together: profiles_staff_department requires both or neither.
    await tx.query(
      'update public.profiles set role = $2, department = $3, service_department_id = $4, must_change_password = true where id = $1',
      [userId, body.role, body.department ?? null, serviceDepartmentId],
    );
    await audit(tx, actor, {
      action: 'user.created',
      entityType: 'user',
      entityId: userId,
      summary: `Created ${ROLE_LABELS[body.role].toLowerCase()} account ${body.email}`,
      metadata: { role: body.role, serviceDepartmentId },
    });
    return userId;
  });
  return getUser(actor, id);
}

async function lockEditableTarget(tx: any, actor: Actor, id: string) {
  const { rows } = await tx.query('select * from public.profiles where id = $1 for update', [id]);
  const target = rows[0];
  if (!target) throw appError('USER_NOT_FOUND');
  if (target.id === actor.id) throw appError('PROTECTED_ACCOUNT', "You can't change your own account here.");
  if (target.role === 'super_admin') throw appError('PROTECTED_ACCOUNT');
  return target;
}

export async function updateUser(actor: Actor, id: string, body: UpdateUserBody): Promise<UserDetail> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const t = await lockEditableTarget(tx, actor, id);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const role: Role = body.role ?? t.role;
    const next = {
      full_name: body.fullName ?? t.full_name,
      role,
      department: body.department !== undefined ? body.department : t.department,
      service_department_id: await serviceDepartmentFor(tx, role, body.serviceDepartmentId, t.service_department_id),
    };
    for (const [k, v] of Object.entries(next)) {
      if (t[k] === v) continue;
      before[k] = t[k];
      after[k] = v;
    }
    if (!Object.keys(after).length) return;
    await tx.query('update public.profiles set full_name = $2, role = $3, department = $4, service_department_id = $5 where id = $1', [
      id,
      next.full_name,
      next.role,
      next.department,
      next.service_department_id,
    ]);
    await audit(tx, actor, { action: 'user.updated', entityType: 'user', entityId: id, summary: `Updated ${t.email}`, metadata: { before, after } });
  });
  return getUser(actor, id);
}

// ─────────────────────────── I. Deactivate (E41) ───────────────────────────
export async function deactivateUser(actor: Actor, id: string, body: { cancelUpcomingBookings: boolean }) {
  let cancelled = 0;
  await withTransaction({ actorId: actor.id, note: 'Account deactivated by administrator' }, async (tx) => {
    const t = await lockEditableTarget(tx, actor, id);
    if (!t.is_active) return;
    if (body.cancelUpcomingBookings) {
      const { localNow } = await loadCampus(tx);
      const res = await tx.query(
        `update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(),
                cancellation_reason = 'Account deactivated by administrator'
          where requester_id = $1 and (status = 'pending' or (status = 'approved' and lower(slot) > $3::timestamp))`,
        [id, actor.id, localNow.replace('T', ' ')],
      );
      cancelled = res.rowCount ?? 0;
    }
    await tx.query('update public.profiles set is_active = false where id = $1', [id]);
    await revokeSessions(tx, id);
    await tx.query('delete from public.push_subscriptions where user_id = $1', [id]);
    await audit(tx, actor, {
      action: 'user.deactivated',
      entityType: 'user',
      entityId: id,
      summary: `Deactivated ${t.email}`,
      metadata: { cancelledBookings: cancelled },
    });
  });
  return { user: await getUser(actor, id), affected: { cancelled } };
}

// ─────────────────────────── J. Activate (E42) ───────────────────────────
export async function activateUser(actor: Actor, id: string) {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const t = await lockEditableTarget(tx, actor, id);
    if (t.is_active) return;
    await tx.query('update public.profiles set is_active = true where id = $1', [id]);
    await audit(tx, actor, { action: 'user.activated', entityType: 'user', entityId: id, summary: `Activated ${t.email}` });
  });
  return { user: await getUser(actor, id) };
}

export async function sendUserPasswordReset(actor: Actor, id: string) {
  const { rows } = await pool.query('select * from public.profiles where id = $1', [id]);
  const t = rows[0];
  if (!t) throw appError('USER_NOT_FOUND');
  if (t.role === 'super_admin' || t.id === actor.id) throw appError('PROTECTED_ACCOUNT');
  if (!t.is_active) throw appError('REQUESTER_INACTIVE', 'Activate the account before sending a reset link.');
  await sendPasswordReset(t.email);
  await audit(pool, actor, { action: 'user.password_reset_sent', entityType: 'user', entityId: id, summary: `Sent password reset to ${t.email}` });
  return { sent: true };
}
