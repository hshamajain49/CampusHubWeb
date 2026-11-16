// Fixed value sets mirrored from the database CHECK constraints (§12) and their display labels (§17.1, §19).

export const ROLES = ['student', 'faculty_staff', 'department_staff', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];
/** Members use the member portal (venues, bookings, complaints). department_staff also get the staff workspace. */
export const MEMBER_ROLES = ['student', 'faculty_staff', 'department_staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  faculty_staff: 'Faculty / Staff',
  department_staff: 'Department Staff',
  super_admin: 'Super Admin',
};

/**
 * Bookings need no approval (docs/BOOKINGS.md): the first valid request for a slot is confirmed, overlapping requests
 * queue first-in, first-out and are promoted automatically when the slot frees up.
 */
export const BOOKING_STATUSES = ['confirmed', 'queued', 'completed', 'cancelled', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Upcoming bookings that still hold (confirmed) or wait for (queued) a slot. */
export const ACTIVE_STATUSES = ['confirmed', 'queued'] as const satisfies readonly BookingStatus[];
export const FINAL_STATUSES = ['completed', 'cancelled', 'expired'] as const satisfies readonly BookingStatus[];
export const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: 'Confirmed',
  queued: 'In Queue',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
/** Statuses that only appear in history written before approvals were retired. */
export const LEGACY_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
/** Label for any status found in data, including legacy history rows. */
export function statusLabel(s: string): string {
  return STATUS_LABELS[s as BookingStatus] ?? LEGACY_STATUS_LABELS[s] ?? s;
}
export function isActiveStatus(s: BookingStatus): boolean {
  return s === 'confirmed' || s === 'queued';
}
export function isFinalStatus(s: BookingStatus): boolean {
  return s === 'completed' || s === 'cancelled' || s === 'expired';
}

export const VENUE_TYPES = [
  'auditorium',
  'seminar_hall',
  'conference_room',
  'classroom',
  'laboratory',
  'sports_facility',
  'outdoor_space',
  'other',
] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  auditorium: 'Auditorium',
  seminar_hall: 'Seminar hall',
  conference_room: 'Conference room',
  classroom: 'Classroom',
  laboratory: 'Laboratory',
  sports_facility: 'Sports facility',
  outdoor_space: 'Outdoor space',
  other: 'Other',
};

export const BLOCK_TYPES = ['maintenance', 'special_event', 'other'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  maintenance: 'Maintenance',
  special_event: 'Special event',
  other: 'Other',
};

export const HISTORY_EVENTS = [
  'confirmed',
  'queued',
  'promoted',
  'modified',
  'cancelled',
  'expired',
  'completed',
  // history written before approvals were retired
  'submitted',
  'approved',
  'rejected',
] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

/** booked = a confirmed booking holds the time; queued = the viewer's own queued request; blocked = venue block. */
export const AVAILABILITY_KINDS = ['booked', 'queued', 'blocked'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'booking_confirmed',
  'booking_queued',
  'booking_promoted',
  'booking_cancelled',
  'booking_expired',
  'booking_reminder',
  'admin_new_booking',
  'admin_request_modified',
  'admin_booking_cancelled',
  // written before approvals were retired; still listed in the 180-day notification history
  'booking_approved',
  'booking_rejected',
  'admin_new_request',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_ENTITY_TYPES = [
  'booking',
  'venue',
  'venue_block',
  'user',
  'settings',
  'system',
  'complaint',
  'service_department',
  'complaint_category',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'booking.cancelled_by_admin': 'Cancelled booking',
  // retired with approvals; kept so old audit entries still read well
  'booking.approved': 'Approved booking',
  'booking.rejected': 'Rejected booking',
  'venue.created': 'Created venue',
  'venue.updated': 'Updated venue',
  'venue.activated': 'Activated venue',
  'venue.deactivated': 'Deactivated venue',
  'venue.deleted': 'Deleted venue',
  'venue.image_updated': 'Updated venue photo',
  'venue.image_removed': 'Removed venue photo',
  'venue_block.created': 'Created block',
  'venue_block.updated': 'Updated block',
  'venue_block.deleted': 'Deleted block',
  'user.created': 'Created user',
  'user.updated': 'Updated user',
  'user.activated': 'Activated user',
  'user.deactivated': 'Deactivated user',
  'user.password_reset_sent': 'Sent password reset',
  'user.super_admin_provisioned': 'Provisioned Super Admin',
  'settings.updated': 'Updated settings',
  'complaint.work_started': 'Started work on complaint',
  'complaint.work_completed': 'Marked complaint as done',
  'complaint.reopened': 'Reopened complaint',
  'complaint.reassigned': 'Reassigned complaint',
  'complaint.reassignment_dismissed': 'Dismissed reassignment request',
  'complaint.closed': 'Closed complaint',
  'service_department.created': 'Created department',
  'service_department.updated': 'Updated department',
  'service_department.activated': 'Activated department',
  'service_department.deactivated': 'Deactivated department',
  'complaint_category.created': 'Created complaint category',
  'complaint_category.updated': 'Updated complaint category',
  'complaint_category.activated': 'Activated complaint category',
  'complaint_category.deactivated': 'Deactivated complaint category',
};

export const TIME_STEPS = [5, 10, 15, 20, 30, 60] as const;
export const REMINDER_LEADS = [0, 30, 60, 120, 180, 360, 720, 1440] as const;

// ───────────────────────────── Complaints (COMPLAINT_REGISTRATION_SPEC.md) ─────────────────────────────
export const COMPLAINT_STATUSES = [
  'pending_review',
  'in_progress',
  'awaiting_confirmation',
  'resolved',
  'withdrawn',
  'closed',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const OPEN_COMPLAINT_STATUSES = ['pending_review', 'in_progress', 'awaiting_confirmation'] as const satisfies readonly ComplaintStatus[];
export const FINAL_COMPLAINT_STATUSES = ['withdrawn', 'closed'] as const satisfies readonly ComplaintStatus[];
export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  pending_review: 'Pending Review',
  in_progress: 'In Progress',
  awaiting_confirmation: 'Awaiting Approval',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};
export function isOpenComplaintStatus(s: ComplaintStatus): boolean {
  return s === 'pending_review' || s === 'in_progress' || s === 'awaiting_confirmation';
}
export function isFinalComplaintStatus(s: ComplaintStatus): boolean {
  return s === 'withdrawn' || s === 'closed';
}

export const CLOSURE_TYPES = ['duplicate', 'invalid', 'out_of_scope', 'other'] as const;
export type ClosureType = (typeof CLOSURE_TYPES)[number];
export const CLOSURE_TYPE_LABELS: Record<ClosureType, string> = {
  duplicate: 'Duplicate',
  invalid: 'Invalid or spam',
  out_of_scope: 'Out of scope',
  other: 'Other',
};

export const COMPLAINT_EVENTS = [
  'submitted',
  'work_started',
  'work_completed',
  'approved',
  'rejected',
  'auto_resolved',
  'reopened',
  'reassigned',
  'reassignment_requested',
  'reassignment_dismissed',
  'withdrawn',
  'closed',
] as const;
export type ComplaintEvent = (typeof COMPLAINT_EVENTS)[number];

export const ATTACHMENT_KINDS = ['report', 'resolution'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Lucide icon names allowed for categories (mirrors complaint_categories_icon_check). */
export const CATEGORY_ICONS = [
  'zap',
  'droplets',
  'wifi',
  'armchair',
  'spray-can',
  'brick-wall',
  'ellipsis',
  'wrench',
  'lightbulb',
  'fan',
  'air-vent',
  'trash-2',
  'shield-alert',
  'bus',
  'trees',
  'utensils',
  'monitor',
  'printer',
  'lock',
  'circle-help',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Colour palette for the category editor: the seven Flutter colours plus five extras (§16.2). */
export const CATEGORY_COLORS = [
  '#E09B10',
  '#2F7BD8',
  '#5B5BD6',
  '#B0703A',
  '#1F9D63',
  '#64748B',
  '#E5654B',
  '#334155',
  '#0F766E',
  '#7C3AED',
  '#B91C1C',
  '#0369A1',
] as const;

/** Photo limits shared by the form and the API (§12). */
export const COMPLAINT_PHOTO_RULES = {
  maxPhotos: 3,
  maxPhotoMb: 5,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

/** Open complaints older than this many days are "overdue" (CD-09). */
export const COMPLAINT_OVERDUE_DAYS = 7;
