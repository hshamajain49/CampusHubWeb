// §15.2 permission flags — the same functions guard the endpoints (docs/BOOKINGS.md).
import { describe, expect, it } from 'vitest';
import { adminPermissions, canCancelBooking, memberPermissions } from '../../src/domain/permissions.js';
import type { AppSettings } from '../../src/domain/settings.js';

const s = { modificationCutoffMinutes: 120 } as AppSettings;
const now = '2026-11-20T08:00:00';

describe('memberPermissions', () => {
  it('opens edit and cancel well before the start', () => {
    expect(memberPermissions({ status: 'confirmed', start: '2026-11-20T12:00', end: '2026-11-20T14:00', venueActive: true }, s, now)).toEqual({
      canEdit: true,
      canCancel: true,
      canDownloadConfirmation: true,
      canRebook: true,
    });
  });

  it('closes edits inside the modification cut-off but still allows cancelling', () => {
    const p = memberPermissions({ status: 'confirmed', start: '2026-11-20T09:30', end: '2026-11-20T10:30', venueActive: true }, s, now);
    expect(p.canEdit).toBe(false);
    expect(p.canCancel).toBe(true);
  });

  it('lets a confirmed booking be cancelled at any time until it ends, even once it started', () => {
    const running = { status: 'confirmed' as const, start: '2026-11-20T07:00', end: '2026-11-20T09:00', venueActive: true };
    expect(memberPermissions(running, s, now).canCancel).toBe(true);
    expect(memberPermissions({ ...running, end: '2026-11-20T08:00' }, s, now).canCancel).toBe(false);
  });

  it('lets a queued request be cancelled until its start (when it expires)', () => {
    expect(canCancelBooking({ status: 'queued', start: '2026-11-20T08:30', end: '2026-11-20T09:30' }, now)).toBe(true);
    expect(canCancelBooking({ status: 'queued', start: '2026-11-20T07:30', end: '2026-11-20T09:30' }, now)).toBe(false);
  });

  it('offers the confirmation PDF for confirmed and completed bookings only', () => {
    const base = { start: '2026-11-25T10:00', end: '2026-11-25T11:00', venueActive: true };
    expect(memberPermissions({ ...base, status: 'confirmed' }, s, now).canDownloadConfirmation).toBe(true);
    expect(memberPermissions({ ...base, status: 'completed' }, s, now).canDownloadConfirmation).toBe(true);
    expect(memberPermissions({ ...base, status: 'queued' }, s, now).canDownloadConfirmation).toBe(false);
  });

  it('disables editing and rebooking on inactive venues', () => {
    const p = memberPermissions({ status: 'queued', start: '2026-11-25T10:00', end: '2026-11-25T11:00', venueActive: false }, s, now);
    expect(p.canEdit).toBe(false);
    expect(p.canRebook).toBe(false);
  });

  it('never allows changes to final bookings', () => {
    for (const status of ['completed', 'cancelled', 'expired'] as const) {
      const p = memberPermissions({ status, start: '2026-11-25T10:00', end: '2026-11-25T11:00', venueActive: true }, s, now);
      expect(p).toMatchObject({ canEdit: false, canCancel: false });
    }
  });
});

describe('adminPermissions', () => {
  it('has no approval actions: admins can only cancel', () => {
    expect(Object.keys(adminPermissions({ status: 'queued', start: '2026-11-21T10:00', end: '2026-11-21T11:00', venueActive: true }, now)).sort()).toEqual([
      'canCancel',
      'canDownloadConfirmation',
    ]);
  });

  it('cancels confirmed bookings until they end and queued requests until they start', () => {
    expect(adminPermissions({ status: 'confirmed', start: '2026-11-20T07:00', end: '2026-11-20T09:00', venueActive: true }, now).canCancel).toBe(true);
    expect(adminPermissions({ status: 'confirmed', start: '2026-11-20T06:00', end: '2026-11-20T07:00', venueActive: true }, now).canCancel).toBe(false);
    expect(adminPermissions({ status: 'queued', start: '2026-11-21T10:00', end: '2026-11-21T11:00', venueActive: true }, now).canCancel).toBe(true);
  });
});
