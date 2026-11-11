// Member booking service: algorithms A (create), B (update), C (cancel) of §10.15, plus reads.
import {
  BLOCK_TYPE_LABELS,
  type Booking,
  type BookingCreateBody,
  type BookingSummary,
  type BookingUpdateBody,
  type MemberDashboard,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import {
  assertSlot,
  cancellationClosedMessage,
  minutesUntil,
  modificationClosedMessage,
  startLdt,
} from '../../domain/booking-rules.js';
import { publish } from '../notifications/notifier.js';
import { findConflicts, loadBookingRow, loadHistory, type ConflictResult } from './booking.queries.js';
import { toBooking, toBookingSummary } from './booking.mapper.js';

const CONFLICT_MESSAGE = 'This venue is already booked for the selected date/time. Please choose a different slot.';

function throwConflicts(c: ConflictResult): void {
  const block = c.blocks[0];
  if (block) {
    throw appError(
      'VENUE_BLOCKED',
      `This venue is unavailable at the selected time (${BLOCK_TYPE_LABELS[block.blockType]}: ${block.reason}).`,
      { field: 'startTime', blockType: block.blockType, reason: block.reason, start: block.start, end: block.end },
    );
  }
  if (c.bookings.length) throw appError('BOOKING_CONFLICT', CONFLICT_MESSAGE, { field: 'startTime', conflicts: c.bookings });
}

export async function getMemberBooking(requesterId: string, id: string): Promise<Booking> {
  const row = await loadBookingRow(pool, id, requesterId);
  if (!row) throw appError('BOOKING_NOT_FOUND');
  const [history, campus] = await Promise.all([loadHistory(pool, id), loadCampus(pool)]);
  return toBooking(row, history, campus.settings, campus.localNow);
}

/** Full booking DTO regardless of owner — admin PDF (E24) only. */
export async function getBookingAnyOwner(id: string): Promise<Booking> {
  const row = await loadBookingRow(pool, id);
  if (!row) throw appError('BOOKING_NOT_FOUND');
  const [history, campus] = await Promise.all([loadHistory(pool, id), loadCampus(pool)]);
  return toBooking(row, history, campus.settings, campus.localNow);
}

// ─────────────────────────── A. Create (E11) ───────────────────────────
export async function createBooking(
  actor: Actor,
  body: BookingCreateBody,
  idempotencyKey: string | null,
): Promise<{ booking: Booking; replay: boolean }> {
  const replayOf = async () => {
    const { rows } = await pool.query<{ id: string }>(
      'select id from public.bookings where requester_id = $1 and idempotency_key = $2',
      [actor.id, idempotencyKey],
    );
    return rows[0]?.id ?? null;
  };
  if (idempotencyKey) {
    const existing = await replayOf();
    if (existing) return { booking: await getMemberBooking(actor.id, existing), replay: true };
  }

  let id: string;
  try {
    id = await withTransaction({ actorId: actor.id }, async (tx) => {
      await tx.query('select id from public.profiles where id = $1 for update', [actor.id]);
      const venue = (await tx.query('select * from public.venues where id = $1 for update', [body.venueId])).rows[0];
      if (!venue) throw appError('VENUE_NOT_FOUND', "This venue doesn't exist.", { field: 'venueId' });
      if (!venue.is_active) throw appError('VENUE_INACTIVE', undefined, { field: 'venueId' });

      const { settings, localNow } = await loadCampus(tx);
      assertSlot(body, settings, localNow);

      const attendees = body.expectedAttendees ?? null;
      if (attendees !== null && attendees > venue.capacity) {
        throw appError('CAPACITY_EXCEEDED', `${venue.name} holds up to ${venue.capacity} people.`, {
          field: 'expectedAttendees',
          capacity: venue.capacity,
        });
      }

      const pending = (
        await tx.query<{ n: number }>("select count(*) as n from public.bookings where requester_id = $1 and status = 'pending'", [
          actor.id,
        ])
      ).rows[0]!.n;
      if (pending >= settings.maxPendingPerUser) {
        throw appError(
          'PENDING_LIMIT_REACHED',
          `You already have ${pending} pending requests, the maximum allowed. Wait for a decision or cancel one before making another.`,
          { limit: settings.maxPendingPerUser, current: pending },
        );
      }

      throwConflicts(await findConflicts(tx, body.venueId, body.date, body.startTime, body.endTime, actor.id));

      const ins = await tx.query<{ id: string }>(
        `insert into public.bookings (venue_id, requester_id, booking_date, start_time, end_time, purpose, expected_attendees, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [body.venueId, actor.id, body.date, body.startTime, body.endTime, body.purpose, attendees, idempotencyKey],
      );
      const newId = ins.rows[0]!.id;
      await publish(tx, { type: 'booking.submitted', bookingId: newId, actorId: actor.id });
      return newId;
    });
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'bookings_requester_idempotency_key') {
      const existing = await replayOf();
      if (existing) return { booking: await getMemberBooking(actor.id, existing), replay: true };
    }
    if (err?.code === '23P01' && err?.constraint === 'bookings_no_overlap') {
      const c = await findConflicts(pool, body.venueId, body.date, body.startTime, body.endTime, actor.id);
      throw appError('BOOKING_CONFLICT', CONFLICT_MESSAGE, { field: 'startTime', conflicts: c.bookings });
    }
    throw err;
  }
  return { booking: await getMemberBooking(actor.id, id), replay: false };
}

// ─────────────────────────── B. Update (E14) ───────────────────────────
export async function updateBooking(actor: Actor, id: string, body: BookingUpdateBody): Promise<Booking> {
  const first = await pool.query<{ venue_id: string }>('select venue_id from public.bookings where id = $1 and requester_id = $2', [
    id,
    actor.id,
  ]);
  if (!first.rows[0]) throw appError('BOOKING_NOT_FOUND');
  const venueId = first.rows[0].venue_id;

  await withTransaction({ actorId: actor.id }, async (tx) => {
    const venue = (await tx.query('select * from public.venues where id = $1 for update', [venueId])).rows[0];
    const cur = (
      await tx.query(
        `select b.*, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st, to_char(b.end_time, 'HH24:MI') as et
           from public.bookings b where b.id = $1 for update`,
        [id],
      )
    ).rows[0];

    if (cur.version !== body.version) {
      throw appError('BOOKING_CHANGED', 'This booking was updated while you were editing. Review the latest details and try again.', {
        currentVersion: cur.version,
      });
    }
    if (cur.status !== 'pending' && cur.status !== 'approved') {
      throw appError('INVALID_STATUS_TRANSITION', `This booking is ${cur.status} and can no longer be modified.`);
    }
    const { settings, localNow } = await loadCampus(tx);
    if (minutesUntil(startLdt(cur.date, cur.st), localNow) <= settings.modificationCutoffMinutes) {
      throw appError('MODIFICATION_WINDOW_CLOSED', modificationClosedMessage(settings.modificationCutoffMinutes));
    }
    if (!venue.is_active) {
      throw appError('VENUE_INACTIVE', 'This venue is no longer accepting changes. You can still cancel this booking.');
    }

    const next = {
      date: body.date ?? cur.date,
      startTime: body.startTime ?? cur.st,
      endTime: body.endTime ?? cur.et,
      purpose: body.purpose ?? cur.purpose,
      expectedAttendees: body.expectedAttendees !== undefined ? body.expectedAttendees : cur.expected_attendees,
    };
    const slotChanged = next.date !== cur.date || next.startTime !== cur.st || next.endTime !== cur.et;
    const changed =
      slotChanged || next.purpose !== cur.purpose || (next.expectedAttendees ?? null) !== (cur.expected_attendees ?? null);
    if (!changed) return;

    if (slotChanged) {
      assertSlot(next, settings, localNow);
      throwConflicts(await findConflicts(tx, venueId, next.date, next.startTime, next.endTime, actor.id, id));
    }
    if (
      next.expectedAttendees !== null &&
      next.expectedAttendees !== cur.expected_attendees &&
      next.expectedAttendees > venue.capacity
    ) {
      throw appError('CAPACITY_EXCEEDED', `${venue.name} holds up to ${venue.capacity} people.`, {
        field: 'expectedAttendees',
        capacity: venue.capacity,
      });
    }

    await tx.query(
      `update public.bookings
          set booking_date = $2, start_time = $3, end_time = $4, purpose = $5, expected_attendees = $6,
              status = case when status = 'approved' then 'pending' else status end
        where id = $1`,
      [id, next.date, next.startTime, next.endTime, next.purpose, next.expectedAttendees],
    );
    await publish(tx, {
      type: 'booking.modified',
      bookingId: id,
      actorId: actor.id,
      data: { returnedToPending: cur.status === 'approved', previousStatus: cur.status },
    });
  });
  return getMemberBooking(actor.id, id);
}

// ─────────────────────────── C. Cancel (E15) ───────────────────────────
export async function cancelBooking(actor: Actor, id: string, body: { reason?: string; version?: number }): Promise<Booking> {
  await withTransaction({ actorId: actor.id, note: body.reason || null }, async (tx) => {
    const cur = (
      await tx.query(
        `select b.*, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st
           from public.bookings b where b.id = $1 and b.requester_id = $2 for update`,
        [id, actor.id],
      )
    ).rows[0];
    if (!cur) throw appError('BOOKING_NOT_FOUND');
    if (cur.status === 'cancelled') return; // idempotent
    if (cur.status !== 'pending' && cur.status !== 'approved') {
      throw appError('INVALID_STATUS_TRANSITION', `This booking is ${cur.status} and can no longer be modified.`);
    }
    if (body.version !== undefined && body.version !== cur.version) {
      throw appError('BOOKING_CHANGED', undefined, { currentVersion: cur.version });
    }
    const { settings, localNow } = await loadCampus(tx);
    const until = minutesUntil(startLdt(cur.date, cur.st), localNow);
    if (cur.status === 'pending' && until <= 0) {
      throw appError('CANCELLATION_WINDOW_CLOSED', 'This booking has already started.');
    }
    if (cur.status === 'approved' && until <= settings.cancellationCutoffMinutes) {
      throw appError('CANCELLATION_WINDOW_CLOSED', cancellationClosedMessage(settings.cancellationCutoffMinutes));
    }
    await tx.query(
      `update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3 where id = $1`,
      [id, actor.id, body.reason || null],
    );
    await publish(tx, {
      type: 'booking.cancelled',
      bookingId: id,
      actorId: actor.id,
      data: { cancelledBy: 'requester', previousStatus: cur.status },
    });
  });
  return getMemberBooking(actor.id, id);
}

// ─────────────────────────── Reads ───────────────────────────
export async function listMyBookings(
  requesterId: string,
  q: { scope: 'upcoming' | 'history' | 'all'; status?: string[]; from?: string; to?: string; sort?: string; page: number; pageSize: number },
) {
  const campus = await loadCampus(pool);
  const w = new Where();
  w.add('b.requester_id = $?', requesterId);
  const now = campus.localNow.replace('T', ' ');
  if (q.scope === 'upcoming') w.add(`b.status in ('pending','approved') and (b.booking_date + b.end_time) > $?::timestamp`, now);
  if (q.scope === 'history')
    w.add(`(b.status in ('rejected','cancelled','expired') or (b.booking_date + b.end_time) <= $?::timestamp)`, now);
  if (q.status?.length) w.add('b.status = any($?::text[])', q.status);
  if (q.from) w.add('b.booking_date >= $?::date', q.from);
  if (q.to) w.add('b.booking_date <= $?::date', q.to);
  const sort = q.sort ?? (q.scope === 'upcoming' ? 'start:asc' : 'start:desc');
  const order = sort === 'start:asc' ? 'b.booking_date asc, b.start_time asc' : 'b.booking_date desc, b.start_time desc';

  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.bookings b ${where}`, w.params)).rows[0]!.n;
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `select * from (${BOOKING_SELECT_INNER}) b ${where} order by ${order} limit ${limit} offset ${offset}`,
    w.params,
  );
  return {
    data: rows.map((r) => toBookingSummary(normalize(r), campus.settings, campus.localNow)) as BookingSummary[],
    meta: listMeta(q.page, q.pageSize, total),
  };
}

/** The joined select exposed with booking-table column names so the same WHERE works on it. */
export const BOOKING_SELECT_INNER = `
  select b.*, b.booking_date as date,
         v.name as venue_name, v.building as venue_building, v.venue_type, v.location_details as venue_location,
         v.capacity as venue_capacity, v.is_active as venue_active,
         p.full_name as requester_name, p.email as requester_email, p.role as requester_role,
         p.department as requester_department, p.is_active as requester_active
    from public.bookings b
    join public.venues v on v.id = b.venue_id
    join public.profiles p on p.id = b.requester_id`;

export async function memberDashboard(requesterId: string): Promise<MemberDashboard> {
  const campus = await loadCampus(pool);
  const now = campus.localNow.replace('T', ' ');
  const counts = (
    await pool.query(
      `select count(*) filter (where status = 'pending' and (booking_date + start_time) > $2::timestamp) as pending,
              count(*) filter (where status = 'approved' and (booking_date + end_time) > $2::timestamp) as upcoming_approved,
              count(*) filter (where status in ('rejected','cancelled','expired') or (booking_date + end_time) <= $2::timestamp) as history
         from public.bookings where requester_id = $1`,
      [requesterId, now],
    )
  ).rows[0];
  const next = await pool.query(
    `select * from (${BOOKING_SELECT_INNER}) b
      where b.requester_id = $1 and b.status in ('pending','approved') and (b.booking_date + b.end_time) > $2::timestamp
      order by b.booking_date, b.start_time limit 1`,
    [requesterId, now],
  );
  const recent = await pool.query(
    `select * from (${BOOKING_SELECT_INNER}) b where b.requester_id = $1 order by b.created_at desc limit 5`,
    [requesterId],
  );
  const map = (r: any) => toBookingSummary(normalize(r), campus.settings, campus.localNow);
  return {
    counts: { pending: counts.pending, upcomingApproved: counts.upcoming_approved, history: counts.history },
    nextBooking: next.rows[0] ? map(next.rows[0]) : null,
    recentBookings: recent.rows.map(map),
  };
}

/** Rows from BOOKING_SELECT_INNER carry raw 'HH:mm:ss' times; the mapper expects 'HH:mm'. */
export function normalize(r: any): any {
  return { ...r, start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) };
}
