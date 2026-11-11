// Account administration on Better Auth's tables inside the API's own transactions (§10.16).
// Only hashing/verification is delegated to Better Auth, so hashes always match what sign-in verifies.
import { hashPassword as baHash, verifyPassword as baVerify } from 'better-auth/crypto';
import { config } from '../config/env.js';
import type { DbClient } from '../db/pool.js';
import { pool } from '../db/pool.js';
import { auth } from './auth.js';

export async function hashPassword(password: string): Promise<string> {
  try {
    const ctx = await auth.$context;
    return await ctx.password.hash(password);
  } catch {
    return baHash(password);
  }
}

export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const { rows } = await pool.query<{ password: string | null }>(
    "select password from public.auth_accounts where user_id = $1 and provider_id = 'credential'",
    [userId],
  );
  const hash = rows[0]?.password;
  if (!hash) return false;
  try {
    const ctx = await auth.$context;
    return await ctx.password.verify({ hash, password });
  } catch {
    return baVerify({ hash, password });
  }
}

/** Inserts auth_users (trigger creates the 'student' profile) and the credential account. */
export async function createCredentialUser(
  tx: DbClient,
  input: { email: string; name: string; passwordHash: string },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    'insert into public.auth_users (email, name, email_verified) values (lower($1), $2, true) returning id',
    [input.email, input.name],
  );
  const id = rows[0]!.id;
  await tx.query(
    "insert into public.auth_accounts (user_id, account_id, provider_id, password) values ($1, $2, 'credential', $3)",
    [id, id, input.passwordHash],
  );
  return id;
}

export async function setPassword(tx: DbClient, userId: string, passwordHash: string): Promise<void> {
  await tx.query(
    "update public.auth_accounts set password = $2, updated_at = now() where user_id = $1 and provider_id = 'credential'",
    [userId, passwordHash],
  );
}

export async function revokeSessions(tx: DbClient, userId: string, exceptSessionId: string | null = null): Promise<void> {
  await tx.query('delete from public.auth_sessions where user_id = $1 and ($2::uuid is null or id <> $2::uuid)', [
    userId,
    exceptSessionId,
  ]);
}

export async function sendPasswordReset(email: string): Promise<void> {
  await auth.api.requestPasswordReset({ body: { email, redirectTo: `${config.FRONTEND_URL}/reset-password` } });
}
