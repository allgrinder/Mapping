// Minimaler DOM-Baukasten. Inhalte werden ausschließlich als Text-Knoten eingefügt (kein innerHTML → kein XSS).
// Inline-Styles werden per CSSOM gesetzt; das ist mit der CSP (style-src 'self') verträglich.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function svg(paths, { size = 18, stroke = 2, label } = {}) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', stroke);
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  for (const d of [].concat(paths)) {
    if (typeof d === 'string') {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.append(p);
    } else {
      const c = document.createElementNS(SVG_NS, d.tag);
      for (const [k, v] of Object.entries(d)) if (k !== 'tag') c.setAttribute(k, v);
      s.append(c);
    }
  }
  return s;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Initialen aus Anzeigename oder Benutzername. */
export function initials(name) {
  return String(name || '?').split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/** UTC-Zeitstempel „YYYY-MM-DD HH:MM:SS“ → „14.10.2026, 07:58“ (lokale Zeit). */
export function formatDateTime(utc) {
  if (!utc) return '–';
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
