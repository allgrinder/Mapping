import { defineConfig } from 'vite';

// Build landet direkt im Webroot des PHP-Backends; alle Bibliotheken werden lokal gebündelt (keine CDN).
export default defineConfig({
  build: {
    outDir: '../backend/public',
    emptyOutDir: false,
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
});
