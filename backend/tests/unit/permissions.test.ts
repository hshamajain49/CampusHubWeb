// §15.2 permission flags — the same functions guard the endpoints.
import { describe, expect, it } from 'vitest';
import { adminPermissions, memberPermissions } from '../../src/domain/permissions.js';
import type { AppSettings } from '../../src/domain/settings.js';

const s = { cancellationCutoffMinutes: 60, modificationCutoffMinutes: 120 } as AppSettings;
const now = '2026-11-20T08:00:00';

describe('memberPermissions', () => {
  it('opens edit and cancel well before the start', () => {
    expect(memberPermissions({ status: 'approved', start: '2026-11-20T12:00', venueActive: true }, s, now)).toEqual({
      canEdit: true,
      canCancel: true,
      canDownloadConfirmation: true,
      canRebook: true,
    });
  });

  it('closes edits inside the modification cut-off but still allows cancelling', () => {
    const p = memberPermissions({ status: 'approved', start: '2026-11-20T09:30', venueActive: true }, s, now);
    expect(p.canEdit).toBe(false);
    expect(p.canCancel).toBe(true);
  });

  it('lets pending requests be cancelled until they start, ignoring the approved cut-off', () => {
    expect(memberPermissions({ status: 'pending', start: '2026-11-20T08:30', venueActive: true }, s, now).canCancel).toBe(true);
    expect(memberPermissions({ status: 'approved', start: '2026-11-20T08:30', venueActive: true }, s, now).canCancel).toBe(false);
  });

  it('disables editing and rebooking on inactive venues', () => {
    const p = memberPermissions({ status: 'pending', start: '2026-11-25T10:00', venueActive: false }, s, now);
    expect(p.canEdit).toBe(false);
    expect(p.canRebook).toBe(false);
  });
});

describe('adminPermissions', () => {
  it('approves only future pending requests from active requesters on active venues', () => {
    const base = { status: 'pending' as const, start: '2026-11-21T10:00', venueActive: true };
    expect(adminPermissions(base, now).canApprove).toBe(true);
    expect(adminPermissions({ ...base, requesterActive: false }, now).canApprove).toBe(false);
    expect(adminPermissions({ ...base, venueActive: false }, now).canApprove).toBe(false);
    expect(adminPermissions({ ...base, start: '2026-11-20T07:00' }, now)).toMatchObject({ canApprove: false, canReject: true });
  });

  it('cancels only future approved bookings', () => {
    expect(adminPermissions({ status: 'approved', start: '2026-11-21T10:00', venueActive: true }, now).canCancel).toBe(true);
    expect(adminPermissions({ status: 'approved', start: '2026-11-20T07:00', venueActive: true }, now).canCancel).toBe(false);
  });
});
