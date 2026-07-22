// Versioned cache-first service worker. Bump VERSION on every deploy that
// changes any asset — that is the whole update mechanism. The one exception
// is nutrition.json: it's maintained outside this repo, so it's served
// network-first with a cache fallback instead (see the fetch handler below)
// — cache-first would mean updates to it never reach an installed app.
const VERSION = 'reps-v1.0.14';
const CACHE = `reps-${VERSION}`;

const NUTRITION_URL = 'https://raw.githubusercontent.com/aaaaa-pixel-aaaaa/reps/main/nutrition.json';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/dates.js',
  './js/model.js',
  './js/store.js',
  './js/ui.js',
  './js/wheel.js',
  './js/nutrition.js',
  './js/nutrition-store.js',
  './js/views/home.js',
  './js/views/history.js',
  './js/views/log-sheet.js',
  './js/views/day-editor.js',
  './js/views/editors.js',
  './js/views/settings.js',
  './js/views/nutrition.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.url === NUTRITION_URL) {
    // Network-first: try the live file, cache whatever we get so offline
    // reads still have something. Never throw — a missing cache entry on
    // failure just resolves undefined and the app's own fetch() rejects,
    // which nutrition-store.js already treats as "no update this time".
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (!req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    // ignoreSearch so "./?demo=1" still resolves to the cached app shell.
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && req.mode === 'navigate') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    })
  );
});
