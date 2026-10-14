import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Translate from 'ol/interaction/Translate.js';
import Collection from 'ol/Collection.js';
import { Icon, Style } from 'ol/style.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { api, ApiError } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI, SYMBOLS } from '../ui/icons.js';
import { confirmDialog, toast } from '../ui/dialog.js';
import { createMap } from '../map/mapView.js';
import { UTM } from '../map/projection.js';
import { formatCoord } from '../facilities.js';

function pinSvg(color, symbol) {
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56"><path d="M22 54C22 54 4 34 4 21a18 18 0 0 1 36 0c0 13-18 33-18 33Z" fill="${color}" stroke="#fff" stroke-width="2.5"/><g transform="translate(13 12) scale(0.75)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${SYMBOLS[symbol] || SYMBOLS.box}"/></g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
}

export async function renderFacilityEdit(root, { id, navigate }) {
  const [cfg, cats, scens, existing] = await Promise.all([
    api('GET', '/map/config'), api('GET', '/categories'), api('GET', '/scenarios'),
    id ? api('GET', `/facilities/${id}`) : Promise.resolve(null),
  ]);
  const categories = cats.items.filter((c) => c.active || c.id === existing?.categoryId);
  const scenarios = scens.items.filter((s) => s.active || existing?.hazards.includes(s.id));
  const d = existing ? structuredClone(existing) : {
    name: '', categoryId: categories[0]?.id ?? null, address: { street: '', zip: '', city: '' }, location: null, hazards: [],
    contact: { person: '', function: '', phone: '', email: '' }, note: '',
  };
  for (const k of ['street', 'zip', 'city']) d.address[k] ??= '';
  for (const k of ['person', 'function', 'phone', 'email']) d.contact[k] ??= '';
  d.note ??= '';
  const title = existing ? 'Einrichtung bearbeiten' : 'Neue Einrichtung';

  const canvas = h('div', { class: 'map-canvas' });
  const notice = h('div', { class: 'notice-float edit-notice' });
  const page = h('div', { class: 'map-page edit-page' }, canvas);
  root.replaceChildren(page);
  const map = await createMap(canvas, cfg, { fitPadding: [80, 480, 24, 24] });
  map.setBasemap(cfg.basemaps.find((b) => b.id === 'topografisch' && b.available) ? 'topografisch' : 'politisch');
  map.setOverlay('kreis', true);

  // ---------- Marker ----------
  const pin = new Feature();
  const pinLayer = new VectorLayer({ source: new VectorSource({ features: [pin] }), zIndex: 50 });
  map.map.addLayer(pinLayer);
  const paintPin = () => {
    const c = categories.find((x) => x.id === d.categoryId);
    pin.setStyle(new Style({ image: new Icon({ src: pinSvg(c?.color || '#0A66D8', c?.symbol), anchor: [0.5, 1] }) }));
  };
  paintPin();
  const translate = new Translate({ features: new Collection([pin]) });
  map.map.addInteraction(translate);
  translate.on('translateend', () => setLocation(toLonLat(pin.getGeometry().getCoordinates(), UTM), false));
  map.map.on('singleclick', (e) => {
    if (map.map.hasFeatureAtPixel(e.pixel, { layerFilter: (l) => l === pinLayer })) return;
    setLocation(toLonLat(e.coordinate, UTM), false);
  });
  map.map.on('pointermove', (e) => {
    map.map.getTargetElement().style.cursor = map.map.hasFeatureAtPixel(e.pixel, { layerFilter: (l) => l === pinLayer }) ? 'grab' : 'crosshair';
  });

  const adminGrid = h('div', { class: 'admin-grid' });
  const coordCap = h('div', { class: 'cap coord-cap' });
  const tip = h('div', { class: 'glass edit-banner' }, h('span', { class: 'dot-accent' }), 'Standort per Adresssuche oder Klick in die Karte setzen');

  async function setLocation([lon, lat], zoom) {
    d.location = { lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 };
    pin.setGeometry(new Point(fromLonLat([lon, lat], UTM)));
    if (zoom) map.view.animate({ center: fromLonLat([lon, lat], UTM), resolution: 2.3, duration: 350 });
    tip.lastChild.textContent = 'Markierung ziehen zur Feinkorrektur';
    coordCap.replaceChildren(svg(UI.locate, { size: 14 }), `${formatCoord(d.location.lat, d.location.lon)} · Gebiete automatisch ermittelt`);
    fieldErr.location.hidden = true;
    adminGrid.replaceChildren(cell('Regierungsbezirk', '…'), cell('Kreis / Stadt', '…'), cell('PLZ-Gebiet', '…'));
    try {
      const r = await api('GET', `/geo/resolve?lon=${d.location.lon}&lat=${d.location.lat}`);
      adminGrid.replaceChildren(cell('Regierungsbezirk', r.names.regbez || '–'), cell('Kreis / Stadt', r.names.kreis || '–'), cell('PLZ-Gebiet', r.plz5 || '–'));
      if (r.boundariesLoaded && !r.inNrw) showFieldError('location', 'Der Standort liegt außerhalb von Nordrhein-Westfalen.');
    } catch { adminGrid.replaceChildren(); }
  }
  const cell = (k, v) => h('div', {}, h('div', { class: 'cap' }, k), h('div', { class: 'cell-v' }, v));

  // ---------- Formular ----------
  const fieldErr = {};
  const err = (key) => (fieldErr[key] = h('div', { class: 'field-err', hidden: true }));
  const showFieldError = (key, msg) => { if (fieldErr[key]) { fieldErr[key].textContent = msg; fieldErr[key].hidden = false; } };
  const input = (id2, label, value, opts = {}) => {
    const el = h(opts.tag || 'input', { id: id2, class: 'input', value: value ?? '', type: opts.type, rows: opts.rows, maxlength: opts.max, inputmode: opts.inputmode, autocomplete: opts.autocomplete || 'off' });
    el.addEventListener('input', () => { opts.onInput(el.value); if (opts.err) fieldErr[opts.err].hidden = true; });
    return { el, wrap: h('div', { class: opts.cls }, h('label', { class: 'lbl', for: id2 }, label), el, opts.err ? err(opts.err) : null) };
  };

  const name = input('e-name', 'Name *', d.name, { max: 255, err: 'name', onInput: (v) => { d.name = v; } });

  const catGroup = h('div', { role: 'radiogroup', 'aria-label': 'Kategorie', class: 'cat-grid' }, categories.map((c) => {
    const b = h('button', { class: 'catopt', type: 'button', role: 'radio', 'aria-checked': String(d.categoryId === c.id) },
      h('span', { class: 'tile', style: { background: c.color } }, svg(SYMBOLS[c.symbol] || SYMBOLS.box, { size: 15 })), h('span', {}, c.name));
    b.addEventListener('click', () => {
      d.categoryId = c.id;
      catGroup.querySelectorAll('.catopt').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      fieldErr.categoryId.hidden = true;
      paintPin();
    });
    return b;
  }));

  const street = input('e-str', 'Straße und Hausnummer', d.address.street, { max: 255, err: 'street', cls: 'span2', onInput: (v) => { d.address.street = v; } });
  const zip = input('e-zip', 'PLZ', d.address.zip, { max: 5, inputmode: 'numeric', err: 'zip', onInput: (v) => { d.address.zip = v; } });
  const city = input('e-city', 'Ort *', d.address.city, { max: 120, err: 'city', cls: 'span2', onInput: (v) => { d.address.city = v; } });

  // Adresssuche (Geokodierung über den Server)
  const search = h('input', { id: 'e-adr', class: 'input', placeholder: 'Adresse suchen, z. B. Rheinallee 1, Bonn', autocomplete: 'off', 'aria-autocomplete': 'list', 'aria-controls': 'e-sugg' });
  const sugg = h('div', { id: 'e-sugg', class: 'glass pop sugg-list', role: 'listbox', hidden: true });
  const searchMsg = h('div', { class: 'cap', hidden: true });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 3) { sugg.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('GET', `/geocode?q=${encodeURIComponent(q)}`);
        searchMsg.hidden = true;
        sugg.replaceChildren(...(r.items.length ? r.items : [null]).map((it) => it
          ? h('button', { class: 'sugg', type: 'button', role: 'option', onClick: () => pickSuggestion(it) },
            h('span', { class: 'sugg-a' }, it.street || it.label.split(',')[0]), h('span', { class: 'cap' }, [it.zip, it.city].filter(Boolean).join(' ') || it.label))
          : h('div', { class: 'cap', style: { padding: '8px 12px' } }, 'Keine Treffer in NRW.')));
        sugg.hidden = false;
      } catch (e) {
        sugg.hidden = true;
        searchMsg.textContent = e.message;
        searchMsg.hidden = false;
      }
    }, 450);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') sugg.hidden = true; });
  function pickSuggestion(it) {
    sugg.hidden = true;
    search.value = it.label;
    Object.assign(d.address, { street: it.street || d.address.street, zip: it.zip || d.address.zip, city: it.city || d.address.city });
    street.el.value = d.address.street; zip.el.value = d.address.zip; city.el.value = d.address.city;
    setLocation([it.lon, it.lat], true);
  }

  const hazardBoxes = h('div', { class: 'cb-grid' }, scenarios.map((s) => {
    const cb = h('input', { type: 'checkbox', checked: d.hazards.includes(s.id) });
    cb.addEventListener('change', () => { d.hazards = cb.checked ? [...d.hazards, s.id] : d.hazards.filter((x) => x !== s.id); });
    cb.dataset.id = s.id;
    return h('label', { class: 'cb' }, cb, s.name);
  }));
  const hints = h('div', { class: 'hints' });

  const person = input('e-p', 'Ansprechperson', d.contact.person, { max: 160, err: 'contactPerson', onInput: (v) => { d.contact.person = v; } });
  const func = input('e-f', 'Funktion', d.contact.function, { max: 160, err: 'contactFunction', onInput: (v) => { d.contact.function = v; } });
  const phone = input('e-t', 'Telefon', d.contact.phone, { type: 'tel', max: 60, err: 'contactPhone', onInput: (v) => { d.contact.phone = v; } });
  const mail = input('e-m', 'E-Mail', d.contact.email, { type: 'email', max: 190, err: 'contactEmail', onInput: (v) => { d.contact.email = v; } });
  const note = input('e-b', 'Bemerkung', d.note, { tag: 'textarea', rows: 3, max: 4000, err: 'note', onInput: (v) => { d.note = v; } });

  const save = h('button', { class: 'btn btn-primary', type: 'submit', 'data-write': true }, 'Speichern');
  const form = h('form', { class: 'edit-form', novalidate: true },
    h('div', { class: 'edit-scroll' },
      name.wrap,
      h('div', {}, h('div', { class: 'lbl' }, 'Kategorie *'), catGroup, err('categoryId')),
      h('div', { class: 'addr-block' },
        h('div', { class: 'addr-search' }, h('label', { class: 'lbl', for: 'e-adr' }, 'Adresse suchen'),
          h('div', { class: 'search' }, svg(UI.search, { size: 16, stroke: 2.2 }), search), sugg, searchMsg),
        h('div', { class: 'addr-fields' }, street.wrap, zip.wrap, city.wrap),
        adminGrid, coordCap, err('location')),
      hints,
      h('div', {}, h('div', { class: 'lbl' }, 'Gefährdet bei'), hazardBoxes, err('hazards')),
      h('div', { class: 'contact-block' },
        h('div', { class: 'sec-row' }, h('div', { class: 'sec' }, 'Kontakt'), h('div', { class: 'cap' }, 'optional')),
        h('div', { class: 'grid2' }, person.wrap, func.wrap, phone.wrap, mail.wrap)),
      note.wrap,
      h('div', { class: 'cap' }, '* Pflichtfeld')),
    h('div', { class: 'edit-foot' },
      existing ? h('button', { class: 'btn btn-secondary', type: 'button', style: { color: 'var(--danger)' }, onClick: remove }, 'Löschen') : null,
      h('span', { style: { flex: '1' } }),
      h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => navigate(existing ? `#/karte?sel=${existing.id}` : '#/karte') }, 'Abbrechen'),
      save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.values(fieldErr).forEach((x) => { x.hidden = true; });
    if (!d.location) { showFieldError('location', 'Bitte den Standort per Adresssuche oder Klick in die Karte setzen.'); return; }
    const body = {
      name: (d.name || '').trim(), categoryId: d.categoryId, street: (d.address.street || '').trim(), zip: (d.address.zip || '').trim(), city: (d.address.city || '').trim(),
      location: d.location, hazards: d.hazards,
      contactPerson: d.contact.person?.trim() || null, contactFunction: d.contact.function?.trim() || null,
      contactPhone: d.contact.phone?.trim() || null, contactEmail: d.contact.email?.trim() || null, note: d.note?.trim() || null,
    };
    save.disabled = true;
    try {
      const r = await api(existing ? 'PUT' : 'POST', existing ? `/facilities/${existing.id}` : '/facilities', body);
      navigate(`#/karte?sel=${r.id}`);
    } catch (ex) {
      if (!(ex instanceof ApiError)) console.error(ex);
      if (ex instanceof ApiError && Object.keys(ex.fields).length) {
        for (const [k, m] of Object.entries(ex.fields)) showFieldError(k, m);
        form.querySelector('.field-err:not([hidden])')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else toast(notice, ex.message, 'err');
    } finally { save.disabled = false; }
  });

  async function remove() {
    if (!(await confirmDialog({ title: `„${existing.name}“ löschen?`, message: 'Die Einrichtung wird endgültig entfernt.', confirmLabel: 'Löschen', danger: true }))) return;
    try { await api('DELETE', `/facilities/${existing.id}`); navigate('#/karte'); } catch (ex) { toast(notice, ex.message, 'err'); }
  }

  page.append(
    h('div', { class: 'edit-top' }, h('a', { href: existing ? `#/karte?sel=${existing.id}` : '#/karte', class: 'glass btn back-btn' }, svg(UI.back, { stroke: 2.4 }), 'Zur Karte'), tip),
    h('div', { class: 'edit-zoom glass ctl-group' },
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Vergrößern', onClick: () => map.zoomBy(1) }, svg(UI.plus, { stroke: 2.2 })),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Verkleinern', onClick: () => map.zoomBy(-1) }, svg(UI.minus, { stroke: 2.2 }))),
    h('aside', { class: 'glass edit-aside', 'aria-label': title },
      h('div', { class: 'edit-head' }, h('h1', {}, title),
        h('a', { class: 'btn btn-icon sheet-close', href: existing ? `#/karte?sel=${existing.id}` : '#/karte', 'aria-label': 'Schließen' }, svg(UI.close, { size: 15, stroke: 2.4 }))),
      form),
    notice);

  if (existing) setLocation([existing.location.lon, existing.location.lat], true);
  name.el.focus();
  return () => map.destroy();
}
