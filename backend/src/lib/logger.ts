import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'campushub-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-auth-token"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.temporaryPassword',
      'password',
      'newPassword',
      'currentPassword',
      'temporaryPassword',
    ],
    censor: '[redacted]',
  },
});
