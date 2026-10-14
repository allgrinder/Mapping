/* Service Worker der KRITIS-Lagekarte NRW – wird beim Build mit der Liste der App-Dateien erzeugt. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `kl-shell-${VERSION}`;
const DATA = 'kl-data-v1';
const TILES = 'kl-tiles-v1';
const MAX_TILES = 4000;
const scoped = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map(scoped))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('kl-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Antwort aus dem Cache als solche kennzeichnen, damit die App den Offline-Hinweis zeigen kann. */
async function markCached(res) {
  const headers = new Headers(res.headers);
  headers.set('X-From-Cache', '1');
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return markCached(hit);
    return new Response(JSON.stringify({ error: { code: 'offline', message: 'Offline – diese Daten sind nicht zwischengespeichert.' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-From-Cache': '1' } });
  }
}

let tileWrites = 0;
async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function tileFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (++tileWrites % 200 === 0) trimTiles();
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function shellFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && new URL(req.url).pathname.includes('/demo-data/')) (await caches.open(DATA)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.open(DATA)).match(req) || new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(scoped('index.html'))) || (await caches.match(scoped('./')))));
    return;
  }
  if (url.pathname.includes('/api/tiles/')) { e.respondWith(tileFirst(req)); return; }
  if (url.pathname.includes('/api/')) {
    if (url.pathname.endsWith('/geocode')) return; // Geokodierung nie cachen
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(shellFirst(req));
});

/** Nachrichten der App: Vorladen der NRW-Übersicht, Löschen der Daten beim Abmelden. */
self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'logout') {
    e.waitUntil(caches.delete(DATA));
  }
  if (msg.type === 'warmup' && Array.isArray(msg.urls)) {
    e.waitUntil((async () => {
      const data = await caches.open(DATA);
      const tiles = await caches.open(TILES);
      for (const u of msg.urls) {
        const isTile = u.includes('/api/tiles/');
        const cache = isTile ? tiles : data;
        if (isTile && (await cache.match(u))) continue;
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res.ok) await cache.put(u, res);
        } catch { /* offline – später erneut */ }
      }
    })());
  }
});
