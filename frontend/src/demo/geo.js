// Geometrie-Hilfen für die Demo (Point-in-Polygon über GeoJSON in WGS84).
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt, g) {
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((rings) => pointInRing(pt, rings[0]) && !rings.slice(1).some((h) => pointInRing(pt, h)));
}

export function findContaining(pt, fc) {
  return fc?.features?.find((f) => pointInGeometry(pt, f.geometry)) || null;
}
