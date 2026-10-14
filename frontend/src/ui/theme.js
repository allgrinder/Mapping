// Farbschema: gespeicherte Wahl (Schalter in der Karte) hat Vorrang vor der Systemeinstellung.
const KEY = 'kl-theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');
const listeners = new Set();

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function isDark() {
  const s = stored();
  return s ? s === 'dark' : Boolean(media?.matches);
}

export function applyTheme() {
  const root = document.getElementById('app');
  const dark = isDark();
  root.classList.toggle('kl-dark', dark);
  root.classList.toggle('kl-light', !dark);
  listeners.forEach((fn) => fn(dark));
}

export function toggleTheme() {
  try { localStorage.setItem(KEY, isDark() ? 'light' : 'dark'); } catch { /* ohne Speicher: nur Sitzung */ }
  applyTheme();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', applyTheme);
