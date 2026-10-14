// Pfade aus dem UI-Design (Administration / Komponenten). Symbol-Schlüssel müssen mit
// MasterDataController::SYMBOLS im Backend übereinstimmen.
export const SYMBOLS = {
  cap: 'M2 9.5 12 5l10 4.5L12 14 2 9.5Z M6 11.5V16c3.5 2.5 8.5 2.5 12 0v-4.5',
  cross: 'M12 5v14M5 12h14',
  flask: 'M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3 M7.5 15h9',
  box: 'M3 4h18v5H3z M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4',
  building: 'M4 21V7l8-4 8 4v14 M9 21v-5h6v5 M8 10h.01M12 10h.01M16 10h.01',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z M9.5 12l2 2 3.5-4',
  wave: 'M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M12 3v7M9 7l3 3 3-3',
  rain: 'M7 14a4 4 0 1 1 1.5-7.7A5 5 0 0 1 18 8a3 3 0 0 1 0 6H7Z M9 17l-1.5 3M13 17l-1.5 3M17 17l-1.5 3',
  fire: 'M12 21c-3.9 0-6-2.6-6-5.6 0-3.4 3-5.4 3.6-9.4 2 1.2 3.2 3 3.4 5 1-.6 1.6-1.6 1.8-2.8 1.6 1.6 3.2 4 3.2 7.2 0 3-2.1 5.6-6 5.6Z',
  wind: 'M3 8h11a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h8',
  power: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  hazard: 'M12 3 2 20h20L12 3Z M12 10v4M12 17v.5',
};

export const SYMBOL_LABELS = {
  cap: 'Doktorhut', cross: 'Kreuz', flask: 'Kolben', box: 'Archivbox', building: 'Gebäude', shield: 'Schild',
  wave: 'Hochwasser', rain: 'Regen', fire: 'Flamme', wind: 'Wind', power: 'Blitz', hazard: 'Warndreieck',
};

export const CATEGORY_SYMBOLS = ['cap', 'cross', 'flask', 'box', 'building', 'shield'];
export const SCENARIO_SYMBOLS = ['wave', 'rain', 'fire', 'wind', 'power', 'hazard', 'shield'];

// Farbpalette aus dem Design (Administration).
export const PALETTE = [
  ['#2F6FDE', 'Blau'], ['#1F7A8C', 'Petrol'], ['#1E7F46', 'Grün'], ['#A16207', 'Ocker'], ['#A8620A', 'Bernstein'],
  ['#C2410C', 'Orange'], ['#D0364F', 'Rot'], ['#7A4BD6', 'Violett'], ['#334155', 'Schiefer'], ['#5B6472', 'Grau'],
];

export const UI = {
  pin: ['M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z', { tag: 'circle', cx: 12, cy: 9.5, r: 2.5 }],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z', { tag: 'circle', cx: 12, cy: 12, r: 3 }],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  alert: [{ tag: 'circle', cx: 12, cy: 12, r: 9 }, 'M12 7v6M12 16.5v.5'],
  check: 'm5 12 5 5 9-10',
  back: 'm15 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  users: [{ tag: 'circle', cx: 9, cy: 8, r: 3.5 }, 'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5', 'M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.5 3 5.2'],
  grid: [{ tag: 'circle', cx: 7, cy: 7, r: 3 }, { tag: 'circle', cx: 17, cy: 7, r: 3 }, { tag: 'circle', cx: 7, cy: 17, r: 3 }, { tag: 'circle', cx: 17, cy: 17, r: 3 }],
  triangle: ['M12 3 2 20h20L12 3Z', 'M12 10v4M12 17v.5'],
  logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l-5-5 5-5M5 12h11'],
  settings: [{ tag: 'circle', cx: 12, cy: 12, r: 3 }, 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
  key: [{ tag: 'circle', cx: 8, cy: 15, r: 4 }, 'M10.8 12.2 20 3M16 7l3 3M14 9l2 2'],
};

Object.assign(UI, {
  search: [{ tag: 'circle', cx: 11, cy: 11, r: 7 }, 'm20 20-3.5-3.5'],
  layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 13 9 5 9-5'],
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  print: ['M7 9V3h10v6', { tag: 'rect', x: 3, y: 9, width: 18, height: 8, rx: 2 }, 'M7 14h10v7H7z'],
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  sun: [{ tag: 'circle', cx: 12, cy: 12, r: 4 }, 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  situation: ['M4 7 12 3l8 4v10l-8 4-8-4V7Z', { tag: 'circle', cx: 12, cy: 12, r: 2.5 }],
  right: 'm9 6 6 6-6 6',
  userAdmin: [{ tag: 'circle', cx: 9, cy: 8, r: 3.5 }, 'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5', 'M17 8.5h5M19.5 6v5'],
});

Object.assign(UI, {
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  mail: [{ tag: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 }, 'm3 7 9 6 9-6'],
  locate: [{ tag: 'circle', cx: 12, cy: 12, r: 3 }, 'M12 2v3M12 19v3M2 12h3M19 12h3'],
  trash: ['M4 7h16M10 11v6M14 11v6', 'M6 7l1 13h10l1-13M9 7V4h6v3'],
});

Object.assign(UI, {
  polygon: 'M4 7 12 3l8 4v10l-8 4-8-4V7Z',
  radius: [{ tag: 'circle', cx: 12, cy: 12, r: 9 }, 'M12 12h9'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
});
