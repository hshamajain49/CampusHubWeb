import { DEFAULT_ERROR_MESSAGES, ERROR_HTTP_STATUS, type ErrorCode } from '@campushub/shared';

export class AppError extends Error {
  readonly expose = true;
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** `throw appError('BOOKING_CONFLICT', message, details)` — the HTTP status comes from the catalogue (§22.3). */
export function appError(code: ErrorCode, message?: string, details: unknown = null): AppError {
  return new AppError(ERROR_HTTP_STATUS[code], code, message ?? DEFAULT_ERROR_MESSAGES[code] ?? code, details);
}

export function validationError(fieldErrors: Record<string, string[]>, message = 'Please check the highlighted fields.', formErrors: string[] = []): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, { fieldErrors, formErrors });
}

export function fieldError(field: string, message: string): AppError {
  return validationError({ [field]: [message] }, message);
}
