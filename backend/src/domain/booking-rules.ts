// Server-side wrappers around the shared slot rules + cut-offs (§17.3–§17.6).
import {
  formatDuration,
  localDateTimeToMinutes,
  toLocalDateTime,
  validateSlot,
  type SlotInput,
  type SlotRules,
} from '@campushub/shared';
import { appError, fieldError } from '../errors/app-error.js';
import type { AppSettings } from './settings.js';

export function slotRulesOf(s: AppSettings): SlotRules {
  return {
    operatingHoursStart: s.operatingHoursStart,
    operatingHoursEnd: s.operatingHoursEnd,
    timeStepMinutes: s.timeStepMinutes,
    minDurationMinutes: s.minDurationMinutes,
    maxDurationMinutes: s.maxDurationMinutes,
    maxAdvanceDays: s.maxAdvanceDays,
    minLeadTimeMinutes: s.minLeadTimeMinutes,
  };
}

/** Throws the first failing rule (a–g), exactly like §10.15 A.5. */
export function assertSlot(input: SlotInput, s: AppSettings, localNow: string): void {
  const v = validateSlot(input, slotRulesOf(s), localNow);
  if (!v) return;
  if (v.code === 'VALIDATION_ERROR') throw fieldError(v.field, v.message);
  throw appError(v.code, v.message, { field: v.field });
}

export function startLdt(date: string, startTime: string): string {
  return toLocalDateTime(date, startTime);
}

/** Minutes from campus now until a LocalDateTime (negative when in the past). */
export function minutesUntil(ldt: string, localNow: string): number {
  return localDateTimeToMinutes(ldt) - localDateTimeToMinutes(localNow);
}

export function cancellationClosedMessage(cutoff: number): string {
  return cutoff === 0
    ? "Bookings can't be cancelled after they have started."
    : `Bookings can't be cancelled less than ${formatDuration(cutoff)} before the start.`;
}

export function modificationClosedMessage(cutoff: number): string {
  return cutoff === 0
    ? "Bookings can't be changed after they have started."
    : `Bookings can't be changed less than ${formatDuration(cutoff)} before they start.`;
}
