// Cross-field settings validation on the merged result (§4.4, E46).

import { timeToMinutes } from '../time.js';

export interface SettingsCrossFieldInput {
  operatingHoursStart: string;
  operatingHoursEnd: string;
  timeStepMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  allowedEmailDomains: string[];
}

export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

export function validateSettingsCrossFields(s: SettingsCrossFieldInput): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (field: string, message: string) => (errors[field] ??= []).push(message);
  const open = timeToMinutes(s.operatingHoursStart);
  const close = timeToMinutes(s.operatingHoursEnd);
  const step = s.timeStepMinutes;

  if (close <= open) add('operatingHoursEnd', 'Closing time must be after opening time');
  if (open % step !== 0) add('operatingHoursStart', `Opening time must align to the ${step}-minute step`);
  if (close % step !== 0) add('operatingHoursEnd', `Closing time must align to the ${step}-minute step`);
  if (s.minDurationMinutes > s.maxDurationMinutes)
    add('maxDurationMinutes', 'Maximum duration must be at least the minimum duration');
  if (s.minDurationMinutes % step !== 0)
    add('minDurationMinutes', `Minimum duration must be a multiple of ${step} minutes`);
  if (s.maxDurationMinutes % step !== 0)
    add('maxDurationMinutes', `Maximum duration must be a multiple of ${step} minutes`);
  if (close > open && close - open < s.minDurationMinutes)
    add('operatingHoursEnd', 'The operating window must be at least the minimum duration');
  if (s.allowedEmailDomains.length > 20) add('allowedEmailDomains', 'Add at most 20 domains');
  for (const d of s.allowedEmailDomains) {
    if (!DOMAIN_RE.test(d)) add('allowedEmailDomains', `"${d}" is not a valid domain`);
  }
  return errors;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function domainAllowed(email: string, allowed: string[]): boolean {
  return allowed.length === 0 || allowed.includes(emailDomain(email));
}

export function domainRestrictionMessage(allowed: string[]): string {
  return `Use an email address ending in ${allowed.map((d) => `@${d}`).join(' or ')}.`;
}
