// Better Auth inside the API (§10.16, §16.12). Mounted at /api/auth/*splat before express.json().
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { passwordSchema } from '@campushub/shared';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { sendPasswordResetEmail } from './email/email-service.js';
import { logger } from './logger.js';

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
    storage: 'memory',
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
      if (ctx.path === '/reset-password') {
        const pw = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        if (typeof pw !== 'string' || !passwordSchema.safeParse(pw).success) {
          throw new APIError('BAD_REQUEST', {
            code: 'WEAK_PASSWORD',
            message: 'Password must be at least 8 characters and include a letter and a number.',
          });
        }
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
