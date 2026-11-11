// Member venue reads (E07, E08) and availability (E09, E10).
import {
  addDays,
  collectSlotViolations,
  type AvailabilityCheck,
  type Venue,
  type VenueAvailability,
  type VenueSummary,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import { imageUrls } from '../../lib/image-store.js';
import { loadCampus } from '../../domain/settings.js';
import { slotRulesOf } from '../../domain/booking-rules.js';
import { blockInterval, bookingInterval, findConflicts, toLdt } from '../bookings/booking.queries.js';

const iso = (d: Date) => new Date(d).toISOString();

export function toVenueSummary(r: any): VenueSummary {
  return {
    id: r.id,
    name: r.name,
    venueType: r.venue_type,
    building: r.building,
    locationDetails: r.location_details,
    capacity: r.capacity,
    amenities: r.amenities ?? [],
    ...imageUrls(r.image_url),
    isActive: r.is_active,
  };
}

export function toVenue(r: any): Venue {
  return { ...toVenueSummary(r), description: r.description, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}

const SORTS: Record<string, string> = {
  'name:asc': 'lower(v.name) asc',
  'capacity:asc': 'v.capacity asc, lower(v.name)',
  'capacity:desc': 'v.capacity desc, lower(v.name)',
};

export async function listActiveVenues(q: {
  q?: string;
  type?: string;
  minCapacity?: number;
  amenities?: string[];
  availableDate?: string;
  availableStart?: string;
  availableEnd?: string;
  sort: string;
  page: number;
  pageSize: number;
}) {
  const w = new Where();
  w.add('v.is_active');
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(`(v.name ilike ${like} or v.building ilike ${like})`);
  }
  if (q.type) w.add('v.venue_type = $?', q.type);
  if (q.minCapacity) w.add('v.capacity >= $?', q.minCapacity);
  if (q.amenities?.length) {
    w.add('(select bool_and(exists (select 1 from unnest(v.amenities) a where lower(a) = lower(x))) from unnest($?::text[]) x)', q.amenities);
  }
  if (q.availableDate && q.availableStart && q.availableEnd) {
    const range = `tsrange(${w.param(q.availableDate)}::date + ${w.param(q.availableStart)}::time, ${w.param(q.availableDate)}::date + ${w.param(q.availableEnd)}::time, '[)')`;
    w.add(
      `not exists (select 1 from public.bookings b where b.venue_id = v.id and b.status in ('pending','approved') and b.slot && ${range})`,
    );
    w.add(`not exists (select 1 from public.venue_blocks vb where vb.venue_id = v.id and vb.period && ${range})`);
  }
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.venues v ${where}`, w.params)).rows[0]!.n;
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `select v.* from public.venues v ${where} order by ${SORTS[q.sort] ?? SORTS['name:asc']} limit ${limit} offset ${offset}`,
    w.params,
  );
  const opts = await pool.query<{ a: string }>(
    'select distinct unnest(amenities) as a from public.venues where is_active order by 1',
  );
  const seen = new Map<string, string>();
  for (const { a } of opts.rows) if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a);
  return {
    data: rows.map(toVenueSummary),
    meta: { ...listMeta(q.page, q.pageSize, total), amenityOptions: [...seen.values()].sort((x, y) => x.localeCompare(y)) },
  };
}

async function activeVenueRow(id: string) {
  const { rows } = await pool.query('select * from public.venues where id = $1 and is_active', [id]);
  if (!rows[0]) throw appError('VENUE_NOT_FOUND');
  return rows[0];
}

export async function getActiveVenue(id: string): Promise<Venue> {
  return toVenue(await activeVenueRow(id));
}

export async function venueAvailability(venueId: string, actorId: string, q: { from?: string; to?: string }): Promise<VenueAvailability> {
  await activeVenueRow(venueId);
  const campus = await loadCampus(pool);
  const from = q.from ?? campus.today;
  const to = q.to ?? addDays(from, 6);
  const { rows } = await pool.query(
    `with r as (select tsrange($2::date::timestamp, ($3::date + 1)::timestamp, '[)') as rng)
     select 'booking' as source, b.id, b.status, lower(b.slot)::text as s, upper(b.slot)::text as e,
            (b.requester_id = $4) as is_mine, null::text as block_type, null::text as reason
       from public.bookings b, r
      where b.venue_id = $1 and b.status in ('pending','approved') and b.slot && r.rng
     union all
     select 'block', vb.id, null, vb.starts_at::text, vb.ends_at::text, false, vb.block_type, vb.reason
       from public.venue_blocks vb, r
      where vb.venue_id = $1 and vb.period && r.rng
     order by 4`,
    [venueId, from, to, actorId],
  );
  return {
    venueId,
    from,
    to,
    timezone: campus.settings.campusTimezone,
    operatingHours: { start: campus.settings.operatingHoursStart, end: campus.settings.operatingHoursEnd },
    timeStepMinutes: campus.settings.timeStepMinutes,
    intervals: rows.map((r) =>
      r.source === 'block'
        ? blockInterval(r.block_type, r.reason, toLdt(r.s), toLdt(r.e))
        : bookingInterval(r.status, toLdt(r.s), toLdt(r.e), r.is_mine, r.id),
    ),
  };
}

export async function availabilityCheck(
  venueId: string,
  actorId: string,
  q: { date: string; startTime: string; endTime: string; excludeBookingId?: string },
): Promise<AvailabilityCheck> {
  await activeVenueRow(venueId);
  const campus = await loadCampus(pool);
  const violations: AvailabilityCheck['violations'] = collectSlotViolations(q, slotRulesOf(campus.settings), campus.localNow).map((v) => ({
    code: v.code,
    field: v.field,
    message: v.message,
  }));

  let exclude: string | null = null;
  if (q.excludeBookingId) {
    const own = await pool.query('select 1 from public.bookings where id = $1 and requester_id = $2', [q.excludeBookingId, actorId]);
    if (own.rowCount) exclude = q.excludeBookingId;
  } else {
    const pending = (
      await pool.query<{ n: number }>("select count(*) as n from public.bookings where requester_id = $1 and status = 'pending'", [actorId])
    ).rows[0]!.n;
    if (pending >= campus.settings.maxPendingPerUser) {
      violations.push({
        code: 'PENDING_LIMIT_REACHED',
        field: 'startTime',
        message: `You already have ${pending} pending requests, the maximum allowed.`,
      });
    }
  }

  const conflicts = [] as AvailabilityCheck['conflicts'];
  if (q.endTime > q.startTime) {
    const c = await findConflicts(pool, venueId, q.date, q.startTime, q.endTime, actorId, exclude);
    for (const b of c.blocks) conflicts.push(blockInterval(b.blockType, b.reason, b.start, b.end));
    conflicts.push(...c.bookings);
  }
  return { available: violations.length === 0 && conflicts.length === 0, violations, conflicts };
}
