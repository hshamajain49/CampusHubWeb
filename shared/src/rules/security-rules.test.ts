import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, isCommonPassword } from './security-rules.js';
import { mfaCodeBody, passwordSchema, pushSubscriptionBody } from '../schemas/index.js';

describe('isCommonPassword (security/AUDIT.md F-09)', () => {
  it.each([
    'password1', 'Password123', 'PASSW0RD', 'qwerty123', '1q2w3e4r', 'abcd1234', 'Admin@123', 'Welcome2025!',
    'india@123', 'campushub123', 'CampusHub#1', 'student2024', 'aaaa1111', '12345678a', 'a12345678',
    // The demo passwords published in this public repository
    'Admin12345', 'Student12345', 'Faculty12345', 'Staff12345',
  ])('rejects %s', (pw) => expect(isCommonPassword(pw)).toBe(true));

  it.each([
    // Passwords the test suites and e2e use must stay valid
    'Testing12345', 'Temp12345', 'Delete12345', 'BrandNewPass99',
    'correct-horse-battery-7', 'Tr0ub4dor&3', 'Lecture hall 42 rocks', 'mango7Kite!river',
  ])('accepts %s', (pw) => expect(isCommonPassword(pw)).toBe(false));

  it('is part of passwordSchema with a clear message', () => {
    const r = passwordSchema.safeParse('Password123');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/too common/);
    expect(passwordSchema.safeParse('Testing12345').success).toBe(true);
  });
});

describe('isAllowedPushEndpoint (security/AUDIT.md F-07)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGa3',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://api.push.apple.com/3/device/x',
  ])('allows %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    'https://evil.example/collect',
    'https://fcm.googleapis.com.evil.example/x', // suffix trick
    'https://evilnotify.windows.com/x', // no dot boundary
    'http://fcm.googleapis.com/fcm/send/x', // not https
    'https://user:pw@fcm.googleapis.com/x', // credentials
    'https://fcm.googleapis.com:8443/x', // other port
    'https://169.254.169.254/latest/meta-data',
    'not a url',
  ])('refuses %s', (url) => expect(isAllowedPushEndpoint(url)).toBe(false));

  it('is enforced by pushSubscriptionBody', () => {
    const keys = { p256dh: 'k', auth: 'a' };
    expect(pushSubscriptionBody.safeParse({ endpoint: 'https://evil.example/x', keys }).success).toBe(false);
    expect(pushSubscriptionBody.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys }).success).toBe(true);
  });
});

describe('mfaCodeBody', () => {
  it('accepts 6 digits and recovery codes, normalising spaces', () => {
    expect(mfaCodeBody.parse({ code: ' 123 456 ' }).code).toBe('123456');
    expect(mfaCodeBody.parse({ code: 'abcde-fghij' }).code).toBe('abcde-fghij');
    expect(mfaCodeBody.parse({ code: 'ABCDEFGHIJ' }).code).toBe('ABCDEFGHIJ');
  });
  it.each(['12345', '1234567', 'abc', '', "1' or '1'='1"])('refuses %j', (code) => expect(mfaCodeBody.safeParse({ code }).success).toBe(false));
});
