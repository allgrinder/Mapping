import { Fill, Stroke, Style, Text } from 'ol/style.js';

// Farben werden aus den CSS-Variablen des aktuellen Themes gelesen (hell/dunkel).
export function themeColors() {
  const cs = getComputedStyle(document.getElementById('app'));
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    land: v('--land'), landLine: v('--land-line'), rbLine: v('--rb-line'), kreisLine: v('--kreis-line'),
    label: v('--label'), accent: v('--accent'), surface: v('--surface'), text3: v('--text-3'),
    rb: { '051': v('--rb-051'), '053': v('--rb-053'), '055': v('--rb-055'), '057': v('--rb-057'), '059': v('--rb-059') },
  };
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export function politicalStyle(c) {
  const cache = {};
  return (f) => {
    const code = f.get('code');
    return (cache[code] ??= new Style({ fill: new Fill({ color: c.rb[code] || c.land }) }));
  };
}

export function landStyle(c) {
  return new Style({ stroke: new Stroke({ color: c.landLine, width: 2 }) });
}

export function landFillStyle(c) {
  return new Style({ fill: new Fill({ color: c.land }) });
}

export function regbezStyle(c) {
  const line = new Stroke({ color: c.rbLine, width: 1.6, lineDash: [8, 5], lineCap: 'round' });
  return (f, res) => new Style({
    stroke: line,
    text: res < 900 ? new Text({
      text: String(f.get('name') || '').toUpperCase(),
      font: `700 11px ${FONT}`, fill: new Fill({ color: c.rbLine }),
      stroke: new Stroke({ color: c.land, width: 3 }), overflow: true,
    }) : undefined,
  });
}

export function kreisStyle(c) {
  const line = new Stroke({ color: c.kreisLine, width: 1.1, lineDash: [2, 4], lineCap: 'round' });
  return (f, res) => new Style({
    stroke: line,
    text: res < 160 ? new Text({ text: f.get('name'), font: `500 12px ${FONT}`, fill: new Fill({ color: c.label }), stroke: new Stroke({ color: c.land, width: 3 }) }) : undefined,
  });
}

export function plz2Style(c) {
  const line = new Stroke({ color: c.accent, width: 1.2 });
  return (f) => new Style({
    stroke: line,
    text: new Text({ text: f.get('code'), font: `700 22px ${FONT}`, fill: new Fill({ color: withAlpha(c.accent, 0.6) }), overflow: true }),
  });
}

export function plz5Style(c) {
  const line = new Stroke({ color: withAlpha(c.accent, 0.7), width: 0.8 });
  return (f) => new Style({
    stroke: line,
    text: new Text({ text: f.get('code'), font: `600 12px ${FONT}`, fill: new Fill({ color: c.accent }), stroke: new Stroke({ color: c.land, width: 3 }) }),
  });
}

function withAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
