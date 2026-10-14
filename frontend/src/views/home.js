import { api } from '../api.js';
import { h, svg, initials } from '../ui/dom.js';
import { UI } from '../ui/icons.js';
import { nrwBackdrop } from '../ui/nrwBackdrop.js';

// Platzhalter bis Arbeitspaket 3 (Karte). Zeigt den App-Rahmen mit Benutzermenü.
export function renderHome(root, { me, onLogout }) {
  const menu = h('div', { class: 'glass home-menu', role: 'menu', hidden: true },
    me.role === 'admin' ? h('a', { class: 'nav', href: '#/admin/benutzer', role: 'menuitem' }, svg(UI.settings), 'Administration') : null,
    h('a', { class: 'nav', href: '#/passwort', role: 'menuitem' }, svg(UI.key), 'Passwort ändern'),
    h('button', { class: 'nav', type: 'button', role: 'menuitem', onClick: async () => { await api('POST', '/auth/logout').catch(() => {}); onLogout(); } }, svg(UI.logout), 'Abmelden'));
  const userBtn = h('button', { class: 'glass home-user', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    h('span', { class: 'avatar' }, initials(me.displayName || me.username)),
    h('span', {}, me.displayName || me.username),
    h('span', { class: 'cap' }, me.role === 'admin' ? 'Admin' : 'Lesen'));
  userBtn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    userBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  root.replaceChildren(h('div', { class: 'auth-screen' },
    nrwBackdrop(),
    h('header', { class: 'home-top' },
      h('div', { class: 'glass home-brand' }, h('span', { class: 'auth-logo home-logo' }, svg(UI.pin, { size: 18 })), h('strong', {}, 'KRITIS-Lagekarte NRW')),
      h('div', { class: 'home-right' }, userBtn, menu)),
    h('div', { class: 'glass rise auth-card', style: { 'text-align': 'center' } },
      h('h1', { style: { margin: '0', 'font-size': '20px' } }, 'Karte in Vorbereitung'),
      h('div', { style: { color: 'var(--text-2)' } }, 'Anmeldung und Administration sind eingerichtet. Die interaktive Karte folgt im nächsten Arbeitspaket.'))));
}
