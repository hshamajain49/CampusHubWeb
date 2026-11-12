// multipart/form-data for complaint photos (COMPLAINT_REGISTRATION_SPEC.md §12.2 step 3): memory storage,
// one JSON text part "data" (≤ 20 KB) and 0–3 files "photos" (≤ 5 MB each). The parsed JSON replaces req.body so the
// ordinary validate() middleware runs on it; a plain JSON request (no photos) passes through unchanged.
import multer from 'multer';
import type { RequestHandler } from 'express';
import { COMPLAINT_PHOTO_RULES } from '@campushub/shared';
import { appError, validationError } from '../errors/app-error.js';

const MB = 1024 * 1024;
const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: COMPLAINT_PHOTO_RULES.maxPhotos,
    fileSize: COMPLAINT_PHOTO_RULES.maxPhotoMb * MB,
    fields: 1,
    fieldSize: 20 * 1024,
    parts: COMPLAINT_PHOTO_RULES.maxPhotos + 1,
  },
}).array('photos', COMPLAINT_PHOTO_RULES.maxPhotos);

export const uploadPhotos: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  parser(req, res, (err: any) => {
    if (err) {
      switch (err?.code) {
        case 'LIMIT_FILE_SIZE':
          return next(appError('FILE_TOO_LARGE', undefined, { file: err.field === 'photos' ? undefined : err.field }));
        case 'LIMIT_FILE_COUNT':
        case 'LIMIT_UNEXPECTED_FILE':
        case 'LIMIT_PART_COUNT':
          return next(appError('TOO_MANY_FILES'));
        default:
          return next(validationError({}, 'The upload could not be read.'));
      }
    }
    const raw = (req.body as Record<string, unknown> | undefined)?.data;
    if (typeof raw !== 'string') return next(validationError({ data: ['Missing data part'] }, 'The upload could not be read.'));
    try {
      req.body = JSON.parse(raw);
    } catch {
      return next(validationError({ data: ['Malformed JSON'] }, 'The upload could not be read.'));
    }
    next();
  });
};

/** Uploaded photos of the current request (empty for JSON requests). */
export function photosOf(req: Parameters<RequestHandler>[0]): { buffer: Buffer; name: string }[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((f) => ({ buffer: f.buffer, name: f.originalname?.slice(0, 120) || 'photo' }));
}
