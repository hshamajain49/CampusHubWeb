// Complaint DTOs (COMPLAINT_REGISTRATION_SPEC.md §11.1).
import type { AttachmentKind, CategoryIcon, ClosureType, ComplaintEvent, ComplaintStatus, Role } from '../enums.js';

export interface DepartmentRef {
  id: string;
  name: string;
}

export interface ComplaintCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: CategoryIcon;
  color: string;
  department: DepartmentRef & { isActive?: boolean };
  sortOrder: number;
  isActive: boolean;
}

export interface AdminComplaintCategory extends ComplaintCategory {
  counts: { openComplaints: number; totalComplaints: number };
  createdAt: string;
  updatedAt: string;
}

export interface ServiceDepartment {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  counts: { activeCategories: number; openComplaints: number; activeStaff: number };
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintSummary {
  id: string;
  reference: string;
  title: string;
  category: { id: string; name: string; icon: CategoryIcon; color: string };
  department: DepartmentRef;
  venue: { id: string; name: string; isActive: boolean } | null;
  locationDetails: string | null;
  status: ComplaintStatus;
  rejectedByReporter: boolean;
  reassignmentRequested: boolean;
  photoCount: number;
  /** Staff and admin lists only (omitted for the reporter's own list). */
  reporter?: { id: string; fullName: string; role: Role };
  handledBy: { id: string; fullName: string } | null;
  ageDays: number;
  isOverdue: boolean;
  /** Awaiting the reporter's approval (drives the "Your review needed" chip). */
  awaitingReporter: boolean;
  /** Optimistic-concurrency version, for inline list actions (CS01 "Start work"). */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintAttachment {
  id: string;
  kind: AttachmentKind;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  expiresAt: string;
  createdAt: string;
}

export interface ComplaintHistoryEntry {
  id: number;
  eventType: ComplaintEvent;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus;
  actor: { id: string; fullName: string; role: Role } | null;
  note: string | null;
  /** IDs are resolved to names by the API: e.g. { department: { fromName, toName } }. */
  changes: Record<string, unknown>;
  createdAt: string;
}

export interface ComplaintPermissions {
  canApprove: boolean;
  canReject: boolean;
  canWithdraw: boolean;
  canStart: boolean;
  canComplete: boolean;
  /** Reporter view: CB-21 (auto-resolved, inside the window). Staff/admin view: CB-10 (status resolved). */
  canReopen: boolean;
  canRequestReassignment: boolean;
  canReassign: boolean;
  canClose: boolean;
}

export interface Complaint extends Omit<ComplaintSummary, 'reporter'> {
  description: string | null;
  reporter: { id: string; fullName: string; email: string; role: Role; department: string | null };
  resolutionNote: string | null;
  rejectionReason: string | null;
  closureType: ClosureType | null;
  closureReason: string | null;
  /** Staff and admins only. */
  reassignmentNote: string | null;
  reassignmentSuggestedCategory: { id: string; name: string; department: DepartmentRef } | null;
  workStartedAt: string | null;
  workCompletedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  autoResolveAt: string | null;
  autoResolved: boolean;
  reporterReopenUntil: string | null;
  version: number;
  attachments: { report: ComplaintAttachment[]; resolution: ComplaintAttachment[] };
  history: ComplaintHistoryEntry[];
  /** The perspective the flags were computed for. */
  viewerRole: 'reporter' | 'staff' | 'admin';
  permissions: ComplaintPermissions;
}

export interface StaffDashboard {
  department: DepartmentRef & { isActive: boolean };
  counts: { new: number; inProgress: number; awaitingReporter: number; overdue: number; resolvedThisMonth: number };
  needsAttention: ComplaintSummary[];
  recentlyResolved: ComplaintSummary[];
}

export interface ComplaintCounts {
  open: number;
  closed: number;
  awaitingYourReview: number;
}

export interface StaffQueueCounts {
  new: number;
  in_progress: number;
  awaiting: number;
  resolved: number;
  closed: number;
}

export type ComplaintStatusCounts = Record<ComplaintStatus | 'all', number>;

export interface ComplaintKpis {
  open: number;
  newToday: number;
  awaitingReporter: number;
  needsReassignment: number;
  overdue: number;
  avgResolutionHours30d: number | null;
}

export interface ComplaintReport {
  range: { from: string; to: string };
  totals: Record<ComplaintStatus | 'submitted', number>;
  resolutionRate: number;
  avgHoursToStart: number | null;
  avgHoursToResolve: number | null;
  reopenRate: number;
  autoResolvedShare: number;
  byCategory: { categoryId: string; name: string; color: string; count: number; resolved: number }[];
  byDepartment: { departmentId: string; name: string; count: number; open: number; overdue: number; avgHoursToResolve: number | null }[];
  byVenue: { venueId: string; name: string; count: number }[];
  byReporterRole: { role: Role; count: number }[];
  aging: { under2Days: number; from2To7Days: number; over7Days: number };
  trend: { date: string; submitted: number; resolved: number }[];
  generatedAt: string;
}

export interface ComplaintRules {
  maxPhotos: number;
  maxPhotoMb: number;
  acceptedTypes: string[];
  autoResolveDays: number | null;
  reopenWindowDays: number;
  maxOpenPerUser: number;
}
