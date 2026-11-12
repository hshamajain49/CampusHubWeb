// Row → DTO mapping for complaints (COMPLAINT_REGISTRATION_SPEC.md §11.1).
import {
  COMPLAINT_OVERDUE_DAYS,
  isOpenComplaintStatus,
  type Complaint,
  type ComplaintAttachment,
  type ComplaintHistoryEntry,
  type ComplaintSummary,
} from '@campushub/shared';
import type { DbClient } from '../../db/pool.js';
import type { AppSettings } from '../../domain/settings.js';
import {
  adminPermissions,
  autoResolveAt,
  reporterPermissions,
  reporterReopenUntil,
  staffPermissions,
  type ComplaintState,
} from '../../domain/complaint-rules.js';
import { privateStore } from '../../lib/storage.js';
import { loadAttachments, loadComplaintHistory, namesFor, wasAutoResolved } from './complaint.queries.js';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export function toComplaintSummary(r: any, opts: { includeReporter?: boolean } = {}): ComplaintSummary {
  const open = isOpenComplaintStatus(r.status);
  const summary: ComplaintSummary = {
    id: r.id,
    reference: r.reference,
    title: r.title,
    category: { id: r.category_id, name: r.category_name, icon: r.category_icon, color: r.category_color },
    department: { id: r.department_id, name: r.department_name },
    venue: r.venue_id ? { id: r.venue_id, name: r.venue_name, isActive: !!r.venue_active } : null,
    locationDetails: r.location_details,
    status: r.status,
    rejectedByReporter: r.status === 'in_progress' && !!r.rejection_reason,
    reassignmentRequested: !!r.reassignment_requested,
    photoCount: Number(r.photo_count ?? 0),
    handledBy: r.handled_by ? { id: r.handled_by, fullName: r.handler_name } : null,
    ageDays: Number(r.age_days ?? 0),
    isOverdue: open && Number(r.age_days ?? 0) > COMPLAINT_OVERDUE_DAYS,
    awaitingReporter: r.status === 'awaiting_confirmation',
    version: r.version,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
  if (opts.includeReporter) summary.reporter = { id: r.reporter_id, fullName: r.reporter_name, role: r.reporter_role };
  return summary;
}

function stateOf(r: any, autoResolved: boolean): ComplaintState {
  return {
    status: r.status,
    reassignmentRequested: !!r.reassignment_requested,
    workCompletedAt: r.work_completed_at ? new Date(r.work_completed_at) : null,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    autoResolved,
  };
}

async function mapHistory(db: DbClient, rows: any[]): Promise<ComplaintHistoryEntry[]> {
  const ids = new Set<string>();
  for (const h of rows) {
    const c = h.changes ?? {};
    for (const k of ['categoryId', 'departmentId'] as const) {
      if (c[k]?.from) ids.add(c[k].from);
      if (c[k]?.to) ids.add(c[k].to);
    }
    if (c.suggestedCategoryId) ids.add(c.suggestedCategoryId);
  }
  const names = await namesFor(db, [...ids]);
  const pair = (v: any) => ({ fromName: names.get(v?.from) ?? null, toName: names.get(v?.to) ?? null });
  return rows.map((h) => {
    const c = h.changes ?? {};
    let changes: Record<string, unknown> = {};
    if (h.event_type === 'reassigned') changes = { category: pair(c.categoryId), department: pair(c.departmentId) };
    else if (h.event_type === 'reassignment_requested')
      changes = { suggestedCategory: c.suggestedCategoryId ? (names.get(c.suggestedCategoryId) ?? null) : null };
    else if (h.event_type === 'closed') changes = { closureType: c.closureType ?? null };
    return {
      id: Number(h.id),
      eventType: h.event_type,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      actor: h.actor_id ? { id: h.actor_id, fullName: h.actor_name, role: h.actor_role } : null,
      note: h.note,
      changes,
      createdAt: iso(h.created_at)!,
    };
  });
}

async function signedAttachments(rows: any[]): Promise<Complaint['attachments']> {
  const out: Complaint['attachments'] = { report: [], resolution: [] };
  if (!rows.length) return out;
  const urls = await privateStore.signedUrls(rows.flatMap((a) => [a.storage_path, a.thumb_path]));
  rows.forEach((a, i) => {
    const full = urls[i * 2]!;
    const thumb = urls[i * 2 + 1]!;
    const item: ComplaintAttachment = {
      id: a.id,
      kind: a.kind,
      url: full.url,
      thumbUrl: thumb.url,
      width: a.width,
      height: a.height,
      sizeBytes: a.size_bytes,
      expiresAt: full.expiresAt,
      createdAt: iso(a.created_at)!,
    };
    (a.kind === 'resolution' ? out.resolution : out.report).push(item);
  });
  return out;
}

export type ComplaintViewer = { kind: 'reporter' } | { kind: 'staff' } | { kind: 'admin'; actorId: string };

/** Full detail DTO for one viewer perspective, with fresh 10-minute signed photo URLs. */
export async function toComplaint(db: DbClient, r: any, settings: AppSettings, viewer: ComplaintViewer): Promise<Complaint> {
  const [historyRows, attachmentRows, autoResolved] = await Promise.all([
    loadComplaintHistory(db, r.id),
    loadAttachments(db, r.id),
    r.status === 'resolved' ? wasAutoResolved(db, r.id) : Promise.resolve(false),
  ]);
  const [history, attachments] = await Promise.all([mapHistory(db, historyRows), signedAttachments(attachmentRows)]);
  const state = stateOf(r, autoResolved);
  const permissions =
    viewer.kind === 'reporter'
      ? reporterPermissions(state, settings.complaintReopenWindowDays)
      : viewer.kind === 'staff'
        ? staffPermissions(state)
        : adminPermissions(state, viewer.actorId === r.reporter_id);
  const privileged = viewer.kind !== 'reporter';
  const { reporter: _omit, ...summary } = toComplaintSummary(r);
  return {
    ...summary,
    description: r.description,
    reporter: { id: r.reporter_id, fullName: r.reporter_name, email: r.reporter_email, role: r.reporter_role, department: r.reporter_department },
    resolutionNote: r.resolution_note,
    rejectionReason: r.rejection_reason,
    closureType: r.closure_type,
    closureReason: r.closure_reason,
    reassignmentNote: privileged ? r.reassignment_note : null,
    reassignmentSuggestedCategory:
      privileged && r.reassignment_suggested_category_id
        ? {
            id: r.reassignment_suggested_category_id,
            name: r.suggested_category_name,
            department: { id: r.suggested_department_id, name: r.suggested_department_name },
          }
        : null,
    workStartedAt: iso(r.work_started_at),
    workCompletedAt: iso(r.work_completed_at),
    resolvedAt: iso(r.resolved_at),
    closedAt: iso(r.closed_at),
    autoResolveAt: iso(autoResolveAt(state, settings.complaintAutoResolveDays)),
    autoResolved,
    reporterReopenUntil: iso(reporterReopenUntil(state, settings.complaintReopenWindowDays)),
    version: r.version,
    attachments,
    history,
    viewerRole: viewer.kind,
    permissions,
  };
}
