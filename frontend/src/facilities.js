// Gemeinsame Logik für Einrichtungen: Filter (clientseitig, damit Liste und Karte synchron und offline nutzbar sind).

/** @param {Array} items  @param {{q:string,categories:Set<number>|null,scenario:string,regbez:string,kreis:string,plzPrefix:string}} f */
export function applyFilters(items, f) {
  const q = (f.q || '').trim().toLowerCase();
  return items.filter((it) => {
    if (f.categories && !f.categories.has(it.categoryId)) return false;
    if (f.scenario && !it.hazards.includes(Number(f.scenario))) return false;
    if (f.regbez && it.admin.regbez !== f.regbez) return false;
    if (f.kreis && it.admin.kreis !== f.kreis) return false;
    if (f.plzPrefix && !String(it.address.zip || it.admin.plz5 || '').startsWith(f.plzPrefix)) return false;
    if (q) {
      const hay = [it.name, it.address.city, it.address.street, it.address.zip].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function isFiltered(f, allCategoryIds) {
  return Boolean(f.q?.trim() || f.scenario || f.regbez || f.kreis || f.plzPrefix || (f.categories && f.categories.size !== allCategoryIds.length));
}

export function formatAddress(a) {
  return [a.street, [a.zip, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export function formatCoord(lat, lon) {
  const f = (v) => v.toFixed(5).replace('.', ',');
  return `${f(lat)}° N  ${f(lon)}° O`;
}
