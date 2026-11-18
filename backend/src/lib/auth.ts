// Better Auth inside the API (§10.16, §16.12). Mounted at /api/auth/*splat before express.json().
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { passwordSchema, SUPER_ADMIN_MIN_PASSWORD_LENGTH } from '@campushub/shared';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { sendPasswordResetEmail } from './email/email-service.js';
import { logger } from './logger.js';
import { accountKey, checkSignInThrottle, clearSignInThrottle, clientIpFromHeaders, recordSignInFailure, recordSignInSuccess } from './login-throttle.js';
import { currentRequest } from './request-context.js';
import { sentinel, type SecurityEvent } from './sentinel.js';
import { authRateLimitStore } from './auth-rate-limit.js';

/** Sign-in outcomes for Sentinel. The account appears only as a keyed hash (accountKey), never as an email address. */
function reportSignIn(email: string, e: Omit<SecurityEvent, 'route'>) {
  if (!sentinel.enabled) return;
  try {
    const req = currentRequest.getStore();
    const event = { ...e, route: '/api/auth/sign-in/email', details: { accountKey: accountKey(email), ...e.details } };
    if (req) sentinel.reportRequest(req, event);
    else sentinel.report(event);
  } catch (err) {
    logger.warn({ err }, 'sentinel sign-in report failed');
  }
}

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/** Throttle bookkeeping must never turn a sign-in into a 500: on a database hiccup it logs and lets Better Auth decide. */
async function safely(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, `sign-in throttle: ${what} failed`);
  }
}

const TIMESTAMPS = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

const testing = config.NODE_ENV === 'test' && process.env.RATE_LIMIT_TESTS !== '1';
// Spec limits (§10.14) in production; locally every request shares one IP, so allow 10×.
const f = config.NODE_ENV === 'production' ? 1 : 10;

export const auth = betterAuth({
  appName: 'CampusHub',
  baseURL: config.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: config.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: config.CORS_ORIGINS,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // accounts are created only by E02, E38 and the provisioning script
    requireEmailVerification: false, // [ASM D-13]
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      // Not awaited, so the response time doesn't reveal whether the account exists.
      void sendPasswordResetEmail(user.id, `${config.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`).catch(
        (err) => logger.error({ err }, 'password reset email failed'),
      );
    },
    onPasswordReset: async ({ user }) => {
      await pool.query('update public.profiles set must_change_password = false where id = $1', [user.id]);
      // The owner proved control of the mailbox: lift any sign-in lock on the account (F-02).
      await safely('clear after reset', () => clearSignInThrottle(user.email));
    },
  },
  user: { modelName: 'auth_users', fields: { emailVerified: 'email_verified', ...TIMESTAMPS } },
  session: {
    modelName: 'auth_sessions',
    fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', ...TIMESTAMPS },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  account: {
    modelName: 'auth_accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      ...TIMESTAMPS,
    },
  },
  verification: { modelName: 'auth_verifications', fields: { expiresAt: 'expires_at', ...TIMESTAMPS } },
  advanced: {
    database: { generateId: 'uuid' },
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  rateLimit: {
    enabled: !testing,
    // In Postgres, so limits survive restarts and deploys (F-06); keyed by the address Express resolved.
    customStorage: authRateLimitStore,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 300, max: 10 * f },
      '/request-password-reset': { window: 3600, max: 5 * f },
      '/reset-password': { window: 3600, max: 10 * f },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const { rows } = await pool.query<{ is_active: boolean }>('select is_active from public.profiles where id = $1', [
            session.userId,
          ]);
          if (!rows[0] || !rows[0].is_active) {
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_DEACTIVATED',
              message: 'Your account has been deactivated. Contact an administrator.',
            });
          }
          return { data: session };
        },
        after: async (session) => {
          await pool.query('update public.profiles set last_sign_in_at = now() where id = $1', [session.userId]);
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email') {
        // Per-account back-off (F-02). A locked account is refused before the password is checked, so guesses made
        // while locked are never evaluated. The same answer is given whether or not the account exists.
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== 'string' || !email) return;
        let state = { locked: false, retryAfterSeconds: 0 };
        await safely('check', async () => {
          state = await checkSignInThrottle(email, clientIpFromHeaders(ctx.headers));
        });
        if (state.locked) {
          reportSignIn(email, { category: 'auth.login_locked', severity: 'medium', statusCode: 429, description: 'A sign-in was refused because the account is temporarily locked after repeated failures.' });
          throw new APIError(
            'TOO_MANY_REQUESTS',
            {
              code: 'SIGN_IN_LOCKED',
              message: `Too many failed sign-in attempts. Try again in ${minutes(state.retryAfterSeconds)} minute${minutes(state.retryAfterSeconds) === 1 ? '' : 's'}, or reset your password.`,
            },
            { 'Retry-After': String(state.retryAfterSeconds) },
          );
        }
      }
      if (ctx.path === '/reset-password') {
        const body = ctx.body as { newPassword?: unknown; token?: unknown } | undefined;
        const pw = body?.newPassword;
        const parsed = typeof pw === 'string' ? passwordSchema.safeParse(pw) : null;
        if (!parsed?.success) {
          throw new APIError('BAD_REQUEST', {
            code: 'WEAK_PASSWORD',
            message: parsed?.error.issues[0]?.message ?? 'Password must be at least 8 characters and include a letter and a number.',
          });
        }
        // Super Admins need a longer password (F-09). The token tells us whose password this is.
        const token = typeof body?.token === 'string' ? body.token : typeof ctx.query?.token === 'string' ? ctx.query.token : null;
        if (token && (pw as string).length < SUPER_ADMIN_MIN_PASSWORD_LENGTH) {
          const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
          if (verification?.value) {
            const { rows } = await pool.query<{ role: string }>('select role from public.profiles where id = $1', [verification.value]);
            if (rows[0]?.role === 'super_admin') {
              throw new APIError('BAD_REQUEST', {
                code: 'WEAK_PASSWORD',
                message: `Super Admin passwords must be at least ${SUPER_ADMIN_MIN_PASSWORD_LENGTH} characters.`,
              });
            }
          }
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== 'string' || !email) return;
      const ip = clientIpFromHeaders(ctx.headers);
      const returned = ctx.context.returned as { statusCode?: number; body?: { code?: string } } | undefined;
      if (returned instanceof APIError || (returned && typeof returned.statusCode === 'number')) {
        // Only a wrong email/password counts. A deactivated account (403) or a lock (429) is not a guess.
        if (returned?.statusCode === 401 || returned?.body?.code === 'INVALID_EMAIL_OR_PASSWORD') {
          await safely('record failure', () => recordSignInFailure(email, ip));
          reportSignIn(email, { category: 'auth.login_failed', severity: 'low', statusCode: 401, description: 'A sign-in failed: wrong email or password.' });
        }
        return;
      }
      await safely('record success', () => recordSignInSuccess(email, ip));
      if (sentinel.enabled) {
        await safely('sentinel success report', async () => {
          const { rows } = await pool.query<{ id: string; role: string }>('select id, role from public.profiles where lower(email) = lower($1)', [email]);
          reportSignIn(email, {
            category: 'auth.login_succeeded',
            severity: 'info',
            statusCode: 200,
            userRef: rows[0]?.id ?? null,
            actorRole: rows[0]?.role ?? null,
            description: rows[0]?.role === 'super_admin' ? 'A Super Admin signed in (password step).' : 'A user signed in.',
          });
        });
      }
    }),
  },
  disabledPaths: [
    '/sign-up/email',
    '/update-user',
    '/change-email',
    '/delete-user',
    '/change-password',
    '/list-sessions',
    '/revoke-session',
    '/revoke-sessions',
    '/revoke-other-sessions',
    '/send-verification-email',
    '/verify-email',
    '/list-accounts',
    '/link-social',
    '/unlink-account',
  ],
  plugins: [bearer()],
});
