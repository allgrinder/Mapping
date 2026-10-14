import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Erzeugt sw.js mit der Liste aller gebauten App-Dateien (App-Shell für den Offline-Betrieb).
function serviceWorker() {
  return {
    name: 'kl-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./sw/sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(['./', 'index.html', ...files.filter((f) => f !== 'index.html')]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Normaler Build: landet im Webroot des PHP-Backends.
// Demo-Build (--mode demo): eigenständige Seite für GitHub Pages, Backend läuft im Browser (src/demo/server.js).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? './' : '/',
    publicDir: demo ? 'demo-public' : 'public',
    plugins: [serviceWorker()],
    build: {
      outDir: demo ? 'dist-demo' : '../backend/public',
      emptyOutDir: demo,
      assetsDir: 'assets',
      sourcemap: false,
      chunkSizeWarningLimit: 1500, // OpenLayers wird bewusst gebündelt (keine CDN)
    },
    server: {
      port: 5173,
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
