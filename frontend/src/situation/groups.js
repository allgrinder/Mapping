// Gliederung eines Lagemodus-Ergebnisses für Liste, Karte, CSV und PDF.
// Ohne Szenario: „Im Gebiet“ / „In Pufferzone“. Mit Szenario: zuerst die Gefährdeten (Gebiet, Puffer),
// danach die übrigen Einrichtungen im Gebiet/Puffer, die für das Szenario nicht als gefährdet markiert sind.
// Nummern laufen über alle Gruppen in Anzeigereihenfolge (gleiche Nummer in Liste, Karte und Lageliste).

export function groupResult(r) {
  if (!r) return { scenario: null, groups: [], items: [], atRisk: 0, others: 0 };
  const sc = r.scenario || null;
  const A = r.inArea.map((f) => ({ f, zone: 'A' }));
  const B = r.inBuffer.map((f) => ({ f, zone: 'B' }));
  let groups;
  if (!sc) {
    groups = [{ key: 'A', label: 'Im Gebiet', zone: 'A', empty: 'Keine Einrichtungen im Gebiet.', items: A }];
    if (r.buffer) groups.push({ key: 'B', label: 'In Pufferzone', zone: 'B', empty: 'Keine Einrichtungen in der Pufferzone.', items: B });
  } else {
    const risk = (x) => x.f.atRisk === true;
    groups = [{ key: 'RA', label: 'Gefährdet · im Gebiet', zone: 'A', risk: true, empty: 'Keine gefährdeten Einrichtungen im Gebiet.', items: A.filter(risk) }];
    if (r.buffer) groups.push({ key: 'RB', label: 'Gefährdet · in Pufferzone', zone: 'B', risk: true, empty: 'Keine gefährdeten Einrichtungen in der Pufferzone.', items: B.filter(risk) });
    const rest = [...A, ...B].filter((x) => !risk(x));
    if (!sc.areaWide) groups.push({ key: 'O', label: r.buffer ? 'Weitere im Gebiet und Puffer – nicht für das Szenario markiert' : 'Weitere im Gebiet – nicht für das Szenario markiert', zone: null, muted: true, collapsible: true, empty: 'Keine weiteren Einrichtungen.', items: rest });
  }
  let num = 0;
  const items = [];
  for (const g of groups) {
    for (const x of g.items) {
      x.num = ++num;
      x.muted = Boolean(g.muted);
      items.push(x);
    }
  }
  const atRisk = sc ? items.filter((x) => !x.muted).length : items.length;
  return { scenario: sc, groups, items, atRisk, others: items.length - atRisk };
}

/** Kurzzeile für die Statusleiste. */
export function summaryText(r, g = groupResult(r)) {
  if (!r) return 'Noch kein Ereignisgebiet';
  if (!g.scenario) return `${r.inArea.length} im Gebiet${r.buffer ? ` · ${r.inBuffer.length} in Pufferzone` : ''}`;
  return `${g.scenario.name}: ${g.atRisk} gefährdet${g.scenario.areaWide ? '' : ` · ${g.others} weitere im Gebiet`}`;
}

/** Text zur Bewertung, abhängig vom gewählten Szenario. */
export function scenarioHint(sc) {
  if (!sc) return 'Ohne Szenario zählen alle Einrichtungen im Ereignisgebiet als betroffen.';
  if (sc.areaWide) return `„${sc.name}“ wirkt flächig: alle Einrichtungen im Ereignisgebiet gelten als gefährdet.`;
  return `Gefährdet sind Einrichtungen, die für „${sc.name}“ markiert sind. Die übrigen im Gebiet werden gesondert aufgeführt.`;
}
