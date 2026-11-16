// Booking slot rules BR-04…BR-08 (§17.3), evaluated in the order of §10.15 A.5.
// Pure: `now` and `rules` are injected, so the SPA and the API run exactly the same checks.

import {
  addDays,
  durationMinutes,
  formatDuration,
  isAligned,
  localDateTimeToMinutes,
  timeToMinutes,
  toLocalDateTime,
} from '../time.js';

export interface SlotRules {
  operatingHoursStart: string;
  operatingHoursEnd: string;
  timeStepMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  minLeadTimeMinutes: number;
}

export interface SlotInput {
  /** First day (and the only one for a single-day booking). */
  date: string;
  /** Last day of a multi-day booking: the same time window repeats every day from date to endDate. */
  endDate?: string | null;
  startTime: string;
  endTime: string;
}

/** Most consecutive days one booking may cover (mirrors bookings_max_days). */
export const MAX_BOOKING_DAYS = 14;

/** Number of days covered by date..endDate (1 for a single-day booking). */
export function bookingDays(date: string, endDate?: string | null): number {
  if (!endDate || endDate <= date) return 1;
  let n = 1;
  let d = date;
  while (d < endDate && n <= 400) {
    d = addDays(d, 1);
    n++;
  }
  return n;
}

export type SlotViolationCode =
  | 'INVALID_TIME_STEP'
  | 'VALIDATION_ERROR'
  | 'OUTSIDE_OPERATING_HOURS'
  | 'DURATION_OUT_OF_RANGE'
  | 'BOOKING_IN_PAST'
  | 'LEAD_TIME_NOT_MET'
  | 'TOO_FAR_IN_ADVANCE'
  | 'TOO_MANY_DAYS';

export interface SlotViolation {
  code: SlotViolationCode;
  field: 'date' | 'endDate' | 'startTime' | 'endTime';
  message: string;
}

/** Campus now as 'YYYY-MM-DDTHH:mm:ss'. */
export type LocalNow = string;

export function collectSlotViolations(input: SlotInput, rules: SlotRules, now: LocalNow): SlotViolation[] {
  const out: SlotViolation[] = [];
  const { date, startTime, endTime } = input;
  const step = rules.timeStepMinutes;

  // a. step alignment
  if (!isAligned(startTime, step)) {
    out.push({ code: 'INVALID_TIME_STEP', field: 'startTime', message: `Times must be in ${step}-minute steps.` });
  } else if (!isAligned(endTime, step)) {
    out.push({ code: 'INVALID_TIME_STEP', field: 'endTime', message: `Times must be in ${step}-minute steps.` });
  }

  // b. order
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (endMin <= startMin) {
    out.push({ code: 'VALIDATION_ERROR', field: 'endTime', message: 'End time must be after start time' });
  }

  // c. operating hours
  const open = timeToMinutes(rules.operatingHoursStart);
  const close = timeToMinutes(rules.operatingHoursEnd);
  const hoursMsg = `Bookings must be between ${rules.operatingHoursStart} and ${rules.operatingHoursEnd}.`;
  if (startMin < open || startMin >= close) {
    out.push({ code: 'OUTSIDE_OPERATING_HOURS', field: 'startTime', message: hoursMsg });
  } else if (endMin > close) {
    out.push({ code: 'OUTSIDE_OPERATING_HOURS', field: 'endTime', message: hoursMsg });
  }

  // d. duration
  if (endMin > startMin) {
    const d = durationMinutes(startTime, endTime);
    if (d < rules.minDurationMinutes || d > rules.maxDurationMinutes) {
      out.push({
        code: 'DURATION_OUT_OF_RANGE',
        field: 'endTime',
        message: `Bookings must be between ${formatDuration(rules.minDurationMinutes)} and ${formatDuration(rules.maxDurationMinutes)} long.`,
      });
    }
  }

  // e/f. past and lead time
  const startAt = localDateTimeToMinutes(toLocalDateTime(date, startTime));
  const nowAt = localDateTimeToMinutes(now);
  if (startAt <= nowAt) {
    out.push({ code: 'BOOKING_IN_PAST', field: 'startTime', message: 'The start time has already passed.' });
  } else if (startAt < nowAt + rules.minLeadTimeMinutes) {
    out.push({
      code: 'LEAD_TIME_NOT_MET',
      field: 'startTime',
      message: `Bookings must start at least ${formatDuration(rules.minLeadTimeMinutes)} from now.`,
    });
  }

  // g. advance window
  const today = now.slice(0, 10);
  if (date > addDays(today, rules.maxAdvanceDays)) {
    out.push({
      code: 'TOO_FAR_IN_ADVANCE',
      field: 'date',
      message: `You can book up to ${rules.maxAdvanceDays} days ahead.`,
    });
  }

  // h. multi-day range: consecutive days, at most MAX_BOOKING_DAYS, inside the advance window
  const endDate = input.endDate;
  if (endDate && endDate !== date) {
    if (endDate < date) {
      out.push({ code: 'VALIDATION_ERROR', field: 'endDate', message: 'The end date must be on or after the start date.' });
    } else if (bookingDays(date, endDate) > MAX_BOOKING_DAYS) {
      out.push({ code: 'TOO_MANY_DAYS', field: 'endDate', message: `A booking can cover at most ${MAX_BOOKING_DAYS} days.` });
    } else if (endDate > addDays(today, rules.maxAdvanceDays)) {
      out.push({
        code: 'TOO_FAR_IN_ADVANCE',
        field: 'endDate',
        message: `You can book up to ${rules.maxAdvanceDays} days ahead.`,
      });
    }
  }

  return out;
}

/** First failing rule in the order a–g, or null. */
export function validateSlot(input: SlotInput, rules: SlotRules, now: LocalNow): SlotViolation | null {
  return collectSlotViolations(input, rules, now)[0] ?? null;
}

/** "Bookings can't be cancelled less than 2 h before they start." helpers share this wording. */
export function cutoffPhrase(minutes: number): string {
  return formatDuration(minutes);
}
