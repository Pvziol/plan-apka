// Sieć najpierw, pamięć jako zapas: odświeżenie zawsze bierze nową bazę, a bez sieci działa ostatnia pobrana.
// Obsługuję tylko pliki aplikacji i biblioteki Firebase — samego ruchu bazy (firestore.googleapis.com) nie dotykam.
const CACHE = 'plan-v26';
const PLIKI = ['./', 'index.html', 'style.css', 'app.js', 'obrazki.js', 'sync.js', 'manifest.json',
  'data/dania.json', 'data/dania-dodane.json', 'data/shake.json', 'data/opakowania.json', 'data/firebase.json',
  'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin && u.hostname !== 'www.gstatic.com') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(r => {
        if (r.ok) { const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
