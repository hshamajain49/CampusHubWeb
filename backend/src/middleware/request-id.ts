import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  req.valid = { params: {}, query: {}, body: {} };
  res.setHeader('X-Request-Id', req.id);
  next();
};
