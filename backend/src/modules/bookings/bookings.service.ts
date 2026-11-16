// Member booking service (docs/BOOKINGS.md): create (confirm or queue), update, cancel (+ FIFO promotion), reads.
//
// Concurrency: every write that can take or free a slot locks the venue row first, so requests for one venue are
// handled one at a time. The first valid request is confirmed; anything that then overlaps a confirmed booking is
// queued. bookings_no_overlap (confirmed only) is the database's last line of defence.
import {
  BLOCK_TYPE_LABELS,
  type Booking,
  type BookingCreateBody,
  type BookingSummary,
  type BookingUpdateBody,
  type MemberDashboard,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction, type Tx } from '../../db/transaction.js';
import { listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { addDays, diffDays } from '@campushub/shared';
import { assertSlot, minutesUntil, modificationClosedMessage, startLdt } from '../../domain/booking-rules.js';
import { publish } from '../notifications/notifier.js';
import {
  findConflicts,
  loadBookingRow,
  loadHistory,
  promoteQueue,
  QUEUE_POSITION_SQL,
  UPCOMING_SQL,
  type ConflictResult,
} from './booking.queries.js';

export { UPCOMING_SQL };
import { toBooking, toBookingSummary } from './booking.mapper.js';
import { memberComplaintSummary } from '../complaints/complaints.service.js';

const CONFLICT_MESSAGE = 'This venue is already booked for the selected date/time. Please choose a different slot.';

/** Blocks and the member's own overlapping bookings stop a request; a confirmed booking only queues it. */
function throwHardConflicts(c: ConflictResult): void {
  const block = c.blocks[0];
  if (block) {
    throw appError(
      'VENUE_BLOCKED',
      `This venue is unavailable at the selected time (${BLOCK_TYPE_LABELS[block.blockType]}: ${block.reason}).`,
      { field: 'startTime', blockType: block.blockType, reason: block.reason, start: block.start, end: block.end },
    );
  }
  const own = c.own[0];
  if (own) {
    throw appError(
      'DUPLICATE_BOOKING',
      own.status === 'queued'
        ? `You're already in the queue for this venue at this time (${own.reference}).`
        : `You already have this venue booked at this time (${own.reference}).`,
      { field: 'startTime', bookingId: own.id, reference: own.reference, status: own.status },
    );
  }
}

/**
 * After a booking was set to cancelled: offer a confirmed booking's time to the queue (FIFO), then tell the member what
 * happened (venue, status, and whether the time went to the next in line or is free again), and announce the result
 * (a promotion is a new booking; a free time is "available again" for everyone).
 */
export async function cancelAndOfferSlot(
  tx: Tx,
  c: {
    id: string;
    venueId: string;
    previousStatus: 'confirmed' | 'queued';
    cancelledBy: 'requester' | 'admin' | 'system';
    actorId: string | null;
    note?: string | null;
    /** Blocks and deactivations: the time is not bookable, so nothing is offered or announced. */
    slotUnavailable?: boolean;
  },
): Promise<string[]> {
  const promoted = c.previousStatus === 'confirmed' && !c.slotUnavailable ? await promoteQueue(tx, c.venueId) : [];
  const slot =
    c.previousStatus === 'queued' ? 'left_queue' : c.slotUnavailable ? 'unavailable' : promoted.length ? 'queue' : 'free';
  await publish(tx, {
    type: 'booking.cancelled',
    bookingId: c.id,
    actorId: c.actorId,
    data: { cancelledBy: c.cancelledBy, previousStatus: c.previousStatus, note: c.note ?? null, slot },
  });
  for (const bookingId of promoted) await publish(tx, { type: 'booking.promoted', bookingId, actorId: c.actorId });
  return promoted;
}

/** Promotes the venue's queue and notifies everyone who got a slot. */
export async function promoteAndNotify(tx: Tx, venueId: string, actorId: string | null): Promise<string[]> {
  const promoted = await promoteQueue(tx, venueId);
  for (const bookingId of promoted) await publish(tx, { type: 'booking.promoted', bookingId, actorId });
  return promoted;
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
      // Member first (the upcoming-bookings limit), then the venue: the same order as every other writer. NO KEY UPDATE
      // serialises this member's requests without blocking foreign-key checks (notifications addressed to them).
      await tx.query('select id from public.profiles where id = $1 for no key update', [actor.id]);
      const venue = (await tx.query('select * from public.venues where id = $1 for update', [body.venueId])).rows[0];
      if (!venue) throw appError('VENUE_NOT_FOUND', "This venue doesn't exist.", { field: 'venueId' });
      if (!venue.is_active) throw appError('VENUE_INACTIVE', undefined, { field: 'venueId' });

      const { settings, localNow } = await loadCampus(tx);
      // Multi-day: the same window on every day from date to endDate (one day when endDate is absent).
      const slot = { date: body.date, endDate: body.endDate || body.date, startTime: body.startTime, endTime: body.endTime };
      assertSlot(slot, settings, localNow);

      const attendees = body.expectedAttendees ?? null;
      if (attendees !== null && attendees > venue.capacity) {
        throw appError('CAPACITY_EXCEEDED', `${venue.name} holds up to ${venue.capacity} people.`, {
          field: 'expectedAttendees',
          capacity: venue.capacity,
        });
      }

      const now = localNow.replace('T', ' ');
      const active = (
        await tx.query<{ n: number }>(`select count(*) as n from public.bookings b where b.requester_id = $1 and ${UPCOMING_SQL('$2::timestamp')}`, [
          actor.id,
          now,
        ])
      ).rows[0]!.n;
      if (active >= settings.maxActivePerUser) {
        throw appError(
          'BOOKING_LIMIT_REACHED',
          `You already have ${active} upcoming bookings, the maximum allowed. Cancel one before booking again.`,
          { limit: settings.maxActivePerUser, current: active },
        );
      }

      const c = await findConflicts(tx, body.venueId, slot, actor.id);
      throwHardConflicts(c);
      // All days or nothing: one booked day queues the whole request.
      const status = c.bookings.length ? 'queued' : 'confirmed';

      const ins = await tx.query<{ id: string }>(
        `insert into public.bookings (venue_id, requester_id, booking_date, end_date, start_time, end_time, purpose, expected_attendees,
                                      id_number, status, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [body.venueId, actor.id, slot.date, slot.endDate, body.startTime, body.endTime, body.purpose, attendees, body.idNumber, status, idempotencyKey],
      );
      const newId = ins.rows[0]!.id;
      // Everyone already queued for this time arrived earlier, so the new request goes behind all of them.
      await publish(tx, {
        type: status === 'confirmed' ? 'booking.confirmed' : 'booking.queued',
        bookingId: newId,
        actorId: actor.id,
        data: { queuePosition: status === 'queued' ? c.queueLength + 1 : null },
      });
      return newId;
    });
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'bookings_requester_idempotency_key') {
      const existing = await replayOf();
      if (existing) return { booking: await getMemberBooking(actor.id, existing), replay: true };
    }
    if (err?.code === '23P01' && err?.constraint === 'bookings_no_overlap') {
      const c = await findConflicts(pool, body.venueId, { ...body, endDate: body.endDate || body.date }, actor.id);
      throw appError('BOOKING_CONFLICT', CONFLICT_MESSAGE, { field: 'startTime', conflicts: c.bookings });
    }
    throw err;
  }
  return { booking: await getMemberBooking(actor.id, id), replay: false };
}

// ─────────────────────────── B. Update (E14) ───────────────────────────
/**
 * Details (purpose, attendees, ID) change in place. A new time is checked like a new request, except that a confirmed
 * booking never gives up its slot for a taken one (the change is refused). A queued request moved to a free time is
 * confirmed; moved to another taken time it re-joins the back of that queue. Any freed time is offered to the queue.
 */
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
    if (cur.status !== 'confirmed' && cur.status !== 'queued') {
      throw appError('INVALID_STATUS_TRANSITION', `This booking is ${cur.status} and can no longer be modified.`);
    }
    const { settings, localNow } = await loadCampus(tx);
    if (minutesUntil(startLdt(cur.date, cur.st), localNow) <= settings.modificationCutoffMinutes) {
      throw appError('MODIFICATION_WINDOW_CLOSED', modificationClosedMessage(settings.modificationCutoffMinutes));
    }
    if (!venue.is_active) {
      throw appError('VENUE_INACTIVE', 'This venue is no longer accepting changes. You can still cancel this booking.');
    }

    // Moving the first day keeps the number of days unless a new end date is given.
    const curDays = diffDays(cur.end_date, cur.date);
    const nextDate = body.date ?? cur.date;
    const next = {
      date: nextDate,
      endDate: body.endDate ?? (body.date ? addDays(nextDate, curDays) : cur.end_date),
      startTime: body.startTime ?? cur.st,
      endTime: body.endTime ?? cur.et,
      purpose: body.purpose ?? cur.purpose,
      expectedAttendees: body.expectedAttendees !== undefined ? body.expectedAttendees : cur.expected_attendees,
      idNumber: body.idNumber ?? cur.id_number,
    };
    const slotChanged =
      next.date !== cur.date || next.endDate !== cur.end_date || next.startTime !== cur.st || next.endTime !== cur.et;
    const changed =
      slotChanged ||
      next.purpose !== cur.purpose ||
      (next.expectedAttendees ?? null) !== (cur.expected_attendees ?? null) ||
      (next.idNumber ?? null) !== (cur.id_number ?? null);
    if (!changed) return;

    let status: 'confirmed' | 'queued' = cur.status;
    let requeue = false;
    if (slotChanged) {
      assertSlot(next, settings, localNow);
      const c = await findConflicts(tx, venueId, next, actor.id, id);
      throwHardConflicts(c);
      if (cur.status === 'confirmed' && c.bookings.length) {
        throw appError(
          'BOOKING_CONFLICT',
          "That time is already booked, so your booking hasn't changed. To queue for it, cancel this booking and book the new time.",
          { field: 'startTime', conflicts: c.bookings },
        );
      }
      if (cur.status === 'queued') {
        status = c.bookings.length ? 'queued' : 'confirmed';
        requeue = status === 'queued';
      }
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
          set booking_date = $2, start_time = $3, end_time = $4, purpose = $5, expected_attendees = $6, id_number = $7,
              status = $8, queued_at = case when $9::boolean then clock_timestamp() else queued_at end, end_date = $10
        where id = $1`,
      [id, next.date, next.startTime, next.endTime, next.purpose, next.expectedAttendees, next.idNumber, status, requeue, next.endDate],
    );
    await publish(tx, { type: 'booking.modified', bookingId: id, actorId: actor.id, data: { previousStatus: cur.status } });
    if (slotChanged) await promoteAndNotify(tx, venueId, actor.id);
  });
  return getMemberBooking(actor.id, id);
}

// ─────────────────────────── C. Cancel (E15) ───────────────────────────
/** Members can cancel at any time until the booking ends; a freed slot goes to the queue straight away. */
export async function cancelBooking(actor: Actor, id: string, body: { reason?: string; version?: number }): Promise<Booking> {
  const first = await pool.query<{ venue_id: string }>('select venue_id from public.bookings where id = $1 and requester_id = $2', [
    id,
    actor.id,
  ]);
  if (!first.rows[0]) throw appError('BOOKING_NOT_FOUND');
  const venueId = first.rows[0].venue_id;

  await withTransaction({ actorId: actor.id, note: body.reason || null }, async (tx) => {
    await tx.query('select id from public.venues where id = $1 for update', [venueId]);
    const cur = (
      await tx.query(
        `select b.*, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st, to_char(b.end_time, 'HH24:MI') as et
           from public.bookings b where b.id = $1 and b.requester_id = $2 for update`,
        [id, actor.id],
      )
    ).rows[0];
    if (!cur) throw appError('BOOKING_NOT_FOUND');
    if (cur.status === 'cancelled') return; // idempotent
    if (cur.status !== 'confirmed' && cur.status !== 'queued') {
      throw appError('INVALID_STATUS_TRANSITION', `This booking is ${cur.status} and can no longer be modified.`);
    }
    if (body.version !== undefined && body.version !== cur.version) {
      throw appError('BOOKING_CHANGED', undefined, { currentVersion: cur.version });
    }
    const { localNow } = await loadCampus(tx);
    if (cur.status === 'queued' && minutesUntil(startLdt(cur.date, cur.st), localNow) <= 0) {
      throw appError('CANCELLATION_WINDOW_CLOSED', 'This queued request expired when the booking time started.');
    }
    if (cur.status === 'confirmed' && minutesUntil(startLdt(cur.end_date, cur.et), localNow) <= 0) {
      throw appError('CANCELLATION_WINDOW_CLOSED', 'This booking has already ended.');
    }
    await tx.query(
      `update public.bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3 where id = $1`,
      [id, actor.id, body.reason || null],
    );
    await cancelAndOfferSlot(tx, { id, venueId, previousStatus: cur.status, cancelledBy: 'requester', actorId: actor.id, note: body.reason || null });
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
  if (q.scope !== 'all') {
    // Registered only when used: an unused parameter makes Postgres reject the statement.
    const now = w.param(campus.localNow.replace('T', ' '));
    w.add(q.scope === 'upcoming' ? UPCOMING_SQL(`${now}::timestamp`) : `not ${UPCOMING_SQL(`${now}::timestamp`)}`);
  }
  if (q.status?.length) w.add('b.status = any($?::text[])', q.status);
  if (q.from) w.add('b.end_date >= $?::date', q.from);
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
  select b.*, b.booking_date as date, ${QUEUE_POSITION_SQL} as queue_position,
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
      `select count(*) filter (where b.status = 'queued' and (b.booking_date + b.start_time) > $2::timestamp) as queued,
              count(*) filter (where b.status = 'confirmed' and (b.end_date + b.end_time) > $2::timestamp) as upcoming_confirmed,
              count(*) filter (where not ${UPCOMING_SQL('$2::timestamp')}) as history
         from public.bookings b where b.requester_id = $1`,
      [requesterId, now],
    )
  ).rows[0];
  const next = await pool.query(
    `select * from (${BOOKING_SELECT_INNER}) b
      where b.requester_id = $1 and ${UPCOMING_SQL('$2::timestamp')}
      order by b.booking_date, b.start_time limit 1`,
    [requesterId, now],
  );
  const [recent, complaints] = await Promise.all([
    pool.query(`select * from (${BOOKING_SELECT_INNER}) b where b.requester_id = $1 order by b.created_at desc limit 5`, [requesterId]),
    memberComplaintSummary(requesterId),
  ]);
  const map = (r: any) => toBookingSummary(normalize(r), campus.settings, campus.localNow);
  return {
    counts: { queued: counts.queued, upcomingConfirmed: counts.upcoming_confirmed, history: counts.history },
    nextBooking: next.rows[0] ? map(next.rows[0]) : null,
    recentBookings: recent.rows.map(map),
    ...complaints,
  };
}

/** Rows from BOOKING_SELECT_INNER carry raw 'HH:mm:ss' times; the mapper expects 'HH:mm'. */
export function normalize(r: any): any {
  return { ...r, start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) };
}
