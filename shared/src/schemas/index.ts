// Request schemas for every endpoint (§15). Bodies are strict: unknown keys are rejected.
import { z } from 'zod';
import { BLOCK_TYPES, BOOKING_STATUSES, MEMBER_ROLES, REMINDER_LEADS, ROLES, TIME_STEPS, VENUE_TYPES } from '../enums.js';
import {
  boolFromQuery,
  csvOf,
  csvStrings,
  emailSchema,
  timeSchema,
  intFromQuery,
  isoDate,
  localDateTime,
  pagination,
  searchQ,
  sortParam,
  text,
  trimmed,
  uuid,
} from './common.js';
import { diffDays, localDateTimeToMinutes, timeToMinutes } from '../time.js';

export * from './common.js';

function requireOne<T extends z.ZodTypeAny>(schema: T, keys: string[], message = 'Provide at least one field to change.') {
  return schema.refine((v) => keys.some((k) => (v as Record<string, unknown>)[k] !== undefined), { message });
}

// ───────────────────────────── Auth / me ─────────────────────────────
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include a letter and a number';

export const passwordSchema = z
  .string()
  .min(8, PASSWORD_POLICY_MESSAGE)
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/\d/, PASSWORD_POLICY_MESSAGE);

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .min(2, 'Name must be 2–100 characters')
  .max(100, 'Name must be 2–100 characters');

export const departmentSchema = z
  .string()
  .trim()
  .min(2, 'Department must be 2–100 characters')
  .max(100, 'Department must be 2–100 characters');

const optionalDepartment = z
  .union([departmentSchema, z.literal('').transform(() => null), z.null()])
  .optional();

export const registerBody = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  department: optionalDepartment,
});

export const changePasswordBody = z
  .strictObject({
    currentPassword: z.string().min(1, 'Current password is required').max(72),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different',
    path: ['newPassword'],
  });

export const updateMeBody = requireOne(
  z.strictObject({
    fullName: fullNameSchema.optional(),
    department: optionalDepartment,
    emailNotifications: z.boolean().optional(),
  }),
  ['fullName', 'department', 'emailNotifications'],
);

export const pushSubscriptionBody = z.strictObject({
  endpoint: z.string().max(1000).regex(/^https:\/\//, 'Endpoint must use https'),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export const pushUnsubscribeBody = z.strictObject({
  endpoint: z.string().min(1).max(1000),
});

export const notificationsQuery = z.object({
  unreadOnly: boolFromQuery.default(false),
  ...pagination(20, 50),
});

// ───────────────────────────── Venues ─────────────────────────────
export const venueTypeSchema = z.enum(VENUE_TYPES);
const amenitySchema = z.string().trim().min(1, 'Amenities must be 1–40 characters').max(40, 'Amenities must be 1–40 characters');

export const venueListQuery = z
  .object({
    q: searchQ.optional(),
    type: venueTypeSchema.optional(),
    minCapacity: intFromQuery(1, 100_000).optional(),
    amenities: csvStrings(40).optional(),
    availableDate: isoDate.optional(),
    availableStart: timeSchema.optional(),
    availableEnd: timeSchema.optional(),
    sort: sortParam(['name:asc', 'capacity:asc', 'capacity:desc']).default('name:asc'),
    ...pagination(12, 50),
  })
  .refine(
    (v) => {
      const n = [v.availableDate, v.availableStart, v.availableEnd].filter(Boolean).length;
      return n === 0 || n === 3;
    },
    { message: 'Pick a date, start and end to filter by availability', path: ['availableDate'] },
  )
  .refine((v) => !v.availableStart || !v.availableEnd || timeToMinutes(v.availableEnd) > timeToMinutes(v.availableStart), {
    message: 'End time must be after start time',
    path: ['availableEnd'],
  });

const venueFields = {
  name: trimmed(2, 120, 'Name must be 2–120 characters'),
  venueType: venueTypeSchema,
  building: trimmed(1, 120, 'Building must be at most 120 characters'),
  locationDetails: z
    .union([z.string().trim().max(200, 'Location must be at most 200 characters'), z.null()])
    .transform((v) => (v === '' ? null : v)),
  capacity: z
    .number({ message: 'Enter a whole number between 1 and 100,000' })
    .int('Enter a whole number between 1 and 100,000')
    .min(1, 'Enter a whole number between 1 and 100,000')
    .max(100_000, 'Enter a whole number between 1 and 100,000'),
  description: text(1, 2000, 'Description'),
  amenities: z
    .array(amenitySchema)
    .max(20, 'Add at most 20 amenities')
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((a) => {
        const k = a.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }),
};

export const venueCreateBody = z.strictObject({
  ...venueFields,
  venueType: venueTypeSchema.default('other'),
  locationDetails: venueFields.locationDetails.optional().default(null),
  amenities: venueFields.amenities.default([]),
});

export const venueUpdateBody = requireOne(
  z.strictObject({
    name: venueFields.name.optional(),
    venueType: venueFields.venueType.optional(),
    building: venueFields.building.optional(),
    locationDetails: venueFields.locationDetails.optional(),
    capacity: venueFields.capacity.optional(),
    description: venueFields.description.optional(),
    amenities: venueFields.amenities.optional(),
  }),
  ['name', 'venueType', 'building', 'locationDetails', 'capacity', 'description', 'amenities'],
);

export const availabilityQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((v) => !v.from || !v.to || (diffDays(v.to, v.from) >= 0 && diffDays(v.to, v.from) <= 62), {
    message: 'The range must be 0–62 days',
    path: ['to'],
  });

export const availabilityCheckQuery = z.object({
  date: isoDate,
  startTime: timeSchema,
  endTime: timeSchema,
  excludeBookingId: uuid.optional(),
});

// ───────────────────────────── Bookings ─────────────────────────────
export const purposeSchema = text(3, 500, 'Purpose');
export const attendeesSchema = z
  .number({ message: 'Enter a whole number' })
  .int('Enter a whole number')
  .min(1, 'Enter at least 1')
  .max(100_000, 'Enter at most 100,000');

export const bookingCreateBody = z.strictObject({
  venueId: uuid,
  date: isoDate,
  startTime: timeSchema,
  endTime: timeSchema,
  purpose: purposeSchema,
  expectedAttendees: attendeesSchema.nullable().optional(),
});

export const bookingUpdateBody = requireOne(
  z.strictObject({
    purpose: purposeSchema.optional(),
    date: isoDate.optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    expectedAttendees: attendeesSchema.nullable().optional(),
    version: z.number().int().min(1),
  }),
  ['purpose', 'date', 'startTime', 'endTime', 'expectedAttendees'],
);

export const bookingCancelBody = z.strictObject({
  reason: z.string().transform((s) => s.trim()).pipe(z.string().max(500, 'Reason must be at most 500 characters')).optional(),
  version: z.number().int().min(1).optional(),
});

export const bookingStatusSchema = z.enum(BOOKING_STATUSES);

export const myBookingsQuery = z.object({
  scope: z.enum(['upcoming', 'history', 'all']).default('upcoming'),
  status: csvOf(BOOKING_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: sortParam(['start:asc', 'start:desc']).optional(),
  ...pagination(20, 100),
});

// ───────────────────────────── Admin bookings ─────────────────────────────
const adminBookingFilters = {
  status: csvOf(BOOKING_STATUSES).optional(),
  venueId: uuid.optional(),
  requesterId: uuid.optional(),
  role: z.enum(MEMBER_ROLES).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  q: searchQ.optional(),
};

export const adminBookingsQuery = z.object({
  ...adminBookingFilters,
  sort: sortParam(['createdAt:desc', 'createdAt:asc', 'start:asc', 'start:desc']).default('createdAt:desc'),
  ...pagination(20, 100),
});

export const adminExportQuery = z.object(adminBookingFilters);

export const reasonSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(3, 'Please provide a reason').max(500, 'Reason must be at most 500 characters'));

export const approveBody = z.strictObject({
  version: z.number().int().min(1),
  note: z.string().transform((s) => s.trim()).pipe(z.string().max(500)).optional(),
});

export const rejectBody = z.strictObject({ version: z.number().int().min(1), reason: reasonSchema });

export const adminCancelBody = z.strictObject({ reason: reasonSchema, version: z.number().int().min(1).optional() });

export const calendarQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    venueId: uuid.optional(),
    statuses: csvOf(['pending', 'approved']).default(['pending', 'approved']),
    includeBlocks: boolFromQuery.default(true),
  })
  .refine((v) => diffDays(v.to, v.from) >= 0 && diffDays(v.to, v.from) <= 92, {
    message: 'The range must be 0–92 days',
    path: ['to'],
  });

// ───────────────────────────── Venue blocks ─────────────────────────────
const blockLdt = localDateTime.refine((v) => Number(v.slice(14, 16)) % 5 === 0, 'Use 5-minute steps');
export const blockTypeSchema = z.enum(BLOCK_TYPES);
export const conflictResolutionSchema = z.enum(['abort', 'cancel_conflicting']);
const blockReason = z
  .string()
  .trim()
  .min(3, 'Reason must be 3–200 characters')
  .max(200, 'Reason must be 3–200 characters');

export const blockListQuery = z.object({
  venueId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  includePast: boolFromQuery.default(false),
  sort: sortParam(['start:asc', 'start:desc']).default('start:asc'),
  ...pagination(20, 100),
});

export const blockCreateBody = z
  .strictObject({
    venueId: uuid,
    blockType: blockTypeSchema.default('maintenance'),
    reason: blockReason,
    start: blockLdt,
    end: blockLdt,
    conflictResolution: conflictResolutionSchema.default('abort'),
  })
  .refine((v) => localDateTimeToMinutes(v.end) > localDateTimeToMinutes(v.start), {
    message: 'The end must be after the start',
    path: ['end'],
  })
  .refine((v) => localDateTimeToMinutes(v.end) - localDateTimeToMinutes(v.start) <= 366 * 1440, {
    message: 'A block can span at most 366 days',
    path: ['end'],
  });

export const blockUpdateBody = z.strictObject({
  blockType: blockTypeSchema.optional(),
  reason: blockReason.optional(),
  start: blockLdt.optional(),
  end: blockLdt.optional(),
  conflictResolution: conflictResolutionSchema.default('abort'),
});

// ───────────────────────────── Admin venues ─────────────────────────────
export const adminVenuesQuery = z.object({
  q: searchQ.optional(),
  type: venueTypeSchema.optional(),
  isActive: boolFromQuery.optional(),
  sort: sortParam(['name:asc', 'capacity:desc', 'createdAt:desc']).default('name:asc'),
  ...pagination(20, 100),
});

export const deactivateVenueBody = z
  .strictObject({
    cancelUpcomingBookings: z.boolean().default(false),
    reason: z.string().trim().min(3, 'Reason must be 3–200 characters').max(200, 'Reason must be 3–200 characters').optional(),
  })
  .refine((v) => !v.cancelUpcomingBookings || !!v.reason, {
    message: 'A reason is required when cancelling bookings',
    path: ['reason'],
  });

// ───────────────────────────── Users ─────────────────────────────
export const usersQuery = z.object({
  q: searchQ.optional(),
  role: z.enum(ROLES).optional(),
  isActive: boolFromQuery.optional(),
  sort: sortParam(['createdAt:desc', 'name:asc']).default('createdAt:desc'),
  ...pagination(20, 100),
});

export const createUserBody = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  role: z.enum(MEMBER_ROLES),
  department: optionalDepartment,
  temporaryPassword: passwordSchema,
});

export const updateUserBody = requireOne(
  z.strictObject({
    fullName: fullNameSchema.optional(),
    role: z.enum(MEMBER_ROLES).optional(),
    department: optionalDepartment,
  }),
  ['fullName', 'role', 'department'],
);

export const deactivateUserBody = z.strictObject({ cancelUpcomingBookings: z.boolean().default(false) });

// ───────────────────────────── Reports / audit ─────────────────────────────
export const reportsQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional(), venueId: uuid.optional() })
  .refine((v) => !v.from || !v.to || (diffDays(v.to, v.from) >= 0 && diffDays(v.to, v.from) <= 366), {
    message: 'The range must be 0–366 days',
    path: ['to'],
  });

export const auditQuery = z.object({
  entityType: z.enum(['booking', 'venue', 'venue_block', 'user', 'settings', 'system']).optional(),
  entityId: z.string().min(1).max(64).optional(),
  actorId: uuid.optional(),
  action: z.string().trim().min(1).max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination(50, 100),
});

// ───────────────────────────── Settings ─────────────────────────────
const minutesRange = (min: number, max: number) => z.number().int().min(min).max(max);
export const settingsUpdateBody = requireOne(
  z.strictObject({
    institutionName: z.string().trim().min(2, 'Name must be 2–150 characters').max(150, 'Name must be 2–150 characters').optional(),
    supportEmail: z.union([emailSchema, z.literal('').transform(() => null), z.null()]).optional(),
    operatingHoursStart: timeSchema.optional(),
    operatingHoursEnd: timeSchema.optional(),
    timeStepMinutes: z.number().int().refine((v) => (TIME_STEPS as readonly number[]).includes(v), 'Choose 5, 10, 15, 20, 30 or 60').optional(),
    minDurationMinutes: minutesRange(5, 1440).optional(),
    maxDurationMinutes: minutesRange(5, 1440).optional(),
    maxAdvanceDays: minutesRange(1, 730).optional(),
    minLeadTimeMinutes: minutesRange(0, 20160).optional(),
    cancellationCutoffMinutes: minutesRange(0, 20160).optional(),
    modificationCutoffMinutes: minutesRange(0, 20160).optional(),
    maxPendingPerUser: minutesRange(1, 100).optional(),
    selfRegistrationEnabled: z.boolean().optional(),
    allowedEmailDomains: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(20).optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    emailDailyLimit: minutesRange(0, 300).optional(),
    reminderLeadMinutes: z.number().int().refine((v) => (REMINDER_LEADS as readonly number[]).includes(v), 'Choose a listed reminder time').optional(),
  }),
  [
    'institutionName', 'supportEmail', 'operatingHoursStart', 'operatingHoursEnd', 'timeStepMinutes',
    'minDurationMinutes', 'maxDurationMinutes', 'maxAdvanceDays', 'minLeadTimeMinutes', 'cancellationCutoffMinutes',
    'modificationCutoffMinutes', 'maxPendingPerUser', 'selfRegistrationEnabled', 'allowedEmailDomains',
    'emailNotificationsEnabled', 'emailDailyLimit', 'reminderLeadMinutes',
  ],
  'Provide at least one setting to change.',
);

export const idParam = z.object({ id: uuid });
export const venueIdParam = z.object({ venueId: uuid });
export const bookingIdParam = z.object({ bookingId: uuid });
export const userIdParam = z.object({ userId: uuid });
export const blockIdParam = z.object({ blockId: uuid });
export const notificationIdParam = z.object({ notificationId: uuid });

export type RegisterBody = z.infer<typeof registerBody>;
export type BookingCreateBody = z.infer<typeof bookingCreateBody>;
export type BookingUpdateBody = z.infer<typeof bookingUpdateBody>;
export type VenueCreateBody = z.infer<typeof venueCreateBody>;
export type VenueUpdateBody = z.infer<typeof venueUpdateBody>;
export type BlockCreateBody = z.infer<typeof blockCreateBody>;
export type BlockUpdateBody = z.infer<typeof blockUpdateBody>;
export type SettingsUpdateBody = z.infer<typeof settingsUpdateBody>;
export type CreateUserBody = z.infer<typeof createUserBody>;
export type UpdateUserBody = z.infer<typeof updateUserBody>;
