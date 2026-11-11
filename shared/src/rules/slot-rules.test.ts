import { describe, expect, it } from 'vitest';
import { collectSlotViolations, validateSlot, type SlotRules } from './slot-rules.js';
import { addDays, buildTimeOptions, campusNow, formatDuration, isValidDate, timeToMinutes } from '../time.js';
import { validateSettingsCrossFields } from './settings-rules.js';

const rules: SlotRules = {
  operatingHoursStart: '08:00',
  operatingHoursEnd: '20:00',
  timeStepMinutes: 15,
  minDurationMinutes: 30,
  maxDurationMinutes: 720,
  maxAdvanceDays: 365,
  minLeadTimeMinutes: 0,
};
const NOW = '2026-11-08T14:45:00';
const code = (date: string, startTime: string, endTime: string, r: SlotRules = rules) =>
  validateSlot({ date, startTime, endTime }, r, NOW)?.code ?? null;

describe('slot rules (BR-04…BR-08)', () => {
  it('accepts a slot at the operating boundaries', () => {
    expect(code('2026-11-20', '08:00', '20:00')).toBeNull();
    expect(code('2026-11-20', '18:00', '20:00')).toBeNull(); // EC-44
  });
  it('rejects misaligned minutes first', () => {
    expect(code('2026-11-20', '10:05', '12:00')).toBe('INVALID_TIME_STEP');
    expect(code('2026-11-20', '10:00', '12:10')).toBe('INVALID_TIME_STEP');
  });
  it('rejects reversed and equal ranges', () => {
    expect(code('2026-11-20', '12:00', '10:00')).toBe('VALIDATION_ERROR');
    expect(code('2026-11-20', '12:00', '12:00')).toBe('VALIDATION_ERROR');
  });
  it('rejects times outside operating hours', () => {
    expect(code('2026-11-20', '07:45', '09:00')).toBe('OUTSIDE_OPERATING_HOURS');
    expect(code('2026-11-20', '19:00', '20:15')).toBe('OUTSIDE_OPERATING_HOURS');
  });
  it('enforces duration limits at min and min − step', () => {
    expect(code('2026-11-20', '10:00', '10:30')).toBeNull();
    expect(code('2026-11-20', '10:00', '10:15')).toBe('DURATION_OUT_OF_RANGE');
    expect(code('2026-11-20', '08:00', '20:00', { ...rules, maxDurationMinutes: 600 })).toBe('DURATION_OUT_OF_RANGE');
  });
  it('rejects past starts and respects lead time', () => {
    expect(code('2026-11-08', '14:45', '15:30')).toBe('BOOKING_IN_PAST');
    expect(code('2026-11-08', '15:00', '15:30')).toBeNull();
    expect(code('2026-11-08', '15:00', '16:00', { ...rules, minLeadTimeMinutes: 120 })).toBe('LEAD_TIME_NOT_MET');
    expect(code('2026-11-08', '16:45', '17:30', { ...rules, minLeadTimeMinutes: 120 })).toBeNull();
  });
  it('enforces the advance window', () => {
    expect(code(addDays('2026-11-08', 365), '10:00', '11:00')).toBeNull();
    expect(code(addDays('2026-11-08', 366), '10:00', '11:00')).toBe('TOO_FAR_IN_ADVANCE');
  });
  it('collects every violation for the live check', () => {
    const all = collectSlotViolations({ date: '2026-11-07', startTime: '07:05', endTime: '07:00' }, rules, NOW);
    expect(all.map((v) => v.code)).toEqual([
      'INVALID_TIME_STEP',
      'VALIDATION_ERROR',
      'OUTSIDE_OPERATING_HOURS',
      'BOOKING_IN_PAST',
    ]);
  });
});

describe('time helpers', () => {
  it('validates real calendar dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
  });
  it('builds time options inclusively', () => {
    expect(buildTimeOptions('08:00', '09:00', 30)).toEqual(['08:00', '08:30', '09:00']);
    expect(timeToMinutes('23:59')).toBe(1439);
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(150)).toBe('2 h 30 min');
  });
  it('computes campus now in a timezone, not UTC', () => {
    const at = Date.UTC(2026, 10, 8, 20, 0, 0); // 20:00Z = 01:30 next day in Kolkata
    expect(campusNow('Asia/Kolkata', 0, at).date).toBe('2026-11-09');
    expect(campusNow('Asia/Kolkata', 0, at).time).toBe('01:30');
  });
});

describe('settings cross-field rules', () => {
  const base = {
    operatingHoursStart: '08:00',
    operatingHoursEnd: '20:00',
    timeStepMinutes: 15,
    minDurationMinutes: 30,
    maxDurationMinutes: 720,
    allowedEmailDomains: ['college.edu'],
  };
  it('accepts defaults', () => expect(validateSettingsCrossFields(base)).toEqual({}));
  it('flags order, alignment, durations and domains', () => {
    const e = validateSettingsCrossFields({
      ...base,
      operatingHoursStart: '08:10',
      operatingHoursEnd: '08:00',
      minDurationMinutes: 40,
      maxDurationMinutes: 35,
      allowedEmailDomains: ['not a domain'],
    });
    expect(Object.keys(e).sort()).toEqual(
      ['allowedEmailDomains', 'maxDurationMinutes', 'minDurationMinutes', 'operatingHoursEnd', 'operatingHoursStart'].sort(),
    );
  });
});
