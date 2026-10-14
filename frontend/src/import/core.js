// Import/Export von Einrichtungen: Tabellen lesen (CSV), Spalten zuordnen, Zeilen prüfen, Dubletten erkennen.
// Reine Funktionen ohne DOM – die Prüfung hier ist eine Vorschau; verbindlich prüft der Server beim Übernehmen erneut.

export const MAX_ROWS = 5000;
export const DUP_RADIUS_M = 200;

/** Zielfelder des Imports. `syn`: übliche Spaltenüberschriften (normalisiert verglichen). */
export const FIELDS = [
  { key: 'id', label: 'ID (Bestand)', syn: ['id', 'kritisid', 'einrichtungsid', 'lfdnrbestand'] },
  { key: 'externalId', label: 'Externe ID', syn: ['externeid', 'externalid', 'kennung', 'kennziffer', 'schluessel', 'objektnummer', 'objektnr'] },
  { key: 'name', label: 'Name', required: true, syn: ['name', 'bezeichnung', 'einrichtung', 'einrichtungsname', 'objekt', 'titel'] },
  { key: 'category', label: 'Kategorie', required: true, syn: ['kategorie', 'art', 'typ', 'einrichtungsart', 'category', 'sektor'] },
  { key: 'street', label: 'Straße', syn: ['strasse', 'str', 'strassehausnummer', 'strassenr', 'adresse', 'anschrift', 'street'] },
  { key: 'zip', label: 'PLZ', syn: ['plz', 'postleitzahl', 'zip'] },
  { key: 'city', label: 'Ort', required: true, syn: ['ort', 'stadt', 'gemeinde', 'city', 'wohnort', 'sitz'] },
  { key: 'lat', label: 'Breitengrad', syn: ['breitengrad', 'breite', 'lat', 'latitude', 'y', 'geobreite', 'nbreite'] },
  { key: 'lon', label: 'Längengrad', syn: ['laengengrad', 'laenge', 'lon', 'lng', 'long', 'longitude', 'x', 'geolaenge', 'olaenge'] },
  { key: 'east', label: 'Ostwert (UTM 32)', syn: ['ostwert', 'rechtswert', 'east', 'easting', 'utmost', 'utme'] },
  { key: 'north', label: 'Nordwert (UTM 32)', syn: ['nordwert', 'hochwert', 'north', 'northing', 'utmnord', 'utmn'] },
  { key: 'hazards', label: 'Gefährdet bei', syn: ['gefaehrdetbei', 'gefaehrdung', 'gefaehrdungen', 'szenarien', 'szenario', 'krisenszenarien', 'hazards'] },
  { key: 'contactPerson', label: 'Ansprechperson', syn: ['ansprechperson', 'ansprechpartner', 'ansprechpartnerin', 'kontakt', 'kontaktperson'] },
  { key: 'contactFunction', label: 'Funktion', syn: ['funktion', 'rolle', 'position'] },
  { key: 'contactPhone', label: 'Telefon', syn: ['telefon', 'tel', 'telefonnummer', 'rufnummer', 'phone'] },
  { key: 'contactEmail', label: 'E-Mail', syn: ['email', 'mail', 'emailadresse'] },
  { key: 'note', label: 'Hinweis', syn: ['hinweis', 'bemerkung', 'bemerkungen', 'notiz', 'anmerkung', 'note'] },
];

const LIMITS = { name: 255, street: 255, city: 120, contactPerson: 160, contactFunction: 160, contactPhone: 60, contactEmail: 190, note: 4000, externalId: 120 };

/** Kleinschreibung, Umlaute ausgeschrieben, nur a–z/0–9 – für Überschriften und Namensvergleiche. */
export function norm(s) {
  return String(s ?? '').toLowerCase().trim()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/str\./g, 'strasse').replace(/straße/g, 'strasse')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Wie Normalize::facilityKey im Backend. */
export function facilityKey(name, zip, street) {
  return `${norm(name)}|${norm(zip)}|${norm(street)}`.slice(0, 255);
}

// ---------------- Datei lesen ----------------

/** Text dekodieren: BOM entfernen, UTF-8 bevorzugt, sonst Windows-1252 (Excel-„CSV (Trennzeichen-getrennt)“). */
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Trennzeichen aus der ersten Zeile ermitteln (außerhalb von Anführungszeichen). */
export function detectDelimiter(text) {
  const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let q = false;
  for (const c of text.slice(0, 10000)) {
    if (c === '"') q = !q;
    else if (!q && (c === '\n' || c === '\r')) break;
    else if (!q && c in counts) counts[c]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ';';
}

/** CSV nach RFC 4180 (Anführungszeichen, doppelte "" , Zeilenumbrüche in Feldern). */
export function parseCsv(text, delim = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/** Zellwert aus Excel/CSV als getrimmter Text. */
export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return String(v);
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/ /g, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// ---------------- Spaltenzuordnung ----------------

/** Schlägt je Zielfeld eine Spalte vor (exakter Synonymtreffer vor Teiltreffer, jede Spalte höchstens einmal). */
export function guessMapping(headers) {
  const hs = headers.map(norm);
  const map = {};
  const used = new Set();
  for (const pass of ['exact', 'prefix']) {
    for (const f of FIELDS) {
      if (map[f.key] !== undefined && map[f.key] !== null) continue;
      const idx = hs.findIndex((h, i) => !used.has(i) && h !== '' && f.syn.some((s) => (pass === 'exact' ? h === s : s.length >= 3 && h.startsWith(s))));
      map[f.key] = idx >= 0 ? idx : null;
      if (idx >= 0) used.add(idx);
    }
  }
  // „Straße“ und „Hausnummer“ getrennt: Hausnummer anhängen
  const hn = hs.findIndex((h, i) => !used.has(i) && ['hausnummer', 'hausnr', 'hnr', 'nr'].includes(h));
  map.houseNumber = hn >= 0 && map.street !== null ? hn : null;
  return map;
}

// ---------------- Zeilen prüfen ----------------

/** Dezimalzahl mit Komma oder Punkt; deutsche Tausenderpunkte bei Metern (z. B. „5.683.120,5“). */
export function parseNumber(s) {
  let t = cellText(s).replace(/\s/g, '');
  if (t === '') return null;
  // Tausenderpunkte nur, wenn eindeutig: mehrere Gruppen (5.683.120) oder zusätzlich Dezimalkomma (345.678,5)
  if (/^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(t) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

const inNrwBox = (lon, lat) => lon >= 5.5 && lon <= 9.8 && lat >= 50.0 && lat <= 52.8;

/**
 * Wandelt Tabellenzeilen in Importdatensätze um.
 * ctx: { categories, scenarios, utmToLonLat?([e, n]) => [lon, lat] }
 * Ergebnis je Zeile: { row, data, errors: {feld: text}, warnings: [], needsGeocode }
 */
export function buildRows(table, mapping, ctx, firstDataRow = 2) {
  const cats = lookup(ctx.categories);
  const scens = lookup(ctx.scenarios);
  const get = (r, key) => (mapping[key] === null || mapping[key] === undefined ? '' : cellText(r[mapping[key]]));

  return table.map((r, i) => {
    const errors = {};
    const warnings = [];
    const txt = (key) => {
      const v = key === 'note' ? get(r, key) : get(r, key).replace(/\s+/g, ' ');
      if (LIMITS[key] && v.length > LIMITS[key]) errors[key] = `Höchstens ${LIMITS[key]} Zeichen.`;
      return v;
    };
    let street = txt('street');
    const hn = mapping.houseNumber !== null && mapping.houseNumber !== undefined ? cellText(r[mapping.houseNumber]) : '';
    if (hn && street && !street.endsWith(hn)) street = `${street} ${hn}`;
    const data = {
      name: txt('name'), street, zip: get(r, 'zip').replace(/\s/g, ''), city: txt('city'),
      contactPerson: txt('contactPerson'), contactFunction: txt('contactFunction'), contactPhone: txt('contactPhone'),
      contactEmail: txt('contactEmail'), note: txt('note'), externalId: txt('externalId'),
    };
    if (data.name.length < 2) errors.name = 'Pflichtfeld (mindestens 2 Zeichen).';
    if (data.city.length < 2) errors.city = 'Pflichtfeld (mindestens 2 Zeichen).';
    if (/^\d{4}$/.test(data.zip)) data.zip = '0' + data.zip;
    if (data.zip && !/^\d{5}$/.test(data.zip)) errors.zip = 'PLZ muss fünfstellig sein.';
    if (data.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.contactEmail)) errors.contactEmail = 'Keine gültige E-Mail-Adresse.';
    if (data.contactPhone && !/^[0-9+()/\s.-]*$/.test(data.contactPhone)) errors.contactPhone = 'Nur Ziffern, Leerzeichen und + ( ) / . - erlaubt.';

    const catRaw = get(r, 'category');
    const cat = cats(catRaw);
    data.categoryId = cat?.id ?? null;
    if (!catRaw) errors.category = 'Pflichtfeld.';
    else if (!cat) errors.category = `Unbekannte Kategorie „${catRaw}“.`;
    else if (cat.fuzzy) warnings.push(`Kategorie „${catRaw}“ als „${cat.name}“ erkannt.`);

    data.hazards = [];
    for (const part of get(r, 'hazards').split(/[,;|/\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const sc = scens(part);
      if (!sc) errors.hazards = `Unbekanntes Szenario „${part}“.`;
      else {
        if (!data.hazards.includes(sc.id)) data.hazards.push(sc.id);
        if (sc.fuzzy) warnings.push(`Szenario „${part}“ als „${sc.name}“ erkannt.`);
      }
    }

    let lon = parseNumber(get(r, 'lon'));
    let lat = parseNumber(get(r, 'lat'));
    const e = parseNumber(get(r, 'east'));
    const n = parseNumber(get(r, 'north'));
    if ((lon === null || lat === null) && e !== null && n !== null && ctx.utmToLonLat && Number.isFinite(e) && Number.isFinite(n)) {
      // Ostwert mit vorangestellter Zonenkennung „32“ (z. B. 32345678) zulassen
      const east = e > 32000000 && e < 33000000 ? e - 32000000 : e;
      [lon, lat] = ctx.utmToLonLat([east, n]);
    }
    if (lon !== null && lat !== null && Number.isFinite(lon) && Number.isFinite(lat) && !inNrwBox(lon, lat) && inNrwBox(lat, lon)) {
      [lon, lat] = [lat, lon];
      warnings.push('Breiten- und Längengrad waren vertauscht und wurden getauscht.');
    }
    let needsGeocode = false;
    if (lon === null || lat === null) {
      if (Number.isNaN(lon) || Number.isNaN(lat)) errors.location = 'Koordinate ist keine Zahl.';
      else needsGeocode = true;
    } else if (!Number.isFinite(lon) || !Number.isFinite(lat)) errors.location = 'Koordinate ist keine Zahl.';
    else if (!inNrwBox(lon, lat)) errors.location = 'Koordinate liegt außerhalb von Nordrhein-Westfalen.';
    else data.location = { lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 };

    const idRaw = get(r, 'id');
    const id = /^\d+$/.test(idRaw) ? Number(idRaw) : null;
    if (idRaw && id === null) errors.id = 'ID muss eine Zahl sein.';
    return { row: firstDataRow + i, id, data, errors, warnings, needsGeocode };
  });
}

/** Stammdaten über Namen finden: exakt (normalisiert) oder per ID, sonst eindeutiger Wortanfang bzw. Teilwort (z. B. „Archive“ → „Archive (inkl. Landesarchiv)“). */
function lookup(items) {
  const list = items.map((x) => ({ id: x.id, name: x.name, n: norm(x.name) }));
  return (raw) => {
    const q = norm(raw);
    if (!q) return null;
    const exact = list.find((x) => x.n === q) || list.find((x) => String(x.id) === String(raw).trim());
    if (exact) return { ...exact, fuzzy: false };
    if (q.length < 4) return null;
    for (const test of [(x) => x.n.startsWith(q), (x) => x.n.includes(q)]) {
      const hits = list.filter(test);
      if (hits.length === 1) return { ...hits[0], fuzzy: true };
      if (hits.length > 1) return null;
    }
    return null;
  };
}

// ---------------- Dubletten ----------------

export function distanceM(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Ordnet jede Zeile einer Aktion zu:
 *  - status 'error' (Prüffehler oder doppelt in der Datei),
 *  - 'duplicate' (Bestand gefunden: über ID, externe ID, Name+PLZ+Straße oder gleichen Namen im Umkreis von 200 m) → match,
 *  - 'new'.
 * Fehlende Koordinaten (needsGeocode) bleiben 'error', bis sie per Adresssuche ergänzt wurden.
 */
export function classify(rows, existing) {
  const byId = new Map(existing.map((f) => [f.id, f]));
  const byExt = new Map(existing.filter((f) => f.externalId).map((f) => [f.externalId, f]));
  const byKey = new Map(existing.map((f) => [facilityKey(f.name, f.address?.zip, f.address?.street), f]));
  const byName = new Map();
  for (const f of existing) {
    const k = norm(f.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  const seenKey = new Map();
  const seenExt = new Map();
  for (const r of rows) {
    r.match = null;
    if (r.needsGeocode && !r.data.location) r.errors.location ??= 'Keine Koordinaten – bitte Adresssuche ausführen oder Koordinaten ergänzen.';
    if (r.id !== null && !byId.has(r.id)) r.errors.id = `Einrichtung #${r.id} gibt es im Bestand nicht.`;
    const key = facilityKey(r.data.name, r.data.zip, r.data.street);
    const ext = r.data.externalId || null;
    const twin = seenKey.get(key) ?? (ext ? seenExt.get(ext) : undefined);
    if (twin !== undefined && !Object.keys(r.errors).length) r.errors._ = `Doppelt in der Datei (wie Zeile ${twin}).`;
    if (!seenKey.has(key)) seenKey.set(key, r.row);
    if (ext && !seenExt.has(ext)) seenExt.set(ext, r.row);
    if (Object.keys(r.errors).length) { r.status = 'error'; continue; }

    let m = null;
    if (r.id !== null) m = { facility: byId.get(r.id), reason: 'ID' };
    else if (ext && byExt.has(ext)) m = { facility: byExt.get(ext), reason: 'Externe ID' };
    else if (byKey.has(key)) m = { facility: byKey.get(key), reason: 'Name, PLZ und Straße' };
    else {
      const near = (byName.get(norm(r.data.name)) || []).find((f) => distanceM(f.location, r.data.location) <= DUP_RADIUS_M);
      if (near) m = { facility: near, reason: `gleicher Name, ${Math.round(distanceM(near.location, r.data.location))} m entfernt` };
    }
    r.match = m;
    r.status = m ? 'duplicate' : 'new';
  }
  return rows;
}

/** Nutzlast für POST /import/commit. dupAction: 'skip' | 'update'. */
export function commitPayload(rows, dupAction, fileName) {
  const out = [];
  for (const r of rows) {
    if (r.status === 'new') out.push({ row: r.row, action: 'create', data: payloadData(r.data) });
    else if (r.status === 'duplicate' && dupAction === 'update') out.push({ row: r.row, action: 'update', id: r.match.facility.id, data: payloadData(r.data) });
  }
  return { fileName, rows: out };
}

function payloadData(d) {
  const o = { name: d.name, categoryId: d.categoryId, street: d.street || null, zip: d.zip || null, city: d.city, location: d.location, hazards: d.hazards };
  for (const k of ['contactPerson', 'contactFunction', 'contactPhone', 'contactEmail', 'note', 'externalId']) if (d[k]) o[k] = d[k];
  return o;
}

// ---------------- Export ----------------

export const EXPORT_HEADER = ['ID', 'Externe ID', 'Name', 'Kategorie', 'Straße', 'PLZ', 'Ort', 'Breitengrad', 'Längengrad', 'Gefährdet bei',
  'Ansprechperson', 'Funktion', 'Telefon', 'E-Mail', 'Hinweis', 'Regierungsbezirk', 'Kreis', 'Gemeinde', 'Quelle', 'Angelegt am', 'Angelegt von', 'Geändert am', 'Geändert von'];

/** Tabellenzeilen für den Export – dieselben Spaltennamen wie beim Import, damit eine Exportdatei wieder eingelesen werden kann. */
export function exportRows(items, { categories, scenarios, areaName = (code) => code || '' }) {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const scen = new Map(scenarios.map((s) => [s.id, s.name]));
  return items.map((f) => [
    f.id, f.externalId || '', f.name, cat.get(f.categoryId) || '', f.address?.street || '', f.address?.zip || '', f.address?.city || '',
    f.location.lat, f.location.lon, f.hazards.map((id) => scen.get(id)).filter(Boolean).join(', '),
    f.contact?.person || '', f.contact?.function || '', f.contact?.phone || '', f.contact?.email || '', f.note || '',
    areaName(f.admin?.regbez, 'regbez'), areaName(f.admin?.kreis, 'kreis'), areaName(f.admin?.gemeinde, 'gemeinde'),
    f.source === 'import' ? 'Import' : 'Manuell', f.createdAt || '', f.createdBy || '', f.updatedAt || '', f.updatedBy || '',
  ]);
}

/** Fehlerbericht: Originalzeile + Fehlerbeschreibung. */
export function errorReport(rows, headers, table, firstDataRow = 2) {
  const label = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
  label.location = 'Standort'; label.categoryId = 'Kategorie'; label._ = 'Zeile';
  const out = [];
  for (const r of rows.filter((x) => x.status === 'error')) {
    const msg = Object.entries(r.errors).map(([k, v]) => `${label[k] || k}: ${v}`).join(' | ');
    out.push([r.row, msg, ...(table[r.row - firstDataRow] || []).map(cellText)]);
  }
  return { header: ['Zeile', 'Fehler', ...headers.map(cellText)], rows: out };
}
