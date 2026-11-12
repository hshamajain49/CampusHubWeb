// Row locks and pre-conditions shared by reporter, staff and admin complaint actions (§10.4 CA-2…CA-6).
// Order: lock → status check → version check. Checking the status first lets a reporter who acts on a stale page
// learn *why* ("already resolved", CEC-14) instead of a generic "changed by someone else".
import { COMPLAINT_STATUS_LABELS, type ComplaintStatus } from '@campushub/shared';
import type { Tx } from '../../db/transaction.js';
import { appError } from '../../errors/app-error.js';

export interface LockScope {
  reporterId?: string;
  departmentId?: string;
}

/** SELECT … FOR UPDATE with the caller's visibility filter; anything outside it is 404 (CB-09, §4.3). */
export async function lockComplaint(tx: Tx, id: string, scope: LockScope = {}): Promise<any> {
  const params: unknown[] = [id];
  let base = 'select * from public.complaints where id = $1';
  if (scope.reporterId) {
    params.push(scope.reporterId);
    base += ` and reporter_id = $${params.length}`;
  }
  if (scope.departmentId) {
    params.push(scope.departmentId);
    base += ` and department_id = $${params.length}`;
  }
  const { rows } = await tx.query(`${base} for update`, params);
  if (!rows[0]) throw appError('COMPLAINT_NOT_FOUND');
  return rows[0];
}

export function assertStatus(cur: { status: ComplaintStatus }, allowed: ComplaintStatus[], message?: string): void {
  if (allowed.includes(cur.status)) return;
  throw appError(
    'INVALID_STATUS_TRANSITION',
    message ?? `This complaint is ${COMPLAINT_STATUS_LABELS[cur.status].toLowerCase()} and can't be changed this way.`,
    { currentStatus: cur.status },
  );
}

export function assertVersion(cur: { version: number }, version: number): void {
  if (cur.version !== version) throw appError('COMPLAINT_CHANGED', undefined, { currentVersion: cur.version });
}
