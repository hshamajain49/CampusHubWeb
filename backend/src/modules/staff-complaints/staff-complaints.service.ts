// Department staff workspace (COMPLAINT_REGISTRATION_SPEC.md CW-05, §10.4 CA-3) and the work actions shared with the
// Super Admin (C18–C20). Staff only ever see complaints currently assigned to their department (§4.3); anything else 404s.
import {
  COMPLAINT_OVERDUE_DAYS,
  type Complaint,
  type ComplaintSummary,
  type StaffDashboard,
  type StaffQueueCounts,
  type StaffTab,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { audit } from '../audit/audit-writer.js';
import { COMPLAINT_SELECT, loadComplaintRow } from '../complaints/complaint.queries.js';
import { toComplaint, toComplaintSummary } from '../complaints/complaint.mapper.js';
import { assertStatus, assertVersion, lockComplaint } from '../complaints/complaint-guards.js';
import { discardPhotos, insertAttachments, NO_PHOTOS, preparePhotos } from '../complaints/complaint-photos.js';

const TAB_STATUSES: Record<Exclude<StaffTab, 'all'>, string[]> = {
  new: ['pending_review'],
  in_progress: ['in_progress'],
  awaiting: ['awaiting_confirmation'],
  resolved: ['resolved'],
  closed: ['withdrawn', 'closed'],
};

// ─────────────────────────── C08 dashboard ───────────────────────────
export async function staffDashboard(dept: { id: string; name: string }): Promise<StaffDashboard> {
  const { settings } = await loadCampus(pool);
  const [counts, attention, resolved] = await Promise.all([
    pool.query(
      `select count(*) filter (where status = 'pending_review') as new,
              count(*) filter (where status = 'in_progress') as in_progress,
              count(*) filter (where status = 'awaiting_confirmation') as awaiting,
              count(*) filter (where status in ('pending_review','in_progress','awaiting_confirmation')
                                 and created_at < now() - make_interval(days => $3)) as overdue,
              count(*) filter (where status = 'resolved'
                                 and date_trunc('month', resolved_at at time zone $2) = date_trunc('month', now() at time zone $2)) as resolved_month
         from public.complaints where department_id = $1`,
      [dept.id, settings.campusTimezone, COMPLAINT_OVERDUE_DAYS],
    ),
    // Rejected by their reporter first, then the oldest new complaints (max 5).
    pool.query(
      `select * from (${COMPLAINT_SELECT}) c
        where c.department_id = $1
          and ((c.status = 'in_progress' and c.rejection_reason is not null) or c.status = 'pending_review')
        order by (c.status = 'in_progress') desc, c.created_at asc limit 5`,
      [dept.id],
    ),
    pool.query(
      `select * from (${COMPLAINT_SELECT}) c where c.department_id = $1 and c.status = 'resolved' order by c.resolved_at desc limit 5`,
      [dept.id],
    ),
  ]);
  const k = counts.rows[0];
  return {
    department: { id: dept.id, name: dept.name, isActive: true },
    counts: { new: k.new, inProgress: k.in_progress, awaitingReporter: k.awaiting, overdue: k.overdue, resolvedThisMonth: k.resolved_month },
    needsAttention: attention.rows.map((r) => toComplaintSummary(r, { includeReporter: true })),
    recentlyResolved: resolved.rows.map((r) => toComplaintSummary(r, { includeReporter: true })),
  };
}

// ─────────────────────────── C09 queue ───────────────────────────
export async function listDepartmentComplaints(
  departmentId: string,
  q: { tab: StaffTab; categoryId?: string; q?: string; flag?: 'rejected' | 'reassignment'; sort?: string; page: number; pageSize: number },
): Promise<{ data: ComplaintSummary[]; meta: ReturnType<typeof listMeta> & { counts: StaffQueueCounts } }> {
  const w = new Where();
  w.add('c.department_id = $?', departmentId);
  if (q.categoryId) w.add('c.category_id = $?', q.categoryId);
  if (q.q) {
    const like = w.param(likePattern(q.q));
    w.add(
      `(c.reference ilike ${like} or c.title ilike ${like} or c.reporter_name ilike ${like} or c.reporter_email ilike ${like}
        or coalesce(c.location_details, '') ilike ${like} or coalesce(c.venue_name, '') ilike ${like})`,
    );
  }
  if (q.flag === 'rejected') w.add(`c.status = 'in_progress' and c.rejection_reason is not null`);
  if (q.flag === 'reassignment') w.add('c.reassignment_requested');

  // Tab counts honour the other filters (search, category, flag) but not the tab itself.
  const countSql = `select c.status, count(*) as n from (${COMPLAINT_SELECT}) c ${w.sql()} group by c.status`;
  const byStatus = new Map((await pool.query<{ status: string; n: number }>(countSql, w.params)).rows.map((r) => [r.status, r.n]));
  const sum = (statuses: string[]) => statuses.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0);
  const counts: StaffQueueCounts = {
    new: sum(TAB_STATUSES.new),
    in_progress: sum(TAB_STATUSES.in_progress),
    awaiting: sum(TAB_STATUSES.awaiting),
    resolved: sum(TAB_STATUSES.resolved),
    closed: sum(TAB_STATUSES.closed),
  };

  if (q.tab !== 'all') w.add('c.status = any($?::text[])', TAB_STATUSES[q.tab]);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from (${COMPLAINT_SELECT}) c ${where}`, w.params)).rows[0]!.n;
  const openTab = q.tab === 'new' || q.tab === 'in_progress' || q.tab === 'awaiting';
  const sort = q.sort ?? (openTab ? 'createdAt:asc' : 'createdAt:desc');
  const order = sort === 'createdAt:asc' ? 'c.created_at asc' : sort === 'updatedAt:desc' ? 'c.updated_at desc' : 'c.created_at desc';
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(`select * from (${COMPLAINT_SELECT}) c ${where} order by ${order}, c.id limit ${limit} offset ${offset}`, w.params);
  return {
    data: rows.map((r) => toComplaintSummary(r, { includeReporter: true })),
    meta: { ...listMeta(q.page, q.pageSize, total), counts },
  };
}

// ─────────────────────────── C10 detail ───────────────────────────
export async function getDepartmentComplaint(departmentId: string, id: string): Promise<Complaint> {
  const row = await loadComplaintRow(pool, id);
  if (!row || row.department_id !== departmentId) throw appError('COMPLAINT_NOT_FOUND');
  const { settings } = await loadCampus(pool);
  return toComplaint(pool, row, settings, { kind: 'staff' });
}

// ─────────────────────────── CA-3 work actions (staff C11–C13, admin C18–C20) ───────────────────────────
/** Staff act within their department; the admin acts on any department and is audited. */
export type WorkScope = { kind: 'staff'; departmentId: string } | { kind: 'admin' };

const lockScope = (scope: WorkScope) => (scope.kind === 'staff' ? { departmentId: scope.departmentId } : {});

async function adminAudit(tx: Parameters<typeof audit>[0], actor: Actor, scope: WorkScope, action: string, cur: any, summary: string) {
  if (scope.kind !== 'admin') return;
  await audit(tx, actor, { action, entityType: 'complaint', entityId: cur.id, summary: `${summary} ${cur.reference}`, metadata: { departmentId: cur.department_id } });
}

export async function startWork(actor: Actor, scope: WorkScope, id: string, body: { version: number; note: string | null }): Promise<void> {
  await withTransaction({ actorId: actor.id, note: body.note }, async (tx) => {
    const cur = await lockComplaint(tx, id, lockScope(scope));
    assertStatus(cur, ['pending_review'], cur.status === 'in_progress' ? 'Work has already started on this complaint.' : undefined);
    assertVersion(cur, body.version);
    await tx.query(`update public.complaints set status = 'in_progress', handled_by = $2 where id = $1`, [id, actor.id]);
    await adminAudit(tx, actor, scope, 'complaint.work_started', cur, 'Started work on');
  });
}

export async function completeWork(
  actor: Actor,
  scope: WorkScope,
  id: string,
  body: { version: number; note: string | null },
  files: { buffer: Buffer; name: string }[],
): Promise<void> {
  // Fail fast before uploading: the complaint must be visible, and the 3-photo cap (CB-11) must leave room.
  const pre = await pool.query<{ department_id: string; n: number }>(
    `select c.department_id, (select count(*) from public.complaint_attachments a where a.complaint_id = c.id and a.kind = 'resolution') as n
       from public.complaints c where c.id = $1`,
    [id],
  );
  const row = pre.rows[0];
  if (!row || (scope.kind === 'staff' && row.department_id !== scope.departmentId)) throw appError('COMPLAINT_NOT_FOUND');
  if (row.n + files.length > 3) {
    throw appError('TOO_MANY_FILES', `This complaint already has ${row.n} "after" photo${row.n === 1 ? '' : 's'}; up to 3 are allowed.`);
  }

  const prepared = files.length ? await preparePhotos(id, files) : NO_PHOTOS;
  try {
    await withTransaction({ actorId: actor.id, note: body.note }, async (tx) => {
      const cur = await lockComplaint(tx, id, lockScope(scope));
      assertStatus(cur, ['in_progress']);
      assertVersion(cur, body.version);
      await tx.query(
        `update public.complaints set status = 'awaiting_confirmation', resolution_note = $2, handled_by = coalesce(handled_by, $3) where id = $1`,
        [id, body.note, actor.id],
      );
      await insertAttachments(tx, id, 'resolution', prepared, actor.id);
      await adminAudit(tx, actor, scope, 'complaint.work_completed', cur, 'Marked as done:');
    });
  } catch (err) {
    await discardPhotos(prepared);
    throw err;
  }
}

export async function reopenWork(actor: Actor, scope: WorkScope, id: string, body: { version: number; note: string | null }): Promise<void> {
  await withTransaction({ actorId: actor.id, note: body.note }, async (tx) => {
    const cur = await lockComplaint(tx, id, lockScope(scope));
    assertStatus(cur, ['resolved'], 'Only resolved complaints can be reopened.');
    assertVersion(cur, body.version);
    await tx.query(`update public.complaints set status = 'in_progress', handled_by = coalesce(handled_by, $2) where id = $1`, [id, actor.id]);
    await adminAudit(tx, actor, scope, 'complaint.reopened', cur, 'Reopened');
  });
}

/** C14: flag a misrouted complaint for the administrator (CB-14). Staff only. */
export async function requestReassignment(
  actor: Actor,
  departmentId: string,
  id: string,
  body: { version: number; reason: string; suggestedCategoryId: string | null },
): Promise<void> {
  await withTransaction({ actorId: actor.id, note: body.reason }, async (tx) => {
    const cur = await lockComplaint(tx, id, { departmentId });
    assertStatus(cur, ['pending_review', 'in_progress'], 'Only new or in-progress complaints can be reassigned.');
    if (cur.reassignment_requested) throw appError('REASSIGNMENT_ALREADY_REQUESTED');
    assertVersion(cur, body.version);
    if (body.suggestedCategoryId) {
      const ok = await tx.query(
        `select 1 from public.complaint_categories c join public.service_departments d on d.id = c.department_id
          where c.id = $1 and c.is_active and d.is_active`,
        [body.suggestedCategoryId],
      );
      if (!ok.rowCount) throw appError('CATEGORY_INACTIVE', undefined, { field: 'suggestedCategoryId' });
    }
    await tx.query(
      `update public.complaints set reassignment_requested = true, reassignment_note = $2, reassignment_suggested_category_id = $3 where id = $1`,
      [id, body.reason, body.suggestedCategoryId],
    );
  });
}
