import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';
import './styles/admin.css';
import { api, onAuthError, setCsrf } from './api.js';
import { h } from './ui/dom.js';
import { renderLogin } from './views/login.js';
import { renderPasswordChange } from './views/password.js';
import { renderAdmin } from './views/admin.js';
import { renderHome } from './views/home.js';

const root = document.getElementById('app');
let me = null;

// Farbschema: Systemeinstellung, später manuell umschaltbar (Warnlage nutzt Dunkelmodus).
const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
const applyTheme = () => root.classList.replace(dark?.matches ? 'kl-light' : 'kl-dark', dark?.matches ? 'kl-dark' : 'kl-light');
dark?.addEventListener?.('change', applyTheme);
applyTheme();

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
  const path = location.hash.replace(/^#/, '') || '/karte';
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
    case 'admin':
      if (me.role !== 'admin') return navigate('#/karte');
      return renderAdmin(root, { me, tab: sub, navigate });
    case 'karte':
    default:
      return renderHome(root, { me, onLogout: async () => { me = null; await refreshSession(); navigate('#/login'); } });
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
