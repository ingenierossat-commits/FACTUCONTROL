const CACHE_NAME = 'facturcontrol-v2';
const ASSETS = [
  './index.html',
  './app.js',
  './manifest.json',
  './ICONS/icon-192.png',
  './ICONS/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Firebase / red: siempre red primero. Estáticos propios: cache-first con fallback a red.
  const url = event.request.url;
  if (url.includes('firestore.googleapis.com') || url.includes('googleapis.com')) {
    return; // no interceptar tráfico de Firebase
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
