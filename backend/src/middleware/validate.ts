// Zod validation for params/query/body (§10.8). Parsed values live on req.valid (Express 5 req.query is a getter).
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { validationError } from '../errors/app-error.js';

function toFieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.');
    if (!key) formErrors.push(issue.message);
    else (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors, formErrors };
}

export function validate(schemas: { params?: ZodType; query?: ZodType; body?: ZodType }): RequestHandler {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const input = part === 'body' ? (req.body ?? {}) : part === 'query' ? req.query : req.params;
      const result = schema.safeParse(input);
      if (!result.success) {
        const { fieldErrors, formErrors } = toFieldErrors(result.error);
        const first = Object.values(fieldErrors)[0]?.[0] ?? formErrors[0];
        const msg = part === 'body' && (first === 'End time must be after start time') ? first : 'Please check the highlighted fields.';
        return next(validationError(fieldErrors, msg, formErrors));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}
