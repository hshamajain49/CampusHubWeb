// Reports (E44): aggregate SQL only (§15.4 definitions).
import { addDays, diffDays, timeToMinutes, type ReportSummary } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { loadCampus } from '../../domain/settings.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function reportSummary(q: { from?: string; to?: string; venueId?: string }): Promise<ReportSummary> {
  const campus = await loadCampus(pool);
  const s = campus.settings;
  const to = q.to ?? campus.today;
  const from = q.from ?? addDays(to, -29);
  const venue = q.venueId ?? null;
  const base = `from public.bookings b where b.booking_date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)`;
  const params = [from, to, venue];

  const [totals, byVenue, byRole, byWeekday, byHour, trendSub, trendApp] = await Promise.all([
    pool.query(
      `select count(*) as requests,
              count(*) filter (where status = 'pending') as pending,
              count(*) filter (where status = 'approved') as approved,
              count(*) filter (where status = 'rejected') as rejected,
              count(*) filter (where status = 'cancelled') as cancelled,
              count(*) filter (where status = 'expired') as expired,
              coalesce(avg(extract(epoch from (decided_at - created_at)) / 3600) filter (where decided_at is not null), 0) as avg_hours,
              coalesce(sum(extract(epoch from (end_time - start_time)) / 3600) filter (where status = 'approved'), 0) as approved_hours
         ${base}`,
      params,
    ),
    pool.query(
      `select v.id, v.name, count(b.id) as requests,
              count(b.id) filter (where b.status = 'approved') as approved,
              coalesce(sum(extract(epoch from (b.end_time - b.start_time)) / 60) filter (where b.status = 'approved'), 0) as approved_minutes
         from public.venues v
         left join public.bookings b on b.venue_id = v.id and b.booking_date between $1::date and $2::date
        where ($3::uuid is null or v.id = $3)
        group by v.id, v.name
       having count(b.id) > 0 or v.is_active
        order by count(b.id) desc, v.name`,
      params,
    ),
    pool.query(
      `select p.role, count(*) as requests, count(*) filter (where b.status = 'approved') as approved
         from public.bookings b join public.profiles p on p.id = b.requester_id
        where b.booking_date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)
          and p.role in ('student','faculty_staff','department_staff')
        group by p.role`,
      params,
    ),
    pool.query(`select extract(isodow from b.booking_date)::int as dow, count(*) as approved ${base} and b.status = 'approved' group by 1`, params),
    pool.query(`select extract(hour from b.start_time)::int as hour, count(*) as approved ${base} and b.status = 'approved' group by 1`, params),
    pool.query(
      `select (b.created_at at time zone $4)::date::text as day, count(*) as n
         from public.bookings b
        where (b.created_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)
        group by 1`,
      [...params, s.campusTimezone],
    ),
    pool.query(
      `select (b.decided_at at time zone $4)::date::text as day, count(*) as n
         from public.bookings b
        where b.status = 'approved' and b.decided_at is not null
          and (b.decided_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)
        group by 1`,
      [...params, s.campusTimezone],
    ),
  ]);

  const t = totals.rows[0];
  const days = diffDays(to, from) + 1;
  const operatingMinutes = timeToMinutes(s.operatingHoursEnd) - timeToMinutes(s.operatingHoursStart);
  const decided = t.approved + t.rejected;
  const sub = new Map(trendSub.rows.map((r) => [r.day, r.n]));
  const app = new Map(trendApp.rows.map((r) => [r.day, r.n]));
  const dow = new Map(byWeekday.rows.map((r) => [r.dow, r.approved]));
  const hours = new Map(byHour.rows.map((r) => [r.hour, r.approved]));
  const firstHour = Math.floor(timeToMinutes(s.operatingHoursStart) / 60);
  const lastHour = Math.ceil(timeToMinutes(s.operatingHoursEnd) / 60) - 1;

  return {
    range: { from, to },
    totals: {
      requests: t.requests,
      pending: t.pending,
      approved: t.approved,
      rejected: t.rejected,
      cancelled: t.cancelled,
      expired: t.expired,
    },
    approvalRate: decided ? Math.round((t.approved / decided) * 1000) / 1000 : 0,
    avgDecisionHours: Math.round(Number(t.avg_hours) * 10) / 10,
    approvedHours: Math.round(Number(t.approved_hours) * 10) / 10,
    byVenue: byVenue.rows.map((r) => ({
      venueId: r.id,
      venueName: r.name,
      requests: r.requests,
      approved: r.approved,
      approvedHours: Math.round((Number(r.approved_minutes) / 60) * 10) / 10,
      utilizationPct: operatingMinutes > 0 ? Math.round((Number(r.approved_minutes) / (operatingMinutes * days)) * 1000) / 10 : 0,
    })),
    byRole: (['student', 'faculty_staff'] as const).map((role) => {
      const r = byRole.rows.find((x) => x.role === role);
      return { role, requests: r?.requests ?? 0, approved: r?.approved ?? 0 };
    }),
    byWeekday: WEEKDAYS.map((label, i) => ({ weekday: i + 1, label, approved: dow.get(i + 1) ?? 0 })),
    byHour: Array.from({ length: Math.max(0, lastHour - firstHour + 1) }, (_, i) => ({
      hour: firstHour + i,
      approved: hours.get(firstHour + i) ?? 0,
    })),
    trend: Array.from({ length: days }, (_, i) => {
      const d = addDays(from, i);
      return { date: d, submitted: sub.get(d) ?? 0, approved: app.get(d) ?? 0 };
    }),
    generatedAt: new Date().toISOString(),
  };
}
