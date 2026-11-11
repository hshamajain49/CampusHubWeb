// Venue blocks (E33–E36) with algorithm G (§10.15): conflicts require an explicit decision.
import {
  BLOCK_TYPE_LABELS,
  localDateTimeToMinutes,
  type BlockConflict,
  type BlockCreateBody,
  type BlockUpdateBody,
  type VenueBlock,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction, type Tx } from '../../db/transaction.js';
import { listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError, validationError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { audit } from '../audit/audit-writer.js';
import { closeBookings } from '../admin-venues/admin-venues.service.js';
import { toLdt } from '../bookings/booking.queries.js';

const BLOCK_SELECT = `
  select vb.*, vb.starts_at::text as s, vb.ends_at::text as e, v.name as venue_name, p.full_name as created_by_name
    from public.venue_blocks vb
    join public.venues v on v.id = vb.venue_id
    join public.profiles p on p.id = vb.created_by`;

export function toVenueBlock(r: any): VenueBlock {
  return {
    id: r.id,
    venue: { id: r.venue_id, name: r.venue_name },
    blockType: r.block_type,
    reason: r.reason,
    start: toLdt(r.s),
    end: toLdt(r.e),
    createdBy: { id: r.created_by, fullName: r.created_by_name },
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listBlocks(q: {
  venueId?: string;
  from?: string;
  to?: string;
  includePast: boolean;
  sort: string;
  page: number;
  pageSize: number;
}) {
  const campus = await loadCampus(pool);
  const w = new Where();
  if (q.venueId) w.add('vb.venue_id = $?', q.venueId);
  if (!q.includePast) w.add('vb.ends_at > $?::timestamp', campus.localNow.replace('T', ' '));
  if (q.from) w.add('vb.ends_at > $?::date', q.from);
  if (q.to) w.add('vb.starts_at < ($?::date + 1)', q.to);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.venue_blocks vb ${where}`, w.params)).rows[0]!.n;
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `${BLOCK_SELECT} ${where} order by vb.starts_at ${q.sort === 'start:desc' ? 'desc' : 'asc'} limit ${limit} offset ${offset}`,
    w.params,
  );
  return { data: rows.map(toVenueBlock), meta: listMeta(q.page, q.pageSize, total) };
}

async function getBlock(db: Tx | typeof pool, id: string): Promise<VenueBlock> {
  const { rows } = await db.query(`${BLOCK_SELECT} where vb.id = $1`, [id]);
  if (!rows[0]) throw appError('BLOCK_NOT_FOUND');
  return toVenueBlock(rows[0]);
}

interface BlockInput {
  venueId: string;
  blockType: string;
  reason: string;
  start: string;
  end: string;
  conflictResolution: 'abort' | 'cancel_conflicting';
}

async function saveBlock(actor: Actor, input: BlockInput, existingId: string | null) {
  let blockId = existingId;
  let affected = { rejected: 0, cancelled: 0, references: [] as string[] };
  try {
    await withTransaction({ actorId: actor.id }, async (tx) => {
      const venue = (await tx.query('select * from public.venues where id = $1 for update', [input.venueId])).rows[0];
      if (!venue) throw appError('VENUE_NOT_FOUND');
      if (localDateTimeToMinutes(input.end) <= localDateTimeToMinutes(input.start)) {
        throw validationError({ end: ['The end must be after the start'] });
      }
      if (localDateTimeToMinutes(input.end) - localDateTimeToMinutes(input.start) > 366 * 1440) {
        throw validationError({ end: ['A block can span at most 366 days'] });
      }
      const { localNow } = await loadCampus(tx);
      if (localDateTimeToMinutes(input.end) <= localDateTimeToMinutes(localNow)) {
        throw appError('BLOCK_IN_PAST', undefined, { field: 'end' });
      }
      if (existingId) {
        const cur = await tx.query('select id from public.venue_blocks where id = $1 for update', [existingId]);
        if (!cur.rowCount) throw appError('BLOCK_NOT_FOUND');
      }

      const overlapping = (
        await tx.query(
          `select b.id, b.reference, b.status, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as st,
                  to_char(b.end_time, 'HH24:MI') as et, p.id as requester_id, p.full_name
             from public.bookings b join public.profiles p on p.id = b.requester_id
            where b.venue_id = $1 and b.status in ('pending','approved')
              and b.slot && tsrange($2::timestamp, $3::timestamp, '[)')
            order by b.booking_date, b.start_time
            for update of b`,
          [input.venueId, input.start, input.end],
        )
      ).rows;

      if (overlapping.length && input.conflictResolution === 'abort') {
        const conflicts: BlockConflict[] = overlapping.map((r) => ({
          bookingId: r.id,
          reference: r.reference,
          status: r.status,
          date: r.date,
          startTime: r.st,
          endTime: r.et,
          requester: { id: r.requester_id, fullName: r.full_name },
        }));
        throw appError('BLOCK_CONFLICT', `${overlapping.length} booking${overlapping.length === 1 ? '' : 's'} overlap this block.`, {
          conflicts,
        });
      }
      if (overlapping.length) {
        const label = BLOCK_TYPE_LABELS[input.blockType as keyof typeof BLOCK_TYPE_LABELS];
        const r = await closeBookings(tx, actor, overlapping, `Venue unavailable: ${label} — ${input.reason}`);
        affected = { ...r, references: overlapping.map((o) => o.reference) };
      }

      if (existingId) {
        await tx.query(
          'update public.venue_blocks set block_type = $2, reason = $3, starts_at = $4, ends_at = $5 where id = $1',
          [existingId, input.blockType, input.reason, input.start, input.end],
        );
      } else {
        const ins = await tx.query<{ id: string }>(
          `insert into public.venue_blocks (venue_id, block_type, reason, starts_at, ends_at, created_by)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [input.venueId, input.blockType, input.reason, input.start, input.end, actor.id],
        );
        blockId = ins.rows[0]!.id;
      }
      await audit(tx, actor, {
        action: existingId ? 'venue_block.updated' : 'venue_block.created',
        entityType: 'venue_block',
        entityId: blockId,
        summary: `${existingId ? 'Updated' : 'Created'} ${BLOCK_TYPE_LABELS[input.blockType as keyof typeof BLOCK_TYPE_LABELS].toLowerCase()} block on ${venue.name}`,
        metadata: { start: input.start, end: input.end, reason: input.reason, affectedBookings: affected.references },
      });
    });
  } catch (err: any) {
    if (err?.code === '23P01') throw appError('BLOCK_OVERLAP', 'This overlaps an existing block. Edit that block instead.', { field: 'start' });
    if (err?.code === 'CB002') throw appError('BLOCK_CONFLICT', 'Bookings overlap this block.', { conflicts: [] });
    throw err;
  }
  return { block: await getBlock(pool, blockId!), affectedBookings: affected };
}

export function createBlock(actor: Actor, body: BlockCreateBody) {
  return saveBlock(actor, body, null);
}

export async function updateBlock(actor: Actor, id: string, body: BlockUpdateBody) {
  const cur = (await pool.query('select *, starts_at::text as s, ends_at::text as e from public.venue_blocks where id = $1', [id])).rows[0];
  if (!cur) throw appError('BLOCK_NOT_FOUND');
  return saveBlock(
    actor,
    {
      venueId: cur.venue_id,
      blockType: body.blockType ?? cur.block_type,
      reason: body.reason ?? cur.reason,
      start: body.start ?? toLdt(cur.s),
      end: body.end ?? toLdt(cur.e),
      conflictResolution: body.conflictResolution,
    },
    id,
  );
}

export async function deleteBlock(actor: Actor, id: string) {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const { rows } = await tx.query(`${BLOCK_SELECT} where vb.id = $1 for update of vb`, [id]);
    if (!rows[0]) throw appError('BLOCK_NOT_FOUND');
    const b = toVenueBlock(rows[0]);
    await tx.query('delete from public.venue_blocks where id = $1', [id]);
    await audit(tx, actor, {
      action: 'venue_block.deleted',
      entityType: 'venue_block',
      entityId: id,
      summary: `Deleted block on ${b.venue.name}`,
      metadata: { snapshot: b },
    });
  });
}
