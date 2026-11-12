import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? 'http://localhost:4000';
export const APP_NAME: string = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'CampusHub';

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'phd', 'md']);
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** First letter-like grapheme of a word (skips emoji and punctuation; never splits a surrogate pair). */
function firstLetter(word: string): string {
  const graphemes = segmenter ? [...segmenter.segment(word)].map((s) => s.segment) : Array.from(word);
  return graphemes.find((g) => /\p{L}/u.test(g)) ?? '';
}

/** "Aleksandra Wiśniewska-Kowalczyk" → "AW"; "Christopher … Montgomery III" → "CM"; "🦊 Fox" → "F"; "王秀英" → "王". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w && firstLetter(w));
  const core = words.length > 1 ? words.filter((w, i) => i === 0 || !SUFFIXES.has(w.toLowerCase())) : words;
  if (!core.length) return '?';
  const first = firstLetter(core[0]!);
  const last = core.length > 1 ? firstLetter(core[core.length - 1]!) : '';
  return (first + last).toLocaleUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
