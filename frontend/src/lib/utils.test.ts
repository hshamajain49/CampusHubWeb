// Avatar initials survive worst-case names (break-ui findings).
import { describe, expect, it } from 'vitest';
import { initials } from './utils';

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('Ada')).toBe('A');
  });

  it('skips generational and degree suffixes', () => {
    expect(initials('Charles Montgomery III')).toBe('CM');
    expect(initials('Daniel Okafor Jr.')).toBe('DO');
  });

  it('never splits emoji or keeps punctuation', () => {
    expect(initials('🎉 Fest Committee')).toBe('FC');
    expect(initials('(Admin) Office')).toBe('AO');
  });

  it('handles non-Latin scripts and lowercase input', () => {
    expect(initials('ananya iyer')).toBe('AI');
    expect(initials('Ölgä Ñúñez')).toBe('ÖÑ');
  });
});
