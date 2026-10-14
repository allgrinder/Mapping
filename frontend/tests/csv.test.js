import { describe, it, expect } from 'vitest';
import { csvCell, toCsv, safeName } from '../src/export/csv.js';

describe('CSV-Export', () => {
  it('maskiert Trennzeichen, Anführungszeichen und Formeln', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('Er sagte "Hallo"')).toBe('"Er sagte ""Hallo"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+49 211')).toBe("'+49 211");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(null)).toBe('');
    expect(csvCell(51.5)).toBe('51.5');
  });
  it('setzt BOM und CRLF', () => {
    const c = toCsv(['A', 'B'], [[1, 'ö']]);
    expect(c.startsWith('﻿A;B\r\n1;ö')).toBe(true);
  });
  it('erzeugt sichere Dateinamen', () => {
    expect(safeName('Übung Hochwasser Rhein')).toBe('Uebung_Hochwasser_Rhein');
    expect(safeName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeName('')).toBe('export');
  });
});
