import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection } from 'ol/proj.js';

// ETRS89 / UTM 32N – Bezugssystem der amtlichen NRW-Dienste
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
register(proj4);

export const UTM = 'EPSG:25832';
export function utmProjection(extent) {
  const p = getProjection(UTM);
  p.setExtent(extent);
  return p;
}
