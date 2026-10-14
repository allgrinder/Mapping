import { describe, it, expect } from 'vitest';
import { applyFilters, isFiltered } from '../src/facilities.js';
import { pointInGeometry } from '../src/demo/geo.js';

const F = (id, o = {}) => ({
  id, name: `Einrichtung ${id}`, categoryId: 1, hazards: [], admin: { regbez: '051', kreis: '05111', plz5: '40210' },
  address: { street: 'Musterweg 1', zip: '40210', city: 'Düsseldorf' }, ...o,
});
const base = { q: '', categories: new Set([1, 2]), scenario: '', regbez: '', kreis: '', plzPrefix: '' };

describe('applyFilters', () => {
  const items = [
    F(1),
    F(2, { categoryId: 2, hazards: [3], admin: { regbez: '053', kreis: '05315', plz5: '50667' }, address: { street: 'Domplatz', zip: '50667', city: 'Köln' } }),
    F(3, { name: 'Landesarchiv', hazards: [1, 3], address: { street: '', zip: '41460', city: 'Neuss' } }),
  ];
  const ids = (f) => applyFilters(items, { ...base, ...f }).map((x) => x.id);
  it('kombiniert Filter', () => {
    expect(ids({})).toEqual([1, 2, 3]);
    expect(ids({ categories: new Set([2]) })).toEqual([2]);
    expect(ids({ categories: new Set() })).toEqual([]);
    expect(ids({ scenario: '3' })).toEqual([2, 3]);
    expect(ids({ scenario: '3', regbez: '051' })).toEqual([3]);
    expect(ids({ kreis: '05315' })).toEqual([2]);
    expect(ids({ plzPrefix: '41' })).toEqual([3]);
    expect(ids({ plzPrefix: '4' })).toEqual([1, 3]);
    expect(ids({ q: 'köln' })).toEqual([2]);
    expect(ids({ q: 'ARCHIV' })).toEqual([3]);
  });
  it('erkennt aktive Filter', () => {
    expect(isFiltered(base, [1, 2])).toBe(false);
    expect(isFiltered({ ...base, categories: new Set([1]) }, [1, 2])).toBe(true);
    expect(isFiltered({ ...base, q: '  ' }, [1, 2])).toBe(false);
    expect(isFiltered({ ...base, plzPrefix: '4' }, [1, 2])).toBe(true);
  });
});

describe('pointInGeometry (Demo)', () => {
  const poly = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  it('beachtet Löcher und MultiPolygon', () => {
    expect(pointInGeometry([1, 1], poly)).toBe(true);
    expect(pointInGeometry([5, 5], poly)).toBe(false);
    expect(pointInGeometry([11, 5], poly)).toBe(false);
    expect(pointInGeometry([21, 1], { type: 'MultiPolygon', coordinates: [poly.coordinates, [[[20, 0], [22, 0], [22, 2], [20, 2], [20, 0]]]] })).toBe(true);
  });
});
