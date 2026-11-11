// Notifier (§10.9, §10.18): rows are written in the booking's transaction; delivery runs after commit.
import { config, integrations } from '../../config/env.js';
import type { Tx } from '../../db/transaction.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { pushEnabled, pushSender } from '../../lib/push.js';
import { publish as realtimePublish } from '../../lib/realtime.js';
import { logSkippedEmail, sendEmail } from '../../lib/email/email-service.js';
import { renderNotificationEmail } from '../../lib/email/templates.js';
import { dayMonth, relativeDay } from '../../lib/format.js';
import { planNotifications, type DomainEvent } from './matrix.js';

export type { DomainEvent } from './matrix.js';

interface Hint {
  requesterId: string;
  bookingId: string;
  status: string;
  venueId: string;
}

/**
 * "Publish X" (§10.15): record notification rows as the last step inside the transaction,
 * then deliver after a successful commit. A notification exists iff the change committed.
 */
export async function publish(tx: Tx, event: DomainEvent): Promise<string[]> {
  const { rows } = await tx.query(
    `select b.id, b.reference, b.venue_id, b.requester_id, b.status, b.booking_date as date,
            to_char(b.start_time, 'HH24:MI') as start_time, to_char(b.end_time, 'HH24:MI') as end_time,
            v.name as venue_name, p.full_name as requester_name,
            s.email_notifications_enabled, to_char(now() at time zone s.campus_timezone, 'YYYY-MM-DD') as today
       from public.bookings b
       join public.venues v on v.id = b.venue_id
       join public.profiles p on p.id = b.requester_id
       cross join public.app_settings s
      where b.id = $1 and s.id = 1`,
    [event.bookingId],
  );
  const b = rows[0];
  if (!b) return [];
  const hint: Hint = { requesterId: b.requester_id, bookingId: b.id, status: b.status, venueId: b.venue_id };

  const plans = planNotifications(
    event,
    {
      id: b.id,
      reference: b.reference,
      venueName: b.venue_name,
      requesterName: b.requester_name,
      date: b.date,
      startTime: b.start_time,
      endTime: b.end_time,
    },
    b.today,
  );

  const ids: string[] = [];
  for (const plan of plans) {
    const recipients = await tx.query(
      plan.audience === 'admins'
        ? `select p.id, p.email_notifications,
                  exists (select 1 from public.push_subscriptions s where s.user_id = p.id) as has_push
             from public.profiles p where p.role = 'super_admin' and p.is_active`
        : `select p.id, p.email_notifications,
                  exists (select 1 from public.push_subscriptions s where s.user_id = p.id) as has_push
             from public.profiles p where p.id = $1 and p.is_active`,
      plan.audience === 'admins' ? [] : [b.requester_id],
    );
    for (const r of recipients.rows) {
      if (r.id === event.actorId) continue;
      const emailStatus = plan.email && b.email_notifications_enabled && r.email_notifications ? 'pending' : 'none';
      const pushStatus = plan.push && pushEnabled && r.has_push ? 'pending' : 'none';
      const linkPath = plan.audience === 'admins' ? `/admin/bookings/${b.id}` : `/bookings/${b.id}`;
      const ins = await tx.query<{ id: string }>(
        `insert into public.notifications (recipient_id, type, title, body, booking_id, link_path, email_status, push_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [r.id, plan.type, plan.title, plan.body, b.id, linkPath, emailStatus, pushStatus],
      );
      ids.push(ins.rows[0]!.id);
    }
  }

  tx.afterCommit(() => deliver(ids, { hints: [hint], initial: true }));
  return ids;
}

/** Fire-and-forget delivery for code paths outside a transaction. */
export function deliverSoon(ids: string[]): void {
  void deliver(ids, { initial: true }).catch((err) => logger.error({ err }, 'notification delivery failed'));
}

/**
 * Claims each channel (pending → sending) so an immediate delivery and a job retry never send twice.
 * Returns the number of channel deliveries attempted.
 */
export async function deliver(ids: string[], opts: { hints?: Hint[]; initial?: boolean } = {}): Promise<number> {
  for (const h of opts.hints ?? []) {
    void realtimePublish(`user:${h.requesterId}`, 'booking.updated', { bookingId: h.bookingId, status: h.status });
    void realtimePublish('admins', 'bookings.changed', { bookingId: h.bookingId, status: h.status, venueId: h.venueId });
  }
  if (!ids.length) return 0;

  const emailClaim = await pool.query<{ id: string }>(
    `update public.notifications set email_status = 'sending', channel_updated_at = now()
      where id = any($1::uuid[]) and email_status = 'pending' returning id`,
    [ids],
  );
  const pushClaim = await pool.query<{ id: string }>(
    `update public.notifications set push_status = 'sending', channel_updated_at = now()
      where id = any($1::uuid[]) and push_status = 'pending' returning id`,
    [ids],
  );
  const emailIds = new Set(emailClaim.rows.map((r) => r.id));
  const pushIds = new Set(pushClaim.rows.map((r) => r.id));

  const { rows } = await pool.query(
    `select n.*, p.email, p.full_name, s.institution_name, s.email_daily_limit, s.campus_timezone,
            b.reference, b.booking_date as date, to_char(b.start_time, 'HH24:MI') as start_time,
            v.name as venue_name, rq.full_name as requester_name,
            to_char(now() at time zone s.campus_timezone, 'YYYY-MM-DD') as today
       from public.notifications n
       join public.profiles p on p.id = n.recipient_id
       cross join public.app_settings s
       left join public.bookings b on b.id = n.booking_id
       left join public.venues v on v.id = b.venue_id
       left join public.profiles rq on rq.id = b.requester_id
      where n.id = any($1::uuid[]) and s.id = 1`,
    [ids],
  );

  let attempts = 0;
  for (const n of rows) {
    if (opts.initial) {
      void realtimePublish(`user:${n.recipient_id}`, 'notification.created', {
        id: n.id,
        type: n.type,
        title: n.title,
        linkPath: n.link_path,
        bookingId: n.booking_id,
      });
    }

    if (pushIds.has(n.id)) {
      attempts++;
      await deliverPush(n);
    }
    if (emailIds.has(n.id)) {
      attempts++;
      await deliverEmail(n);
    }
  }
  return attempts;
}

async function deliverPush(n: any) {
  const subs = await pool.query('select * from public.push_subscriptions where user_id = $1', [n.recipient_id]);
  let ok = 0;
  let live = subs.rows.length;
  for (const sub of subs.rows) {
    const r = await pushSender.send(
      sub,
      { title: n.title, body: n.body, url: `${config.FRONTEND_URL}${n.link_path ?? '/'}`, tag: `booking-${n.booking_id}` },
      n.type === 'booking_reminder' ? 'high' : 'normal',
    );
    if (r.ok) {
      ok++;
      await pool.query('update public.push_subscriptions set last_success_at = now() where id = $1', [sub.id]);
    } else if (r.gone) {
      live--;
      await pool.query('delete from public.push_subscriptions where id = $1', [sub.id]);
    }
  }
  const status = ok > 0 ? 'sent' : live === 0 ? 'skipped' : n.push_attempts + 1 >= 3 ? 'failed' : 'pending';
  await pool.query(
    `update public.notifications set push_status = $2, push_attempts = push_attempts + $3, channel_updated_at = now() where id = $1`,
    [n.id, status, status === 'sent' || status === 'skipped' ? 0 : 1],
  );
}

async function deliverEmail(n: any) {
  const quota = await pool.query<{ count: number }>(
    `select count(*) as count from public.email_log
      where kind = 'notification' and status = 'sent'
        and created_at >= (date_trunc('day', now() at time zone $1) at time zone $1)`,
    [n.campus_timezone],
  );
  if (quota.rows[0]!.count >= n.email_daily_limit) {
    await logSkippedEmail(n.type, n.recipient_id, n.id, 'skipped_quota');
    await pool.query(`update public.notifications set email_status = 'skipped', channel_updated_at = now() where id = $1`, [n.id]);
    return;
  }
  const rendered = renderNotificationEmail({
    institutionName: n.institution_name,
    type: n.type,
    title: n.title,
    body: n.body,
    url: `${config.FRONTEND_URL}${n.link_path ?? '/'}`,
    venue: n.venue_name ?? 'Venue',
    dayMonth: n.date ? dayMonth(n.date) : '',
    time: n.start_time ?? '',
    relativeDay: n.date ? relativeDay(n.date, n.today) : '',
    reference: n.reference ?? '',
    requester: n.requester_name ?? '',
  });
  const result = await sendEmail({
    kind: 'notification',
    template: n.type,
    recipientId: n.recipient_id,
    notificationId: n.id,
    to: { email: n.email, name: n.full_name },
    ...rendered,
  });
  const status = result.ok ? 'sent' : n.email_attempts + 1 >= 3 ? 'failed' : 'pending';
  await pool.query(
    `update public.notifications set email_status = $2, email_attempts = email_attempts + $3, channel_updated_at = now() where id = $1`,
    [n.id, status, result.ok ? 0 : 1],
  );
}

export const notifierChannels = integrations;
