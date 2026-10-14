// Druckausgabe als PDF: DIN A2 quer (ein Blatt) oder DIN A4 gestückelt (Blattschnittübersicht, Überlappung, Passermarken).
// Kartengrundlage als Rasterbild (150 dpi), Punkte, Legende, Maßstab, Nordpfeil als Vektoren.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { fromLonLat } from 'ol/proj.js';
import { UTM } from '../map/projection.js';
import { renderPrintMap, PRINT_COLORS } from './printMap.js';
import { formatAddress } from '../facilities.js';

const DPI = 150;
const px = (mm) => Math.round((mm / 25.4) * DPI);
const INK = [17, 19, 24];
const MUTED = [63, 70, 81];
const BLUE = [10, 79, 168];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const NRW = [280000, 5570000, 540000, 5830000];

export const A4 = { cols: 3, rows: 2, mapW: 180, mapH: 244 };

/** Nummerierung von Nord nach Süd (bei gleicher Breite West nach Ost). */
export function numberFacilities(items) {
  return [...items].sort((a, b) => b.location.lat - a.location.lat || a.location.lon - b.location.lon).map((f, i) => ({ f, n: i + 1, xy: fromLonLat([f.location.lon, f.location.lat], UTM) }));
}

/** Ausdehnung: gewähltes Gebiet bzw. Bestand mit Rand, sonst ganz NRW. Ergebnis hat das Seitenverhältnis des Kartenfelds. */
export function printExtent(numbered, aspect, base = null) {
  let e = base;
  if (!e) {
    if (!numbered.length) e = NRW;
    else {
      e = numbered.reduce((a, { xy }) => [Math.min(a[0], xy[0]), Math.min(a[1], xy[1]), Math.max(a[2], xy[0]), Math.max(a[3], xy[1])], [Infinity, Infinity, -Infinity, -Infinity]);
      const pad = Math.max(8000, 0.12 * Math.max(e[2] - e[0], e[3] - e[1]));
      e = [e[0] - pad, e[1] - pad, e[2] + pad, e[3] + pad];
    }
  }
  const cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2;
  let w = e[2] - e[0], h = e[3] - e[1];
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

function niceScale(denom) {
  const step = denom > 200000 ? 5000 : denom > 20000 ? 1000 : 100;
  return Math.round(denom / step) * step;
}

function scaleBar(doc, x, y, metersPerMm, targetMm = 60) {
  const km = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200].reduce((best, k) => (Math.abs((k * 1000) / metersPerMm - targetMm) < Math.abs((best * 1000) / metersPerMm - targetMm) ? k : best), 10);
  const len = (km * 1000) / metersPerMm;
  doc.setDrawColor(...INK).setLineWidth(0.3);
  for (let i = 0; i < 4; i++) {
    doc.setFillColor(...(i % 2 === 0 ? INK : [255, 255, 255]));
    doc.rect(x + (i * len) / 4, y, len / 4, 2, 'FD');
  }
  doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...INK);
  doc.text('0', x, y + 5, { align: 'center' });
  doc.text(fmt(km / 2), x + len / 2, y + 5, { align: 'center' });
  doc.text(`${fmt(km)} km`, x + len, y + 5, { align: 'center' });
  return len;
}
const fmt = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });

function northArrow(doc, x, y, s = 1) {
  doc.setDrawColor(...INK).setLineWidth(0.4);
  doc.setFillColor(255, 255, 255);
  doc.triangle(x, y, x + 5 * s, y + 16 * s, x, y + 12.5 * s, 'FD');
  doc.setFillColor(...INK);
  doc.triangle(x, y, x - 5 * s, y + 16 * s, x, y + 12.5 * s, 'FD');
  doc.setFont('helvetica', 'bold').setFontSize(9 * s).setTextColor(...INK).text('N', x, y + 21 * s, { align: 'center' });
}

function point(doc, x, y, r, color, n, fontSize) {
  doc.setDrawColor(255, 255, 255).setLineWidth(r * 0.22);
  doc.setFillColor(...hex(color));
  doc.circle(x, y, r, 'FD');
  doc.setDrawColor(0, 0, 0).setLineWidth(0.08).circle(x, y, r + r * 0.12, 'S');
  doc.setFont('helvetica', 'bold').setFontSize(fontSize).setTextColor(255, 255, 255);
  doc.text(String(n), x, y + fontSize * 0.125, { align: 'center' });
}

function passMark(doc, x, y) {
  doc.setDrawColor(...INK).setLineWidth(0.25);
  doc.circle(x, y, 2.4, 'S');
  doc.line(x - 3.8, y, x + 3.8, y);
  doc.line(x, y - 3.8, x, y + 3.8);
}

function legendBlock(doc, x, y, w, categories, { note = true, size = 1 } = {}) {
  const lh = 6 * size;
  doc.setFillColor(255, 255, 255).setDrawColor(43, 48, 56).setLineWidth(0.4);
  const rows = Math.ceil((categories.length + 2) / 2);
  const h = 12 * size + rows * lh + (note ? 6 * size : 0);
  doc.rect(x, y, w, h, 'FD');
  doc.setFont('helvetica', 'bold').setFontSize(10 * size).setTextColor(...INK).text('Legende', x + 4 * size, y + 7 * size);
  const items = [...categories.map((c) => ['dot', c.color, c.name]), ['rb', null, 'Reg.-Bezirksgrenze'], ['land', null, 'Landesgrenze']];
  doc.setFont('helvetica', 'normal').setFontSize(8 * size);
  items.forEach(([kind, color, label], i) => {
    const cx = x + 4 * size + (i % 2) * (w / 2);
    const cy = y + 12 * size + Math.floor(i / 2) * lh;
    if (kind === 'dot') { doc.setFillColor(...hex(color)).setDrawColor(0, 0, 0).setLineWidth(0.1).circle(cx + 2 * size, cy, 1.8 * size, 'FD'); }
    else if (kind === 'rb') { doc.setDrawColor(89, 98, 110).setLineWidth(0.5).setLineDashPattern([2, 1.3], 0).line(cx, cy, cx + 7 * size, cy).setLineDashPattern([], 0); }
    else { doc.setDrawColor(58, 65, 75).setLineWidth(0.7).line(cx, cy, cx + 7 * size, cy); }
    doc.setTextColor(...INK).text(doc.splitTextToSize(label, w / 2 - 12 * size)[0], cx + 9 * size, cy + 1.1 * size);
  });
  if (note) doc.setFontSize(7 * size).setTextColor(...MUTED).text('Die Nummer im Punkt verweist auf das Kontaktverzeichnis.', x + 4 * size, y + h - 3.5 * size);
  return h;
}

function contactTable(doc, numbered, catById, scenById, startY, title, margin) {
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...INK).text(title, margin.left, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Nr.', 'Einrichtung', 'Ansprechperson', 'Telefon', 'E-Mail', 'Gefährdet bei']],
    body: numbered.map(({ f, n }) => [String(n), `${f.name}\n${[formatAddress(f.address), catById.get(f.categoryId)?.name].filter(Boolean).join(' · ')}`,
      [f.contact.person, f.contact.function].filter(Boolean).join('\n'), f.contact.phone || '', f.contact.email || '', f.hazards.map((h) => scenById.get(h)?.name).filter(Boolean).join(', ')]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.5, lineColor: [201, 206, 214], lineWidth: 0.2, textColor: INK, valign: 'top' },
    headStyles: { fillColor: [43, 48, 56], textColor: 255 },
    columnStyles: { 0: { cellWidth: 9, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 52 }, 2: { cellWidth: 30 }, 3: { cellWidth: 24 }, 4: { cellWidth: 38 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 0) {
        const c = catById.get(numbered[d.row.index].f.categoryId);
        d.cell.styles.fillColor = hex(c?.color || '#5B6472');
        d.cell.styles.textColor = 255;
      }
    },
    margin,
  });
}

function footer(doc, pageW, pageH, left, right, margin = 14) {
  doc.setDrawColor(154, 163, 175).setLineWidth(0.2).line(margin, pageH - 13, pageW - margin, pageH - 13);
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
  doc.text(left, margin, pageH - 8.5, { maxWidth: pageW - 2 * margin - 40 });
  doc.text(right, pageW - margin, pageH - 8.5, { align: 'right' });
}

/**
 * @param {object} o
 * @param {Array} o.items gefilterter Bestand
 * @param {{format:'A2'|'A4', overlapMm:number, marks:boolean, index:boolean, contacts:boolean, basemap:string, title:string}} o.opts
 */
export async function buildPrintPdf({ items, categories, catById, scenById, filterText, cfg, opts, baseExtent = null, onProgress = () => {} }) {
  const numbered = numberFacilities(items);
  const stamp = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const sources = `Quellen: Kartengrundlage ${(cfg.attributions.length ? cfg.attributions : ['© Geobasis NRW']).join(' · ')} · Einrichtungsdaten: KRITIS-Lagekarte NRW, Stand ${stamp}`;
  const usedCats = categories.filter((c) => items.some((f) => f.categoryId === c.id));
  const legendCats = usedCats.length ? usedCats : categories;

  if (opts.format === 'A2') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a2' });
    const W = 594, H = 420, M = 16;
    const mapX = M, mapY = 42, mapW = 344, mapH = H - mapY - 26;
    onProgress('Karte wird gerendert …');
    const ext = printExtent(numbered, mapW / mapH, baseExtent);
    const r = await renderPrintMap({ cfg, extent: ext, widthPx: px(mapW), heightPx: px(mapH), basemap: opts.basemap, labelScale: 2.2 });
    onProgress('PDF wird erstellt …');
    // Kopf
    doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(...INK).text(opts.title, M, 24);
    doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...MUTED).text(`Gefilterter Bestand: ${filterText}`, M, 32);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text(`Stand: ${stamp} Uhr`, W - M, 24, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED).text('KRITIS-Lagekarte NRW · Nur für den Dienstgebrauch', W - M, 31, { align: 'right' });
    doc.setDrawColor(...INK).setLineWidth(0.6).line(M, 36, W - M, 36);
    // Karte
    doc.addImage(r.canvas, 'JPEG', mapX, mapY, mapW, mapH, undefined, 'FAST');
    const toMm = ([x, y]) => [mapX + ((x - r.extent[0]) / (r.extent[2] - r.extent[0])) * mapW, mapY + ((r.extent[3] - y) / (r.extent[3] - r.extent[1])) * mapH];
    for (const { f, n, xy } of numbered) {
      const [x, y] = toMm(xy);
      if (x > mapX && x < mapX + mapW && y > mapY && y < mapY + mapH) point(doc, x, y, 3.4, catById.get(f.categoryId)?.color || '#5B6472', n, 8.5);
    }
    doc.setDrawColor(43, 48, 56).setLineWidth(0.6).rect(mapX, mapY, mapW, mapH, 'S');
    doc.setFillColor(255, 255, 255).setDrawColor(43, 48, 56).setLineWidth(0.4).rect(mapX + mapW - 22, mapY + 7, 15, 27, 'FD');
    northArrow(doc, mapX + mapW - 14.5, mapY + 10, 1);
    const mPerMm = (r.extent[2] - r.extent[0]) / mapW;
    const lh = legendBlock(doc, mapX + 7, mapY + mapH - 78, 128, legendCats);
    scaleBar(doc, mapX + 11, mapY + mapH - 78 + lh - 0.5 + 6, mPerMm, 60);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED).text(`Maßstab ca. 1 : ${niceScale(mPerMm * 1000).toLocaleString('de-DE')} bei Druck auf DIN A2`, mapX + 11, mapY + mapH - 78 + lh + 14);
    // Kontaktverzeichnis rechts, Rest auf Folgeseiten
    let rest = [];
    if (opts.contacts) {
      const cx = mapX + mapW + 12, cw = W - M - cx;
      doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK).text('Kontaktverzeichnis', cx, mapY + 6);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED).text('Nummerierung von Nord nach Süd', cx + cw, mapY + 6, { align: 'right' });
      doc.setDrawColor(43, 48, 56).setLineWidth(0.5).line(cx, mapY + 9, cx + cw, mapY + 9);
      const colW = (cw - 8) / 2, rowH = 15.5, perCol = Math.floor((mapH - 12) / rowH);
      const onSheet = numbered.slice(0, perCol * 2);
      rest = numbered.slice(perCol * 2);
      onSheet.forEach(({ f, n }, i) => {
        const x = cx + Math.floor(i / perCol) * (colW + 8);
        const y = mapY + 12 + (i % perCol) * rowH;
        point(doc, x + 3.4, y + 3.6, 3.2, catById.get(f.categoryId)?.color || '#5B6472', n, 8);
        doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...INK).text(doc.splitTextToSize(f.name, colW - 10)[0], x + 9, y + 3);
        doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED).text(doc.splitTextToSize([f.address.city, catById.get(f.categoryId)?.name].filter(Boolean).join(' · '), colW - 10)[0], x + 9, y + 6.6);
        doc.setFontSize(7.5).setTextColor(...INK).text(doc.splitTextToSize([f.contact.person, f.contact.phone].filter(Boolean).join(' · ') || '–', colW - 10)[0], x + 9, y + 10);
        if (f.contact.email) doc.setFontSize(7).setTextColor(...MUTED).text(doc.splitTextToSize(f.contact.email, colW - 10)[0], x + 9, y + 13.2);
        doc.setDrawColor(201, 206, 214).setLineWidth(0.2).line(x, y + rowH - 0.8, x + colW, y + rowH - 0.8);
      });
      if (rest.length) doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...MUTED).text(`Fortsetzung Nr. ${rest[0].n}–${rest[rest.length - 1].n} auf den Folgeseiten.`, cx, mapY + mapH);
    }
    if (rest.length) {
      doc.addPage('a4', 'portrait');
      contactTable(doc, rest, catById, scenById, 22, 'Kontaktverzeichnis (Fortsetzung)', { left: 14, right: 14, top: 16, bottom: 20 });
    }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      const sz = doc.internal.pageSize;
      footer(doc, sz.getWidth(), sz.getHeight(), sources, i === 1 ? `Blatt 1 von ${pages} · DIN A2 quer` : `Seite ${i} von ${pages} · Kontaktverzeichnis`, i === 1 ? M : 14);
    }
    return doc;
  }

  // ---------- DIN A4 gestückelt ----------
  const { cols, rows, mapW: tw, mapH: th } = A4;
  const ov = opts.overlapMm;
  const totW = cols * tw - (cols - 1) * ov, totH = rows * th - (rows - 1) * ov;
  onProgress('Karte wird gerendert …');
  const ext = printExtent(numbered, totW / totH, baseExtent);
  const r = await renderPrintMap({ cfg, extent: ext, widthPx: px(totW), heightPx: px(totH), basemap: opts.basemap, labelScale: 1.4, kreise: true });
  onProgress('PDF wird erstellt …');
  const mPerMm = (r.extent[2] - r.extent[0]) / totW;
  const denom = niceScale(mPerMm * 1000);
  const toMos = ([x, y]) => [((x - r.extent[0]) / (r.extent[2] - r.extent[0])) * totW, ((r.extent[3] - y) / (r.extent[3] - r.extent[1])) * totH];
  const sheetId = (c, rr) => `${String.fromCharCode(65 + c)}${rr + 1}`;
  const tiles = [];
  for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) tiles.push({ c, r: rr, id: sheetId(c, rr), x0: c * (tw - ov), y0: rr * (th - ov) });
  const inTile = (t, [mx, my]) => mx >= t.x0 && mx < t.x0 + tw && my >= t.y0 && my < t.y0 + th;
  const pagesBefore = opts.index ? 1 : 0;
  const contactPagesEst = opts.contacts ? Math.max(1, Math.ceil(numbered.length / 18)) : 0;

  const doc = new jsPDF({ orientation: opts.index ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  if (opts.index) {
    const W = 297, H = 210, M = 15;
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text(opts.title.toUpperCase(), M, 18);
    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK).text(`Blattschnittübersicht · DIN A4, ${cols} × ${rows} Blätter`, M, 27);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED).text([`Stand: ${stamp} Uhr`, `${numbered.length} Einrichtungen · ${filterText}`], W - M, 20, { align: 'right' });
    doc.setDrawColor(...INK).setLineWidth(0.4).line(M, 31, W - M, 31);
    const ow = 135, oh = ow * (totH / totW);
    const ox = M, oy = 38;
    doc.addImage(r.canvas, 'JPEG', ox, oy, ow, oh, undefined, 'FAST');
    const k = ow / totW;
    for (const { f, xy } of numbered) {
      const [mx, my] = toMos(xy);
      doc.setFillColor(...hex(catById.get(f.categoryId)?.color || '#5B6472')).setDrawColor(255, 255, 255).setLineWidth(0.25).circle(ox + mx * k, oy + my * k, 0.9, 'FD');
    }
    doc.setGState(new doc.GState({ opacity: 0.18 }));
    doc.setFillColor(...BLUE);
    for (let c = 1; c < cols; c++) doc.rect(ox + (c * (tw - ov)) * k, oy, ov * k, oh, 'F');
    for (let rr = 1; rr < rows; rr++) doc.rect(ox, oy + (rr * (th - ov)) * k, ow, ov * k, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));
    doc.setDrawColor(...BLUE).setLineWidth(0.5);
    for (const t of tiles) {
      doc.rect(ox + t.x0 * k, oy + t.y0 * k, tw * k, th * k, 'S');
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...BLUE).text(t.id, ox + t.x0 * k + 3, oy + t.y0 * k + 7);
    }
    northArrow(doc, ox + ow - 6, oy + oh - 26, 0.6);
    const tx = ox + ow + 12;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text('Zusammensetzen', tx, oy + 4);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).text(doc.splitTextToSize(`1. Blätter nach dem Raster anordnen (A–${String.fromCharCode(64 + cols)} von West nach Ost, 1–${rows} von Nord nach Süd).\n2. Blau hinterlegte Ränder (${ov} mm) überlappen; jeweils ein Blatt am Rand beschneiden.\n3. ${opts.marks ? 'An den Passermarken ausrichten und von hinten verkleben.' : 'Bündig ausrichten und von hinten verkleben.'}`, W - M - tx), tx, oy + 10);
    autoTable(doc, {
      startY: oy + 34,
      margin: { left: tx, right: M },
      head: [['Blatt', 'Seite', 'Einrichtungen (Nr. im Kontaktverzeichnis)']],
      body: [...tiles.map((t, i) => [t.id, String(pagesBefore + i + 1), numbered.filter(({ xy }) => inTile(t, toMos(xy))).map(({ n }) => n).join(', ') || 'keine']),
        ...(opts.contacts ? [['–', `${pagesBefore + tiles.length + 1}–${pagesBefore + tiles.length + contactPagesEst}`, `Kontaktverzeichnis Nr. 1–${numbered.length}`]] : [])],
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: [201, 206, 214], lineWidth: { bottom: 0.2 } },
      headStyles: { fontStyle: 'bold', textColor: MUTED, lineWidth: { bottom: 0.5 }, lineColor: [43, 48, 56] },
      columnStyles: { 0: { cellWidth: 14, fontStyle: 'bold', textColor: BLUE }, 1: { cellWidth: 16 } },
    });
  }

  const PW = 210, PH = 297, MX = 15, MY = 24;
  tiles.forEach((t, i) => {
    if (opts.index || i > 0) doc.addPage('a4', 'portrait');
    onProgress(`Blatt ${t.id} …`);
    // Ausschnitt aus dem Gesamtbild
    const crop = document.createElement('canvas');
    crop.width = px(tw); crop.height = px(th);
    crop.getContext('2d').drawImage(r.canvas, px(t.x0), px(t.y0), px(tw), px(th), 0, 0, px(tw), px(th));
    doc.addImage(crop, 'JPEG', MX, MY, tw, th, undefined, 'FAST');
    // Überlappungsbänder
    doc.setGState(new doc.GState({ opacity: 0.14 }));
    doc.setFillColor(...BLUE);
    if (t.c > 0) doc.rect(MX, MY, ov, th, 'F');
    if (t.c < cols - 1) doc.rect(MX + tw - ov, MY, ov, th, 'F');
    if (t.r > 0) doc.rect(MX, MY, tw, ov, 'F');
    if (t.r < rows - 1) doc.rect(MX, MY + th - ov, tw, ov, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));
    for (const { f, n, xy } of numbered) {
      const m = toMos(xy);
      if (inTile(t, m)) point(doc, MX + m[0] - t.x0, MY + m[1] - t.y0, 2.9, catById.get(f.categoryId)?.color || '#5B6472', n, 7.5);
    }
    doc.setDrawColor(43, 48, 56).setLineWidth(0.3).rect(MX, MY, tw, th, 'S');
    if (opts.marks) for (const [x, y] of [[MX + 8, MY + 8], [MX + tw - 8, MY + 8], [MX + 8, MY + th - 8], [MX + tw - 8, MY + th - 8]]) passMark(doc, x, y);
    doc.setFillColor(255, 255, 255).setDrawColor(43, 48, 56).setLineWidth(0.3).rect(MX + tw - 22, MY + 14, 10, 17, 'FD');
    northArrow(doc, MX + tw - 17, MY + 16, 0.55);
    // Kopf und Anschlusshinweise
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text(opts.title, MX, 12);
    doc.setFontSize(16).setTextColor(...BLUE).text(`Blatt ${t.id}`, PW - MX, 13, { align: 'right' });
    doc.setFontSize(7.5).setTextColor(...BLUE);
    if (t.r > 0) doc.text(`Anschluss Blatt ${sheetId(t.c, t.r - 1)}`, PW / 2, MY - 2, { align: 'center' });
    if (t.r < rows - 1) doc.text(`Anschluss Blatt ${sheetId(t.c, t.r + 1)}`, PW / 2, MY + th + 4, { align: 'center' });
    if (t.c > 0) { const s2 = `Anschluss Blatt ${sheetId(t.c - 1, t.r)}`; doc.text(s2, MX - 2.5, MY + th / 2 + doc.getTextWidth(s2) / 2, { angle: 90 }); }
    if (t.c < cols - 1) { const s2 = `Anschluss Blatt ${sheetId(t.c + 1, t.r)}`; doc.text(s2, MX + tw + 2.5, MY + th / 2 - doc.getTextWidth(s2) / 2, { angle: -90 }); }
    // Fußzeile: Blattlage, Maßstab, Legende
    const fy = MY + th + 7;
    doc.setDrawColor(...BLUE).setLineWidth(0.25);
    for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
      doc.setFillColor(...BLUE);
      doc.rect(MX + c * 4.4, fy + rr * 5.4, 4, 5, rr === t.r && c === t.c ? 'FD' : 'S');
    }
    scaleBar(doc, MX + cols * 4.4 + 6, fy + 1, mPerMm, 25);
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...INK);
    let lx = MX + cols * 4.4 + 48;
    for (const c of legendCats) {
      doc.setFillColor(...hex(c.color)).circle(lx + 1.3, fy + 1.6, 1.3, 'F');
      const name = c.name.replace(/\s*\(.*\)$/, '').replace('Außeruniversitäre Forschungseinrichtungen', 'Forschung');
      doc.text(name, lx + 3.4, fy + 2.4);
      lx += doc.getTextWidth(name) + 7;
    }
    doc.setTextColor(...MUTED).text(`Maßstab ca. 1 : ${denom.toLocaleString('de-DE')} · Überlappung ${ov} mm · Stand ${stamp}`, MX + cols * 4.4 + 48, fy + 7);
  });

  if (opts.contacts && numbered.length) {
    doc.addPage('a4', 'portrait');
    contactTable(doc, numbered, catById, scenById, 22, 'Kontaktverzeichnis', { left: 14, right: 14, top: 16, bottom: 20 });
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const sz = doc.internal.pageSize;
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...MUTED);
    doc.text(sources, 14, sz.getHeight() - 6, { maxWidth: sz.getWidth() - 60 });
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...INK).text(`Seite ${i} von ${pages}`, sz.getWidth() - 14, sz.getHeight() - 6, { align: 'right' });
  }
  return doc;
}
