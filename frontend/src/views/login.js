import { api, ApiError, DEMO } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI } from '../ui/icons.js';
import { nrwBackdrop } from '../ui/nrwBackdrop.js';

export function passwordField(id, autocomplete, label) {
  const input = h('input', { id, class: 'input input-lg', type: 'password', autocomplete, required: true });
  const eye = svg(UI.eye);
  const toggle = h('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'Passwort anzeigen', title: 'Passwort anzeigen' }, eye);
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const t = show ? 'Passwort verbergen' : 'Passwort anzeigen';
    toggle.setAttribute('aria-label', t);
    toggle.title = t;
    toggle.replaceChildren(svg(show ? UI.eyeOff : UI.eye));
  });
  return { input, el: h('div', {}, h('label', { class: 'lbl lbl-lg', for: id }, label), h('div', { class: 'pw-wrap' }, input, toggle)) };
}

export function authScreen(card) {
  return h('div', { class: 'auth-screen' },
    nrwBackdrop(),
    card,
    h('div', { class: 'cap auth-foot' }, 'Nur für den Dienstgebrauch · © Geobasis NRW · © OpenStreetMap-Mitwirkende'));
}

export function authHead(sub) {
  return h('div', { class: 'auth-head' },
    h('div', { class: 'auth-logo' }, svg(UI.pin, { size: 28 })),
    h('div', {}, h('h1', {}, 'KRITIS-Lagekarte NRW'), h('div', { class: 'auth-sub' }, sub)));
}

export function renderLogin(root, { onLoggedIn }) {
  const user = h('input', { id: 'u', class: 'input input-lg', autocomplete: 'username', placeholder: 'vorname.nachname', required: true });
  const pw = passwordField('p', 'current-password', 'Passwort');
  const error = h('div', { class: 'alert', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Anmelden');

  const showError = (msg) => {
    error.replaceChildren(svg(UI.alert, { size: 16, stroke: 2.2 }), msg);
    error.hidden = false;
  };

  const form = h('form', { class: 'glass rise auth-card', novalidate: true },
    authHead('Bitte melden Sie sich an.'),
    h('div', { class: 'auth-fields' },
      h('div', {}, h('label', { class: 'lbl lbl-lg', for: 'u' }, 'Benutzername'), user),
      pw.el,
      error),
    submit,
    DEMO
      ? h('div', { class: 'demo-hint' }, h('strong', {}, 'Demo-Zugänge'), h('span', {}, 'admin / demo – Administration'), h('span', {}, 'leser / demo – nur lesen'))
      : h('div', { class: 'cap' }, 'Passwort vergessen? Wenden Sie sich an die Administration Ihres Hauses.'));

  for (const el of [user, pw.input]) el.addEventListener('input', () => { error.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!user.value.trim() || !pw.input.value) {
      showError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    submit.disabled = true;
    try {
      const res = await api('POST', '/auth/login', { username: user.value.trim(), password: pw.input.value });
      onLoggedIn(res.user);
    } catch (err) {
      pw.input.value = '';
      showError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      submit.disabled = false;
    }
  });

  root.replaceChildren(authScreen(form));
  user.focus();
}
