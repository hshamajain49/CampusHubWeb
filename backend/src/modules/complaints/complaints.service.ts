// Reporter side of the complaint module (COMPLAINT_REGISTRATION_SPEC.md §5 CW-01…CW-04, §10.4 CA-1, CA-2, CA-2b):
// any signed-in user files and tracks their own complaints.
import { randomUUID } from 'node:crypto';
import {
  OPEN_COMPLAINT_STATUSES,
  type Complaint,
  type ComplaintCategory,
  type ComplaintCounts,
  type ComplaintCreateData,
  type ComplaintSummary,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction, type Tx } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { AppError, appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { reporterReopenUntil } from '../../domain/complaint-rules.js';
import { COMPLAINT_SELECT, loadComplaintRow, wasAutoResolved } from './complaint.queries.js';
import { toComplaint, toComplaintSummary } from './complaint.mapper.js';
import { discardPhotos, insertAttachments, NO_PHOTOS, preparePhotos, type PreparedPhotos } from './complaint-photos.js';
import { assertStatus, assertVersion, lockComplaint } from './complaint-guards.js';

// ─────────────────────────── C01 categories ───────────────────────────
export function toCategory(r: any): ComplaintCategory {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    department: { id: r.department_id, name: r.department_name, isActive: r.department_active },
    sortOrder: r.sort_order,
    isActive: r.is_active,
  };
}

export async function listActiveCategories(): Promise<ComplaintCategory[]> {
  const { rows } = await pool.query(
    `select c.*, d.name as department_name, d.is_active as department_active
       from public.complaint_categories c join public.service_departments d on d.id = c.department_id
      where c.is_active and d.is_active
      order by c.sort_order, c.name`,
  );
  return rows.map(toCategory);
}

// ─────────────────────────── C04 detail ───────────────────────────
export async function getMyComplaint(reporterId: string, id: string): Promise<Complaint> {
  const row = await loadComplaintRow(pool, id);
  if (!row || row.reporter_id !== reporterId) throw appError('COMPLAINT_NOT_FOUND');
  const { settings } = await loadCampus(pool);
  return toComplaint(pool, row, settings, { kind: 'reporter' });
}

// ─────────────────────────── CA-1 create (C02) ───────────────────────────
export async function createComplaint(
  actor: Actor,
  data: ComplaintCreateData,
  files: { buffer: Buffer; name: string }[],
  idempotencyKey: string | null,
): Promise<{ complaint: Complaint; replay: boolean }> {
  const replayOf = async () => {
    const { rows } = await pool.query<{ id: string }>('select id from public.complaints where reporter_id = $1 and idempotency_key = $2', [
      actor.id,
      idempotencyKey,
    ]);
    return rows[0]?.id ?? null;
  };
  if (idempotencyKey) {
    const existing = await replayOf();
    if (existing) return { complaint: await getMyComplaint(actor.id, existing), replay: true };
  }

  const id = randomUUID();
  const prepared: PreparedPhotos = files.length ? await preparePhotos(id, files) : NO_PHOTOS;
  try {
    await withTransaction({ actorId: actor.id }, async (tx) => {
      await tx.query('select id from public.profiles where id = $1 for update', [actor.id]);
      const { settings } = await loadCampus(tx);
      const open = (
        await tx.query<{ n: number }>('select count(*) as n from public.complaints where reporter_id = $1 and status = any($2::text[])', [
          actor.id,
          [...OPEN_COMPLAINT_STATUSES],
        ])
      ).rows[0]!.n;
      if (open >= settings.complaintMaxOpenPerUser) {
        throw appError(
          'OPEN_COMPLAINT_LIMIT_REACHED',
          `You already have ${open} open complaints, the maximum allowed. Wait until some are resolved or withdraw one.`,
          { limit: settings.complaintMaxOpenPerUser, current: open },
        );
      }
      const cat = (
        await tx.query(
          `select c.id, c.department_id from public.complaint_categories c
             join public.service_departments d on d.id = c.department_id
            where c.id = $1 and c.is_active and d.is_active`,
          [data.categoryId],
        )
      ).rows[0];
      if (!cat) throw appError('CATEGORY_INACTIVE', undefined, { field: 'categoryId' });
      if (data.venueId) {
        const venue = (await tx.query('select is_active from public.venues where id = $1', [data.venueId])).rows[0];
        if (!venue?.is_active) {
          throw new AppError(422, 'VENUE_NOT_FOUND', "This venue doesn't exist or is no longer active.", { field: 'venueId' });
        }
      }
      await tx.query(
        `insert into public.complaints (id, reporter_id, category_id, department_id, venue_id, location_details, title, description, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, actor.id, cat.id, cat.department_id, data.venueId, data.locationDetails, data.title, data.description, idempotencyKey],
      );
      await insertAttachments(tx, id, 'report', prepared, actor.id);
    });
  } catch (err: any) {
    await discardPhotos(prepared);
    if (err?.code === '23505' && err?.constraint === 'complaints_reporter_idempotency_key') {
      const existing = await replayOf();
      if (existing) return { complaint: await getMyComplaint(actor.id, existing), replay: true };
    }
    throw err;
  }
  return { complaint: await getMyComplaint(actor.id, id), replay: false };
}

// ─────────────────────────── C03 my complaints ───────────────────────────
const OPEN = [...OPEN_COMPLAINT_STATUSES] as string[];
const CLOSED = ['resolved', 'withdrawn', 'closed'];

export async function listMyComplaints(
  reporterId: string,
  q: { tab: 'open' | 'closed' | 'all'; status?: string[]; categoryId?: string; q?: string; sort: string; page: number; pageSize: number },
): Promise<{ data: ComplaintSummary[]; meta: ReturnType<typeof listMeta> & { counts: ComplaintCounts } }> {
  const w = new Where();
  w.add('c.reporter_id = $?', reporterId);
  if (q.tab === 'open') w.add('c.status = any($?::text[])', OPEN);
  if (q.tab === 'closed') w.add('c.status = any($?::text[])', CLOSED);
  if (q.status?.length) w.add('c.status = any($?::text[])', q.status);
  if (q.categoryId) w.add('c.category_id = $?', q.categoryId);
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(`(c.reference ilike ${like} or c.title ilike ${like} or coalesce(c.location_details, '') ilike ${like} or coalesce(c.venue_name, '') ilike ${like})`);
  }
  const where = w.sql();
  const base = `select * from (${COMPLAINT_SELECT}) c ${where}`;
  const total = (await pool.query<{ n: number }>(`select count(*) as n from (${base}) x`, w.params)).rows[0]!.n;
  const dir = q.sort === 'createdAt:asc' ? 'asc' : 'desc';
  // Awaiting the reporter's approval is pinned first in the Open tab (CW-02).
  const order = q.tab === 'open' ? `(c.status = 'awaiting_confirmation') desc, c.created_at ${dir}` : `c.created_at ${dir}`;
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(`${base} order by ${order}, c.id limit ${limit} offset ${offset}`, w.params);
  return { data: rows.map((r) => toComplaintSummary(r)), meta: { ...listMeta(q.page, q.pageSize, total), counts: await myCounts(reporterId) } };
}

export async function myCounts(reporterId: string): Promise<ComplaintCounts> {
  const { rows } = await pool.query(
    `select count(*) filter (where status = any($2::text[])) as open,
            count(*) filter (where status in ('resolved','withdrawn','closed')) as closed,
            count(*) filter (where status = 'awaiting_confirmation') as awaiting
       from public.complaints where reporter_id = $1`,
    [reporterId, OPEN],
  );
  return { open: rows[0].open, closed: rows[0].closed, awaitingYourReview: rows[0].awaiting };
}

/** Member dashboard additions (§11.4 E06). */
export async function memberComplaintSummary(reporterId: string) {
  const [counts, recent] = await Promise.all([
    myCounts(reporterId),
    pool.query(
      `select * from (${COMPLAINT_SELECT}) c where c.reporter_id = $1
        order by (c.status = 'awaiting_confirmation') desc, c.created_at desc limit 5`,
      [reporterId],
    ),
  ]);
  return { complaints: { open: counts.open, awaitingYourReview: counts.awaitingYourReview }, recentComplaints: recent.rows.map((r) => toComplaintSummary(r)) };
}

// ─────────────────────────── CA-2 / CA-2b reporter actions ───────────────────────────
async function reporterAction(actor: Actor, id: string, note: string | null, fn: (tx: Tx, cur: any) => Promise<void>): Promise<Complaint> {
  await withTransaction({ actorId: actor.id, note }, async (tx) => {
    const cur = await lockComplaint(tx, id, { reporterId: actor.id });
    await fn(tx, cur);
  });
  return getMyComplaint(actor.id, id);
}

export function approveComplaint(actor: Actor, id: string, body: { version: number }) {
  return reporterAction(actor, id, null, async (tx, cur) => {
    assertStatus(
      cur,
      ['awaiting_confirmation'],
      cur.status === 'resolved' ? 'This complaint was already resolved.' : 'This complaint is not waiting for your approval.',
    );
    assertVersion(cur, body.version);
    await tx.query(`update public.complaints set status = 'resolved' where id = $1`, [id]);
  });
}

export function rejectComplaint(actor: Actor, id: string, body: { version: number; reason: string }) {
  return reporterAction(actor, id, body.reason, async (tx, cur) => {
    assertStatus(
      cur,
      ['awaiting_confirmation'],
      cur.status === 'resolved' ? 'This complaint was already resolved.' : 'This complaint is not waiting for your approval.',
    );
    assertVersion(cur, body.version);
    await tx.query(`update public.complaints set status = 'in_progress', rejection_reason = $2 where id = $1`, [id, body.reason]);
  });
}

export function withdrawComplaint(actor: Actor, id: string, body: { version: number; reason: string | null }) {
  return reporterAction(actor, id, body.reason, async (tx, cur) => {
    assertStatus(cur, ['pending_review'], "Work has already started, so this complaint can't be withdrawn.");
    assertVersion(cur, body.version);
    // closure_reason holds the optional withdrawal reason; the history note keeps it either way.
    const reason = body.reason && [...body.reason].length >= 3 ? body.reason : null;
    await tx.query(`update public.complaints set status = 'withdrawn', closure_reason = $2 where id = $1`, [id, reason]);
  });
}

/** C30 (option D): reopen an automatically resolved complaint within the reopen window (CB-21). */
export function reporterReopenComplaint(actor: Actor, id: string, body: { version: number; reason: string }) {
  return reporterAction(actor, id, body.reason, async (tx, cur) => {
    assertStatus(cur, ['resolved'], 'Only resolved complaints can be reopened.');
    assertVersion(cur, body.version);
    if (!(await wasAutoResolved(tx, id))) {
      throw appError('INVALID_STATUS_TRANSITION', 'Only automatically resolved complaints can be reopened by the reporter.', {
        currentStatus: cur.status,
      });
    }
    const { settings } = await loadCampus(tx);
    const until = reporterReopenUntil(
      { status: cur.status, autoResolved: true, resolvedAt: cur.resolved_at, reassignmentRequested: false, workCompletedAt: null },
      settings.complaintReopenWindowDays,
    );
    if (!until || Date.now() >= until.getTime()) {
      throw appError('REOPEN_WINDOW_CLOSED', undefined, { reopenUntil: until?.toISOString() ?? null });
    }
    await tx.query(`update public.complaints set status = 'in_progress', rejection_reason = $2 where id = $1`, [id, body.reason]);
  });
}
