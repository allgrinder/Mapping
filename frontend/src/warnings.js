// Live-Warnlage im Client: Abruf (periodisch), Verschneidung mit dem Bestand.
import { api } from './api.js';
import { pointInGeometry } from './demo/geo.js';

export const WBI_COLORS = ['#9AA3AF', '#FFE08A', '#F6B94B', '#EE7D2E', '#D6302A', '#8E1B1B'];
export const KIND = { mowas: 'Bevölkerungswarnung', dwd: 'Unwetterwarnung' };

export async function fetchWarnings() {
  return api('GET', '/warnings');
}

/** @returns {Map<number, Array<{id:string,title:string,source:string}>>} betroffene Einrichtungen → Warnungen */
export function affected(facilities, data) {
  const out = new Map();
  for (const w of data?.warnings || []) {
    if (!w.geometry) continue;
    for (const f of facilities) {
      if (pointInGeometry([f.location.lon, f.location.lat], w.geometry)) {
        if (!out.has(f.id)) out.set(f.id, []);
        out.get(f.id).push({ id: w.id, title: w.title, source: w.source });
      }
    }
  }
  return out;
}

export function countBySource(data) {
  const c = { mowas: 0, dwd: 0 };
  for (const w of data?.warnings || []) c[w.source] = (c[w.source] || 0) + 1;
  return c;
}

/** Startet den periodischen Abruf; ruft cb(data) bei jedem Ergebnis (auch bei Fehlern mit data=null). */
export function startPolling(cb, intervalS = 300) {
  let stopped = false;
  let timer;
  const tick = async () => {
    try { cb(await fetchWarnings(), null); } catch (e) { cb(null, e); }
    if (!stopped) timer = setTimeout(tick, Math.max(60, intervalS) * 1000);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export function fmtTime(utc) {
  if (!utc) return '–';
  return new Date(String(utc).replace(' ', 'T') + 'Z').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
