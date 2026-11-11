// multer for E55 only (§10.19): memory storage, one file field "image", 5 MB.
import multer from 'multer';
import type { RequestHandler } from 'express';
import { appError } from '../errors/app-error.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('image');

export const uploadImage: RequestHandler = (req, res, next) => {
  upload(req, res, (err: any) => {
    if (err) return next(err?.code === 'LIMIT_FILE_SIZE' ? appError('IMAGE_TOO_LARGE') : appError('IMAGE_INVALID'));
    if (!req.file || !ALLOWED.has(req.file.mimetype)) return next(appError('IMAGE_INVALID'));
    next();
  });
};
