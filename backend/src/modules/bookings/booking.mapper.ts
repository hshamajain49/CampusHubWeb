// Row → DTO mapping for member and admin booking views (§15.2).
import {
  bookingDays,
  durationMinutes,
  localDateTimeToMinutes,
  toLocalDateTime,
  type AdminBooking,
  type AdminBookingListItem,
  type Booking,
  type BookingStatus,
  type BookingSummary,
  type HistoryEntry,
} from '@campushub/shared';
import type { AppSettings } from '../../domain/settings.js';
import { adminPermissions, memberPermissions } from '../../domain/permissions.js';

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/**
 * The settle job moves confirmed → completed and queued → expired at most a minute or so late; reads already show
 * the outcome so a booking never looks upcoming after it ended.
 */
export function effectiveStatus(status: BookingStatus, start: string, end: string, localNow: string): BookingStatus {
  const now = localDateTimeToMinutes(localNow);
  if (status === 'confirmed' && localDateTimeToMinutes(end) <= now) return 'completed';
  if (status === 'queued' && localDateTimeToMinutes(start) <= now) return 'expired';
  return status;
}

function timing(r: any, localNow: string) {
  const endDate: string = r.end_date ?? r.date;
  // start = first day's start, end = last day's end: they bound the whole booking.
  const start = toLocalDateTime(r.date, r.start_time);
  const end = toLocalDateTime(endDate, r.end_time);
  const now = localDateTimeToMinutes(localNow);
  const e = localDateTimeToMinutes(end);
  const status = effectiveStatus(r.status, start, end, localNow);
  const active = status === 'confirmed' || status === 'queued';
  // Happening now: today is one of its days and the clock is inside that day's window.
  const today = localNow.slice(0, 10);
  const inDays = today >= r.date && today <= endDate;
  const todayStart = localDateTimeToMinutes(toLocalDateTime(today, r.start_time));
  const todayEnd = localDateTimeToMinutes(toLocalDateTime(today, r.end_time));
  return {
    start,
    end,
    endDate,
    days: bookingDays(r.date, endDate),
    status,
    durationMinutes: durationMinutes(r.start_time, r.end_time),
    isUpcoming: active && e > now,
    isHappeningNow: status === 'confirmed' && inDays && todayStart <= now && now < todayEnd,
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

export function toBookingSummary(r: any, s: AppSettings, localNow: string): BookingSummary {
  const t = timing(r, localNow);
  return {
    id: r.id,
    reference: r.reference,
    venue: { id: r.venue_id, name: r.venue_name, building: r.venue_building, isActive: r.venue_active },
    date: r.date,
    endDate: t.endDate,
    days: t.days,
    startTime: r.start_time,
    endTime: r.end_time,
    start: t.start,
    end: t.end,
    durationMinutes: t.durationMinutes,
    purpose: r.purpose,
    expectedAttendees: r.expected_attendees,
    idNumber: r.id_number ?? null,
    status: t.status,
    queuePosition: t.status === 'queued' ? (r.queue_position ?? null) : null,
    cancellationReason: r.cancellation_reason,
    isUpcoming: t.isUpcoming,
    isHappeningNow: t.isHappeningNow,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    permissions: memberPermissions({ status: t.status, start: t.start, end: t.end, venueActive: r.venue_active }, s, localNow),
  };
}

export function toBooking(r: any, historyRows: any[], s: AppSettings, localNow: string): Booking {
  const summary = toBookingSummary(r, s, localNow);
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
    confirmedAt: iso(r.confirmed_at),
    queuedAt: iso(r.queued_at),
    cancelledBy: r.cancelled_by ? { id: r.cancelled_by, fullName: r.cancelled_by_name, role: r.cancelled_by_role } : null,
    cancelledAt: iso(r.cancelled_at),
    version: r.version,
    history: mapHistory(historyRows),
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
    endDate: t.endDate,
    days: t.days,
    startTime: r.start_time,
    endTime: r.end_time,
    start: t.start,
    end: t.end,
    durationMinutes: t.durationMinutes,
    purpose: r.purpose,
    expectedAttendees: r.expected_attendees,
    idNumber: r.id_number ?? null,
    status: t.status,
    queuePosition: t.status === 'queued' ? (r.queue_position ?? null) : null,
    createdAt: iso(r.created_at)!,
    confirmedAt: iso(r.confirmed_at),
    version: r.version,
    permissions: adminPermissions(
      { status: t.status, start: t.start, end: t.end, venueActive: r.venue_active, requesterActive: r.requester_active },
      localNow,
    ),
  };
}

export function toAdminBooking(r: any, historyRows: any[], stats: { totalBookings: number; upcomingBookings: number }, localNow: string): AdminBooking {
  const item = toAdminListItem(r, localNow);
  return {
    ...item,
    requester: { ...item.requester, department: r.requester_department, stats },
    cancellationReason: r.cancellation_reason,
    queuedAt: iso(r.queued_at),
    cancelledBy: r.cancelled_by ? { id: r.cancelled_by, fullName: r.cancelled_by_name, role: r.cancelled_by_role } : null,
    cancelledAt: iso(r.cancelled_at),
    updatedAt: iso(r.updated_at)!,
    history: mapHistory(historyRows),
  };
}
