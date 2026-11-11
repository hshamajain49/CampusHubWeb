// Admin booking service: list/export/detail, and algorithms D (approve), E (reject), F (admin cancel).
import { STATUS_LABELS, type AdminBooking } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { minutesUntil, startLdt } from '../../domain/booking-rules.js';
import { publish } from '../notifications/notifier.js';
import { audit } from '../audit/audit-writer.js';
import { BOOKING_SELECT, loadHistory } from '../bookings/booking.queries.js';
import { toAdminBooking, toAdminListItem } from '../bookings/booking.mapper.js';
import { toCsv } from '../../lib/csv.js';
import { campusIsoMinute } from '../../lib/format.js';

export interface AdminBookingFilters {
  status?: string[];
  venueId?: string;
  requesterId?: string;
  role?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

function applyFilters(w: Where, f: AdminBookingFilters, withStatus = true) {
  if (withStatus && f.status?.length) w.add('b.status = any($?::text[])', f.status);
  if (f.venueId) w.add('b.venue_id = $?', f.venueId);
  if (f.requesterId) w.add('b.requester_id = $?', f.requesterId);
  if (f.role) w.add('p.role = $?', f.role);
  if (f.dateFrom) w.add('b.booking_date >= $?::date', f.dateFrom);
  if (f.dateTo) w.add('b.booking_date <= $?::date', f.dateTo);
  if (f.q) {
    const like = w.param(likePattern(f.q));
    const prefix = w.param(`${f.q.toUpperCase()}%`);
    w.add(`(b.reference like ${prefix} or b.purpose ilike ${like} or p.full_name ilike ${like} or p.email ilike ${like})`);
  }
}

const SORTS: Record<string, string> = {
  'createdAt:desc': 'b.created_at desc',
  'createdAt:asc': 'b.created_at asc',
  'start:asc': 'b.booking_date asc, b.start_time asc',
  'start:desc': 'b.booking_date desc, b.start_time desc',
};

const FROM = `from public.bookings b join public.venues v on v.id = b.venue_id join public.profiles p on p.id = b.requester_id
  left join public.profiles dp on dp.id = b.decided_by left join public.profiles cp on cp.id = b.cancelled_by`;

export async function listAdminBookings(q: AdminBookingFilters & { sort: string; page: number; pageSize: number }) {
  const campus = await loadCampus(pool);
  const w = new Where();
  applyFilters(w, q);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n ${FROM} ${where}`, w.params)).rows[0]!.n;

  const cw = new Where();
  applyFilters(cw, q, false);
  const counts = (
    await pool.query(
      `select count(*) as all,
              count(*) filter (where b.status = 'pending') as pending,
              count(*) filter (where b.status = 'approved') as approved,
              count(*) filter (where b.status = 'rejected') as rejected,
              count(*) filter (where b.status = 'cancelled') as cancelled,
              count(*) filter (where b.status = 'expired') as expired
         ${FROM} ${cw.sql()}`,
      cw.params,
    )
  ).rows[0];

  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(`${BOOKING_SELECT} ${where} order by ${SORTS[q.sort] ?? SORTS['createdAt:desc']}, b.id limit ${limit} offset ${offset}`, w.params);
  return {
    data: rows.map((r) => toAdminListItem(r, campus.localNow)),
    meta: { ...listMeta(q.page, q.pageSize, total), statusCounts: counts },
  };
}

export async function exportCsv(f: AdminBookingFilters): Promise<{ csv: string; filename: string }> {
  const campus = await loadCampus(pool);
  const w = new Where();
  applyFilters(w, f);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n ${FROM} ${where}`, w.params)).rows[0]!.n;
  if (total > 10_000) throw appError('VALIDATION_ERROR', `Too many rows (${total}). Narrow the date range.`, { fieldErrors: {}, formErrors: [] });
  const { rows } = await pool.query(
    `select b.*, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st, to_char(b.end_time, 'HH24:MI') as et,
            extract(epoch from (b.end_time - b.start_time)) / 60 as duration,
            v.name as venue_name, v.building, p.full_name, p.email, p.role, p.department, dp.full_name as decided_by_name
       ${FROM} ${where} order by b.booking_date asc, b.start_time asc`,
    w.params,
  );
  const tz = campus.settings.campusTimezone;
  const header = [
    'reference', 'venue', 'building', 'date', 'start_time', 'end_time', 'duration_minutes', 'status', 'requester_name',
    'requester_email', 'requester_role', 'department', 'purpose', 'expected_attendees', 'submitted_at', 'decided_at',
    'decided_by', 'rejection_reason', 'cancelled_at', 'cancellation_reason',
  ];
  const data = rows.map((r) => [
    r.reference, r.venue_name, r.building, r.date, r.st, r.et, Math.round(Number(r.duration)), r.status, r.full_name,
    r.email, r.role, r.department, r.purpose, r.expected_attendees, campusIsoMinute(r.created_at, tz),
    campusIsoMinute(r.decided_at, tz), r.decided_by_name, r.rejection_reason, campusIsoMinute(r.cancelled_at, tz),
    r.cancellation_reason,
  ]);
  return { csv: toCsv(header, data), filename: `bookings-${campus.today}.csv` };
}

export async function getAdminBooking(id: string): Promise<AdminBooking> {
  const { rows } = await pool.query(`${BOOKING_SELECT} where b.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw appError('BOOKING_NOT_FOUND');
  const campus = await loadCampus(pool);
  const [history, stats] = await Promise.all([
    loadHistory(pool, id),
    pool.query(
      `select count(*) as total,
              count(*) filter (where status in ('pending','approved') and (booking_date + end_time) > $2::timestamp) as upcoming
         from public.bookings where requester_id = $1`,
      [r.requester_id, campus.localNow.replace('T', ' ')],
    ),
  ]);
  return toAdminBooking(r, history, { totalBookings: stats.rows[0].total, upcomingBookings: stats.rows[0].upcoming }, campus.localNow);
}

async function lockForDecision(tx: any, id: string) {
  const { rows } = await tx.query(
    `select b.*, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st,
            v.is_active as venue_active, p.is_active as requester_active, dp.full_name as decided_by_name
       from public.bookings b
       join public.venues v on v.id = b.venue_id
       join public.profiles p on p.id = b.requester_id
       left join public.profiles dp on dp.id = b.decided_by
      where b.id = $1
      for update of b`,
    [id],
  );
  if (!rows[0]) throw appError('BOOKING_NOT_FOUND');
  return rows[0];
}

function alreadyDecided(cur: any) {
  const word = STATUS_LABELS[cur.status as keyof typeof STATUS_LABELS]?.toLowerCase() ?? cur.status;
  const by = cur.decided_by_name ? ` by ${cur.decided_by_name}` : '';
  return appError('INVALID_STATUS_TRANSITION', `This request was already ${word}${by}.`, {
    currentStatus: cur.status,
    decidedBy: cur.decided_by ? { id: cur.decided_by, fullName: cur.decided_by_name } : null,
    decidedAt: cur.decided_at ? new Date(cur.decided_at).toISOString() : null,
  });
}

// ─────────────────────────── D. Approve (E21) ───────────────────────────
export async function approveBooking(actor: Actor, id: string, body: { version: number; note?: string }) {
  await withTransaction({ actorId: actor.id, note: body.note || null }, async (tx) => {
    const cur = await lockForDecision(tx, id);
    if (cur.status !== 'pending') throw alreadyDecided(cur);
    if (cur.version !== body.version) {
      throw appError('BOOKING_CHANGED', 'The requester changed this booking. Review the updated details.', { currentVersion: cur.version });
    }
    const { localNow } = await loadCampus(tx);
    if (minutesUntil(startLdt(cur.date, cur.st), localNow) <= 0) {
      throw appError('BOOKING_IN_PAST', "This request's start time has passed. It can only be rejected.");
    }
    if (!cur.venue_active) throw appError('VENUE_INACTIVE', 'The venue is inactive. Reactivate it before approving.');
    if (!cur.requester_active) throw appError('REQUESTER_INACTIVE');
    await tx.query(`update public.bookings set status = 'approved', decided_by = $2, decided_at = now() where id = $1`, [id, actor.id]);
    await audit(tx, actor, {
      action: 'booking.approved',
      entityType: 'booking',
      entityId: id,
      summary: `Approved ${cur.reference}`,
      metadata: { note: body.note || null },
    });
    await publish(tx, { type: 'booking.approved', bookingId: id, actorId: actor.id, data: { note: body.note || null } });
  });
  return getAdminBooking(id);
}

// ─────────────────────────── E. Reject (E22) ───────────────────────────
export async function rejectBooking(actor: Actor, id: string, body: { version: number; reason: string }) {
  await withTransaction({ actorId: actor.id, note: body.reason }, async (tx) => {
    const cur = await lockForDecision(tx, id);
    if (cur.status !== 'pending') throw alreadyDecided(cur);
    if (cur.version !== body.version) {
      throw appError('BOOKING_CHANGED', 'The requester changed this booking. Review the updated details.', { currentVersion: cur.version });
    }
    await tx.query(
      `update public.bookings set status = 'rejected', rejection_reason = $2, decided_by = $3, decided_at = now() where id = $1`,
      [id, body.reason, actor.id],
    );
    await audit(tx, actor, {
      action: 'booking.rejected',
      entityType: 'booking',
      entityId: id,
      summary: `Rejected ${cur.reference}`,
      metadata: { reason: body.reason },
    });
    await publish(tx, { type: 'booking.rejected', bookingId: id, actorId: actor.id, data: { note: body.reason } });
  });
  return getAdminBooking(id);
}

// ─────────────────────────── F. Admin cancel (E23) ───────────────────────────
export async function adminCancelBooking(actor: Actor, id: string, body: { reason: string; version?: number }) {
  await withTransaction({ actorId: actor.id, note: body.reason }, async (tx) => {
    const cur = await lockForDecision(tx, id);
    if (cur.status === 'pending') throw appError('INVALID_STATUS_TRANSITION', 'Pending requests are rejected, not cancelled.');
    if (cur.status !== 'approved') {
      throw appError('INVALID_STATUS_TRANSITION', `This booking is ${cur.status} and can no longer be modified.`);
    }
    if (body.version !== undefined && body.version !== cur.version) {
      throw appError('BOOKING_CHANGED', undefined, { currentVersion: cur.version });
    }
    const { localNow } = await loadCampus(tx);
    if (minutesUntil(startLdt(cur.date, cur.st), localNow) <= 0) {
      throw appError('CANCELLATION_WINDOW_CLOSED', 'This booking has already started.');
    }
    await tx.query(
      `update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3 where id = $1`,
      [id, actor.id, body.reason],
    );
    await audit(tx, actor, {
      action: 'booking.cancelled_by_admin',
      entityType: 'booking',
      entityId: id,
      summary: `Cancelled ${cur.reference}`,
      metadata: { reason: body.reason },
    });
    await publish(tx, { type: 'booking.cancelled', bookingId: id, actorId: actor.id, data: { cancelledBy: 'admin', note: body.reason } });
  });
  return getAdminBooking(id);
}
