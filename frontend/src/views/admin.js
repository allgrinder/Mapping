import { api, ApiError } from '../api.js';
import { h, svg, initials, formatDateTime } from '../ui/dom.js';
import { UI, SYMBOLS, SYMBOL_LABELS, PALETTE, CATEGORY_SYMBOLS, SCENARIO_SYMBOLS } from '../ui/icons.js';
import { confirmDialog, secretDialog, toast } from '../ui/dialog.js';
import { renderImportExport } from './importExport.js';

const TABS = {
  benutzer: { label: 'Benutzer' },
  kategorien: {
    label: 'Kategorien', api: '/categories', add: 'Kategorie hinzufügen', symbols: CATEGORY_SYMBOLS,
    sub: 'Reihenfolge bestimmt Filter, Legende und Druck. Farbe und Symbol gelten für alle Markierungen.',
  },
  szenarien: {
    label: 'Krisenszenarien', api: '/scenarios', add: 'Szenario hinzufügen', symbols: SCENARIO_SYMBOLS,
    sub: 'Szenarien stehen beim Anlegen einer Einrichtung als Markierung „gefährdet bei“ zur Auswahl.',
  },
  daten: { label: 'Import & Export' },
};

const chevron = () => svg(UI.down, { size: 14, stroke: 2.4 });
const errMsg = (e) => (e instanceof ApiError ? (Object.values(e.fields)[0] || e.message) : 'Aktion fehlgeschlagen.');

export async function renderAdmin(root, { me, tab, navigate }) {
  if (!TABS[tab]) tab = 'benutzer';
  const state = { users: [], kategorien: [], szenarien: [], sel: { kategorien: 0, szenarien: 0 }, draft: null };
  const main = h('section', { class: 'admin-main', 'aria-live': 'polite' });
  const counts = {};
  const navBtn = (key, icon) => {
    counts[key] = h('span', { class: 'n' });
    return h('a', { class: 'nav' + (tab === key ? ' on' : ''), href: '#/admin/' + key, 'aria-current': tab === key ? 'page' : null },
      svg(icon), TABS[key].label, counts[key]);
  };

  root.replaceChildren(h('div', { class: 'admin-page' },
    h('div', { class: 'admin-top' },
      h('a', { href: '#/karte', class: 'glass btn back-btn' }, svg(UI.back, { stroke: 2.4 }), 'Zur Karte'),
      h('h1', {}, 'Administration')),
    h('div', { class: 'glass rise admin-shell' },
      h('nav', { class: 'admin-nav', 'aria-label': 'Bereiche' },
        h('div', { class: 'cap' }, 'Zugang'),
        navBtn('benutzer', UI.users),
        h('div', { class: 'cap gap' }, 'Stammdaten'),
        navBtn('kategorien', UI.grid),
        navBtn('szenarien', UI.triangle),
        h('div', { class: 'cap gap' }, 'Daten'),
        navBtn('daten', UI.download)),
      main)));

  const notice = h('div');
  const load = async () => {
    const [u, c, s] = await Promise.all([api('GET', '/users'), api('GET', '/categories'), api('GET', '/scenarios')]);
    state.users = u.items;
    state.kategorien = c.items;
    state.szenarien = s.items;
    counts.benutzer.textContent = state.users.length;
    counts.kategorien.textContent = state.kategorien.length;
    counts.szenarien.textContent = state.szenarien.length;
  };

  const rerender = () => (tab === 'benutzer' ? renderUsers() : tab === 'daten'
    ? renderImportExport(main, { categories: state.kategorien, scenarios: state.szenarien, onChanged: load })
    : renderMaster());

  // ---------------- Benutzer ----------------
  function renderUsers() {
    const form = newUserForm();
    form.hidden = true;
    const head = h('div', { class: 'sec-head' },
      h('div', {}, h('h2', {}, 'Benutzer'),
        h('div', { class: 'cap' }, 'Rollen: „Lesen“ sieht Karte und Lagemodus, „Admin“ zusätzlich alle Bearbeiten-Funktionen.')),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => { form.hidden = false; form.querySelector('input').focus(); } },
        svg(UI.plus, { size: 16, stroke: 2.4 }), 'Benutzer anlegen'));
    const rows = state.users.map(userRow);
    main.replaceChildren(head, form, notice,
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Name', 'Benutzername', 'Rolle', 'Status', 'Letzte Anmeldung'].map((t) => h('th', { scope: 'col' }, t)),
          h('th', { scope: 'col', style: { 'text-align': 'right' } }, 'Aktionen'))),
        h('tbody', {}, rows))));
  }

  function newUserForm() {
    const name = h('input', { id: 'nu-n', class: 'input on-fill', placeholder: 'Vorname Nachname', maxlength: 120 });
    const login = h('input', { id: 'nu-u', class: 'input on-fill', placeholder: 'vorname.nachname', maxlength: 64, autocomplete: 'off' });
    const role = h('select', { id: 'nu-r', class: 'input on-fill' }, h('option', { value: 'lesen' }, 'Lesen'), h('option', { value: 'admin' }, 'Admin'));
    const err = h('div', { class: 'field-err full', role: 'alert', hidden: true });
    const form = h('form', { class: 'new-user rise', novalidate: true },
      h('div', {}, h('label', { class: 'lbl', for: 'nu-n' }, 'Name'), name),
      h('div', {}, h('label', { class: 'lbl', for: 'nu-u' }, 'Benutzername'), login),
      h('div', {}, h('label', { class: 'lbl', for: 'nu-r' }, 'Rolle'), h('div', { class: 'selw' }, role, chevron())),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn btn-secondary on-fill', type: 'button', onClick: () => { form.reset(); form.hidden = true; err.hidden = true; } }, 'Abbrechen'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Anlegen')),
      err,
      h('div', { class: 'cap full' }, 'Ein Einmalpasswort wird erzeugt und muss bei der ersten Anmeldung geändert werden.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('POST', '/users', { username: login.value.trim(), displayName: name.value.trim(), role: role.value });
        await secretDialog({ title: 'Benutzer angelegt', message: `Einmalpasswort für ${name.value.trim() || login.value.trim()}:`, secret: res.initialPassword });
        await load();
        renderUsers();
        toast(notice, 'Benutzer wurde angelegt.');
      } catch (ex) {
        err.textContent = errMsg(ex);
        err.hidden = false;
      }
    });
    return form;
  }

  function userRow(u) {
    const self = u.id === me.id;
    const label = u.displayName || u.username;
    const role = h('select', { class: 'input btn-sm', 'aria-label': `Rolle von ${label}`, disabled: self, style: { height: '34px', 'font-size': '13px' } },
      h('option', { value: 'admin', selected: u.role === 'admin' }, 'Admin'),
      h('option', { value: 'lesen', selected: u.role === 'lesen' }, 'Lesen'));
    role.addEventListener('change', async () => {
      try {
        await api('PUT', `/users/${u.id}`, { role: role.value });
        u.role = role.value;
        toast(notice, `Rolle von ${label} auf „${role.value === 'admin' ? 'Admin' : 'Lesen'}“ geändert.`);
      } catch (ex) {
        role.value = u.role;
        toast(notice, errMsg(ex), 'err');
      }
    });
    const status = !u.active ? ['Gesperrt', 'pill-danger'] : u.mustChangePassword ? ['Erstanmeldung offen', 'pill-neutral'] : ['Aktiv', 'pill-ok'];
    const lock = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', disabled: self, style: { 'min-width': '96px' } }, u.active ? 'Sperren' : 'Entsperren');
    lock.addEventListener('click', async () => {
      if (u.active && !(await confirmDialog({ title: 'Benutzer sperren?', message: `${label} wird sofort abgemeldet und kann sich nicht mehr anmelden.`, confirmLabel: 'Sperren', danger: true }))) return;
      try {
        await api('PUT', `/users/${u.id}`, { active: !u.active });
        toast(notice, `${label} wurde ${u.active ? 'gesperrt' : 'entsperrt'}.`);
        u.active = !u.active;
        renderUsersKeepNotice();
      } catch (ex) { toast(notice, errMsg(ex), 'err'); }
    });
    const reset = h('button', { class: 'btn btn-plain btn-sm', type: 'button' }, 'Passwort zurücksetzen');
    reset.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Passwort zurücksetzen?', message: `Für ${label} wird ein neues Einmalpasswort erzeugt. Bestehende Sitzungen werden beendet.`, confirmLabel: 'Zurücksetzen' }))) return;
      try {
        const res = await api('POST', `/users/${u.id}/reset-password`);
        await secretDialog({ title: 'Einmalpasswort erzeugt', message: `Neues Einmalpasswort für ${label}:`, secret: res.initialPassword });
        u.mustChangePassword = true;
        renderUsersKeepNotice();
        toast(notice, `Einmalpasswort für ${label} erzeugt. Es wird bei der nächsten Anmeldung abgefragt.`);
      } catch (ex) { toast(notice, errMsg(ex), 'err'); }
    });
    return h('tr', {},
      h('td', {}, h('div', { class: 'user-cell' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(label)), h('span', { class: 'nm' }, label, self ? ' (Sie)' : ''))),
      h('td', { style: { color: 'var(--text-2)' } }, u.username),
      h('td', {}, h('div', { class: 'selw', style: { width: '112px' } }, role, chevron())),
      h('td', {}, h('span', { class: 'pill ' + status[1] }, status[0])),
      h('td', { class: 'tnum', style: { color: 'var(--text-2)' } }, formatDateTime(u.lastLoginAt)),
      h('td', {}, h('div', { class: 'actions' }, reset, lock)));
  }

  function renderUsersKeepNotice() {
    renderUsers();
  }

  // ---------------- Stammdaten ----------------
  function renderMaster() {
    const cfg = TABS[tab];
    const list = state[tab];
    if (state.draft === null && list.length === 0) state.draft = blank(cfg);
    const selIdx = state.draft?.id === null ? -1 : Math.min(state.sel[tab], list.length - 1);
    const cur = state.draft ?? list[selIdx];
    if (!state.draft && cur) state.draft = { ...cur };
    const d = state.draft;

    const items = list.map((it, i) => h('div', { class: 'row' + (i === selIdx ? ' on' : '') + (it.active ? '' : ' inactive') },
      h('button', { class: 'row-pick', type: 'button', 'aria-pressed': String(i === selIdx), onClick: () => { state.sel[tab] = i; state.draft = null; renderMaster(); } },
        h('span', { class: 'cap pos' }, i + 1),
        h('span', { class: 'mk', style: { background: it.color } }, svg(SYMBOLS[it.symbol] || SYMBOLS.box, { size: 15, stroke: 2.2 })),
        h('span', { style: { flex: '1', 'min-width': '0' } },
          h('span', { style: { display: 'block', 'font-weight': '600' } }, it.name),
          h('span', { class: 'cap' }, `${it.usageCount} Einrichtung${it.usageCount === 1 ? '' : 'en'}${it.areaWide ? ' · flächig' : ''}${it.active ? '' : ' · inaktiv'}`))),
      h('button', { class: 'btn btn-icon', type: 'button', disabled: i === 0, 'aria-label': `${it.name} nach oben`, onClick: () => move(i, -1) }, svg(UI.up, { size: 16, stroke: 2.4 })),
      h('button', { class: 'btn btn-icon', type: 'button', disabled: i === list.length - 1, 'aria-label': `${it.name} nach unten`, onClick: () => move(i, 1) }, svg(UI.down, { size: 16, stroke: 2.4 }))));
    if (d.id === null) {
      items.push(h('div', { class: 'row on' }, h('span', { class: 'cap pos' }, list.length + 1),
        h('span', { class: 'mk', style: { background: d.color } }, svg(SYMBOLS[d.symbol], { size: 15, stroke: 2.2 })),
        h('span', { style: { 'font-weight': '600' } }, d.name || 'Neuer Eintrag')));
    }

    const head = h('div', { class: 'sec-head' },
      h('div', {}, h('h2', {}, cfg.label), h('div', { class: 'cap' }, cfg.sub)),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => { state.draft = blank(cfg); renderMaster(); } },
        svg(UI.plus, { size: 16, stroke: 2.4 }), cfg.add));
    main.replaceChildren(head, notice, h('div', { class: 'master' }, h('div', { class: 'master-list' }, items), editor(cfg, d)));
  }

  function editor(cfg, d) {
    const preview = h('span', { class: 'mk mk-lg', style: { background: d.color } }, svg(SYMBOLS[d.symbol], { size: 20, stroke: 2.2 }));
    const title = h('div', { style: { 'font-weight': '700', 'font-size': '16px' } }, d.name || 'Neuer Eintrag');
    const name = h('input', { id: 'ed-n', class: 'input on-fill', value: d.name, maxlength: 120 });
    const err = h('div', { class: 'field-err', role: 'alert', hidden: true });
    name.addEventListener('input', () => { d.name = name.value; title.textContent = d.name || 'Neuer Eintrag'; });
    const swatches = PALETTE.map(([c, label]) => h('button', {
      class: 'swatch' + (d.color.toUpperCase() === c ? ' on' : ''), type: 'button', 'aria-label': label, 'aria-pressed': String(d.color.toUpperCase() === c),
      style: { background: c }, onClick: () => { d.color = c; renderMaster(); },
    }));
    const symbols = cfg.symbols.map((k) => h('button', {
      class: 'icopt' + (d.symbol === k ? ' on' : ''), type: 'button', 'aria-label': SYMBOL_LABELS[k], 'aria-pressed': String(d.symbol === k),
      onClick: () => { d.symbol = k; renderMaster(); },
    }, svg(SYMBOLS[k], { size: 20 })));
    const active = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(d.active), 'aria-labelledby': 'ed-act' });
    active.addEventListener('click', () => { d.active = !d.active; active.setAttribute('aria-checked', String(d.active)); });
    const isScen = tab === 'szenarien';
    const wide = isScen ? h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(Boolean(d.areaWide)), 'aria-labelledby': 'ed-wide', 'aria-describedby': 'ed-wide-h' }) : null;
    wide?.addEventListener('click', () => { d.areaWide = !d.areaWide; wide.setAttribute('aria-checked', String(d.areaWide)); });
    const inUse = d.id !== null && d.usageCount > 0;
    const del = h('button', { class: 'btn btn-danger', type: 'button', disabled: d.id === null || inUse }, 'Löschen');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `„${d.name}“ löschen?`, message: 'Der Eintrag wird endgültig entfernt.', confirmLabel: 'Löschen', danger: true }))) return;
      try {
        await api('DELETE', `${cfg.api}/${d.id}`);
        state.draft = null;
        state.sel[tab] = Math.max(0, state.sel[tab] - 1);
        await load();
        renderMaster();
        toast(notice, `„${d.name}“ wurde gelöscht.`);
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
    });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern');
    const form = h('form', { class: 'master-edit', novalidate: true },
      h('div', { style: { display: 'flex', 'align-items': 'center', gap: '14px' } }, preview,
        h('div', {}, title, h('div', { class: 'cap' }, 'Vorschau der Markierung'))),
      h('div', {}, h('label', { class: 'lbl', for: 'ed-n' }, 'Name'), name),
      h('div', {}, h('div', { class: 'lbl' }, 'Farbe'), h('div', { class: 'chooser' }, swatches)),
      h('div', {}, h('div', { class: 'lbl' }, 'Symbol'), h('div', { class: 'chooser', style: { gap: '8px' } }, symbols)),
      h('div', { class: 'toggle-row' }, h('span', { id: 'ed-act', class: 'lbl', style: { margin: '0' } }, 'Aktiv (in Filtern und beim Anlegen wählbar)'), active),
      isScen ? h('div', {},
        h('div', { class: 'toggle-row' }, h('span', { id: 'ed-wide', class: 'lbl', style: { margin: '0' } }, 'Flächig – betrifft alle Einrichtungen im Gebiet'), wide),
        h('div', { id: 'ed-wide-h', class: 'cap', style: { 'margin-top': '4px' } }, 'Im Lagemodus gelten bei flächigen Szenarien (z. B. Stromausfall) alle Einrichtungen im Ereignisgebiet als gefährdet. Sonst nur die, die für dieses Szenario als „gefährdet bei“ markiert sind.')) : null,
      err,
      h('div', { style: { display: 'flex', gap: '8px', 'justify-content': 'space-between' } }, del, save),
      h('div', { class: 'cap' }, 'Löschen ist nur möglich, solange keine Einrichtung dieser Auswahl zugeordnet ist.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: d.name.trim(), color: d.color, symbol: d.symbol, active: d.active, ...(tab === 'szenarien' ? { areaWide: Boolean(d.areaWide) } : {}) };
      try {
        if (d.id === null) {
          await api('POST', cfg.api, body);
          await load();
          state.sel[tab] = state[tab].length - 1;
        } else {
          await api('PUT', `${cfg.api}/${d.id}`, body);
          await load();
        }
        state.draft = null;
        renderMaster();
        toast(notice, `„${body.name}“ wurde gespeichert.`);
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
    });
    return form;
  }

  async function move(i, dir) {
    const list = state[tab].slice();
    const j = i + dir;
    [list[i], list[j]] = [list[j], list[i]];
    try {
      await api('PUT', `${TABS[tab].api}/order`, { ids: list.map((x) => x.id) });
      state[tab] = list;
      state.sel[tab] = j;
      state.draft = null;
      renderMaster();
    } catch (ex) { toast(notice, errMsg(ex), 'err'); }
  }

  function blank(cfg) {
    return { id: null, name: '', color: PALETTE[0][0], symbol: cfg.symbols[0], active: true, areaWide: false, usageCount: 0 };
  }

  try {
    await load();
    rerender();
  } catch (ex) {
    main.replaceChildren(h('div', { class: 'empty' }, errMsg(ex)));
  }
}
