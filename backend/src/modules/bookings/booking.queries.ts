// Shared booking SQL: the joined select, history, conflict detection and queue position (docs/BOOKINGS.md).
import { BLOCK_TYPE_LABELS, type AvailabilityInterval, type BlockType } from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';

/**
 * 1-based place of a queued booking among the queued requests that overlap it (FIFO by queued_at, then id).
 * Null for every other status. Expects the booking row aliased `b`.
 */
export const QUEUE_POSITION_SQL = `case when b.status = 'queued' then 1 + (
    select count(*) from public.bookings q
     where q.venue_id = b.venue_id and q.status = 'queued' and q.slot && b.slot
       and (q.queued_at, q.id) < (b.queued_at, b.id)) end`;

/** Upcoming = confirmed and not ended, or queued and not started (SQL over a row aliased b; `now` is a timestamp expression). */
export const UPCOMING_SQL = (now: string) =>
  `((b.status = 'confirmed' and (b.booking_date + b.end_time) > ${now}) or (b.status = 'queued' and (b.booking_date + b.start_time) > ${now}))`;

export const BOOKING_SELECT = `
  select b.id, b.reference, b.venue_id, b.requester_id, b.booking_date as date,
         to_char(b.start_time, 'HH24:MI') as start_time, to_char(b.end_time, 'HH24:MI') as end_time,
         b.purpose, b.expected_attendees, b.id_number, b.status, b.cancellation_reason,
         b.confirmed_at, b.queued_at, b.cancelled_by, b.cancelled_at, b.version, b.created_at, b.updated_at,
         ${QUEUE_POSITION_SQL} as queue_position,
         v.name as venue_name, v.building as venue_building, v.venue_type, v.location_details as venue_location,
         v.capacity as venue_capacity, v.is_active as venue_active,
         p.full_name as requester_name, p.email as requester_email, p.role as requester_role,
         p.department as requester_department, p.is_active as requester_active,
         cp.full_name as cancelled_by_name, cp.role as cancelled_by_role
    from public.bookings b
    join public.venues v on v.id = b.venue_id
    join public.profiles p on p.id = b.requester_id
    left join public.profiles cp on cp.id = b.cancelled_by`;

export async function loadBookingRow(db: DbClient, id: string, requesterId?: string): Promise<any | null> {
  const params: unknown[] = [id];
  let sql = `${BOOKING_SELECT} where b.id = $1`;
  if (requesterId) {
    params.push(requesterId);
    sql += ' and b.requester_id = $2';
  }
  const { rows } = await db.query(sql, params);
  return rows[0] ?? null;
}

export async function loadHistory(db: DbClient, bookingId: string): Promise<any[]> {
  const { rows } = await db.query(
    `select h.id, h.event_type, h.from_status, h.to_status, h.note, h.changes, h.created_at,
            a.id as actor_id, a.full_name as actor_name, a.role as actor_role
       from public.booking_history h
       left join public.profiles a on a.id = h.actor_id
      where h.booking_id = $1
      order by h.created_at, h.id`,
    [bookingId],
  );
  return rows;
}

const ldt = (v: string) => v.replace(' ', 'T').slice(0, 19);

export interface ConflictResult {
  blocks: { id: string; blockType: BlockType; reason: string; start: string; end: string }[];
  /** Confirmed bookings overlapping the time: the slot is taken while any exist. */
  bookings: AvailabilityInterval[];
  /** The actor's own confirmed or queued bookings of this venue overlapping the time. */
  own: { id: string; status: 'confirmed' | 'queued'; reference: string }[];
  /** Queued requests overlapping the time: a new request would join behind them. */
  queueLength: number;
}

/** Confirmed bookings, the actor's own active bookings, queued requests and blocks overlapping [date+start, date+end). */
export async function findConflicts(
  db: DbClient,
  venueId: string,
  date: string,
  start: string,
  end: string,
  actorId: string,
  excludeBookingId: string | null = null,
): Promise<ConflictResult> {
  const { rows } = await db.query(
    `with r as (select tsrange($2::date + $3::time, $2::date + $4::time, '[)') as rng)
     select 'booking' as source, b.id, b.status, b.reference, lower(b.slot)::text as start_at, upper(b.slot)::text as end_at,
            (b.requester_id = $5) as is_mine, null::text as block_type, null::text as reason
       from public.bookings b, r
      where b.venue_id = $1 and b.status in ('confirmed', 'queued') and b.slot && r.rng
        and ($6::uuid is null or b.id <> $6::uuid)
     union all
     select 'block', vb.id, null, null, vb.starts_at::text, vb.ends_at::text, false, vb.block_type, vb.reason
       from public.venue_blocks vb, r
      where vb.venue_id = $1 and vb.period && r.rng
      order by 5`,
    [venueId, date, start, end, actorId, excludeBookingId],
  );
  const out: ConflictResult = { blocks: [], bookings: [], own: [], queueLength: 0 };
  for (const r of rows) {
    if (r.source === 'block') {
      out.blocks.push({ id: r.id, blockType: r.block_type, reason: r.reason, start: ldt(r.start_at), end: ldt(r.end_at) });
      continue;
    }
    if (r.is_mine) out.own.push({ id: r.id, status: r.status, reference: r.reference });
    if (r.status === 'queued') out.queueLength++;
    else out.bookings.push(bookingInterval('confirmed', ldt(r.start_at), ldt(r.end_at), r.is_mine, r.id));
  }
  return out;
}

export function bookingInterval(
  status: 'confirmed' | 'queued',
  start: string,
  end: string,
  isMine: boolean,
  id: string,
  extra: { queueLength?: number; queuePosition?: number | null } = {},
): AvailabilityInterval {
  const queued = status === 'queued';
  const label = !isMine
    ? 'Booked'
    : queued
      ? `Your request · In queue${extra.queuePosition ? ` (#${extra.queuePosition})` : ''}`
      : 'Your booking · Confirmed';
  return {
    kind: queued ? 'queued' : 'booked',
    start,
    end,
    isMine,
    bookingId: isMine ? id : null,
    status: isMine ? status : null,
    blockType: null,
    label,
    queueLength: queued ? 0 : (extra.queueLength ?? 0),
  };
}

export function blockInterval(blockType: BlockType, reason: string, start: string, end: string): AvailabilityInterval {
  return {
    kind: 'blocked',
    start,
    end,
    isMine: false,
    bookingId: null,
    status: null,
    blockType,
    label: `${BLOCK_TYPE_LABELS[blockType]}: ${reason}`,
    queueLength: 0,
  };
}

/**
 * Promotes queued requests of a venue, oldest first, whose time is now free (database function, FIFO). Call after any
 * change that can free a confirmed slot, inside the same transaction; publish 'booking.promoted' for each returned id.
 */
export async function promoteQueue(db: DbClient, venueId: string): Promise<string[]> {
  const { rows } = await db.query<{ booking_id: string }>('select booking_id from public.promote_queued_bookings($1)', [venueId]);
  return rows.map((r) => r.booking_id);
}

export { ldt as toLdt };
