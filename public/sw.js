// Offline shell cache. API responses are never cached (flight/eligibility data must always be fresh).
const CACHE = 'airport-assistant-shell-v4';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/lib.js', '/js/i18n.js', '/js/speech.js', '/js/map.js',
  '/js/views/passenger.js', '/js/views/staff.js', '/js/views/admin.js', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first, fall back to cache — always serve the newest app when online.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r ?? caches.match('/index.html'))));
});
