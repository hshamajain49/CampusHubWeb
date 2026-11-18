// express-rate-limit limiters (§10.14). In-memory store: valid for the single v1 instance only.
import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config/env.js';
import { reportRateLimited } from './monitoring.js';

const disabled = config.NODE_ENV === 'test' && process.env.RATE_LIMIT_TESTS !== '1';

function limiter(name: string, windowMs: number, limit: number, key: 'ip' | 'user' = 'user', extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled,
    keyGenerator: key === 'user' ? (req) => req.profile?.id ?? req.auth?.userId ?? req.ip ?? 'anon' : undefined,
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res, _next, options) => {
      reportRateLimited(req, name);
      res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment and try again.',
          details: null,
          requestId: req.id,
        },
      });
    },
    ...extra,
  });
}

const MIN = 60_000;
export const limits = {
  // 300 / 15 min per IP in production (§10.14). Locally every request shares one IP, so the cap is 10× higher.
  global: limiter('global', 15 * MIN, config.NODE_ENV === 'production' ? 300 : 3000, 'ip', { skip: (req) => disabled || req.path.startsWith('/health') }),
  register: limiter('register', 60 * MIN, 5, 'ip'),
  changePassword: limiter('changePassword', 60 * MIN, 10),
  bookingWrites: limiter('bookingWrites', 60 * MIN, 30),
  availabilityCheck: limiter('availabilityCheck', 10 * MIN, 120),
  passwordResetByAdmin: limiter('passwordResetByAdmin', 60 * MIN, 10),
  exports: limiter('exports', 10 * MIN, 30),
  realtimeToken: limiter('realtimeToken', 10 * MIN, 30),
  push: limiter('push', 60 * MIN, 20),
  photo: limiter('photo', 60 * MIN, 20),
  // Complaints (COMPLAINT_REGISTRATION_SPEC.md §18 "§10.14" row)
  complaintCreate: limiter('complaintCreate', 60 * MIN, 10),
  complaintActions: limiter('complaintActions', 60 * MIN, 30),
  workComplete: limiter('workComplete', 60 * MIN, 30),
  jobs: limiter('jobs', 10 * MIN, 12, 'ip'),
  // Two-step verification: on top of the per-account lock in mfa.service (5 wrong codes → paused).
  mfa: limiter('mfa', 5 * MIN, 20),
};
