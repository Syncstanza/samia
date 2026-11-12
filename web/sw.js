// Sami'a web: keeps what it has loaded so the app starts fast and keeps working offline.
// Pages and code: network first (so a new version shows up on the next load), cache as the fallback.
// Big files (speech model, data, vendor): cache first, and the cache is per version.
const VERSION = '__VERSION__';
const CACHE = 'samia-' + VERSION;
const BIG = /\/(models|data|vendor)\//;
const FILES = __FILES__; // everything in the site, kept on install so the app also starts offline

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(['./', ...FILES]).catch(() => {}); // best effort: a failed file is fetched later as needed
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('samia-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (BIG.test(url.pathname) && hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (hit) return hit;
      throw err;
    }
  })());
});
