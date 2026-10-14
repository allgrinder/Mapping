// Stilisierte NRW-Silhouette als Hintergrund für Anmeldung/Passwort (aus dem Design „01 Anmeldung“).
const SVG_NS = 'http://www.w3.org/2000/svg';
const LAND = 'M54 357L135 322L194 331L292 248L348 157L432 117L532 100L572 183L621 204L702 196L770 174L743 131L770 74L810 30L869 96L856 135L905 209L945 283L986 348L999 426L918 500L851 531L797 609L756 644L743 696L689 761L635 818L581 796L500 792L405 857L378 870L324 892L270 913L203 987L176 948L135 913L122 848L68 805L32 679L95 652L116 587L122 544L122 500L68 413Z';
const RIVERS = [
  [5, 'M415 905C400 880 385 850 372 822C360 795 340 760 330 725C326 705 336 690 330 678C312 650 286 628 274 600C266 570 272 538 266 510C256 472 242 438 230 410C212 386 192 372 175 364C150 350 128 336 110 326C85 312 60 300 30 290'],
  [2.4, 'M268 512C320 506 380 514 428 508C490 500 560 528 624 522C676 532 716 594 756 642'],
  [2.4, 'M232 410C300 404 420 396 559 400C624 403 668 406 702 404C752 400 788 392 810 384'],
  [3.2, 'M1000 520C990 470 1000 430 990 380C978 340 950 300 920 250C900 210 880 160 870 110C866 70 850 30 830 -20'],
];

export function nrwBackdrop() {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 1030 1010');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'nrw-backdrop');
  const land = document.createElementNS(SVG_NS, 'path');
  land.setAttribute('d', LAND);
  land.setAttribute('class', 'land');
  s.append(land);
  for (const [w, d] of RIVERS) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'river');
    p.style.setProperty('stroke-width', String(w));
    s.append(p);
  }
  return s;
}
