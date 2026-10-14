/** Setzt die Canvas-Ebenen einer OpenLayers-Karte zu einem Bild zusammen (nach OpenLayers-Beispiel „export-map“). */
export function mapToCanvas(map) {
  return new Promise((resolve) => {
    map.once('rendercomplete', () => {
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      const out = document.createElement('canvas');
      out.width = Math.round(size[0] * ratio);
      out.height = Math.round(size[1] * ratio);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, out.width, out.height);
      map.getViewport().querySelectorAll('.ol-layer canvas, canvas.ol-layer').forEach((canvas) => {
        if (canvas.width === 0) return;
        const opacity = canvas.parentNode.style.opacity || canvas.style.opacity;
        ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
        const bg = canvas.parentNode.style.backgroundColor;
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        const m = canvas.style.transform.match(/^matrix\(([^(]*)\)$/);
        const matrix = m ? m[1].split(',').map(Number) : [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0];
        ctx.setTransform(...matrix);
        ctx.drawImage(canvas, 0, 0);
      });
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      resolve(out);
    });
    map.renderSync();
  });
}
