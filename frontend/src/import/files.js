// Datei-Ein-/Ausgabe für Import/Export. Excel-Bibliotheken werden erst bei Bedarf geladen (lokal gebündelt, kein CDN).
import { decodeText, parseCsv, cellText } from './core.js';
import { toCsv, download } from '../export/csv.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Liest .xlsx oder .csv/.txt → { sheets: [{ name, rows: string[][] }] }. */
export async function readTableFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist größer als 15 MB.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new Error('Das alte Excel-Format .xls wird nicht unterstützt. Bitte in Excel als .xlsx oder CSV speichern.');
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    let sheets;
    try {
      sheets = await readXlsxFile(file);
    } catch {
      throw new Error('Die Excel-Datei konnte nicht gelesen werden.');
    }
    return { sheets: sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cellText)).filter((r) => r.some((v) => v !== '')) })) };
  }
  const text = decodeText(await file.arrayBuffer());
  return { sheets: [{ name: 'CSV', rows: parseCsv(text) }] };
}

/** Schreibt eine Tabelle als .xlsx (Kopfzeile fixiert). Zellen werden als Werte geschrieben, nie als Formeln. */
export async function downloadXlsx(fileName, header, rows, sheet = 'Einrichtungen', extraSheets = []) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const bold = (v) => ({ value: v, fontWeight: 'bold' });
  const toCells = (r) => r.map((v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String }));
  const sheets = [{ sheet, data: [header.map(bold), ...rows.map(toCells)], stickyRowsCount: 1, columns: header.map((t) => ({ width: Math.min(40, Math.max(10, String(t).length + 4)) })) },
    ...extraSheets.map((s) => ({ sheet: s.sheet, data: [s.header.map(bold), ...s.rows.map(toCells)] }))];
  const blob = await writeXlsxFile(sheets).toBlob();
  download(fileName, blob);
}

export function downloadCsv(fileName, header, rows) {
  download(fileName, toCsv(header, rows));
}
