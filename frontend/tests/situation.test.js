import { describe, it, expect } from 'vitest';
import { groupResult, summaryText } from '../src/situation/groups.js';

const f = (id, atRisk = null) => ({ id, name: 'E' + id, atRisk });

describe('Lagemodus-Gliederung', () => {
  it('ohne Szenario: Gebiet und Puffer, fortlaufend nummeriert', () => {
    const r = { scenario: null, buffer: {}, inArea: [f(1), f(2)], inBuffer: [f(3)] };
    const g = groupResult(r);
    expect(g.groups.map((x) => x.key)).toEqual(['A', 'B']);
    expect(g.items.map((x) => [x.f.id, x.num, x.zone, x.muted])).toEqual([[1, 1, 'A', false], [2, 2, 'A', false], [3, 3, 'B', false]]);
    expect(summaryText(r)).toBe('2 im Gebiet · 1 in Pufferzone');
  });

  it('mit Szenario: Gefährdete zuerst, übrige grau dahinter', () => {
    const r = { scenario: { id: 1, name: 'Hochwasser', areaWide: false }, buffer: {}, inArea: [f(1, true), f(2, false)], inBuffer: [f(3, false), f(4, true)] };
    const g = groupResult(r);
    expect(g.groups.map((x) => [x.key, x.items.map((i) => i.f.id)])).toEqual([['RA', [1]], ['RB', [4]], ['O', [2, 3]]]);
    expect(g.items.map((x) => [x.f.id, x.num, x.zone, x.muted])).toEqual([[1, 1, 'A', false], [4, 2, 'B', false], [2, 3, 'A', true], [3, 4, 'B', true]]);
    expect(summaryText(r)).toBe('Hochwasser: 2 gefährdet · 2 weitere im Gebiet');
  });

  it('flächiges Szenario: keine Gruppe „weitere“', () => {
    const r = { scenario: { id: 5, name: 'Stromausfall', areaWide: true }, buffer: null, inArea: [f(1, true), f(2, true)], inBuffer: [] };
    const g = groupResult(r);
    expect(g.groups.map((x) => x.key)).toEqual(['RA']);
    expect(g.atRisk).toBe(2);
    expect(summaryText(r)).toBe('Stromausfall: 2 gefährdet');
  });
});
