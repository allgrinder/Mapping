import { describe, it, expect } from 'vitest';
import { parseCsv, detectDelimiter, decodeText, guessMapping, buildRows, classify, commitPayload, facilityKey, parseNumber, exportRows, EXPORT_HEADER, errorReport } from '../src/import/core.js';

const categories = [{ id: 1, name: 'Hochschulen' }, { id: 2, name: 'Universitätskliniken' }];
const scenarios = [{ id: 10, name: 'Hochwasser' }, { id: 11, name: 'Stromausfall' }];
const ctx = { categories, scenarios };

describe('CSV lesen', () => {
  it('erkennt Trennzeichen und Anführungszeichen', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('"a,1";b\tc\td')).toBe('\t');
    expect(parseCsv('Name;Hinweis\r\n"Uni ""Nord""";"Zeile1\nZeile2"\r\n\r\nB;x')).toEqual([['Name', 'Hinweis'], ['Uni "Nord"', 'Zeile1\nZeile2'], ['B', 'x']]);
  });

  it('dekodiert UTF-8 mit BOM und fällt auf Windows-1252 zurück', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x53, 0x74, 0x72, 0x61, 0xc3, 0x9f, 0x65]))).toBe('Straße');
    expect(decodeText(new Uint8Array([0x53, 0x74, 0x72, 0x61, 0xdf, 0x65]))).toBe('Straße');
  });

  it('liest deutsche Zahlen', () => {
    expect(parseNumber('51,2345')).toBe(51.2345);
    expect(parseNumber('5.683.120,5')).toBe(5683120.5);
    expect(parseNumber('6.401')).toBe(6.401);
    expect(parseNumber('345.678,5')).toBe(345678.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
  });
});

describe('Spaltenzuordnung', () => {
  it('ordnet typische Überschriften zu', () => {
    const m = guessMapping(['Bezeichnung', 'Art', 'Straße', 'Hausnr.', 'PLZ', 'Ort', 'Breite', 'Länge', 'Gefährdet bei', 'E-Mail', 'Bemerkung']);
    expect(m).toMatchObject({ name: 0, category: 1, street: 2, houseNumber: 3, zip: 4, city: 5, lat: 6, lon: 7, hazards: 8, contactEmail: 9, note: 10, id: null });
  });

  it('liest eine eigene Exportdatei wieder ein', () => {
    const m = guessMapping(EXPORT_HEADER);
    expect(m).toMatchObject({ id: 0, externalId: 1, name: 2, category: 3, street: 4, zip: 5, city: 6, lat: 7, lon: 8, hazards: 9 });
  });
});

describe('Zeilen prüfen und Dubletten', () => {
  const header = ['Name', 'Kategorie', 'Straße', 'PLZ', 'Ort', 'Breite', 'Länge', 'Szenarien', 'E-Mail'];
  const m = guessMapping(header);

  it('prüft Pflichtfelder, Kategorie, Szenarien, PLZ, E-Mail und NRW-Lage', () => {
    const rows = buildRows([
      ['Hochschule A', 'hochschulen', 'Weg 1', '40210', 'Düsseldorf', '51,22', '6,78', 'Hochwasser; Stromausfall', 'a@b.de'],
      ['', 'Mensa', 'Weg 1', '402', 'D', 'x', '6', 'Erdbeben', 'kein-mail'],
      ['Klinik', 'Universitätskliniken', '', '', 'München', '48.1', '11.5', '', ''],
      ['Archiv', '1', '', '', 'Köln', '6.95', '50.94', '', ''],
      ['Ohne Ort', 'Hochschulen', 'Hauptstr. 1', '', 'Bonn', '', '', '', ''],
    ], m, ctx);
    expect(rows[0].errors).toEqual({});
    expect(rows[0].data).toMatchObject({ categoryId: 1, hazards: [10, 11], location: { lon: 6.78, lat: 51.22 } });
    expect(Object.keys(rows[1].errors).sort()).toEqual(['category', 'city', 'contactEmail', 'hazards', 'location', 'name', 'zip']);
    expect(rows[2].errors.location).toMatch(/außerhalb/);
    expect(rows[3].data.location).toEqual({ lon: 6.95, lat: 50.94 });
    expect(rows[3].warnings[0]).toMatch(/vertauscht/);
    expect(rows[4].needsGeocode).toBe(true);
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6]);
  });

  it('erkennt Dubletten gegen den Bestand und in der Datei', () => {
    const existing = [
      { id: 7, name: 'Uni-Klinik Nord', externalId: null, address: { street: 'Haupt-Str. 5', zip: '48149' }, location: { lon: 7.6, lat: 51.96 } },
      { id: 8, name: 'Archiv Süd', externalId: 'A-1', address: { street: 'X', zip: '50667' }, location: { lon: 6.95, lat: 50.94 } },
      { id: 9, name: 'Forschungszentrum', externalId: null, address: { street: 'Wilhelm-Johnen-Straße', zip: '52428' }, location: { lon: 6.4, lat: 50.905 } },
    ];
    const hdr = ['ID', 'Externe ID', 'Name', 'Kategorie', 'Straße', 'PLZ', 'Ort', 'Breitengrad', 'Längengrad'];
    const rows = classify(buildRows([
      ['', '', 'uniklinik nord', 'Hochschulen', 'Hauptstraße 5', '48149', 'Münster', '51.96', '7.6'],
      ['', 'A-1', 'Anderer Name', 'Hochschulen', '', '', 'Köln', '50.95', '6.9'],
      ['', '', 'Forschungszentrum', 'Hochschulen', '', '', 'Jülich', '50.9055', '6.401'],
      ['9', '', 'Forschungszentrum Jülich', 'Hochschulen', '', '', 'Jülich', '50.9', '6.4'],
      ['', '', 'Neu', 'Hochschulen', '', '', 'Bonn', '50.7', '7.1'],
      ['', '', 'neu', 'Hochschulen', '', '', 'Bonn', '50.8', '7.2'],
      ['99', '', 'Fehlt', 'Hochschulen', '', '', 'Bonn', '50.8', '7.2'],
    ], guessMapping(hdr), ctx), existing);
    expect(rows.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'new', 'error', 'error']);
    expect(rows.map((r) => r.match?.facility.id ?? null)).toEqual([7, 8, 9, 9, null, null, null]);
    expect(rows[2].match.reason).toMatch(/m entfernt/);
    expect(rows[5].errors._).toMatch(/Zeile 6/);
    expect(rows[6].errors.id).toMatch(/#99/);

    const skip = commitPayload(rows, 'skip', 'x.csv');
    expect(skip.rows.map((r) => r.action)).toEqual(['create']);
    const upd = commitPayload(rows, 'update', 'x.csv');
    expect(upd.rows.filter((r) => r.action === 'update').map((r) => r.id)).toEqual([7, 8, 9, 9]);
    expect(upd.rows[0].data).toEqual({ name: 'uniklinik nord', categoryId: 1, street: 'Hauptstraße 5', zip: '48149', city: 'Münster', location: { lon: 7.6, lat: 51.96 }, hazards: [] });
  });

  it('erkennt Stammdaten auch über eindeutige Namensteile', () => {
    const c = { categories: [{ id: 4, name: 'Archive (inkl. Landesarchiv)' }, { id: 5, name: 'Forschung Nord' }, { id: 6, name: 'Forschung Süd' }], scenarios: [{ id: 1, name: 'Langanhaltender Stromausfall' }] };
    const [a, b] = buildRows([['A', 'archive', 'Köln', 'stromausfall', '50.9', '6.9'], ['B', 'Forschung', 'Köln', '', '50.9', '6.9']], guessMapping(['Name', 'Kategorie', 'Ort', 'Szenarien', 'Breite', 'Länge']), c);
    expect(a.data).toMatchObject({ categoryId: 4, hazards: [1] });
    expect(a.warnings).toHaveLength(2);
    expect(b.errors.category).toMatch(/Unbekannte/);
  });

  it('Normalisierung wie im Backend', () => {
    expect(facilityKey('Hochschule Testhausen', '40210', 'Musterstraße 1')).toBe('hochschuletesthausen|40210|musterstrasse1');
    expect(facilityKey('Uni-Klinik  Nord', null, 'Haupt-Str. 5')).toBe(facilityKey('uniklinik nord', '', 'Hauptstraße 5'));
  });

  it('Fehlerbericht enthält Zeile, Meldung und Originalwerte', () => {
    const table = [['', 'Hochschulen', '', '', 'Bonn', '50.7', '7.1', '', '']];
    const rows = classify(buildRows(table, m, ctx), []);
    const rep = errorReport(rows, header, table);
    expect(rep.header.slice(0, 3)).toEqual(['Zeile', 'Fehler', 'Name']);
    expect(rep.rows[0][0]).toBe(2);
    expect(rep.rows[0][1]).toMatch(/^Name: Pflichtfeld/);
    expect(rep.rows[0][6]).toBe('Bonn');
  });
});

describe('Export', () => {
  it('schreibt Namen statt IDs', () => {
    const rows = exportRows([{ id: 3, name: 'A', categoryId: 2, address: { street: 'S', zip: '1', city: 'C' }, location: { lon: 7, lat: 51 }, hazards: [11, 10], contact: {}, admin: { kreis: '05111' }, source: 'import' }],
      { categories, scenarios, areaName: (c, l) => (l === 'kreis' && c ? 'Düsseldorf' : '') });
    expect(rows[0].slice(0, 10)).toEqual([3, '', 'A', 'Universitätskliniken', 'S', '1', 'C', 51, 7, 'Stromausfall, Hochwasser']);
    expect(rows[0][16]).toBe('Düsseldorf');
    expect(rows[0][18]).toBe('Import');
    expect(rows[0]).toHaveLength(EXPORT_HEADER.length);
  });
});
