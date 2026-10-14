import { h, svg } from './dom.js';
import { UI } from './icons.js';

function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    dlg.append(build(close));
    document.getElementById('app').append(dlg);
    dlg.showModal();
  });
}

/** Bestätigungsdialog; liefert true bei Bestätigung. */
export function confirmDialog({ title, message, confirmLabel = 'Bestätigen', danger = false }) {
  return openDialog((close) => h('div', { class: 'glass dlg-body rise', role: 'alertdialog', 'aria-labelledby': 'dlg-t' },
    h('h2', { id: 'dlg-t' }, title),
    h('div', { style: { color: 'var(--text-2)' } }, message),
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => close(false) }, 'Abbrechen'),
      h('button', { class: 'btn ' + (danger ? 'btn-danger-fill' : 'btn-primary'), type: 'button', onClick: () => close(true), autofocus: true }, confirmLabel))));
}

/** Zeigt ein Einmalpasswort genau einmal an. */
export function secretDialog({ title, message, secret }) {
  return openDialog((close) => {
    const copyBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Kopieren');
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(secret); copyBtn.textContent = 'Kopiert'; } catch { copyBtn.textContent = 'Bitte manuell kopieren'; }
    });
    return h('div', { class: 'glass dlg-body rise', role: 'dialog', 'aria-labelledby': 'dlg-t' },
      h('div', { style: { display: 'flex', gap: '12px', 'align-items': 'center' } },
        h('span', { class: 'mk mk-lg', style: { background: 'var(--accent)' } }, svg(UI.key, { size: 20 })),
        h('h2', { id: 'dlg-t' }, title)),
      h('div', { style: { color: 'var(--text-2)' } }, message),
      h('div', { class: 'secret' }, secret),
      h('div', { class: 'cap' }, 'Das Passwort wird nur jetzt angezeigt und muss bei der ersten Anmeldung geändert werden.'),
      h('div', { class: 'dlg-actions' }, copyBtn, h('button', { class: 'btn btn-primary', type: 'button', onClick: () => close(true) }, 'Fertig')));
  });
}

export function toast(container, message, kind = 'ok') {
  const t = h('div', { class: 'toast rise' + (kind === 'err' ? ' err' : ''), role: kind === 'err' ? 'alert' : 'status' },
    svg(kind === 'err' ? UI.alert : UI.check, { size: 16, stroke: 2.4 }), message);
  container.replaceChildren(t);
  clearTimeout(container._t);
  container._t = setTimeout(() => t.remove(), 6000);
}
