import { SYMBOLS } from '../ui/icons.js';

const EVENT = '#C2510A';

/** Marker für betroffene Einrichtungen im Lagemodus: Ring + Nummernplakette (A = im Gebiet, B = Pufferzone). */
export function affectedMarkerSvg(color, symbol, zone, num) {
  const ring = zone === 'A'
    ? `<circle cx="17" cy="23" r="15" fill="none" stroke="${EVENT}" stroke-width="3"/>`
    : `<circle cx="17" cy="23" r="16" fill="none" stroke="${EVENT}" stroke-width="2" stroke-dasharray="3 2.5"/>`;
  const badge = zone === 'A'
    ? `<circle cx="34" cy="9" r="8.5" fill="${EVENT}" stroke="#fff" stroke-width="1.5"/><text x="34" y="12.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="800" fill="#fff">${num}</text>`
    : `<circle cx="34" cy="9" r="8.5" fill="#fff" stroke="${EVENT}" stroke-width="2"/><text x="34" y="12.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="800" fill="${EVENT}">${num}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="42" viewBox="0 0 44 42">${ring}<circle cx="17" cy="23" r="12" fill="${color}" stroke="#fff" stroke-width="2"/><g transform="translate(10.5 16.5) scale(0.54)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${SYMBOLS[symbol] || SYMBOLS.box}"/></g>${badge}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
