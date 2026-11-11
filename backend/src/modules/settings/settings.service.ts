// Settings: public (E01), admin read (E45) and update (E46) with merged cross-field validation.
import {
  campusNow,
  validateSettingsCrossFields,
  type PublicSettings,
  type Settings,
  type SettingsUpdateBody,
} from '@campushub/shared';
import { config, integrations } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { validationError } from '../../errors/app-error.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus, mapSettingsRow, type AppSettings } from '../../domain/settings.js';
import { realtimeEnabled } from '../../lib/realtime.js';
import { audit } from '../audit/audit-writer.js';

function rulesOf(s: AppSettings) {
  return {
    operatingHoursStart: s.operatingHoursStart,
    operatingHoursEnd: s.operatingHoursEnd,
    timeStepMinutes: s.timeStepMinutes,
    minDurationMinutes: s.minDurationMinutes,
    maxDurationMinutes: s.maxDurationMinutes,
    maxAdvanceDays: s.maxAdvanceDays,
    minLeadTimeMinutes: s.minLeadTimeMinutes,
    cancellationCutoffMinutes: s.cancellationCutoffMinutes,
    modificationCutoffMinutes: s.modificationCutoffMinutes,
    maxPendingPerUser: s.maxPendingPerUser,
  };
}

export async function publicSettings(): Promise<PublicSettings> {
  const { settings: s } = await loadCampus(pool);
  const now = campusNow(s.campusTimezone);
  return {
    institutionName: s.institutionName,
    supportEmail: s.supportEmail,
    campusTimezone: s.campusTimezone,
    selfRegistrationEnabled: s.selfRegistrationEnabled,
    allowedEmailDomains: s.allowedEmailDomains,
    bookingRules: rulesOf(s),
    serverTime: { date: now.date, time: now.time, timestamp: new Date().toISOString() },
    pushPublicKey: integrations.push === 'configured' ? config.VAPID_PUBLIC_KEY! : null,
    realtimeEnabled,
  };
}

export async function adminSettings(): Promise<Settings> {
  const { rows } = await pool.query(
    `select s.*, u.full_name as updated_by_name,
            (select count(*) from public.email_log e where e.kind = 'notification' and e.status = 'sent'
               and e.created_at >= (date_trunc('day', now() at time zone s.campus_timezone) at time zone s.campus_timezone)) as sent_today,
            (select count(*) from public.email_log e where e.status like 'skipped%'
               and e.created_at >= (date_trunc('day', now() at time zone s.campus_timezone) at time zone s.campus_timezone)) as skipped_today,
            (select count(*) from public.email_log e where e.kind = 'auth' and e.status = 'sent'
               and e.created_at >= (date_trunc('day', now() at time zone s.campus_timezone) at time zone s.campus_timezone)) as auth_today
       from public.app_settings s left join public.profiles u on u.id = s.updated_by where s.id = 1`,
  );
  const r = rows[0];
  const s = mapSettingsRow(r);
  return {
    ...rulesOf(s),
    institutionName: s.institutionName,
    supportEmail: s.supportEmail,
    campusTimezone: s.campusTimezone,
    selfRegistrationEnabled: s.selfRegistrationEnabled,
    allowedEmailDomains: s.allowedEmailDomains,
    emailNotificationsEnabled: s.emailNotificationsEnabled,
    emailDailyLimit: s.emailDailyLimit,
    reminderLeadMinutes: s.reminderLeadMinutes,
    emailUsageToday: { sent: r.sent_today, skipped: r.skipped_today, authSent: r.auth_today },
    channels: { email: integrations.email, push: integrations.push, realtime: integrations.realtime, images: integrations.images },
    updatedAt: new Date(s.updatedAt).toISOString(),
    updatedBy: s.updatedById ? { id: s.updatedById, fullName: r.updated_by_name } : null,
  };
}

const COLUMN: Record<string, string> = {
  institutionName: 'institution_name',
  supportEmail: 'support_email',
  operatingHoursStart: 'operating_hours_start',
  operatingHoursEnd: 'operating_hours_end',
  timeStepMinutes: 'time_step_minutes',
  minDurationMinutes: 'min_duration_minutes',
  maxDurationMinutes: 'max_duration_minutes',
  maxAdvanceDays: 'max_advance_days',
  minLeadTimeMinutes: 'min_lead_time_minutes',
  cancellationCutoffMinutes: 'cancellation_cutoff_minutes',
  modificationCutoffMinutes: 'modification_cutoff_minutes',
  maxPendingPerUser: 'max_pending_per_user',
  selfRegistrationEnabled: 'self_registration_enabled',
  allowedEmailDomains: 'allowed_email_domains',
  emailNotificationsEnabled: 'email_notifications_enabled',
  emailDailyLimit: 'email_daily_limit',
  reminderLeadMinutes: 'reminder_lead_minutes',
};

export async function updateSettings(actor: Actor, body: SettingsUpdateBody): Promise<Settings> {
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const cur = mapSettingsRow((await tx.query('select * from public.app_settings where id = 1 for update')).rows[0]);
    const merged = { ...cur, ...body } as AppSettings;
    const errors = validateSettingsCrossFields(merged);
    if (Object.keys(errors).length) throw validationError(errors);

    const sets: string[] = [];
    const params: unknown[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || !COLUMN[key]) continue;
      const old = (cur as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(old) === JSON.stringify(value)) continue;
      params.push(value);
      sets.push(`${COLUMN[key]} = $${params.length}`);
      before[key] = old;
      after[key] = value;
    }
    if (!sets.length) return;
    params.push(actor.id);
    await tx.query(`update public.app_settings set ${sets.join(', ')}, updated_by = $${params.length} where id = 1`, params);
    await audit(tx, actor, { action: 'settings.updated', entityType: 'settings', entityId: '1', summary: `Updated ${Object.keys(after).join(', ')}`, metadata: { before, after } });
  });
  return adminSettings();
}
