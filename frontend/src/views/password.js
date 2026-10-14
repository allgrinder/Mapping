import { api, ApiError } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI } from '../ui/icons.js';
import { authHead, authScreen, passwordField } from './login.js';

export const RULES = [
  ['Mindestens 12 Zeichen', (p) => p.length >= 12],
  ['Groß- und Kleinbuchstaben', (p) => /\p{Ll}/u.test(p) && /\p{Lu}/u.test(p)],
  ['Mindestens eine Ziffer oder ein Sonderzeichen', (p) => /[\p{N}\p{P}\p{S}]/u.test(p)],
];

export function renderPasswordChange(root, { user, forced, onDone, onCancel }) {
  const cur = passwordField('pc', 'current-password', forced ? 'Initialpasswort' : 'Aktuelles Passwort');
  const neu = passwordField('pn', 'new-password', 'Neues Passwort');
  const rep = passwordField('pr', 'new-password', 'Neues Passwort wiederholen');
  const rules = h('ul', { class: 'pw-rules' }, RULES.map(([t]) => h('li', {}, t)));
  const error = h('div', { class: 'alert', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Passwort ändern');

  neu.input.addEventListener('input', () => {
    RULES.forEach(([, test], i) => rules.children[i].classList.toggle('ok', test(neu.input.value)));
    error.hidden = true;
  });
  const showError = (msg) => { error.replaceChildren(svg(UI.alert, { size: 16, stroke: 2.2 }), msg); error.hidden = false; };

  const form = h('form', { class: 'glass rise auth-card', novalidate: true },
    authHead(forced
      ? `Willkommen, ${user.displayName || user.username}. Bitte vergeben Sie vor der ersten Nutzung ein eigenes Passwort.`
      : 'Eigenes Passwort ändern.'),
    h('div', { class: 'auth-fields' }, cur.el, neu.el, rules, rep.el, error),
    submit,
    forced
      ? h('button', { class: 'btn btn-plain', type: 'button', onClick: onCancel }, 'Abmelden')
      : h('button', { class: 'btn btn-plain', type: 'button', onClick: onCancel }, 'Abbrechen'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = neu.input.value;
    if (!cur.input.value) return showError('Bitte das bisherige Passwort eingeben.');
    if (!RULES.every(([, test]) => test(p))) return showError('Das neue Passwort erfüllt die Anforderungen noch nicht.');
    if (p !== rep.input.value) return showError('Die Wiederholung stimmt nicht überein.');
    submit.disabled = true;
    try {
      await api('POST', '/auth/change-password', { currentPassword: cur.input.value, newPassword: p });
      onDone();
    } catch (err) {
      showError(err instanceof ApiError ? (Object.values(err.fields)[0] || err.message) : 'Änderung fehlgeschlagen.');
    } finally {
      submit.disabled = false;
    }
  });

  root.replaceChildren(authScreen(form));
  cur.input.focus();
}
