import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError, appError, validationError } from '../errors/app-error.js';
import { mapPgError } from '../db/errors.js';
import { logger } from '../lib/logger.js';

export const notFound: RequestHandler = (_req, _res, next) => next(appError('NOT_FOUND', 'Route not found'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let e: AppError | null = err instanceof AppError ? err : null;

  if (!e && err instanceof ZodError) e = validationError({}, 'Please check the highlighted fields.');
  if (!e && err?.type === 'entity.parse.failed') e = validationError({}, 'Malformed JSON body');
  if (!e && err?.type === 'entity.too.large') e = validationError({}, 'Request too large');
  if (!e && err instanceof MulterError) {
    e = err.code === 'LIMIT_FILE_SIZE' ? appError('IMAGE_TOO_LARGE') : appError('IMAGE_INVALID');
  }
  if (!e) e = mapPgError(err);

  if (!e) {
    logger.error({ err, reqId: req.id, path: req.path }, 'unhandled error');
    e = appError('INTERNAL_ERROR');
  } else if (e.status >= 500) {
    logger.error({ code: e.code, reqId: req.id, err: err instanceof AppError ? undefined : err }, 'server error');
  } else if (e.status === 403) {
    logger.warn({ code: e.code, reqId: req.id, path: req.path }, 'forbidden');
  }

  if (res.headersSent) return;
  res.status(e.status).json({
    error: { code: e.code, message: e.message, details: e.details ?? null, requestId: req.id },
  });
};
