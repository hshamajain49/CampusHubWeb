// DTOs exchanged between the API and the SPA (§15.2).
import type {
  AvailabilityKind,
  BlockType,
  BookingStatus,
  HistoryEvent,
  MemberRole,
  NotificationType,
  Role,
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
}

export interface BookingRules {
  operatingHoursStart: string;
  operatingHoursEnd: string;
  timeStepMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  minLeadTimeMinutes: number;
  cancellationCutoffMinutes: number;
  modificationCutoffMinutes: number;
  maxPendingPerUser: number;
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
    upcomingApprovedCount: number;
    pendingCount: number;
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
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canDownloadConfirmation: boolean;
}

export interface BookingSummary {
  id: string;
  reference: string;
  venue: { id: string; name: string; building: string; isActive: boolean };
  date: string;
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  durationMinutes: number;
  purpose: string;
  expectedAttendees: number | null;
  status: BookingStatus;
  rejectionReason: string | null;
  cancellationReason: string | null;
  isUpcoming: boolean;
  isHappeningNow: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: BookingPermissions;
}

export interface HistoryEntry {
  id: number;
  eventType: HistoryEvent;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
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
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  approvalNote: string | null;
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
  startTime: string;
  endTime: string;
  start: string;
  end: string;
  durationMinutes: number;
  purpose: string;
  expectedAttendees: number | null;
  status: BookingStatus;
  createdAt: string;
  decidedAt: string | null;
  version: number;
  permissions: AdminBookingPermissions;
}

export interface AdminBooking extends Omit<AdminBookingListItem, 'requester'> {
  requester: AdminBookingListItem['requester'] & {
    department: string | null;
    stats: { totalBookings: number; upcomingBookings: number };
  };
  rejectionReason: string | null;
  cancellationReason: string | null;
  decidedBy: PersonRef | null;
  approvalNote: string | null;
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
  available: boolean;
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
  bookingCounts: { total: number; upcoming: number; pending: number };
}

export interface UserDetail extends Omit<UserListItem, 'bookingCounts'> {
  bookingCounts: {
    total: number;
    upcoming: number;
    pending: number;
    approved: number;
    rejected: number;
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
  counts: { pending: number; upcomingApproved: number; history: number };
  nextBooking: BookingSummary | null;
  recentBookings: BookingSummary[];
  complaints: { open: number; awaitingYourReview: number };
  recentComplaints: ComplaintSummary[];
}

export interface AdminDashboard {
  kpis: {
    pendingCount: number;
    oldestPendingSubmittedAt: string | null;
    todayApprovedCount: number;
    next7DaysApprovedCount: number;
    activeVenues: number;
    inactiveVenues: number;
    activeMembers: number;
    approvalRate30d: number;
  };
  complaintKpis: ComplaintKpis;
  complaintsNeedingReassignment: ComplaintSummary[];
  needsAttention: AdminBookingListItem[];
  todaySchedule: AdminBookingListItem[];
  upcomingBlocks: VenueBlock[];
  recentActivity: {
    historyId: number;
    bookingId: string;
    reference: string;
    venueName: string;
    eventType: HistoryEvent;
    toStatus: BookingStatus;
    actor: PersonWithRole | null;
    createdAt: string;
  }[];
}

export interface ReportSummary {
  range: { from: string; to: string };
  totals: { requests: number; pending: number; approved: number; rejected: number; cancelled: number; expired: number };
  approvalRate: number;
  avgDecisionHours: number;
  approvedHours: number;
  byVenue: { venueId: string; venueName: string; requests: number; approved: number; approvedHours: number; utilizationPct: number }[];
  byRole: { role: MemberRole; requests: number; approved: number }[];
  byWeekday: { weekday: number; label: string; approved: number }[];
  byHour: { hour: number; approved: number }[];
  trend: { date: string; submitted: number; approved: number }[];
  generatedAt: string;
}
