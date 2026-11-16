// Permission flags (§15.2). The same functions guard the endpoints, so the UI can never grant extra access.
import type { AdminBookingPermissions, BookingPermissions, BookingStatus } from '@campushub/shared';
import type { AppSettings } from './settings.js';
import { minutesUntil } from './booking-rules.js';

interface PermInput {
  status: BookingStatus;
  start: string; // LocalDateTime
  end: string; // LocalDateTime
  venueActive: boolean;
  requesterActive?: boolean;
}

/**
 * A booking can be cancelled at any time until it ends (docs/BOOKINGS.md): a queued request until its start (when the
 * job expires it), a confirmed booking until its end.
 */
export function canCancelBooking(b: Pick<PermInput, 'status' | 'start' | 'end'>, localNow: string): boolean {
  if (b.status === 'queued') return minutesUntil(b.start, localNow) > 0;
  return b.status === 'confirmed' && minutesUntil(b.end, localNow) > 0;
}

export function memberPermissions(b: PermInput, s: AppSettings, localNow: string): BookingPermissions {
  const until = minutesUntil(b.start, localNow);
  const active = b.status === 'confirmed' || b.status === 'queued';
  return {
    canEdit: active && b.venueActive && until > s.modificationCutoffMinutes,
    canCancel: canCancelBooking(b, localNow),
    canDownloadConfirmation: b.status === 'confirmed' || b.status === 'completed',
    canRebook: b.venueActive,
  };
}

export function adminPermissions(b: PermInput, localNow: string): AdminBookingPermissions {
  return {
    canCancel: canCancelBooking(b, localNow),
    canDownloadConfirmation: b.status === 'confirmed' || b.status === 'completed',
  };
}
