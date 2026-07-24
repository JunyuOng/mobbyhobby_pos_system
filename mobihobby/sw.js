// ── MobiHobby POS — service worker ──
// Caches the app shell so the POS opens instantly and works fully offline
// from the home screen. Bump CACHE when any shell file changes.
const CACHE = 'mobihobby-v3';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sync.js',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './assets/icon-180.png'
];

self.addEventListener('install', e => {
  // cache the shell; addAll is atomic so a bad path won't leave a half cache
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // drop old caches on version bump
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // only handle same-origin GETs; Firebase CDN + Firestore go straight to network
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const path = new URL(req.url).pathname;
  const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|ico|webmanifest)$/i.test(path);
  // Code + navigations → network-first: a fresh deploy always shows up online;
  // the cache is only the offline fallback. This is why deploys aren't "stuck".
  if (req.mode === 'navigate' || !isStaticAsset) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  // Static assets (icons/logo) → cache-first for speed; rarely change.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
