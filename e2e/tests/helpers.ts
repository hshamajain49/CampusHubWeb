import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const API = (process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1$/, '');
export const STUDENT = { email: process.env.E2E_STUDENT_EMAIL ?? 'student@demo.edu', password: process.env.E2E_STUDENT_PASSWORD ?? 'Student12345' };
export const FACULTY = { email: process.env.E2E_FACULTY_EMAIL ?? 'faculty@demo.edu', password: process.env.E2E_FACULTY_PASSWORD ?? 'Faculty12345' };
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.edu', password: process.env.E2E_ADMIN_PASSWORD ?? 'Admin12345' };

export async function signInUi(page: Page, who: { email: string; password: string }, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function apiToken(who: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: process.env.E2E_BASE_URL ?? 'http://localhost:5173' },
    body: JSON.stringify(who),
  });
  const t = res.headers.get('set-auth-token');
  expect(t, `sign-in for ${who.email}`).toBeTruthy();
  return t!;
}

export async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return (body as { data: T }).data;
}

/** A free 2-hour slot on a weekday 20–80 days ahead, so reruns don't collide. */
export function freeSlot(seed = Date.now()) {
  const d = new Date();
  d.setDate(d.getDate() + 20 + (seed % 60));
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hour = 8 + ((Math.floor(seed / 60) % 5) * 2); // 08, 10, 12, 14, 16
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return { date, start: pad(hour), end: pad(hour + 2) };
}

/**
 * Removes complaints created by earlier e2e runs (titles start with "E2E " or "Mobile E2E "), so reruns never hit the
 * open-complaint limit. Local test database only (DATABASE_URL in e2e/.env); their photo objects are left for the sweep.
 */
export async function cleanE2eComplaints() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`delete from complaints where title like 'E2E %' or title like 'Mobile E2E %'`);
  } finally {
    await db.end();
  }
}
