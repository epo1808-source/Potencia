// =====================================================================
// sw.js — Service worker: guarda la app en caché para abrirla sin
// conexión. Al publicar una versión nueva, cambia CACHE_VERSION.
// =====================================================================
const CACHE_VERSION = 'potencia-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/ble.js',
  './js/csc.js',
  './js/power.js',
  './js/zones.js',
  './js/metrics.js',
  './js/session.js',
  './js/workouts.js',
  './js/chart.js',
  './js/db.js',
  './js/fit.js',
  './js/tcx.js',
  './js/simulator.js',
  './js/feedback.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia: primero caché (funciona sin conexión); si no está, red.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
