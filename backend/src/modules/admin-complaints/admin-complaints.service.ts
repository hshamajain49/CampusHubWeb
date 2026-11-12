// Super Admin complaint console (COMPLAINT_REGISTRATION_SPEC.md CW-06, §10.4 CA-4…CA-6, C15–C17, C21–C22) and the
// complaint KPIs for the admin dashboard (§11.4 E17).
import {
  COMPLAINT_OVERDUE_DAYS,
  COMPLAINT_STATUSES,
  OPEN_COMPLAINT_STATUSES,
  type AdminCloseBody,
  type AdminReassignBody,
  type Complaint,
  type ComplaintKpis,
  type ComplaintStatusCounts,
  type ComplaintSummary,
} from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { likePattern, listMeta, offsetOf, Where } from '../../db/sql.js';
import { appError, validationError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { toCsv } from '../../lib/csv.js';
import { campusIsoMinute } from '../../lib/format.js';
import { audit } from '../audit/audit-writer.js';
import { COMPLAINT_SELECT, loadComplaintRow } from '../complaints/complaint.queries.js';
import { toComplaint, toComplaintSummary } from '../complaints/complaint.mapper.js';
import { assertStatus, assertVersion, lockComplaint } from '../complaints/complaint-guards.js';

const OPEN = [...OPEN_COMPLAINT_STATUSES] as string[];

export interface AdminComplaintFilters {
  status?: string[];
  departmentId?: string;
  categoryId?: string;
  venueId?: string;
  reporterId?: string;
  reporterRole?: string;
  flag?: 'reassignment' | 'overdue' | 'rejected' | 'mine';
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

/** Filters on the wrapped COMPLAINT_SELECT (alias c). `status` is applied separately so the tab counts can ignore it. */
function applyFilters(w: Where, f: AdminComplaintFilters, actorId: string, timeZone: string) {
  if (f.departmentId) w.add('c.department_id = $?', f.departmentId);
  if (f.categoryId) w.add('c.category_id = $?', f.categoryId);
  if (f.venueId) w.add('c.venue_id = $?', f.venueId);
  if (f.reporterId) w.add('c.reporter_id = $?', f.reporterId);
  if (f.reporterRole) w.add('c.reporter_role = $?', f.reporterRole);
  if (f.flag === 'reassignment') w.add('c.reassignment_requested');
  if (f.flag === 'rejected') w.add(`c.status = 'in_progress' and c.rejection_reason is not null`);
  if (f.flag === 'mine') w.add('c.reporter_id = $?', actorId);
  if (f.flag === 'overdue') w.add('c.status = any($?::text[]) and c.created_at < now() - make_interval(days => $?)', OPEN, COMPLAINT_OVERDUE_DAYS);
  if (f.dateFrom) w.add('(c.created_at at time zone $?)::date >= $?::date', timeZone, f.dateFrom);
  if (f.dateTo) w.add('(c.created_at at time zone $?)::date <= $?::date', timeZone, f.dateTo);
  if (f.q) {
    const like = w.param(likePattern(f.q));
    w.add(
      `(c.reference ilike ${like} or c.title ilike ${like} or c.reporter_name ilike ${like} or c.reporter_email ilike ${like}
        or coalesce(c.location_details, '') ilike ${like} or coalesce(c.venue_name, '') ilike ${like})`,
    );
  }
}

// ─────────────────────────── C15 list ───────────────────────────
export async function listAdminComplaints(
  actor: Actor,
  q: AdminComplaintFilters & { sort: string; page: number; pageSize: number },
): Promise<{ data: ComplaintSummary[]; meta: ReturnType<typeof listMeta> & { statusCounts: ComplaintStatusCounts } }> {
  const { settings } = await loadCampus(pool);
  const w = new Where();
  applyFilters(w, q, actor.id, settings.campusTimezone);
  const counts = await pool.query<{ status: string; n: number }>(
    `select c.status, count(*) as n from (${COMPLAINT_SELECT}) c ${w.sql()} group by c.status`,
    w.params,
  );
  const statusCounts = Object.fromEntries([['all', 0], ...COMPLAINT_STATUSES.map((s) => [s, 0])]) as ComplaintStatusCounts;
  for (const r of counts.rows) {
    statusCounts[r.status as keyof ComplaintStatusCounts] = r.n;
    statusCounts.all += r.n;
  }
  if (q.status?.length) w.add('c.status = any($?::text[])', q.status);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from (${COMPLAINT_SELECT}) c ${where}`, w.params)).rows[0]!.n;
  const order = q.sort === 'createdAt:asc' ? 'c.created_at asc' : q.sort === 'updatedAt:desc' ? 'c.updated_at desc' : 'c.created_at desc';
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(`select * from (${COMPLAINT_SELECT}) c ${where} order by ${order}, c.id limit ${limit} offset ${offset}`, w.params);
  return {
    data: rows.map((r) => toComplaintSummary(r, { includeReporter: true })),
    meta: { ...listMeta(q.page, q.pageSize, total), statusCounts },
  };
}

// ─────────────────────────── C16 export ───────────────────────────
export async function exportComplaintsCsv(actor: Actor, f: AdminComplaintFilters): Promise<{ csv: string; filename: string }> {
  const campus = await loadCampus(pool);
  const tz = campus.settings.campusTimezone;
  const w = new Where();
  applyFilters(w, f, actor.id, tz);
  if (f.status?.length) w.add('c.status = any($?::text[])', f.status);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from (${COMPLAINT_SELECT}) c ${where}`, w.params)).rows[0]!.n;
  if (total > 10_000) throw validationError({}, `Too many rows (${total}). Narrow the filters or the date range.`);
  const { rows } = await pool.query(
    `select c.*,
            (select count(*) from public.complaint_history h where h.complaint_id = c.id and h.event_type = 'rejected') as rejection_count
       from (${COMPLAINT_SELECT}) c ${where} order by c.created_at asc`,
    w.params,
  );
  const header = [
    'reference', 'created_at', 'title', 'category', 'department', 'venue', 'location', 'status', 'reporter_name',
    'reporter_email', 'reporter_role', 'handled_by', 'work_started_at', 'work_completed_at', 'resolved_at', 'closed_at',
    'closure_type', 'closure_reason', 'rejection_count', 'resolution_hours',
  ];
  const data = rows.map((r) => [
    r.reference, campusIsoMinute(r.created_at, tz), r.title, r.category_name, r.department_name, r.venue_name ?? '',
    r.location_details ?? '', r.status, r.reporter_name, r.reporter_email, r.reporter_role, r.handler_name ?? '',
    campusIsoMinute(r.work_started_at, tz), campusIsoMinute(r.work_completed_at, tz), campusIsoMinute(r.resolved_at, tz),
    campusIsoMinute(r.closed_at, tz), r.closure_type ?? '', r.closure_reason ?? '', r.rejection_count,
    r.resolved_at ? Math.round(((new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000) * 10) / 10 : '',
  ]);
  return { csv: toCsv(header, data), filename: `complaints-${campus.today}.csv` };
}

// ─────────────────────────── C17 detail ───────────────────────────
export async function getAdminComplaint(actor: Actor, id: string): Promise<Complaint> {
  const row = await loadComplaintRow(pool, id);
  if (!row) throw appError('COMPLAINT_NOT_FOUND');
  const { settings } = await loadCampus(pool);
  return toComplaint(pool, row, settings, { kind: 'admin', actorId: actor.id });
}

// ─────────────────────────── CA-4 / CA-5 reassign or dismiss (C21) ───────────────────────────
export async function reassignComplaint(actor: Actor, id: string, body: AdminReassignBody): Promise<Complaint> {
  await withTransaction({ actorId: actor.id, note: body.note }, async (tx) => {
    const cur = await lockComplaint(tx, id);
    if (body.dismiss) {
      if (!cur.reassignment_requested) throw validationError({}, 'There is no reassignment request to dismiss.');
      assertVersion(cur, body.version);
      await tx.query(
        `update public.complaints set reassignment_requested = false, reassignment_note = null, reassignment_suggested_category_id = null where id = $1`,
        [id],
      );
      await audit(tx, actor, {
        action: 'complaint.reassignment_dismissed',
        entityType: 'complaint',
        entityId: id,
        summary: `Dismissed the reassignment request on ${cur.reference}`,
      });
      return;
    }
    assertStatus(cur, ['pending_review', 'in_progress'], 'Only new or in-progress complaints can be reassigned.');
    assertVersion(cur, body.version);
    if (body.categoryId === cur.category_id) throw validationError({ categoryId: ['Choose a different category.'] }, 'Choose a different category.');
    const cat = (
      await tx.query(
        `select c.id, c.name, c.department_id, d.name as department_name from public.complaint_categories c
           join public.service_departments d on d.id = c.department_id
          where c.id = $1 and c.is_active and d.is_active`,
        [body.categoryId],
      )
    ).rows[0];
    if (!cat) throw appError('CATEGORY_INACTIVE', undefined, { field: 'categoryId' });
    await tx.query(`update public.complaints set category_id = $2, department_id = $3, status = 'pending_review' where id = $1`, [
      id,
      cat.id,
      cat.department_id,
    ]);
    await audit(tx, actor, {
      action: 'complaint.reassigned',
      entityType: 'complaint',
      entityId: id,
      summary: `Reassigned ${cur.reference} to ${cat.department_name}`,
      metadata: {
        from: { categoryId: cur.category_id, departmentId: cur.department_id },
        to: { categoryId: cat.id, departmentId: cat.department_id },
      },
    });
  });
  return getAdminComplaint(actor, id);
}

// ─────────────────────────── CA-6 close (C22) ───────────────────────────
export async function closeComplaint(actor: Actor, id: string, body: AdminCloseBody): Promise<Complaint> {
  await withTransaction({ actorId: actor.id, note: body.reason }, async (tx) => {
    const cur = await lockComplaint(tx, id);
    assertStatus(cur, ['pending_review', 'in_progress', 'awaiting_confirmation']);
    assertVersion(cur, body.version);
    await tx.query(`update public.complaints set status = 'closed', closure_type = $2, closure_reason = $3 where id = $1`, [
      id,
      body.closureType,
      body.reason,
    ]);
    await audit(tx, actor, {
      action: 'complaint.closed',
      entityType: 'complaint',
      entityId: id,
      summary: `Closed ${cur.reference} (${body.closureType})`,
      metadata: { closureType: body.closureType },
    });
  });
  return getAdminComplaint(actor, id);
}

// ─────────────────────────── dashboard (E17) ───────────────────────────
export async function complaintKpis(timeZone: string): Promise<ComplaintKpis> {
  const { rows } = await pool.query(
    `select count(*) filter (where status = any($1::text[])) as open,
            count(*) filter (where (created_at at time zone $2)::date = (now() at time zone $2)::date) as new_today,
            count(*) filter (where status = 'awaiting_confirmation') as awaiting,
            count(*) filter (where reassignment_requested) as reassignment,
            count(*) filter (where status = any($1::text[]) and created_at < now() - make_interval(days => $3)) as overdue,
            avg(extract(epoch from (resolved_at - created_at)) / 3600)
              filter (where status = 'resolved' and resolved_at > now() - interval '30 days') as avg_hours
       from public.complaints`,
    [OPEN, timeZone, COMPLAINT_OVERDUE_DAYS],
  );
  const k = rows[0];
  return {
    open: k.open,
    newToday: k.new_today,
    awaitingReporter: k.awaiting,
    needsReassignment: k.reassignment,
    overdue: k.overdue,
    avgResolutionHours30d: k.avg_hours === null ? null : Math.round(Number(k.avg_hours) * 10) / 10,
  };
}

export async function complaintsNeedingReassignment(limit = 5): Promise<ComplaintSummary[]> {
  const { rows } = await pool.query(
    `select * from (${COMPLAINT_SELECT}) c where c.reassignment_requested order by c.updated_at asc limit $1`,
    [limit],
  );
  return rows.map((r) => toComplaintSummary(r, { includeReporter: true }));
}
