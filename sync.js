// Wspólny plan dla dwóch telefonów — darmowa baza Firebase (Firestore, plan Spark).
// Konfiguracja: data/firebase.json. Bez niej aplikacja działa normalnie, tylko lokalnie.
// Każda zmiana (danie, trening, odhaczony produkt, profil) wysyła tylko jedno pole,
// więc dwie osoby mogą edytować różne posiłki w tym samym czasie bez nadpisywania się.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LSx = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nic */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* nic */ } }
};

let cfg = null, F = null, db = null, ref = null, unsub = null, kolejka = [];
const S = { stan: 'start', kod: LSx.get('dom'), blad: null, dostepny: false };

const powiadom = () => { if (window.App) window.App.syncZmiana(); };
function nowyKod() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789', r = new Uint8Array(24);
  crypto.getRandomValues(r);
  return [...r].map(x => a[x % a.length]).join('');
}
function wyluskaj(t) {
  t = (t || '').trim();
  const m = t.match(/[?&]dom=([a-z0-9]+)/i);
  return (m ? m[1] : t).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function opisBledu(e) {
  const c = (e && e.code) || '';
  if (c.includes('permission-denied')) return 'Brak dostępu — sprawdź reguły bazy w Firebase.';
  if (c.includes('admin-restricted') || c.includes('operation-not-allowed')) return 'Włącz logowanie anonimowe w Firebase (Authentication).';
  if (c.includes('unavailable') || c.includes('network')) return 'Brak połączenia z siecią.';
  return 'Błąd synchronizacji' + (c ? ' (' + c + ')' : '') + '.';
}

async function sdk() {
  if (F) return F;
  const [app, fs, au] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-firestore.js'), import(SDK + 'firebase-auth.js')
  ]);
  const a = app.initializeApp(cfg);
  let d;
  try { d = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache(), ignoreUndefinedProperties: true }); }
  catch (e) { d = fs.initializeFirestore(a, { ignoreUndefinedProperties: true }); }
  const auth = au.getAuth(a);
  await new Promise((res, rej) => {
    const off = au.onAuthStateChanged(auth, u => {
      if (u) { off(); res(u); } else au.signInAnonymously(auth).catch(e => { off(); rej(e); });
    });
  });
  db = d; F = fs;
  return F;
}

async function polacz(kod, noweDane) {
  S.stan = 'laczenie'; S.blad = null; powiadom();
  try {
    await sdk();
    const r = F.doc(db, 'domy', kod);
    if (noweDane) await F.setDoc(r, noweDane);
    if (unsub) unsub();
    ref = r; S.kod = kod; LSx.set('dom', kod);
    unsub = F.onSnapshot(r, { includeMetadataChanges: true }, snap => {
      if (!snap.exists()) {
        if (!snap.metadata.fromCache) { odlacz(); S.blad = 'Nie ma wspólnego planu o tym kodzie.'; powiadom(); }
        return;
      }
      if (snap.metadata.hasPendingWrites) return;          // własna zmiana, jeszcze niepotwierdzona
      S.stan = snap.metadata.fromCache ? 'offline' : 'polaczony';
      window.App.zdalny(snap.data());
      powiadom();
    }, e => { S.stan = 'blad'; S.blad = opisBledu(e); powiadom(); });
    const k = kolejka; kolejka = []; k.forEach(wyslij);
    return true;
  } catch (e) {
    S.stan = 'blad'; S.blad = opisBledu(e); powiadom();
    return false;
  }
}

function wyslij(zm) {
  if (!S.kod || !zm || !zm.length) return;
  if (!ref) { kolejka.push(zm); return; }
  const args = [];
  for (const [sciezka, v] of zm) args.push(new F.FieldPath(...sciezka.map(String)), v === undefined ? F.deleteField() : v);
  F.updateDoc(ref, ...args).catch(e => { S.stan = 'blad'; S.blad = opisBledu(e); powiadom(); });
}

function odlacz() {
  if (unsub) unsub();
  unsub = null; ref = null; kolejka = [];
  S.kod = null; S.blad = null; LSx.del('dom');
  S.stan = S.dostepny ? 'lokalny' : 'brak';
  powiadom();
}

window.Sync = {
  get kod() { return S.kod; },
  get stan() { return S.stan; },
  get blad() { return S.blad; },
  get dostepny() { return S.dostepny; },
  zapisz: wyslij,
  odlacz,
  link() { return S.kod ? location.origin + location.pathname + '?dom=' + S.kod : null; },
  async utworz() { return polacz(nowyKod(), window.App.stanDoChmury()); },
  async dolacz(tekst) {
    const k = wyluskaj(tekst);
    if (k.length < 20) { S.blad = 'To nie wygląda na kod wspólnego planu.'; powiadom(); return false; }
    S.kod = k;           // ekran „łączę…”, dopóki nie przyjdą dane
    return polacz(k);
  }
};

(async function start() {
  try {
    const r = await fetch('data/firebase.json', { cache: 'no-store' });
    cfg = JSON.parse((await r.text()).replace(/^﻿/, ''));
  } catch (e) { cfg = null; }
  S.dostepny = !!(cfg && cfg.apiKey && cfg.projectId);
  const u = new URL(location.href), zLinku = u.searchParams.get('dom');
  if (zLinku) { u.searchParams.delete('dom'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  if (!S.dostepny) { S.stan = 'brak'; powiadom(); return; }
  if (zLinku && wyluskaj(zLinku) !== S.kod) {
    const maPlan = !!LSx.get('plan');
    if (!maPlan || confirm('Dołączyć do wspólnego planu? Plan zapisany na tym telefonie zostanie zastąpiony wspólnym.')) {
      await window.Sync.dolacz(zLinku);
      return;
    }
  }
  if (S.kod) await polacz(S.kod);
  else { S.stan = 'lokalny'; powiadom(); }
})();
