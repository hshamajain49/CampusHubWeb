// Zod-validated environment (§10.4, §25.2). Nothing else reads process.env.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Local runs read backend/.env (tests: .env.test). File values win over inherited shell values so a
 * globally exported NODE_ENV=production can't leak into development. Render has no .env file.
 * ENV_FILE=none reads no file at all (scripts/create-super-admin-prod.mjs passes production values this way).
 */
function loadEnvFile() {
  const name = process.env.ENV_FILE ?? (process.env.VITEST ? '.env.test' : '.env');
  if (name === 'none') return;
  const candidates = [path.resolve(process.cwd(), name), path.resolve(process.cwd(), 'backend', name)];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile();

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const bool = z.preprocess((v) => (typeof v === 'string' ? v === 'true' || v === '1' : v), z.boolean());

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    APP_VERSION: optional,
    RENDER_GIT_COMMIT: optional,
    FRONTEND_URL: z.url(),
    CORS_ORIGINS: z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    EMAIL_TRANSPORT: z.enum(['brevo', 'file', 'console']).default('console'),
    BREVO_API_KEY: optional,
    EMAIL_FROM_ADDRESS: optional,
    EMAIL_FROM_NAME: z.string().default('CampusHub'),
    EMAIL_REPLY_TO: optional,
    EMAIL_OUTBOX_DIR: z.string().default('.tmp/outbox'),
    VAPID_PUBLIC_KEY: optional,
    VAPID_PRIVATE_KEY: optional,
    VAPID_SUBJECT: optional,
    ABLY_API_KEY: optional,
    CLOUDINARY_URL: optional,
    CLOUDINARY_FOLDER: z.string().default('campushub/venues'),
    IMAGE_STORE: z.enum(['neon', 'cloudinary', 'fake']).default('neon'),
    // Neon Object Storage: the AWS-standard names Neon injects (`neon env pull`, `neon deploy`), plus the bucket in neon.ts.
    AWS_ENDPOINT_URL_S3: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    AWS_REGION: optional,
    AWS_ACCESS_KEY_ID: optional,
    AWS_SECRET_ACCESS_KEY: optional,
    NEON_STORAGE_BUCKET: z.string().default('venue-photos'),
    // Complaint photos (COMPLAINT_REGISTRATION_SPEC.md §12): a PRIVATE bucket read through short-lived signed URLs.
    // Defaults to Neon unless venue photos use the local fake store; 'fake' is refused in production.
    COMPLAINT_PHOTO_STORE: z.enum(['neon', 'fake']).optional(),
    NEON_COMPLAINT_BUCKET: z.string().default('complaint-photos'),
    NEON_BRANCH: optional, // informational; written by `npm run neon:env`, used by the dev seed guard
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),
    // Security hardening (security/AUDIT.md F-02, F-05, F-10)
    /** TOTP for Super Admins: 'required' (the default, and the only value allowed in production) or 'off'. */
    SUPER_ADMIN_MFA: z.enum(['required', 'off']).optional(),
    /** Absolute lifetime of a Super Admin session, in hours (members keep Better Auth's 7-day rolling session). */
    SUPER_ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    /** Lets a production API start on a database that contains the seeded @demo.edu accounts (a deliberate demo). */
    ALLOW_DEMO_DATA: bool.default(false),
    // CampusHub Sentinel (developers' monitoring service). All three or none; none = reporting off.
    SENTINEL_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    SENTINEL_INGEST_KEY_ID: optional,
    SENTINEL_INGEST_SECRET: optional,
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_TRANSPORT === 'brevo' && (!v.BREVO_API_KEY || !v.EMAIL_FROM_ADDRESS)) {
      ctx.addIssue({ code: 'custom', path: ['BREVO_API_KEY'], message: 'brevo transport needs BREVO_API_KEY and EMAIL_FROM_ADDRESS' });
    }
    if (v.NODE_ENV === 'production' && v.IMAGE_STORE === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['IMAGE_STORE'], message: 'IMAGE_STORE=fake is refused in production' });
    }
    const photoStore = v.COMPLAINT_PHOTO_STORE ?? (v.IMAGE_STORE === 'fake' ? 'fake' : 'neon');
    if (v.NODE_ENV === 'production' && photoStore === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['COMPLAINT_PHOTO_STORE'], message: 'COMPLAINT_PHOTO_STORE=fake is refused in production' });
    }
    if (v.NODE_ENV === 'production' && v.SUPER_ADMIN_MFA === 'off') {
      ctx.addIssue({ code: 'custom', path: ['SUPER_ADMIN_MFA'], message: 'SUPER_ADMIN_MFA=off is refused in production' });
    }
    const sentinel = [v.SENTINEL_URL, v.SENTINEL_INGEST_KEY_ID, v.SENTINEL_INGEST_SECRET].filter(Boolean).length;
    if (sentinel !== 0 && sentinel !== 3) {
      ctx.addIssue({ code: 'custom', path: ['SENTINEL_URL'], message: 'set SENTINEL_URL, SENTINEL_INGEST_KEY_ID and SENTINEL_INGEST_SECRET together (or none)' });
    }
    if (v.NODE_ENV === 'production' && v.SENTINEL_URL && !v.SENTINEL_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['SENTINEL_URL'], message: 'SENTINEL_URL must be https in production' });
    }
    if (v.IMAGE_STORE === 'neon' || photoStore === 'neon') {
      for (const key of ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const) {
        if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: `Neon object storage needs ${key} (run \`neon env pull\`)` });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  /** Effective complaint photo store (COMPLAINT_PHOTO_STORE, or derived from IMAGE_STORE). */
  COMPLAINT_PHOTO_STORE: parsed.data.COMPLAINT_PHOTO_STORE ?? (parsed.data.IMAGE_STORE === 'fake' ? ('fake' as const) : ('neon' as const)),
  /** Required in production; off by default in development and tests (set SUPER_ADMIN_MFA=required to try it locally). */
  SUPER_ADMIN_MFA: (parsed.data.SUPER_ADMIN_MFA ?? (parsed.data.NODE_ENV === 'production' ? 'required' : 'off')) as 'required' | 'off',
};
export type Config = typeof config;

export const integrations = {
  email: config.EMAIL_TRANSPORT === 'brevo' ? 'configured' : config.EMAIL_TRANSPORT,
  push: config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT ? 'configured' : 'not_configured',
  realtime: config.ABLY_API_KEY ? 'configured' : 'not_configured',
  sentinel: config.SENTINEL_URL ? 'configured' : 'not_configured',
  images: config.IMAGE_STORE !== 'cloudinary' || config.CLOUDINARY_URL ? 'configured' : 'not_configured',
} as const;

export const appVersion = config.APP_VERSION ?? (config.RENDER_GIT_COMMIT ? `1.1.0+${config.RENDER_GIT_COMMIT.slice(0, 7)}` : '1.1.0');
