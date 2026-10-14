// Demo-Modus (GitHub Pages): ersetzt das PHP-Backend durch einen kleinen Server im Browser.
// Daten liegen nur im localStorage dieses Browsers. Keine echte Sicherheit – nur zum Ausprobieren.
import { ApiError } from '../api.js';
import { RULES } from '../views/password.js';
import { findContaining, pointInGeometry } from './geo.js';
import proj4 from 'proj4';
import '../map/projection.js';
import turfBuffer from '@turf/buffer';
import { SAMPLES } from './samples.js';
import { facilityKey } from '../import/core.js';

const KEY = 'kl-demo-v1';
const SYMBOLS = ['cap', 'cross', 'flask', 'box', 'building', 'shield', 'wave', 'rain', 'fire', 'wind', 'power', 'hazard'];
const AREA_WIDE = ['Langanhaltender Stromausfall', 'Cyberangriff'];
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function seed() {
  const cat = [['Hochschulen', '#2F6FDE', 'cap'], ['Universitätskliniken', '#D0364F', 'cross'], ['Außeruniversitäre Forschungseinrichtungen', '#7A4BD6', 'flask'], ['Archive (inkl. Landesarchiv)', '#A8620A', 'box']];
  const scen = [['Hochwasser', '#2F6FDE', 'wave'], ['Starkregen', '#1F7A8C', 'rain'], ['Waldbrand', '#C2410C', 'fire'], ['Sturm', '#5B6472', 'wind'], ['Langanhaltender Stromausfall', '#A16207', 'power'], ['Gefahrstoffunfall', '#7A4BD6', 'hazard'], ['Cyberangriff', '#334155', 'shield']];
  const md = (list, wide) => list.map(([name, color, symbol], i) => ({ id: i + 1, name, color, symbol, sortOrder: (i + 1) * 10, active: true, ...(wide ? { areaWide: AREA_WIDE.includes(name) } : {}), updatedAt: now() }));
  return {
    seq: 100,
    sessionUser: null,
    users: [
      { id: 1, username: 'admin', displayName: 'Demo-Administration', password: 'demo', role: 'admin', active: true, mustChangePassword: false, lastLoginAt: null, createdAt: now(), updatedAt: now() },
      { id: 2, username: 'leser', displayName: 'Demo-Lesezugriff', password: 'demo', role: 'lesen', active: true, mustChangePassword: false, lastLoginAt: null, createdAt: now(), updatedAt: now() },
    ],
    categories: md(cat),
    scenarios: md(scen, true),
    facilities: [],
  };
}

let db = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.users) {
      s.facilities ??= [];
      // ältere Demo-Stände: Kennzeichen „flächig“ nachtragen (wie Migration 005)
      for (const x of s.scenarios) x.areaWide ??= AREA_WIDE.includes(x.name);
      return s;
    }
  } catch { /* neu anlegen */ }
  return seed();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ohne Speicher: nur bis zum Neuladen */ }
}
export function resetDemo() {
  db = seed();
  save();
}

const fail = (status, code, message, fields = {}) => { throw new ApiError(status, code, message, fields); };
const me = () => db.users.find((u) => u.id === db.sessionUser && u.active) || null;
const present = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword });
function requireUser(role, allowPw = false) {
  const u = me();
  if (!u) fail(401, 'unauthenticated', 'Anmeldung erforderlich.');
  if (u.mustChangePassword && !allowPw) fail(403, 'password_change_required', 'Das Initialpasswort muss zuerst geändert werden.');
  if (role && u.role !== role) fail(403, 'forbidden', 'Keine Berechtigung.');
  return u;
}
function genPassword() {
  const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < 14; i++) p += a[Math.floor(Math.random() * a.length)];
  return p.slice(0, 6) + '-' + p.slice(6) + '7aK';
}

let staticCache = {};
async function staticJson(name, fallback) {
  staticCache[name] ??= fetch(`./demo-data/${name}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  return staticCache[name];
}

const GRID = {
  srs: 'EPSG:25832', origin: [270000, 5850000], extent: [270000, 5550000, 570000, 5850000], tile_size: 256,
  resolutions: [1171.875, 585.9375, 292.96875, 146.484375, 73.2421875, 36.62109375, 18.310546875, 9.1552734375, 4.57763671875, 2.288818359375, 1.1444091796875, 0.57220458984375],
};

function masterData(kind, method, rest, body, actor) {
  const list = db[kind];
  const validate = () => {
    const errs = {};
    if (typeof body?.name !== 'string' || body.name.trim().length < 2) errs.name = 'Länge muss zwischen 2 und 120 Zeichen liegen.';
    if (!/^#[0-9a-f]{6}$/i.test(body?.color || '')) errs.color = 'Ungültiges Format.';
    if (!SYMBOLS.includes(body?.symbol)) errs.symbol = 'Ungültiger Wert.';
    if (body?.areaWide !== undefined && typeof body.areaWide !== 'boolean') errs.areaWide = 'Wahrheitswert erwartet.';
    if (Object.keys(errs).length) fail(422, 'validation_failed', 'Eingaben ungültig.', errs);
  };
  const dup = (name, id) => list.some((x) => x.name === name && x.id !== id) && fail(409, 'conflict', 'Der Name ist bereits vergeben.', { name: 'Der Name ist bereits vergeben.' });
  if (method === 'GET' && !rest) {
    requireUser();
    const usage = (x) => db.facilities.filter((f) => (kind === 'categories' ? f.categoryId === x.id : f.hazards.includes(x.id))).length;
    return { items: [...list].sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ ...x, usageCount: usage(x) })) };
  }
  requireUser('admin');
  if (method === 'POST' && !rest) {
    validate(); dup(body.name.trim());
    const item = { id: ++db.seq, name: body.name.trim(), color: body.color.toUpperCase(), symbol: body.symbol, active: body.active !== false, sortOrder: Math.max(0, ...list.map((x) => x.sortOrder)) + 10, ...(kind === 'scenarios' ? { areaWide: body.areaWide === true } : {}), updatedAt: now() };
    list.push(item); save();
    return { id: item.id };
  }
  if (method === 'PUT' && rest === 'order') {
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length !== list.length || new Set(ids).size !== ids.length || !list.every((x) => ids.includes(x.id))) fail(422, 'validation_failed', 'Die Reihenfolge muss alle Einträge genau einmal enthalten.');
    ids.forEach((id, i) => { list.find((x) => x.id === id).sortOrder = (i + 1) * 10; });
    save();
    return { ok: true };
  }
  const item = list.find((x) => String(x.id) === rest) || fail(404, 'not_found', 'Nicht gefunden.');
  if (method === 'PUT') {
    validate(); dup(body.name.trim(), item.id);
    Object.assign(item, { name: body.name.trim(), color: body.color.toUpperCase(), symbol: body.symbol, active: body.active !== false, updatedAt: now() });
    if (kind === 'scenarios' && typeof body.areaWide === 'boolean') item.areaWide = body.areaWide;
    save();
    return { ok: true };
  }
  if (method === 'DELETE') {
    if (db.facilities.some((f) => (kind === 'categories' ? f.categoryId === item.id : f.hazards.includes(item.id)))) fail(409, 'in_use', 'Löschen nicht möglich: Es sind noch Einrichtungen zugeordnet.');
    db[kind] = list.filter((x) => x !== item); save();
    return { ok: true };
  }
  return fail(405, 'method_not_allowed', 'Nicht erlaubt.');
}

function users(method, rest, body) {
  const actor = requireUser('admin');
  const [idStr, action] = (rest || '').split('/');
  if (method === 'GET' && !rest) return { items: [...db.users].sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, 'de')).map((u) => ({ ...present(u), active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt })) };
  if (method === 'POST' && !rest) {
    if (!/^[A-Za-z0-9._@-]{3,64}$/.test(body?.username || '')) fail(422, 'validation_failed', 'Eingaben ungültig.', { username: 'Ungültiges Format.' });
    if (!['lesen', 'admin'].includes(body?.role)) fail(422, 'validation_failed', 'Eingaben ungültig.', { role: 'Ungültiger Wert.' });
    if (db.users.some((u) => u.username === body.username)) fail(409, 'conflict', 'Benutzername existiert bereits.', { username: 'Benutzername existiert bereits.' });
    const pw = genPassword();
    const u = { id: ++db.seq, username: body.username, displayName: (body.displayName || '').trim() || null, password: pw, role: body.role, active: true, mustChangePassword: true, lastLoginAt: null, createdAt: now(), updatedAt: now() };
    db.users.push(u); save();
    return { id: u.id, initialPassword: pw };
  }
  const u = db.users.find((x) => String(x.id) === idStr) || fail(404, 'not_found', 'Benutzer nicht gefunden.');
  const otherAdmins = db.users.filter((x) => x.role === 'admin' && x.active && x.id !== u.id).length;
  if (method === 'PUT') {
    const role = body?.role ?? u.role;
    const active = body?.active ?? u.active;
    if (u.role === 'admin' && (role !== 'admin' || !active) && otherAdmins === 0) fail(409, 'conflict', 'Der letzte aktive Administrator kann nicht entfernt werden.');
    Object.assign(u, { role, active, displayName: body?.displayName ?? u.displayName, updatedAt: now() });
    save();
    return { ok: true };
  }
  if (method === 'DELETE') {
    if (u.id === actor.id) fail(409, 'conflict', 'Das eigene Konto kann nicht gelöscht werden.');
    if (u.role === 'admin' && otherAdmins === 0) fail(409, 'conflict', 'Der letzte aktive Administrator kann nicht entfernt werden.');
    db.users = db.users.filter((x) => x !== u); save();
    return { ok: true };
  }
  if (method === 'POST' && action === 'reset-password') {
    u.password = genPassword(); u.mustChangePassword = true; save();
    return { initialPassword: u.password };
  }
  return fail(405, 'method_not_allowed', 'Nicht erlaubt.');
}

/** Beantwortet eine API-Anfrage wie das echte Backend (gleiche Pfade und Antwortformen). */
export async function handle(method, path, body) {
  await new Promise((r) => setTimeout(r, 60));
  const [, section, ...restParts] = path.split('?')[0].split('/');
  const rest = restParts.join('/');
  switch (section) {
    case 'health': return { status: 'ok' };
    case 'auth': {
      if (rest === 'me') return { user: me() ? present(me()) : null, csrfToken: 'demo' };
      if (rest === 'login') {
        const u = db.users.find((x) => x.username === body?.username);
        if (!u || u.password !== body?.password || !u.active) fail(401, 'invalid_credentials', 'Benutzername oder Passwort falsch.');
        db.sessionUser = u.id; u.lastLoginAt = now(); save();
        return { user: present(u), csrfToken: 'demo' };
      }
      if (rest === 'logout') { db.sessionUser = null; save(); return { ok: true }; }
      if (rest === 'change-password') {
        const u = requireUser(null, true);
        if (body?.currentPassword !== u.password) fail(422, 'invalid_credentials', 'Das aktuelle Passwort ist falsch.', { currentPassword: 'Das aktuelle Passwort ist falsch.' });
        const p = String(body?.newPassword || '');
        if (!RULES.every(([, t]) => t(p)) || p.toLowerCase().includes(u.username.toLowerCase()) || p === u.password) fail(422, 'weak_password', 'Das Passwort erfüllt die Anforderungen nicht.', { newPassword: 'Das Passwort erfüllt die Anforderungen nicht.' });
        u.password = p; u.mustChangePassword = false; save();
        return { ok: true, csrfToken: 'demo' };
      }
      break;
    }
    case 'users': return users(method, rest, body);
    case 'categories':
    case 'scenarios': return masterData(section, method, rest, body);
    case 'map': {
      requireUser();
      const meta = await staticJson('meta.json', null);
      const levels = meta?.levels || {};
      return {
        grid: GRID,
        viewExtent: [255000, 5545000, 560000, 5850000],
        defaultBasemap: 'politisch',
        basemaps: [
          { id: 'topografisch', label: 'Topografisch', type: 'tiles', available: false, attribution: '© Geobasis NRW' },
          { id: 'politisch', label: 'Politisch', type: 'boundaries', available: Boolean(levels.regbez), attribution: '© Geobasis NRW' },
        ],
        boundaries: Object.entries(levels).map(([level, count]) => ({ level, count, source: meta.source, license: meta.license, attribution: meta.attribution, importedAt: meta.generatedAt })),
        attributions: meta ? [meta.attribution] : [],
        overlays: { flood: false, warnings: true },
        warningsIntervalS: 300,
      };
    }
    case 'facilities':
      if (rest === 'hints') { requireUser('admin'); return demoHints(body); }
      return facilities(method, rest, body);
    case 'import':
      if (rest === 'commit' && method === 'POST') return importCommit(body);
      break;
    case 'situation': requireUser(); return situation(body?.definition, body?.bufferM ?? 0, body?.scenarioId ?? null);
    case 'warnings': requireUser(); return demoWarnings();
    case 'events': return events(method, rest, body);
    case 'geo':
      requireUser();
      return resolve(Number(new URLSearchParams(path.split('?')[1]).get('lon')), Number(new URLSearchParams(path.split('?')[1]).get('lat')));
    case 'geocode': {
      requireUser('admin');
      const q = new URLSearchParams(path.split('?')[1]).get('q') || '';
      return geocode(q);
    }
    case 'boundaries':
      requireUser();
      return staticJson(`boundaries-${rest}.json`, { type: 'FeatureCollection', features: [] });
    default:
  }
  return fail(404, 'not_found', 'Nicht gefunden.');
}

// ---------------- Einrichtungen ----------------
async function resolve(lon, lat) {
  const pt = [lon, lat];
  const [rb, kr, gm, land] = await Promise.all(['regbez', 'kreis', 'gemeinde', 'land'].map((l) => staticJson(`boundaries-${l}.json`, null)));
  const r = findContaining(pt, rb)?.properties;
  const k = findContaining(pt, kr)?.properties;
  const g = findContaining(pt, gm)?.properties;
  const inNrw = Boolean(findContaining(pt, land) || r);
  return {
    regbez: r?.code || null, kreis: k?.code || null, gemeinde: g?.code || null, plz5: null, inNrw,
    names: { regbez: r?.name, kreis: k?.name, gemeinde: g?.name }, boundariesLoaded: Boolean(rb?.features?.length),
  };
}

async function geocode(q) {
  if (q.trim().length < 3) fail(422, 'validation_failed', 'Bitte mindestens 3 Zeichen eingeben.');
  try {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '6', countrycodes: 'de', viewbox: '5.8,52.6,9.5,50.3', bounded: '1', 'accept-language': 'de' });
    const res = await fetch(url);
    const data = await res.json();
    return { items: data.map((d) => {
      const a = d.address || {};
      return { label: d.display_name, street: [a.road || a.pedestrian, a.house_number].filter(Boolean).join(' '), zip: a.postcode || '', city: a.city || a.town || a.village || a.municipality || '', lon: Number(d.lon), lat: Number(d.lat) };
    }) };
  } catch {
    return fail(503, 'geocoder_unavailable', 'Die Adresssuche ist derzeit nicht erreichbar. Bitte den Standort auf der Karte setzen.');
  }
}

function presentFacility(f) {
  const user = (id) => db.users.find((u) => u.id === id)?.username || null;
  return { ...structuredClone(f), createdBy: user(f.createdById), updatedBy: user(f.updatedById) };
}

async function validateFacility(b) {
  const errs = {};
  if (typeof b?.name !== 'string' || b.name.trim().length < 2) errs.name = 'Länge muss zwischen 2 und 255 Zeichen liegen.';
  if (!db.categories.some((c) => c.id === b?.categoryId)) errs.categoryId = 'Bitte eine Kategorie wählen.';
  if (typeof b?.city !== 'string' || b.city.trim().length < 2) errs.city = 'Pflichtfeld (Text erwartet).';
  if (b?.zip && !/^\d{5}$/.test(b.zip)) errs.zip = 'Ungültiges Format.';
  if (b?.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.contactEmail)) errs.contactEmail = 'Keine gültige E-Mail-Adresse.';
  if (!Array.isArray(b?.hazards) || b.hazards.some((h) => !db.scenarios.some((s) => s.id === h))) errs.hazards = 'Ungültige Szenarien.';
  const lon = Number(b?.location?.lon), lat = Number(b?.location?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) errs.location = 'Bitte den Standort auf der Karte setzen.';
  if (Object.keys(errs).length) fail(422, 'validation_failed', 'Eingaben ungültig.', errs);
  const adm = await resolve(lon, lat);
  if (adm.boundariesLoaded && !adm.inNrw) fail(422, 'validation_failed', 'Eingaben ungültig.', { location: 'Der Standort liegt außerhalb von Nordrhein-Westfalen.' });
  return {
    name: b.name.trim(), categoryId: b.categoryId,
    address: { street: b.street?.trim() || null, zip: b.zip?.trim() || null, city: b.city.trim() },
    location: { lon, lat }, admin: { regbez: adm.regbez, kreis: adm.kreis, gemeinde: adm.gemeinde, plz5: b.zip || null },
    hazards: [...new Set(b.hazards)],
    contact: { person: b.contactPerson || null, function: b.contactFunction || null, phone: b.contactPhone || null, email: b.contactEmail || null },
    note: b.note || null,
  };
}

async function facilities(method, rest, body) {
  if (method === 'GET' && !rest) {
    requireUser();
    const asOf = db.facilities.reduce((m, f) => (f.updatedAt > m ? f.updatedAt : m), '1970-01-01 00:00:00');
    return { items: [...db.facilities].sort((a, b) => a.name.localeCompare(b.name, 'de')).map(presentFacility), dataAsOf: db.facilitiesChangedAt || asOf, servedAt: now() };
  }
  if (method === 'GET') {
    requireUser();
    return presentFacility(db.facilities.find((f) => String(f.id) === rest) || fail(404, 'not_found', 'Einrichtung nicht gefunden.'));
  }
  const actor = requireUser('admin');
  if (method === 'POST' && !rest) {
    const f = { id: ++db.seq, ...(await validateFacility(body)), source: body?.source || 'manual', externalId: body?.externalId || null, createdAt: now(), createdById: actor.id, updatedAt: now(), updatedById: actor.id };
    db.facilities.push(f); db.facilitiesChangedAt = now(); save();
    return presentFacility(f);
  }
  const f = db.facilities.find((x) => String(x.id) === rest) || fail(404, 'not_found', 'Einrichtung nicht gefunden.');
  if (method === 'PUT') {
    Object.assign(f, await validateFacility(body), { updatedAt: now(), updatedById: actor.id });
    db.facilitiesChangedAt = now(); save();
    return presentFacility(f);
  }
  if (method === 'DELETE') {
    db.facilities = db.facilities.filter((x) => x !== f); db.facilitiesChangedAt = now(); save();
    return { ok: true };
  }
  return fail(405, 'method_not_allowed', 'Nicht erlaubt.');
}

// Wie POST /api/import/commit im Backend: jede Zeile prüfen, Dubletten ablehnen, alles oder nichts.
async function importCommit(body) {
  const actor = requireUser('admin');
  const rows = body?.rows;
  if (!Array.isArray(rows) || !rows.length) fail(422, 'validation_failed', 'Keine Zeilen zum Import.', { rows: 'Keine Zeilen zum Import.' });
  if (rows.length > 5000) fail(422, 'validation_failed', 'Höchstens 5000 Zeilen je Import.', { rows: 'Zu viele Zeilen.' });
  const errors = [];
  const valid = [];
  const seenKey = new Map();
  const seenExt = new Map();
  for (const [i, r] of rows.entries()) {
    const line = Number.isInteger(r?.row) ? r.row : i + 1;
    if (!r?.data || !['create', 'update'].includes(r.action)) { errors.push({ row: line, fields: { _: 'Ungültiger Zeilenaufbau.' } }); continue; }
    const target = r.action === 'update' ? db.facilities.find((f) => f.id === r.id) : null;
    if (r.action === 'update' && !target) { errors.push({ row: line, fields: { _: 'Zu aktualisierende Einrichtung existiert nicht (mehr).' } }); continue; }
    let v;
    try { v = await validateFacility(r.data); } catch (e) { errors.push({ row: line, fields: Object.keys(e.fields || {}).length ? e.fields : { _: e.message } }); continue; }
    const key = facilityKey(v.name, v.address.zip, v.address.street);
    const ext = r.data.externalId || null;
    let dup = null;
    if (seenKey.has(key) || (ext && seenExt.has(ext))) dup = `Doppelt in der Datei (Zeile ${seenKey.get(key) ?? seenExt.get(ext)}).`;
    else if (r.action === 'create') {
      const hit = db.facilities.find((f) => facilityKey(f.name, f.address.zip, f.address.street) === key || (ext && f.externalId === ext));
      if (hit) dup = `Dublette zu bestehender Einrichtung #${hit.id}.`;
    }
    if (dup) { errors.push({ row: line, fields: { _: dup }, duplicate: true }); continue; }
    seenKey.set(key, line);
    if (ext) seenExt.set(ext, line);
    valid.push([target, v, ext]);
  }
  if (errors.length) {
    const err = new ApiError(422, 'import_invalid', `${errors.length} Zeile(n) fehlerhaft – es wurde nichts importiert.`);
    err.rows = errors;
    throw err;
  }
  const batchId = 'imp-demo-' + Date.now();
  let created = 0, updated = 0;
  for (const [target, v, ext] of valid) {
    if (target) { Object.assign(target, v, { externalId: ext || target.externalId, updatedAt: now(), updatedById: actor.id }); updated++; }
    else { db.facilities.push({ id: ++db.seq, ...v, source: 'import', externalId: ext, createdAt: now(), createdById: actor.id, updatedAt: now(), updatedById: actor.id }); created++; }
  }
  db.facilitiesChangedAt = now();
  save();
  return { batchId, created, updated };
}

/** Legt die fiktiven Beispiel-Einrichtungen an (nur Demo). */
export async function loadSampleData() {
  const actor = db.users.find((u) => u.role === 'admin');
  for (const [name, categoryId, street, zip, city, lon, lat, hazards, person, fn, phone, email] of SAMPLES) {
    if (db.facilities.some((f) => f.name === name)) continue;
    const v = await validateFacility({ name, categoryId, street, zip, city, location: { lon, lat }, hazards, contactPerson: person, contactFunction: fn, contactPhone: phone, contactEmail: email });
    db.facilities.push({ id: ++db.seq, ...v, source: 'manual', externalId: null, createdAt: now(), createdById: actor.id, updatedAt: now(), updatedById: actor.id });
  }
  db.facilitiesChangedAt = now();
  save();
}

// ---------------- Lagemodus ----------------
async function buildArea(def) {
  const bad = (m) => fail(422, 'validation_failed', m, { definition: m });
  if (!def || typeof def.type !== 'string') bad('Bitte ein Ereignisgebiet festlegen.');
  if (def.type === 'polygon') {
    const ring = [...def.coordinates];
    if (ring.length < 3) bad('Die Fläche braucht mindestens drei Eckpunkte.');
    if (String(ring[0]) !== String(ring[ring.length - 1])) ring.push(ring[0]);
    return { area: { type: 'Polygon', coordinates: [ring] }, label: 'Gezeichnete Fläche', definition: { type: 'polygon', coordinates: ring } };
  }
  if (def.type === 'circle') {
    const r = def.radiusM;
    if (typeof r !== 'number' || r < 50 || r > 100000) bad('Der Radius muss zwischen 50 m und 100 km liegen.');
    const [e, n] = proj4('EPSG:4326', 'EPSG:25832', def.center);
    const ring = [];
    for (let i = 0; i <= 72; i++) { const a = (2 * Math.PI * (i % 72)) / 72; ring.push(proj4('EPSG:25832', 'EPSG:4326', [e + r * Math.cos(a), n + r * Math.sin(a)])); }
    return { area: { type: 'Polygon', coordinates: [ring] }, label: `Radius ${(r / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`, definition: { type: 'circle', center: def.center, radiusM: r } };
  }
  if (def.type === 'boundary') {
    const fc = await staticJson(`boundaries-${def.level}.json`, null);
    const f = fc?.features?.find((x) => x.properties.code === def.code) || bad('Das gewählte Gebiet ist nicht vorhanden.');
    const lbl = { regbez: 'Regierungsbezirk', kreis: 'Kreis/Stadt', gemeinde: 'Gemeinde', plz5: 'PLZ', plz2: 'PLZ-Region' }[def.level];
    return { area: f.geometry, label: `${lbl} ${f.properties.name}`, definition: { type: 'boundary', level: def.level, code: def.code } };
  }
  return bad('Unbekannter Gebietstyp.');
}

async function situation(def, bufferM, scenarioId = null) {
  if (scenarioId !== null && !Number.isInteger(scenarioId)) fail(422, 'validation_failed', 'Ungültiges Szenario.', { scenarioId: 'Ungültiges Szenario.' });
  const sc = scenarioId === null ? null : db.scenarios.find((x) => x.id === scenarioId) || fail(422, 'validation_failed', 'Unbekanntes Szenario.', { scenarioId: 'Unbekanntes Szenario.' });
  const scenario = sc ? { id: sc.id, name: sc.name, areaWide: Boolean(sc.areaWide) } : null;
  if (typeof bufferM !== 'number' || bufferM < 0 || bufferM > 50000) fail(422, 'validation_failed', 'Die Pufferzone muss zwischen 0 und 50 km liegen.', { bufferM: 'Ungültig.' });
  const a = await buildArea(def);
  const buffer = bufferM > 0 ? turfBuffer({ type: 'Feature', properties: {}, geometry: a.area }, bufferM / 1000, { units: 'kilometers', steps: 16 })?.geometry : null;
  const byLat = (x, y) => y.location.lat - x.location.lat || x.location.lon - y.location.lon;
  const all = db.facilities.map(presentFacility);
  const inArea = all.filter((f) => pointInGeometry([f.location.lon, f.location.lat], a.area)).sort(byLat);
  const ids = new Set(inArea.map((f) => f.id));
  const inBuffer = buffer ? all.filter((f) => !ids.has(f.id) && pointInGeometry([f.location.lon, f.location.lat], buffer)).sort(byLat) : [];
  const rate = (list) => {
    for (const f of list) f.atRisk = scenario ? scenario.areaWide || f.hazards.includes(scenario.id) : null;
    return scenario ? [...list.filter((f) => f.atRisk), ...list.filter((f) => !f.atRisk)] : list;
  };
  return { definition: a.definition, label: a.label, bufferM, scenario, area: a.area, buffer, inArea: rate(inArea), inBuffer: rate(inBuffer) };
}

async function events(method, rest, body) {
  const actor = requireUser();
  db.events ??= [];
  const slim = (f) => ({ id: f.id, name: f.name, categoryId: f.categoryId, address: f.address, location: f.location, admin: f.admin, hazards: f.hazards, contact: f.contact, atRisk: f.atRisk });
  const present = (e) => ({ ...structuredClone(e), createdBy: db.users.find((u) => u.id === e.createdById)?.username, updatedBy: db.users.find((u) => u.id === e.updatedById)?.username });
  const store = async (e) => {
    if (typeof body?.name !== 'string' || body.name.trim().length < 2) fail(422, 'validation_failed', 'Eingaben ungültig.', { name: 'Länge muss zwischen 2 und 200 Zeichen liegen.' });
    const r = await situation(body.definition, body.bufferM ?? 0, body.scenarioId ?? null);
    Object.assign(e, { name: body.name.trim(), scenarioId: r.scenario?.id ?? null, bufferM: r.bufferM, definition: r.definition, snapshot: { label: r.label, scenario: r.scenario, takenAt: now(), inArea: r.inArea.map(slim), inBuffer: r.inBuffer.map(slim) }, updatedAt: now(), updatedById: actor.id });
    return e;
  };
  if (method === 'GET' && !rest) return { items: [...db.events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).map((e) => ({ id: e.id, name: e.name, occurredAt: e.occurredAt, bufferM: e.bufferM, scenarioId: e.scenarioId ?? null, scenarioName: db.scenarios.find((x) => x.id === e.scenarioId)?.name ?? null, label: e.snapshot.label,
    counts: { inArea: e.snapshot.inArea.length, inBuffer: e.snapshot.inBuffer.length, atRisk: e.scenarioId ? [...e.snapshot.inArea, ...e.snapshot.inBuffer].filter((f) => f.atRisk).length : null }, createdAt: e.createdAt, createdBy: present(e).createdBy })) };
  if (method === 'POST' && !rest) {
    const e = await store({ id: ++db.seq, occurredAt: now(), createdAt: now(), createdById: actor.id });
    db.events.push(e); save();
    return present(e);
  }
  const e = db.events.find((x) => String(x.id) === rest) || fail(404, 'not_found', 'Ereignis nicht gefunden.');
  if (method === 'GET') return present(e);
  if (method === 'PUT') { await store(e); save(); return present(e); }
  if (method === 'DELETE') { requireUser('admin'); db.events = db.events.filter((x) => x !== e); save(); return { ok: true }; }
  return fail(405, 'method_not_allowed', 'Nicht erlaubt.');
}

// ---------------- Live-Warnlage (Demo: direkter Abruf, falls der Browser darf) ----------------
const NINA = 'https://warnung.bund.de/api31';
let warnCache = null;
async function demoWarnings() {
  if (warnCache && Date.now() - warnCache.t < 300000) return warnCache.d;
  const sources = [];
  const warnings = [];
  const nrw = [5.85, 50.32, 9.47, 52.54];
  for (const [id, label] of [['mowas', 'Bevölkerungswarnungen (MoWaS)'], ['dwd', 'Unwetterwarnungen (DWD)']]) {
    try {
      const list = await (await fetch(`${NINA}/${id}/mapData.json`)).json();
      let n = 0;
      for (const it of list.slice(0, 80)) {
        const geo = await (await fetch(`${NINA}/warnings/${encodeURIComponent(it.id)}.geojson`)).json();
        const polys = [];
        for (const f of geo.features || []) {
          if (f.geometry?.type === 'Polygon') polys.push(f.geometry.coordinates);
          if (f.geometry?.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
        }
        if (!polys.length) continue;
        const pts = polys.flat(2);
        const bb = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]);
        if (bb[0] > nrw[2] || bb[2] < nrw[0] || bb[1] > nrw[3] || bb[3] < nrw[1]) continue;
        warnings.push({ id: it.id, source: id, title: it.i18nTitle?.de || 'Warnung', severity: it.severity || '', start: it.startDate || null, end: it.expiresDate || null, geometry: { type: 'MultiPolygon', coordinates: polys } });
        n++;
      }
      sources.push({ id, label, status: 'ok', fetchedAt: now(), count: n });
    } catch (e) {
      sources.push({ id, label, status: 'error', error: 'Dienst aus dem Browser nicht erreichbar (in der Demo kein Server-Proxy)', fetchedAt: null, count: 0 });
    }
  }
  sources.push({ id: 'wbi', label: 'Waldbrandgefahrenindex (DWD)', status: 'error', error: 'In der Demo nicht verfügbar (Abruf nur über den Server)', fetchedAt: null, count: 0 });
  const d = { checkedAt: now(), intervalS: 300, sources, warnings, wbi: null, attribution: ['Warnungen: BBK (MoWaS) · Deutscher Wetterdienst'] };
  warnCache = { t: Date.now(), d };
  return d;
}

async function demoHints(b) {
  const d = await demoWarnings();
  const hints = [];
  for (const w of d.warnings) {
    if (pointInGeometry([b.lon, b.lat], w.geometry)) {
      const map = [['Hochwasser', /hochwasser|flut/i], ['Starkregen', /regen/i], ['Sturm', /sturm|orkan|wind|böen/i], ['Waldbrand', /brand/i], ['Gefahrstoffunfall', /gefahrstoff|chemie|rauch|gas/i]];
      const hit = map.find(([, re]) => re.test(w.title));
      const sc = hit && db.scenarios.find((s) => s.name === hit[0]);
      if (sc) hints.push({ scenarioId: sc.id, scenario: sc.name, text: `Der Standort liegt in einem aktuellen Warngebiet (${w.title}).`, source: w.source, kind: 'warning' });
    }
  }
  return { hints, status: ['Hochwassergefahrenkarten sind in der Demo nicht verfügbar.', ...d.sources.filter((s) => s.status !== 'ok').map((s) => `${s.label}: nicht erreichbar.`)] };
}
