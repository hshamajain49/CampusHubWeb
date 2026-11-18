// db/errors.ts: a lost database connection becomes 503 SERVICE_UNAVAILABLE however it is wrapped (Phase 8 finding:
// with the database down, Better Auth's wrapped pool error used to surface as a generic 500).
import { describe, expect, it } from 'vitest';
import { isConnectionError, mapPgError } from '../../src/db/errors.js';

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

describe('isConnectionError / mapPgError', () => {
  it('recognises a direct connection error', () => {
    expect(isConnectionError(refused())).toBe(true);
    expect(mapPgError(refused())?.code).toBe('SERVICE_UNAVAILABLE');
    expect(mapPgError({ code: '08006' })?.code).toBe('SERVICE_UNAVAILABLE');
  });

  it("sees through pg-pool's AggregateError and Better Auth's wrapper (cause)", () => {
    const aggregate = new AggregateError([refused(), refused()], '');
    expect(mapPgError(aggregate)?.code).toBe('SERVICE_UNAVAILABLE');
    const wrapped = Object.assign(new Error('Failed to get session'), { cause: aggregate });
    expect(mapPgError(wrapped)?.code).toBe('SERVICE_UNAVAILABLE');
    expect(mapPgError(wrapped)?.status).toBe(503);
  });

  it('maps a RESTRICT violation the same on PostgreSQL 17 (23503) and 18 (23001)', () => {
    const detail = 'Key (id)=(1) is referenced from table "bookings".';
    expect(mapPgError({ code: '23503', detail })?.code).toBe('VENUE_HAS_BOOKINGS');
    expect(mapPgError({ code: '23001', detail })?.code).toBe('VENUE_HAS_BOOKINGS');
  });

  it('leaves other errors alone', () => {
    expect(isConnectionError(new Error('boom'))).toBe(false);
    expect(mapPgError(new Error('boom'))).toBeNull();
    expect(mapPgError({ code: '23505', constraint: 'venues_name_lower_key' })?.code).toBe('VENUE_NAME_TAKEN');
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isConnectionError(cyclic)).toBe(false);
  });
});
