import GeoJSON from 'ol/format/GeoJSON.js';
import { api } from '../api.js';
import { h, svg } from '../ui/dom.js';
import { UI } from '../ui/icons.js';
import { toast } from '../ui/dialog.js';
import { filters } from './mapPage.js';
import { applyFilters } from '../facilities.js';
import { UTM } from '../map/projection.js';
import { download, fileStamp } from '../export/csv.js';

export function describeFilters(f, count, categories, scenarios, rbName, krName) {
  const cats = !f.categories || f.categories.size === categories.length ? 'alle Kategorien' : categories.filter((c) => f.categories.has(c.id)).map((c) => c.name).join(', ') || 'keine Kategorie';
  const scen = f.scenario ? `Szenario ${scenarios.find((s) => String(s.id) === String(f.scenario))?.name || ''}` : 'alle Krisenszenarien';
  const area = krName ? krName : rbName ? `Reg.-Bez. ${rbName}` : 'ganz NRW';
  return [`${count} ${count === 1 ? 'Einrichtung' : 'Einrichtungen'}`, cats, scen, area, f.plzPrefix ? `PLZ ${f.plzPrefix}…` : null, f.q?.trim() ? `Suche „${f.q.trim()}“` : null].filter(Boolean).join(' · ');
}

export async function renderPrintDialog(root, { navigate }) {
  const [cfg, cats, scens, fac] = await Promise.all([api('GET', '/map/config'), api('GET', '/categories'), api('GET', '/scenarios'), api('GET', '/facilities')]);
  const categories = cats.items.filter((c) => c.active);
  const catById = new Map(cats.items.map((c) => [c.id, c]));
  const scenById = new Map(scens.items.map((s) => [s.id, s]));
  if (!filters.categories) filters.categories = new Set(categories.map((c) => c.id));
  const items = applyFilters(fac.items, filters);

  let rbName = null, krName = null, baseExtent = null;
  const geo = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: UTM });
  if (filters.kreis || filters.regbez) {
    const level = filters.kreis ? 'kreis' : 'regbez';
    const fc = await api('GET', `/boundaries/${level}`).catch(() => null);
    const feat = fc?.features?.find((x) => x.properties.code === (filters.kreis || filters.regbez));
    if (feat) {
      const g = geo.readFeature(feat).getGeometry().getExtent();
      const pad = 0.06 * Math.max(g[2] - g[0], g[3] - g[1]);
      baseExtent = [g[0] - pad, g[1] - pad, g[2] + pad, g[3] + pad];
      level === 'kreis' ? (krName = feat.properties.name) : (rbName = feat.properties.name);
    }
  }
  const filterText = describeFilters(filters, items.length, categories, scens.items, rbName, krName);
  const topoOk = cfg.basemaps.some((b) => b.id === 'topografisch' && b.available);
  const o = { format: 'A2', overlapMm: 10, marks: true, index: true, contacts: true, basemap: topoOk ? 'topografisch' : 'politisch', title: 'Krisenrelevante Einrichtungen in Nordrhein-Westfalen' };

  const sw = (key, label) => {
    const b = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(o[key]), 'aria-label': label });
    b.addEventListener('click', () => { o[key] = !o[key]; b.setAttribute('aria-checked', String(o[key])); paint(); });
    return b;
  };
  const optRow = (title, sub, control) => h('div', { class: 'optrow' }, h('div', { style: { flex: '1' } }, h('div', { class: 'opt-t' }, title), h('div', { class: 'cap' }, sub)), control);
  const fmtBtn = (fmt, icon, title, sub) => {
    const b = h('button', { class: 'fmt', type: 'button', 'aria-pressed': String(o.format === fmt) }, icon, h('span', {}, h('span', { class: 'fmt-t' }, title), h('span', { class: 'cap' }, sub)));
    b.addEventListener('click', () => { o.format = fmt; paint(); });
    return b;
  };
  const a2Icon = h('span', { class: 'fmt-ico a2' }, h('span'), h('span'));
  const a4Icon = h('span', { class: 'fmt-ico a4' }, ...Array.from({ length: 6 }, () => h('span')));
  const fmtA2 = fmtBtn('A2', a2Icon, 'DIN A2', 'Ein Blatt, 594 × 420 mm');
  const fmtA4 = fmtBtn('A4', a4Icon, 'DIN A4 gestückelt', '6 Blätter, zum Zusammenkleben');

  const overlap = h('select', { class: 'input', 'aria-label': 'Überlappungsrand' }, [5, 10, 15, 20].map((v) => h('option', { value: v, selected: v === o.overlapMm }, `${v} mm`)));
  overlap.addEventListener('change', () => { o.overlapMm = Number(overlap.value); paint(); });
  const a4Opts = h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '4px' } }, 'Stückelung'),
    optRow('Überlappungsrand', 'Bereich, der auf beiden Nachbarblättern gedruckt wird', h('div', { class: 'selw', style: { width: '100px' } }, overlap, svg(UI.down, { size: 14, stroke: 2.4 }))),
    optRow('Passermarken', 'Kreuze in den Ecken zum exakten Anlegen', sw('marks', 'Passermarken')),
    optRow('Blattschnittübersicht', 'Deckblatt mit Lage aller Blätter', sw('index', 'Blattschnittübersicht')));
  const bg = h('select', { class: 'input', 'aria-label': 'Hintergrund' },
    h('option', { value: 'topografisch', selected: o.basemap === 'topografisch', disabled: !topoOk }, topoOk ? 'Topografisch' : 'Topografisch (nicht verfügbar)'),
    h('option', { value: 'politisch', selected: o.basemap === 'politisch' }, 'Politisch'));
  bg.addEventListener('change', () => { o.basemap = bg.value; });
  const title = h('input', { id: 'pt', class: 'input', value: o.title, maxlength: 120 });
  title.addEventListener('input', () => { o.title = title.value; });
  const contactHint = h('div', { class: 'cap' });

  const preview = h('div', { class: 'preview-stage' });
  const pagesLabel = h('div', { class: 'cap', style: { 'font-size': '13px', 'font-weight': '600' } });
  const progress = h('div', { class: 'cap print-progress', role: 'status' });

  function paint() {
    fmtA2.setAttribute('aria-pressed', String(o.format === 'A2'));
    fmtA4.setAttribute('aria-pressed', String(o.format === 'A4'));
    a4Opts.hidden = o.format !== 'A4';
    const contactPages = o.contacts ? Math.max(1, Math.ceil(items.length / 18)) : 0;
    contactHint.textContent = o.format === 'A2' ? 'Rechts neben der Karte, bei vielen Einträgen auf Folgeseiten' : 'Auf Folgeseiten im Format A4';
    if (o.format === 'A2') {
      const extra = o.contacts && items.length > 40 ? Math.ceil((items.length - 40) / 18) : 0;
      pagesLabel.textContent = `1 Blatt DIN A2${extra ? ` + ${extra} Seite(n) A4` : ''}`;
      preview.replaceChildren(h('div', { class: 'paper paper-a2' },
        h('div', { class: 'pv-map' }, h('div', { class: 'pv-title' }, o.title), h('div', { class: 'pv-frame' }, h('span', { class: 'pv-n' }, 'N'), h('span', { class: 'pv-legend' })), h('div', { class: 'pv-foot' }, 'Stand · Quellen')),
        o.contacts ? h('div', { class: 'pv-contacts' }, h('div', { class: 'pv-ct' }, 'Kontaktverzeichnis'), ...Array.from({ length: 22 }, (_, i) => h('div', { class: 'pv-line', style: { width: `${60 + ((i * 37) % 35)}%` } }))) : null));
    } else {
      const total = (o.index ? 1 : 0) + 6 + contactPages;
      pagesLabel.textContent = `${total} Seiten DIN A4`;
      const ovPct = (o.overlapMm / 180) * 100;
      preview.replaceChildren(h('div', { class: 'pv-a4' },
        h('div', { class: 'paper paper-mosaic' },
          ...['A1', 'B1', 'C1', 'A2', 'B2', 'C2'].map((id) => h('div', { class: 'pv-tile' }, h('span', {}, id))),
          h('div', { class: 'pv-band v', style: { left: `calc(33.333% - ${ovPct / 2}%)`, width: `${ovPct}%` } }),
          h('div', { class: 'pv-band v', style: { left: `calc(66.667% - ${ovPct / 2}%)`, width: `${ovPct}%` } }),
          h('div', { class: 'pv-band hz', style: { top: `calc(50% - ${ovPct / 2}%)`, height: `${ovPct}%` } })),
        h('div', { class: 'pv-thumbs' }, ...(o.index ? [['Übersicht', 'land']] : []).concat(['A1', 'B1', 'C1', 'A2', 'B2', 'C2'].map((id) => [id, 'port'])).concat(contactPages ? [['Kontakte', 'port']] : [])
          .map(([label, kind]) => h('div', { class: 'pv-thumb' }, h('div', { class: `paper ${kind}` }), h('span', {}, label))))));
    }
  }

  async function generate(mode) {
    if (!items.length && !(await Promise.resolve(true))) return;
    btnPdf.disabled = btnPrint.disabled = true;
    try {
      const { buildPrintPdf } = await import('../print/printPdf.js');
      const doc = await buildPrintPdf({ items, categories, catById, scenById, filterText, cfg, opts: { ...o, title: o.title.trim() || 'Krisenrelevante Einrichtungen in NRW' }, baseExtent, onProgress: (t) => { progress.textContent = t; } });
      const name = `KRITIS-Lagekarte_${o.format === 'A2' ? 'A2' : 'A4-gestueckelt'}_${fileStamp()}.pdf`;
      if (mode === 'download') download(name, doc.output('blob'), 'application/pdf');
      else {
        const url = URL.createObjectURL(doc.output('blob'));
        const w = window.open(url, '_blank');
        if (!w) download(name, doc.output('blob'), 'application/pdf');
      }
      progress.textContent = 'Fertig.';
    } catch (e) {
      console.error(e);
      toast(progress, 'Die Druckausgabe konnte nicht erstellt werden.', 'err');
    } finally { btnPdf.disabled = btnPrint.disabled = false; }
  }
  const btnPdf = h('button', { class: 'btn btn-secondary', type: 'button', onClick: () => generate('download') }, svg(UI.download, { size: 16 }), 'PDF');
  const btnPrint = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => generate('print') }, svg(UI.print, { size: 16 }), 'Drucken');

  root.replaceChildren(h('div', { class: 'print-page' },
    h('div', { class: 'print-scrim', 'aria-hidden': 'true' }),
    h('div', { class: 'glass rise print-dialog', role: 'dialog', 'aria-label': 'Drucken' },
      h('div', { class: 'print-left' },
        h('div', { class: 'print-head' }, h('h1', {}, 'Drucken')),
        h('div', { class: 'print-scroll' },
          h('div', { class: 'print-info' }, svg(UI.alert, { size: 16 }), h('div', {}, h('strong', {}, 'Gedruckt wird der aktuell gefilterte Bestand: '), filterText)),
          h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '10px' } }, 'Format'), h('div', { class: 'fmt-grid' }, fmtA2, fmtA4)),
          a4Opts,
          h('div', {}, h('div', { class: 'sec', style: { 'margin-bottom': '4px' } }, 'Inhalt'),
            h('div', { class: 'optrow' }, h('div', { style: { flex: '1' } }, h('div', { class: 'opt-t' }, 'Kontaktverzeichnis'), contactHint), sw('contacts', 'Kontaktverzeichnis')),
            optRow('Hintergrund', 'Topografisch druckt Relief und Gewässer', h('div', { class: 'selw', style: { width: '170px' } }, bg, svg(UI.down, { size: 14, stroke: 2.4 })))),
          h('div', {}, h('label', { class: 'lbl', for: 'pt' }, 'Titel'), title,
            h('div', { class: 'cap', style: { 'margin-top': '6px' } }, 'Legende, Maßstab, Nordpfeil, Stand-Datum und Quellenangaben werden immer gedruckt.')),
          progress),
        h('div', { class: 'print-foot' },
          h('a', { class: 'btn btn-secondary', href: '#/karte' }, 'Abbrechen'), h('span', { style: { flex: '1' } }), btnPdf, btnPrint)),
      h('div', { class: 'print-right' },
        h('div', { class: 'print-rhead' }, h('div', { class: 'sec' }, 'Vorschau'), pagesLabel),
        preview))));
  paint();
}
