import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Cluster from 'ol/source/Cluster.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { fromLonLat } from 'ol/proj.js';
import { Icon, Style } from 'ol/style.js';
import { SYMBOLS } from '../ui/icons.js';
import { UTM } from './projection.js';
import { affectedMarkerSvg } from './markers.js';

const iconCache = new Map();

/** Rundes Marker-Symbol als SVG-Data-URI (CSP: img-src data: ist erlaubt). */
export function markerSvg(color, symbol, { size = 30, ring = '#FFFFFF', label } = {}) {
  const icon = SYMBOLS[symbol] || SYMBOLS.box;
  const inner = label !== undefined
    ? `<text x="15" y="19.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="800" fill="#fff">${label}</text>`
    : `<g transform="translate(8 8) scale(0.5833)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${color}" stroke="${ring}" stroke-width="2.5"/>${inner}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function markerStyle(cat, selected, dim) {
  const key = `${cat?.id}|${selected}|${dim}`;
  if (!iconCache.has(key)) {
    iconCache.set(key, new Style({
      image: new Icon({ src: markerSvg(cat?.color || '#5B6472', cat?.symbol), scale: selected ? 1.25 : dim ? 0.8 : 1, opacity: dim ? 0.4 : 1 }),
      zIndex: selected ? 10 : 1,
    }));
  }
  return iconCache.get(key);
}

/** Bündel: Ring mit Anteilen der Kategorien, Anzahl in der Mitte. */
function clusterStyle(features, catById, surface, text) {
  const counts = new Map();
  for (const f of features) counts.set(f.get('categoryId'), (counts.get(f.get('categoryId')) || 0) + 1);
  const n = features.length;
  const radius = Math.min(28, 16 + Math.log2(n) * 3);
  return new Style({
    renderer(coords, state) {
      const ctx = state.context;
      const [x, y] = coords;
      const r = radius * state.pixelRatio;
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,.25)';
      ctx.shadowBlur = 8 * state.pixelRatio;
      let a = -Math.PI / 2;
      for (const [cid, c] of counts) {
        const da = (c / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, a, a + da);
        ctx.closePath();
        ctx.fillStyle = catById.get(cid)?.color || '#5B6472';
        ctx.fill();
        a += da;
      }
      ctx.shadowColor = 'transparent';
      ctx.beginPath();
      ctx.arc(x, y, r - 4 * state.pixelRatio, 0, Math.PI * 2);
      ctx.fillStyle = surface;
      ctx.fill();
      ctx.fillStyle = text;
      ctx.font = `700 ${13 * state.pixelRatio}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x, y + 0.5);
      ctx.restore();
    },
  });
}

export function createFacilityLayer(map, { categories, onSelect, colors, cluster: useCluster = true }) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const source = new VectorSource();
  const cluster = new Cluster({ source, distance: useCluster ? 44 : 0, minDistance: useCluster ? 16 : 0 });
  let highlight = null;
  const hlCache = new Map();
  let selectedId = null;
  let theme = colors();
  const layer = new VectorLayer({
    source: cluster,
    zIndex: 40,
    style: (f) => {
      const members = f.get('features');
      if (members.length === 1) {
        const m = members[0];
        const cat = catById.get(m.get('categoryId'));
        if (highlight) {
          const hl = highlight.get(m.getId());
          if (!hl) return markerStyle(cat, false, true);
          const key = `${cat?.id}|${hl.zone}|${hl.num}`;
          if (!hlCache.has(key)) hlCache.set(key, new Style({ image: new Icon({ src: affectedMarkerSvg(cat?.color || '#5B6472', cat?.symbol, hl.zone, hl.num), anchor: [17, 23], anchorXUnits: 'pixels', anchorYUnits: 'pixels' }), zIndex: hl.zone === 'A' ? 30 : 20 }));
          return hlCache.get(key);
        }
        return markerStyle(cat, m.getId() === selectedId, false);
      }
      return clusterStyle(members, catById, theme.surface, theme.text);
    },
  });
  map.addLayer(layer);

  // Bei großem Maßstab nicht mehr bündeln
  if (useCluster) map.getView().on('change:resolution', () => cluster.setDistance(map.getView().getResolution() < 8 ? 0 : 44));

  map.on('singleclick', (e) => {
    const hit = map.forEachFeatureAtPixel(e.pixel, (f, l) => (l === layer ? f : null), { hitTolerance: 4 });
    if (!hit) return;
    const members = hit.get('features');
    if (members.length === 1) onSelect(members[0].getId());
    else {
      const ext = members.reduce((acc, m) => { const [x, y] = m.getGeometry().getCoordinates(); return [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)]; }, [Infinity, Infinity, -Infinity, -Infinity]);
      map.getView().fit(ext, { padding: [120, 120, 120, 460], duration: 300, maxZoom: map.getView().getZoomForResolution(6) });
    }
  });
  map.on('pointermove', (e) => {
    const over = map.hasFeatureAtPixel(e.pixel, { layerFilter: (l) => l === layer });
    map.getTargetElement().style.cursor = over ? 'pointer' : '';
  });

  return {
    setItems(items) {
      source.clear(true);
      source.addFeatures(items.map((it) => {
        const f = new Feature({ geometry: new Point(fromLonLat([it.location.lon, it.location.lat], UTM)), categoryId: it.categoryId });
        f.setId(it.id);
        return f;
      }));
    },
    select(id) { selectedId = id; layer.changed(); },
    /** @param {Map<number,{zone:'A'|'B',num:number}>|null} m */
    setHighlight(m) { highlight = m; layer.changed(); },
    layer,
    restyle() { theme = colors(); layer.changed(); },
    centerOn(it, minRes = 40) {
      const v = map.getView();
      v.animate({ center: fromLonLat([it.location.lon, it.location.lat], UTM), resolution: Math.min(v.getResolution(), minRes), duration: 300 });
    },
  };
}
