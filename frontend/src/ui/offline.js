// Offline-Zustand: Antworten aus dem Service-Worker-Cache (Header X-From-Cache) oder fehlendes Netz → reiner Lesebetrieb.
import { h, svg } from './dom.js';

const state = { offline: false, dataAsOf: null };
const listeners = new Set();
let banner = null;

export const isOffline = () => state.offline;
export function onOfflineChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setOffline(v) {
  if (state.offline === v) return;
  state.offline = v;
  document.getElementById('app')?.classList.toggle('is-offline', v);
  paint();
  listeners.forEach((fn) => fn(v));
}

export function setDataAsOf(utc) {
  if (utc) { state.dataAsOf = utc; paint(); }
}

const WIFI_OFF = 'M2 8.5a15 15 0 0 1 4.2-2.7M10 5.1A15 15 0 0 1 22 8.5M5.5 12.2a10 10 0 0 1 3.2-1.9M15 10.6a10 10 0 0 1 3.5 1.6M9 15.8a5 5 0 0 1 6 0M12 19.5v.01M3 3l18 18';

function paint() {
  if (!state.offline) { banner?.remove(); banner = null; return; }
  const when = state.dataAsOf ? new Date(String(state.dataAsOf).replace(' ', 'T') + 'Z').toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr' : 'unbekannt';
  const el = h('div', { class: 'offline-banner pop', role: 'status' },
    svg(WIFI_OFF, { size: 22 }),
    h('div', { class: 'ob-text' }, h('div', { class: 'ob-title' }, `Offline – Datenstand vom ${when}`),
      h('div', { class: 'ob-sub' }, 'Nur Lesen. Bearbeiten, Lagemodus-Speicherung und Live-Warnungen sind nicht verfügbar.')),
    h('button', { class: 'btn ob-retry', type: 'button', onClick: () => location.reload() }, 'Erneut verbinden'));
  if (banner) banner.replaceWith(el); else document.body.append(el);
  banner = el;
}

window.addEventListener('online', () => setOffline(false));
if (navigator.onLine === false) queueMicrotask(() => setOffline(true));
window.addEventListener('offline', () => setOffline(true));

// ---------- Service Worker ----------
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* ohne SW kein Offline-Cache */ });
}

function post(msg) {
  navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage(msg)).catch(() => {});
}

/** Lädt den aktuellen Datenstand und die NRW-Übersicht (niedrige Zoomstufen) in den Offline-Cache. */
export function warmup(cfg, { demo = false, maxZoom = 4 } = {}) {
  const urls = demo
    ? ['land', 'regbez', 'kreis'].map((l) => new URL(`./demo-data/boundaries-${l}.json`, location.href).href).concat(new URL('./demo-data/meta.json', location.href).href)
    : ['/api/auth/me', '/api/facilities', '/api/categories', '/api/scenarios', '/api/map/config', '/api/events', '/api/boundaries/land', '/api/boundaries/regbez', '/api/boundaries/kreis'];
  // Gemeinden und PLZ-Gebiete (falls importiert) ebenfalls vorhalten – Ebenen, Filter und Lagemodus funktionieren dann offline
  const loaded = new Set((cfg?.boundaries || []).map((b) => b.level));
  for (const l of ['gemeinde', 'plz5', 'plz2']) {
    if (!loaded.has(l)) continue;
    urls.push(demo ? new URL(`./demo-data/boundaries-${l}.json`, location.href).href : `/api/boundaries/${l}`);
  }
  const topo = cfg?.basemaps?.find((b) => b.id === 'topografisch' && b.available);
  if (topo && !demo) {
    const g = cfg.grid;
    for (let z = 0; z <= Math.min(maxZoom, g.resolutions.length - 1); z++) {
      const span = g.resolutions[z] * g.tile_size;
      const nx = Math.ceil((g.extent[2] - g.extent[0]) / span);
      const ny = Math.ceil((g.extent[3] - g.extent[1]) / span);
      for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) urls.push(`/api/tiles/topografisch/${z}/${x}/${y}.png`);
    }
  }
  post({ type: 'warmup', urls });
}

export function clearOfflineData() {
  post({ type: 'logout' });
}
