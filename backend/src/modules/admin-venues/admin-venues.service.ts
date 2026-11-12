// Admin venues: E26–E32, deactivation (algorithm H) and photos E55/E56 (§10.19).
import type { AdminVenue, VenueCreateBody, VenueUpdateBody } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction, type Tx } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { imageStore } from '../../lib/image-store.js';
import { logger } from '../../lib/logger.js';
import { audit } from '../audit/audit-writer.js';
import { publish } from '../notifications/notifier.js';
import { toVenue } from '../venues/venues.service.js';
import { BOOKING_SELECT_INNER, normalize } from '../bookings/bookings.service.js';
import { toBookingSummary } from '../bookings/booking.mapper.js';

const STATS = `
  (select count(*) from public.bookings b where b.venue_id = v.id and b.status = 'approved' and (b.booking_date + b.end_time) > $NOW::timestamp) as upcoming_approved,
  (select count(*) from public.bookings b where b.venue_id = v.id and b.status = 'pending' and (b.booking_date + b.start_time) > $NOW::timestamp) as pending_count,
  (select count(*) from public.bookings b where b.venue_id = v.id) as total_bookings,
  (select count(*) from public.complaints x where x.venue_id = v.id
     and x.status in ('pending_review','in_progress','awaiting_confirmation')) as open_complaints,
  cb.full_name as created_by_name`;

function toAdminVenue(r: any, nextBooking: AdminVenue['stats']['nextBooking'] = null): AdminVenue {
  return {
    ...toVenue(r),
    createdBy: r.created_by ? { id: r.created_by, fullName: r.created_by_name } : null,
    stats: {
      upcomingApprovedCount: r.upcoming_approved,
      pendingCount: r.pending_count,
      totalBookings: r.total_bookings,
      nextBooking,
      openComplaints: r.open_complaints ?? 0,
    },
  };
}

const VENUE_SORTS: Record<string, string> = {
  'name:asc': 'lower(v.name) asc',
  'capacity:desc': 'v.capacity desc, lower(v.name)',
  'createdAt:desc': 'v.created_at desc',
};

export async function listAdminVenues(q: { q?: string; type?: string; isActive?: boolean; sort: string; page: number; pageSize: number }) {
  const campus = await loadCampus(pool);
  const w = new Where();
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(`(v.name ilike ${like} or v.building ilike ${like})`);
  }
  if (q.type) w.add('v.venue_type = $?', q.type);
  if (q.isActive !== undefined) w.add('v.is_active = $?', q.isActive);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.venues v ${where}`, w.params)).rows[0]!.n;
  const nowP = w.param(campus.localNow.replace('T', ' '));
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `select v.*, ${STATS.replaceAll('$NOW', nowP)} from public.venues v left join public.profiles cb on cb.id = v.created_by
      ${where} order by ${VENUE_SORTS[q.sort] ?? VENUE_SORTS['name:asc']} limit ${limit} offset ${offset}`,
    w.params,
  );
  return { data: rows.map((r) => toAdminVenue(r)), meta: listMeta(q.page, q.pageSize, total) };
}

export async function getAdminVenue(id: string): Promise<AdminVenue> {
  const campus = await loadCampus(pool);
  const now = campus.localNow.replace('T', ' ');
  const { rows } = await pool.query(
    `select v.*, ${STATS.replaceAll('$NOW', '$2')} from public.venues v left join public.profiles cb on cb.id = v.created_by where v.id = $1`,
    [id, now],
  );
  if (!rows[0]) throw appError('VENUE_NOT_FOUND');
  const next = await pool.query(
    `select * from (${BOOKING_SELECT_INNER}) b where b.venue_id = $1 and b.status in ('pending','approved')
       and (b.booking_date + b.end_time) > $2::timestamp order by b.booking_date, b.start_time limit 1`,
    [id, now],
  );
  return toAdminVenue(rows[0], next.rows[0] ? toBookingSummary(normalize(next.rows[0]), campus.settings, campus.localNow) : null);
}

export async function createVenue(actor: Actor, body: VenueCreateBody): Promise<AdminVenue> {
  const id = await withTransaction({ actorId: actor.id }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.venues (name, venue_type, building, location_details, capacity, description, amenities, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [body.name, body.venueType, body.building, body.locationDetails, body.capacity, body.description, body.amenities, actor.id],
    );
    await audit(tx, actor, { action: 'venue.created', entityType: 'venue', entityId: rows[0]!.id, summary: `Created venue ${body.name}` });
    return rows[0]!.id;
  });
  return getAdminVenue(id);
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  venueType: 'venue_type',
  building: 'building',
  locationDetails: 'location_details',
  capacity: 'capacity',
  description: 'description',
  amenities: 'amenities',
};

export async function updateVenue(actor: Actor, id: string, body: VenueUpdateBody): Promise<AdminVenue> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const cur = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
    if (!cur) throw appError('VENUE_NOT_FOUND');
    const sets: string[] = [];
    const params: unknown[] = [id];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, col] of Object.entries(COLUMNS)) {
      const value = (body as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (JSON.stringify(cur[col]) === JSON.stringify(value)) continue;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
      before[key] = cur[col];
      after[key] = value;
    }
    if (!sets.length) return;
    await tx.query(`update public.venues set ${sets.join(', ')} where id = $1`, params);
    await audit(tx, actor, {
      action: 'venue.updated',
      entityType: 'venue',
      entityId: id,
      summary: `Updated venue ${after.name ?? cur.name}`,
      metadata: { before, after },
    });
  });
  return getAdminVenue(id);
}

/** Rejects pending and cancels approved bookings (shared by algorithms G and H). */
export async function closeBookings(
  tx: Tx,
  actor: Actor,
  rows: { id: string; status: string }[],
  note: string,
): Promise<{ rejected: number; cancelled: number }> {
  await tx.setNote(note);
  const pending = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  const approved = rows.filter((r) => r.status === 'approved').map((r) => r.id);
  if (pending.length) {
    await tx.query(
      `update public.bookings set status = 'rejected', rejection_reason = $2, decided_by = $3, decided_at = now() where id = any($1::uuid[])`,
      [pending, note.slice(0, 500), actor.id],
    );
  }
  if (approved.length) {
    await tx.query(
      `update public.bookings set status = 'cancelled', cancellation_reason = $2, cancelled_by = $3, cancelled_at = now() where id = any($1::uuid[])`,
      [approved, note.slice(0, 500), actor.id],
    );
  }
  for (const bid of pending) await publish(tx, { type: 'booking.rejected', bookingId: bid, actorId: actor.id, data: { note } });
  for (const bid of approved)
    await publish(tx, { type: 'booking.cancelled', bookingId: bid, actorId: actor.id, data: { cancelledBy: 'system', note } });
  return { rejected: pending.length, cancelled: approved.length };
}

// ─────────────────────────── H. Deactivate (E30) ───────────────────────────
export async function deactivateVenue(actor: Actor, id: string, body: { cancelUpcomingBookings: boolean; reason?: string }) {
  let affected = { rejected: 0, cancelled: 0, keptUpcoming: 0 };
  let alreadyInactive = false;
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const venue = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
    if (!venue) throw appError('VENUE_NOT_FOUND');
    if (!venue.is_active) {
      alreadyInactive = true;
      return;
    }
    const { localNow } = await loadCampus(tx);
    const upcoming = (
      await tx.query<{ id: string; status: string }>(
        `select id, status from public.bookings where venue_id = $1 and status in ('pending','approved')
           and upper(slot) > $2::timestamp for update`,
        [id, localNow.replace('T', ' ')],
      )
    ).rows;
    if (body.cancelUpcomingBookings) {
      const r = await closeBookings(tx, actor, upcoming, `Venue deactivated: ${body.reason}`);
      affected = { ...r, keptUpcoming: 0 };
    } else {
      affected.keptUpcoming = upcoming.length;
    }
    await tx.query('update public.venues set is_active = false where id = $1', [id]);
    await audit(tx, actor, {
      action: 'venue.deactivated',
      entityType: 'venue',
      entityId: id,
      summary: `Deactivated venue ${venue.name}`,
      metadata: { ...affected, reason: body.reason ?? null },
    });
  });
  return { venue: await getAdminVenue(id), affected, ...(alreadyInactive ? { alreadyInactive: true } : {}) };
}

export async function activateVenue(actor: Actor, id: string) {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const venue = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
    if (!venue) throw appError('VENUE_NOT_FOUND');
    if (venue.is_active) return;
    await tx.query('update public.venues set is_active = true where id = $1', [id]);
    await audit(tx, actor, { action: 'venue.activated', entityType: 'venue', entityId: id, summary: `Activated venue ${venue.name}` });
  });
  return { venue: await getAdminVenue(id) };
}

export async function deleteVenue(actor: Actor, id: string) {
  let publicId: string | null = null;
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const venue = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
    if (!venue) throw appError('VENUE_NOT_FOUND');
    const has = await tx.query('select 1 from public.bookings where venue_id = $1 limit 1', [id]);
    if (has.rowCount) throw appError('VENUE_HAS_BOOKINGS');
    await tx.query('delete from public.venues where id = $1', [id]);
    publicId = venue.image_public_id;
    await audit(tx, actor, {
      action: 'venue.deleted',
      entityType: 'venue',
      entityId: id,
      summary: `Deleted venue ${venue.name}`,
      metadata: { snapshot: { name: venue.name, building: venue.building, capacity: venue.capacity, venueType: venue.venue_type } },
    });
    tx.afterCommit(async () => {
      if (publicId) await imageStore.destroy(publicId).catch((err) => logger.warn({ err }, 'image destroy failed'));
    });
  });
}

// ─────────────────────────── Photos (E55, E56) ───────────────────────────
export async function uploadVenueImage(actor: Actor, id: string, buffer: Buffer): Promise<AdminVenue> {
  const exists = await pool.query('select 1 from public.venues where id = $1', [id]);
  if (!exists.rowCount) throw appError('VENUE_NOT_FOUND');
  const stored = await imageStore.upload(id, buffer); // outside any transaction (30 s timeout)
  try {
    await withTransaction({ actorId: actor.id }, async (tx) => {
      const venue = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
      if (!venue) throw appError('VENUE_NOT_FOUND');
      await tx.query('update public.venues set image_url = $2, image_public_id = $3 where id = $1', [id, stored.secureUrl, stored.publicId]);
      await audit(tx, actor, { action: 'venue.image_updated', entityType: 'venue', entityId: id, summary: `Updated photo of ${venue.name}` });
      // Stores that version keys per upload (Neon) leave the previous photo behind; remove it once the swap commits.
      const previous = venue.image_public_id as string | null;
      if (previous && previous !== stored.publicId) {
        tx.afterCommit(() => imageStore.destroy(previous).catch((err) => logger.warn({ err }, 'previous image destroy failed')));
      }
    });
  } catch (err) {
    await imageStore.destroy(stored.publicId).catch(() => undefined);
    throw err;
  }
  return getAdminVenue(id);
}

export async function removeVenueImage(actor: Actor, id: string): Promise<AdminVenue> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const venue = (await tx.query('select * from public.venues where id = $1 for update', [id])).rows[0];
    if (!venue) throw appError('VENUE_NOT_FOUND');
    if (!venue.image_public_id) return;
    await tx.query('update public.venues set image_url = null, image_public_id = null where id = $1', [id]);
    await audit(tx, actor, { action: 'venue.image_removed', entityType: 'venue', entityId: id, summary: `Removed photo of ${venue.name}` });
    const publicId = venue.image_public_id as string;
    tx.afterCommit(() => imageStore.destroy(publicId).catch((err) => logger.warn({ err }, 'image destroy failed')));
  });
  return getAdminVenue(id);
}
