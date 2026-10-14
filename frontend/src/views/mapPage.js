import { api, DEMO } from '../api.js';
import { h, svg, initials } from '../ui/dom.js';
import { UI, SYMBOLS } from '../ui/icons.js';
import { toast, confirmDialog } from '../ui/dialog.js';
import { isDark, toggleTheme, onThemeChange } from '../ui/theme.js';
import { createMap, OVERLAYS } from '../map/mapView.js';
import { createFacilityLayer } from '../map/facilityLayer.js';
import { applyFilters, isFiltered, formatAddress, formatCoord } from '../facilities.js';
import { themeColors } from '../map/styles.js';
import { startPolling, affected, countBySource, fmtTime } from '../warnings.js';

const chevron = () => svg(UI.down, { size: 14, stroke: 2.4 });

/** Gemeinsamer Filterzustand (wird in Arbeitspaket 4 für die Trefferliste genutzt). */
export const filters = { q: '', categories: null, scenario: '', regbez: '', kreis: '', plzPrefix: '' };

export async function renderMapPage(root, { me, onLogout, selectId = null, navigate }) {
  const [cfg, cats, scens, rbs, fac] = await Promise.all([
    api('GET', '/map/config'),
    api('GET', '/categories'),
    api('GET', '/scenarios'),
    api('GET', '/boundaries/regbez').catch(() => ({ features: [] })),
    api('GET', '/facilities'),
  ]);
  const all = fac.items;
  const catById = new Map(cats.items.map((c) => [c.id, c]));
  const scenById = new Map(scens.items.map((x) => [x.id, x]));
  const categories = cats.items.filter((c) => c.active);
  const scenarios = scens.items.filter((s) => s.active);
  const regbez = rbs.features.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const isAdmin = me.role === 'admin';
  filters.categories ??= new Set(categories.map((c) => c.id));

  const canvas = h('div', { class: 'map-canvas', role: 'region', 'aria-label': 'Karte' });
  const notice = h('div', { class: 'notice-float' });
  const page = h('div', { class: 'map-page' }, canvas, notice);
  root.replaceChildren(page);

  const map = await createMap(canvas, cfg);

  // ---------- Seitenleiste ----------
  const search = h('input', { id: 'q', class: 'input', type: 'search', placeholder: 'Name, Ort oder PLZ', value: filters.q, autocomplete: 'off' });
  search.addEventListener('input', () => { filters.q = search.value; refresh(); });

  const chips = categories.map((c) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filters.categories.has(c.id)), title: c.name },
      h('span', { class: 'dot', style: { background: c.color } }), shortName(c.name));
    b.addEventListener('click', () => {
      filters.categories.has(c.id) ? filters.categories.delete(c.id) : filters.categories.add(c.id);
      b.setAttribute('aria-pressed', String(filters.categories.has(c.id)));
      refresh();
    });
    return b;
  });

  const select = (id, label, options, value, onChange, cls) => {
    const s = h('select', { id, class: 'input' }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    s.addEventListener('change', () => onChange(s.value));
    return h('div', { class: cls }, h('label', { class: 'lbl', for: id }, label), h('div', { class: 'selw' }, s, chevron()));
  };

  let kreise = [];
  const kreisWrap = h('div', { class: 'full' });
  const renderKreis = () => kreisWrap.replaceChildren(select('f-kr', 'Kreis / kreisfreie Stadt',
    [['', 'Alle Kreise und kreisfreien Städte'], ...kreise.filter((k) => !filters.regbez || k.regbez === filters.regbez).map((k) => [k.code, k.name])],
    filters.kreis, (v) => { filters.kreis = v; refresh(); if (v) map.zoomToBoundary('kreis', v); }));
  const plz = h('input', { id: 'f-plz', class: 'input', inputmode: 'numeric', maxlength: 5, placeholder: 'z. B. 41', value: filters.plzPrefix, pattern: '[0-9]{1,5}' });
  plz.addEventListener('input', () => { plz.value = plz.value.replace(/\D/g, '').slice(0, 5); filters.plzPrefix = plz.value; refresh(); });
  const more = h('div', { class: 'grid2 pop', hidden: true }, kreisWrap,
    h('div', { class: 'full' }, h('label', { class: 'lbl', for: 'f-plz' }, 'PLZ-Bereich (Anfang der PLZ)'), plz));
  const moreBtn = h('button', { class: 'btn btn-plain more-btn', type: 'button', 'aria-expanded': 'false' }, svg(UI.right, { size: 14, stroke: 2.4 }), 'Weitere Filter: Kreis, PLZ-Bereich');
  moreBtn.addEventListener('click', async () => {
    more.hidden = !more.hidden;
    moreBtn.setAttribute('aria-expanded', String(!more.hidden));
    if (!more.hidden && !kreise.length) {
      kreise = (await api('GET', '/boundaries/kreis')).features.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      renderKreis();
    }
  });
  renderKreis();

  const countLabel = h('span');
  const resetBtn = h('button', { class: 'btn btn-plain btn-sm', type: 'button', hidden: true }, 'Filter zurücksetzen');
  resetBtn.addEventListener('click', () => {
    Object.assign(filters, { q: '', scenario: '', regbez: '', kreis: '', plzPrefix: '', categories: new Set(categories.map((c) => c.id)) });
    navigate('#/karte');
  });
  const list = h('div', { class: 'sb-list hits', role: 'list' });

  const sidebar = h('aside', { class: 'glass sidebar', 'aria-label': 'Suche und Filter' },
    h('div', { class: 'sb-head' },
      h('div', { class: 'sb-logo' }, svg(UI.pin, { size: 20 })),
      h('div', { style: { flex: '1', 'min-width': '0' } }, h('div', { class: 'sb-title' }, 'KRITIS-Lagekarte'), h('div', { class: 'cap' }, 'Nordrhein-Westfalen')),
      isAdmin ? h('button', { class: 'btn btn-primary sb-add', type: 'button', 'data-write': true, 'aria-label': 'Einrichtung anlegen', title: 'Einrichtung anlegen', onClick: () => navigate('#/einrichtung/neu') }, svg(UI.plus, { stroke: 2.4 })) : null),
    h('div', { class: 'sb-filters' },
      h('div', { class: 'search' }, h('label', { class: 'sr-only', for: 'q' }, 'Suche'), svg(UI.search, { size: 16, stroke: 2.2 }), search),
      h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '8px' } }, 'Kategorie'), h('div', { class: 'chips' }, chips)),
      h('div', { class: 'grid2' },
        select('f-sz', 'Szenario', [['', 'Alle Szenarien'], ...scenarios.map((s) => [String(s.id), s.name])], filters.scenario, (v) => { filters.scenario = v; refresh(); }),
        select('f-rb', 'Regierungsbezirk', [['', 'Alle'], ...regbez.map((r) => [r.code, r.name])], filters.regbez, (v) => {
          filters.regbez = v; filters.kreis = '';
          if (kreise.length) renderKreis();
          refresh();
          v ? map.zoomToBoundary('regbez', v) : map.fitNrw(300);
        })),
      moreBtn, more),
    h('div', { class: 'sb-count' }, countLabel, resetBtn),
    list);

  // ---------- Leerzustand ----------
  const [c1, c2, c3] = [categories[0], categories[1], categories[3] ?? categories[2]];
  const icon = (c, cls) => c ? h('span', { class: cls, style: { background: c.color } }, svg(SYMBOLS[c.symbol] || SYMBOLS.box, { size: 22 })) : null;
  const empty = h('div', { class: 'empty-wrap' }, h('div', { class: 'glass rise empty-card' },
    h('div', { class: 'empty-icons float', 'aria-hidden': 'true' }, icon(c1, 'a'), icon(c2, 'b'), icon(c3, 'c')),
    h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '8px' } },
      h('h1', {}, 'Noch keine Einrichtungen'),
      h('p', {}, isAdmin
        ? 'Legen Sie die erste Einrichtung an. Sie erscheint sofort auf der Karte und in der Trefferliste – und ist im Lagemodus auswertbar.'
        : 'Sobald die Administration Einrichtungen anlegt, erscheinen sie hier auf der Karte.')),
    isAdmin ? h('div', { style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '8px', width: '100%' } },
      h('button', { class: 'btn btn-primary btn-hero', type: 'button', 'data-write': true, onClick: () => navigate('#/einrichtung/neu') }, svg(UI.plus, { stroke: 2.4 }), 'Erste Einrichtung anlegen'),
      DEMO ? h('button', { class: 'btn btn-secondary', type: 'button', onClick: loadSamples }, 'Beispieldaten laden (Demo)') : null,
      h('a', { class: 'btn btn-plain', href: '#/admin/kategorien', style: { 'font-weight': '500', 'font-size': '13px' } }, 'Kategorien und Szenarien vorher anpassen')) : null,
    cfg.boundaries.length === 0 ? h('div', { class: 'cap' }, 'Hinweis: Es sind noch keine Verwaltungsgrenzen importiert (siehe README, „Grenzdaten importieren“).') : null));

  // ---------- Werkzeugleiste oben rechts ----------
  const themeBtn = h('button', { class: 'btn btn-icon', type: 'button' });
  const paintTheme = () => {
    const label = isDark() ? 'Hellen Modus verwenden' : 'Dunkelmodus verwenden';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
    themeBtn.replaceChildren(svg(isDark() ? UI.sun : UI.moon));
  };
  paintTheme();
  themeBtn.addEventListener('click', toggleTheme);
  const offTheme = onThemeChange(() => { paintTheme(); map.restyle(); facLayer.restyle(); });

  const menu = h('div', { class: 'glass pop ctl user-menu', role: 'menu', hidden: true },
    h('div', { style: { padding: '8px 12px 10px' } }, h('div', { style: { 'font-weight': '600' } }, me.displayName || me.username), h('div', { class: 'cap' }, isAdmin ? 'Administration' : 'Lesezugriff')),
    h('div', { class: 'menu-sep' }),
    isAdmin ? h('a', { class: 'menu-item', href: '#/admin/benutzer', role: 'menuitem' }, svg(UI.userAdmin, { size: 17 }), 'Administration') : null,
    h('a', { class: 'menu-item', href: '#/passwort', role: 'menuitem' }, svg(UI.key, { size: 17 }), 'Passwort ändern'),
    h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: async () => { await api('POST', '/auth/logout').catch(() => {}); onLogout(); } }, svg(UI.logout, { size: 17 }), 'Abmelden'));
  const avatar = h('button', { class: 'avatar-btn', type: 'button', 'aria-label': 'Benutzermenü', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, initials(me.displayName || me.username));
  const toggleMenu = (open = menu.hidden) => { menu.hidden = !open; avatar.setAttribute('aria-expanded', String(open)); };
  avatar.addEventListener('click', () => toggleMenu());

  const warnPill = h('a', { class: 'glass warn-pill', href: '#/warnlage', 'aria-label': 'Live-Warnlage öffnen' }, h('span', { class: 'warn-dot idle' }), h('span', { class: 'warn-text' }, 'Warnlage wird geladen …'));
  const toolbar = h('div', { class: 'ctl toolbar' }, warnPill,
    h('div', { class: 'glass tool-group' },
      h('button', { class: 'btn btn-event', type: 'button', onClick: () => navigate('#/lage') }, svg(UI.situation, { size: 16, stroke: 2.2 }), 'Lagemodus'),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Drucken', title: 'Drucken', onClick: () => navigate('#/druck') }, svg(UI.print)),
      themeBtn, avatar));

  // ---------- Zoom / Ebenen ----------
  const layerBtn = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Ebenen', title: 'Ebenen', 'aria-expanded': 'false' }, svg(UI.layers));
  const zoomCtl = h('div', { class: 'ctl zoom-ctl' },
    h('div', { class: 'glass ctl-group' },
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Vergrößern', title: 'Vergrößern', onClick: () => map.zoomBy(1) }, svg(UI.plus, { stroke: 2.2 })),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Verkleinern', title: 'Verkleinern', onClick: () => map.zoomBy(-1) }, svg(UI.minus, { stroke: 2.2 }))),
    h('div', { class: 'glass ctl-group' }, layerBtn, h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Ganz NRW anzeigen', title: 'Ganz NRW anzeigen', onClick: () => map.fitNrw(300) }, svg(UI.fit))));

  const state = { basemap: cfg.basemaps.find((b) => b.id === cfg.defaultBasemap && b.available) ? cfg.defaultBasemap : 'politisch', overlays: Object.fromEntries(OVERLAYS.map((o) => [o.id, o.on])) };
  const segBtns = cfg.basemaps.map((b) => {
    const btn = h('button', { type: 'button', 'aria-pressed': String(state.basemap === b.id), disabled: !b.available, title: b.available ? b.label : `${b.label}: keine Kartenquelle eingerichtet (offline nicht verfügbar)` }, b.label);
    btn.addEventListener('click', () => {
      state.basemap = b.id;
      segBtns.forEach((x, i) => x.setAttribute('aria-pressed', String(cfg.basemaps[i].id === b.id)));
      map.setBasemap(b.id);
    });
    return btn;
  });
  const imported = new Set(cfg.boundaries.map((b) => b.level));
  let warnSub = null;
  const legendFlood = h('div', { class: 'legend-row', hidden: true }, h('span', { class: 'legend-hatch' }), h('span', {}, 'Hochwassergefahrenfläche'));
  const legendWarn = h('div', { class: 'legend-row' }, h('span', { class: 'legend-warn' }), h('span', {}, 'Amtliches Warngebiet'));
  const layerRows = OVERLAYS.map((o) => {
    const has = o.service ? (o.id === 'flood' ? Boolean(cfg.overlays?.flood) : true) : imported.has(o.id);
    const sw = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(state.overlays[o.id] && has), 'aria-label': o.label, disabled: !has });
    sw.addEventListener('click', () => {
      state.overlays[o.id] = !state.overlays[o.id];
      sw.setAttribute('aria-checked', String(state.overlays[o.id]));
      map.setOverlay(o.id, state.overlays[o.id]);
    });
    map.setOverlay(o.id, state.overlays[o.id] && has);
    const sub = h('div', { class: 'cap' }, has ? o.sub : o.service ? 'Dienst nicht eingerichtet' : 'Noch nicht importiert');
    if (o.id === 'warn') warnSub = sub;
    sw.addEventListener('click', () => { legendFlood.hidden = !state.overlays.flood; legendWarn.hidden = !state.overlays.warn; });
    return h('div', { class: 'layer-row' }, h('div', { style: { flex: '1', 'min-width': '0' } }, h('div', { class: 't' }, o.label), sub), sw);
  });
  const panel = h('div', { class: 'glass layer-panel pop', role: 'dialog', 'aria-label': 'Ebenen', hidden: true },
    h('div', { class: 'panel-head' }, 'Ebenen', h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Schließen', style: { width: '32px', height: '32px' }, onClick: () => togglePanel(false) }, svg(UI.close, { size: 16, stroke: 2.2 }))),
    h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '8px' } }, 'Hintergrund'), h('div', { class: 'seg' }, segBtns)),
    h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '4px' } }, 'Zuschaltbare Ebenen'), layerRows));
  const togglePanel = (open = panel.hidden) => { panel.hidden = !open; layerBtn.setAttribute('aria-expanded', String(open)); };
  layerBtn.addEventListener('click', () => togglePanel());
  map.setBasemap(state.basemap);

  // ---------- Legende & Quellen ----------
  const legendCounts = {};
  const legendBody = h('div', { class: 'legend-body' },
    categories.map((c) => h('div', { class: 'legend-row' }, h('span', { class: 'dot', style: { background: c.color } }), h('span', { style: { flex: '1' } }, c.name), legendCounts[c.id] = h('span', { class: 'cap n' }, '0'))),
    h('div', { class: 'legend-row' }, h('span', { class: 'legend-bundle', style: { background: `conic-gradient(${bundleGradient(categories)})` } }, h('span')), h('span', {}, 'Bündel mit Anzahl')),
    h('div', { class: 'legend-row' }, h('span', { class: 'legend-line' }), h('span', {}, 'Grenze Regierungsbezirk')),
    legendFlood, legendWarn);
  const legendBtn = h('button', { class: 'legend-toggle', type: 'button', 'aria-expanded': 'true' }, 'Legende', svg(UI.up, { size: 14, stroke: 2.4 }));
  legendBtn.addEventListener('click', () => { legendBody.hidden = !legendBody.hidden; legendBtn.setAttribute('aria-expanded', String(!legendBody.hidden)); });
  const legend = h('div', { class: 'glass ctl legend' }, legendBtn, legendBody);
  const attribution = h('div', { class: 'ctl attribution' }, (cfg.attributions.length ? cfg.attributions : ['© Geobasis NRW']).join(' · '));

  // ---------- Einrichtungen auf der Karte ----------
  const sheet = h('aside', { class: 'glass sheet', 'aria-label': 'Details zur Einrichtung', hidden: true });
  const facLayer = createFacilityLayer(map.map, {
    categories: cats.items,
    colors: () => { const c = themeColors(); const cs = getComputedStyle(root); return { surface: cs.getPropertyValue('--surface').trim(), text: cs.getPropertyValue('--text').trim(), ...c }; },
    onSelect: (id) => selectFacility(id, false),
  });
  let shown = [];
  let selected = null;

  function hitRow(it) {
    const c = catById.get(it.categoryId);
    const tags = it.hazards.map((h) => scenById.get(h)?.name).filter(Boolean);
    const b = h('button', { class: 'hit' + (selected === it.id ? ' on' : ''), type: 'button', role: 'listitem', onClick: () => selectFacility(it.id, true) },
      h('span', { class: 'tile', style: { background: c?.color || '#5B6472' } }, svg(SYMBOLS[c?.symbol] || SYMBOLS.box, { size: 17 })),
      h('span', { class: 'hit-text' },
        h('span', { class: 'hit-name' }, it.name),
        h('span', { class: 'cap' }, [it.address.city, c?.name].filter(Boolean).join(' · ')),
        tags.length ? h('span', { class: 'hit-tags' }, tags.join(' · ')) : null));
    b.dataset.id = it.id;
    return b;
  }

  function refresh() {
    shown = applyFilters(all, filters);
    facLayer.setItems(shown);
    countLabel.textContent = `${shown.length} ${shown.length === 1 ? 'Einrichtung' : 'Einrichtungen'}${shown.length !== all.length ? ` von ${all.length}` : ''}`;
    resetBtn.hidden = !isFiltered(filters, categories.map((c) => c.id));
    if (all.length === 0) {
      list.replaceChildren(h('div', { class: 'ghost-row' }), h('div', { class: 'ghost-row', style: { opacity: '.7' } }), h('div', { class: 'ghost-row', style: { opacity: '.4' } }));
    } else if (shown.length === 0) {
      list.replaceChildren(h('div', { class: 'no-hits' }, h('div', { style: { 'font-weight': '600' } }, 'Keine Treffer'), h('div', { class: 'cap' }, 'Passen Sie Suche oder Filter an.')));
    } else {
      list.replaceChildren(...shown.slice(0, 500).map(hitRow), ...(shown.length > 500 ? [h('div', { class: 'cap', style: { padding: '8px' } }, `… und ${shown.length - 500} weitere – bitte Filter verfeinern.`)] : []));
    }
    for (const c of categories) if (legendCounts[c.id]) legendCounts[c.id].textContent = String(shown.filter((x) => x.categoryId === c.id).length);
    empty.hidden = all.length > 0;
    if (selected && !shown.some((x) => x.id === selected)) closeSheet();
  }

  async function selectFacility(id, center) {
    const it = all.find((x) => x.id === id);
    if (!it) return;
    selected = id;
    facLayer.select(id);
    list.querySelectorAll('.hit').forEach((el) => el.classList.toggle('on', Number(el.dataset.id) === id));
    list.querySelector(`.hit[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    if (center) facLayer.centerOn(it);
    renderSheet(it);
    page.classList.add('has-sheet');
  }

  function closeSheet() {
    selected = null;
    facLayer.select(null);
    sheet.hidden = true;
    page.classList.remove('has-sheet');
    list.querySelectorAll('.hit.on').forEach((el) => el.classList.remove('on'));
  }

  async function renderSheet(it) {
    const c = catById.get(it.categoryId);
    const kv = h('dl', { class: 'kv' });
    const row = (k, v) => kv.append(h('dt', {}, k), h('dd', {}, v || '–'));
    const fillKv = (names = {}) => {
      kv.replaceChildren();
      row('Regierungsbezirk', names.regbez);
      row('Kreis / Stadt', names.kreis);
      row('Gemeinde', names.gemeinde);
      row('PLZ-Gebiet', it.admin.plz5);
      row('Koordinaten', formatCoord(it.location.lat, it.location.lon));
    };
    fillKv();
    api('GET', `/geo/resolve?lon=${it.location.lon}&lat=${it.location.lat}`).then((r) => { if (selected === it.id) fillKv(r.names); }).catch(() => {});
    const ct = it.contact;
    const tags = it.hazards.map((x) => scenById.get(x)).filter(Boolean);
    sheet.replaceChildren(
      h('div', { class: 'sheet-head' },
        h('span', { class: 'sheet-cat' }, h('span', { class: 'dot', style: { background: c?.color } }), c?.name || ''),
        h('button', { class: 'btn btn-icon sheet-close', type: 'button', 'aria-label': 'Detailansicht schließen', onClick: closeSheet }, svg(UI.close, { size: 15, stroke: 2.4 }))),
      h('div', { class: 'sheet-body' },
        h('div', { class: 'sheet-title' }, h('h2', {}, it.name), h('div', { class: 'sheet-addr' }, formatAddress(it.address))),
        h('section', {}, h('div', { class: 'sec' }, 'Gefährdet bei'),
          tags.length ? h('div', { class: 'chips' }, tags.map((t) => h('span', { class: 'tag tag-event' }, t.name))) : h('div', { class: 'cap' }, 'Keine Szenarien zugeordnet')),
        (ct.person || ct.phone || ct.email) ? h('section', {}, h('div', { class: 'sec' }, 'Kontakt'),
          ct.person ? h('div', {}, h('div', { class: 'ct-name' }, ct.person), ct.function ? h('div', { class: 'cap' }, ct.function) : null) : null,
          ct.phone ? h('a', { class: 'link', href: 'tel:' + ct.phone.replace(/[^0-9+]/g, '') }, svg(UI.phone, { size: 16 }), ct.phone) : null,
          ct.email ? h('a', { class: 'link', href: 'mailto:' + ct.email }, svg(UI.mail, { size: 16 }), ct.email) : null) : null,
        it.note ? h('section', {}, h('div', { class: 'sec' }, 'Bemerkung'), h('div', { class: 'note' }, it.note)) : null,
        h('section', {}, h('div', { class: 'sec-row' }, h('div', { class: 'sec' }, 'Lage'), h('div', { class: 'cap' }, 'automatisch ermittelt')), kv),
        h('div', { class: 'cap' }, `Zuletzt geändert: ${it.updatedAt ? new Date(it.updatedAt.replace(' ', 'T') + 'Z').toLocaleString('de-DE') : '–'}${it.updatedBy ? ' · ' + it.updatedBy : ''}`)),
      isAdmin ? h('div', { class: 'sheet-foot', 'data-write': true },
        h('button', { class: 'btn btn-secondary', type: 'button', style: { color: 'var(--danger)' }, onClick: () => removeFacility(it) }, 'Löschen'),
        h('span', { style: { flex: '1' } }),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => navigate(`#/einrichtung/${it.id}`) }, 'Bearbeiten')) : null);
    sheet.hidden = false;
  }

  async function removeFacility(it) {
    if (!(await confirmDialog({ title: `„${it.name}“ löschen?`, message: 'Die Einrichtung wird endgültig entfernt und erscheint nicht mehr auf Karte, Liste und Ausdruck.', confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api('DELETE', `/facilities/${it.id}`);
      all.splice(all.indexOf(it), 1);
      closeSheet();
      refresh();
      toast(notice, `„${it.name}“ wurde gelöscht.`);
    } catch (e) { toast(notice, e.message, 'err'); }
  }

  async function loadSamples() {
    const { loadSampleData } = await import('../demo/server.js');
    await loadSampleData();
    navigate('#/karte');
  }

  let warnedIds = [];
  const stopWarnings = startPolling((d, err) => {
    if (!d) {
      warnPill.replaceChildren(h('span', { class: 'warn-dot down' }), h('span', { class: 'warn-text' }, 'Warnlage nicht verfügbar'));
      return;
    }
    const c = countBySource(d);
    const total = d.warnings.length;
    const down = d.sources.filter((x) => x.status !== 'ok');
    map.setWarnings(d.warnings);
    const aff = affected(all, d);
    warnedIds = [...aff.keys()];
    facLayer.setWarned(warnedIds);
    const wbi = d.wbi?.max;
    const allDown = down.length === d.sources.length;
    const tags = allDown ? [] : [
      h('span', { class: 'tag t-pop', title: 'Bevölkerungswarnungen (MoWaS)' }, svg(UI.megaphone, { size: 12, stroke: 2.4 }), String(c.mowas)),
      h('span', { class: 'tag t-wx', title: 'Unwetterwarnungen (DWD)' }, svg(UI.cloud, { size: 12, stroke: 2.4 }), String(c.dwd)),
      ...(wbi ? [h('span', { class: 'tag t-fire', title: 'Waldbrandgefahrenindex, höchste Stufe in NRW' }, svg(UI.flame, { size: 12, stroke: 2.4 }), `WBI ${wbi}`)] : []),
    ];
    warnPill.replaceChildren(
      h('span', { class: 'warn-dot ' + (allDown ? 'down' : total ? 'active' : 'idle') }),
      h('span', { class: 'warn-text' }, allDown ? 'Warndienste nicht erreichbar' : `${total} aktive ${total === 1 ? 'Warnung' : 'Warnungen'}`),
      ...(tags.length ? [h('span', { class: 'warn-tags' }, tags)] : []),
      ...(down.length && !allDown ? [h('span', { class: 'warn-degraded', title: down.map((x) => `${x.label}: ${x.error || 'nicht erreichbar'}`).join('\n') }, '!')] : []));
    if (warnSub) warnSub.textContent = `${total} aktiv · aktualisiert ${fmtTime(d.checkedAt)} Uhr${down.length ? ` · ${down.length} Dienst(e) gestört` : ''}`;
  }, cfg.warningsIntervalS || 300);

  page.append(sidebar, empty, toolbar, menu, zoomCtl, panel, legend, attribution, sheet);
  refresh();
  if (selectId) selectFacility(selectId, true);

  const onKey = (e) => { if (e.key === 'Escape') { togglePanel(false); toggleMenu(false); if (panel.hidden && menu.hidden) closeSheet(); } };
  const onDoc = (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== avatar) toggleMenu(false); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onDoc);

  return () => {
    stopWarnings();
    offTheme();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onDoc);
    map.destroy();
  };
}

function shortName(name) {
  return { 'Universitätskliniken': 'Unikliniken', 'Außeruniversitäre Forschungseinrichtungen': 'Forschung', 'Archive (inkl. Landesarchiv)': 'Archive' }[name] || name;
}

function bundleGradient(cats) {
  const list = cats.slice(0, 3);
  if (!list.length) return 'var(--fill-2) 0 360deg';
  const step = 360 / list.length;
  return list.map((c, i) => `${c.color} ${i * step}deg ${(i + 1) * step}deg`).join(', ');
}
