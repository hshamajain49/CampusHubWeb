// Authorization matrix (Phase 8): every API route × every role, generated from the router table, so a new route is
// covered the day it is added. For each request it only asks "did the guard let it through?":
//   - anonymous → 401 UNAUTHENTICATED everywhere except the pinned public routes;
//   - a role outside the router's list → 403 FORBIDDEN;
//   - a role inside it → never 401 / FORBIDDEN (it may still get 400, 404, 409… from the handler).
// Requests carry random ids and empty bodies, so admitted calls stop at validation or "not found".
import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@campushub/shared';
import { routeTable } from '../../src/routes.js';
import { app, closePools, createUser, ORIGIN, resetDb, signIn } from '../helpers/app.js';

type Who = Role | 'anonymous';
const WHO: Who[] = ['anonymous', 'student', 'faculty_staff', 'department_staff', 'super_admin'];

/** The only routes anyone may call without signing in. Adding one must be a deliberate change to this list. */
const PUBLIC = new Set(['GET /api/v1/settings/public', 'POST /api/v1/auth/register']);

/** Routes whose own guard is narrower than their router's (role → why). */
const NARROWER: Record<string, Partial<Record<Role, string>>> = {
  'GET /api/v1/me/dashboard': { super_admin: 'member dashboard; the Super Admin has the admin dashboard' },
  ...Object.fromEntries(
    ['setup', 'enable', 'verify', 'recovery-codes'].map((p) => [
      `POST /api/v1/me/mfa/${p}`,
      { student: 'two-step verification is for Super Admins', faculty_staff: 'Super Admins only', department_staff: 'Super Admins only' },
    ]),
  ),
};

interface RouteDef {
  method: string;
  path: string;
  roles: Role[] | null;
}

function routesOf(): RouteDef[] {
  const out: RouteDef[] = [];
  for (const m of routeTable()) {
    for (const layer of (m.router as Router & { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
      if (!layer.route) continue;
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (!on || method === '_all') continue;
        out.push({ method: method.toUpperCase(), path: `${m.path}${layer.route.path === '/' ? '' : layer.route.path}`, roles: m.roles });
      }
    }
  }
  return out;
}

const tokens: Partial<Record<Who, string>> = {};
const ROUTES = routesOf();

beforeAll(async () => {
  await resetDb();
  for (const role of WHO) {
    if (role === 'anonymous') continue;
    const email = `matrix-${role.replace('_', '-')}@authz.edu`;
    await createUser(email, role, `Matrix ${role}`, role === 'department_staff' ? 'Electrical Department' : undefined);
    tokens[role] = await signIn(email);
  }
});
afterAll(closePools);

async function call(r: RouteDef, who: Who) {
  const url = r.path.replace(/:[A-Za-z]+/g, () => randomUUID());
  let req = request(app)[r.method.toLowerCase() as 'get'](url).set('origin', ORIGIN);
  if (who !== 'anonymous') req = req.set('authorization', `Bearer ${tokens[who]}`);
  if (r.method !== 'GET' && r.method !== 'DELETE') req = req.send({});
  const res = await req;
  return { status: res.status, code: (res.body?.error?.code ?? null) as string | null };
}

describe('authorization matrix', () => {
  it('finds every route (sanity check on the router walk)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(85);
    for (const p of PUBLIC) expect(ROUTES.some((r) => `${r.method} ${r.path}` === p), p).toBe(true);
    for (const p of Object.keys(NARROWER)) expect(ROUTES.some((r) => `${r.method} ${r.path}` === p), p).toBe(true);
  });

  it('every route admits exactly the roles its router declares, and nobody else', async () => {
    const violations: string[] = [];
    const matrix: Record<string, string> = {};
    for (const r of ROUTES) {
      const key = `${r.method} ${r.path}`;
      const cells: string[] = [];
      for (const who of WHO) {
        const { status, code } = await call(r, who);
        const blocked = status === 401 || code === 'FORBIDDEN' || code === 'UNAUTHENTICATED';
        cells.push(blocked ? '·' : '✓');
        let shouldPass: boolean;
        if (PUBLIC.has(key)) shouldPass = true;
        else if (who === 'anonymous') shouldPass = false;
        else if (NARROWER[key]?.[who as Role]) shouldPass = false;
        else shouldPass = r.roles === null || r.roles.includes(who as Role);
        if (r.roles === null && !PUBLIC.has(key)) violations.push(`${key}: on the public router but not in the PUBLIC list`);
        if (shouldPass && blocked) violations.push(`${key} as ${who}: refused (${status} ${code}) but should be admitted`);
        if (!shouldPass && !blocked) violations.push(`${key} as ${who}: admitted (${status} ${code ?? ''}) but should be refused`);
        if (!shouldPass && who === 'anonymous' && status !== 401) violations.push(`${key} anonymous: ${status} instead of 401`);
        if (!shouldPass && who !== 'anonymous' && code !== 'FORBIDDEN') violations.push(`${key} as ${who}: ${status} ${code} instead of 403 FORBIDDEN`);
      }
      matrix[key] = cells.join(' ');
    }
    if (process.env.PRINT_MATRIX) console.log(`route  ${WHO.join(' | ')}\n${Object.entries(matrix).map(([k, v]) => `${v}  ${k}`).join('\n')}`);
    expect([...new Set(violations)]).toEqual([]);
  }, 120_000);
});

describe("Better Auth's own endpoints that would bypass CampusHub's rules stay disabled", () => {
  it.each(['/sign-up/email', '/update-user', '/change-email', '/delete-user', '/change-password', '/list-sessions', '/revoke-sessions', '/link-social'])(
    'POST /api/auth%s → 404',
    async (p) => {
      const res = await request(app).post(`/api/auth${p}`).set('origin', ORIGIN).set('authorization', `Bearer ${tokens.student}`).send({});
      expect(res.status).toBe(404);
    },
  );
});
