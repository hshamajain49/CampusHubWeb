// Integration helpers (§28.3): the real Express app, real Better Auth, the test database on :5433.
import request from 'supertest';
import type { Role } from '@campushub/shared';
import { createApp } from '../../src/app.js';
import { pool as appPool } from '../../src/db/pool.js';
import { createCredentialUser, hashPassword } from '../../src/lib/auth-accounts.js';
import { pool, truncateAll } from './db.js';

export const app = createApp();
export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Testing12345';

let hash: string | null = null;

export async function resetDb() {
  await truncateAll();
}

export async function closePools() {
  // After-commit deliveries (file-outbox email, email_log rows) finish shortly after the response.
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query("select count(*)::int as n from notifications where email_status in ('pending', 'sending')");
    if (rows[0].n === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 200));
  await Promise.allSettled([pool.end(), appPool.end()]);
}

export async function createUser(email: string, role: Role = 'student', name = email.split('@')[0]!): Promise<string> {
  hash ??= await hashPassword(PASSWORD);
  const c = await appPool.connect();
  try {
    await c.query('begin');
    const id = await createCredentialUser(c, { email, name, passwordHash: hash });
    if (role !== 'student') await c.query('update profiles set role = $2 where id = $1', [id, role]);
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/auth/sign-in/email').set('origin', ORIGIN).send({ email, password });
  const token = res.headers['set-auth-token'];
  if (!token) throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return token as string;
}

/** A signed-in user: { id, token }. */
export async function member(email: string, role: Role = 'student') {
  const id = await createUser(email, role);
  return { id, token: await signIn(email) };
}

export function as(token: string) {
  const auth = (r: request.Test) => r.set('authorization', `Bearer ${token}`).set('origin', ORIGIN);
  return {
    get: (p: string) => auth(request(app).get(`/api/v1${p}`)),
    post: (p: string, body?: object) => auth(request(app).post(`/api/v1${p}`)).send(body ?? {}),
    patch: (p: string, body: object) => auth(request(app).patch(`/api/v1${p}`)).send(body),
    delete: (p: string) => auth(request(app).delete(`/api/v1${p}`)),
  };
}

export async function createVenue(name = 'Integration Hall', capacity = 80): Promise<string> {
  const { rows } = await pool.query(
    `insert into venues (name, venue_type, building, capacity, description)
     values ($1, 'seminar_hall', 'Block I', $2, 'Venue for integration tests') returning id`,
    [name, capacity],
  );
  return rows[0].id;
}

/** Campus 'today + n' (truncateAll sets the campus timezone to UTC). */
export async function campusDate(n: number): Promise<string> {
  const { rows } = await pool.query(`select to_char((now() at time zone 'UTC')::date + $1::int, 'YYYY-MM-DD') as d`, [n]);
  return rows[0].d;
}

export const slot = (venueId: string, date: string, startTime = '10:00', endTime = '12:00', purpose = 'Integration seminar') => ({
  venueId,
  date,
  startTime,
  endTime,
  purpose,
});
