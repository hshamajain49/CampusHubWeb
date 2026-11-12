// Scheduled jobs (§10.15 K, §10.20): expire, reminders, delivery retries, housekeeping. Single-flight per process.
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { logger } from '../../lib/logger.js';
import { loadCampus } from '../../domain/settings.js';
import { deliver, publish } from '../notifications/notifier.js';

export type JobTask = 'expire' | 'complaints' | 'reminders' | 'deliveries' | 'housekeeping';
let running = false;
let lastHousekeepingDay: string | null = null;
let lastExpiryAt = 0;

/** K1: pending → expired when the start passes; notifies requesters. */
export async function runExpiry(): Promise<number> {
  lastExpiryAt = Date.now();
  return withTransaction({ actorId: null }, async (tx) => {
    const { rows } = await tx.query<{ booking_id: string }>('select booking_id from public.expire_stale_bookings()');
    for (const r of rows) await publish(tx, { type: 'booking.expired', bookingId: r.booking_id, actorId: null });
    return rows.length;
  });
}

/**
 * Complaint auto-resolve (COMPLAINT_REGISTRATION_SPEC.md CW-07, CB-18): awaiting_confirmation longer than
 * complaint_auto_resolve_days → resolved, actor = system. Replaces the spec's pg_cron job.
 */
export async function runComplaintAutoResolve(): Promise<number> {
  return withTransaction({ actorId: null }, async (tx) => {
    const { rows } = await tx.query<{ n: number }>('select public.auto_resolve_complaints() as n');
    return rows[0]!.n;
  });
}

/** K2 (opportunistic): at most once a minute while the API serves authenticated requests. */
export function maybeRunExpiry(): void {
  if (running || Date.now() - lastExpiryAt < 60_000) return;
  lastExpiryAt = Date.now();
  runExpiry().catch((err) => logger.warn({ err }, 'opportunistic expiry failed'));
  runComplaintAutoResolve().catch((err) => logger.warn({ err }, 'opportunistic complaint auto-resolve failed'));
}

async function runReminders(): Promise<number> {
  return withTransaction({ actorId: null }, async (tx) => {
    const { settings, localNow } = await loadCampus(tx);
    if (settings.reminderLeadMinutes <= 0) return 0;
    const { rows } = await tx.query<{ id: string }>(
      `select b.id from public.bookings b
        where b.status = 'approved'
          and (b.booking_date + b.start_time) > $1::timestamp
          and (b.booking_date + b.start_time) <= $1::timestamp + make_interval(mins => $2)
          and not exists (select 1 from public.booking_reminders r where r.booking_id = b.id)
        for update of b skip locked`,
      [localNow.replace('T', ' '), settings.reminderLeadMinutes],
    );
    for (const r of rows) {
      await tx.query('insert into public.booking_reminders (booking_id) values ($1) on conflict do nothing', [r.id]);
      await publish(tx, { type: 'booking.reminder', bookingId: r.id, actorId: null });
    }
    return rows.length;
  });
}

async function runDeliveryRetries(): Promise<number> {
  await pool.query(
    `update public.notifications set email_status = 'pending' where email_status = 'sending' and channel_updated_at < now() - interval '5 minutes';
     update public.notifications set push_status = 'pending' where push_status = 'sending' and channel_updated_at < now() - interval '5 minutes';`,
  );
  const { rows } = await pool.query<{ id: string }>(
    `select id from public.notifications
      where created_at < now() - interval '2 minutes' and created_at > now() - interval '24 hours'
        and ((email_status = 'pending' and email_attempts < 3) or (push_status = 'pending' and push_attempts < 3))
      order by created_at limit 200`,
  );
  if (!rows.length) return 0;
  await deliver(rows.map((r) => r.id));
  return rows.length;
}

async function runHousekeeping(): Promise<boolean> {
  const { today, localNow } = await loadCampus(pool);
  if (lastHousekeepingDay === today || localNow.slice(11, 16) < '03:00') return false;
  lastHousekeepingDay = today;
  await pool.query(`delete from public.notifications where created_at < now() - interval '180 days'`);
  await pool.query(`delete from public.email_log where created_at < now() - interval '90 days'`);
  await pool.query('delete from public.auth_verifications where expires_at < now()');
  await pool.query('delete from public.auth_sessions where expires_at < now()');
  return true;
}

export async function runJobs(tasks: JobTask[]) {
  if (running) return { skipped: true };
  running = true;
  const started = Date.now();
  const out = { expired: 0, complaintsAutoResolved: 0, reminders: 0, deliveriesRetried: 0, housekeeping: false, durationMs: 0 };
  try {
    if (tasks.includes('expire')) out.expired = await runExpiry();
    if (tasks.includes('complaints')) out.complaintsAutoResolved = await runComplaintAutoResolve();
    if (tasks.includes('reminders')) out.reminders = await runReminders();
    if (tasks.includes('deliveries')) out.deliveriesRetried = await runDeliveryRetries();
    if (tasks.includes('housekeeping')) out.housekeeping = await runHousekeeping();
  } finally {
    running = false;
  }
  out.durationMs = Date.now() - started;
  logger.info(out, 'scheduled jobs ran');
  return out;
}
