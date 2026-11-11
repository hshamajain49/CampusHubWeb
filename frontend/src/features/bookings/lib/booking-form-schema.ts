// Settings-dependent form schema (§9.7): static shapes from @campushub/shared + superRefine with the same
// pure slot rules the API runs, so the user hears about problems before submitting.
import { z } from 'zod';
import { attendeesSchema, cleanText, collectSlotViolations, type BookingRules } from '@campushub/shared';

export function buildBookingFormSchema(rules: BookingRules | undefined, capacity: number | null, localNow: string | null, venueName?: string) {
  return z
    .object({
      venueId: z.string().min(1, 'Choose a venue'),
      date: z.string().min(1, 'Pick a date'),
      startTime: z.string().min(1, 'Pick a start time'),
      endTime: z.string().min(1, 'Pick an end time'),
      purpose: z
        .string()
        .transform(cleanText)
        .pipe(z.string().min(1, 'Please describe the purpose').min(3, 'Purpose must be at least 3 characters.').max(500, 'Purpose must be at most 500 characters.')),
      expectedAttendees: z.union([attendeesSchema, z.null()]),
    })
    .superRefine((v, ctx) => {
      if (rules && localNow && v.date && v.startTime && v.endTime) {
        for (const viol of collectSlotViolations({ date: v.date, startTime: v.startTime, endTime: v.endTime }, rules, localNow)) {
          ctx.addIssue({ code: 'custom', path: [viol.field], message: viol.message });
        }
      }
      if (capacity && v.expectedAttendees && v.expectedAttendees > capacity) {
        ctx.addIssue({ code: 'custom', path: ['expectedAttendees'], message: `${venueName ?? 'This venue'} holds up to ${capacity} people.` });
      }
    });
}

export type BookingFormValues = {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  expectedAttendees: number | null;
};
