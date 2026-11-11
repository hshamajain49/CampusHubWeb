// FT-FORM-01/02/04/05: the client runs the same slot rules as the API and reports them per field.
import { describe, expect, it } from 'vitest';
import type { BookingRules } from '@campushub/shared';
import { buildBookingFormSchema } from './booking-form-schema';

const rules: BookingRules = {
  operatingHoursStart: '08:00',
  operatingHoursEnd: '20:00',
  timeStepMinutes: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 480,
  maxAdvanceDays: 90,
  minLeadTimeMinutes: 60,
  cancellationCutoffMinutes: 60,
  modificationCutoffMinutes: 120,
  maxPendingPerUser: 5,
};
const now = '2026-11-09T09:00:00';
const base = { venueId: 'v1', date: '2026-11-12', startTime: '10:00', endTime: '12:00', purpose: 'Robotics club meet', expectedAttendees: 40 };

function errors(values: Partial<typeof base> & Record<string, unknown>, capacity = 60) {
  const r = buildBookingFormSchema(rules, capacity, now, 'Seminar Hall A').safeParse({ ...base, ...values });
  if (r.success) return {};
  // First issue per field, as zodResolver shows it.
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[i.path.join('.')] ??= i.message;
  return out;
}

describe('booking form schema', () => {
  it('accepts a valid request', () => {
    expect(errors({})).toEqual({});
  });

  it('requires purpose, date and times', () => {
    const e = errors({ purpose: '  ', date: '', startTime: '', endTime: '' });
    expect(e).toMatchObject({ purpose: 'Please describe the purpose', date: 'Pick a date', startTime: 'Pick a start time' });
  });

  it('rejects an end before the start', () => {
    expect(errors({ startTime: '12:00', endTime: '11:00' }).endTime).toBe('End time must be after start time');
  });

  it('enforces operating hours, step and duration', () => {
    expect(errors({ startTime: '07:00', endTime: '09:00' }).startTime).toMatch(/between 08:00 and 20:00|operating hours/i);
    expect(errors({ startTime: '10:15', endTime: '11:00' }).startTime).toBe('Times must be in 30-minute steps.');
    expect(errors({ startTime: '08:00', endTime: '17:00' })).toHaveProperty('endTime');
  });

  it('refuses starts inside the lead time and beyond the advance window', () => {
    expect(errors({ date: '2026-11-09', startTime: '09:30', endTime: '10:30' }).startTime).toMatch(/at least 1 h|at least 1 hour/);
    expect(errors({ date: '2027-03-01' }).date).toBe('You can book up to 90 days ahead.');
  });

  it('caps attendees at the venue capacity', () => {
    expect(errors({ expectedAttendees: 61 }).expectedAttendees).toBe('Seminar Hall A holds up to 60 people.');
  });
});
