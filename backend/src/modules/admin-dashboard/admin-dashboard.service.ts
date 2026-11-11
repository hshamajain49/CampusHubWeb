// Admin dashboard (E17), calendar (E25) and audit log (E47).
import type { AdminDashboard, CalendarEvent } from '@campushub/shared';
import { BLOCK_TYPE_LABELS, addDays } from '@campushub/shared';
import { pool } from '../../db/pool.js';
import { listMeta, offsetOf, Where } from '../../db/sql.js';
import { loadCampus } from '../../domain/settings.js';
import { BOOKING_SELECT, toLdt } from '../bookings/booking.queries.js';
import { toAdminListItem } from '../bookings/booking.mapper.js';
import { toVenueBlock } from '../venue-blocks/venue-blocks.service.js';

export async function adminDashboard(): Promise<AdminDashboard> {
  const campus = await loadCampus(pool);
  const now = campus.localNow.replace('T', ' ');
  const today = campus.today;
  const [kpi, attention, schedule, blocks, activity] = await Promise.all([
    pool.query(
      `select
         (select count(*) from public.bookings where status = 'pending' and (booking_date + start_time) > $1::timestamp) as pending,
         (select min(created_at) from public.bookings where status = 'pending' and (booking_date + start_time) > $1::timestamp) as oldest,
         (select count(*) from public.bookings where status = 'approved' and booking_date = $2::date) as today_approved,
         (select count(*) from public.bookings where status = 'approved' and booking_date between $2::date and $3::date) as next7,
         (select count(*) from public.venues where is_active) as active_venues,
         (select count(*) from public.venues where not is_active) as inactive_venues,
         (select count(*) from public.profiles where is_active and role in ('student','faculty_staff')) as active_members,
         (select count(*) filter (where status = 'approved') from public.bookings where decided_at > now() - interval '30 days') as approved30,
         (select count(*) filter (where status = 'rejected') from public.bookings where decided_at > now() - interval '30 days') as rejected30`,
      [now, today, addDays(today, 6)],
    ),
    pool.query(
      `${BOOKING_SELECT} where b.status = 'pending' and (b.booking_date + b.start_time) > $1::timestamp
        order by b.booking_date, b.start_time limit 5`,
      [now],
    ),
    pool.query(`${BOOKING_SELECT} where b.status = 'approved' and b.booking_date = $1::date order by b.start_time`, [today]),
    pool.query(
      `select vb.*, vb.starts_at::text as s, vb.ends_at::text as e, v.name as venue_name, p.full_name as created_by_name
         from public.venue_blocks vb join public.venues v on v.id = vb.venue_id join public.profiles p on p.id = vb.created_by
        where vb.ends_at > $1::timestamp order by vb.starts_at limit 5`,
      [now],
    ),
    pool.query(
      `select h.id, h.booking_id, h.event_type, h.to_status, h.created_at, b.reference, v.name as venue_name,
              a.id as actor_id, a.full_name as actor_name, a.role as actor_role
         from public.booking_history h
         join public.bookings b on b.id = h.booking_id
         join public.venues v on v.id = b.venue_id
         left join public.profiles a on a.id = h.actor_id
        order by h.created_at desc, h.id desc limit 10`,
    ),
  ]);
  const k = kpi.rows[0];
  const decided = k.approved30 + k.rejected30;
  return {
    kpis: {
      pendingCount: k.pending,
      oldestPendingSubmittedAt: k.oldest ? new Date(k.oldest).toISOString() : null,
      todayApprovedCount: k.today_approved,
      next7DaysApprovedCount: k.next7,
      activeVenues: k.active_venues,
      inactiveVenues: k.inactive_venues,
      activeMembers: k.active_members,
      approvalRate30d: decided ? Math.round((k.approved30 / decided) * 1000) / 1000 : 0,
    },
    needsAttention: attention.rows.map((r) => toAdminListItem(r, campus.localNow)),
    todaySchedule: schedule.rows.map((r) => toAdminListItem(r, campus.localNow)),
    upcomingBlocks: blocks.rows.map(toVenueBlock),
    recentActivity: activity.rows.map((r) => ({
      historyId: Number(r.id),
      bookingId: r.booking_id,
      reference: r.reference,
      venueName: r.venue_name,
      eventType: r.event_type,
      toStatus: r.to_status,
      actor: r.actor_id ? { id: r.actor_id, fullName: r.actor_name, role: r.actor_role } : null,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function calendar(q: { from: string; to: string; venueId?: string; statuses: string[]; includeBlocks: boolean }) {
  const campus = await loadCampus(pool);
  const range = [q.from, q.to, q.venueId ?? null];
  const events: CalendarEvent[] = [];
  if (q.statuses.length) {
    const { rows } = await pool.query(
      `${BOOKING_SELECT}
        where b.slot && tsrange($1::date::timestamp, ($2::date + 1)::timestamp, '[)')
          and ($3::uuid is null or b.venue_id = $3) and b.status = any($4::text[])
        order by b.booking_date, b.start_time`,
      [...range, q.statuses],
    );
    for (const r of rows) {
      const item = toAdminListItem(r, campus.localNow);
      events.push({
        id: `booking:${r.id}`,
        kind: 'booking',
        bookingId: r.id,
        reference: r.reference,
        status: r.status,
        title: `${r.venue_name} · ${r.requester_name}`,
        start: item.start,
        end: item.end,
        venue: { id: r.venue_id, name: r.venue_name },
        requester: { id: r.requester_id, fullName: r.requester_name, role: r.requester_role },
        purpose: r.purpose,
        version: r.version,
      });
    }
  }
  if (q.includeBlocks) {
    const { rows } = await pool.query(
      `select vb.*, vb.starts_at::text as s, vb.ends_at::text as e, v.name as venue_name
         from public.venue_blocks vb join public.venues v on v.id = vb.venue_id
        where vb.period && tsrange($1::date::timestamp, ($2::date + 1)::timestamp, '[)') and ($3::uuid is null or vb.venue_id = $3)
        order by vb.starts_at`,
      range,
    );
    for (const r of rows) {
      events.push({
        id: `block:${r.id}`,
        kind: 'block',
        blockId: r.id,
        blockType: r.block_type,
        title: `${r.venue_name} · ${BLOCK_TYPE_LABELS[r.block_type as keyof typeof BLOCK_TYPE_LABELS]}`,
        reason: r.reason,
        start: toLdt(r.s),
        end: toLdt(r.e),
        venue: { id: r.venue_id, name: r.venue_name },
      });
    }
  }
  return { from: q.from, to: q.to, timezone: campus.settings.campusTimezone, events };
}

export async function auditLogs(q: {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) {
  const campus = await loadCampus(pool);
  const tz = campus.settings.campusTimezone;
  const w = new Where();
  if (q.entityType) w.add('a.entity_type = $?', q.entityType);
  if (q.entityId) w.add('a.entity_id = $?', q.entityId);
  if (q.actorId) w.add('a.actor_id = $?', q.actorId);
  if (q.action) w.add('a.action like $?', `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (q.from) w.add('(a.created_at at time zone $?)::date >= $?::date', tz, q.from);
  if (q.to) w.add('(a.created_at at time zone $?)::date <= $?::date', tz, q.to);
  const where = w.sql();
  const total = (await pool.query<{ n: number }>(`select count(*) as n from public.audit_logs a ${where}`, w.params)).rows[0]!.n;
  const limit = w.param(q.pageSize);
  const offset = w.param(offsetOf(q.page, q.pageSize));
  const { rows } = await pool.query(
    `select a.*, host(a.ip_address) as ip, p.full_name as actor_name from public.audit_logs a
       left join public.profiles p on p.id = a.actor_id ${where}
      order by a.created_at desc, a.id desc limit ${limit} offset ${offset}`,
    w.params,
  );
  return {
    data: rows.map((r) => ({
      id: Number(r.id),
      actor: r.actor_id ? { id: r.actor_id, fullName: r.actor_name } : null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      metadata: r.metadata ?? {},
      ipAddress: r.ip,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    meta: listMeta(q.page, q.pageSize, total),
  };
}
