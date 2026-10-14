import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js';
import { fromLonLat } from 'ol/proj.js';
import { api } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI, SYMBOLS } from '../ui/icons.js';
import { createMap } from '../map/mapView.js';
import { createFacilityLayer } from '../map/facilityLayer.js';
import { themeColors } from '../map/styles.js';
import { UTM } from '../map/projection.js';
import { startPolling, affected, countBySource, fmtTime, KIND, WBI_COLORS } from '../warnings.js';

export async function renderWarnlage(root, { navigate }) {
  const [cfg, cats, fac] = await Promise.all([api('GET', '/map/config'), api('GET', '/categories'), api('GET', '/facilities')]);
  const catById = new Map(cats.items.map((c) => [c.id, c]));
  const canvas = h('div', { class: 'map-canvas' });
  const page = h('div', { class: 'map-page warn-page' }, canvas);
  root.replaceChildren(page);
  const map = await createMap(canvas, cfg, { fitPadding: [24, 424, 24, 404] });
  map.setOverlay('warn', true);
  const facLayer = createFacilityLayer(map.map, {
    categories: cats.items, cluster: false,
    colors: () => { const cs = getComputedStyle(root); return { surface: cs.getPropertyValue('--surface').trim(), text: cs.getPropertyValue('--text').trim(), ...themeColors() }; },
    onSelect: (id) => navigate(`#/karte?sel=${id}`),
  });
  facLayer.setItems(fac.items);
  const wbiSrc = new VectorSource();
  map.map.addLayer(new VectorLayer({ source: wbiSrc, zIndex: 24, style: (f) => new Style({
    image: new CircleStyle({ radius: 9, fill: new Fill({ color: WBI_COLORS[f.get('today')] || WBI_COLORS[0] }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
    text: new Text({ text: String(f.get('today')), font: '700 10px system-ui, sans-serif', fill: new Fill({ color: '#111318' }) }),
  }) }));

  const state = { only: false, data: null, sel: null };
  const onlySw = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Nur betroffene anzeigen' });
  onlySw.addEventListener('click', () => { state.only = !state.only; onlySw.setAttribute('aria-checked', String(state.only)); paint(); });
  const hitCount = h('div', { class: 'sb-count' });
  const hitList = h('div', { class: 'sb-list hits' });
  const headTitle = h('div', { class: 'wl-title' }, 'Warnlage wird geladen …');
  const headSub = h('div', { class: 'cap' });
  const tiles = h('div', { class: 'wl-tiles' });
  const warnList = h('div', { class: 'wl-list' });
  const sourceBox = h('div', { class: 'wl-sources' });

  function paint() {
    const d = state.data;
    if (!d) return;
    const aff = affected(fac.items, d);
    const c = countBySource(d);
    facLayer.setWarned([...aff.keys()]);
    facLayer.setHighlight(state.only ? new Map([...aff.keys()].map((id, i) => [id, { zone: 'A', num: i + 1 }])) : null);
    map.setWarnings(state.sel ? d.warnings.filter((w) => w.id === state.sel) : d.warnings);
    wbiSrc.clear();
    for (const s of d.wbi?.stations || []) { const f = new Feature({ geometry: new Point(fromLonLat([s.lon, s.lat], UTM)), today: s.today, name: s.name }); wbiSrc.addFeature(f); }

    const affItems = fac.items.filter((f) => aff.has(f.id) && (!state.sel || aff.get(f.id).some((w) => w.id === state.sel)));
    hitCount.textContent = `${affItems.length} ${affItems.length === 1 ? 'Einrichtung' : 'Einrichtungen'} in aktiven Warngebieten`;
    hitList.replaceChildren(...(affItems.length ? affItems.map((f) => {
      const cat = catById.get(f.categoryId);
      const ws = aff.get(f.id);
      return h('a', { class: 'hit', href: `#/karte?sel=${f.id}` },
        h('span', { class: 'tile', style: { background: cat?.color || '#5B6472' } }, svg(SYMBOLS[cat?.symbol] || SYMBOLS.box, { size: 17 })),
        h('span', { class: 'hit-text' },
          h('span', { class: 'hit-name' }, f.name),
          h('span', { class: 'cap' }, [f.address.city, cat?.name].filter(Boolean).join(' · ')),
          h('span', { class: 'wl-warn' }, h('span', { class: 'wl-wdot' }), ws.map((w) => w.title).join(' · ')),
          (f.contact.person || f.contact.phone) ? h('span', { class: 'hit-tags' }, [f.contact.person, f.contact.phone].filter(Boolean).join(' · ')) : null));
    }) : [h('div', { class: 'no-hits' }, h('div', { style: { 'font-weight': '600' } }, 'Keine betroffenen Einrichtungen'), h('div', { class: 'cap' }, 'Kein Standort liegt in einem aktiven Warngebiet.'))]));

    headTitle.textContent = `${d.warnings.length} aktive ${d.warnings.length === 1 ? 'Warnung' : 'Warnungen'}`;
    headSub.textContent = `Aktualisiert ${fmtTime(d.checkedAt)} Uhr · alle ${Math.round((d.intervalS || 300) / 60)} Minuten`;
    tiles.replaceChildren(
      h('div', { class: 'wl-tile t-pop' }, h('div', { class: 'wl-n' }, String(c.mowas)), h('div', { class: 'cap' }, 'Bevölkerung')),
      h('div', { class: 'wl-tile t-wx' }, h('div', { class: 'wl-n' }, String(c.dwd)), h('div', { class: 'cap' }, 'Unwetter')),
      h('div', { class: 'wl-tile t-fire' }, h('div', { class: 'wl-n' }, d.wbi ? String(d.wbi.max) : '–', h('span', { class: 'wl-of' }, ' / 5')), h('div', { class: 'cap' }, 'Waldbrandindex')));
    warnList.replaceChildren(...(d.warnings.length ? d.warnings.map((w) => {
      const n = fac.items.filter((f) => aff.get(f.id)?.some((x) => x.id === w.id)).length;
      const b = h('button', { class: 'wl-item' + (state.sel === w.id ? ' on' : ''), type: 'button', 'aria-pressed': String(state.sel === w.id) },
        h('span', { class: 'wic ' + (w.source === 'dwd' ? 't-wx' : 't-pop') }, svg(w.source === 'dwd' ? UI.cloud : UI.megaphone, { size: 18 })),
        h('span', { class: 'wl-item-text' },
          h('span', { class: 'wl-kind' }, `${KIND[w.source] || w.source}${w.severity ? ` · ${{ Minor: 'Hinweis', Moderate: 'Warnung', Severe: 'Unwetter', Extreme: 'Extrem' }[w.severity] || w.severity}` : ''}`),
          h('span', { class: 'wl-wtitle' }, w.title),
          h('span', { class: 'cap' }, [w.start ? `ab ${new Date(w.start).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : null, w.end ? `bis ${new Date(w.end).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : null].filter(Boolean).join(' ')),
          h('span', { class: 'wl-aff' }, `${n} ${n === 1 ? 'Einrichtung' : 'Einrichtungen'} betroffen`)));
      b.addEventListener('click', () => { state.sel = state.sel === w.id ? null : w.id; paint(); });
      return b;
    }) : [h('div', { class: 'cap', style: { padding: '8px 2px' } }, 'Derzeit keine amtlichen Warnungen für NRW.')]),
    ...(d.wbi?.stations?.length ? [h('div', { class: 'wl-item static' },
      h('span', { class: 'wic t-fire' }, svg(UI.flame, { size: 18 })),
      h('span', { class: 'wl-item-text' }, h('span', { class: 'wl-kind' }, 'Waldbrandgefahrenindex (DWD)'),
        h('span', { class: 'wl-wtitle' }, `Höchste Stufe heute: ${d.wbi.max} von 5`),
        h('span', { class: 'cap' }, `${d.wbi.stations.length} Stationen in NRW · Punkte auf der Karte`)))] : []));
    sourceBox.replaceChildren(h('div', { class: 'sec' }, 'Dienststatus'), ...d.sources.map(sourceRow));
  }

  const stop = startPolling((d, err) => {
    if (!d) { headTitle.textContent = 'Warnlage nicht verfügbar'; headSub.textContent = err?.message || ''; return; }
    state.data = d;
    paint();
  }, cfg.warningsIntervalS || 300);

  page.append(
    h('aside', { class: 'glass sidebar', 'aria-label': 'Betroffene Einrichtungen' },
      h('div', { class: 'sb-head' },
        h('a', { class: 'sb-logo', href: '#/karte', 'aria-label': 'Zur Hauptansicht' }, svg(UI.back, { size: 20, stroke: 2.4 })),
        h('div', { style: { flex: '1', 'min-width': '0' } }, h('div', { class: 'sb-title' }, 'Live-Warnlage'), h('div', { class: 'cap' }, 'Nordrhein-Westfalen'))),
      h('div', { class: 'wl-only' }, h('div', { style: { flex: '1' } }, h('div', { class: 'opt-t' }, 'Nur betroffene hervorheben'), h('div', { class: 'cap' }, 'Einrichtungen in aktiven Warngebieten')), onlySw),
      hitCount, hitList),
    h('aside', { class: 'glass wl-panel', 'aria-label': 'Aktive Warnungen' },
      h('div', { class: 'wl-head' }, h('span', { class: 'warn-dot active' }), h('div', { style: { flex: '1' } }, headTitle, headSub),
        h('a', { class: 'btn btn-icon sheet-close', href: '#/karte', 'aria-label': 'Warnlage schließen' }, svg(UI.close, { size: 15, stroke: 2.4 }))),
      tiles,
      h('div', { class: 'wl-scroll' }, warnList, sourceBox,
        h('div', { class: 'cap wl-note' }, 'Quellen: amtliche Warnmeldungen (MoWaS, DWD) und Waldbrandgefahrenindex (DWD, CC BY 4.0). Warngebiete werden mit dem Bestand verschnitten; die Einstufung „gefährdet bei“ bleibt unverändert.'))),
    h('div', { class: 'ctl attribution', style: { right: '424px' } }, [...(cfg.attributions || []), 'Warnungen: BBK, DWD'].join(' · ')));
  return () => { stop(); map.destroy(); };
}

/** Statuszeile je Dienst – mit Fehlertext, damit Ursachen (Proxy, DNS, HTTP-Status) erkennbar sind. */
function sourceRow(s) {
  const extra = [];
  if (s.pending) extra.push(`${s.pending} Warngebiete werden nachgeladen`);
  if (s.failed) extra.push(`${s.failed} nicht ladbar`);
  const text = s.status === 'ok' ? `OK · ${fmtTime(s.fetchedAt)}${s.count ? ` · ${s.count} in NRW` : ''}`
    : s.status === 'pending' ? 'wird abgerufen …'
      : s.stale ? `gestört – Stand ${fmtTime(s.fetchedAt)}` : 'nicht erreichbar';
  const dot = s.status === 'ok' ? 'ok' : s.status === 'pending' ? 'wait' : 'err';
  return h('div', { class: 'wl-src-wrap' },
    h('div', { class: 'wl-src' },
      h('span', { class: 'wl-sdot ' + dot }),
      h('span', { style: { flex: '1' } }, s.label),
      h('span', { class: 'cap' }, text)),
    extra.length ? h('div', { class: 'cap wl-src-note' }, extra.join(' · ')) : null,
    s.status === 'error' && s.error ? h('div', { class: 'cap wl-src-note err' }, `Ursache: ${s.error}`) : null);
}
