// Security rules shared by the API and the SPA (security/AUDIT.md F-07, F-09).

/** Super Admin passwords: longer than the member minimum (8), because one account controls everything. */
export const SUPER_ADMIN_MIN_PASSWORD_LENGTH = 12;

export const COMMON_PASSWORD_MESSAGE = 'This password is too common. Choose something harder to guess.';

/**
 * Exact passwords that pass the letter + digit rule but appear near the top of every breached-password list,
 * plus this project's own published demo passwords. Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p4ssw0rd', 'p@ssw0rd', 'p@ssword1',
  'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyuiop1', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', '1qaz2wsx3edc',
  'zaq12wsx', 'abc12345', 'abcd1234', 'abc123456', 'a1b2c3d4', 'asdf1234', 'asdfgh123', 'zxcvbnm1', 'iloveyou1',
  'iloveyou2', 'trustno1', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'admin1234', 'administrator1',
  'test1234', 'test12345', 'testing1', 'changeme1', 'sunshine1', 'princess1', 'football1', 'baseball1',
  'superman1', 'batman123', 'monkey123', 'dragon123', 'master123', 'shadow123', 'hello123', 'hello1234',
  'computer1', 'internet1', 'secret123', 'qazwsx123', 'michael1', 'jennifer1', 'charlie1', 'cricket1',
  'india123', 'india@123', 'india1234', 'pass@123', 'pass@1234', 'admin@123', 'welcome@123', 'password@123',
  'student123', 'student1', 'college123', 'campus123', 'campushub1', 'campushub123',
  'admin12345', 'student12345', 'faculty12345', 'staff12345',
]);

/**
 * "<common word><digits or symbols>" (Password2024!, admin@2025, campushub#1): the word carries all the entropy
 * an attacker needs to guess, whatever trails it.
 */
const COMMON_STEM =
  /^(password|passw0rd|p@ssw0rd|pass|qwerty|asdfgh|zxcvbn|abcd?|admin|administrator|welcome|letmein|iloveyou|changeme|secret|login|user|demo|hello|monkey|dragon|master|football|cricket|sunshine|princess|summer|winter|spring|autumn|india|bharat|college|campus|campushub|university|student)[\d!@#$%^&*._\-+=?]*$/i;

/** Repeated or sequential runs that fill the whole password (aaaa1111, 12345678a, abcdefg1). */
const TRIVIAL = /^(.)\1{3,}(.)\2{3,}$|^(0123456789|123456789|12345678|987654321|abcdefgh|abcdefghij)[a-z0-9]?$|^[a-z]?(0123456789|123456789|12345678)$/i;

export function isCommonPassword(password: string): boolean {
  const p = password.trim().toLowerCase();
  return COMMON_PASSWORDS.has(p) || COMMON_STEM.test(p) || TRIVIAL.test(p);
}

/**
 * Hosts of the browser push services (Chrome/Edge/Opera via FCM, Firefox, Safari, legacy Edge via WNS). A push
 * subscription must point at one of them: the API sends POSTs to the endpoint, so any other host would let a user
 * aim server requests at an address of their choosing (blind SSRF).
 */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}
