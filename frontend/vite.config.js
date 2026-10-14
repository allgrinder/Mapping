import { defineConfig } from 'vite';

// Normaler Build: landet im Webroot des PHP-Backends.
// Demo-Build (--mode demo): eigenständige Seite für GitHub Pages, Backend läuft im Browser (src/demo/server.js).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? './' : '/',
    publicDir: demo ? 'demo-public' : 'public',
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
