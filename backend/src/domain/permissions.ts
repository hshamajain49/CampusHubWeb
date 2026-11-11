// Permission flags (§15.2). The same functions guard the endpoints, so the UI can never grant extra access.
import type { AdminBookingPermissions, BookingPermissions, BookingStatus } from '@campushub/shared';
import type { AppSettings } from './settings.js';
import { minutesUntil } from './booking-rules.js';

interface PermInput {
  status: BookingStatus;
  start: string; // LocalDateTime
  venueActive: boolean;
  requesterActive?: boolean;
}

export function memberPermissions(b: PermInput, s: AppSettings, localNow: string): BookingPermissions {
  const until = minutesUntil(b.start, localNow);
  const active = b.status === 'pending' || b.status === 'approved';
  return {
    canEdit: active && b.venueActive && until > s.modificationCutoffMinutes,
    canCancel: (b.status === 'pending' && until > 0) || (b.status === 'approved' && until > s.cancellationCutoffMinutes),
    canDownloadConfirmation: b.status === 'approved',
    canRebook: b.venueActive,
  };
}

export function adminPermissions(b: PermInput, localNow: string): AdminBookingPermissions {
  const future = minutesUntil(b.start, localNow) > 0;
  return {
    canApprove: b.status === 'pending' && future && b.venueActive && b.requesterActive !== false,
    canReject: b.status === 'pending',
    canCancel: b.status === 'approved' && future,
    canDownloadConfirmation: b.status === 'approved',
  };
}
