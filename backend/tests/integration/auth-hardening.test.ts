// Phase 2 security fixes (security/AUDIT.md): per-account sign-in back-off (F-02), Super Admin two-step verification
// (F-02), Super Admin session cap (F-10), password rules (F-09) and the push endpoint allowlist (F-07).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { config } from '../../src/config/env.js';
import { base32Decode, totp } from '../../src/lib/totp.js';
import { app, as, closePools, createUser, member, ORIGIN, PASSWORD, resetDb, signIn } from '../helpers/app.js';
import { pool } from '../helpers/db.js';

const signInRaw = (email: string, password: string) =>
  request(app).post('/api/auth/sign-in/email').set('origin', ORIGIN).send({ email, password });

/** Asks Better Auth for a reset link and reads the token from its verification table (the email goes to the outbox). */
async function resetToken(email: string, userId: string): Promise<string> {
  const res = await request(app).post('/api/auth/request-password-reset').set('origin', ORIGIN).send({ email, redirectTo: `${ORIGIN}/reset-password` });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const { rows } = await pool.query(
    `select identifier from auth_verifications where value = $1 and identifier like 'reset-password:%' order by created_at desc limit 1`,
    [userId],
  );
  return rows[0].identifier.slice('reset-password:'.length);
}

beforeAll(resetDb);
afterAll(closePools);

describe('per-account sign-in back-off (F-02)', () => {
  it('locks an account after 5 wrong passwords, before the password is even checked', async () => {
    await createUser('locked@hard.edu');
    for (let i = 0; i < 5; i++) expect((await signInRaw('locked@hard.edu', `Wrong-guess-${i}`)).status).toBe(401);
    const res = await signInRaw('locked@hard.edu', PASSWORD); // the right password, too late
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('SIGN_IN_LOCKED');
    expect(res.body.message).toMatch(/Try again in 1 minute/);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('stores no email address, only keyed hashes', async () => {
    const { rows } = await pool.query('select key, account_key from auth_login_throttle');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(`${r.key} ${r.account_key}`).not.toMatch(/@|locked|hard\.edu/);
  });

  it('answers an unknown email exactly like a real one (no account-existence oracle)', async () => {
    for (let i = 0; i < 5; i++) expect((await signInRaw('nobody@hard.edu', `Wrong-guess-${i}`)).status).toBe(401);
    const res = await signInRaw('nobody@hard.edu', 'Wrong-guess-x');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('SIGN_IN_LOCKED');
  });

  it("doesn't affect other accounts", async () => {
    await createUser('bystander@hard.edu');
    expect(await signIn('bystander@hard.edu')).toBeTruthy();
  });

  it('a successful sign-in starts the counter over', async () => {
    await createUser('typo@hard.edu');
    for (let i = 0; i < 4; i++) await signInRaw('typo@hard.edu', 'Wrong-guess-1');
    expect((await signInRaw('typo@hard.edu', PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) await signInRaw('typo@hard.edu', 'Wrong-guess-2');
    expect((await signInRaw('typo@hard.edu', PASSWORD)).status).toBe(200);
  });

  it('a password reset lifts the lock (the owner proved control of the mailbox)', async () => {
    const { rows } = await pool.query("select id from profiles where email = 'locked@hard.edu'");
    const token = await resetToken('locked@hard.edu', rows[0].id);
    const reset = await request(app).post('/api/auth/reset-password').set('origin', ORIGIN).send({ newPassword: 'BrandNewPass99', token });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect((await signInRaw('locked@hard.edu', 'BrandNewPass99')).status).toBe(200);
  });

  it('a deactivated account (403) is not counted as a guess', async () => {
    const id = await createUser('gone@hard.edu');
    await pool.query('update profiles set is_active = false where id = $1', [id]);
    for (let i = 0; i < 6; i++) expect((await signInRaw('gone@hard.edu', PASSWORD)).status).toBe(403);
  });
});

describe('password rules (F-09)', () => {
  it('refuses a common password everywhere a password is set', async () => {
    const stu = await member('rules@hard.edu');
    const res = await as(stu.token).post('/me/change-password', { currentPassword: PASSWORD, newPassword: 'Password123' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.newPassword[0]).toMatch(/too common/);
    const reg = await request(app).post('/api/v1/auth/register').set('origin', ORIGIN).send({ fullName: 'Common Pw', email: 'common@hard.edu', password: 'Qwerty123' });
    expect(reg.status).toBe(400);
  });
});

describe('push endpoint allowlist (F-07)', () => {
  it('refuses a push endpoint outside the browser push services', async () => {
    const stu = await member('push@hard.edu');
    const keys = { p256dh: 'BOr-key', auth: 'auth-secret' };
    const evil = await as(stu.token).post('/me/push-subscriptions', { endpoint: 'https://attacker.example/hook', keys });
    expect(evil.status).toBe(400);
    // A real push service passes validation (push itself is not configured in tests → 404 from the service).
    const fcm = await as(stu.token).post('/me/push-subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys });
    expect(fcm.status).toBe(404);
  });
});

describe('Super Admin two-step verification (F-02)', () => {
  let adminId: string;
  let first: string; // the session that enrols
  let secret: Buffer;
  let enabledWith: string; // the exact code that turned it on (already used)
  let recovery: string[];
  const dashboard = (token: string) => as(token).get('/admin/dashboard');

  beforeAll(async () => {
    (config as { SUPER_ADMIN_MFA: string }).SUPER_ADMIN_MFA = 'required';
    const admin = await member('root@hard.edu', 'super_admin');
    adminId = admin.id;
    first = admin.token;
  });
  afterAll(() => {
    (config as { SUPER_ADMIN_MFA: string }).SUPER_ADMIN_MFA = 'off';
  });

  it('a new Super Admin must set it up before using the admin API; /me explains why', async () => {
    const me = await as(first).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.data.mfa).toEqual({ required: true, enrolled: false, verified: false, recoveryCodesLeft: null });
    const res = await dashboard(first);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    // Other signed-in routes are closed too
    expect((await as(first).get('/notifications/unread-count')).body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('setup needs the password, returns a QR code, and stores the secret encrypted', async () => {
    expect((await as(first).post('/me/mfa/setup', { password: 'Not-my-password1' })).body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    const res = await as(first).post('/me/mfa/setup', { password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.data.qrSvg).toContain('<svg');
    secret = base32Decode(res.body.data.secret);
    const stored = (await pool.query('select pending_secret from user_mfa where user_id = $1', [adminId])).rows[0].pending_secret;
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain(res.body.data.secret.replace(/\s+/g, ''));
  });

  it('enable refuses a wrong code, accepts the right one and returns 10 recovery codes', async () => {
    const right = totp(secret);
    const wrong = String((Number(right) + 500_000) % 1_000_000).padStart(6, '0');
    expect((await as(first).post('/me/mfa/enable', { code: wrong })).body.error.code).toBe('MFA_INVALID_CODE');
    const res = await as(first).post('/me/mfa/enable', { code: right });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    enabledWith = right;
    recovery = res.body.data.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(new Set(recovery).size).toBe(10);
    // Hashes only in the database
    const row = (await pool.query('select recovery_codes from user_mfa where user_id = $1', [adminId])).rows[0];
    expect(row.recovery_codes.join(' ')).not.toContain(recovery[0]!.replace('-', ''));
    // The enrolling session is verified; it can work now
    expect((await dashboard(first)).status).toBe(200);
    const audit = await pool.query("select 1 from audit_logs where action = 'user.mfa_enabled' and entity_id = $1", [adminId]);
    expect(audit.rowCount).toBe(1);
  });

  it('a new sign-in needs a code; a code is accepted once', async () => {
    const second = await signIn('root@hard.edu');
    expect((await dashboard(second)).body.error.code).toBe('MFA_REQUIRED');
    expect((await as(second).get('/me')).body.data.mfa).toMatchObject({ required: true, enrolled: true, verified: false });
    // Replaying the code that enabled it: its time step was already used (or it has expired) → refused
    expect((await as(second).post('/me/mfa/verify', { code: enabledWith })).body.error.code).toBe('MFA_INVALID_CODE');
    // The next step's code (inside the ±1 drift window) is new → accepted
    const next = await as(second).post('/me/mfa/verify', { code: totp(secret, Date.now() + 30_000) });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.data.usedRecoveryCode).toBe(false);
    expect((await dashboard(second)).status).toBe(200);
  });

  it('a recovery code works once and is audited', async () => {
    const third = await signIn('root@hard.edu');
    const ok = await as(third).post('/me/mfa/verify', { code: recovery[0]!.toUpperCase() });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ usedRecoveryCode: true, recoveryCodesLeft: 9 });
    const fourth = await signIn('root@hard.edu');
    expect((await as(fourth).post('/me/mfa/verify', { code: recovery[0]! })).body.error.code).toBe('MFA_INVALID_CODE');
    expect((await pool.query("select 1 from audit_logs where action = 'user.mfa_recovery_code_used'")).rowCount).toBe(1);
  });

  it('5 wrong codes pause the step, even for a right code', async () => {
    await pool.query('update user_mfa set failed_attempts = 0, locked_until = null where user_id = $1', [adminId]);
    const fifth = await signIn('root@hard.edu');
    for (let i = 0; i < 5; i++) expect((await as(fifth).post('/me/mfa/verify', { code: '000000' === totp(secret) ? '111111' : '000000' })).status).toBe(422);
    const locked = await as(fifth).post('/me/mfa/verify', { code: totp(secret, Date.now() + 30_000) });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('MFA_LOCKED');
    await pool.query('update user_mfa set failed_attempts = 0, locked_until = null where user_id = $1', [adminId]);
  });

  it('Super Admin passwords need 12 characters (change and reset)', async () => {
    const res = await as(first).post('/me/change-password', { currentPassword: PASSWORD, newPassword: 'Shortpw123x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.newPassword[0]).toMatch(/at least 12/);
    const token = await resetToken('root@hard.edu', adminId);
    const reset = await request(app).post('/api/auth/reset-password').set('origin', ORIGIN).send({ newPassword: 'Shortpw123x', token });
    expect(reset.status).toBe(400);
    expect(reset.body.code).toBe('WEAK_PASSWORD');
    expect(reset.body.message).toMatch(/at least 12/);
  });

  it('members are unaffected and cannot use the two-step endpoints', async () => {
    const stu = await member('member@hard.edu');
    expect((await as(stu.token).get('/me')).body.data.mfa).toEqual({ required: false, enrolled: false, verified: true, recoveryCodesLeft: null });
    expect((await as(stu.token).get('/bookings')).status).toBe(200);
    expect((await as(stu.token).post('/me/mfa/setup', { password: PASSWORD })).body.error.code).toBe('FORBIDDEN');
  });

  it('a Super Admin session ends after SUPER_ADMIN_SESSION_HOURS whatever its activity (F-10)', async () => {
    expect((await dashboard(first)).status).toBe(200);
    await pool.query("update auth_sessions set created_at = now() - interval '13 hours' where user_id = $1", [adminId]);
    const res = await dashboard(first);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/admin session has ended/);
    expect((await pool.query('select count(*)::int as n from auth_sessions where user_id = $1', [adminId])).rows[0].n).toBeLessThan(6);
  });
});

describe('two-step verification switched off (SUPER_ADMIN_MFA=off, the setting since 2026-11-19)', () => {
  const setMode = (m: 'required' | 'off') => ((config as { SUPER_ADMIN_MFA: string }).SUPER_ADMIN_MFA = m);

  it('a Super Admin who already set up an authenticator signs in with the password only', async () => {
    setMode('required');
    try {
      const admin = await member('enrolled-then-off@hard.edu', 'super_admin');
      const setup = await as(admin.token).post('/me/mfa/setup', { password: PASSWORD });
      const s = base32Decode(setup.body.data.secret);
      expect((await as(admin.token).post('/me/mfa/enable', { code: totp(s) })).status).toBe(200);
    } finally {
      setMode('off');
    }
    const fresh = await signIn('enrolled-then-off@hard.edu');
    expect((await as(fresh).get('/admin/dashboard')).status).toBe(200);
    const me = await as(fresh).get('/me');
    expect(me.body.data.mfa).toMatchObject({ required: false, enrolled: true, verified: true });
  });
});
