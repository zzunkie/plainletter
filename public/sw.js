// Keeps the app shell available offline, so saved letters open and the on-device model
// can explain a new letter without a connection. Model calls are never cached.
const CACHE = 'plainletter-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Pages: network first, cached copy when offline. Hashed assets and samples: cache first.
  const fresh = () => fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; });
  e.respondWith(e.request.mode === 'navigate'
    ? fresh().catch(() => caches.match('/'))
    : caches.match(e.request).then((hit) => hit || fresh()));
});
