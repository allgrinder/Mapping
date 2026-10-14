// Administration › Import & Export: Bestand als Excel/CSV ausgeben, Excel/CSV einlesen mit Spaltenzuordnung,
// Prüfung, Dublettenerkennung, Vorschau und Fehlerbericht. Übernommen wird erst nach Bestätigung – alles oder nichts.
import proj4 from 'proj4';
import { api, ApiError } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI } from '../ui/icons.js';
import { confirmDialog, toast } from '../ui/dialog.js';
import { fileStamp } from '../export/csv.js';
import { UTM } from '../map/projection.js';
import { FIELDS, MAX_ROWS, guessMapping, buildRows, classify, commitPayload, exportRows, EXPORT_HEADER, errorReport } from '../import/core.js';
import { readTableFile, downloadXlsx, downloadCsv } from '../import/files.js';

const PREVIEW_LIMIT = 300;
const STATUS = {
  new: ['Neu', 'pill-ok'],
  duplicate: ['Dublette', 'pill-event'],
  error: ['Fehler', 'pill-danger'],
};
const utmToLonLat = ([e, n]) => proj4(UTM, 'EPSG:4326', [e, n]);
const chevron = () => svg(UI.down, { size: 14, stroke: 2.4 });

/** Namen der Gebiete (Regierungsbezirk/Kreis/Gemeinde) aus den Grenzdaten – für lesbare Exportspalten. */
async function areaNames() {
  const names = {};
  await Promise.all(['regbez', 'kreis', 'gemeinde'].map(async (l) => {
    try {
      const fc = await api('GET', `/boundaries/${l}`);
      names[l] = new Map((fc.features || []).map((f) => [f.properties.code, f.properties.name]));
    } catch { names[l] = new Map(); }
  }));
  return (code, level) => (code ? names[level]?.get(code) || code : '');
}

/** Bestand (oder eine gefilterte Auswahl) exportieren. */
export async function exportFacilities(items, { categories, scenarios, format, label = 'Einrichtungen' }) {
  const rows = exportRows(items, { categories, scenarios, areaName: await areaNames() });
  const base = `KRITIS_${label}_${fileStamp()}`;
  if (format === 'xlsx') await downloadXlsx(`${base}.xlsx`, EXPORT_HEADER, rows);
  else downloadCsv(`${base}.csv`, EXPORT_HEADER, rows);
}

export function renderImportExport(main, { categories, scenarios, onChanged }) {
  const notice = h('div');
  const st = { file: null, sheets: [], sheetIdx: 0, mapping: null, rows: null, filter: 'all', dupAction: 'skip', busy: false, existing: [] };

  const head = h('div', { class: 'sec-head' },
    h('div', {}, h('h2', {}, 'Import & Export'),
      h('div', { class: 'cap' }, 'Einrichtungen aus Excel (.xlsx) oder CSV übernehmen und den Bestand ausgeben. Exportdateien lassen sich wieder einlesen.')));

  // ---------------- Export ----------------
  const exportCount = h('span', { class: 'tnum' }, '…');
  const exBtn = (format, label) => {
    const b = h('button', { class: 'btn btn-secondary on-fill', type: 'button' }, svg(UI.download, { size: 16, stroke: 2.2 }), label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const { items } = await api('GET', '/facilities');
        if (!items.length) { toast(notice, 'Es sind noch keine Einrichtungen erfasst.', 'err'); return; }
        await exportFacilities(items, { categories, scenarios, format, label: 'Bestand' });
        toast(notice, `${items.length} Einrichtungen exportiert.`);
      } catch (e) {
        toast(notice, e instanceof ApiError ? e.message : 'Export fehlgeschlagen.', 'err');
      } finally { b.disabled = false; }
    });
    return b;
  };
  const template = h('button', { class: 'btn btn-plain', type: 'button' }, 'Vorlage herunterladen');
  template.addEventListener('click', () => downloadXlsx('KRITIS_Importvorlage.xlsx',
    ['Externe ID', 'Name', 'Kategorie', 'Straße', 'PLZ', 'Ort', 'Breitengrad', 'Längengrad', 'Gefährdet bei', 'Ansprechperson', 'Funktion', 'Telefon', 'E-Mail', 'Hinweis'],
    [['', 'Beispiel-Einrichtung', categories[0]?.name || '', 'Musterstraße 1', '40210', 'Düsseldorf', 51.2203, 6.7845, scenarios.slice(0, 2).map((s) => s.name).join(', '), '', '', '', '', 'Diese Zeile vor dem Import löschen']],
    'Einrichtungen',
    [{ sheet: 'Kategorien', header: ['Kategorie'], rows: categories.map((c) => [c.name]) },
      { sheet: 'Szenarien', header: ['Krisenszenario'], rows: scenarios.map((s) => [s.name]) }]));

  const exportCard = h('div', { class: 'io-card' },
    h('div', { class: 'io-title' }, h('h3', {}, 'Export'), h('span', { class: 'cap' }, exportCount, ' Einrichtungen im Bestand')),
    h('div', { class: 'cap' }, 'Alle Einrichtungen mit Adresse, Koordinaten (WGS84), Gefährdungen, Kontakt, Gebietszuordnung und Änderungsangaben. Gefilterte Auswahlen exportieren Sie direkt in der Kartenansicht.'),
    h('div', { class: 'io-actions' }, exBtn('xlsx', 'Excel (.xlsx)'), exBtn('csv', 'CSV'), template));

  // ---------------- Import ----------------
  const fileInput = h('input', { type: 'file', accept: '.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'sr-only', id: 'imp-file' });
  const fileErr = h('div', { class: 'field-err', role: 'alert', hidden: true });
  const drop = h('label', { class: 'io-drop', for: 'imp-file' },
    svg(UI.download, { size: 22, stroke: 2 }),
    h('span', { class: 'strong' }, 'Datei auswählen oder hierher ziehen'),
    h('span', { class: 'cap' }, `Excel (.xlsx) oder CSV (Trennzeichen ; , oder Tab, UTF-8 oder Windows-1252) · höchstens ${MAX_ROWS.toLocaleString('de-DE')} Zeilen · erste Zeile = Spaltenüberschriften`));
  const work = h('div', { class: 'io-work' });
  const importCard = h('div', { class: 'io-card' }, h('div', { class: 'io-title' }, h('h3', {}, 'Import')), drop, fileInput, fileErr, work);

  main.replaceChildren(head, notice, exportCard, importCard);
  api('GET', '/facilities').then((d) => { exportCount.textContent = d.items.length; st.existing = d.items; }).catch(() => { exportCount.textContent = '–'; });

  const onFile = async (file) => {
    fileErr.hidden = true;
    if (!file) return;
    try {
      const t = await readTableFile(file);
      if (!t.sheets.length || t.sheets.every((s) => s.rows.length < 2)) throw new Error('Die Datei enthält keine Datenzeilen (erste Zeile = Überschriften).');
      st.file = file;
      st.sheets = t.sheets;
      st.sheetIdx = Math.max(0, t.sheets.findIndex((s) => s.rows.length >= 2));
      st.mapping = guessMapping(st.sheets[st.sheetIdx].rows[0]);
      st.rows = null;
      renderMapping();
    } catch (e) {
      fileErr.textContent = e.message || 'Die Datei konnte nicht gelesen werden.';
      fileErr.hidden = false;
      work.replaceChildren();
    }
  };
  fileInput.addEventListener('change', () => { onFile(fileInput.files[0]); fileInput.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); onFile(e.dataTransfer.files[0]); });

  const sheet = () => st.sheets[st.sheetIdx];
  const headers = () => sheet().rows[0];
  const dataRows = () => sheet().rows.slice(1);

  // Schritt 2: Spalten zuordnen
  function renderMapping() {
    const hs = headers();
    const sample = dataRows()[0] || [];
    const sheetSel = st.sheets.length > 1
      ? h('div', {}, h('label', { class: 'lbl', for: 'imp-sheet' }, 'Tabellenblatt'),
        h('div', { class: 'selw' }, h('select', { id: 'imp-sheet', class: 'input on-fill', onChange: (e) => { st.sheetIdx = Number(e.target.value); st.mapping = guessMapping(headers()); renderMapping(); } },
          st.sheets.map((s, i) => h('option', { value: i, selected: i === st.sheetIdx }, `${s.name} (${Math.max(0, s.rows.length - 1)} Zeilen)`))), chevron()))
      : null;
    const tooMany = dataRows().length > MAX_ROWS;
    const fieldRow = (f, key = f.key, label = f.label) => {
      const sel = h('select', { class: 'input on-fill', id: 'map-' + key, 'aria-label': `Spalte für ${label}` },
        h('option', { value: '' }, '— nicht übernehmen —'),
        hs.map((t, i) => h('option', { value: i, selected: st.mapping[key] === i }, t || `Spalte ${i + 1}`)));
      sel.addEventListener('change', () => { st.mapping[key] = sel.value === '' ? null : Number(sel.value); st.rows = null; renderMapping(); });
      const idx = st.mapping[key];
      return h('div', { class: 'map-row' },
        h('label', { class: 'lbl', for: 'map-' + key }, label, f.required ? h('span', { class: 'req', 'aria-label': 'Pflichtfeld' }, ' *') : null),
        h('div', { class: 'selw' }, sel, chevron()),
        h('div', { class: 'cap ellipsis', title: idx !== null && idx !== undefined ? sample[idx] || '' : '' }, idx !== null && idx !== undefined ? (sample[idx] || '(leer)') : ''));
    };
    const missing = FIELDS.filter((f) => f.required && (st.mapping[f.key] === null || st.mapping[f.key] === undefined));
    const noCoords = [st.mapping.lat, st.mapping.lon].includes(null) && [st.mapping.east, st.mapping.north].includes(null);
    const check = h('button', { class: 'btn btn-primary', type: 'button', disabled: missing.length > 0 || tooMany }, 'Prüfen und Vorschau anzeigen');
    check.addEventListener('click', runCheck);
    fill(work,
      h('div', { class: 'io-file' }, h('span', { class: 'strong' }, st.file.name), h('span', { class: 'cap' }, `${dataRows().length} Datenzeilen · ${hs.length} Spalten`)),
      sheetSel,
      h('h4', {}, 'Spalten zuordnen'),
      h('div', { class: 'cap' }, 'Die Zuordnung wurde anhand der Überschriften vorgeschlagen. Rechts steht der Wert aus der ersten Datenzeile. Kategorien und Szenarien werden über ihren Namen erkannt; mehrere Szenarien mit Komma oder Semikolon trennen.'),
      h('div', { class: 'map-grid' }, FIELDS.map((f) => fieldRow(f)), st.mapping.street !== null ? fieldRow({ key: 'houseNumber', label: 'Hausnummer (getrennt)' }) : null),
      tooMany ? h('div', { class: 'field-err', role: 'alert' }, `Die Datei hat mehr als ${MAX_ROWS} Zeilen. Bitte aufteilen.`) : null,
      missing.length ? h('div', { class: 'field-err', role: 'alert' }, `Bitte noch zuordnen: ${missing.map((f) => f.label).join(', ')}.`) : null,
      noCoords && !missing.length ? h('div', { class: 'cap' }, 'Ohne Koordinatenspalten werden die Standorte im nächsten Schritt über die Adresssuche ermittelt.') : null,
      h('div', { class: 'io-actions' }, check));
  }

  // Schritt 3: prüfen, Dubletten erkennen, Vorschau
  async function runCheck() {
    try {
      const fresh = await api('GET', '/facilities');
      st.existing = fresh.items;
    } catch (e) {
      toast(notice, e instanceof ApiError ? e.message : 'Bestand konnte nicht geladen werden.', 'err');
      return;
    }
    st.rows = buildRows(dataRows(), st.mapping, { categories, scenarios, utmToLonLat });
    classify(st.rows, st.existing);
    st.filter = 'all';
    renderPreview();
  }

  function reclassify() {
    for (const r of st.rows) {
      // Serverfehler und Geokodier-Hinweise bleiben, berechnete Fehler werden neu ermittelt
      delete r.errors._;
      delete r.errors.id;
      if (r.data.location) delete r.errors.location;
    }
    classify(st.rows, st.existing);
  }

  async function geocodeMissing(btn, progress) {
    const todo = st.rows.filter((r) => r.needsGeocode && !r.data.location && !r.geocodeTried);
    st.busy = true;
    btn.disabled = true;
    let found = 0;
    for (const [i, r] of todo.entries()) {
      progress.textContent = `Adresssuche ${i + 1} von ${todo.length} …`;
      r.geocodeTried = true;
      const q = [r.data.street, [r.data.zip, r.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      try {
        const res = await api('GET', '/geocode?q=' + encodeURIComponent(q));
        const hit = res.items?.[0];
        if (hit) {
          r.data.location = { lon: Math.round(hit.lon * 1e7) / 1e7, lat: Math.round(hit.lat * 1e7) / 1e7 };
          r.warnings.push(`Standort per Adresssuche: ${hit.label}`);
          found++;
        } else r.errors.location = 'Adresse nicht gefunden – bitte Koordinaten in der Datei ergänzen.';
      } catch (e) {
        if (e instanceof ApiError && e.code === 'geocoder_unavailable') {
          r.geocodeTried = false;
          toast(notice, e.message, 'err');
          break;
        }
        r.errors.location = e instanceof ApiError ? e.message : 'Adresssuche fehlgeschlagen.';
      }
      if (i < todo.length - 1) await new Promise((ok) => setTimeout(ok, 1100)); // Nutzungsbedingungen: max. 1 Anfrage/s
    }
    st.busy = false;
    reclassify();
    renderPreview();
    toast(notice, `${found} von ${todo.length} Standorten über die Adresssuche ermittelt. Bitte in der Vorschau prüfen.`);
  }

  function renderPreview() {
    const rows = st.rows;
    const n = { all: rows.length, new: 0, duplicate: 0, error: 0 };
    for (const r of rows) n[r.status]++;
    const geo = rows.filter((r) => r.needsGeocode && !r.data.location && !r.geocodeTried).length;
    const cat = new Map(categories.map((c) => [c.id, c.name]));
    const tab = (key, label) => h('button', { type: 'button', 'aria-pressed': String(st.filter === key), onClick: () => { st.filter = key; renderPreview(); } }, `${label} (${n[key]})`);

    const shown = rows.filter((r) => st.filter === 'all' || r.status === st.filter);
    const note = (r) => {
      if (r.status === 'error') return h('span', { class: 'err-text' }, Object.values(r.errors).join(' · '));
      const parts = [];
      if (r.match) parts.push(`entspricht #${r.match.facility.id} „${r.match.facility.name}“ (${r.match.reason})`);
      parts.push(...r.warnings);
      return parts.join(' · ');
    };
    const table = h('div', { class: 'tbl-wrap io-preview' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Zeile', 'Status', 'Name', 'Kategorie', 'Ort', 'Hinweis'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, shown.slice(0, PREVIEW_LIMIT).map((r) => h('tr', {},
        h('td', { class: 'tnum' }, r.row),
        h('td', {}, h('span', { class: 'pill ' + STATUS[r.status][1] }, STATUS[r.status][0])),
        h('td', { class: 'strong' }, r.data.name || '–'),
        h('td', {}, cat.get(r.data.categoryId) || '–'),
        h('td', {}, [r.data.zip, r.data.city].filter(Boolean).join(' ') || '–'),
        h('td', { class: 'io-note' }, note(r)))))));

    const dup = h('div', { class: 'seg io-dup', role: 'group', 'aria-label': 'Umgang mit Dubletten' },
      h('button', { type: 'button', 'aria-pressed': String(st.dupAction === 'skip'), onClick: () => { st.dupAction = 'skip'; renderPreview(); } }, 'Dubletten überspringen'),
      h('button', { type: 'button', 'aria-pressed': String(st.dupAction === 'update'), onClick: () => { st.dupAction = 'update'; renderPreview(); } }, 'Bestand aktualisieren'));

    const payload = commitPayload(rows, st.dupAction, st.file.name);
    const creates = payload.rows.filter((r) => r.action === 'create').length;
    const updates = payload.rows.length - creates;
    const commit = h('button', { class: 'btn btn-primary', type: 'button', disabled: payload.rows.length === 0 || st.busy },
      `Import übernehmen (${creates} neu${updates ? `, ${updates} aktualisieren` : ''})`);
    commit.addEventListener('click', () => doCommit(payload, creates, updates, n.error, commit));

    const report = h('button', { class: 'btn btn-secondary on-fill', type: 'button', disabled: n.error === 0 }, svg(UI.download, { size: 16, stroke: 2.2 }), 'Fehlerbericht (CSV)');
    report.addEventListener('click', () => {
      const rep = errorReport(rows, headers(), dataRows());
      downloadCsv(`Fehlerbericht_${st.file.name.replace(/\.[^.]+$/, '')}_${fileStamp()}.csv`, rep.header, rep.rows);
    });
    const progress = h('span', { class: 'cap', 'aria-live': 'polite' });
    const geoBtn = h('button', { class: 'btn btn-secondary on-fill', type: 'button', disabled: st.busy }, svg(UI.search, { size: 16, stroke: 2.2 }), `Standorte per Adresssuche ermitteln (${geo})`);
    geoBtn.addEventListener('click', () => geocodeMissing(geoBtn, progress));
    const back = h('button', { class: 'btn btn-plain', type: 'button' }, 'Zuordnung ändern');
    back.addEventListener('click', () => { st.rows = null; renderMapping(); });

    fill(work,
      h('div', { class: 'io-file' }, h('span', { class: 'strong' }, st.file.name), h('span', { class: 'cap' }, `${rows.length} Datenzeilen geprüft`)),
      h('div', { class: 'io-stats' },
        stat(n.new, 'neu', 'ok'), stat(n.duplicate, 'Dubletten', 'event'), stat(n.error, 'fehlerhaft', 'danger')),
      geo ? h('div', { class: 'io-hint' }, h('span', {}, `${geo} ${geo === 1 ? 'Zeile' : 'Zeilen'} ohne Koordinaten. Die Adresssuche benötigt etwa ${Math.ceil(geo * 1.1)} Sekunden.`), geoBtn, progress) : null,
      n.duplicate ? h('div', { class: 'io-hint' }, h('span', {}, 'Dubletten: gleiche ID, gleiche externe ID, gleicher Name mit PLZ und Straße oder gleicher Name im Umkreis von 200 m.'), dup) : null,
      h('div', { class: 'seg io-tabs', role: 'group', 'aria-label': 'Zeilen filtern' }, tab('all', 'Alle'), tab('new', 'Neu'), tab('duplicate', 'Dubletten'), tab('error', 'Fehler')),
      table,
      shown.length > PREVIEW_LIMIT ? h('div', { class: 'cap' }, `Vorschau zeigt die ersten ${PREVIEW_LIMIT} von ${shown.length} Zeilen.`) : null,
      h('div', { class: 'io-actions' }, back, report, h('span', { class: 'grow' }), commit),
      n.error ? h('div', { class: 'cap' }, 'Fehlerhafte Zeilen werden nicht übernommen. Korrigieren Sie die Datei mithilfe des Fehlerberichts und lesen Sie sie erneut ein.') : null);
  }

  async function doCommit(payload, creates, updates, errors, btn) {
    const msg = [`${creates} Einrichtungen werden neu angelegt`, updates ? `${updates} bestehende werden überschrieben` : null,
      errors ? `${errors} fehlerhafte Zeilen werden ausgelassen` : null].filter(Boolean).join(', ') + '.';
    if (!(await confirmDialog({ title: 'Import übernehmen?', message: msg, confirmLabel: 'Übernehmen' }))) return;
    btn.disabled = true;
    try {
      const res = await api('POST', '/import/commit', payload);
      toast(notice, `Import abgeschlossen: ${res.created} neu, ${res.updated} aktualisiert.`);
      st.file = null; st.rows = null; st.sheets = [];
      work.replaceChildren();
      const d = await api('GET', '/facilities');
      st.existing = d.items;
      exportCount.textContent = d.items.length;
      onChanged?.();
    } catch (e) {
      if (e instanceof ApiError && e.rows) {
        const byRow = new Map(st.rows.map((r) => [r.row, r]));
        for (const er of e.rows) {
          const r = byRow.get(er.row);
          if (r) { Object.assign(r.errors, er.fields); r.status = 'error'; }
        }
        st.filter = 'error';
        renderPreview();
        toast(notice, e.message + ' Die betroffenen Zeilen sind markiert.', 'err');
      } else {
        toast(notice, e instanceof ApiError ? e.message : 'Import fehlgeschlagen.', 'err');
        btn.disabled = false;
      }
    }
  }
}

/** replaceChildren ohne null/false (bedingte Bausteine). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
}

function stat(n, label, kind) {
  return h('div', { class: 'io-stat ' + kind }, h('span', { class: 'num tnum' }, n), h('span', {}, label));
}
