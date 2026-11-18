// DTOs exchanged between the API and the SPA (§15.2).
import type {
  AvailabilityKind,
  BlockType,
  BookingStatus,
  HistoryEvent,
  MemberRole,
  NotificationType,
  Role,
  SuggestionStatus,
  VenueType,
} from '../enums.js';
import type { ComplaintKpis, ComplaintRules, ComplaintSummary, DepartmentRef } from './complaints.js';

export * from './complaints.js';

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface ApiSuccess<T> {
  data: T;
}
export interface ApiList<T, M = Record<string, never>> {
  data: T[];
  meta: ListMeta & M;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details: unknown; requestId: string };
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  department: string | null;
  /** Set for department_staff accounts (COMPLAINT_REGISTRATION_SPEC.md §11.4 E03). */
  serviceDepartment: (DepartmentRef & { isActive: boolean }) | null;
  isActive: boolean;
  mustChangePassword: boolean;
  emailNotifications: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** USN / faculty ID from the member's latest booking, to prefill the booking form. */
  lastIdNumber: string | null;
  /** Two-step verification (TOTP). Required for Super Admins in production. */
  mfa: MfaStatus;
}

export interface MfaStatus {
  /** This account must pass a second step before using the API. */
  required: boolean;
  /** An authenticator app is set up. */
  enrolled: boolean;
  /** This session has passed the second step (always true when not required). */
  verified: boolean;
  /** Unused recovery codes (null when not enrolled). */
  recoveryCodesLeft: number | null;
}

/** POST /me/mfa/setup: the new secret, shown once while enrolling. */
export interface MfaSetup {
  /** Base32 secret for manual entry. */
  secret: string;
  otpauthUrl: string;
  /** QR code of otpauthUrl as an SVG document. */
  qrSvg: string;
}

export interface MfaRecoveryCodes {
  recoveryCodes: string[];
}

export interface BookingRules {
  operatingHoursStart: string;
  operatingHoursEnd: string;
  timeStepMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  minLeadTimeMinutes: number;
  modificationCutoffMinutes: number;
  /** Most upcoming bookings (confirmed + queued) one member may hold. */
  maxActivePerUser: number;
}

export interface PublicSettings {
  institutionName: string;
  supportEmail: string | null;
  campusTimezone: string;
  selfRegistrationEnabled: boolean;
  allowedEmailDomains: string[];
  bookingRules: BookingRules;
  complaintRules: ComplaintRules;
  serverTime: { date: string; time: string; timestamp: string };
  pushPublicKey: string | null;
  realtimeEnabled: boolean;
}

export type ChannelStatus = 'configured' | 'not_configured' | 'console' | 'file';

export interface Settings extends BookingRules {
  institutionName: string;
  supportEmail: string | null;
  campusTimezone: string;
  selfRegistrationEnabled: boolean;
  allowedEmailDomains: string[];
  emailNotificationsEnabled: boolean;
  emailDailyLimit: number;
  reminderLeadMinutes: number;
  complaintAutoResolveDays: number | null;
  complaintReopenWindowDays: number;
  complaintMaxOpenPerUser: number;
  emailUsageToday: { sent: number; skipped: number; authSent: number };
  channels: { email: ChannelStatus; push: ChannelStatus; realtime: ChannelStatus; images: ChannelStatus };
  updatedAt: string;
  updatedBy: PersonRef | null;
}

export interface PersonRef {
  id: string;
  fullName: string;
}
export interface PersonWithRole extends PersonRef {
  role: Role;
}

export interface VenueSummary {
  id: string;
  name: string;
  venueType: VenueType;
  building: string;
  locationDetails: string | null;
  capacity: number;
  amenities: string[];
  imageUrl: string | null;
  imageThumbUrl: string | null;
  isActive: boolean;
}
export interface Venue extends VenueSummary {
  description: string;
  createdAt: string;
  updatedAt: string;
}
export interface AdminVenue extends Venue {
  createdBy: PersonRef | null;
  stats: {
    upcomingConfirmedCount: number;
    queuedCount: number;
    totalBookings: number;
    nextBooking: BookingSummary | null;
    openComplaints: number;
  };
}

export interface BookingPermissions {
  canEdit: boolean;
  canCancel: boolean;
  canDownloadConfirmation: boolean;
  canRebook: boolean;
}
export interface AdminBookingPermissions {
  canCancel: boolean;
  canDownloadConfirmation: boolean;
}

export interface BookingSummary {
  id: string;
  reference: string;
  venue: { id: string; name: string; building: string; isActive: boolean };
  /** First day. */
  date: string;
  /** Last day (= date for a single day). The time window repeats every day from date to endDate. */
  endDate: string;
  /** Number of days covered (1 for a single day). */
  days: number;
  startTime: string;
  endTime: string;
  /** Start of the first day. */
  start: string;
  /** End of the last day. */
  end: string;
  /** Length of each day's window. */
  durationMinutes: number;
  purpose: string;
  expectedAttendees: number | null;
  /** USN / faculty ID entered when booking (null on bookings made before the field existed). */
  idNumber: string | null;
  status: BookingStatus;
  /** 1-based place among queued requests overlapping this one (queued bookings only). */
  queuePosition: number | null;
  cancellationReason: string | null;
  isUpcoming: boolean;
  isHappeningNow: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: BookingPermissions;
}

/** History rows written before approvals were retired can carry the old statuses. */
export type HistoryStatus = BookingStatus | 'pending' | 'approved' | 'rejected';

export interface HistoryEntry {
  id: number;
  eventType: HistoryEvent;
  fromStatus: HistoryStatus | null;
  toStatus: HistoryStatus;
  actor: PersonWithRole | null;
  note: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export interface Booking extends Omit<BookingSummary, 'venue'> {
  venue: {
    id: string;
    name: string;
    venueType: VenueType;
    building: string;
    locationDetails: string | null;
    capacity: number;
    isActive: boolean;
  };
  requester: { id: string; fullName: string; email: string; role: Role; department: string | null };
  confirmedAt: string | null;
  queuedAt: string | null;
  cancelledBy: PersonWithRole | null;
  cancelledAt: string | null;
  version: number;
  history: HistoryEntry[];
}

export interface AdminBookingListItem {
  id: string;
  reference: string;
  venue: { id: string; name: string; building: string; capacity: number; isActive: boolean };
  requester: { id: string; fullName: string; email: string; role: Role; isActive: boolean };
  date: string;
  endDate: string;
  days: number;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  durationMinutes: number;
  purpose: string;
  expectedAttendees: number | null;
  idNumber: string | null;
  status: BookingStatus;
  queuePosition: number | null;
  createdAt: string;
  confirmedAt: string | null;
  version: number;
  permissions: AdminBookingPermissions;
}

export interface AdminBooking extends Omit<AdminBookingListItem, 'requester'> {
  requester: AdminBookingListItem['requester'] & {
    department: string | null;
    stats: { totalBookings: number; upcomingBookings: number };
  };
  cancellationReason: string | null;
  queuedAt: string | null;
  cancelledBy: PersonWithRole | null;
  cancelledAt: string | null;
  updatedAt: string;
  history: HistoryEntry[];
}

export interface AvailabilityInterval {
  kind: AvailabilityKind;
  start: string;
  end: string;
  isMine: boolean;
  bookingId: string | null;
  status: BookingStatus | null;
  blockType: BlockType | null;
  label: string;
  /** Booked intervals: queued requests waiting for (part of) this time. */
  queueLength: number;
}

export interface VenueAvailability {
  venueId: string;
  from: string;
  to: string;
  timezone: string;
  operatingHours: { start: string; end: string };
  timeStepMinutes: number;
  intervals: AvailabilityInterval[];
}

export interface AvailabilityCheck {
  /** True when the request passes every rule: it would be confirmed, or queued if the time is taken. */
  available: boolean;
  /** What submitting would do right now: confirm, join the queue, or nothing (rule violations). */
  outcome: 'confirm' | 'queue' | 'unavailable';
  /** The place the request would take in the queue (outcome 'queue'). */
  queuePosition: number | null;
  violations: { code: string; field: string; message: string }[];
  conflicts: AvailabilityInterval[];
}

export interface VenueBlock {
  id: string;
  venue: { id: string; name: string };
  blockType: BlockType;
  reason: string;
  start: string;
  end: string;
  createdBy: PersonRef;
  createdAt: string;
  updatedAt: string;
}

export interface BlockConflict {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  date: string;
  /** Last day of a multi-day booking (= date for one day). */
  endDate: string;
  startTime: string;
  endTime: string;
  requester: PersonRef;
}

export type CalendarEvent =
  | {
      id: string;
      kind: 'booking';
      bookingId: string;
      reference: string;
      status: BookingStatus;
      title: string;
      start: string;
      end: string;
      venue: { id: string; name: string };
      requester: PersonWithRole;
      purpose: string;
      version: number;
    }
  | {
      id: string;
      kind: 'block';
      blockId: string;
      blockType: BlockType;
      title: string;
      reason: string;
      start: string;
      end: string;
      venue: { id: string; name: string };
    };

export interface UserListItem {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  department: string | null;
  serviceDepartment: (DepartmentRef & { isActive: boolean }) | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  bookingCounts: { total: number; upcoming: number; queued: number };
}

export interface UserDetail extends Omit<UserListItem, 'bookingCounts'> {
  bookingCounts: {
    total: number;
    upcoming: number;
    confirmed: number;
    queued: number;
    completed: number;
    cancelled: number;
    expired: number;
  };
  recentBookings: AdminBookingListItem[];
  permissions: { canEdit: boolean; canDeactivate: boolean; canActivate: boolean; canSendPasswordReset: boolean };
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  bookingId: string | null;
  linkPath: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  actor: PersonRef | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface MemberDashboard {
  counts: { queued: number; upcomingConfirmed: number; history: number };
  nextBooking: BookingSummary | null;
  recentBookings: BookingSummary[];
  complaints: { open: number; awaitingYourReview: number };
  recentComplaints: ComplaintSummary[];
}

export interface AdminDashboard {
  kpis: {
    /** Upcoming queued requests waiting for a slot. */
    queuedCount: number;
    todayConfirmedCount: number;
    next7DaysConfirmedCount: number;
    activeVenues: number;
    inactiveVenues: number;
    activeMembers: number;
    /** Bookings made in the last 30 days. */
    newBookings30d: number;
    /** Queued requests that got their slot in the last 30 days. */
    promoted30d: number;
    /** Suggestion-box entries nobody has reviewed yet. */
    newSuggestions: number;
  };
  complaintKpis: ComplaintKpis;
  complaintsNeedingReassignment: ComplaintSummary[];
  /** Upcoming queued requests, soonest first. */
  queuedRequests: AdminBookingListItem[];
  todaySchedule: AdminBookingListItem[];
  upcomingBlocks: VenueBlock[];
  recentActivity: {
    historyId: number;
    bookingId: string;
    reference: string;
    venueName: string;
    eventType: HistoryEvent;
    toStatus: HistoryStatus;
    actor: PersonWithRole | null;
    createdAt: string;
  }[];
}

export interface Suggestion {
  id: string;
  subject: string;
  message: string;
  status: SuggestionStatus;
  /** The administrator's reply, shown to the author. */
  adminResponse: string | null;
  reviewedBy: PersonRef | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSuggestion extends Suggestion {
  /** Null when the author deleted their account (their suggestions go with it, so this is rare). */
  author: { id: string; fullName: string; email: string; role: Role } | null;
}

export interface ReportSummary {
  range: { from: string; to: string };
  /** confirmed = upcoming confirmed; booked = confirmed + completed (got the venue). */
  totals: { requests: number; booked: number; confirmed: number; queued: number; completed: number; cancelled: number; expired: number };
  /** Share of requests that had to join a queue (0–1). */
  queuedShare: number;
  /** Queued requests that were later confirmed. */
  promotedCount: number;
  /** Average hours from joining the queue to getting the slot, over promoted requests. */
  avgQueueWaitHours: number;
  bookedHours: number;
  byVenue: { venueId: string; venueName: string; requests: number; booked: number; bookedHours: number; utilizationPct: number }[];
  byRole: { role: MemberRole; requests: number; booked: number }[];
  byWeekday: { weekday: number; label: string; booked: number }[];
  byHour: { hour: number; booked: number }[];
  trend: { date: string; submitted: number; booked: number }[];
  generatedAt: string;
}
