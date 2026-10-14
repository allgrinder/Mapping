// Rendert die Kartengrundlage unsichtbar in Druckauflösung (immer helle Druckfarben, ohne Einrichtungspunkte –
// die werden als Vektoren ins PDF gezeichnet).
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import TileImage from 'ol/source/TileImage.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import { api } from '../api.js';
import { UTM, utmProjection } from '../map/projection.js';

export const PRINT_COLORS = {
  land: '#F6F6F2', landLine: '#3A414B', rbLine: '#59626E', kreisLine: '#A3AAB5', label: '#2B3038', outside: '#ECEFF2',
  rb: { '051': '#E8EEF6', '053': '#F6EEE7', '055': '#EAF2E6', '057': '#F0EBF5', '059': '#F6F1E3' },
};

const geojson = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: UTM });
const cache = {};
async function features(level) {
  cache[level] ??= api('GET', `/boundaries/${level}`).then((fc) => fc).catch(() => ({ type: 'FeatureCollection', features: [] }));
  return geojson.readFeatures(await cache[level]);
}

/**
 * @param {{cfg:object, extent:number[], widthPx:number, heightPx:number, basemap:'politisch'|'topografisch', labelScale?:number, kreise?:boolean}} o
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPrintMap({ cfg, extent, widthPx, heightPx, basemap, labelScale = 1, kreise = false }) {
  const c = PRINT_COLORS;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${widthPx}px`, height: `${heightPx}px` });
  document.body.append(host);
  const [land, rb, kr] = await Promise.all([features('land'), features('regbez'), kreise ? features('kreis') : Promise.resolve([])]);
  const vec = (feats, style, z) => new VectorLayer({ source: new VectorSource({ features: feats }), style, zIndex: z, declutter: z >= 20 });
  const layers = [vec(land.map((f) => f.clone()), new Style({ fill: new Fill({ color: c.land }) }), 1)];
  if (basemap === 'topografisch' && cfg.basemaps.find((b) => b.id === 'topografisch')?.available) {
    const g = cfg.grid;
    layers.push(new TileLayer({ zIndex: 3, source: new TileImage({ projection: utmProjection(g.extent), tileGrid: new TileGrid({ origin: g.origin, resolutions: g.resolutions, tileSize: g.tile_size, extent: g.extent }), tileUrlFunction: (tc) => `/api/tiles/topografisch/${tc[0]}/${tc[1]}/${tc[2]}.png`, transition: 0, crossOrigin: null }) }));
  } else {
    layers.push(vec(rb.map((f) => f.clone()), (f) => new Style({ fill: new Fill({ color: c.rb[f.get('code')] || c.land }) }), 2));
  }
  if (kreise) layers.push(vec(kr, new Style({ stroke: new Stroke({ color: c.kreisLine, width: 0.8 * labelScale, lineDash: [2 * labelScale, 3 * labelScale] }) }), 18));
  layers.push(vec(rb, (f) => new Style({
    stroke: new Stroke({ color: c.rbLine, width: 1.6 * labelScale, lineDash: [9 * labelScale, 6 * labelScale], lineCap: 'round' }),
    text: new Text({ text: `REG.-BEZ. ${String(f.get('name')).toUpperCase()}`, font: `700 ${Math.round(12 * labelScale)}px Helvetica, Arial, sans-serif`, fill: new Fill({ color: c.rbLine }), stroke: new Stroke({ color: c.land, width: 3 * labelScale }), overflow: true }),
  }), 20));
  layers.push(vec(land, new Style({ stroke: new Stroke({ color: c.landLine, width: 2 * labelScale }) }), 30));

  const map = new Map({ target: host, layers, controls: [], interactions: [], pixelRatio: 1, view: new View({ projection: utmProjection(cfg.grid.extent) }) });
  map.setSize([widthPx, heightPx]);
  map.getView().fit(extent, { size: [widthPx, heightPx], nearest: false });

  const canvas = await new Promise((resolve) => {
    const finish = () => {
      const out = document.createElement('canvas');
      out.width = widthPx; out.height = heightPx;
      const ctx = out.getContext('2d');
      ctx.fillStyle = c.outside;
      ctx.fillRect(0, 0, widthPx, heightPx);
      host.querySelectorAll('.ol-layer canvas, canvas.ol-layer').forEach((cv) => {
        if (!cv.width) return;
        const m = cv.style.transform.match(/^matrix\(([^(]*)\)$/);
        ctx.setTransform(...(m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]));
        ctx.globalAlpha = Number(cv.parentNode.style.opacity || 1);
        ctx.drawImage(cv, 0, 0);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      resolve(out);
    };
    let done = false;
    map.once('rendercomplete', () => { if (!done) { done = true; finish(); } });
    setTimeout(() => { if (!done) { done = true; finish(); } }, 20000);
    map.renderSync();
  });
  const res = map.getView().getResolution();
  const center = map.getView().getCenter();
  map.setTarget(null);
  host.remove();
  // tatsächlicher Kartenausschnitt (Breite/Höhe in Metern), damit Punkte und Maßstab exakt passen
  const ext = [center[0] - (widthPx / 2) * res, center[1] - (heightPx / 2) * res, center[0] + (widthPx / 2) * res, center[1] + (heightPx / 2) * res];
  return { canvas, extent: ext, resolution: res };
}
