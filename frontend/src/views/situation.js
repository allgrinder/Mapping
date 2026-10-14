import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Draw from 'ol/interaction/Draw.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import { toLonLat, fromLonLat } from 'ol/proj.js';
import { api, ApiError } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI, SYMBOLS } from '../ui/icons.js';
import { toast, confirmDialog } from '../ui/dialog.js';
import { createMap } from '../map/mapView.js';
import { createFacilityLayer } from '../map/facilityLayer.js';
import { themeColors } from '../map/styles.js';
import { UTM } from '../map/projection.js';
import { mapToCanvas } from '../map/exportCanvas.js';
import { formatAddress } from '../facilities.js';
import { toCsv, download, fileStamp, safeName } from '../export/csv.js';

const EVENT = '#C2510A';
const areaStyle = new Style({ fill: new Fill({ color: 'rgba(217,96,17,.2)' }), stroke: new Stroke({ color: EVENT, width: 2 }) });
const bufferStyle = new Style({ fill: new Fill({ color: 'rgba(217,96,17,.07)' }), stroke: new Stroke({ color: EVENT, width: 1.5, lineDash: [6, 4] }) });
const centerStyle = new Style({ image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#B0460A', width: 2 }) }) });

export async function renderSituation(root, { me, eventId, navigate }) {
  const [cfg, cats, scens, fac, rb, kr] = await Promise.all([
    api('GET', '/map/config'), api('GET', '/categories'), api('GET', '/scenarios'), api('GET', '/facilities'),
    api('GET', '/boundaries/regbez').catch(() => ({ features: [] })), api('GET', '/boundaries/kreis').catch(() => ({ features: [] })),
  ]);
  const catById = new Map(cats.items.map((c) => [c.id, c]));
  const scenById = new Map(scens.items.map((s) => [s.id, s]));
  const areaOptions = {
    regbez: rb.features.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    kreis: kr.features.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    plz5: null,
  };
  const levelsLoaded = new Set(cfg.boundaries.map((b) => b.level));

  const ev = eventId ? await api('GET', `/events/${eventId}`) : null;
  const st = {
    id: ev?.id ?? null,
    name: ev?.name ?? `Ereignis ${new Date().toLocaleDateString('de-DE')}`,
    tool: ev?.definition.type ?? 'polygon',
    polygon: ev?.definition.type === 'polygon' ? ev.definition.coordinates : null,
    center: ev?.definition.type === 'circle' ? ev.definition.center : null,
    radiusKm: ev?.definition.type === 'circle' ? ev.definition.radiusM / 1000 : 5,
    level: ev?.definition.type === 'boundary' ? ev.definition.level : 'kreis',
    code: ev?.definition.type === 'boundary' ? ev.definition.code : '',
    bufferOn: ev ? ev.bufferM > 0 : true,
    bufferKm: ev?.bufferM > 0 ? ev.bufferM / 1000 : 2,
    result: null,
    createdInfo: ev ? `angelegt ${new Date(ev.createdAt.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${ev.createdBy || ''}` : 'neues Ereignis – noch nicht gespeichert',
  };

  const canvas = h('div', { class: 'map-canvas' });
  const notice = h('div', { class: 'notice-float sit-notice' });
  const page = h('div', { class: 'map-page sit-page' }, canvas);
  root.replaceChildren(page);
  const map = await createMap(canvas, cfg, { fitPadding: [84, 280, 24, 432] });
  map.setOverlay('kreis', true);

  const facLayer = createFacilityLayer(map.map, {
    categories: cats.items, cluster: false,
    colors: () => { const cs = getComputedStyle(root); return { surface: cs.getPropertyValue('--surface').trim(), text: cs.getPropertyValue('--text').trim(), ...themeColors() }; },
    onSelect: () => {},
  });
  facLayer.setItems(fac.items);

  const geojson = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: UTM });
  const areaSrc = new VectorSource();
  const bufSrc = new VectorSource();
  const drawSrc = new VectorSource();
  map.map.addLayer(new VectorLayer({ source: bufSrc, style: bufferStyle, zIndex: 35 }));
  map.map.addLayer(new VectorLayer({ source: areaSrc, style: (f) => (f.getGeometry().getType() === 'Point' ? centerStyle : areaStyle), zIndex: 36 }));
  map.map.addLayer(new VectorLayer({ source: drawSrc, style: areaStyle, zIndex: 37 }));

  // ---------- Zeichnen / Auswählen ----------
  let draw = null;
  const enableDraw = () => {
    if (draw) map.map.removeInteraction(draw);
    draw = new Draw({ source: drawSrc, type: 'Polygon', style: new Style({ fill: new Fill({ color: 'rgba(217,96,17,.15)' }), stroke: new Stroke({ color: EVENT, width: 2, lineDash: [4, 3] }), image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: EVENT, width: 2 }) }) }) });
    draw.on('drawstart', () => { drawSrc.clear(); });
    draw.on('drawend', (e) => {
      const ring = e.feature.getGeometry().getCoordinates()[0].map((c) => toLonLat(c, UTM).map((v) => Math.round(v * 1e6) / 1e6));
      st.polygon = ring;
      setTimeout(() => { drawSrc.clear(); map.map.removeInteraction(draw); draw = null; renderTool(); run(); }, 0);
    });
    map.map.addInteraction(draw);
  };
  map.map.on('singleclick', async (e) => {
    if (st.tool === 'circle') {
      st.center = toLonLat(e.coordinate, UTM).map((v) => Math.round(v * 1e6) / 1e6);
      run();
    } else if (st.tool === 'boundary' && (st.level === 'regbez' || st.level === 'kreis' || st.level === 'plz5')) {
      const [lon, lat] = toLonLat(e.coordinate, UTM);
      const r = await api('GET', `/geo/resolve?lon=${lon}&lat=${lat}`).catch(() => null);
      const code = st.level === 'plz5' ? r?.plz5 : r?.[st.level];
      if (code) { st.code = code; renderTool(); run(); }
    }
  });

  // ---------- Abfrage ----------
  let timer;
  let seq = 0;
  function definition() {
    if (st.tool === 'polygon') return st.polygon ? { type: 'polygon', coordinates: st.polygon } : null;
    if (st.tool === 'circle') return st.center ? { type: 'circle', center: st.center, radiusM: Math.round(st.radiusKm * 1000) } : null;
    return st.code ? { type: 'boundary', level: st.level, code: st.code } : null;
  }
  function run() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const def = definition();
      const my = ++seq;
      if (!def) { st.result = null; paintResult(); return; }
      try {
        const r = await api('POST', '/situation/query', { definition: def, bufferM: st.bufferOn ? Math.round(st.bufferKm * 1000) : 0 });
        if (my !== seq) return;
        st.result = r;
        paintResult();
      } catch (e) {
        if (my !== seq) return;
        st.result = null;
        paintResult();
        toast(notice, e.message, 'err');
      }
    }, 200);
  }

  const summary = h('span', { class: 'sit-summary' });
  const resultBox = h('div', { class: 'sit-results' });
  function numbered() {
    const r = st.result;
    if (!r) return { A: [], B: [] };
    return { A: r.inArea.map((f, i) => ({ f, num: i + 1 })), B: r.inBuffer.map((f, i) => ({ f, num: r.inArea.length + i + 1 })) };
  }
  function paintResult() {
    areaSrc.clear();
    bufSrc.clear();
    const r = st.result;
    if (!r) {
      facLayer.setHighlight(null);
      summary.textContent = 'Noch kein Ereignisgebiet';
      resultBox.replaceChildren(h('div', { class: 'cap', style: { padding: '4px 2px' } }, toolHint()));
      return;
    }
    areaSrc.addFeature(geojson.readFeature({ type: 'Feature', geometry: r.area }));
    if (r.definition.type === 'circle') areaSrc.addFeature(geojson.readFeature({ type: 'Feature', geometry: { type: 'Point', coordinates: r.definition.center } }));
    if (r.buffer) bufSrc.addFeature(geojson.readFeature({ type: 'Feature', geometry: r.buffer }));
    const n = numbered();
    const hl = new Map([...n.A.map(({ f, num }) => [f.id, { zone: 'A', num }]), ...n.B.map(({ f, num }) => [f.id, { zone: 'B', num }])]);
    facLayer.setHighlight(hl);
    summary.textContent = `${r.inArea.length} im Gebiet${r.buffer ? ` · ${r.inBuffer.length} in Pufferzone` : ''}`;
    const res = ({ f, num }, zone) => {
      const c = catById.get(f.categoryId);
      const b = h('button', { class: 'res', type: 'button', onClick: () => map.view.animate({ center: fromLonLat([f.location.lon, f.location.lat], UTM), resolution: Math.min(map.view.getResolution(), 40), duration: 300 }) },
        h('span', { class: 'badge badge-' + zone }, num),
        h('span', { class: 'res-text' },
          h('span', { class: 'res-name' }, f.name),
          h('span', { class: 'cap' }, [f.address.city, c?.name].filter(Boolean).join(' · ')),
          (f.contact.person || f.contact.phone) ? h('span', { class: 'res-contact' }, [f.contact.person, f.contact.phone].filter(Boolean).join(' · ')) : null));
      return b;
    };
    resultBox.replaceChildren(
      h('div', { class: 'res-group' },
        h('div', { class: 'res-head' }, h('span', { class: 'zone-dot zone-a' }), h('span', { class: 'sec', style: { flex: '1' } }, 'Im Gebiet'), h('strong', {}, String(n.A.length))),
        n.A.length ? n.A.map((x) => res(x, 'A')) : h('div', { class: 'cap res-empty' }, 'Keine Einrichtungen im Gebiet.')),
      r.buffer ? h('div', { class: 'res-group' },
        h('div', { class: 'res-head' }, h('span', { class: 'zone-dot zone-b' }), h('span', { class: 'sec', style: { flex: '1' } }, 'In Pufferzone'), h('strong', {}, String(n.B.length))),
        n.B.length ? n.B.map((x) => res(x, 'B')) : h('div', { class: 'cap res-empty' }, 'Keine Einrichtungen in der Pufferzone.')) : null);
  }

  // ---------- Werkzeuge ----------
  const toolHint = () => ({
    polygon: 'Fläche in der Karte zeichnen: Eckpunkte per Klick setzen, mit Doppelklick abschließen.',
    circle: 'Mittelpunkt per Klick in die Karte setzen.',
    boundary: 'Gebiet auswählen oder in die Karte klicken.',
  })[st.tool];
  const toolBox = h('div', { class: 'tool-box' });
  const segBtn = (tool, icon, label) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.tool === tool) }, svg(icon, { size: 15 }), label);
    b.addEventListener('click', () => {
      st.tool = tool;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      renderTool();
      run();
    });
    return b;
  };
  const seg = h('div', { class: 'seg seg-tools', role: 'tablist', 'aria-label': 'Werkzeug' },
    segBtn('polygon', UI.polygon, 'Fläche'), segBtn('circle', UI.radius, 'Radius'), segBtn('boundary', UI.grid, 'Gebiet'));

  function renderTool() {
    if (draw) { map.map.removeInteraction(draw); draw = null; }
    if (st.tool === 'polygon') {
      const info = st.polygon ? `${st.polygon.length - 1} Eckpunkte` : 'noch nicht gezeichnet';
      if (!st.polygon) enableDraw();
      toolBox.replaceChildren(h('div', { class: 'tool-hint' }, toolHint()),
        h('div', { class: 'row-gap' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => { st.polygon = null; renderTool(); run(); } }, 'Neu zeichnen'), h('span', { class: 'cap' }, info)));
    } else if (st.tool === 'circle') {
      const val = h('span', { class: 'range-val' }, `${fmtKm(st.radiusKm)} km`);
      const range = h('input', { id: 'ev-r', type: 'range', min: '0.5', max: '30', step: '0.5', value: String(st.radiusKm) });
      range.addEventListener('input', () => { st.radiusKm = Number(range.value); val.textContent = `${fmtKm(st.radiusKm)} km`; run(); });
      toolBox.replaceChildren(h('div', { class: 'tool-hint' }, toolHint()),
        h('div', {}, h('div', { class: 'range-head' }, h('label', { class: 'lbl', for: 'ev-r' }, 'Radius'), val), range));
    } else {
      const typeSel = h('select', { id: 'ev-at', class: 'input' },
        [['regbez', 'Regierungsbezirk'], ['kreis', 'Kreis / kreisfr. Stadt'], ['plz5', 'PLZ-Gebiet (5-stellig)']].map(([v, t]) => h('option', { value: v, selected: st.level === v, disabled: !levelsLoaded.has(v) }, t)));
      const valWrap = h('div', { class: 'selw' });
      const fillVals = async () => {
        if (st.level === 'plz5' && !areaOptions.plz5) areaOptions.plz5 = (await api('GET', '/boundaries/plz5').catch(() => ({ features: [] }))).features.map((f) => ({ code: f.properties.code, name: `${f.properties.code} ${f.properties.name}` }));
        const opts = areaOptions[st.level] || [];
        const sel = h('select', { id: 'ev-av', class: 'input' }, h('option', { value: '' }, 'Bitte wählen …'), opts.map((o) => h('option', { value: o.code, selected: o.code === st.code }, o.name)));
        sel.addEventListener('change', () => { st.code = sel.value; run(); if (sel.value && st.level !== 'plz5') map.zoomToBoundary(st.level, sel.value).catch(() => {}); });
        valWrap.replaceChildren(sel, svg(UI.down, { size: 14, stroke: 2.4 }));
      };
      typeSel.addEventListener('change', () => { st.level = typeSel.value; st.code = ''; fillVals(); run(); });
      fillVals();
      toolBox.replaceChildren(h('div', { class: 'tool-hint' }, toolHint()),
        h('div', { class: 'area-grid' },
          h('div', {}, h('label', { class: 'lbl', for: 'ev-at' }, 'Gebietsart'), h('div', { class: 'selw' }, typeSel, svg(UI.down, { size: 14, stroke: 2.4 }))),
          h('div', {}, h('label', { class: 'lbl', for: 'ev-av' }, 'Auswahl'), valWrap)));
    }
  }
  const fmtKm = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });

  // ---------- Puffer ----------
  const bufVal = h('span', { class: 'range-val' }, `+ ${fmtKm(st.bufferKm)} km`);
  const bufRange = h('input', { id: 'ev-b', type: 'range', min: '0.5', max: '20', step: '0.5', value: String(st.bufferKm) });
  bufRange.addEventListener('input', () => { st.bufferKm = Number(bufRange.value); bufVal.textContent = `+ ${fmtKm(st.bufferKm)} km`; run(); });
  const bufBody = h('div', { hidden: !st.bufferOn }, h('div', { class: 'range-head' }, h('label', { class: 'lbl', for: 'ev-b' }, 'Breite'), bufVal), bufRange);
  const bufSw = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(st.bufferOn), 'aria-label': 'Pufferzone' });
  bufSw.addEventListener('click', () => { st.bufferOn = !st.bufferOn; bufSw.setAttribute('aria-checked', String(st.bufferOn)); bufBody.hidden = !st.bufferOn; run(); });

  // ---------- Name, Speichern, Export ----------
  const nameIn = h('input', { id: 'ev-name', class: 'input', value: st.name, maxlength: 200, style: { 'font-weight': '600' } });
  const barName = h('span', { class: 'bar-name' }, st.name);
  const barInfo = h('span', { class: 'bar-info' }, st.createdInfo);
  nameIn.addEventListener('input', () => { st.name = nameIn.value; barName.textContent = st.name; });
  const saveBtn = h('button', { class: 'btn btn-eventfill save-btn', type: 'button' }, st.id ? 'Ereignis aktualisieren' : 'Ereignis speichern');
  saveBtn.addEventListener('click', async () => {
    const def = definition();
    if (!def) { toast(notice, 'Bitte zuerst ein Ereignisgebiet festlegen.', 'err'); return; }
    saveBtn.disabled = true;
    try {
      const body = { name: st.name.trim(), definition: def, bufferM: st.bufferOn ? Math.round(st.bufferKm * 1000) : 0 };
      const r = await api(st.id ? 'PUT' : 'POST', st.id ? `/events/${st.id}` : '/events', body);
      const first = !st.id;
      st.id = r.id;
      saveBtn.textContent = 'Ereignis aktualisieren';
      barInfo.textContent = `gespeichert ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
      toast(notice, `„${r.name}“ wurde gespeichert.`);
      if (first) history.replaceState(null, '', `#/lage/${r.id}`);
    } catch (e) {
      toast(notice, e instanceof ApiError ? (Object.values(e.fields)[0] || e.message) : 'Speichern fehlgeschlagen.', 'err');
    } finally { saveBtn.disabled = false; }
  });

  const csvBtn = h('button', { class: 'btn btn-secondary btn-sm2', type: 'button' }, svg(UI.download, { size: 15 }), 'CSV exportieren');
  csvBtn.addEventListener('click', () => {
    if (!st.result) { toast(notice, 'Bitte zuerst ein Ereignisgebiet festlegen.', 'err'); return; }
    const n = numbered();
    const rows = [...n.A.map((x) => [x, 'Im Gebiet']), ...n.B.map((x) => [x, 'Pufferzone'])].map(([{ f, num }, zone]) => [
      num, zone, f.name, catById.get(f.categoryId)?.name, f.address.street, f.address.zip, f.address.city,
      f.admin.regbez, f.admin.kreis, f.contact.person, f.contact.function, f.contact.phone, f.contact.email,
      f.hazards.map((x) => scenById.get(x)?.name).filter(Boolean).join(', '), f.location.lat, f.location.lon,
    ]);
    download(`Lageliste_${safeName(st.name)}_${fileStamp()}.csv`, toCsv(
      ['Nr', 'Zone', 'Einrichtung', 'Kategorie', 'Straße', 'PLZ', 'Ort', 'Reg.-Bez. (Schlüssel)', 'Kreis (Schlüssel)', 'Ansprechperson', 'Funktion', 'Telefon', 'E-Mail', 'Gefährdet bei', 'Breite', 'Länge'], rows));
  });
  const pdfBtn = h('button', { class: 'btn btn-secondary btn-sm2', type: 'button' }, svg(UI.print, { size: 15 }), 'PDF-Lageliste');
  pdfBtn.addEventListener('click', async () => {
    if (!st.result) { toast(notice, 'Bitte zuerst ein Ereignisgebiet festlegen.', 'err'); return; }
    pdfBtn.disabled = true;
    try {
      const ext = [...areaSrc.getExtent()];
      if (bufSrc.getFeatures().length) { const b = bufSrc.getExtent(); ext[0] = Math.min(ext[0], b[0]); ext[1] = Math.min(ext[1], b[1]); ext[2] = Math.max(ext[2], b[2]); ext[3] = Math.max(ext[3], b[3]); }
      map.view.fit(ext, { padding: [110, 300, 40, 440] });
      const canvasImg = await mapToCanvas(map.map);
      const { buildLagelistePdf } = await import('../export/lageliste.js');
      const doc = buildLagelistePdf({
        name: st.name, label: st.result.label, bufferM: st.result.bufferM, inArea: st.result.inArea, inBuffer: st.result.inBuffer,
        catById, scenById, mapImage: cropForPdf(canvasImg), user: me.displayName || me.username, sources: cfg.attributions.length ? cfg.attributions : ['© Geobasis NRW'],
      });
      doc.save(`Lageliste_${safeName(st.name)}_${fileStamp()}.pdf`);
    } catch (e) { console.error(e); toast(notice, 'PDF konnte nicht erstellt werden.', 'err'); } finally { pdfBtn.disabled = false; }
  });

  // ---------- Gespeicherte Ereignisse ----------
  const openBtn = h('button', { class: 'btn btn-plain btn-sm', type: 'button' }, 'Gespeicherte Ereignisse …');
  const evList = h('div', { class: 'glass pop ev-list', hidden: true, role: 'dialog', 'aria-label': 'Gespeicherte Ereignisse' });
  openBtn.addEventListener('click', async () => {
    if (!evList.hidden) { evList.hidden = true; return; }
    const r = await api('GET', '/events');
    evList.replaceChildren(h('div', { class: 'panel-head' }, 'Gespeicherte Ereignisse', h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Schließen', onClick: () => { evList.hidden = true; } }, svg(UI.close, { size: 15 }))),
      ...(r.items.length ? r.items.map((e) => h('div', { class: 'ev-row' },
        h('a', { href: `#/lage/${e.id}`, class: 'ev-link' }, h('strong', {}, e.name), h('span', { class: 'cap' }, `${new Date(e.occurredAt.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${e.label} · ${e.counts.inArea}/${e.counts.inBuffer} betroffen`)),
        me.role === 'admin' ? h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `${e.name} löschen`, onClick: async () => {
          if (!(await confirmDialog({ title: `„${e.name}“ löschen?`, message: 'Das gespeicherte Ereignis wird entfernt.', confirmLabel: 'Löschen', danger: true }))) return;
          await api('DELETE', `/events/${e.id}`); evList.hidden = true; toast(notice, 'Ereignis gelöscht.');
        } }, svg(UI.trash, { size: 15 })) : null)) : [h('div', { class: 'cap', style: { padding: '8px' } }, 'Noch keine Ereignisse gespeichert.')]));
    evList.hidden = false;
  });

  page.append(
    h('div', { class: 'sit-bar', role: 'status' },
      svg(UI.situation, { size: 18 }), h('span', { class: 'bar-title' }, 'LAGEMODUS'), h('span', { class: 'bar-sep' }), barName, barInfo,
      h('span', { style: { flex: '1' } }), summary,
      h('a', { class: 'btn bar-exit', href: '#/karte' }, 'Lagemodus beenden')),
    h('div', { class: 'sit-frame', 'aria-hidden': 'true' }),
    h('aside', { class: 'glass sit-aside', 'aria-label': 'Ereignis' },
      h('div', { class: 'sit-scroll' },
        h('div', {}, h('div', { class: 'range-head' }, h('label', { class: 'lbl', for: 'ev-name' }, 'Ereignis'), openBtn), nameIn),
        h('div', { class: 'sit-section' }, h('div', { class: 'sec' }, 'Ereignisgebiet festlegen'), seg, toolBox),
        h('div', { class: 'buf-box' },
          h('div', { class: 'toggle-row' }, h('div', {}, h('div', { class: 'buf-title' }, 'Pufferzone'), h('div', { class: 'cap' }, 'Zusätzlicher Rand um das Ereignisgebiet')), bufSw),
          bufBody),
        resultBox),
      h('div', { class: 'sit-foot' }, csvBtn, pdfBtn, saveBtn)),
    evList,
    h('div', { class: 'glass sit-legend' },
      h('div', { style: { 'font-weight': '700' } }, 'Darstellung'),
      h('div', { class: 'lg' }, h('span', { class: 'lg-area' }), 'Ereignisgebiet'),
      h('div', { class: 'lg' }, h('span', { class: 'lg-buf' }), 'Pufferzone'),
      h('div', { class: 'lg' }, h('span', { class: 'lg-hit' }), 'Betroffene Einrichtung'),
      h('div', { class: 'lg' }, h('span', { class: 'lg-dim' }), 'Nicht betroffen')),
    h('div', { class: 'glass ctl-group sit-zoom' },
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Vergrößern', onClick: () => map.zoomBy(1) }, svg(UI.plus, { stroke: 2.2 })),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Verkleinern', onClick: () => map.zoomBy(-1) }, svg(UI.minus, { stroke: 2.2 }))),
    notice);

  renderTool();
  paintResult();
  if (definition()) {
    run();
    setTimeout(() => { if (areaSrc.getFeatures().length) map.view.fit(areaSrc.getExtent(), { padding: [110, 300, 60, 440], maxZoom: 13, duration: 300 }); }, 900);
  }
  return () => map.destroy();
}

/** Kartenbild für das PDF auf den mittleren Bereich zuschneiden (ohne verdeckte Seitenränder). */
function cropForPdf(c) {
  const r = window.devicePixelRatio || 1;
  const x0 = Math.min(440 * r, c.width * 0.3);
  const x1 = Math.max(c.width - 280 * r, c.width * 0.7);
  const y0 = 68 * r;
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = c.height - y0;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
