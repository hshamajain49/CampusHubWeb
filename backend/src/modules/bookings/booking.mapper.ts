// Row → DTO mapping for member and admin booking views (§15.2).
import {
  durationMinutes,
  localDateTimeToMinutes,
  toLocalDateTime,
  type AdminBooking,
  type AdminBookingListItem,
  type Booking,
  type BookingSummary,
  type HistoryEntry,
} from '@campushub/shared';
import type { AppSettings } from '../../domain/settings.js';
import { adminPermissions, memberPermissions } from '../../domain/permissions.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function timing(r: any, localNow: string) {
  const start = toLocalDateTime(r.date, r.start_time);
  const end = toLocalDateTime(r.date, r.end_time);
  const now = localDateTimeToMinutes(localNow);
  const s = localDateTimeToMinutes(start);
  const e = localDateTimeToMinutes(end);
  const active = r.status === 'pending' || r.status === 'approved';
  return {
    start,
    end,
    durationMinutes: durationMinutes(r.start_time, r.end_time),
    isUpcoming: active && e > now,
    isHappeningNow: r.status === 'approved' && s <= now && now < e,
  };
}

export function mapHistory(rows: any[]): HistoryEntry[] {
  return rows.map((h) => ({
    id: Number(h.id),
    eventType: h.event_type,
    fromStatus: h.from_status,
    toStatus: h.to_status,
    actor: h.actor_id ? { id: h.actor_id, fullName: h.actor_name, role: h.actor_role } : null,
    note: h.note,
    changes: h.changes ?? {},
    createdAt: iso(h.created_at)!,
  }));
}

export function approvalNoteOf(status: string, history: HistoryEntry[]): string | null {
  if (status !== 'approved') return null;
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.eventType === 'approved') return history[i]!.note;
  return null;
}

export function toBookingSummary(r: any, s: AppSettings, localNow: string): BookingSummary {
  const t = timing(r, localNow);
  return {
    id: r.id,
    reference: r.reference,
    venue: { id: r.venue_id, name: r.venue_name, building: r.venue_building, isActive: r.venue_active },
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    start: t.start,
    end: t.end,
    durationMinutes: t.durationMinutes,
    purpose: r.purpose,
    expectedAttendees: r.expected_attendees,
    status: r.status,
    rejectionReason: r.rejection_reason,
    cancellationReason: r.cancellation_reason,
    isUpcoming: t.isUpcoming,
    isHappeningNow: t.isHappeningNow,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    permissions: memberPermissions({ status: r.status, start: t.start, venueActive: r.venue_active }, s, localNow),
  };
}

export function toBooking(r: any, historyRows: any[], s: AppSettings, localNow: string): Booking {
  const summary = toBookingSummary(r, s, localNow);
  const history = mapHistory(historyRows);
  return {
    ...summary,
    venue: {
      id: r.venue_id,
      name: r.venue_name,
      venueType: r.venue_type,
      building: r.venue_building,
      locationDetails: r.venue_location,
      capacity: r.venue_capacity,
      isActive: r.venue_active,
    },
    requester: {
      id: r.requester_id,
      fullName: r.requester_name,
      email: r.requester_email,
      role: r.requester_role,
      department: r.requester_department,
    },
    decidedBy: r.decided_by ? { id: r.decided_by, fullName: r.decided_by_name } : null,
    decidedAt: iso(r.decided_at),
    approvalNote: approvalNoteOf(r.status, history),
    cancelledBy: r.cancelled_by ? { id: r.cancelled_by, fullName: r.cancelled_by_name, role: r.cancelled_by_role } : null,
    cancelledAt: iso(r.cancelled_at),
    version: r.version,
    history,
  };
}

export function toAdminListItem(r: any, localNow: string): AdminBookingListItem {
  const t = timing(r, localNow);
  return {
    id: r.id,
    reference: r.reference,
    venue: { id: r.venue_id, name: r.venue_name, building: r.venue_building, capacity: r.venue_capacity, isActive: r.venue_active },
    requester: {
      id: r.requester_id,
      fullName: r.requester_name,
      email: r.requester_email,
      role: r.requester_role,
      isActive: r.requester_active,
    },
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    start: t.start,
    end: t.end,
    durationMinutes: t.durationMinutes,
    purpose: r.purpose,
    expectedAttendees: r.expected_attendees,
    status: r.status,
    createdAt: iso(r.created_at)!,
    decidedAt: iso(r.decided_at),
    version: r.version,
    permissions: adminPermissions(
      { status: r.status, start: t.start, venueActive: r.venue_active, requesterActive: r.requester_active },
      localNow,
    ),
  };
}

export function toAdminBooking(r: any, historyRows: any[], stats: { totalBookings: number; upcomingBookings: number }, localNow: string): AdminBooking {
  const item = toAdminListItem(r, localNow);
  const history = mapHistory(historyRows);
  return {
    ...item,
    requester: { ...item.requester, department: r.requester_department, stats },
    rejectionReason: r.rejection_reason,
    cancellationReason: r.cancellation_reason,
    decidedBy: r.decided_by ? { id: r.decided_by, fullName: r.decided_by_name } : null,
    approvalNote: approvalNoteOf(r.status, history),
    cancelledBy: r.cancelled_by ? { id: r.cancelled_by, fullName: r.cancelled_by_name, role: r.cancelled_by_role } : null,
    cancelledAt: iso(r.cancelled_at),
    updatedAt: iso(r.updated_at)!,
    history,
  };
}
