// TOTP against the RFC 6238 Appendix B test vectors (SHA-1) and RFC 4648 base32 vectors.
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUrl, totp, totpStep, verifyTotp } from '../../src/lib/totp.js';
import { decryptSecret, encryptSecret } from '../../src/modules/mfa/mfa.service.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('RFC 6238 Appendix B (SHA-1, 8 digits)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i → %s', (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
  });

  it('RFC 4226 Appendix D HOTP values (6 digits)', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, i) => hotp(RFC_SECRET, i))).toEqual(expected);
  });
});

describe('base32 (RFC 4648 §10, unpadded)', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('%j ↔ %s', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });
  it('round-trips a 20-byte secret and ignores case and spaces', () => {
    const s = Buffer.from('0123456789abcdefghij');
    const enc = base32Encode(s);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(s);
  });
  it('refuses characters outside the alphabet', () => expect(() => base32Decode('MZ1W')).toThrow());
});

describe('verifyTotp', () => {
  const now = 1_700_000_000_000;
  it('returns the matched step, allowing one step of drift either way', () => {
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
  });
  it('refuses codes two steps away, wrong codes and non-digits', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 60_000), now)).toBeNull();
    const right = totp(RFC_SECRET, now);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotp(RFC_SECRET, wrong, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12a456', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBeNull();
  });
  it('builds a Key Uri Format URL', () => {
    const url = new URL(otpauthUrl(RFC_SECRET, 'CampusHub (Demo)', 'admin@college.edu'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe(base32Encode(RFC_SECRET));
    expect(url.searchParams.get('issuer')).toBe('CampusHub (Demo)');
    expect(url.searchParams.get('period')).toBe('30');
  });
});

describe('secret encryption at rest', () => {
  it('round-trips, never stores the plain secret, and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('detects tampering (GCM tag)', () => {
    const [v, iv, ct, tag] = encryptSecret('JBSWY3DPEHPK3PXP').split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => decryptSecret([v, iv, flipped.toString('base64url'), tag].join('.'))).toThrow();
  });
});
