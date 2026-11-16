// Reports (E44): aggregate SQL only. "Booked" = confirmed or completed (the member got the venue).
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
  // A booking is in range when any of its days is; hours and day counts only include the days inside the range.
  const OVERLAP = `b.booking_date <= $2::date and b.end_date >= $1::date`;
  const DAYS_IN_RANGE = `(least(b.end_date, $2::date) - greatest(b.booking_date, $1::date) + 1)`;
  const base = `from public.bookings b where ${OVERLAP} and ($3::uuid is null or b.venue_id = $3)`;
  const params = [from, to, venue];

  const BOOKED = `b.status in ('confirmed','completed')`;
  const [totals, byVenue, byRole, byWeekday, byHour, trendSub, trendBooked] = await Promise.all([
    pool.query(
      `select count(*) as requests,
              count(*) filter (where ${BOOKED}) as booked,
              count(*) filter (where b.status = 'confirmed') as confirmed,
              count(*) filter (where b.status = 'queued') as queued,
              count(*) filter (where b.status = 'completed') as completed,
              count(*) filter (where b.status = 'cancelled') as cancelled,
              count(*) filter (where b.status = 'expired') as expired,
              count(*) filter (where b.queued_at is not null) as ever_queued,
              count(*) filter (where b.queued_at is not null and b.confirmed_at is not null) as promoted,
              coalesce(avg(extract(epoch from (b.confirmed_at - b.queued_at)) / 3600)
                filter (where b.queued_at is not null and b.confirmed_at is not null), 0) as avg_wait_hours,
              coalesce(sum(extract(epoch from (b.end_time - b.start_time)) / 3600 * ${DAYS_IN_RANGE}) filter (where ${BOOKED}), 0) as booked_hours
         ${base}`,
      params,
    ),
    pool.query(
      `select v.id, v.name, count(b.id) as requests,
              count(b.id) filter (where ${BOOKED}) as booked,
              coalesce(sum(extract(epoch from (b.end_time - b.start_time)) / 60 * ${DAYS_IN_RANGE}) filter (where ${BOOKED}), 0) as booked_minutes
         from public.venues v
         left join public.bookings b on b.venue_id = v.id and ${OVERLAP}
        where ($3::uuid is null or v.id = $3)
        group by v.id, v.name
       having count(b.id) > 0 or v.is_active
        order by count(b.id) desc, v.name`,
      params,
    ),
    pool.query(
      `select p.role, count(*) as requests, count(*) filter (where ${BOOKED}) as booked
         from public.bookings b join public.profiles p on p.id = b.requester_id
        where ${OVERLAP} and ($3::uuid is null or b.venue_id = $3)
          and p.role in ('student','faculty_staff','department_staff')
        group by p.role`,
      params,
    ),
    // Weekday and hour count booked days (a three-day booking counts on each of its days).
    pool.query(
      `select extract(isodow from d)::int as dow, count(*) as booked
         from public.bookings b
         cross join lateral generate_series(greatest(b.booking_date, $1::date), least(b.end_date, $2::date), interval '1 day') as d
        where ${OVERLAP} and ($3::uuid is null or b.venue_id = $3) and ${BOOKED} group by 1`,
      params,
    ),
    pool.query(
      `select extract(hour from b.start_time)::int as hour, sum(${DAYS_IN_RANGE})::int as booked ${base} and ${BOOKED} group by 1`,
      params,
    ),
    pool.query(
      `select (b.created_at at time zone $4)::date::text as day, count(*) as n
         from public.bookings b
        where (b.created_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)
        group by 1`,
      [...params, s.campusTimezone],
    ),
    pool.query(
      `select (b.confirmed_at at time zone $4)::date::text as day, count(*) as n
         from public.bookings b
        where b.confirmed_at is not null
          and (b.confirmed_at at time zone $4)::date between $1::date and $2::date and ($3::uuid is null or b.venue_id = $3)
        group by 1`,
      [...params, s.campusTimezone],
    ),
  ]);

  const t = totals.rows[0];
  const days = diffDays(to, from) + 1;
  const operatingMinutes = timeToMinutes(s.operatingHoursEnd) - timeToMinutes(s.operatingHoursStart);
  const sub = new Map(trendSub.rows.map((r) => [r.day, r.n]));
  const booked = new Map(trendBooked.rows.map((r) => [r.day, r.n]));
  const dow = new Map(byWeekday.rows.map((r) => [r.dow, r.booked]));
  const hours = new Map(byHour.rows.map((r) => [r.hour, r.booked]));
  const firstHour = Math.floor(timeToMinutes(s.operatingHoursStart) / 60);
  const lastHour = Math.ceil(timeToMinutes(s.operatingHoursEnd) / 60) - 1;

  return {
    range: { from, to },
    totals: {
      requests: t.requests,
      booked: t.booked,
      confirmed: t.confirmed,
      queued: t.queued,
      completed: t.completed,
      cancelled: t.cancelled,
      expired: t.expired,
    },
    queuedShare: t.requests ? Math.round((t.ever_queued / t.requests) * 1000) / 1000 : 0,
    promotedCount: t.promoted,
    avgQueueWaitHours: Math.round(Number(t.avg_wait_hours) * 10) / 10,
    bookedHours: Math.round(Number(t.booked_hours) * 10) / 10,
    byVenue: byVenue.rows.map((r) => ({
      venueId: r.id,
      venueName: r.name,
      requests: r.requests,
      booked: r.booked,
      bookedHours: Math.round((Number(r.booked_minutes) / 60) * 10) / 10,
      utilizationPct: operatingMinutes > 0 ? Math.round((Number(r.booked_minutes) / (operatingMinutes * days)) * 1000) / 10 : 0,
    })),
    byRole: (['student', 'faculty_staff', 'department_staff'] as const).map((role) => {
      const r = byRole.rows.find((x) => x.role === role);
      return { role, requests: r?.requests ?? 0, booked: r?.booked ?? 0 };
    }),
    byWeekday: WEEKDAYS.map((label, i) => ({ weekday: i + 1, label, booked: dow.get(i + 1) ?? 0 })),
    byHour: Array.from({ length: Math.max(0, lastHour - firstHour + 1) }, (_, i) => ({
      hour: firstHour + i,
      booked: hours.get(firstHour + i) ?? 0,
    })),
    trend: Array.from({ length: days }, (_, i) => {
      const d = addDays(from, i);
      return { date: d, submitted: sub.get(d) ?? 0, booked: booked.get(d) ?? 0 };
    }),
    generatedAt: new Date().toISOString(),
  };
}
