// Settings row + campus "now" in ONE query (§10.15: "Settings").
import { hhmm, type BookingRules } from '@campushub/shared';
import type { DbClient } from '../db/pool.js';

export interface AppSettings extends BookingRules {
  institutionName: string;
  supportEmail: string | null;
  campusTimezone: string;
  selfRegistrationEnabled: boolean;
  allowedEmailDomains: string[];
  emailNotificationsEnabled: boolean;
  emailDailyLimit: number;
  reminderLeadMinutes: number;
  updatedAt: Date;
  updatedById: string | null;
}

export interface CampusContext {
  settings: AppSettings;
  /** Campus wall-clock now, 'YYYY-MM-DDTHH:mm:ss'. */
  localNow: string;
  today: string;
}

export function mapSettingsRow(r: any): AppSettings {
  return {
    institutionName: r.institution_name,
    supportEmail: r.support_email,
    campusTimezone: r.campus_timezone,
    operatingHoursStart: hhmm(r.operating_hours_start),
    operatingHoursEnd: hhmm(r.operating_hours_end),
    timeStepMinutes: r.time_step_minutes,
    minDurationMinutes: r.min_duration_minutes,
    maxDurationMinutes: r.max_duration_minutes,
    maxAdvanceDays: r.max_advance_days,
    minLeadTimeMinutes: r.min_lead_time_minutes,
    cancellationCutoffMinutes: r.cancellation_cutoff_minutes,
    modificationCutoffMinutes: r.modification_cutoff_minutes,
    maxPendingPerUser: r.max_pending_per_user,
    selfRegistrationEnabled: r.self_registration_enabled,
    allowedEmailDomains: r.allowed_email_domains ?? [],
    emailNotificationsEnabled: r.email_notifications_enabled,
    emailDailyLimit: r.email_daily_limit,
    reminderLeadMinutes: r.reminder_lead_minutes,
    updatedAt: r.updated_at,
    updatedById: r.updated_by,
  };
}

export async function loadCampus(db: DbClient): Promise<CampusContext> {
  const { rows } = await db.query(
    `select s.*, to_char(now() at time zone s.campus_timezone, 'YYYY-MM-DD"T"HH24:MI:SS') as local_now
       from public.app_settings s where s.id = 1`,
  );
  const r = rows[0];
  return { settings: mapSettingsRow(r), localNow: r.local_now, today: String(r.local_now).slice(0, 10) };
}
