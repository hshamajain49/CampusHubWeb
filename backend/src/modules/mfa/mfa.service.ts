// Two-step verification with an authenticator app (TOTP), required for Super Admins in production
// (security/AUDIT.md F-02). Better Auth's twoFactor plugin can't be used here: its sign-in step keeps state in a
// cookie, and CampusHub's SPA and API are on different sites with bearer tokens only. Instead the API marks a session
// as verified (auth_session_mfa) and requireMfa refuses unverified Super Admin sessions everywhere except the steps
// below.
//
//   setup   password → new secret (encrypted, 15-minute pending window) → QR code + manual key
//   enable  first valid code → secret becomes active, 10 recovery codes shown once, this session verified
//   verify  6-digit code (each time step usable once) or a single-use recovery code → session verified
// 5 wrong codes lock the step for 5 minutes, doubling up to an hour. A lost device is reset out of band:
// npm run reset-mfa -w @campushub/backend -- --email <address>
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { MfaRecoveryCodes, MfaSetup, MfaStatus, Role } from '@campushub/shared';
import { config } from '../../config/env.js';
import type { DbClient } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { appError } from '../../errors/app-error.js';
import { verifyPassword } from '../../lib/auth-accounts.js';
import { base32Encode, base32Decode, generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp.js';
import type { Actor } from '../../middleware/authenticate.js';
import { loadCampus } from '../../domain/settings.js';
import { audit } from '../audit/audit-writer.js';

const PENDING_MINUTES = 15;
const RECOVERY_CODE_COUNT = 10;
const LOCK = { threshold: 5, baseSeconds: 300, maxSeconds: 3600 } as const;

export function mfaRequiredFor(role: Role): boolean {
  return role === 'super_admin' && config.SUPER_ADMIN_MFA === 'required';
}

// ─────────────────────────── secret encryption (AES-256-GCM, key derived from BETTER_AUTH_SECRET) ───────────────────────────
// Rotating BETTER_AUTH_SECRET makes stored secrets unreadable; Super Admins then re-enrol after `reset-mfa`.
let key: Buffer | undefined;
const secretKey = () => (key ??= Buffer.from(hkdfSync('sha256', config.BETTER_AUTH_SECRET, 'campushub', 'totp-secret-v1', 32)));

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, ct, tag] = stored.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

// ─────────────────────────── recovery codes ───────────────────────────
const normaliseRecovery = (code: string) => code.replace(/[\s-]/g, '').toLowerCase();
const hashRecovery = (code: string) => createHash('sha256').update(normaliseRecovery(code)).digest('hex');

function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase(); // 50 bits each
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { plain, hashes: plain.map(hashRecovery) };
}

// ─────────────────────────── state ───────────────────────────
interface MfaRow {
  totp_secret: string | null;
  pending_secret: string | null;
  pending_fresh: boolean;
  enabled_at: Date | null;
  last_used_step: number;
  recovery_codes: string[];
  lock_seconds: number | null;
}

async function loadRow(db: DbClient, userId: string): Promise<MfaRow | null> {
  const { rows } = await db.query<MfaRow>(
    `select totp_secret, pending_secret, enabled_at, last_used_step, recovery_codes,
            (pending_created_at > now() - make_interval(mins => $2)) as pending_fresh,
            case when locked_until > now() then ceil(extract(epoch from locked_until - now()))::int end as lock_seconds
       from public.user_mfa where user_id = $1`,
    [userId, PENDING_MINUTES],
  );
  return rows[0] ?? null;
}

export async function mfaStatus(userId: string, role: Role, sessionId: string): Promise<MfaStatus> {
  const required = mfaRequiredFor(role);
  const { rows } = await pool.query<{ enabled: boolean; codes: number | null; verified: boolean }>(
    `select (m.enabled_at is not null) as enabled,
            case when m.enabled_at is not null then cardinality(m.recovery_codes) end as codes,
            exists (select 1 from public.auth_session_mfa s where s.session_id = $2) as verified
       from (select 1) one left join public.user_mfa m on m.user_id = $1`,
    [userId, sessionId],
  );
  const r = rows[0]!;
  return {
    required,
    enrolled: !!r.enabled,
    verified: !required || (!!r.enabled && r.verified),
    recoveryCodesLeft: r.enabled ? (r.codes ?? 0) : null,
  };
}

async function markSessionVerified(db: DbClient, sessionId: string) {
  await db.query('insert into public.auth_session_mfa (session_id) values ($1) on conflict (session_id) do nothing', [sessionId]);
}

/** One wrong code; the 5th and later lock the step (5 min, doubling, at most 1 h). */
async function recordFailure(userId: string) {
  await pool.query(
    `update public.user_mfa
        set failed_attempts = failed_attempts + 1,
            locked_until = case when failed_attempts + 1 >= $2
                                then now() + make_interval(secs => least($4::float8, $3::float8 * power(2, failed_attempts + 1 - $2)))
                                else locked_until end
      where user_id = $1`,
    [userId, LOCK.threshold, LOCK.baseSeconds, LOCK.maxSeconds],
  );
}

function lockedError(seconds: number) {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  return appError('MFA_LOCKED', `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, { retryAfterSeconds: seconds });
}

// ─────────────────────────── setup / enable ───────────────────────────
export async function setupMfa(actor: Actor & { email: string }, password: string): Promise<MfaSetup> {
  if (!(await verifyPassword(actor.id, password))) {
    throw appError('INVALID_CURRENT_PASSWORD', 'Your password is incorrect.', { field: 'password' });
  }
  const existing = await loadRow(pool, actor.id);
  if (existing?.enabled_at) throw appError('MFA_ALREADY_ENABLED');
  const secret = generateTotpSecret();
  const b32 = base32Encode(secret);
  await pool.query(
    `insert into public.user_mfa (user_id, pending_secret, pending_created_at) values ($1, $2, now())
     on conflict (user_id) do update set pending_secret = excluded.pending_secret, pending_created_at = now()`,
    [actor.id, encryptSecret(b32)],
  );
  const { settings } = await loadCampus(pool);
  const issuer = `CampusHub (${settings.institutionName})`.slice(0, 80);
  const url = otpauthUrl(secret, issuer, actor.email);
  const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  return { secret: b32.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl: url, qrSvg };
}

export async function enableMfa(actor: Actor, sessionId: string, code: string): Promise<MfaRecoveryCodes> {
  const row = await loadRow(pool, actor.id);
  if (row?.enabled_at) throw appError('MFA_ALREADY_ENABLED');
  if (!row?.pending_secret || !row.pending_fresh) throw appError('MFA_SETUP_EXPIRED');
  if (row.lock_seconds) throw lockedError(row.lock_seconds);
  const step = verifyTotp(base32Decode(decryptSecret(row.pending_secret)), code);
  if (step === null) {
    await recordFailure(actor.id);
    throw appError('MFA_INVALID_CODE');
  }
  const codes = newRecoveryCodes();
  await withTransaction({ actorId: actor.id }, async (tx) => {
    const res = await tx.query(
      `update public.user_mfa
          set totp_secret = pending_secret, pending_secret = null, pending_created_at = null, enabled_at = now(),
              last_used_step = $2, recovery_codes = $3, failed_attempts = 0, locked_until = null
        where user_id = $1 and enabled_at is null and pending_secret is not null`,
      [actor.id, step, codes.hashes],
    );
    if (!res.rowCount) throw appError('MFA_ALREADY_ENABLED');
    await markSessionVerified(tx, sessionId);
    await audit(tx, actor, { action: 'user.mfa_enabled', entityType: 'user', entityId: actor.id, summary: 'Turned on two-step verification' });
  });
  return { recoveryCodes: codes.plain };
}

// ─────────────────────────── verify ───────────────────────────
export async function verifyMfa(actor: Actor, sessionId: string, code: string): Promise<{ usedRecoveryCode: boolean; recoveryCodesLeft: number }> {
  const row = await loadRow(pool, actor.id);
  if (!row?.enabled_at || !row.totp_secret) throw appError('MFA_ENROLLMENT_REQUIRED');
  if (row.lock_seconds) throw lockedError(row.lock_seconds);

  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(base32Decode(decryptSecret(row.totp_secret)), code);
    // A code is accepted once: the update only succeeds for a step later than the last one used.
    const ok =
      step !== null &&
      (
        await pool.query(
          'update public.user_mfa set last_used_step = $2, failed_attempts = 0, locked_until = null where user_id = $1 and last_used_step < $2',
          [actor.id, step],
        )
      ).rowCount === 1;
    if (!ok) {
      await recordFailure(actor.id);
      throw appError('MFA_INVALID_CODE');
    }
    await markSessionVerified(pool, sessionId);
    return { usedRecoveryCode: false, recoveryCodesLeft: row.recovery_codes.length };
  }

  // Recovery code: removed atomically, so it can't be used twice even by two simultaneous requests.
  return withTransaction({ actorId: actor.id }, async (tx) => {
    const res = await tx.query<{ left: number }>(
      `update public.user_mfa set recovery_codes = array_remove(recovery_codes, $2), failed_attempts = 0, locked_until = null
        where user_id = $1 and $2 = any(recovery_codes) returning cardinality(recovery_codes) as left`,
      [actor.id, hashRecovery(code)],
    );
    if (!res.rows[0]) {
      await recordFailure(actor.id);
      throw appError('MFA_INVALID_CODE');
    }
    await markSessionVerified(tx, sessionId);
    await audit(tx, actor, {
      action: 'user.mfa_recovery_code_used',
      entityType: 'user',
      entityId: actor.id,
      summary: `Signed in with a recovery code (${res.rows[0].left} left)`,
    });
    return { usedRecoveryCode: true, recoveryCodesLeft: res.rows[0].left };
  });
}

/** New recovery codes (the old ones stop working). Needs a current authenticator code, not a recovery code. */
export async function regenerateRecoveryCodes(actor: Actor, code: string): Promise<MfaRecoveryCodes> {
  const row = await loadRow(pool, actor.id);
  if (!row?.enabled_at || !row.totp_secret) throw appError('MFA_ENROLLMENT_REQUIRED');
  if (row.lock_seconds) throw lockedError(row.lock_seconds);
  const step = verifyTotp(base32Decode(decryptSecret(row.totp_secret)), code);
  const codes = newRecoveryCodes();
  const ok =
    step !== null &&
    (await withTransaction({ actorId: actor.id }, async (tx) => {
      const res = await tx.query(
        'update public.user_mfa set recovery_codes = $3, last_used_step = $2, failed_attempts = 0 where user_id = $1 and last_used_step < $2',
        [actor.id, step, codes.hashes],
      );
      if (res.rowCount !== 1) return false;
      await audit(tx, actor, { action: 'user.mfa_recovery_codes_regenerated', entityType: 'user', entityId: actor.id, summary: 'Generated new recovery codes' });
      return true;
    }));
  if (!ok) {
    await recordFailure(actor.id);
    throw appError('MFA_INVALID_CODE');
  }
  return { recoveryCodes: codes.plain };
}

/** Out-of-band reset (lost device): removes the authenticator and signs the account out everywhere. */
export async function resetMfa(db: DbClient, userId: string): Promise<boolean> {
  const res = await db.query('delete from public.user_mfa where user_id = $1', [userId]);
  await db.query('delete from public.auth_sessions where user_id = $1', [userId]);
  return (res.rowCount ?? 0) > 0;
}
