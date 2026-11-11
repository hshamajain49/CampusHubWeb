// Shared booking SQL: the joined select, history, conflict detection (§10.15 A.8).
import { BLOCK_TYPE_LABELS, type AvailabilityInterval, type BlockType } from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';

export const BOOKING_SELECT = `
  select b.id, b.reference, b.venue_id, b.requester_id, b.booking_date as date,
         to_char(b.start_time, 'HH24:MI') as start_time, to_char(b.end_time, 'HH24:MI') as end_time,
         b.purpose, b.expected_attendees, b.status, b.rejection_reason, b.cancellation_reason,
         b.decided_by, b.decided_at, b.cancelled_by, b.cancelled_at, b.version, b.created_at, b.updated_at,
         v.name as venue_name, v.building as venue_building, v.venue_type, v.location_details as venue_location,
         v.capacity as venue_capacity, v.is_active as venue_active,
         p.full_name as requester_name, p.email as requester_email, p.role as requester_role,
         p.department as requester_department, p.is_active as requester_active,
         dp.full_name as decided_by_name, cp.full_name as cancelled_by_name, cp.role as cancelled_by_role
    from public.bookings b
    join public.venues v on v.id = b.venue_id
    join public.profiles p on p.id = b.requester_id
    left join public.profiles dp on dp.id = b.decided_by
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
  bookings: AvailabilityInterval[];
}

/** Active bookings and blocks overlapping [date+start, date+end) of a venue. */
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
     select 'booking' as source, b.id, b.status, lower(b.slot)::text as start_at, upper(b.slot)::text as end_at,
            (b.requester_id = $5) as is_mine, null::text as block_type, null::text as reason
       from public.bookings b, r
      where b.venue_id = $1 and b.status in ('pending', 'approved') and b.slot && r.rng
        and ($6::uuid is null or b.id <> $6::uuid)
     union all
     select 'block', vb.id, null, vb.starts_at::text, vb.ends_at::text, false, vb.block_type, vb.reason
       from public.venue_blocks vb, r
      where vb.venue_id = $1 and vb.period && r.rng
      order by 4`,
    [venueId, date, start, end, actorId, excludeBookingId],
  );
  const out: ConflictResult = { blocks: [], bookings: [] };
  for (const r of rows) {
    if (r.source === 'block') {
      out.blocks.push({ id: r.id, blockType: r.block_type, reason: r.reason, start: ldt(r.start_at), end: ldt(r.end_at) });
    } else {
      out.bookings.push(bookingInterval(r.status, ldt(r.start_at), ldt(r.end_at), r.is_mine, r.id));
    }
  }
  return out;
}

export function bookingInterval(status: 'pending' | 'approved', start: string, end: string, isMine: boolean, id: string): AvailabilityInterval {
  const kind = status === 'approved' ? 'booked' : 'on_hold';
  const label = isMine
    ? `Your booking · ${status === 'approved' ? 'Approved' : 'Pending Approval'}`
    : kind === 'booked'
      ? 'Booked'
      : 'On hold (awaiting approval)';
  return { kind, start, end, isMine, bookingId: isMine ? id : null, status: isMine ? status : null, blockType: null, label };
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
  };
}

export { ldt as toLdt };
