// Fixed value sets mirrored from the database CHECK constraints (§12) and their display labels (§17.1, §19).

export const ROLES = ['student', 'faculty_staff', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];
export const MEMBER_ROLES = ['student', 'faculty_staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  faculty_staff: 'Faculty / Staff',
  super_admin: 'Super Admin',
};

export const BOOKING_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const ACTIVE_STATUSES = ['pending', 'approved'] as const satisfies readonly BookingStatus[];
export const FINAL_STATUSES = ['rejected', 'cancelled', 'expired'] as const satisfies readonly BookingStatus[];
export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
};
export function isActiveStatus(s: BookingStatus): boolean {
  return s === 'pending' || s === 'approved';
}
export function isFinalStatus(s: BookingStatus): boolean {
  return s === 'rejected' || s === 'cancelled' || s === 'expired';
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

export const HISTORY_EVENTS = ['submitted', 'modified', 'approved', 'rejected', 'cancelled', 'expired'] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

export const AVAILABILITY_KINDS = ['booked', 'on_hold', 'blocked'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'booking_approved',
  'booking_rejected',
  'booking_cancelled',
  'booking_expired',
  'booking_reminder',
  'admin_new_request',
  'admin_request_modified',
  'admin_booking_cancelled',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_ENTITY_TYPES = ['booking', 'venue', 'venue_block', 'user', 'settings', 'system'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'booking.approved': 'Approved booking',
  'booking.rejected': 'Rejected booking',
  'booking.cancelled_by_admin': 'Cancelled booking',
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
};

export const TIME_STEPS = [5, 10, 15, 20, 30, 60] as const;
export const REMINDER_LEADS = [0, 30, 60, 120, 180, 360, 720, 1440] as const;
