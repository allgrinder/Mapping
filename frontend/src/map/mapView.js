import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import TileImage from 'ol/source/TileImage.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import { api } from '../api.js';
import { UTM, utmProjection } from './projection.js';
import * as S from './styles.js';

// Maßstab 1:100.000 bei ~0,28 mm Pixelgröße (OGC) → ca. 28 m/Pixel
const RES_1_100000 = 28;

/** Fachliche Ebenen (zuschaltbar), Reihenfolge = Zeichenreihenfolge. */
export const OVERLAYS = [
  { id: 'regbez', label: 'Grenzen der Regierungsbezirke', sub: 'Amtliche Verwaltungsgrenzen', on: true },
  { id: 'kreis', label: 'Kreisgrenzen', sub: 'Kreise und kreisfreie Städte', on: false },
  { id: 'plz2', label: 'PLZ-Gebiete (2-stellig)', sub: 'Leitregionen', on: false },
  { id: 'plz5', label: 'PLZ-Gebiete (5-stellig)', sub: 'Sichtbar ab Maßstab 1:100.000', on: false, maxResolution: RES_1_100000 },
  { id: 'flood', label: 'Hochwassergefahrenkarten', sub: 'HQhäufig, HQ100, HQextrem (LANUK NRW)', on: false, service: true },
  { id: 'warn', label: 'Live-Warnungen', sub: 'MoWaS und DWD', on: true, service: true },
];

const warnStyle = new Style({ fill: new Fill({ color: 'rgba(234,120,20,.2)' }), stroke: new Stroke({ color: '#E07812', width: 1.5, lineDash: [6, 4] }) });

export async function createMap(target, cfg, { onScale, fitPadding } = {}) {
  const projection = utmProjection(cfg.grid.extent);
  const geojson = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: UTM });
  const loaded = new Set(cfg.boundaries.map((b) => b.level));
  const boundaryCache = {};

  const vector = (level, style, opts = {}) => {
    const source = new VectorSource({
      loader: async (extent, res, proj, success, failure) => {
        try {
          const fc = await api('GET', `/boundaries/${level}`);
          const feats = geojson.readFeatures(fc);
          source.addFeatures(feats);
          success(feats);
        } catch { failure(); }
      },
    });
    return new VectorLayer({ source, style, declutter: opts.declutter ?? false, updateWhileInteracting: false, ...opts });
  };

  let c = S.themeColors();
  const layers = {
    landFill: vector('land', S.landFillStyle(c), { zIndex: 1 }),
    politisch: vector('regbez', S.politicalStyle(c), { zIndex: 2 }),
    topografisch: null,
    regbez: vector('regbez', S.regbezStyle(c), { zIndex: 20, declutter: true }),
    kreis: vector('kreis', S.kreisStyle(c), { zIndex: 19, declutter: true, visible: false }),
    plz2: vector('plz2', S.plz2Style(c), { zIndex: 18, declutter: true, visible: false }),
    plz5: vector('plz5', S.plz5Style(c), { zIndex: 17, declutter: true, visible: false, maxResolution: RES_1_100000 }),
    land: vector('land', S.landStyle(c), { zIndex: 30 }),
  };

  layers.warn = new VectorLayer({ source: new VectorSource(), style: warnStyle, zIndex: 25 });
  if (cfg.overlays?.flood) {
    layers.flood = new ImageLayer({
      zIndex: 15, visible: false, opacity: 0.75,
      source: new ImageWMS({
        url: '/api/wms/hochwasser', params: {}, projection, ratio: 1.2,
        imageLoadFunction: (image, src) => {
          const u = new URL(src, location.href);
          image.getImage().src = `/api/wms/hochwasser?bbox=${u.searchParams.get('BBOX')}&width=${u.searchParams.get('WIDTH')}&height=${u.searchParams.get('HEIGHT')}`;
        },
      }),
    });
  }
  const topo = cfg.basemaps.find((b) => b.id === 'topografisch' && b.type === 'tiles');
  if (topo) {
    const g = cfg.grid;
    layers.topografisch = new TileLayer({
      zIndex: 3,
      visible: false,
      source: new TileImage({
        projection,
        tileGrid: new TileGrid({ origin: g.origin, resolutions: g.resolutions, tileSize: g.tile_size, extent: g.extent }),
        tileUrlFunction: (tc) => `/api/tiles/topografisch/${tc[0]}/${tc[1]}/${tc[2]}.png`,
        transition: 0,
      }),
    });
  }

  const view = new View({
    projection,
    extent: cfg.viewExtent,
    constrainOnlyCenter: false,
    showFullExtent: true,
    resolutions: [...cfg.grid.resolutions, 0.286102294921875, 0.1430511474609375],
    constrainResolution: false,
  });

  const scale = new ScaleLine({ units: 'metric', bar: false, minWidth: 90 });
  const map = new Map({
    target,
    layers: Object.values(layers).filter(Boolean),
    view,
    controls: [scale],
    interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
  });

  const fitNrw = (duration = 0) => {
    const size = map.getSize();
    if (!size) return;
    const leftPad = target.getBoundingClientRect().width > 900 ? 404 : 16;
    view.fit([280000, 5570000, 540000, 5830000], { padding: fitPadding || [24, 96, 24, leftPad], duration });
  };
  map.once('change:size', () => fitNrw());
  fitNrw();
  map.on('moveend', () => onScale?.(view.getResolution()));

  return {
    map,
    view,
    loaded,
    fitNrw,
    zoomBy: (d) => view.animate({ zoom: view.getZoom() + d, duration: 200 }),
    setBasemap(id) {
      layers.politisch.setVisible(id === 'politisch');
      layers.topografisch?.setVisible(id === 'topografisch');
    },
    setOverlay(id, on) { layers[id]?.setVisible(on); },
    /** Warngebiete (GeoJSON WGS84) anzeigen */
    setWarnings(list) {
      const src = layers.warn.getSource();
      src.clear();
      src.addFeatures((list || []).filter((w) => w.geometry).map((w) => { const f = geojson.readFeature({ type: 'Feature', geometry: w.geometry, properties: { title: w.title } }); f.setId(w.id); return f; }));
    },
    /** Nach Themewechsel neu einfärben (Canvas kennt keine CSS-Variablen). */
    restyle() {
      c = S.themeColors();
      layers.landFill.setStyle(S.landFillStyle(c));
      layers.politisch.setStyle(S.politicalStyle(c));
      layers.regbez.setStyle(S.regbezStyle(c));
      layers.kreis.setStyle(S.kreisStyle(c));
      layers.plz2.setStyle(S.plz2Style(c));
      layers.plz5.setStyle(S.plz5Style(c));
      layers.land.setStyle(S.landStyle(c));
    },
    async zoomToBoundary(level, code) {
      boundaryCache[level] ??= api('GET', `/boundaries/${level}`).then((fc) => geojson.readFeatures(fc));
      const f = (await boundaryCache[level]).find((x) => x.get('code') === code);
      if (f) view.fit(f.getGeometry().getExtent(), { padding: [48, 96, 48, 404], duration: 300 });
    },
    destroy() { map.setTarget(null); },
  };
}
