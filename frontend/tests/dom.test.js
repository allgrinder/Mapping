import { describe, it, expect } from 'vitest';
import { h, initials, formatDateTime } from '../src/ui/dom.js';
import { RULES } from '../src/views/password.js';

describe('h()', () => {
  it('fügt Inhalte nur als Text ein (kein HTML-Parsing)', () => {
    const el = h('div', {}, '<img src=x onerror=alert(1)>');
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('setzt Styles per CSSOM statt style-Attribut-String', () => {
    const el = h('span', { style: { color: 'red' } });
    expect(el.style.getPropertyValue('color')).toBe('red');
  });
  it('lässt false/null-Kinder weg', () => {
    expect(h('p', {}, null, false, 'a', ['b', undefined]).textContent).toBe('ab');
  });
});

describe('Hilfsfunktionen', () => {
  it('initials', () => {
    expect(initials('Thomas Wirtz')).toBe('TW');
    expect(initials('selin.aydin')).toBe('SA');
    expect(initials('')).toBe('?');
  });
  it('formatDateTime wandelt UTC in lokale Anzeige', () => {
    expect(formatDateTime(null)).toBe('–');
    expect(formatDateTime('kaputt')).toBe('–');
    expect(formatDateTime('2026-10-14 07:58:00')).toMatch(/^14\.10\.2026, \d{2}:58$/);
  });
  it('Passwortregeln entsprechen der Server-Policy', () => {
    const ok = (p) => RULES.every(([, t]) => t(p));
    expect(ok('Lagezentrum-2026!')).toBe(true);
    expect(ok('kurz-A1')).toBe(false);
    expect(ok('nurkleinbuchstaben-1')).toBe(false);
    expect(ok('OhneZiffernUndZeichen')).toBe(false);
  });
});
