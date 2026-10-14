// PDF-Lageliste (DIN A4 hoch): Kopf mit Ereignis, Kartenausschnitt, Tabelle der Betroffenen, Fußzeile mit Quellen.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { formatAddress } from '../facilities.js';

const EVENT = [194, 81, 10];

export function buildLagelistePdf({ name, label, bufferM, inArea, inBuffer, groups, catById, scenById, mapImage, user, sources }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const now = new Date();
  const stamp = now.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.setProperties({ title: `Lageliste – ${name}`, creator: 'KRITIS-Lagekarte NRW' });

  doc.setFillColor(...EVENT);
  doc.rect(0, 0, W, 14, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold').setFontSize(11).text('LAGELISTE', 14, 9);
  doc.setFont('helvetica', 'normal').setFontSize(9).text('KRITIS-Lagekarte NRW · Nur für den Dienstgebrauch', W - 14, 9, { align: 'right' });
  doc.setTextColor(17, 19, 24);
  doc.setFont('helvetica', 'bold').setFontSize(18).text(doc.splitTextToSize(name, W - 28), 14, 25);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(63, 70, 81);
  const sc = groups?.scenario || null;
  const meta = [`Ereignisgebiet: ${label}`, `Pufferzone: ${bufferM > 0 ? `${(bufferM / 1000).toLocaleString('de-DE')} km` : 'keine'}`,
    ...(sc ? [`Krisenszenario: ${sc.name}${sc.areaWide ? ' (flächig – alle Einrichtungen im Gebiet gelten als gefährdet)' : ''}`,
      `Gefährdet: ${groups.atRisk}${sc.areaWide ? '' : ` · weitere im Gebiet, nicht für das Szenario markiert: ${groups.others}`}`]
      : [`Betroffen: ${inArea.length} im Gebiet${bufferM > 0 ? `, ${inBuffer.length} in der Pufferzone` : ''}`]),
    `Stand: ${stamp}${user ? ` · erstellt von ${user}` : ''}`];
  doc.text(meta, 14, 33);
  let y = 33 + meta.length * 4.6 + 3;

  if (mapImage) {
    const ratio = mapImage.height / mapImage.width;
    const w = W - 28;
    const h = Math.min(105, w * ratio);
    const wImg = h / ratio;
    doc.addImage(mapImage, 'JPEG', 14 + (w - wImg) / 2, y, wImg, h);
    doc.setDrawColor(43, 48, 56).setLineWidth(0.3).rect(14 + (w - wImg) / 2, y, wImg, h);
    y += h + 6;
  }

  const row = (f, num, zone) => [
    String(num), zone, f.name, catById.get(f.categoryId)?.name || '', formatAddress(f.address),
    [f.contact.person, f.contact.function].filter(Boolean).join('\n'), [f.contact.phone, f.contact.email].filter(Boolean).join('\n'),
    f.hazards.map((x) => scenById.get(x)?.name).filter(Boolean).join(', '),
  ];
  const zoneName = (z) => (z === 'A' ? 'Gebiet' : 'Puffer');
  // Mit Szenario: Zwischenzeilen je Gruppe (Gefährdet · Gebiet / Puffer, Weitere); ohne: wie bisher Gebiet, dann Puffer
  const body = [];
  const muted = new Set();
  if (groups?.groups?.length) {
    for (const g of groups.groups) {
      if (sc) body.push([{ content: `${g.label} (${g.items.length})`, colSpan: 8, styles: { fontStyle: 'bold', fillColor: g.muted ? [238, 240, 243] : [253, 236, 224], textColor: g.muted ? [63, 70, 81] : EVENT } }]);
      for (const x of g.items) {
        if (x.muted) muted.add(body.length);
        body.push(row(x.f, x.num, zoneName(x.zone)));
      }
      if (sc && !g.items.length) body.push([{ content: g.empty, colSpan: 8, styles: { textColor: [107, 114, 128] } }]);
    }
  } else {
    body.push(...inArea.map((f, i) => row(f, i + 1, 'Gebiet')), ...inBuffer.map((f, i) => row(f, inArea.length + i + 1, 'Puffer')));
  }
  autoTable(doc, {
    startY: y,
    head: [['Nr.', 'Zone', 'Einrichtung', 'Kategorie', 'Anschrift', 'Ansprechperson', 'Telefon / E-Mail', 'Gefährdet bei']],
    body: body.length ? body : [['–', '', 'Keine betroffenen Einrichtungen', '', '', '', '', '']],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.6, lineColor: [201, 206, 214], lineWidth: 0.2, textColor: [17, 19, 24], valign: 'top' },
    headStyles: { fillColor: [43, 48, 56], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 12 }, 2: { cellWidth: 34, fontStyle: 'bold' }, 3: { cellWidth: 22 }, 4: { cellWidth: 30 }, 5: { cellWidth: 26 }, 6: { cellWidth: 32 } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (muted.has(d.row.index)) d.cell.styles.textColor = [107, 114, 128];
      else if (d.column.index === 1 && d.cell.raw === 'Gebiet') d.cell.styles.textColor = EVENT;
    },
    margin: { left: 14, right: 14, bottom: 16 },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(63, 70, 81);
    doc.text(`Quellen: ${sources.join(' · ')} · Einrichtungsdaten: KRITIS-Lagekarte NRW, Stand ${stamp}`, 14, 290, { maxWidth: 150 });
    doc.text(`Seite ${i} von ${pages}`, W - 14, 290, { align: 'right' });
  }
  return doc;
}
