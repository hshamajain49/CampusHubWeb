// Request schemas for the complaint module (COMPLAINT_REGISTRATION_SPEC.md §7, §11). Strict bodies: no status field
// is ever accepted from a client — each endpoint performs one fixed transition (§13).
import { z } from 'zod';
import { CATEGORY_ICONS, CLOSURE_TYPES, COMPLAINT_STATUSES, ROLES } from '../enums.js';
import { diffDays } from '../time.js';
import { cleanText, csvOf, isoDate, pagination, searchQ, sortParam, uuid } from './common.js';

/** Optional free text: '' and whitespace become null; control characters stripped (§21.6). */
const optionalText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined ? null : cleanText(v) || null))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`).nullable());

/** Like optionalText, but keeps "not sent" (undefined) apart from "cleared" (null) for PATCH bodies. */
const patchText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null ? null : cleanText(v) || null))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters.`).nullable().optional());

const someField = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

/** Required reason 3–max characters, counted like PostgreSQL char_length (code points, CEC-28). */
const reason = (max: number, tooShort: string) =>
  z
    .string({ message: tooShort })
    .transform(cleanText)
    .pipe(
      z
        .string()
        .refine((s) => [...s].length >= 3, tooShort)
        .refine((s) => [...s].length <= max, `Keep it under ${max} characters.`),
    );

const version = z.number({ message: 'Missing version' }).int().min(1);

// ───────────────────────────── Reporter ─────────────────────────────
/** The JSON `data` part of POST /complaints (C02). Photos travel as separate multipart files. */
export const complaintCreateData = z.strictObject({
  categoryId: z.guid({ message: 'Please select a category' }),
  title: z
    .string({ message: 'Please give your complaint a title' })
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(1, 'Please give your complaint a title')
        .refine((s) => [...s].length >= 3, 'Title must be at least 3 characters.')
        .refine((s) => [...s].length <= 120, 'Title must be at most 120 characters.'),
    ),
  venueId: uuid.nullable().optional().default(null),
  locationDetails: optionalText(200, 'Location'),
  description: optionalText(2000, 'Description'),
});
export type ComplaintCreateData = z.infer<typeof complaintCreateData>;

export const complaintVersionBody = z.strictObject({ version });
export const complaintRejectBody = z.strictObject({
  version,
  reason: reason(300, 'Please tell us what still needs fixing (at least 3 characters).'),
});
export const complaintWithdrawBody = z.strictObject({ version, reason: optionalText(300, 'Reason') });
export const complaintReporterReopenBody = z.strictObject({
  version,
  reason: reason(300, "Please tell us what's still wrong (at least 3 characters)."),
});

export const myComplaintsQuery = z.object({
  tab: z.enum(['open', 'closed', 'all']).default('open'),
  status: csvOf(COMPLAINT_STATUSES).optional(),
  categoryId: uuid.optional(),
  q: searchQ.optional(),
  sort: sortParam(['createdAt:desc', 'createdAt:asc']).default('createdAt:desc'),
  ...pagination(20, 100),
});

// ───────────────────────────── Staff ─────────────────────────────
export const staffNoteBody = z.strictObject({ version, note: optionalText(500, 'Note') });
/** The JSON `data` part of the multipart "mark work done" requests (C12, C19). */
export const completeWorkData = z.strictObject({ version, note: optionalText(1000, 'Note') });
export const requestReassignmentBody = z.strictObject({
  version,
  reason: reason(500, 'Please explain why (at least 3 characters).'),
  suggestedCategoryId: uuid.nullable().optional().default(null),
});

export const STAFF_TABS = ['new', 'in_progress', 'awaiting', 'resolved', 'closed', 'all'] as const;
export type StaffTab = (typeof STAFF_TABS)[number];
export const staffComplaintsQuery = z.object({
  tab: z.enum(STAFF_TABS).default('new'),
  categoryId: uuid.optional(),
  q: searchQ.optional(),
  flag: z.enum(['rejected', 'reassignment']).optional(),
  sort: sortParam(['createdAt:asc', 'createdAt:desc', 'updatedAt:desc']).optional(),
  ...pagination(20, 100),
});

// ───────────────────────────── Admin ─────────────────────────────
const adminComplaintFilters = {
  status: csvOf(COMPLAINT_STATUSES).optional(),
  departmentId: uuid.optional(),
  categoryId: uuid.optional(),
  venueId: uuid.optional(),
  reporterId: uuid.optional(),
  reporterRole: z.enum(ROLES).optional(),
  flag: z.enum(['reassignment', 'overdue', 'rejected', 'mine']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  q: searchQ.optional(),
};
export const adminComplaintsQuery = z.object({
  ...adminComplaintFilters,
  sort: sortParam(['createdAt:desc', 'createdAt:asc', 'updatedAt:desc']).default('createdAt:desc'),
  ...pagination(20, 100),
});
export const adminComplaintsExportQuery = z.object(adminComplaintFilters);

export const adminReassignBody = z
  .strictObject({
    version,
    categoryId: uuid.optional(),
    dismiss: z.literal(true).optional(),
    note: reason(500, 'Please add a note (at least 3 characters).'),
  })
  .refine((v) => (v.dismiss ? v.categoryId === undefined : v.categoryId !== undefined), {
    message: 'Choose a new category, or dismiss the request.',
    path: ['categoryId'],
  });

export const adminCloseBody = z.strictObject({
  version,
  closureType: z.enum(CLOSURE_TYPES, { message: 'Choose a reason type' }),
  reason: reason(500, 'Please explain why (at least 3 characters).'),
});

// ───────────────────────────── Departments & categories ─────────────────────────────
const deptName = z.string().trim().min(2, 'Name must be 2–100 characters').max(100, 'Name must be 2–100 characters');
export const departmentCreateBody = z.strictObject({ name: deptName, description: optionalText(300, 'Description') });
export const departmentUpdateBody = z
  .strictObject({ name: deptName.optional(), description: patchText(300, 'Description'), isActive: z.boolean().optional() })
  .refine(someField, { message: 'Provide at least one field to change.' });

const catName = z.string().trim().min(2, 'Name must be 2–60 characters').max(60, 'Name must be 2–60 characters');
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour');
const sortOrder = z.number().int().min(0, 'Use 0–999').max(999, 'Use 0–999');
export const categoryCreateBody = z.strictObject({
  name: catName,
  description: optionalText(200, 'Description'),
  icon: z.enum(CATEGORY_ICONS).default('circle-help'),
  color: hexColor.default('#64748B'),
  departmentId: z.guid({ message: 'Choose a department' }),
  sortOrder: sortOrder.default(100),
});
export const categoryUpdateBody = z
  .strictObject({
    name: catName.optional(),
    description: patchText(200, 'Description'),
    icon: z.enum(CATEGORY_ICONS).optional(),
    color: hexColor.optional(),
    departmentId: uuid.optional(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(someField, { message: 'Provide at least one field to change.' });

// ───────────────────────────── Reports ─────────────────────────────
export const complaintReportsQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional(), departmentId: uuid.optional() })
  .refine((v) => !v.from || !v.to || (diffDays(v.to, v.from) >= 0 && diffDays(v.to, v.from) <= 366), {
    message: 'The range must be 0–366 days',
    path: ['to'],
  });

export const complaintIdParam = z.object({ complaintId: uuid });
export const departmentIdParam = z.object({ departmentId: uuid });
export const categoryIdParam = z.object({ categoryId: uuid });

export type AdminReassignBody = z.infer<typeof adminReassignBody>;
export type AdminCloseBody = z.infer<typeof adminCloseBody>;
export type DepartmentCreateBody = z.infer<typeof departmentCreateBody>;
export type DepartmentUpdateBody = z.infer<typeof departmentUpdateBody>;
export type CategoryCreateBody = z.infer<typeof categoryCreateBody>;
export type CategoryUpdateBody = z.infer<typeof categoryUpdateBody>;
