// Complaint report aggregates (COMPLAINT_REGISTRATION_SPEC.md §11.3 C29, §17). SQL aggregates only (CG-12).
// Basis: complaints created in the range (campus-local dates), except `aging` (currently open, any age) and the
// `resolved` trend series (by resolved_at).
import { addDays, COMPLAINT_STATUSES, diffDays, type ComplaintReport } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { loadCampus } from '../../domain/settings.js';

const round = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? null : Math.round(Number(n) * 10 ** digits) / 10 ** digits);
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : 0);

// SQL fragments built from literals and the status enum only. Parameters: $1 from, $2 to, $3 department (nullable),
// $4 campus timezone.
const IN_RANGE = `(c.created_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or c.department_id = $3)`;
const STATUS_COUNTS = COMPLAINT_STATUSES.map((s) => `count(*) filter (where c.status = '${s}') as ${s}`).join(', ');

export async function complaintReport(q: { from?: string; to?: string; departmentId?: string }): Promise<ComplaintReport> {
  const campus = await loadCampus(pool);
  const tz = campus.settings.campusTimezone;
  const to = q.to ?? campus.today;
  const from = q.from ?? addDays(to, -29);
  const dept = q.departmentId ?? null;
  const params = [from, to, dept, tz];

  const [totals, reopen, byCategory, byDepartment, byVenue, byRole, aging, trendSub, trendRes] = await Promise.all([
    pool.query(
      `select count(*) as submitted,
              ${STATUS_COUNTS},
              avg(extract(epoch from (c.work_started_at - c.created_at)) / 3600) filter (where c.work_started_at is not null) as to_start,
              avg(extract(epoch from (c.resolved_at - c.created_at)) / 3600) filter (where c.resolved_at is not null) as to_resolve
         from public.complaints c where ${IN_RANGE}`,
      params,
    ),
    pool.query(
      `select count(distinct h.complaint_id) filter (where h.event_type in ('rejected', 'reopened')) as reopened,
              count(distinct h.complaint_id) filter (where h.event_type = 'work_completed') as completed,
              count(distinct h.complaint_id) filter (where h.event_type = 'auto_resolved' and c.status = 'resolved') as auto_resolved
         from public.complaint_history h join public.complaints c on c.id = h.complaint_id
        where ${IN_RANGE}`,
      params,
    ),
    pool.query(
      `select cat.id, cat.name, cat.color, count(c.id) as n, count(c.id) filter (where c.status = 'resolved') as resolved
         from public.complaints c join public.complaint_categories cat on cat.id = c.category_id
        where ${IN_RANGE} group by cat.id, cat.name, cat.color order by count(c.id) desc, cat.name`,
      params,
    ),
    pool.query(
      `select d.id, d.name, count(c.id) as n,
              count(c.id) filter (where c.status in ('pending_review','in_progress','awaiting_confirmation')) as open,
              count(c.id) filter (where c.status in ('pending_review','in_progress','awaiting_confirmation')
                                    and c.created_at < now() - interval '7 days') as overdue,
              avg(extract(epoch from (c.resolved_at - c.created_at)) / 3600) filter (where c.resolved_at is not null) as to_resolve
         from public.complaints c join public.service_departments d on d.id = c.department_id
        where ${IN_RANGE} group by d.id, d.name order by count(c.id) desc, d.name`,
      params,
    ),
    pool.query(
      `select v.id, v.name, count(c.id) as n
         from public.complaints c join public.venues v on v.id = c.venue_id
        where ${IN_RANGE} group by v.id, v.name order by count(c.id) desc, v.name limit 10`,
      params,
    ),
    pool.query(
      `select p.role, count(c.id) as n
         from public.complaints c join public.profiles p on p.id = c.reporter_id
        where ${IN_RANGE} group by p.role order by count(c.id) desc`,
      params,
    ),
    pool.query(
      `select count(*) filter (where c.created_at >= now() - interval '2 days') as under2,
              count(*) filter (where c.created_at < now() - interval '2 days' and c.created_at >= now() - interval '7 days') as from2to7,
              count(*) filter (where c.created_at < now() - interval '7 days') as over7
         from public.complaints c
        where c.status in ('pending_review','in_progress','awaiting_confirmation') and ($1::uuid is null or c.department_id = $1)`,
      [dept],
    ),
    pool.query(
      `select (c.created_at at time zone $4)::date::text as day, count(*) as n
         from public.complaints c where ${IN_RANGE} group by 1`,
      params,
    ),
    pool.query(
      `select (c.resolved_at at time zone $4)::date::text as day, count(*) as n
         from public.complaints c
        where c.status = 'resolved' and c.resolved_at is not null
          and (c.resolved_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or c.department_id = $3)
        group by 1`,
      params,
    ),
  ]);

  const t = totals.rows[0];
  const r = reopen.rows[0];
  const sub = new Map(trendSub.rows.map((x) => [x.day, x.n]));
  const res = new Map(trendRes.rows.map((x) => [x.day, x.n]));
  const days = diffDays(to, from) + 1;
  return {
    range: { from, to },
    totals: {
      submitted: t.submitted,
      ...(Object.fromEntries(COMPLAINT_STATUSES.map((s) => [s, t[s]])) as Record<(typeof COMPLAINT_STATUSES)[number], number>),
    },
    resolutionRate: ratio(t.resolved, t.submitted - t.withdrawn),
    avgHoursToStart: round(t.to_start),
    avgHoursToResolve: round(t.to_resolve),
    reopenRate: ratio(r.reopened, r.completed),
    autoResolvedShare: ratio(r.auto_resolved, t.resolved),
    byCategory: byCategory.rows.map((x) => ({ categoryId: x.id, name: x.name, color: x.color, count: x.n, resolved: x.resolved })),
    byDepartment: byDepartment.rows.map((x) => ({
      departmentId: x.id,
      name: x.name,
      count: x.n,
      open: x.open,
      overdue: x.overdue,
      avgHoursToResolve: round(x.to_resolve),
    })),
    byVenue: byVenue.rows.map((x) => ({ venueId: x.id, name: x.name, count: x.n })),
    byReporterRole: byRole.rows.map((x) => ({ role: x.role, count: x.n })),
    aging: { under2Days: aging.rows[0].under2, from2To7Days: aging.rows[0].from2to7, over7Days: aging.rows[0].over7 },
    trend: Array.from({ length: Math.max(0, days) }, (_, i) => {
      const date = addDays(from, i);
      return { date, submitted: sub.get(date) ?? 0, resolved: res.get(date) ?? 0 };
    }),
    generatedAt: new Date().toISOString(),
  };
}
