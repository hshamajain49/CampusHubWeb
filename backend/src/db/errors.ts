// PostgreSQL error → API error mapping (§10.12).
import { AppError, appError, validationError } from '../errors/app-error.js';
import { logger } from '../lib/logger.js';

const CONNECTION_CODES = new Set(['57P01', '53300', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND']);

export function mapPgError(err: any): AppError | null {
  const code: string | undefined = err?.code;
  if (!code || typeof code !== 'string') return null;
  const constraint: string | undefined = err.constraint;

  switch (code) {
    case '23P01':
      if (constraint === 'venue_blocks_no_overlap') return appError('BLOCK_OVERLAP');
      return appError('BOOKING_CONFLICT');
    case 'CB001':
      return appError('VENUE_BLOCKED', 'This venue is unavailable at the selected time.');
    case 'CB002':
      return appError('BLOCK_CONFLICT', 'Bookings overlap this block.');
    case 'CB003':
      return appError('INVALID_STATUS_TRANSITION', 'This booking can no longer be changed.');
    case 'CB004':
      logger.error({ err }, 'immutable booking column changed');
      return appError('INTERNAL_ERROR');
    case 'CB005':
      return appError('VENUE_INACTIVE');
    case '23505':
      if (constraint === 'venues_name_lower_key') return appError('VENUE_NAME_TAKEN');
      if (constraint === 'auth_users_email_lower_key' || constraint === 'profiles_email_lower_key')
        return appError('EMAIL_ALREADY_REGISTERED');
      return null;
    case '23503':
      if (err.table === 'bookings' || /bookings/.test(err.detail ?? '')) return appError('VENUE_HAS_BOOKINGS');
      return null;
    case '23514':
      logger.warn({ constraint, table: err.table }, 'check constraint reached the database (missing service validation)');
      return validationError({}, 'Invalid value');
    case '22023':
      return validationError({ campusTimezone: ['Unknown timezone'] }, 'Invalid value');
    case '22000':
      if (/range lower bound/.test(err.message ?? '')) return validationError({ endTime: ['End time must be after start time'] }, 'End time must be after start time');
      return null;
    case '57014':
    case '55P03':
      return appError('SERVICE_UNAVAILABLE', 'The system is busy. Please try again.');
    default:
      if (code.startsWith('08') || CONNECTION_CODES.has(code)) return appError('SERVICE_UNAVAILABLE');
      return null;
  }
}
