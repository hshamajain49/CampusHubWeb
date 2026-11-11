import { z } from 'zod';
import { isValidDate } from '../time.js';

// IDs. z.guid() accepts any 8-4-4-4-12 hex string (test fixtures use non-v4 UUIDs).
export const uuid = z.guid({ message: 'Invalid ID' });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine(isValidDate, 'Enter a valid date.');

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid time (HH:mm).');

export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:00$/, 'Use YYYY-MM-DDTHH:mm:00')
  .refine((v) => isValidDate(v.slice(0, 10)), 'Enter a valid date.');

/** Removes ASCII control characters except \n and \t, collapses 3+ blank lines, trims (§21.6). */
export function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const text = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? 'Required' : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

export const trimmed = (min: number, max: number, message: string) =>
  z.string().trim().min(min, min <= 1 ? 'Required' : message).max(max, message);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Enter a valid email')
  .pipe(z.email('Enter a valid email'));

export const intFromQuery = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const boolFromQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

export function csvOf<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).max(10));
}

export const csvStrings = (maxLen: number) =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(maxLen)).max(10));

export const searchQ = z.string().trim().min(1).max(100);

export function pagination(defaultSize = 20, maxSize = 100) {
  return {
    page: intFromQuery(1, 100_000).default(1),
    pageSize: intFromQuery(1, maxSize).default(defaultSize),
  };
}

export function sortParam<T extends string>(allowed: readonly [T, ...T[]]) {
  return z.enum(allowed);
}

export type Pagination = { page: number; pageSize: number };
