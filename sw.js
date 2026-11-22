// Sieć najpierw, pamięć jako zapas: odświeżenie zawsze bierze nową bazę, a bez sieci działa ostatnia pobrana.
// Obsługuję tylko pliki aplikacji i biblioteki Firebase — samego ruchu bazy (firestore.googleapis.com) nie dotykam.
const CACHE = 'plan-v141';
const PLIKI = ['./', 'index.html', 'style.css', 'app.js', 'obrazki.js', 'sync.js', 'manifest.json',
  'data/dania.json', 'data/dania-dodane.json', 'data/shake.json', 'data/opakowania.json', 'data/firebase.json',
  'icons/icon-180.png', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'udostepnione' && k !== 'biblioteki').map(k => caches.delete(k)))).then(() => self.clients.claim())
));
// Udostępnianie paragonu do aplikacji (Android): odbieram plik/tekst, zapisuję w pamięci 'udostepnione' i przekierowuję do aplikacji, która go wczyta.
async function przyjmijUdostepnienie(req) {
  try {
    const fd = await req.formData(), c = await caches.open('udostepnione'), pliki = [];
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of fd.getAll('paragon')) if (f && f.size !== undefined && f.name !== undefined) { const klucz = './udostepnione/plik' + (i++); await c.put(klucz, new Response(f)); pliki.push({ klucz, nazwa: f.name, typ: f.type }); }
    const tekst = [fd.get('text'), fd.get('title'), fd.get('url')].filter(x => typeof x === 'string' && x).join('\n');
    await c.put('./udostepnione/meta', new Response(JSON.stringify({ pliki, tekst }), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* aplikacja pokaże komunikat */ }
  return Response.redirect('./?udostepnione=1', 303);
}
self.addEventListener('fetch', e => {
  if (e.request.method === 'POST' && new URL(e.request.url).searchParams.has('udostepnione')) { e.respondWith(przyjmijUdostepnienie(e.request)); return; }
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin && u.hostname !== 'www.gstatic.com') return;
  // duże biblioteki (OCR, skaner) z lib/: pamięć najpierw, pobieram raz i trzymam między wersjami aplikacji
  if (u.origin === self.location.origin && /\/lib\//.test(u.pathname)) {
    e.respondWith(caches.open('biblioteki').then(async c => { const t = await c.match(e.request); if (t) return t; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(r => {
        if (r.ok) { const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
