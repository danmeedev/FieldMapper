// Service Worker for Field Mapper PWA - full offline support
const CACHE_NAME = 'fieldmapper-v3';
const PRECACHE_URLS = [
  '/gps.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Update metadata must never be satisfied from an old offline cache.
  if (url.hostname === 'api.github.com' || url.pathname === '/update-config.json' || url.pathname === '/js/app-updates.js') {
    e.respondWith(fetch(e.request));
    return;
  }

  // API calls: network only, fail gracefully when offline
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // WebSocket upgrade requests: skip
  if (e.request.headers.get('Upgrade') === 'websocket') return;

  // For navigation (page loads): serve cached gps.html, update in background
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/gps.html').then(cached => {
        const fetchPromise = fetch(e.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('/gps.html', clone));
          }
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: cache first, then network, cache new responses
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() =>
        new Response('Offline', { status: 503 })
      );
    })
  );
});

// Keep-alive: respond to periodic sync if available
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'gps-keepalive') {
    e.waitUntil(Promise.resolve());
  }
});
