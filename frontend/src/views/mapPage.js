import { api } from '../api.js';
import { h, svg, initials } from '../ui/dom.js';
import { UI, SYMBOLS } from '../ui/icons.js';
import { toast } from '../ui/dialog.js';
import { isDark, toggleTheme, onThemeChange } from '../ui/theme.js';
import { createMap, OVERLAYS } from '../map/mapView.js';

const chevron = () => svg(UI.down, { size: 14, stroke: 2.4 });

/** Gemeinsamer Filterzustand (wird in Arbeitspaket 4 für die Trefferliste genutzt). */
export const filters = { q: '', categories: null, scenario: '', regbez: '', kreis: '', plzPrefix: '' };

export async function renderMapPage(root, { me, onLogout }) {
  const [cfg, cats, scens, rbs] = await Promise.all([
    api('GET', '/map/config'),
    api('GET', '/categories'),
    api('GET', '/scenarios'),
    api('GET', '/boundaries/regbez').catch(() => ({ features: [] })),
  ]);
  const categories = cats.items.filter((c) => c.active);
  const scenarios = scens.items.filter((s) => s.active);
  const regbez = rbs.features.map((f) => f.properties).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const isAdmin = me.role === 'admin';
  filters.categories ??= new Set(categories.map((c) => c.id));

  const canvas = h('div', { class: 'map-canvas', role: 'region', 'aria-label': 'Karte' });
  const notice = h('div', { class: 'notice-float' });
  const page = h('div', { class: 'map-page' }, canvas, notice);
  root.replaceChildren(page);

  const later = (what) => () => toast(notice, `${what} folgt in einem der nächsten Arbeitspakete.`);
  const map = await createMap(canvas, cfg);

  // ---------- Seitenleiste ----------
  const search = h('input', { id: 'q', class: 'input', type: 'search', placeholder: 'Name, Ort oder PLZ', value: filters.q, autocomplete: 'off' });
  search.addEventListener('input', () => { filters.q = search.value; });

  const chips = categories.map((c) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filters.categories.has(c.id)), title: c.name },
      h('span', { class: 'dot', style: { background: c.color } }), shortName(c.name));
    b.addEventListener('click', () => {
      filters.categories.has(c.id) ? filters.categories.delete(c.id) : filters.categories.add(c.id);
      b.setAttribute('aria-pressed', String(filters.categories.has(c.id)));
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
    filters.kreis, (v) => { filters.kreis = v; if (v) map.zoomToBoundary('kreis', v); }));
  const plz = h('input', { id: 'f-plz', class: 'input', inputmode: 'numeric', maxlength: 5, placeholder: 'z. B. 41', value: filters.plzPrefix, pattern: '[0-9]{1,5}' });
  plz.addEventListener('input', () => { plz.value = plz.value.replace(/\D/g, '').slice(0, 5); filters.plzPrefix = plz.value; });
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

  const sidebar = h('aside', { class: 'glass sidebar', 'aria-label': 'Suche und Filter' },
    h('div', { class: 'sb-head' },
      h('div', { class: 'sb-logo' }, svg(UI.pin, { size: 20 })),
      h('div', { style: { flex: '1', 'min-width': '0' } }, h('div', { class: 'sb-title' }, 'KRITIS-Lagekarte'), h('div', { class: 'cap' }, 'Nordrhein-Westfalen')),
      isAdmin ? h('button', { class: 'btn btn-primary sb-add', type: 'button', 'aria-label': 'Einrichtung anlegen', title: 'Einrichtung anlegen', onClick: later('Das Anlegen von Einrichtungen') }, svg(UI.plus, { stroke: 2.4 })) : null),
    h('div', { class: 'sb-filters' },
      h('div', { class: 'search' }, h('label', { class: 'sr-only', for: 'q' }, 'Suche'), svg(UI.search, { size: 16, stroke: 2.2 }), search),
      h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '8px' } }, 'Kategorie'), h('div', { class: 'chips' }, chips)),
      h('div', { class: 'grid2' },
        select('f-sz', 'Szenario', [['', 'Alle Szenarien'], ...scenarios.map((s) => [String(s.id), s.name])], filters.scenario, (v) => { filters.scenario = v; }),
        select('f-rb', 'Regierungsbezirk', [['', 'Alle'], ...regbez.map((r) => [r.code, r.name])], filters.regbez, (v) => {
          filters.regbez = v; filters.kreis = '';
          if (kreise.length) renderKreis();
          v ? map.zoomToBoundary('regbez', v) : map.fitNrw(300);
        })),
      moreBtn, more),
    h('div', { class: 'sb-count' }, '0 Einrichtungen'),
    h('div', { class: 'sb-list', 'aria-hidden': 'true' }, h('div', { class: 'ghost-row' }), h('div', { class: 'ghost-row', style: { opacity: '.7' } }), h('div', { class: 'ghost-row', style: { opacity: '.4' } })));

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
      h('button', { class: 'btn btn-primary btn-hero', type: 'button', onClick: later('Das Anlegen von Einrichtungen') }, svg(UI.plus, { stroke: 2.4 }), 'Erste Einrichtung anlegen'),
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
  const offTheme = onThemeChange(() => { paintTheme(); map.restyle(); });

  const menu = h('div', { class: 'glass pop ctl user-menu', role: 'menu', hidden: true },
    h('div', { style: { padding: '8px 12px 10px' } }, h('div', { style: { 'font-weight': '600' } }, me.displayName || me.username), h('div', { class: 'cap' }, isAdmin ? 'Administration' : 'Lesezugriff')),
    h('div', { class: 'menu-sep' }),
    isAdmin ? h('a', { class: 'menu-item', href: '#/admin/benutzer', role: 'menuitem' }, svg(UI.userAdmin, { size: 17 }), 'Administration') : null,
    h('a', { class: 'menu-item', href: '#/passwort', role: 'menuitem' }, svg(UI.key, { size: 17 }), 'Passwort ändern'),
    h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: async () => { await api('POST', '/auth/logout').catch(() => {}); onLogout(); } }, svg(UI.logout, { size: 17 }), 'Abmelden'));
  const avatar = h('button', { class: 'avatar-btn', type: 'button', 'aria-label': 'Benutzermenü', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, initials(me.displayName || me.username));
  const toggleMenu = (open = menu.hidden) => { menu.hidden = !open; avatar.setAttribute('aria-expanded', String(open)); };
  avatar.addEventListener('click', () => toggleMenu());

  const toolbar = h('div', { class: 'ctl toolbar' },
    h('div', { class: 'glass tool-group' },
      h('button', { class: 'btn btn-event', type: 'button', onClick: later('Der Lagemodus') }, svg(UI.situation, { size: 16, stroke: 2.2 }), 'Lagemodus'),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Drucken', title: 'Drucken', onClick: later('Der Druck') }, svg(UI.print)),
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
  const layerRows = OVERLAYS.map((o) => {
    const has = imported.has(o.id);
    const sw = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(state.overlays[o.id] && has), 'aria-label': o.label, disabled: !has });
    sw.addEventListener('click', () => {
      state.overlays[o.id] = !state.overlays[o.id];
      sw.setAttribute('aria-checked', String(state.overlays[o.id]));
      map.setOverlay(o.id, state.overlays[o.id]);
    });
    map.setOverlay(o.id, state.overlays[o.id] && has);
    return h('div', { class: 'layer-row' }, h('div', { style: { flex: '1', 'min-width': '0' } }, h('div', { class: 't' }, o.label), h('div', { class: 'cap' }, has ? o.sub : 'Noch nicht importiert')), sw);
  });
  const panel = h('div', { class: 'glass layer-panel pop', role: 'dialog', 'aria-label': 'Ebenen', hidden: true },
    h('div', { class: 'panel-head' }, 'Ebenen', h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Schließen', style: { width: '32px', height: '32px' }, onClick: () => togglePanel(false) }, svg(UI.close, { size: 16, stroke: 2.2 }))),
    h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '8px' } }, 'Hintergrund'), h('div', { class: 'seg' }, segBtns)),
    h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '4px' } }, 'Zuschaltbare Ebenen'), layerRows));
  const togglePanel = (open = panel.hidden) => { panel.hidden = !open; layerBtn.setAttribute('aria-expanded', String(open)); };
  layerBtn.addEventListener('click', () => togglePanel());
  map.setBasemap(state.basemap);

  // ---------- Legende & Quellen ----------
  const legendBody = h('div', { class: 'legend-body' },
    categories.map((c) => h('div', { class: 'legend-row' }, h('span', { class: 'dot', style: { background: c.color } }), h('span', { style: { flex: '1' } }, c.name), h('span', { class: 'cap n' }, '0'))),
    h('div', { class: 'legend-row' }, h('span', { class: 'legend-bundle', style: { background: `conic-gradient(${bundleGradient(categories)})` } }, h('span')), h('span', {}, 'Bündel mit Anzahl')),
    h('div', { class: 'legend-row' }, h('span', { class: 'legend-line' }), h('span', {}, 'Grenze Regierungsbezirk')));
  const legendBtn = h('button', { class: 'legend-toggle', type: 'button', 'aria-expanded': 'true' }, 'Legende', svg(UI.up, { size: 14, stroke: 2.4 }));
  legendBtn.addEventListener('click', () => { legendBody.hidden = !legendBody.hidden; legendBtn.setAttribute('aria-expanded', String(!legendBody.hidden)); });
  const legend = h('div', { class: 'glass ctl legend' }, legendBtn, legendBody);
  const attribution = h('div', { class: 'ctl attribution' }, (cfg.attributions.length ? cfg.attributions : ['© Geobasis NRW']).join(' · '));

  page.append(sidebar, empty, toolbar, menu, zoomCtl, panel, legend, attribution);

  const onKey = (e) => { if (e.key === 'Escape') { togglePanel(false); toggleMenu(false); } };
  const onDoc = (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== avatar) toggleMenu(false); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onDoc);

  return () => {
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
