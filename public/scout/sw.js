// TRC Scout service worker — app-shell offline cache.
// Bump CACHE when shell files change so clients pick up the new build.
const CACHE = 'trc-scout-v131';
const SHELL = [
  '/scout/index.html',
  '/scout/styles.css',
  '/scout/app.js',
  '/scout/db.js',
  '/scout/api.js',
  '/scout/manifest.webmanifest',
  '/trc_2.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// API calls always go to the network (never cache scouting data — the app's own
// IndexedDB is the offline store). The app shell is cache-first so it loads offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        // Runtime-cache same-origin shell assets we didn't precache.
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('/scout/index.html'))
    )
  );
});
