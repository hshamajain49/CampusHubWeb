// FT-NAV-04: redirectTo honours internal paths only.
import { describe, expect, it } from 'vitest';
import { safeRedirect } from './navigation';

describe('safeRedirect', () => {
  it('keeps internal paths with query strings', () => {
    expect(safeRedirect('/bookings/new?venueId=1')).toBe('/bookings/new?venueId=1');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined])(
    'ignores %s',
    (value) => {
      expect(safeRedirect(value)).toBeNull();
    },
  );
});
