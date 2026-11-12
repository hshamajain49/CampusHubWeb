// Express app factory — middleware order exactly as §10.2.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { appVersion, config } from './config/env.js';
import { logger } from './lib/logger.js';
import { auth } from './lib/auth.js';
import { pool } from './db/pool.js';
import { requestId } from './middleware/request-id.js';
import { limits } from './middleware/rate-limiters.js';
import { requireCronSecret } from './middleware/require-cron-secret.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { validationError } from './errors/app-error.js';
import { fakeImagesDir } from './lib/image-store.js';
import { verifyFakeSignedUrl } from './lib/storage.js';
import { runJobs, type JobTask } from './modules/jobs/jobs.service.js';
import { mountRoutes } from './routes.js';

const TASKS: JobTask[] = ['expire', 'complaints', 'reminders', 'deliveries', 'housekeeping'];

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 1. trust proxy (1 on Render)
  app.set('trust proxy', config.TRUST_PROXY);
  // 2. request id
  app.use(requestId);
  // 3. structured request logging with redaction
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customProps: (req) => ({ userId: (req as express.Request).profile?.id }),
      autoLogging: { ignore: (req) => req.url === '/health' },
      serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    }),
  );
  // 4. helmet (JSON API defaults)
  app.use(helmet());
  // 5. CORS allowlist — also covers /api/auth/*
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'Idempotent-Replay', 'set-auth-token', 'Retry-After'],
      maxAge: 600,
    }),
  );
  // 6. global rate limit (skips /health)
  app.use(limits.global);
  // 7. health checks — /health never touches the database (§10.13)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: appVersion, time: new Date().toISOString() });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await Promise.race([pool.query('select 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
      res.json({ status: 'ok', version: appVersion, time: new Date().toISOString(), db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'error' });
    }
  });
  // 8. Better Auth — BEFORE express.json(), it reads the raw body itself
  app.all('/api/auth/*splat', toNodeHandler(auth));
  // 9. JSON body parser
  app.use(express.json({ limit: '100kb' }));
  // Authenticated responses are never cached
  app.use('/api/v1', (req, res, next) => {
    if (req.path !== '/settings/public') res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // 10. scheduled jobs (cron secret only)
  app.post('/internal/jobs/run', limits.jobs, requireCronSecret, async (req, res) => {
    const raw = typeof req.query.tasks === 'string' ? req.query.tasks.split(',').map((t) => t.trim()) : TASKS;
    const tasks = raw.filter((t): t is JobTask => (TASKS as string[]).includes(t));
    if (raw.length && !tasks.length) throw validationError({ tasks: ['Unknown task'] });
    res.json({ data: await runJobs(tasks) });
  });
  // Local-only image delivery for IMAGE_STORE=fake (refused in production by env validation)
  if (config.IMAGE_STORE === 'fake') {
    app.get('/dev-images/:id', (req, res) => {
      const file = path.join(fakeImagesDir(), path.basename(req.params.id));
      if (!fs.existsSync(file)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.sendFile(file, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    });
  }
  // Local-only private files for COMPLAINT_PHOTO_STORE=fake: an HMAC-signed, expiring URL stands in for an S3
  // presigned URL (same 10-minute lifetime, same 'no signature, no file' rule). Refused in production by env validation.
  if (config.COMPLAINT_PHOTO_STORE === 'fake') {
    app.get('/dev-files/*key', (req, res) => {
      const key = ([] as string[]).concat((req.params as { key: string | string[] }).key).join('/');
      const file = verifyFakeSignedUrl(key, req.query.expires as string | undefined, req.query.sig as string | undefined);
      if (!file || !fs.existsSync(file)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // .tmp is a dot-directory: send() ignores dotfile paths unless told otherwise.
      res.type('image/webp').sendFile(file, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    });
  }
  // 11. routers with their guard chains
  mountRoutes(app);
  // 12. 404, 13. error handler
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
