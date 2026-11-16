// Settings-dependent form schema (§9.7): static shapes from @campushub/shared + superRefine with the same
// pure slot rules the API runs, so the user hears about problems before submitting.
import { z } from 'zod';
import { attendeesSchema, cleanText, collectSlotViolations, ID_NUMBER_PATTERN, type BookingRules } from '@campushub/shared';

export function buildBookingFormSchema(rules: BookingRules | undefined, capacity: number | null, localNow: string | null, venueName?: string) {
  return z
    .object({
      venueId: z.string().min(1, 'Choose a venue'),
      date: z.string().min(1, 'Pick a date'),
      /** Multi-day booking: the same time on every day from date to endDate (inclusive). */
      multiDay: z.boolean(),
      endDate: z.string(),
      startTime: z.string().min(1, 'Pick a start time'),
      endTime: z.string().min(1, 'Pick an end time'),
      purpose: z
        .string()
        .transform(cleanText)
        .pipe(z.string().min(1, 'Please describe the purpose').min(3, 'Purpose must be at least 3 characters.').max(500, 'Purpose must be at most 500 characters.')),
      expectedAttendees: z.union([attendeesSchema, z.null()]),
      // Same rule as the API (idNumberSchema): stored upper case.
      idNumber: z
        .string()
        .transform((s) => s.trim().toUpperCase())
        .pipe(
          z
            .string()
            .min(1, 'Enter your USN or faculty ID')
            .max(30, 'Use at most 30 characters')
            .regex(ID_NUMBER_PATTERN, 'Use 3–30 letters or digits ("-", "/" and "." are allowed)'),
        ),
    })
    .superRefine((v, ctx) => {
      if (v.multiDay && v.date) {
        if (!v.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Pick the last day' });
        else if (v.endDate <= v.date) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The last day must be after the first day.' });
      }
      const endDate = formEndDate(v);
      if (rules && localNow && v.date && v.startTime && v.endTime) {
        for (const viol of collectSlotViolations({ date: v.date, endDate, startTime: v.startTime, endTime: v.endTime }, rules, localNow)) {
          ctx.addIssue({ code: 'custom', path: [viol.field], message: viol.message });
        }
      }
      if (capacity && v.expectedAttendees && v.expectedAttendees > capacity) {
        ctx.addIssue({ code: 'custom', path: ['expectedAttendees'], message: `${venueName ?? 'This venue'} holds up to ${capacity} people.` });
      }
    });
}

/** The last day the form books, or undefined for a single day. */
export function formEndDate(v: Pick<BookingFormValues, 'date' | 'multiDay' | 'endDate'>): string | undefined {
  return v.multiDay && v.endDate && v.date && v.endDate > v.date ? v.endDate : undefined;
}

export type BookingFormValues = {
  venueId: string;
  date: string;
  multiDay: boolean;
  /** Last day when multiDay is on; '' otherwise. */
  endDate: string;
  startTime: string;
  endTime: string;
  purpose: string;
  expectedAttendees: number | null;
  /** USN (students) or faculty / staff ID. */
  idNumber: string;
};
