/* Credit-Organizer service worker: offline app shell.
 * Versioned cache (bump SW_V with every release, alongside ?v= in index.html
 * and version.json). Network-first: a live connection always wins, so this
 * never pins an old app.js — checkUpdate() (driven by version.json) still
 * rules releases and reloads open tabs.
 */
const SW_V = 45;
const CACHE = 'co-shell-v' + SW_V;
const SHELL = [
  'index.html',
  'styles.css?v=45',
  'app.js?v=45',
  'config.js?v=45',
  'version.json',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'vendor/supabase-2.116.0.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Same-origin GETs only: Supabase/AI traffic is never cached here.
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('index.html'))
    )
  );
});
