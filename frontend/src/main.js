import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';
import './styles/admin.css';
import { api, onAuthError, setCsrf, DEMO } from './api.js';
import { h } from './ui/dom.js';
import { renderLogin } from './views/login.js';
import { renderPasswordChange } from './views/password.js';
import { renderAdmin } from './views/admin.js';
import { renderMapPage } from './views/mapPage.js';
import { renderFacilityEdit } from './views/facilityEdit.js';
import { renderSituation } from './views/situation.js';
import { renderPrintDialog } from './views/printDialog.js';
import { renderWarnlage } from './views/warnlage.js';
import { applyTheme, isDark, onThemeChange } from './ui/theme.js';
import { registerServiceWorker, warmup, clearOfflineData } from './ui/offline.js';
import './styles/map.css';

const root = document.getElementById('app');
let me = null;
let cleanup = null;
let warmedUp = false;

applyTheme();
registerServiceWorker();

if (DEMO) {
  document.title = 'KRITIS-Lagekarte NRW (Demo)';
  const reset = h('button', { class: 'btn btn-plain btn-sm', type: 'button' }, 'Zurücksetzen');
  reset.addEventListener('click', async () => {
    const { resetDemo } = await import('./demo/server.js');
    resetDemo();
    location.hash = '#/login';
    location.reload();
  });
  const badge = h('div', { class: 'glass demo-badge kl', role: 'note' }, h('strong', {}, 'Demo'), h('span', {}, 'Daten nur in diesem Browser'), reset);
  const paint = (dark) => { badge.classList.toggle('kl-dark', dark); badge.classList.toggle('kl-light', !dark); };
  paint(isDark());
  onThemeChange(paint);
  document.body.append(badge);
}

const navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

onAuthError((err) => {
  if (err.code === 'password_change_required') navigate('#/passwort');
  else { me = null; navigate('#/login'); }
});

async function refreshSession() {
  const res = await api('GET', '/auth/me');
  setCsrf(res.csrfToken);
  me = res.user;
}

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [path, query = ''] = (location.hash.replace(/^#/, '') || '/karte').split('?');
  const params = new URLSearchParams(query);
  const [, section, sub] = path.split('/');
  if (!me && section !== 'login') return navigate('#/login');
  if (me?.mustChangePassword && section !== 'passwort' && section !== 'login') return navigate('#/passwort');

  switch (section) {
    case 'login':
      if (me) return navigate('#/karte');
      return renderLogin(root, {
        onLoggedIn: (user) => { me = user; navigate(user.mustChangePassword ? '#/passwort' : '#/karte'); },
      });
    case 'passwort':
      return renderPasswordChange(root, {
        user: me,
        forced: me.mustChangePassword,
        onDone: async () => { await refreshSession(); navigate('#/karte'); },
        onCancel: async () => {
          if (me.mustChangePassword) { await api('POST', '/auth/logout').catch(() => {}); me = null; await refreshSession(); navigate('#/login'); } else history.back();
        },
      });
    case 'einrichtung':
      if (me.role !== 'admin') return navigate('#/karte');
      cleanup = await renderFacilityEdit(root, { id: sub === 'neu' ? null : Number(sub), navigate });
      return cleanup;
    case 'lage':
      cleanup = await renderSituation(root, { me, eventId: sub ? Number(sub) : null, navigate });
      return cleanup;
    case 'warnlage':
      cleanup = await renderWarnlage(root, { navigate });
      return cleanup;
    case 'druck':
      return renderPrintDialog(root, { navigate });
    case 'admin':
      if (me.role !== 'admin') return navigate('#/karte');
      return renderAdmin(root, { me, tab: sub, navigate });
    case 'karte':
    default:
      cleanup = await renderMapPage(root, { me, navigate, selectId: params.get('sel') ? Number(params.get('sel')) : null, onLogout: async () => { me = null; clearOfflineData(); await refreshSession(); navigate('#/login'); } });
      if (!warmedUp) { warmedUp = true; api('GET', '/map/config').then((cfg) => warmup(cfg, { demo: DEMO })).catch(() => {}); }
      return cleanup;
  }
}

window.addEventListener('hashchange', route);
(async () => {
  try {
    await refreshSession();
  } catch {
    root.replaceChildren(h('div', { class: 'auth-screen' }, h('div', { class: 'glass auth-card' }, 'Der Server ist nicht erreichbar. Bitte später erneut versuchen.')));
    return;
  }
  route();
})();
