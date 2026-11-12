// Pure complaint rules: permission flags per viewer, auto-resolve/reopen dates (CB-21), slugs, image sniffing.
import { describe, expect, it } from 'vitest';
import type { ComplaintPermissions, ComplaintStatus } from '@campushub/shared';
import { adminPermissions, autoResolveAt, reporterPermissions, reporterReopenUntil, staffPermissions } from '../../src/domain/complaint-rules.js';
import { slugify } from '../../src/modules/complaint-setup/complaint-setup.service.js';
import { sniffImageType } from '../../src/lib/images.js';

const DAY = 86_400_000;
const state = (status: ComplaintStatus, extra: Partial<Parameters<typeof staffPermissions>[0]> = {}) => ({
  status,
  reassignmentRequested: false,
  workCompletedAt: null,
  resolvedAt: null,
  autoResolved: false,
  ...extra,
});
const on = (p: ComplaintPermissions) => (Object.keys(p) as (keyof ComplaintPermissions)[]).filter((k) => p[k]).sort();

describe('complaint permissions', () => {
  it('reporter: approve/reject while awaiting, withdraw while pending, nothing else', () => {
    expect(on(reporterPermissions(state('pending_review'), 7))).toEqual(['canWithdraw']);
    expect(on(reporterPermissions(state('in_progress'), 7))).toEqual([]);
    expect(on(reporterPermissions(state('awaiting_confirmation'), 7))).toEqual(['canApprove', 'canReject']);
    expect(on(reporterPermissions(state('resolved'), 7))).toEqual([]);
    expect(on(reporterPermissions(state('closed'), 7))).toEqual([]);
  });

  it('reporter reopen only for auto-resolved complaints inside the window (CB-21)', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const auto = (daysAgo: number) => state('resolved', { autoResolved: true, resolvedAt: new Date(now.getTime() - daysAgo * DAY) });
    expect(reporterPermissions(auto(2), 7, now).canReopen).toBe(true);
    expect(reporterPermissions(auto(7.01), 7, now).canReopen).toBe(false);
    expect(reporterPermissions(auto(2), 0, now).canReopen).toBe(false);
    expect(reporterPermissions(state('resolved', { resolvedAt: now }), 7, now).canReopen).toBe(false); // approved by the reporter
    expect(reporterReopenUntil(auto(2), 7)?.toISOString()).toBe(new Date(now.getTime() + 5 * DAY).toISOString());
    expect(reporterReopenUntil(auto(2), 0)).toBeNull();
  });

  it('staff: start, complete, reopen and request reassignment by status', () => {
    expect(on(staffPermissions(state('pending_review')))).toEqual(['canRequestReassignment', 'canStart']);
    expect(on(staffPermissions(state('in_progress')))).toEqual(['canComplete', 'canRequestReassignment']);
    expect(on(staffPermissions(state('in_progress', { reassignmentRequested: true })))).toEqual(['canComplete']);
    expect(on(staffPermissions(state('awaiting_confirmation')))).toEqual([]);
    expect(on(staffPermissions(state('resolved')))).toEqual(['canReopen']);
    expect(on(staffPermissions(state('withdrawn')))).toEqual([]);
  });

  it('admin: staff actions + reassign/close; reporter actions only on their own complaint', () => {
    expect(on(adminPermissions(state('pending_review'), false))).toEqual(['canClose', 'canReassign', 'canStart']);
    expect(on(adminPermissions(state('pending_review'), true))).toEqual(['canClose', 'canReassign', 'canStart', 'canWithdraw']);
    expect(on(adminPermissions(state('awaiting_confirmation'), false))).toEqual(['canClose']);
    expect(on(adminPermissions(state('awaiting_confirmation'), true))).toEqual(['canApprove', 'canClose', 'canReject']);
    expect(on(adminPermissions(state('resolved'), true))).toEqual(['canReopen']);
    expect(on(adminPermissions(state('closed'), false))).toEqual([]);
  });

  it('auto-resolve date only while awaiting and enabled', () => {
    const done = new Date('2026-11-10T14:00:00Z');
    expect(autoResolveAt(state('awaiting_confirmation', { workCompletedAt: done }), 7)?.toISOString()).toBe('2026-11-17T14:00:00.000Z');
    expect(autoResolveAt(state('awaiting_confirmation', { workCompletedAt: done }), null)).toBeNull();
    expect(autoResolveAt(state('in_progress', { workCompletedAt: done }), 7)).toBeNull();
  });
});

describe('category slugs and image sniffing', () => {
  it('slugify: lowercase ASCII with underscores, ≤ 50 characters', () => {
    expect(slugify('Security')).toBe('security');
    expect(slugify('IT / Network & Wi-Fi')).toBe('it_network_wi_fi');
    expect(slugify('Café Hygiène')).toBe('cafe_hygiene');
    expect(slugify('  ¡¡!!  ')).toBe('category');
    expect(slugify('x'.repeat(80))).toHaveLength(50);
  });

  it('sniffImageType recognises JPEG, PNG and WebP signatures only', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(sniffImageType(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});
