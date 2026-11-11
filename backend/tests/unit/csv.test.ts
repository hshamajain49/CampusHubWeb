// §10.11 CSV: RFC 4180 quoting, BOM + CRLF, formula-injection guard.
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/lib/csv.js';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('emits a BOM and CRLF line endings', () => {
    const out = toCsv(['Reference', 'Venue'], [['BK-1', 'Hall, A']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('Reference,Venue\r\nBK-1,"Hall, A"\r\n');
  });
});
