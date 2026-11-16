// Complaint permission flags and derived dates (COMPLAINT_REGISTRATION_SPEC.md §6, §11.1). The same functions guard the
// endpoints (via the services) and feed `permissions`, so the UI can never offer an action the API refuses.
import type { ComplaintPermissions, ComplaintStatus } from '@campushub/shared';

export interface ComplaintState {
  status: ComplaintStatus;
  reassignmentRequested: boolean;
  workCompletedAt: Date | null;
  resolvedAt: Date | null;
  /** The latest history event that set status 'resolved' was 'auto_resolved'. */
  autoResolved: boolean;
}

const DAY = 86_400_000;
const NONE: ComplaintPermissions = {
  canApprove: false,
  canReject: false,
  canWithdraw: false,
  canStart: false,
  canComplete: false,
  canReopen: false,
  canRequestReassignment: false,
  canReassign: false,
  canDismissReassignment: false,
  canClose: false,
};

const MOVABLE = (s: ComplaintStatus) => s === 'pending_review' || s === 'in_progress';

/** When the hourly job will resolve an awaiting complaint (null when off or not awaiting). */
export function autoResolveAt(c: ComplaintState, autoResolveDays: number | null): Date | null {
  if (c.status !== 'awaiting_confirmation' || !c.workCompletedAt || autoResolveDays === null) return null;
  return new Date(c.workCompletedAt.getTime() + autoResolveDays * DAY);
}

/** CB-21: until when the reporter may reopen an automatically resolved complaint (null = not reopenable). */
export function reporterReopenUntil(c: ComplaintState, reopenWindowDays: number): Date | null {
  if (c.status !== 'resolved' || !c.autoResolved || !c.resolvedAt || reopenWindowDays <= 0) return null;
  return new Date(c.resolvedAt.getTime() + reopenWindowDays * DAY);
}

export function reporterPermissions(c: ComplaintState, reopenWindowDays: number, now = new Date()): ComplaintPermissions {
  const until = reporterReopenUntil(c, reopenWindowDays);
  return {
    ...NONE,
    canApprove: c.status === 'awaiting_confirmation',
    canReject: c.status === 'awaiting_confirmation',
    canWithdraw: c.status === 'pending_review',
    canReopen: !!until && now < until,
    // The reporter decides where the complaint belongs: move it, or keep it after a department asked to move it.
    canReassign: MOVABLE(c.status),
    canDismissReassignment: c.reassignmentRequested && MOVABLE(c.status),
  };
}

/** Staff of the assigned department manage the work: start, done, reopen, ask to move it, close (CB-09, CB-10, CB-14). */
export function staffPermissions(c: ComplaintState): ComplaintPermissions {
  return {
    ...NONE,
    canStart: c.status === 'pending_review',
    canComplete: c.status === 'in_progress',
    canReopen: c.status === 'resolved',
    canRequestReassignment: MOVABLE(c.status) && !c.reassignmentRequested,
    canClose: MOVABLE(c.status),
  };
}

/**
 * Super Admin: monitors status and progress only; the department manages the work and the reporter decides where it
 * belongs. On a complaint the admin filed themselves, they have the reporter's actions like anyone else.
 */
export function adminPermissions(c: ComplaintState, isReporter: boolean, reopenWindowDays = 0): ComplaintPermissions {
  return isReporter ? reporterPermissions(c, reopenWindowDays) : { ...NONE };
}
