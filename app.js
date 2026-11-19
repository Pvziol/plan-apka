'use strict';
/* Plan żywieniowy — PWA dla pary. Baza dań: data/dania.json (z PDF-ów) + data/dania-dodane.json (dopisywane). */

// ---------- pomocnicze ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* brak miejsca / tryb prywatny */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* nic */ } }
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const los = arr => arr[Math.floor(Math.random() * arr.length)];
const tasuj = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const OS = ['ona', 'on'];
const ETY = { ona: 'ONA', on: 'ON' };
const DNI = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const DNI_KR = ['pon', 'wto', 'śro', 'czw', 'pią', 'sob', 'nie'];
const PORA = { sn: '11:00 · śniadanie', m13: '13:00 · koktajl', m13ona: '13:00 · koktajl', m13on: '13:00 · drugie śniadanie', ob: '17:00 · obiad', k18: '~18:00 · koktajl' };
// Jaka część dziennych kcal przypada na posiłek (proporcje z planu w PDF-ach)
const UDZIAL = { ona: { sn: 0.32, m13: 0.19, ob: 0.34, k18: 0.15 }, on: { sn: 0.26, m13: 0.21, ob: 0.28, k18: 0.25 } };
const AKT = [['1.2', 'siedząca (biurko, brak ruchu)'], ['1.375', 'lekka (1–3 treningi / tydz.)'], ['1.55', 'umiarkowana (3–5 treningów)'], ['1.725', 'duża (6–7 treningów)'], ['1.9', 'bardzo duża (praca fizyczna + treningi)']];
const CEL = { redukcja: ['redukcja (−15%)', 0.85, 2.0], utrzymanie: ['utrzymanie', 1.0, 1.8], masa: ['masa (+10%)', 1.1, 1.8] };

const DB = { dania: new Map(), pula: {}, shake: null, opak: {}, dosypka: null };
let profil = LS.get('profil', null);
let plan = LS.get('plan', null);
let odhaczone = LS.get('odhaczone', {});
let oceny = LS.get('oceny', {});                       // id dania -> 1 (ulubione) lub -1 (ukryte); wspólne dla pary
let waga = LS.get('waga', { ona: {}, on: {} });        // waga[osoba][RRRR-MM-DD] = kg; wspólne
let lodowka = LS.get('lodowka', {});                   // lodowka[produkt][jednostka] = ilość; wspólne
let zuzyte = LS.get('zuzyte', {});                     // "start|dzień|slot" -> co zdjęto z lodówki przy tym daniu; wspólne
let inny = LS.get('inny', null);                         // drugi zapisany tydzień (bieżący albo następny): { start, dni, odhaczone, zuzyte }
let zakDni = LS.get('zakDni', null);                      // daty (RRRR-MM-DD), na które robicie zakupy; null = propozycja wg rytmu (pon po obiedzie: wt–pt, piątek: sob–pon)
let zmienCtx = null, spontG = null, spontWroc = false, spontFiltr = { typ: 'wszystko', q: '' };
let zakladka = 'dzis';
let wskazowki = LS.get('wskazowki', {});                     // które podpowiedzi „Wskazówka” już zamknięto (tylko ten telefon)
let otwartyDzien = null, otwartyTyg = null;   // który dzień którego tygodnia jest rozwinięty
let odroczone = false, ekranStartowy = false, ekranCzekania = false, formStart = null;
// wspólny plan: wysyła tylko zmienione pola, np. [[['dni', 3, 'sn'], 'id-dania']]; undefined = usuń pole
const Z = zm => { if (window.Sync && window.Sync.kod) window.Sync.zapisz(zm); };
const dniMapa = () => Object.fromEntries(plan.dni.map((d, i) => [String(i), d]));
const stabilny = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);

// ---------- formatowanie ilości ----------
function ulamek(x) {
  const c = Math.floor(x + 1e-9), r = Math.round((x - c) * 4) / 4;
  const z = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[r] ?? '';
  return (c ? c : '') + z || '0';
}
function fq(q, u) {
  if (q == null) return '';
  if (u === 'g' || u === 'ml') return (q < 20 ? Math.round(q) : Math.round(q / 5) * 5) + ' ' + u;
  // sztuki, kromki, puszki: tylko całe; połówka idzie w dół (8½ -> 8), ale nigdy poniżej 1
  if (u === 'szt.' || u === 'krom.' || u === 'pusz.') return Math.max(1, Math.ceil(q - 0.5 - 1e-9)) + ' ' + u;
  return ulamek(Math.max(0.5, Math.round(q / 0.5) * 0.5)) + ' ' + u;
}
// Przelicza gramy / ml / litry wpisane w tekście kroku przepisu na aktualną porcję.
// Dodatkowo liczby przy jajach, kromkach, łyżkach i pomidorkach („6 jaj”), żeby opis kroku zgadzał się ze składnikami.
const PL = '[\\wąćęłńóśźż]';
function krokLiczby(g, tekst) {
  const re = new RegExp(`(\\d+(?:,\\d+)?)?([½¼¾])?(\\s)(jaj${PL}*|jajk${PL}*|krom${PL}*|łyż${PL}*|pomidork${PL}*)(?!${PL})`, 'gi');
  return tekst.replace(re, (cale, liczba, frak, odstep, slowo, off) => {
    if (!liczba && !frak) return cale;
    const s = slowo.toLowerCase(), lyz = /^łyż/.test(s), jaja = /^jaj/.test(s), krom = /^krom/.test(s);
    const v = (liczba ? parseFloat(liczba.replace(',', '.')) : 0) + ({ '½': .5, '¼': .25, '¾': .75 }[frak] || 0);
    if (frak && !lyz) return cale;
    if (lyz) {
      const jed = /^łyżecz/.test(s) ? 'łyżecz.' : 'łyż.';
      const pas = g.dish.skladniki.filter(i => i.orig && i.orig.jednostka === jed && [v, 2 * v, 4 * v].includes(i.orig.ilosc));
      const sk = pas.length ? skala(g, pas[0]) : g.s, per = pas.length ? pas[0].orig.g : gNaLyzke('', jed), n = v * sk;
      return `${ulamek(Math.max(0.5, Math.round(n * 2) / 2))}${odstep}${slowo} ${wNawiasie(tekst, off) ? '= ' : '('}${Math.max(1, Math.round(n * per))} g${wNawiasie(tekst, off) ? '' : ')'}`;
    }
    const pas = g.dish.skladniki.filter(i => (jaja ? i.produkt === 'jaja' : krom ? i.jednostka === 'krom.' : i.produkt === 'pomidorki koktajlowe') && [v, 2 * v, 4 * v].includes(i.ilosc));
    const sk = pas.length ? skala(g, pas[0]) : g.s, c = Math.max(1, Math.round(v * sk));
    if (jaja) return c + odstep + (c === 1 ? 'jajko' : c < 5 ? 'jaja' : 'jaj');
    return c + odstep + slowo;
  });
}
function krokPrzeliczony(g, tekst) {
  return krokLiczby(g, tekst).replace(/(\d+(?:,\d+)?)(\s?)(kg|ml|g|l)(?![\wąćęłńóśźż°])/g, (cale, liczba, odstep, u) => {
    const v = parseFloat(liczba.replace(',', '.'));
    let sk = g.s;
    if (u === 'g' || u === 'ml') {
      const pas = g.dish.skladniki.filter(i => i.jednostka === u && (i.ilosc === v || i.ilosc === 2 * v || i.ilosc === 4 * v));
      if (pas.length) sk = skala(g, pas[0]);
    }
    const n = v * sk;
    if (u === 'kg' || u === 'l') return (Math.round(n * 10) / 10).toString().replace('.', ',') + odstep + u;
    return (n < 20 ? Math.round(n) : Math.round(n / 5) * 5) + odstep + u;
  });
}
const r0 = x => Math.round(x);
const znorm = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isoDzis = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dzienTyg = () => (new Date().getDay() + 6) % 7;   // 0 = poniedziałek
const ukryte = id => oceny[id] === -1;
const nieob = (day, p) => !!(day && day.nb && day.nb[p]);                 // osoba p jest nieobecna w tym dniu (plan pomija jej posiłki)
const obecneDni = (pl, p) => pl.dni.map((_, i) => i).filter(i => !nieob(pl.dni[i], p));
const stanKto = day => nieob(day, 'on') && !nieob(day, 'ona') ? 'bezon' : nieob(day, 'ona') && !nieob(day, 'on') ? 'bezona' : 'oboje';
const opisGarnka = g => { const os = [...new Set(g.porcje.map(q => q.p))], dn = new Set(g.porcje.map(q => q.d)).size; return (os.length === 1 ? 'dla ' + (os[0] === 'ona' ? 'niej' : 'niego') : (dn > 1 ? '' : 'dla Was dwojga')) + (dn > 1 ? (os.length === 1 ? ' ' : '') + 'na ' + dn + ' dni' : ''); };
const sredniaOsoby = (w, p, pole) => { const ix = obecneDni(plan, p); return ix.length ? sum(ix, i => w.dni[i][p][pole]) / ix.length : 0; };
const fmtStan = (q, u) => (u === 'g' || u === 'ml') ? Math.round(q) + ' ' + u : (Math.round(q * 2) / 2).toString().replace('.', ',') + ' ' + u;

// ---------- zapotrzebowanie ----------
function zapotrzebowanie(o) {
  if (!o || !o.wiek || !o.waga || !o.wzrost) return null;
  const bmr = 10 * o.waga + 6.25 * o.wzrost - 5 * o.wiek + (o.plec === 'm' ? 5 : -161);   // Mifflin-St Jeor
  const cpm = bmr * parseFloat(o.akt || '1.375');
  const [, mnoznik, gkg] = CEL[o.cel] || CEL.utrzymanie;
  const kcal = o.wlasne ? +o.wlasne : Math.round(cpm * mnoznik / 10) * 10;
  const b = Math.round(gkg * o.waga);
  return { bmr: r0(bmr), cpm: r0(cpm), kcal, b, bMin: r0(b * 0.9), bMax: r0(b * 1.15) };
}
function cele() { return { ona: zapotrzebowanie(profil.ona), on: zapotrzebowanie(profil.on) }; }

// ---------- baza ----------
async function wczytaj(plik, domyslne) {
  try {
    const r = await fetch('data/' + plik, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return JSON.parse((await r.text()).replace(/^﻿/, ''));
  } catch (e) {
    if (domyslne !== undefined) return domyslne;
    throw e;
  }
}
// Zawsze używamy pomidorków koktajlowych (są smaczniejsze), więc zwykły pomidor w przepisach zamieniam na nie: 1 szt. = 10 pomidorków.
// Wartości kcal i białka wiersza zostają bez zmian, a powtórzone wiersze w jednym daniu łączę w jeden. Pomidorów z puszki i passaty nie ruszam.
function normalizujPomidory(d) {
  for (const i of d.skladniki) if (i.produkt === 'pomidor' && i.jednostka === 'szt.') { i.produkt = 'pomidorki koktajlowe'; i.nazwa = 'pomidorki koktajlowe'; i.ilosc = i.ilosc * 10; }
  const widziane = new Map();
  d.skladniki = d.skladniki.filter(i => {
    if (i.produkt !== 'pomidorki koktajlowe') return true;
    const k = (i.grupa || '') + '|' + i.jednostka, p = widziane.get(k);
    if (!p) { widziane.set(k, i); return true; }
    p.ilosc += i.ilosc; p.kcal = (p.kcal || 0) + (i.kcal || 0); p.bialko = (p.bialko || 0) + (i.bialko || 0);
    return false;
  });
}
// W sklepach trudno o mrożone pojedyncze owoce, zwykle są mieszanki — więc maliny, truskawki, jagody i wiśnie traktuję jako „owoce mrożone (mieszanka)”,
// a mango i brzoskwinie jako „mieszankę tropikalną”. Kcal i białko wierszy zostają, powtórzone wiersze w daniu łączę.
const MIX_LESNA = 'owoce mrożone (mieszanka)', MIX_TROP = 'mieszanka tropikalna mrożona (mango, ananas…)';
function normalizujOwoce(d) {
  const mix = p => /^(maliny|truskawki|jagody|wiśnie) mrożone$/.test(p) ? MIX_LESNA : /^(mango|brzoskwinie) mrożone$/.test(p) ? MIX_TROP : null;
  const widziane = new Map();
  d.skladniki = d.skladniki.filter(i => {
    const m = mix(i.produkt || '');
    if (!m) return true;
    i.produkt = m; i.nazwa = m === MIX_LESNA ? 'owoce mrożone (mieszanka leśna)' : m;
    const k = (i.grupa || '') + '|' + m + '|' + i.jednostka, p = widziane.get(k);
    if (!p) { widziane.set(k, i); return true; }
    p.ilosc += i.ilosc; p.kcal = (p.kcal || 0) + (i.kcal || 0); p.bialko = (p.bialko || 0) + (i.bialko || 0);
    return false;
  });
  d.kroki = (d.kroki || []).map(k => k.replace(/mrożon(ych|e) (malin|jagód|truskawek|wiśni|brzoskwiń)/g, 'mrożonej mieszanki owoców leśnych').replace(/mrożon(ego|e) mango/g, 'mrożonej mieszanki tropikalnej'));
}
// Wszystko w gramach: łyżki i łyżeczki z przepisów zamieniam na gramy (wg produktu), a opis „≈ 1 łyżka” zostaje jako podpowiedź.
const G_LYZKA = { 'oliwa / olej': 10, 'miód': 20, 'sos sojowy': 15, 'sezam': 10, 'koncentrat pomidorowy': 15, 'dżem': 20, 'ketchup': 20, 'pesto bazyliowe': 15 };
const G_LYZECZKA = { 'masło': 5, 'musztarda': 5, 'kakao gorzkie': 3, 'miód': 7, 'chrzan': 5, 'skrobia ziemniaczana': 5, 'gochujang': 6, 'olej sezamowy': 4 };
const gNaLyzke = (prod, jedn) => jedn === 'łyż.' ? (G_LYZKA[prod] || 15) : (G_LYZECZKA[prod] || 5);
function normalizujLyzki(d) {
  for (const i of d.skladniki) if (i.ilosc && (i.jednostka === 'łyż.' || i.jednostka === 'łyżecz.')) {
    const per = gNaLyzke(i.produkt, i.jednostka);
    i.orig = { ilosc: i.ilosc, jednostka: i.jednostka, g: per };
    i.ilosc = Math.round(i.ilosc * per * 10) / 10; i.jednostka = 'g';
  }
}
// „2 łyżki” w tekście → „2 łyżki (30 g)” (bez skalowania; do tekstów przypraw)
const wNawiasie = (t, off) => t.slice(0, off).split('(').length > t.slice(0, off).split(')').length;     // czy miejsce w tekście jest już w nawiasie
const lyzkiOpis = t => String(t).replace(/(\d+(?:,\d+)?)?([½¼¾])?(\s)(łyżk\w*|łyżecz\w*)/g, (c, l, f, sp, sl, off, str) => {
  if (!l && !f) return c;
  const v = (l ? parseFloat(l.replace(',', '.')) : 0) + ({ '½': .5, '¼': .25, '¾': .75 }[f] || 0), per = /^łyżecz/.test(sl) ? 5 : 15;
  return `${l || ''}${f || ''}${sp}${sl} ${wNawiasie(str, off) ? '= ' : '('}${Math.round(v * per)} g${wNawiasie(str, off) ? '' : ')'}`;
});
async function wczytajBaze() {
  const [dania, dodane, shake, opak] = await Promise.all([
    wczytaj('dania.json'), wczytaj('dania-dodane.json', []), wczytaj('shake.json'), wczytaj('opakowania.json', {})
  ]);
  DB.dania.clear();
  for (const d of dania.concat(dodane)) { normalizujPomidory(d); normalizujOwoce(d); normalizujLyzki(d); DB.dania.set(d.id, d); }
  const wsz = [...DB.dania.values()];
  const typ = (...t) => wsz.filter(d => t.includes(d.typ));
  DB.pula = {
    sn: typ('sniadanie'),
    m13ona: typ('koktajl_maly'),
    m13on: typ('drugie_on'),
    m13: typ('koktajl').filter(d => d.podzial && d.podzial['13:00']).concat(wsz.filter(d => d.weekend)),   // weekend: wspólne 13:00 — koktajle i dania „na świeżo”
    k18: typ('koktajl').filter(d => d.podzial && d.podzial['~18:00']),
    m13kokt: typ('koktajl'),                                                  // weekend 13:00: wybór „koktajl” (wszystkie wspólne koktajle)
    m13dania: typ('drugie_on'),                                                // weekend 13:00: wybór „drugie danie” (liczone na dwoje)
    ob2: typ('obiad_zupa', 'obiad_2dni'),
    ob1: typ('obiad', 'obiad_sroda', 'obiad_sobota', 'obiad_niedziela')
  };
  DB.shake = shake; DB.opak = opak;
  DB.produkty = new Map();   // produkt -> { kat, u }: do podpowiedzi w lodówce
  for (const d of DB.dania.values()) for (const i of d.skladniki) if (i.produkt && i.ilosc && !DB.produkty.has(i.produkt)) DB.produkty.set(i.produkt, { kat: i.kategoria || 'zapas', u: i.jednostka });
  [['odżywka białkowa', 'zapas', 'g'], ['skyr naturalny', 'świeże', 'g'], ['mleko 2%', 'świeże', 'ml']].forEach(([n, kat, u]) => { if (!DB.produkty.has(n)) DB.produkty.set(n, { kat, u }); });
  const k = DB.pula.k18[0], pz = k.podzial['~18:00'];
  DB.dosypka = { kcal: pz.on_kcal - (k.razem.kcal - pz.ona_kcal), b: pz.on_bialko - (k.razem.bialko - pz.ona_bialko), odzywka: 30, skyr: 100 };
}

// ---------- silnik: skalowanie garnka ----------
// Kc = ile kcal ma mieć cały garnek. ratio = docelowe białko na 1 kcal (ustawiane przy zamianie dania).
// Mięso i ryby z zamrażarki to stałe woreczki z pierwotnego planu (np. pierś 360 g na środę, 280 g na sobotę, 2 × 160 g kotlety):
// zawsze 1× gramatura z przepisu, niezależnie od kcal. Resztę składników dopasowuję tak, żeby kalorie się zgadzały.
// Owoce mrożone się nie liczą — odważasz je z dużej paczki.
const stala = i => !!(i.ilosc && i.produkt && i.kategoria === 'zamrażarka' && i.jednostka === 'g' && !/mrożon/.test(i.produkt));
// Białka nie wyrównuję już osobnym skyrem „obok dania” ani zmianą mięsa w obiedzie, tylko gramaturami pozostałych składników w daniu.
function rozwiaz(dish, Kc, ratio, skyrMax = 0, lever = true) {
  const all = dish.skladniki, K = dish.razem.kcal, Ptot = dish.razem.bialko;
  const pf = Ptot / (sum(all, i => i.bialko) || 1);
  const fix = all.filter(stala), ing = all.filter(i => !stala(i));
  // ile woreczków mięsa: danie dla 1 osoby liczone na dwie = 2 woreczki; porcja mniejsza niż połowa przepisu (np. nieobecność) = pół woreczka
  const nF = Kc / K < 0.75 ? Math.max(0.5, Math.round(Kc / K * 2) / 2) : Math.max(1, Math.round(Kc / K));
  const Kf0 = sum(fix, i => i.kcal), Kf = Kf0 * nF, Pf = sum(fix, i => i.bialko * pf) * nF;
  const KR = K - Kf0, PR = Ptot - sum(fix, i => i.bialko * pf), s0 = Kc / K;
  const sw = fix.length && KR > 0 ? clamp((Kc - Kf) / KR, 0.3, 2.5) : s0;      // skala składników spoza woreczków
  const Kreal = fix.length ? Kf + KR * sw : Kc;
  let a = sw, b = sw, lev = new Set();
  let P = Pf + PR * sw;
  if (ratio && lever) {
    // dźwignia: składniki bogatsze w białko niż średnia dania skaluję osobno od reszty (0,7×–1,35× porcji, czyli +35% / −30%)
    const MIN = 0.7 * sw, MAX = 1.35 * sw, Kcw = KR * sw, rf = Math.max(0, (ratio * Kreal - Pf) / Kcw);
    const srednia = PR / KR;
    const L = ing.filter(i => i.ilosc && i.kcal > 0 && i.bialko * pf / i.kcal > srednia);
    const Kl = sum(L, i => i.kcal), Pl = sum(L, i => i.bialko * pf), Kr = KR - Kl, Pr = PR - Pl;
    const det = Kl * Pr - Kr * Pl;
    if (Kl > 0 && Kr > 0 && Math.abs(det) > 1e-6) {
      let aa = clamp(Kcw * (Pr - Kr * rf) / det, MIN, MAX);
      let bb = (Kcw - aa * Kl) / Kr;
      if (bb < MIN || bb > MAX) { bb = clamp(bb, MIN, MAX); aa = (Kcw - bb * Kr) / Kl; }
      if (aa >= MIN - 1e-9 && aa <= MAX + 1e-9) { a = aa; b = bb; lev = new Set(L); P = Pf + a * Pl + b * Pr; }
    }
  }
  const roznica = ratio ? P - ratio * Kreal : 0;
  return { a, b, lev, s: s0, sw, nF, P, dodatek: null, roznica, wyrownane: ratio ? Math.abs(roznica) < 1 : null, Kreal };
}
const rz = (dish, K, ratio, slot) => rozwiaz(dish, K, ratio, 0, slot !== 'ob');     // w obiadach nie ruszam proporcji (mięso zostaje, jak w woreczku)
const SKYR = { kcal: 0.63, b: 0.11 };   // na 1 g, jak w PDF-ach
const skala = (g, i) => stala(i) ? (g.nF || 1) : (g.lev.has(i) ? g.a : g.b);

// ---------- silnik: cały tydzień ----------
function oblicz(pl, c) {
  const dni = pl.dni.map(() => ({ ona: { kcal: 0, b: 0 }, on: { kcal: 0, b: 0 }, sloty: [] }));
  const garnki = [];
  const bud = (p, d, slot) => UDZIAL[p][slot] * (c[p].kcal - (pl.dni[d].tr[p] ? DB.shake[p].kcal : 0));
  const obecni = d => OS.filter(p => !nieob(pl.dni[d], p));
  function garnek(id, slot, d, porcje, ratio) {
    const dish = DB.dania.get(id);
    if (!dish || !porcje.length) return null;                 // nikt nie je tego posiłku (np. nieobecność)
    let K = sum(porcje, x => x.kcal);
    const r = rz(dish, K, ratio, slot);
    if (Math.abs(r.Kreal - K) > 0.5) { const f = r.Kreal / K; porcje.forEach(x => { x.kcal *= f; }); K = r.Kreal; }   // stałe woreczki mogą lekko zmienić kcal posiłku
    const g = Object.assign({ dish, slot, d, porcje, K, ratio }, r);
    for (const x of porcje) {
      x.udzial = x.kcal / K; x.b = x.udzial * g.P;
      dni[x.d][x.p].kcal += x.kcal; dni[x.d][x.p].b += x.b;
      if (!dni[x.d].sloty.some(s => s.g === g)) dni[x.d].sloty.push({ g, odgrzewane: x.d !== d });
    }
    garnki.push(g);
    return g;
  }
  pl.dni.forEach((day, d) => {
    const r = day.ratio || {};
    garnek(day.sn, 'sn', d, obecni(d).map(p => ({ p, d, kcal: bud(p, d, 'sn') })), r.sn);
    if (day.m13.wsp) garnek(day.m13.wsp, 'm13', d, obecni(d).map(p => ({ p, d, kcal: bud(p, d, 'm13') })), r.m13);
    else obecni(d).forEach(p => garnek(day.m13[p], 'm13' + p, d, [{ p, d, kcal: bud(p, d, 'm13') }], r['m13' + p]));
    if (day.ob) {
      const dd = day.ob2 && d + 1 < 7 ? [d, d + 1] : [d];
      garnek(day.ob, 'ob', d, dd.flatMap(x => obecni(x).map(p => ({ p, d: x, kcal: bud(p, x, 'ob') }))), r.ob);
    }
    const k = DB.dania.get(day.k18);
    if (k) {
      const pz = k.podzial['~18:00'], bn = bud('on', d, 'k18');
      const gs = bn / pz.on_kcal, reszta = (k.razem.kcal - pz.ona_kcal) * gs;
      const por = [];
      if (!nieob(day, 'ona')) por.push({ p: 'ona', d, kcal: bud('ona', d, 'k18') });
      if (!nieob(day, 'on')) por.push({ p: 'on', d, kcal: reszta });
      const g = garnek(day.k18, 'k18', d, por, r.k18);
      if (g && !nieob(day, 'on')) {
        g.dosypka = { skala: gs, kcal: bn - reszta, b: DB.dosypka.b * gs };
        dni[d].on.kcal += g.dosypka.kcal; dni[d].on.b += g.dosypka.b;
      }
    }
    OS.forEach(p => { if (day.tr[p] && !nieob(day, p)) { dni[d][p].kcal += DB.shake[p].kcal; dni[d][p].b += DB.shake[p].bialko; } });
  });
  const kolej = ['sn', 'm13', 'm13ona', 'm13on', 'ob', 'k18'];
  dni.forEach(x => x.sloty.sort((p, q) => kolej.indexOf(p.g.slot) - kolej.indexOf(q.g.slot)));
  return { dni, garnki };
}

// ---------- układanie tygodnia ----------
function poniedzialek() {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const wd = t.getDay();                       // 0 = niedziela
  t.setDate(t.getDate() + (wd === 0 ? 1 : 1 - wd));
  return t.toISOString().slice(0, 10);
}
const dodajDni = (iso, n) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const krotkaData = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' });
function kandydat() {
  // ukryte dania pomijam (chyba że w danej puli zostałoby mniej niż 2 dania)
  const P = Object.fromEntries(Object.entries(DB.pula).map(([k, v]) => { const ok = v.filter(d => !ukryte(d.id)); return [k, ok.length >= 2 ? ok : v]; }));
  const sn = tasuj(P.sn); while (sn.length < 7) sn.push(los(P.sn));
  const bezPowt = (pula, n) => { const out = []; while (out.length < n) { const x = los(pula); if (pula.length < 2 || x !== out[out.length - 1]) out.push(x); } return out; };
  const dd = bezPowt(P.m13on.filter(d => !d.tylko_wybor), 5),   // w tygodniu bez dań „na świeżo” (np. wrapy) — te tylko do ręcznego wyboru
     kk = bezPowt(P.k18, 7), mm = tasuj(P.m13ona), wk = tasuj(P.m13);
  const zupy = P.ob2.filter(d => d.typ === 'obiad_zupa'), dwa = P.ob2.filter(d => d.typ === 'obiad_2dni');
  const ob1 = dzien => { const t = P.ob1.filter(d => d.typ === 'obiad_' + dzien || d.typ === 'obiad'); return los(t.length ? t : P.ob1); };
  const obiady = [los(zupy.length ? zupy : P.ob2), null, ob1('sroda'), los(dwa.length ? dwa : P.ob2), null, ob1('sobota'), ob1('niedziela')];
  const dni = [];
  for (let d = 0; d < 7; d++) {
    const weekend = d >= 5;
    dni.push({
      sn: sn[d].id,
      m13: weekend ? { wsp: wk[(d - 5) % wk.length].id } : { ona: mm[d % mm.length].id, on: dd[d].id },
      ob: obiady[d] ? obiady[d].id : null,
      ob2: d === 0 || d === 3,
      k18: kk[d].id,
      tr: { ona: false, on: false },
      ratio: {}
    });
  }
  return { start: poniedzialek(), dni };
}
function ocena(pl, c) {
  const w = oblicz(pl, c);
  let kara = 0;
  w.dni.forEach((x, i) => OS.forEach(p => { if (nieob(pl.dni[i], p)) return; kara += 2 * Math.max(0, c[p].bMin - x[p].b) + Math.max(0, x[p].b - c[p].bMax); }));
  const nz = id => DB.dania.get(id).nazwa.toLowerCase();
  let tunczyk = 0;
  pl.dni.forEach((day, d) => {
    if (d && nz(day.sn).startsWith('owsianka') && nz(pl.dni[d - 1].sn).startsWith('owsianka')) kara += 25;
    if (day.m13.on && nz(day.m13.on).includes('tuńczyk')) tunczyk++;
    if (day.m13.on && nz(day.m13.on).includes('past') && nz(day.sn).includes('past')) kara += 15;
  });
  kara += 20 * Math.max(0, tunczyk - 1);
  pl.dni.flatMap(day => [day.sn, day.k18, day.ob, day.m13.wsp, day.m13.ona, day.m13.on]).filter(Boolean).forEach(id => { if (oceny[id] === 1) kara -= 6; else if (ukryte(id)) kara += 200; });
  w.garnki.forEach(g => { if ((g.sw || g.s) > 1.7 || (g.sw || g.s) < 0.55) kara += 10; });
  // zero waste: świeże produkty sprzedawane w opakowaniach (np. łosoś wędzony 100 g) — im mniej zostaje po zakupie, tym lepiej
  const potrz = {};
  w.garnki.forEach(g => g.dish.skladniki.forEach(i => { const o = i.produkt && DB.opak[i.produkt]; if (o && i.jednostka === o.jednostka && i.kategoria === 'świeże') potrz[i.produkt] = (potrz[i.produkt] || 0) + i.ilosc * skala(g, i); }));
  for (const [pr, q] of Object.entries(potrz)) { const o = DB.opak[pr]; kara += 3 * (Math.ceil(q / o.wielkosc - 1e-6) * o.wielkosc - q) / o.wielkosc; }
  return kara;
}
const paczka = () => ({ start: plan.start, dni: plan.dni, odhaczone, zuzyte });
const paczkaDoChmury = b => b ? { start: b.start, dni: Object.fromEntries(b.dni.map((d, i) => [String(i), d])), odhaczone: b.odhaczone || {}, zuzyte: b.zuzyte || {} } : undefined;
function paczkaZChmury(c) {
  if (!c || !c.start || !c.dni) return null;
  const dni = [0, 1, 2, 3, 4, 5, 6].map(i => c.dni[i]);
  if (!dni.every(Boolean)) return null;
  return { start: c.start, dni: dni.map(d => Object.assign({ ratio: {}, tr: { ona: false, on: false } }, d)), odhaczone: c.odhaczone || {}, zuzyte: c.zuzyte || {} };
}
// Zamienia oglądany tydzień z drugim zapisanym (żaden się nie kasuje).
function przelaczTydzien() {
  if (!inny) return false;
  const b = inny; inny = paczka();
  plan = { start: b.start, dni: b.dni }; odhaczone = b.odhaczone || {}; zuzyte = b.zuzyte || {};
  if (inny.start < poniedzialek()) inny = null;                // miniony tydzień nie jest już potrzebny
  LS.set('plan', plan); LS.set('odhaczone', odhaczone); LS.set('zuzyte', zuzyte); LS.set('inny', inny);
  Z([[['start'], plan.start], [['dni'], dniMapa()], [['odhaczone'], odhaczone], [['zuzyte'], zuzyte], [['inny'], paczkaDoChmury(inny)]]);
  otwartyDzien = null;
  return true;
}
// start = poniedziałek układanego tygodnia; bez niego: zostaje data obecnego planu (jeśli to bieżący lub przyszły tydzień), inaczej bieżący poniedziałek
function ulozTydzien(start, zachowaj) {
  const c = cele();
  let naj = null, najK = Infinity;
  for (let i = 0; i < 300; i++) { const k = kandydat(), o = ocena(k, c); if (o < najK) { naj = k; najK = o; } }
  // zachowaj zaznaczone treningi z poprzedniego planu
  if (plan) naj.dni.forEach((d, i) => { d.tr = Object.assign({ ona: false, on: false }, plan.dni[i] && plan.dni[i].tr); });
  naj.start = start || (plan && plan.start && plan.start >= poniedzialek() ? plan.start : poniedzialek());
  if (plan && plan.start === naj.start) naj.dni.forEach((d, i) => { if (plan.dni[i] && plan.dni[i].nb) d.nb = plan.dni[i].nb; });   // przy losowaniu tego samego tygodnia zostają dni „bez niego/niej”
  // układam drugi tydzień obok: obecny (bieżący lub przyszły) zostaje zapisany i da się do niego wrócić
  if (zachowaj && plan && plan.dni && plan.start >= poniedzialek() && plan.start !== naj.start) inny = paczka();
  plan = naj; odhaczone = {}; zuzyte = {};
  LS.set('plan', plan); LS.set('odhaczone', odhaczone); LS.set('zuzyte', zuzyte); LS.set('inny', inny);
  Z([[['start'], plan.start], [['dni'], dniMapa()], [['odhaczone'], {}], [['zuzyte'], {}], [['inny'], paczkaDoChmury(inny)]]);
}
// Jeśli w planie jest danie, którego już nie ma w bazie (np. usunięte), zastępuję je innym z tej samej grupy i synchronizuję zmianę.
function naprawBrakujace() {
  if (!plan || !plan.dni || !DB.dania.size) return;
  const zm = [];
  plan.dni.forEach((day, d) => {
    const podmien = (id, pula, slot, sciezka, ustaw) => {
      if (!id || DB.dania.has(id)) return;
      const kand = pula.filter(x => !ukryte(x.id)), n = los(kand.length ? kand : pula);
      ustaw(n.id); zm.push([['dni', d, ...sciezka], n.id]);
      if (day.ratio && day.ratio[slot] !== undefined) { delete day.ratio[slot]; zm.push([['dni', d, 'ratio', slot], undefined]); }
    };
    podmien(day.sn, DB.pula.sn, 'sn', ['sn'], v => { day.sn = v; });
    podmien(day.k18, DB.pula.k18, 'k18', ['k18'], v => { day.k18 = v; });
    podmien(day.ob, day.ob2 ? DB.pula.ob2 : DB.pula.ob1, 'ob', ['ob'], v => { day.ob = v; });
    if (day.m13) {
      podmien(day.m13.wsp, DB.pula.m13, 'm13', ['m13', 'wsp'], v => { day.m13.wsp = v; });
      podmien(day.m13.ona, DB.pula.m13ona, 'm13ona', ['m13', 'ona'], v => { day.m13.ona = v; });
      podmien(day.m13.on, DB.pula.m13on, 'm13on', ['m13', 'on'], v => { day.m13.on = v; });
    }
  });
  if (zm.length) { LS.set('plan', plan); Z(zm); }
}
function planAktualny() {
  if (!plan || !plan.dni || plan.dni.length !== 7) return false;
  return plan.dni.every(d => [d.sn, d.k18, d.ob, d.m13.wsp, d.m13.ona, d.m13.on].every(id => !id || DB.dania.has(id)));
}

// ---------- lista zakupów ----------
// W bazie przyprawy to jeden tekst na danie („czosnek 3 ząbki, oregano, sól”). Rozbijam je na pojedyncze pozycje,
// łączę te same i sumuję ilości w tych samych jednostkach (czosnek: 14 ząbków).
function przyprawyZbiorczo(teksty) {
  const alias = { 'gałka': 'gałka muszkatołowa', 'ziele': 'ziele angielskie', 'natka': 'natka pietruszki', 'szczypta cukru': 'cukier', 'cukier szczypta': 'cukier' };
  const jedn = { 'zębki': 'ząbki', 'ząbki': 'ząbki', 'zębek': 'ząbki', 'ząbek': 'ząbki', 'zębków': 'ząbki', 'łyżeczka': 'łyżeczki', 'łyżeczki': 'łyżeczki', 'łyżeczek': 'łyżeczki', 'łyżka': 'łyżki', 'łyżki': 'łyżki', 'l': 'l', 'ml': 'ml', 'g': 'g' };
  const m = new Map();
  for (const t of teksty) for (const el of String(t).split(/,\s+(?![^()]*\))/)) {
    let x = el.trim(); if (!x) continue;
    const nota = (x.match(/\(([^)]*)\)/) || [])[1];
    x = x.replace(/\([^)]*\)/g, '').trim();
    const k = x.match(/^([^\d]*?)[:\s]*(\d+(?:,\d+)?)\s*(\S*)/);
    let nazwa = (k ? k[1] : x).trim().replace(/[:\s]+$/, '').toLowerCase(), ilosc = k ? parseFloat(k[2].replace(',', '.')) : null, u = k ? (jedn[k[3].toLowerCase().replace(/[.,/]+$/, '')] || '') : '';
    nazwa = alias[nazwa] || nazwa;
    if (!nazwa) continue;
    if (!m.has(nazwa)) m.set(nazwa, { il: {}, bez: false, nota: nota || '' });
    const e = m.get(nazwa);
    if (ilosc === null) e.bez = true; else e.il[u] = (e.il[u] || 0) + ilosc;
    if (nota && !e.nota) e.nota = nota;
  }
  const f = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl')).map(([n, e]) => {
    const skrot = { 'ząbki': 'ząb.', 'łyżeczki': 'łyżecz.', 'łyżki': 'łyż.' };
    const il = Object.entries(e.il).map(([u, q]) => `${f(q)}${u ? ' ' + (skrot[u] || u) : ''}`).join(' + ');
    return n + (il ? ' — ' + il : '') + (e.nota ? ` (${e.nota})` : '');
  });
}
// Przyprawy dania jako wiersze tabeli składników: nazwa + ilość (albo pusto = „do smaku”) + ewentualna uwaga.
function przyprawyWiersze(dish) {
  const wynik = [];
  for (const t of dish.przyprawy || []) for (const el of String(t).split(/,\s+(?![^()]*\))/)) {
    let x = el.trim(); if (!x) continue;
    const nota = (x.match(/\(([^)]*)\)/) || [])[1] || '';
    x = x.replace(/\([^)]*\)/g, '').trim();
    let nazwa, ilosc = '';
    if (/^(szczypta cukru|cukier szczypta)$/i.test(x)) { nazwa = 'cukier'; ilosc = 'szczypta'; }
    else { const m = x.match(/^([^\d]*?)[:\s]*(\d.*)$/); if (m) { nazwa = m[1].trim(); ilosc = m[2].trim(); } else nazwa = x.replace(/[:\s]+$/, ''); }
    if (!nazwa) continue;
    ilosc = ilosc.replace(/\bzębki\b/g, 'ząbki').replace(/\bzębek\b/g, 'ząbek').replace(/\bzębków\b/g, 'ząbków');
    const pelna = { 'gałka': 'gałka muszkatołowa', 'ziele': 'ziele angielskie', 'natka': 'natka pietruszki' };
    nazwa = pelna[nazwa.toLowerCase()] || nazwa;
    wynik.push({ nazwa: nazwa.charAt(0).toUpperCase() + nazwa.slice(1), ilosc: lyzkiOpis(ilosc), nota: lyzkiOpis(nota) });
  }
  return wynik;
}
const kluczKup = prod => 'zak|' + prod;
const odhK = k => odhaczone[k] || (inny && inny.odhaczone && inny.odhaczone[k]);     // odhaczenia z obu zapisanych tygodni
// ile faktycznie kupisz (całe opakowania, sztuki w całości, gramy co 10)
function kupnoIlosc(prod, u, q) {
  const o = DB.opak[prod];
  if (o && u === o.jednostka) { const qz = u === 'szt.' ? Math.ceil(q - 1e-6) : Math.ceil(q / 10) * 10; return Math.ceil(qz / o.wielkosc) * o.wielkosc; }
  if (u === 'g' || u === 'ml') return Math.ceil(q / 10) * 10;
  const krok = (u === 'szt.' || u === 'krom.' || u === 'pusz.') ? 1 : 0.5;
  return Math.ceil(q / krok - 1e-6) * krok;
}
// Wszystkie zapisane tygodnie razem (bieżący + następny), od najwcześniejszego.
const tygodnieZapisane = () => [plan && { start: plan.start, dni: plan.dni, zuz: zuzyte }, inny && { start: inny.start, dni: inny.dni, zuz: inny.zuzyte || {} }].filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));
function dniDostepne() {
  const out = [];
  tygodnieZapisane().forEach(t => t.dni.forEach((day, d) => out.push({ iso: dodajDni(t.start, d), start: t.start, d, day })));
  return out;
}
// Propozycja na najbliższą wyprawę: w poniedziałek po obiedzie kupujecie na wt–pt, w piątek na sob–pon. Od soboty „najbliższa wyprawa” to poniedziałek.
function domyslneDni(dost) {
  const dzis = isoDzis(), idx = (new Date(dzis + 'T12:00:00').getDay() + 6) % 7;
  let od, doo;
  if (idx >= 1 && idx <= 4) { od = dodajDni(dzis, 5 - idx); doo = dodajDni(od, 2); }              // wt–czw i piątek: zakupy w piątek na sob–pon
  else { od = dodajDni(dzis, (1 - idx + 7) % 7 || 7); doo = dodajDni(od, 3); }                      // pon, sob, nie: zakupy w poniedziałek na wt–pt
  const wyb = dost.filter(x => x.iso >= od && x.iso <= doo).map(x => x.iso);
  return wyb.length ? wyb : dost.filter(x => x.iso >= dzis).slice(0, 4).map(x => x.iso);
}
function wybraneDni() {
  const dost = dniDostepne(), ok = new Set(dost.map(x => x.iso)), dzis = isoDzis();
  const z = zakDni ? zakDni.filter(x => ok.has(x)) : null;
  if (z && (!z.length || z.some(x => x >= dzis))) return new Set(z);       // własny wybór (też pusty); stary, już miniony wybór zastępuję propozycją
  return new Set(domyslneDni(dost));
}
// Co jeszcze zrobić z resztą opakowania: dania z planu poza tymi zakupami i pomysły z bazy.
function pomyslyResztki(prod, zost, wyb) {
  const wPlanie = new Set(), c = cele();
  for (const t of tygodnieZapisane()) {
    const wk = oblicz({ start: t.start, dni: t.dni }, c);
    for (const g of wk.garnki) {
      if (!g.dish.skladniki.some(i => i.produkt === prod)) continue;
      const dni = dniGarnka(g).filter(d => !t.zuz[kluczZ(d, g.slot, t.start)]);
      if (!dni.length || dni.some(d => wyb.has(dodajDni(t.start, d)))) continue;
      const dt = dodajDni(t.start, dni[0]);
      wPlanie.add(`${g.dish.nazwa} (${DNI_KR[(new Date(dt + 'T12:00:00').getDay() + 6) % 7]} ${krotkaData(dt)})`);
    }
  }
  const pomysly = [...DB.dania.values()].filter(d => !ukryte(d.id) && ['sniadanie', 'drugie_on', 'koktajl_maly', 'koktajl'].includes(d.typ)).map(d => {
    const i = d.skladniki.find(x => x.produkt === prod && x.jednostka === zost.u);
    return i && i.ilosc <= zost.q * 1.15 ? { d, q: i.ilosc } : null;
  }).filter(Boolean).sort((a, b) => (oceny[b.d.id] === 1) - (oceny[a.d.id] === 1) || b.q - a.q).slice(0, 3).map(x => x.d.nazwa);
  return { wPlanie: [...wPlanie].slice(0, 3), pomysly };
}
// Lista zakupów na wybrane dni (z obu tygodni). Jeśli danie jest na kilka dni (zupa na 2 dni), kupujesz je w całości — nie trzeba dzielić ani zaglądać w przepisy.
// Od potrzeb odejmuję lodówkę i dania już zjedzone.
function zakupyDni(wyb) {
  const nz = new Map(), inne = new Set(), przyprawy = [], worki = {};
  const dodaj = (produkt, kat, q, u) => {
    if (!nz.has(produkt)) nz.set(produkt, { produkt, kat: kat || 'zapas', il: {} });
    const p = nz.get(produkt); p.il[u] = (p.il[u] || 0) + q;
    if (kat === 'zamrażarka' || (kat === 'świeże' && p.kat === 'zapas')) p.kat = kat;
  };
  const c = cele();
  for (const t of tygodnieZapisane()) {
    const wk = oblicz({ start: t.start, dni: t.dni }, c);
    for (const g of wk.garnki) {
      const f = pozostalo(g, t.start, t.zuz), dni = dniGarnka(g).filter(d => !t.zuz[kluczZ(d, g.slot, t.start)]);
      if (f < 0.001 || !dni.some(d => wyb.has(dodajDni(t.start, d)))) continue;      // całe danie, jeśli którykolwiek jego dzień jest na liście
      const dt = dodajDni(t.start, dni[0]);
      for (const i of g.dish.skladniki) {
        if (i.ilosc && i.produkt) {
          dodaj(i.produkt, i.kategoria, i.ilosc * skala(g, i) * f, i.jednostka);
          if (stala(i) && f > 0.999) { const nb = g.nF || 1; for (let n = 0; n < Math.ceil(nb); n++) (worki[i.produkt] = worki[i.produkt] || []).push({ g: Math.round(i.ilosc * Math.min(1, nb - n)), dt, dish: g.dish.nazwa, slot: g.slot }); }
        } else inne.add(i.nazwa + ' — ' + g.dish.nazwa);
      }
      (g.dish.przyprawy || []).forEach(x => przyprawy.push(x));
      if (g.dosypka) { dodaj('odżywka białkowa', 'zapas', DB.dosypka.odzywka * g.dosypka.skala * f, 'g'); dodaj('skyr naturalny', 'świeże', DB.dosypka.skyr * g.dosypka.skala * f, 'g'); }
      if (g.dodatek) dodaj('skyr naturalny', 'świeże', g.dodatek.g * f, 'g');
    }
    t.dni.forEach((day, d) => { if (wyb.has(dodajDni(t.start, d))) OS.forEach(pp => { if (day.tr[pp] && !nieob(day, pp)) { dodaj('odżywka białkowa', 'zapas', DB.shake[pp].odzywka_g, 'g'); dodaj('mleko 2%', 'świeże', DB.shake[pp].mleko_ml, 'ml'); } }); });
  }
  const wynik = { 'świeże': [], 'zapas': [], 'zamrażarka': [], 'masz': [] };
  for (const [prod, a] of nz) {
    const stl = lodowka[prod] || {}, kz = (() => { const x = odhK(kluczKup(prod)); return x && typeof x === 'object' ? x : {}; })();
    const il = {}, potrzeba = [], masz = {};
    for (const [u, n] of Object.entries(a.il)) {
      const znany = stl[u] != null, S0 = znany ? Math.max(0, stl[u] - (kz[u] || 0)) : 0;   // stan bez tego, co dopisały odhaczone zakupy
      const d = Math.max(0, n - S0);
      if (n > 0.5) potrzeba.push([u, n]);
      if (d > 0.5) il[u] = d;
      if (znany) masz[u] = S0;
    }
    if (!potrzeba.length) continue;
    const stanTxt = Object.entries(masz).filter(([, q]) => q > 0.5).map(([u, q]) => fmtStan(q, u)).join(' + ');
    if (!Object.keys(il).length) { wynik.masz.push({ produkt: prod, ile: potrzeba.map(([u, q]) => fmtStan(q, u)).join(' + '), stan: stanTxt }); continue; }
    const czesci = Object.entries(il).map(([u, q]) => {
      if (u === 'g' || u === 'ml') return Math.ceil(q / 10) * 10 + ' ' + u;
      const krok = (u === 'szt.' || u === 'krom.' || u === 'pusz.') ? 1 : 0.5;
      return ulamek(Math.ceil(q / krok - 1e-6) * krok) + ' ' + u;
    });
    let dop = '', reszta = null;
    const o = DB.opak[prod];
    if (o) {
      const q = il[o.jednostka], szt = il['szt.'];
      if (q) { const qz = o.jednostka === 'szt.' ? Math.ceil(q - 1e-6) : Math.ceil(q / 10) * 10, n = Math.ceil(qz / o.wielkosc), zo = n * o.wielkosc - qz; dop = `${n}× ${o.rodzaj} ${o.wielkosc} ${o.jednostka}, zostaje ${zo} ${o.jednostka}`; reszta = { q: zo, u: o.jednostka, ulamek: zo / o.wielkosc }; }
      else if (szt && o.sztuk_ok) { const n = Math.ceil(szt / o.sztuk_ok - 1e-6); dop = `${n}× ${o.rodzaj} ${o.wielkosc} ${o.jednostka} (ok. ${o.sztuk_ok} szt.)`; }
    }
    const kupno = {};
    for (const [u, q] of Object.entries(il)) kupno[u] = kupnoIlosc(prod, u, q);
    const pomysly = reszta && a.kat === 'świeże' && prod !== 'mleko 2%' && reszta.ulamek >= 0.25 ? pomyslyResztki(prod, reszta, wyb) : null;
    (wynik[a.kat] || wynik.zapas).push({ produkt: prod, ile: czesci.join(' + '), dop, kupno, stan: stanTxt, worki: worki[prod] || null, reszta, pomysly });
  }
  Object.values(wynik).forEach(arr => arr.sort((x, y) => x.produkt.localeCompare(y.produkt, 'pl')));
  return { wynik, inne: [...inne], przyprawy: przyprawyZbiorczo(przyprawy), wyb };
}

// ---------- widoki ----------
function dataDnia(d) { const t = new Date(plan.start + 'T12:00:00'); t.setDate(t.getDate() + d); return t; }
function dzisIdx() { const t = new Date(); t.setHours(12, 0, 0, 0); const i = Math.round((t - dataDnia(0)) / 864e5); return i >= 0 && i < 7 ? i : 0; }
function stan(b, c) { return b < c.bMin ? ['za mało', 'zle'] : b > c.bMax ? ['za dużo', 'zle'] : ['w celu', 'ok']; }

// Na czas rysowania „przestawiam” plan i zużyte na wskazany tydzień (potem przywracam), żeby narysować oba tygodnie jeden pod drugim.
function zTygodniem(t, fn) {
  const p0 = plan, z0 = zuzyte;
  plan = { start: t.start, dni: t.dni }; zuzyte = t.zuz;
  try { return fn(); } finally { plan = p0; zuzyte = z0; }
}
const DNI_P = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
// Jeden wybrany dzień: nagłówek, liczby, ustawienia dnia i posiłki jako karty z obrazkami. Rysowane na „przestawionym” tygodniu (zTygodniem).
function kartaDnia(t, c, dzisIso, nawig) {
  const w = oblicz(plan, c); window._wBy[t.start] = w;
  const d = otwartyDzien, x = w.dni[d], day = plan.dni[d], iso = dodajDni(t.start, d), jestDzis = iso === dzisIso;
  const dzisRz = Math.round((new Date(dzisIso + 'T12:00:00') - dataDnia(0)) / 864e5), tydzDzis = dzisRz >= 0 && dzisRz <= 6;
  const sr = p => sredniaOsoby(w, p, 'b'), srK = p => sredniaOsoby(w, p, 'kcal');
  const biez = poniedzialek(), znacz = t.start === biez ? 'bieżący' : t.start === dodajDni(biez, 7) ? 'następny' : t.start < biez ? 'miniony' : '';
  let h = `<section data-wk="${t.start}"><div data-d="${d}">`;
  h += `<div class="dnia-gora"><button class="strz" data-pdzien="${nawig.prev || ''}" ${nawig.prev ? '' : 'disabled'} aria-label="Poprzedni dzień">‹</button>
    <div class="dnia-tyt"><h2>${DNI[d]}${jestDzis ? '<span class="dzis-znacz">dziś</span>' : ''}</h2><small>${dataDnia(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}${stanKto(day) !== 'oboje' ? ` · tylko ${stanKto(day) === 'bezon' ? 'ONA' : 'ON'}` : ''}</small></div>
    <button class="strz" data-pdzien="${nawig.next || ''}" ${nawig.next ? '' : 'disabled'} aria-label="Następny dzień">›</button></div>
    <div class="dnia-liczby">${OS.filter(p => !nieob(day, p)).map(p => `<div class="${p}"><b>${ETY[p]}</b><span>${r0(x[p].kcal)} kcal</span><small>${r0(x[p].b)} g białka</small></div>`).join('')}</div>
    <div class="dnia-ust"><div class="trening"><span class="mute">Trening:</span>${OS.map(p => `<label class="${p}"><input type="checkbox" data-tr="${d}:${p}" ${day.tr[p] ? 'checked' : ''}> ${ETY[p]}</label>`).join('')}</div>
      <div class="kto-dnia"><span class="mute">Kto je w tym dniu:</span><div class="seg mini">${[['oboje', 'Oboje'], ['bezon', 'Bez niego'], ['bezona', 'Bez niej']].map(([k, et]) => `<button data-kto="${d}:${k}" class="${stanKto(day) === k ? 'akt' : ''}">${et}</button>`).join('')}</div></div></div>`;
  x.sloty.forEach(({ g, odgrzewane }) => {
    const moje = g.porcje.filter(q => q.d === d), ez = !!zuzyte[kluczZ(d, g.slot)];
    const liczby = moje.map(q => { const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 }; return `<span class="${q.p}">${ETY[q.p]} ${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g</span>`; }).join('');
    let zn = '';
    if (odgrzewane) zn += `<span class="znaczek">odgrzewasz z ${DNI_KR[g.d]}</span> `;
    else if (new Set(g.porcje.map(q => q.d)).size > 1) zn += `<span class="znaczek">gotujesz na 2 dni</span> `;
    if (g.ratio) zn += g.wyrownane ? `<span class="znaczek">makro wyrównane po zamianie</span> ` : `<span class="znaczek ostrz">białko ${g.roznica > 0 ? '+' : '−'}${r0(Math.abs(g.roznica) / g.porcje.length)} g na porcję względem poprzedniego dania</span> `;
    if (g.dodatek) zn += `<span class="znaczek">+ skyr ${fq(g.dodatek.g, 'g')} obok dania</span> `;
    if (((g.sw || g.s) > 1.7 || (g.sw || g.s) < 0.55) && new Set(g.porcje.map(q => q.p)).size > 1) zn += `<span class="znaczek ostrz">porcja ×${(g.sw || g.s).toFixed(2)} względem przepisu</span>`;
    h += `<div class="pk ${ez ? 'zjedzone' : ''}"><div class="pk-pora">${g.slot === 'm13' && g.dish.typ !== 'koktajl' ? '13:00 · drugie danie' : PORA[g.slot]}${g.slot === 'm13ona' ? ' · ONA' : g.slot === 'm13on' ? ' · ON' : ''}</div>
      <div class="pk-gora">${Obr.html(g.dish)}<div class="pk-tx"><button class="nazwa" data-przepis="${w.garnki.indexOf(g)}:${d}">${oceny[g.dish.id] === 1 ? '★ ' : ''}${esc((g.dish.kod ? g.dish.kod + ' ' : '') + g.dish.nazwa)}</button><div class="liczby">${liczby}</div></div></div>
      ${zn ? `<div class="pk-zn">${zn}</div>` : ''}
      <div class="pk-akcje"><label class="zuzyj"><input type="checkbox" data-zuz="${d}:${g.slot}" ${ez ? 'checked' : ''}> zjedzone</label>${odgrzewane ? '' : `<button class="btn maly" data-zmien="${d}:${g.slot}">Zmień danie</button>`}</div></div>`;
  });
  const sh = OS.filter(p => day.tr[p] && !nieob(day, p));
  if (sh.length) h += `<div class="pk"><div class="pk-pora">po treningu · shake</div><div class="liczby">${sh.map(p => `<span class="${p}">${ETY[p]}: odżywka ${DB.shake[p].odzywka_g} g + mleko ${DB.shake[p].mleko_ml} ml · ${DB.shake[p].kcal} kcal · ${DB.shake[p].bialko} g</span>`).join('')}</div></div>`;
  const wi = wieczorem(w, d);
  if (wi.length) h += `<div class="wieczor"><b>Wieczorem przygotuj na jutro</b><ul>${wi.map(tt => `<li>${esc(tt)}</li>`).join('')}</ul></div>`;
  h += `</div>${tydzDzis ? przypomnieniaDzis(w) : ''}
    <details class="karta tyg-sum"><summary>Cały tydzień ${krotkaData(t.start)}–${krotkaData(dodajDni(t.start, 6))}${znacz ? ` <span class="znaczek">${znacz}</span>` : ''}</summary>
    <div class="cele">${OS.map(p => { const [tt, kl] = stan(sr(p), c[p]); return `<div class="cel ${p}"><b>${ETY[p]}</b><span class="duze">${r0(srK(p))} kcal</span>
      <small>średnio / dzień · cel ${c[p].kcal}</small><small>białko ${r0(sr(p))} g · cel ${c[p].bMin}–${c[p].bMax} g <span class="znak ${kl}">${tt}</span></small>${tt === 'za mało' ? `<button class="btn maly sug" data-sugestie="${p}">Jak poprawić?</button>` : ''}</div>`; }).join('')}</div>
    <button class="btn szeroki" data-nowy>Ułóż ten tydzień od nowa</button></details></section>`;
  return h;
}
function widokTydzien() {
  const c = cele(), dzisIso = isoDzis(), tyg = tygodnieZapisane();
  window._wBy = {};
  const wszystkie = tyg.flatMap(t => [0, 1, 2, 3, 4, 5, 6].map(d => ({ start: t.start, d, iso: dodajDni(t.start, d) })));
  let idx = wszystkie.findIndex(x => x.start === otwartyTyg && x.d === otwartyDzien);
  if (idx < 0) { idx = wszystkie.findIndex(x => x.iso === dzisIso); if (idx < 0) idx = 0; }
  const wyb = wszystkie[idx]; otwartyTyg = wyb.start; otwartyDzien = wyb.d;
  let h = `<h1>Plan</h1>` + wskazowka('plan', 'Wybierz dzień z paska. Każdy posiłek ma przepis i przycisk „Zmień danie” (gramatury dopasują się do kalorii). Gdy kogoś nie ma, wybierz „Bez niego” albo „Bez niej”. Pod paskiem są dwa tygodnie.');
  h += `<div class="pasek-dni" id="pasekDni">` + wszystkie.map((x, i) => `${x.d === 0 && i ? '<span class="pd-sep"></span>' : ''}<button class="pd ${i === idx ? 'akt' : ''} ${x.iso === dzisIso ? 'dzis' : ''}" data-pdzien="${x.start}:${x.d}"><small>${DNI_P[x.d]}</small><b>${new Date(x.iso + 'T12:00:00').getDate()}</b></button>`).join('') + `</div>`;
  const t = tyg.find(q => q.start === wyb.start);
  h += zTygodniem(t, () => kartaDnia(t, c, dzisIso, { prev: idx > 0 ? `${wszystkie[idx - 1].start}:${wszystkie[idx - 1].d}` : '', next: idx < wszystkie.length - 1 ? `${wszystkie[idx + 1].start}:${wszystkie[idx + 1].d}` : '' }));
  const biez = poniedzialek(), nast = dodajDni(biez, 7), ma = s => tyg.some(q => q.start === s);
  if (!ma(biez)) h += `<div class="karta dodaj-tyg"><b>Bieżący tydzień ${krotkaData(biez)}–${krotkaData(dodajDni(biez, 6))}</b><p class="mute">Nie jest jeszcze ułożony.</p><button class="btn glowny szeroki" id="nowyBiez">Ułóż bieżący tydzień</button></div>`;
  if (!ma(nast)) h += `<div class="karta dodaj-tyg"><b>Następny tydzień ${krotkaData(nast)}–${krotkaData(dodajDni(nast, 6))}</b><p class="mute">Nie jest jeszcze ułożony. Ułóż go tutaj — pojawi się na pasku dni za bieżącym, bez przełączania się między tygodniami.</p><button class="btn glowny szeroki" id="nowyNast">Ułóż następny tydzień</button></div>`;
  h += `<button class="btn glowny szeroki" id="doZakupow" style="margin-top:12px">Lista zakupów</button>`;
  $('#view').innerHTML = h;
  window._w = window._wBy[plan.start];
  const pas = $('#pasekDni'), ak = pas && pas.querySelector('.akt'); if (ak) pas.scrollLeft = ak.offsetLeft - pas.clientWidth / 2 + ak.clientWidth / 2;
}
const kluczZ = (d, slot, start = plan.start) => `${start}|${d}|${slot}`;
// jaka część garnka przypada na posiłek danego dnia (garnek na 2 dni dzieli się wg kcal)
const udzialDnia = (g, d) => sum(g.porcje.filter(q => q.d === d), q => q.kcal) / g.K;
// ile składnika schodzi z lodówki: sztuki, kromki i puszki tylko w całości (jak w przepisie: połówka w dół, minimum 1)
const ileZuzyto = (q, u, f = 1) => { const x = q * f; return (u === 'szt.' || u === 'krom.' || u === 'pusz.') ? Math.max(1, Math.ceil(x - 0.5 - 1e-9)) : Math.round(x * 100) / 100; };
const dniGarnka = g => [...new Set(g.porcje.map(q => q.d))];
const pozostalo = (g, start = plan.start, zuz = zuzyte) => sum(dniGarnka(g).filter(d => !zuz[kluczZ(d, g.slot, start)]), d => udzialDnia(g, d));
// zaznacza / cofa „zjedzone” dla posiłku (garnek g, dzień d) i odpowiednio zdejmuje / zwraca składniki w lodówce
function zjedz(g, d, on) {
  const k = kluczZ(d, g.slot);
  if (on) {
    if (zuzyte[k]) return;
    const f = udzialDnia(g, d), odj = {};
    for (const [pp, , q, uu] of skladGarnka(g)) if (lodowka[pp] && lodowka[pp][uu] != null) {
      const x = ileZuzyto(q, uu, f);
      zmienLodowke(pp, uu, -x); (odj[pp] = odj[pp] || {})[uu] = Math.round(((odj[pp][uu] || 0) + x) * 100) / 100;
    }
    zuzyte[k] = odj;
  } else {
    if (!zuzyte[k]) return;
    for (const [pp, us] of Object.entries(zuzyte[k])) for (const [uu, q] of Object.entries(us)) zmienLodowke(pp, uu, q);
    delete zuzyte[k];
  }
  LS.set('zuzyte', zuzyte); Z([[['zuzyte', k], on ? zuzyte[k] : undefined]]);
}
function przypomnieniaDzis(w) {
  const poz = [];
  const pr = prognoza(w);
  if (pr.length) poz.push(`<b>W lodówce zaczyna brakować:</b> ${pr.slice(0, 4).map(x => `${esc(x.produkt)} (${DNI_KR[x.d]})`).join(', ')}${pr.length > 4 ? ' i inne' : ''} <button class="btn maly" data-tab="lodowka">Lodówka</button>`);
  return poz.length ? `<div class="przyp">${poz.map(x => `<div>${x}</div>`).join('')}</div>` : '';
}
function wieczorem(w, d) {
  if (d >= 6) return [];
  const out = [];
  for (const { g, odgrzewane } of w.dni[d + 1].sloty) {
    if (odgrzewane) continue;
    if (g.dish.wieczorem && g.dish.wieczorem.length) out.push(`${g.dish.nazwa}: zrób kroki oznaczone WIECZOREM`);
    for (const i of g.dish.skladniki) {
      if (i.kategoria === 'zamrażarka' && i.ilosc && !/mrożon|paluszki|bułka/.test(i.produkt)) out.push(`wyjmij z zamrażarki do lodówki: ${i.produkt} ${fq(i.ilosc * skala(g, i), i.jednostka)} (${g.dish.nazwa})`);
    }
  }
  return out;
}

function oknoPrzepis(gi) { pokazPrzepis(window._w.garnki[gi], false); }
function pokazPrzepis(g, spont) {
  const dish = g.dish;
  spontG = spont ? g : null; spontWroc = !!spont;
  let wiersze = '', grupa = null;
  for (const i of dish.skladniki) {
    if (i.grupa && i.grupa !== grupa) { grupa = i.grupa; wiersze += `<tr class="grupa"><td colspan="2">${esc(grupa)}</td></tr>`; }
    wiersze += `<tr><td>${esc(i.nazwa)}${i.uwaga ? `<br><span class="mute">${esc(i.uwaga)}</span>` : ''}</td><td>${i.ilosc ? fq(i.ilosc * skala(g, i), i.jednostka) : ''}${i.orig ? `<br><span class="mute">≈ ${(n => ulamek(n) + ' ' + (n === 1 ? (i.orig.jednostka === 'łyż.' ? 'łyżka' : 'łyżeczka') : (i.orig.jednostka === 'łyż.' ? 'łyżki' : 'łyżeczki')))(Math.max(0.5, Math.round(i.ilosc * skala(g, i) / i.orig.g * 2) / 2))}</span>` : ''}${stala(i) ? '<br><span class="mute">woreczek z zamrażarki</span>' : ''}</td></tr>`;
  }
  // przyprawy i dodatki: osobne wiersze tabeli, z ilością albo „do smaku”
  const spr = przyprawyWiersze(dish);
  if (spr.length) wiersze += `<tr class="grupa"><td colspan="2">PRZYPRAWY I DODATKI</td></tr>` + spr.map(x => `<tr><td>${esc(x.nazwa)}${x.nota ? `<br><span class="mute">${esc(x.nota)}</span>` : ''}</td><td>${x.ilosc ? esc(x.ilosc) : '<span class="mute">do smaku</span>'}</td></tr>`).join('');
  if (g.dodatek) wiersze += `<tr class="grupa"><td colspan="2">DODATEK BIAŁKOWY — OBOK DANIA</td></tr><tr><td>skyr naturalny<br><span class="mute">wyrównuje białko po zamianie dania; dzielicie jak danie</span></td><td>${fq(g.dodatek.g, 'g')}</td></tr>`;
  const masa = dish.masa_g ? dish.masa_g * g.s : null;
  const pod = g.porcje.map(q => {
    let t = `${r0(q.udzial * 100)}% całości`;
    if (masa) t = q.p === 'ona' ? `nalej do szklanki na wadze ${r0(masa * q.udzial / 5) * 5} g` : 'reszta kielicha';
    if (g.dosypka && q.p === 'on') t += ` + dosypka: odżywka ${fq(DB.dosypka.odzywka * g.dosypka.skala, 'g')} i skyr ${fq(DB.dosypka.skyr * g.dosypka.skala, 'g')}`;
    const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 };
    return `<div class="${q.p}"><b>${ETY[q.p]}${new Set(g.porcje.map(x => x.d)).size > 1 ? ' · ' + DNI_KR[q.d] : ''}</b>${t}<br>${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g białka</div>`;
  }).join('');
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>${esc((dish.kod ? dish.kod + ' ' : '') + dish.nazwa)}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <div class="przepis-gora">${Obr.html(dish, 'duzy')}<div class="oceny">${przyciskiOceny(dish.id)}</div></div>
    <p class="mute">${dish.czas ? 'Czas: ' + esc(dish.czas) : ''}${dish.sprzet ? ' · Sprzęt: ' + esc(dish.sprzet) : ''}</p>
    ${dish.dodane ? '<p class="mute">Danie dodane do bazy — wartości liczone z tabel, nie z Twojego planu.</p>' : ''}
    <h3>Składniki — ${opisGarnka(g)}</h3>
    <table class="skl">${wiersze}</table>
    ${(dish.warianty || []).length ? `<h3>Glazura — wybierz jedną</h3>${dish.warianty.map(v => `<p><b>${esc(v.nazwa)}</b>: ${esc(v.sklad)}</p>`).join('')}` : ''}
    ${spont || g.slot === 'ob' ? '' : `<div class="rzad" style="margin-top:12px"><button class="btn maly" data-nudge="${g.d}:${g.slot}:-1">− białka w daniu</button><button class="btn maly" data-nudge="${g.d}:${g.slot}:1">+ białka w daniu</button></div><p class="mute">Zmienia proporcje składników przy tych samych kcal. Przeliczy się makro, lista zakupów i lodówka.</p>`}
    <h3>Kto ile bierze</h3><div class="podzial">${pod}</div>
    ${dish.kroki && dish.kroki.length ? `<h3>Wykonanie</h3><p class="mute">Gramy i mililitry w krokach są już przeliczone na Waszą porcję. Liczbę sztuk bierz z tabeli składników składników.</p><ol class="kroki">${dish.kroki.map(k => `<li>${esc(krokPrzeliczony(g, k))}</li>`).join('')}</ol>` : ''}
    ${dish.odgrzewanie ? `<p><b>Drugi dzień:</b> ${esc(dish.odgrzewanie)}</p>` : ''}
    ${dish.uwaga ? `<div class="uwaga">${esc(dish.uwaga)}</div>` : ''}
    ${spont ? `<button class="btn glowny szeroki" data-spont-gotuj="1" style="margin-top:14px">Ugotowaliśmy — zdejmij z lodówki</button>` : ''}`;
  $('#modal').hidden = false;
}

function przyciskiOceny(id) {
  return `<button class="btn maly ocena ${oceny[id] === 1 ? 'wl' : ''}" data-ocena="${esc(id)}:1">${oceny[id] === 1 ? '★ ulubione' : '☆ ulubione'}</button><button class="btn maly ocena ${ukryte(id) ? 'wl' : ''}" data-ocena="${esc(id)}:-1">${ukryte(id) ? 'ukryte — przywróć' : 'ukryj'}</button>`;
}
function szukany(x) { return x._szuk || (x._szuk = znorm(x.nazwa + ' ' + (x.kod || '') + ' ' + (x.skladniki || []).map(i => i.nazwa).join(' '))); }
const slowaZ = q => znorm(q).split(/[^a-z0-9]+/).filter(Boolean);
function oknoZmien(d, slot) {
  const day = plan.dni[d];
  const teraz = slot === 'm13' ? day.m13.wsp : slot === 'm13ona' ? day.m13.ona : slot === 'm13on' ? day.m13.on : day[slot];
  const tryb = slot === 'm13' && ((DB.dania.get(teraz) || {}).typ !== 'koktajl') ? 'dania' : 'kokt';
  const pula = slot === 'ob' ? (day.ob2 ? DB.pula.ob2 : DB.pula.ob1) : slot === 'm13' ? (tryb === 'kokt' ? DB.pula.m13kokt : DB.pula.m13dania) : DB.pula[slot];
  zmienCtx = { d, slot, teraz, pula };
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Zmień: ${slot === 'm13' ? 'drugie śniadanie' : esc(PORA[slot].split(' · ')[1])}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">${DNI[d]}. Kalorie zostają takie same, a gramatury nowego dania dobiorę tak, żeby białko też się zgadzało.</p>
    ${slot === 'm13' ? `<p class="mute" style="margin-bottom:6px">Na 13:00 pijecie koktajl czy jecie drugie danie?</p><div class="seg"><button data-tryb="kokt" class="${tryb === 'kokt' ? 'akt' : ''}">Koktajl</button><button data-tryb="dania" class="${tryb === 'dania' ? 'akt' : ''}">Drugie danie</button></div>` : ''}
    <label class="pole"><span>Szukaj po słowach (nazwa lub składnik, np. „kurczak ryż”)</span><input id="szukaj" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="np. kuskus"></label>
    <div id="lista-wyboru"></div>`;
  listaWyboru('');
  $('#modal').hidden = false;
}
function listaWyboru(q) {
  const { d, slot, teraz, pula } = zmienCtx;
  const slowa = slowaZ(q);
  const rang = x => oceny[x.id] === 1 ? 0 : ukryte(x.id) ? 2 : 1;
  const lista = pula.filter(x => slowa.every(w => szukany(x).includes(w))).sort((x, y) => rang(x) - rang(y) || x.nazwa.localeCompare(y.nazwa, 'pl'));
  $('#lista-wyboru').innerHTML = lista.length ? lista.map(x => `<div class="wiersz ${ukryte(x.id) ? 'ukryte' : ''}"><button class="wybor ${x.id === teraz ? 'teraz' : ''}" data-wybierz="${d}:${slot}:${esc(x.id)}">${Obr.html(x)}<span class="tx"><b>${oceny[x.id] === 1 ? '★ ' : ''}${esc((x.kod ? x.kod + ' ' : '') + x.nazwa)}</b>
      <span class="mute">${x.id === teraz ? 'obecnie w planie · ' : ''}${ukryte(x.id) ? 'ukryte · ' : ''}${x.tylko_wybor && slot !== 'm13' ? 'na świeżo, nie na wieczór wcześniej · ' : ''}${x.czas ? esc(x.czas) + ' · ' : ''}${r0(x.razem.bialko / x.razem.kcal * 1000) / 10} g białka na 100 kcal${x.dodane ? ' · dodane' : ''}</span></span></button>
      <div class="oceny">${przyciskiOceny(x.id)}</div></div>`).join('') : '<p class="pusty">Nic nie pasuje do tych słów.</p>';
}
function ocen(id, v) {
  if (oceny[id] === v) delete oceny[id]; else oceny[id] = v;
  LS.set('oceny', oceny);
  Z([[['oceny', id], oceny[id]]]);
  if ($('#modal').hidden) return rysuj();
  odroczone = true;   // po zamknięciu okna odświeżę widok (gwiazdki przy daniach)
  const y = $('#modal-box').scrollTop;
  if (zmienCtx && $('#szukaj')) listaWyboru($('#szukaj').value);
  else if ($('#spont-lista')) listaSpont();
  else document.querySelectorAll('.przepis-gora .oceny').forEach(el => { el.innerHTML = przyciskiOceny(id); });
  $('#modal-box').scrollTop = y;
}
// Ustawia danie i/lub docelowe białko na kcal w posiłku. Jeśli posiłek był już zjedzony, cofa zdjęte składniki starego dania
// i zdejmuje składniki nowego, więc lodówka, lista zakupów, makro i przepis zawsze mówią to samo.
function ustawDanie(d, slot, id, ratio) {
  const day = plan.dni[d], w0 = oblicz(plan, cele());
  const stary = w0.garnki.find(g => g.d === d && g.slot === slot);
  const jedzone = stary ? dniGarnka(stary).filter(dd => zuzyte[kluczZ(dd, slot)]) : [];
  jedzone.forEach(dd => zjedz(stary, dd, false));
  day.ratio = day.ratio || {};
  const zm = [];
  if (!stary || id !== stary.dish.id) {
    if (slot === 'm13') day.m13.wsp = id; else if (slot === 'm13ona') day.m13.ona = id; else if (slot === 'm13on') day.m13.on = id; else day[slot] = id;
    const pole = slot === 'm13' ? ['m13', 'wsp'] : slot === 'm13ona' ? ['m13', 'ona'] : slot === 'm13on' ? ['m13', 'on'] : [slot];
    zm.push([['dni', d, ...pole], id]);
  }
  if (ratio != null && isFinite(ratio)) { day.ratio[slot] = ratio; zm.push([['dni', d, 'ratio', slot], ratio]); }
  LS.set('plan', plan); Z(zm);
  if (jedzone.length) { const g2 = oblicz(plan, cele()).garnki.find(g => g.d === d && g.slot === slot); if (g2) jedzone.forEach(dd => zjedz(g2, dd, true)); }
}
function wybierz(d, slot, id) {
  const stary = oblicz(plan, cele()).garnki.find(g => g.d === d && g.slot === slot);
  const zmiana = stary && id !== stary.dish.id;
  ustawDanie(d, slot, id, zmiana ? stary.P / stary.K : null);      // nowe danie dostaje białko na kcal jak poprzednie
  odroczone = false; zmienCtx = null;
  $('#modal').hidden = true;
  rysuj();
}

// ---------- podpowiedzi: „za mało białka” ----------
let sugOsoba = null;
const opisPosilku = g => `${DNI_KR[g.d]} · ${PORA[g.slot].split(' · ')[1]}${g.slot === 'm13ona' ? ' (ONA)' : g.slot === 'm13on' ? ' (ON)' : ''}`;
const puleDla = g => { const day = plan.dni[g.d]; return g.slot === 'ob' ? (day.ob2 ? DB.pula.ob2 : DB.pula.ob1) : g.slot === 'm13' ? DB.pula.m13kokt.concat(DB.pula.m13dania) : DB.pula[g.slot]; };
function opcjeBialka(p, w) {
  const dostepne = w.garnki.filter(g => g.porcje.some(q => q.p === p) && !dniGarnka(g).some(dd => zuzyte[kluczZ(dd, g.slot)]));
  const prop = [], zamiany = [];
  const inny = OS.find(x => x !== p);   // druga osoba może wyrównać sobie białko własnymi posiłkami, więc wspólne dania nie są „zakazane”
  for (const g of dostepne) {
    const udz = sum(g.porcje.filter(q => q.p === p), q => q.udzial), udzI = sum(g.porcje.filter(q => q.p === inny), q => q.udzial), cur = g.P / g.K, wspolny = udzI > 0;
    const pkt = (n) => udz * (n.P - g.P) / 7;
    const maxr = rz(g.dish, g.K, 1, g.slot).P / g.K;
    if (maxr > cur + 0.002) {
      const r = cur + 0.6 * (maxr - cur), n = rz(g.dish, g.K, r, g.slot), zysk = pkt(n);
      if (zysk > 0.3 && n.a <= 1.8 * g.a + 1e-9 && n.b >= 0.5 * g.b) {   // bez absurdalnych zmian ilości
        const zm = [...n.lev].filter(i => i.ilosc).slice(0, 3).map(i => `${i.nazwa}: ${fq(i.ilosc * skala(g, i), i.jednostka)} → ${fq(i.ilosc * n.a, i.jednostka)}`);
        if (n.dodatek && !g.dodatek) zm.push(`+ skyr ${fq(n.dodatek.g, 'g')} obok dania`);
        prop.push({ g, r, zysk, zm, wspolny, real: udz * (n.P - g.P) / 7 });
      }
    }
    for (const c of puleDla(g)) {
      if (c.id === g.dish.id || ukryte(c.id)) continue;
      const mr = rz(c, g.K, 1, g.slot).P / g.K;
      if (mr <= cur + 0.002) continue;
      const r = cur + 0.7 * (mr - cur), n = rz(c, g.K, r, g.slot), zysk = pkt(n);
      if (zysk > 0.8) zamiany.push({ g, c, r, zysk, wspolny, real: udz * (n.P - g.P) / 7 });
    }
  }
  // najpierw posiłki tylko tej osoby (np. jej koktajl), potem wspólne dania; w obu grupach wg zysku
  const kol = (a, b) => (a.wspolny - b.wspolny) || b.zysk - a.zysk;
  prop.sort(kol); zamiany.sort(kol);
  return { prop, zamiany };
}
function autoPopraw(p) {
  let prop = 0, zam = 0;
  for (let i = 0; i < 60; i++) {
    const c = cele(), w = oblicz(plan, c);
    if (sredniaOsoby(w, p, 'b') >= c[p].bMin + 1) break;
    const o = opcjeBialka(p, w), a = o.prop[0], b = o.zamiany[0];
    if (a && (!b || a.wspolny <= b.wspolny)) { ustawDanie(a.g.d, a.g.slot, a.g.dish.id, a.r); prop++; }   // najpierw drobne zmiany gramatur
    else if (b && zam < 3) { ustawDanie(b.g.d, b.g.slot, b.c.id, b.r); zam++; }                         // potem wymiana dania (najwyżej 3 dania)
    else break;
  }
  return { prop, zam };
}
function oknoSugestie(p, ile) {
  sugOsoba = p;
  const c = cele(), w = oblicz(plan, c), sr = sredniaOsoby(w, p, 'b'), brak = c[p].bMin - sr, o = opcjeBialka(p, w);
  let h = `<div class="okno-gora"><h2 class="${p}">Białko — ${ETY[p]}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>`;
  if (ile !== undefined) h += `<div class="uwaga">${ile.prop || ile.zam ? `Dopasowałem proporcje w ${ile.prop} ${ile.prop === 1 ? 'daniu' : 'daniach'}${ile.zam ? ` i wymieniłem ${ile.zam} ${ile.zam === 1 ? 'danie' : 'dania'}` : ''}.` : 'Nie ma już czego poprawić.'}</div>`;
  if (brak <= 0) h += `<p>Średnio ${r0(sr)} g dziennie — to już w celu (min. ${c[p].bMin} g).</p>`;
  else h += `<p>Średnio ${r0(sr)} g dziennie, cel min. ${c[p].bMin} g. Brakuje ok. <b>${r0(brak)} g</b> dziennie. Kalorie zostają bez zmian, a przeliczą się gramatury, lista zakupów i lodówka.</p>
    <button class="btn glowny szeroki" data-auto-popraw="${p}">Popraw automatycznie</button><p class="mute">Najpierw lekko zmienia gramatury składników w daniach, a jeśli to za mało — wymienia dania na bogatsze w białko.</p>`;
  h += `<h3>Zmień proporcje w daniu</h3>` + (o.prop.length ? o.prop.slice(0, 5).map(x => `<div class="karta"><b>${esc(opisPosilku(x.g))}</b> — ${esc(x.g.dish.nazwa)}<br><span class="mute">${x.zm.length ? esc(x.zm.join(' · ')) : 'więcej składników białkowych kosztem reszty'}</span><br><span class="znak ok">+${(Math.round(x.real * 10) / 10).toString().replace('.', ',')} g / dzień</span>${x.wspolny ? ' <span class="mute">· wspólne danie, zmieni też porcję drugiej osoby</span>' : ` <span class="mute">· tylko ${ETY[p]}</span>`}
    <button class="btn maly" style="float:right" data-sug="${x.g.d}|${x.g.slot}|${esc(x.g.dish.id)}|${x.r}">Zastosuj</button></div>`).join('') : '<p class="mute">Nic więcej nie da się dopasować w obecnych daniach.</p>');
  h += `<h3>Wymień danie jednym kliknięciem</h3>` + (o.zamiany.length ? o.zamiany.slice(0, 6).map(x => `<div class="karta"><b>${esc(opisPosilku(x.g))}</b><br>${esc(x.g.dish.nazwa)} → <b>${esc(x.c.nazwa)}</b><br><span class="znak ok">+${(Math.round(x.real * 10) / 10).toString().replace('.', ',')} g / dzień</span>${x.wspolny ? ' <span class="mute">· wspólne danie, dotyczy też drugiej osoby</span>' : ` <span class="mute">· tylko ${ETY[p]}</span>`}
    <button class="btn maly" style="float:right" data-sug="${x.g.d}|${x.g.slot}|${esc(x.c.id)}|${x.r}">Wymień</button></div>`).join('') : '<p class="mute">Brak lepszych zamienników.</p>');
  $('#modal-box').innerHTML = h;
  $('#modal').hidden = false;
}

const dzienTxt = iso => `${DNI_KR[(new Date(iso + 'T12:00:00').getDay() + 6) % 7]} ${krotkaData(iso)}`;
function kartaMiesa(z) {
  const dzis = isoDzis(), poz = z.wynik['zamrażarka'].filter(p => p.worki && p.worki.length);
  if (!poz.length) return '';
  const dniDo = dt => Math.round((new Date(dt + 'T12:00:00') - new Date(dzis + 'T12:00:00')) / 864e5);
  let h = `<h2>Mięso i ryby — jak podzielić po zakupach</h2><div class="karta"><p class="mute">Woreczki są ułożone od tego, który pójdzie do garnka pierwszy. Co zjesz w ciągu 2 dni, zostaje w lodówce (nie mrozisz). Resztę mrozisz tak, żeby <b>najwcześniej potrzebny był na wierzchu</b>, a najpóźniejszy na dnie. Jeden woreczek = jedno danie, zawsze ta sama waga.</p>`;
  for (const p of poz) {
    const b = p.worki.slice().sort((x, y) => x.dt.localeCompare(y.dt) || y.g - x.g), suma = b.reduce((s, x) => s + x.g, 0);
    h += `<h3>${esc(p.produkt)} · razem ${suma} g</h3><ol class="worki">` + b.map((x, i) => {
      const lod = dniDo(x.dt) <= 2;
      return `<li><b>${x.g} g</b> <span class="znaczek ${lod ? '' : 'mroz'}">${lod ? 'LODÓWKA' : 'ZAMRAŻARKA'}</span> ${dzienTxt(x.dt)} · ${esc(x.dish.length > 34 ? x.dish.slice(0, 32) + '…' : x.dish)}${i === 0 ? '<small>pierwszy do użycia</small>' : ''}<small>etykieta: ${esc(p.produkt.replace(/ filet| mielon\w*/g, ''))} ${x.g} g · ${dzienTxt(x.dt)}</small></li>`;
    }).join('') + `</ol>`;
  }
  return h + `<ul class="mute" style="margin:8px 0 0;padding-left:18px"><li>Woreczki strunowe, mięso rozpłaszczone na płasko; ważysz na wadze kuchennej.</li><li>Rozmrażanie w lodówce wieczorem dzień wcześniej (apka przypomni w „Wieczorem przygotuj”); rozmrożonego surowego mięsa nie mrozisz ponownie.</li><li>Mięso i ryby zjadaj w ciągu ok. 3 miesięcy.</li></ul></div>`;
}
let zakOtw = false;
// „sob 21.11 – pon 23.11” zamiast listy dat (zakresy ciągłe, reszta po przecinku)
function zakresDni(wyb) {
  const d = [...wyb].sort(); if (!d.length) return 'nic nie zaznaczono';
  const grupy = []; d.forEach(x => { const g = grupy[grupy.length - 1]; if (g && dodajDni(g[g.length - 1], 1) === x) g.push(x); else grupy.push([x]); });
  return grupy.map(g => g.length === 1 ? dzienTxt(g[0]) : `${dzienTxt(g[0])} – ${dzienTxt(g[g.length - 1])}`).join(', ');
}
function widokZakupy() {
  const dost = dniDostepne(), wyb = wybraneDni(), z = zakupyDni(wyb), dzis = isoDzis();
  const klucz = kluczKup;
  let h = `<h1>Zakupy</h1>${wskazowka('zakupy', 'Zaznacz dni, na które kupujecie — lista sama się policzy. W sklepie odhaczaj pozycje: kupione trafiają do lodówki, a odhaczone spadają na koniec.')}<details class="karta wybor-dni" data-zakdni ${zakOtw || !wyb.size ? 'open' : ''}><summary><span class="wd-tx"><small>Zakupy na</small><b>${zakresDni(wyb)}</b></span><span class="wd-zmien">Zmień dni</span></summary><div class="rzad-nag"><h3 style="margin:0">Na które dni kupujecie?</h3><span class="chips"><button class="chip" data-zakpreset="auto">Najbliższe zakupy</button><button class="chip" data-zakpreset="zero">Wyczyść</button></span></div>
    <p class="mute" style="margin:6px 0 4px">Kliknij dni, na które robicie zakupy. Danie na kilka dni (np. zupa na 2 dni) kupujesz w całości, bez dzielenia. Dni „bez niego / bez niej” z planu są uwzględnione.</p>`;
  for (const t of tygodnieZapisane()) {
    const dniT = dost.filter(x => x.start === t.start), wszystkie = dniT.every(x => wyb.has(x.iso));
    h += `<div class="tyg-nag"><b>${krotkaData(t.start)}–${krotkaData(dodajDni(t.start, 6))}</b><button class="chip ${wszystkie ? 'akt' : ''}" data-zakweek="${t.start}">cały tydzień</button></div>`;
    h += dniT.map(x => {
      const on = wyb.has(x.iso), ob = x.day.ob && DB.dania.get(x.day.ob), prev = x.d > 0 && t.dni[x.d - 1].ob2 && DB.dania.get(t.dni[x.d - 1].ob);
      const opis = ob ? ob.nazwa : prev ? 'obiad z poprzedniego dnia' : '';
      const kto = stanKto(x.day) !== 'oboje' ? `<span class="znaczek">tylko ${stanKto(x.day) === 'bezon' ? 'ONA' : 'ON'}</span>` : '';
      return `<button class="dz-wiersz ${on ? 'akt' : ''} ${x.iso < dzis ? 'minal' : ''}" data-zakdzien="${x.iso}"><span class="dz-d"><b>${DNI_KR[x.d]}</b> ${krotkaData(x.iso)}${x.iso === dzis ? '<em class="dzis-znacz">dziś</em>' : ''}</span><span class="dz-o">${esc(opis)} ${kto}</span><span class="ptak">${on ? '✓' : ''}</span></button>`;
    }).join('');
  }
  h += `</details>`;
  if (!wyb.size) h += `<p class="pusty">Zaznacz przynajmniej jeden dzień.</p>`;
  const razemPoz = ['świeże', 'zamrażarka', 'zapas'].reduce((a, k) => a + z.wynik[k].length, 0), kupione = ['świeże', 'zamrażarka', 'zapas'].reduce((a, k) => a + z.wynik[k].filter(p => odhK(klucz(p.produkt))).length, 0);
  if (razemPoz) h += `<div class="postep-zak"><div class="pasek"><i style="width:${Math.round(kupione / razemPoz * 100)}%"></i></div><small>Kupione ${kupione} z ${razemPoz} pozycji</small></div>`;
  const nazwy = { 'świeże': 'Świeże', 'zapas': 'Zapas — sprawdź, czy masz', 'zamrażarka': 'Do zamrażarki' };
  for (const kat of ['świeże', 'zamrażarka', 'zapas']) {
    if (!z.wynik[kat].length) continue;
    h += `<h2>${nazwy[kat]}</h2><div class="karta">` + z.wynik[kat].slice().sort((a, b) => !!odhK(klucz(a.produkt)) - !!odhK(klucz(b.produkt))).map(p => {   // odhaczone na sam koniec (sort jest stabilny)
      const k = klucz(p.produkt), on = !!odhK(k);
      const zw = p.pomysly && (p.pomysly.wPlanie.length || p.pomysly.pomysly.length) ? `<small class="zw">Zostanie ${p.reszta.q} ${p.reszta.u} — nie zmarnuj:${p.pomysly.wPlanie.length ? ` w planie: ${esc(p.pomysly.wPlanie.join('; '))}.` : ''}${p.pomysly.pomysly.length ? ` Pomysły: ${esc(p.pomysly.pomysly.join('; '))}.` : ''}</small>` : '';
      return `<label class="poz ${on ? 'kupione' : ''}"><input type="checkbox" data-kup="${esc(k)}" ${on ? 'checked' : ''}><span class="co"><b>${esc(p.produkt)}</b> — ${esc(p.ile)}${p.dop ? `<small>${esc(p.dop)}</small>` : ''}${p.stan ? `<small>w lodówce: ${esc(p.stan)}</small>` : ''}${zw}</span></label>`;
    }).join('') + `</div>`;
  }
  h += kartaMiesa(z);
  if (z.wynik.masz.length) h += `<h2>Masz już w lodówce</h2><div class="karta">${z.wynik.masz.map(p => `<p><b>${esc(p.produkt)}</b> <span class="mute">— potrzeba ${esc(p.ile)}, masz ${esc(p.stan)}</span></p>`).join('')}</div>`;
  if (z.inne.length) h += `<h2>Bez gramatury</h2><div class="karta">${z.inne.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (z.przyprawy.length) h += `<h2>Przyprawy i dodatki</h2><div class="karta"><p class="mute">Sprawdź w szafce:</p>${z.przyprawy.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (['świeże', 'zamrażarka', 'zapas'].some(k => z.wynik[k].some(p => !odhK(klucz(p.produkt))))) h += `<button class="btn szeroki" id="kupWszystko" style="margin-bottom:8px">Kupione wszystko — dopisz do lodówki</button>`;
  if (Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).some(k => k.startsWith('zak|'))) h += `<button class="btn szeroki" id="odznaczWszystko" style="margin-bottom:8px">Odznacz wszystko — usuń z lodówki</button>`;
  h += `<button class="btn glowny szeroki" id="udostepnij">Udostępnij listę</button>`;
  $('#view').innerHTML = h;
  window._z = z;
}
// Odhaczenie zakupu: kupiona ilość trafia do lodówki (i jest zapamiętana w odhaczone, żeby dało się ją cofnąć).
function odhaczKup(k, on) {
  const prod = k.slice(4), prev = odhK(k);   // klucz: zak|produkt
  if (on) {
    if (prev) return;
    const poz = Object.values(window._z.wynik).flat().find(x => x.produkt === prod && x.kupno), kup = poz ? poz.kupno : {};
    for (const [u, q] of Object.entries(kup)) zmienLodowke(prod, u, q);
    odhaczone[k] = kup;
  } else {
    if (!prev) return;
    if (typeof prev === 'object') {
      for (const [u, q] of Object.entries(prev)) zmienLodowke(prod, u, -q);
      for (const u of Object.keys(prev)) if (lodowka[prod] && Math.abs(lodowka[prod][u]) < 0.01) { delete lodowka[prod][u]; Z([[['lodowka', prod, u], undefined]]); }   // wyzerowane pozycje znikają z lodówki
      if (lodowka[prod] && !Object.keys(lodowka[prod]).length) delete lodowka[prod];
      LS.set('lodowka', lodowka);
    }
    delete odhaczone[k];
    if (inny && inny.odhaczone && inny.odhaczone[k]) { delete inny.odhaczone[k]; LS.set('inny', inny); Z([[['inny', 'odhaczone', k], undefined]]); }
  }
  Z([[['odhaczone', k], on ? odhaczone[k] : undefined]]);
}
function tekstListy() {
  const z = window._z, n = { 'świeże': 'ŚWIEŻE', 'zamrażarka': 'ZAMRAŻARKA', 'zapas': 'ZAPAS' }, dni = [...z.wyb].sort();
  let t = `Zakupy na: ${dni.map(dzienTxt).join(', ')}\n`;
  for (const kat of ['świeże', 'zamrażarka', 'zapas']) if (z.wynik[kat].length) t += `\n${n[kat]}\n` + z.wynik[kat].map(p => `- ${p.produkt}: ${p.ile}${p.dop ? ' (' + p.dop + ')' : ''}`).join('\n') + '\n';
  return t;
}

function widokUstawienia(pierwszy) {
  const p0 = profil || { ona: { plec: 'k', akt: '1.375', cel: 'redukcja' }, on: { plec: 'm', akt: '1.375', cel: 'redukcja' } };
  const pole = (p, k, et, typ = 'number', dod = '') => `<label class="pole"><span>${et}</span><input type="${typ}" inputmode="decimal" data-p="${p}" data-k="${k}" value="${esc(p0[p][k] ?? '')}" ${dod || `placeholder="${{ wiek: 'np. 30', waga: 'np. 62', wzrost: 'np. 168' }[k] || ''}"`}></label>`;
  const blok = p => `<div class="karta"><h2 class="${p}" style="margin-top:0">${ETY[p]}</h2>
    <div class="dwa">${pole(p, 'wiek', 'Wiek (lata)')}${pole(p, 'waga', 'Waga (kg)')}</div>
    <div class="dwa">${pole(p, 'wzrost', 'Wzrost (cm)')}<label class="pole"><span>Płeć</span><select data-p="${p}" data-k="plec"><option value="k" ${p0[p].plec === 'k' ? 'selected' : ''}>kobieta</option><option value="m" ${p0[p].plec === 'm' ? 'selected' : ''}>mężczyzna</option></select></label></div>
    <label class="pole"><span>Aktywność</span><select data-p="${p}" data-k="akt">${AKT.map(([v, t]) => `<option value="${v}" ${p0[p].akt === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="pole"><span>Cel diety</span><select data-p="${p}" data-k="cel">${Object.entries(CEL).map(([v, t]) => `<option value="${v}" ${p0[p].cel === v ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>
    ${pole(p, 'wlasne', 'Własny cel kcal (opcjonalnie — zastępuje wyliczenie)', 'number', 'placeholder="np. 1750"')}
    <div class="wynik ${p}" data-wynik="${p}"></div></div>`;
  $('#view').innerHTML = `${pierwszy ? `<div class="witaj"><div class="logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h1>Plan</h1><p class="lead">Jedzenie dla Was dwojga. Układam tydzień pod Wasze kalorie i białko, a do tego lista zakupów i lodówka.</p>
      <ul class="plusy"><li><b>Bez liczenia.</b> Wpisujesz wzrost i wagę, resztę robi apka.</li><li><b>Zakupy w minutę.</b> Lista sama się liczy, mięso dostaje instrukcję podziału.</li><li><b>Zero marnowania.</b> Lodówka podpowiada, co ugotować z tego, co macie.</li></ul></div>
      <h2 class="krok"><span>1</span>Powiedz mi o Was</h2>` : '<h1>Ustawienia</h1>'}
    <p class="mute">Z tych danych liczę dzienne zapotrzebowanie (wzór Mifflina-St Jeora) i pod nie układam tydzień. To szacunek, nie zalecenie medyczne.</p>
    ${blok('ona')}${blok('on')}
    ${pierwszy ? '<h2 class="krok"><span>2</span>Gotowe? Ułóż tydzień</h2>' : ''}
    <button class="btn glowny szeroki" id="zapisz">${pierwszy ? 'Ułóż mój tydzień' : 'Zapisz i przelicz plan'}</button>
    ${pierwszy ? `<details class="faq" style="margin-top:18px"><summary>Druga osoba już założyła plan? Dołącz</summary>${kartaDolacz()}</details>` : ''}
    ${pierwszy ? '' : kartaUkryte() + kartaWspolny() + `<h2>Baza dań</h2><div class="karta"><p>${DB.dania.size} dań w bazie (w tym ${[...DB.dania.values()].filter(d => d.dodane).length} dodanych poza planem z PDF-ów).</p><p class="mute">Nowe dania pojawiają się po odświeżeniu aplikacji.</p>
    <div class="rzad"><button class="btn" id="odswiez">Odśwież bazę</button><button class="btn" id="wyczysc">Wyczyść dane</button></div></div><h2>Aplikacja</h2><div class="karta"><p class="mute">Nowa wersja pobiera się sama, gdy wracasz do aplikacji. Jeśli mimo to widzisz starą, wymuś aktualizację — plan i dane zostają.</p><button class="btn szeroki" id="aktualizuj">Zaktualizuj aplikację</button><p class="mute" id="wersja"></p></div>`}`;
  const zbierz = () => { const o = { ona: {}, on: {} }; document.querySelectorAll('[data-p]').forEach(el => { const v = el.value.trim().replace(',', '.'); o[el.dataset.p][el.dataset.k] = el.tagName === 'SELECT' ? v : (v === '' ? null : +v); }); return o; };
  const podglad = () => { const o = zbierz(); OS.forEach(p => { const z = zapotrzebowanie(o[p]); $(`[data-wynik="${p}"]`).innerHTML = z ? `<b>${z.kcal} kcal / dzień</b> · białko ${z.bMin}–${z.bMax} g<br><span class="mute">podstawowa przemiana ${z.bmr} kcal · z aktywnością ${z.cpm} kcal</span>` : '<span class="mute">Podaj wiek, wagę i wzrost.</span>'; }); };
  $('#view').oninput = podglad; podglad();
  formStart = JSON.parse(JSON.stringify(p0));
  $('#zapisz').onclick = () => {
    const o = zbierz();
    if (!zapotrzebowanie(o.ona) || !zapotrzebowanie(o.on)) { alert('Uzupełnij wiek, wagę i wzrost dla obojga.'); return; }
    // zapisuję tylko osobę, której dane ktoś tu zmienił — nie nadpiszę zmian zrobionych w tym czasie na drugim telefonie
    const zmienione = OS.filter(p => !profil || stabilny(o[p]) !== stabilny(formStart[p]));
    profil = { ona: zmienione.includes('ona') ? o.ona : profil.ona, on: zmienione.includes('on') ? o.on : profil.on };
    LS.set('profil', profil);
    Z(zmienione.map(p => [['profil', p], o[p]]));
    if (!planAktualny()) ulozTydzien();
    zakladka = pierwszy ? 'dzis' : 'tydzien'; rysuj(); window.scrollTo(0, 0);
  };
  if (!pierwszy) {
    $('#odswiez').onclick = async () => { await wczytajBaze(); rysuj(); };
    if (window.caches) caches.keys().then(ks => { const e = $('#wersja'); if (e) e.textContent = 'Wersja: ' + (ks.find(k => k.startsWith('plan-')) || 'brak'); }).catch(() => {});
    $('#wyczysc').onclick = () => {
      if (!confirm('Usunąć zapisane dane, plan i odhaczone zakupy z tego telefonu?' + (window.Sync && window.Sync.kod ? ' Telefon zostanie odłączony od wspólnego planu — u drugiej osoby plan zostaje.' : ''))) return;
      if (window.Sync && window.Sync.kod) window.Sync.odlacz();
      ['profil', 'plan', 'odhaczone', 'oceny', 'waga', 'lodowka', 'zuzyte', 'inny', 'tury', 'zakWlasne', 'zakDni'].forEach(LS.del); profil = plan = inny = null; odhaczone = {}; oceny = {}; waga = { ona: {}, on: {} }; lodowka = {}; zuzyte = {}; rysuj();
    };
  }
}

// ---------- wspólny plan ----------
function opisSync() {
  const S = window.Sync;
  if (!S) return '';
  const t = {
    brak: 'Plan zapisany tylko na tym telefonie.', lokalny: 'Plan zapisany tylko na tym telefonie.', start: '',
    laczenie: 'Łączę ze wspólnym planem…', polaczony: '✓ Wspólny plan — zmiany widać na obu telefonach na bieżąco.',
    offline: 'Wspólny plan — brak sieci, zmiany wyślę, gdy wróci.', blad: 'Problem z połączeniem.'
  }[S.stan] || '';
  return esc(t) + (S.blad ? ` <span class="ostrz-txt">${esc(S.blad)}</span>` : '');
}
function kartaDolacz() {
  const S = window.Sync;
  if (!S || !S.dostepny) return '';
  return `<div class="karta"><h2 style="margin-top:0">Masz już wspólny plan?</h2>
    <p class="mute">Jeśli druga osoba założyła plan, wklej kod albo link od niej — wtedy niczego poniżej nie wypełniasz.</p>
    <label class="pole"><span>Kod lub link</span><input id="kodDom" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <button class="btn szeroki" id="dolacz">Dołącz</button><p class="mute" id="sync-status">${opisSync()}</p></div>`;
}
function kartaWspolny() {
  const S = window.Sync;
  let h = `<h2>Wspólny plan</h2><div class="karta"><p id="sync-status">${opisSync()}</p>`;
  if (!S || !S.dostepny) h += `<p class="mute">Praca na jednym planie z dwóch telefonów wymaga jednorazowego podłączenia darmowej bazy (Firebase). Dopóki jej nie ma, plan zostaje tylko na tym telefonie.</p>`;
  else if (!S.kod) h += `<p class="mute">Udostępnij plan drugiej osobie — oboje będziecie widzieć i zmieniać ten sam tydzień, profile i listę zakupów na bieżąco.</p>
    <button class="btn glowny szeroki" id="udostepnijPlan">Udostępnij plan</button>
    <label class="pole"><span>…albo dołącz do planu drugiej osoby: kod lub link</span><input id="kodDom" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <button class="btn szeroki" id="dolacz">Dołącz</button>`;
  else h += `<p class="mute">Kod planu: <b>${esc(S.kod)}</b></p>
    <div class="rzad"><button class="btn glowny" id="wyslijLink">Wyślij zaproszenie</button><button class="btn" id="odlacz">Odłącz ten telefon</button></div>`;
  return h + '</div>';
}
function wyslijZaproszenie() {
  const S = window.Sync, link = S.link();
  const tekst = `Dołącz do naszego wspólnego planu w apce Plan.\nOtwórz link: ${link}\nAlbo w apce wklej kod w polu „Dołącz”: ${S.kod}`;
  if (navigator.share) navigator.share({ title: 'Wspólny plan', text: tekst }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(tekst).then(() => alert('Zaproszenie skopiowane — wyślij je SMS-em albo komunikatorem.'), () => alert(tekst));
  else alert(tekst);
}
function zamknijOkno() {
  zmienCtx = null;
  if (spontWroc) { spontWroc = false; spontG = null; oknoSpont(); return; }
  $('#modal').hidden = true;
  if (odroczone) { odroczone = false; rysuj(); }
}

// ---------- podpowiedzi i start dla nowych osób ----------
const wskazowka = (id, tekst) => wskazowki[id] ? '' : `<div class="wskazowka"><span class="wsk-et">Wskazówka</span><p>${tekst}</p><button class="btn maly" data-wsk="${id}">Rozumiem</button></div>`;
const KROKI_INTRO = [
  ['Witaj w Planie', 'Układam jedzenie dla Was dwojga: pod Wasze kalorie i białko, z listą zakupów i lodówką. Nie musisz niczego liczyć.', 'M4 12.5l5 5L20 7'],
  ['Dziś', 'Zakładka „Dziś” pokazuje, co jeść teraz i co przygotować wieczorem. Zaznacz „zjedzone”, a składniki same znikną z lodówki.', 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4'],
  ['Plan na dwa tygodnie', 'Nie pasuje Ci danie? Kliknij „zmień”. Gdy kogoś nie ma w danym dniu, wybierz „Bez niego” albo „Bez niej” — porcje i zakupy się przeliczą.', 'M5 6h14M5 12h14M5 18h9'],
  ['Zakupy bez liczenia', 'Zaznacz dni, na które kupujecie, i gotowe. W sklepie odhaczaj pozycje — trafiają do lodówki. Mięso dostaje instrukcję podziału na woreczki.', 'M5 8.5h14l-1.2 11.5H6.2zM9 8.5a3 3 0 0 1 6 0'],
  ['Lodówka i „co z tego ugotować”', 'Wpisz, co macie w domu, a apka podpowie dania, które można zrobić od ręki. Resztki z zakupów podpowiem, jak zużyć.', 'M7 3h10v18H7zM7 10.5h10']
];
function pokazIntro(n) {
  const k = KROKI_INTRO[n], ost = n === KROKI_INTRO.length - 1;
  $('#modal-box').innerHTML = `<div class="intro"><div class="intro-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${k[2]}"/></svg></div><h2>${k[0]}</h2><p>${k[1]}</p>
    <div class="kropki">${KROKI_INTRO.map((_, i) => `<i class="${i === n ? 'akt' : ''}"></i>`).join('')}</div>
    <div class="rzad">${ost ? '' : `<button class="btn" data-zamknij>Pomiń</button>`}<button class="btn glowny" ${ost ? 'data-zamknij' : `data-intro="${n + 1}"`}>${ost ? 'Zaczynamy' : 'Dalej'}</button></div></div>`;
  $('#modal').hidden = false;
}
const GODZ = { sn: 11, m13: 13, m13ona: 13, m13on: 13, ob: 17, k18: 18 };
function widokDzis() {
  const dzis = isoDzis(), c = cele(), teraz = new Date(), godz = teraz.getHours() + teraz.getMinutes() / 60;
  const pow = godz < 5 ? 'Dobranoc' : godz < 11 ? 'Dzień dobry' : godz < 18 ? 'Cześć' : 'Dobry wieczór';
  const dataTxt0 = teraz.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }), dataTxt = dataTxt0.charAt(0).toUpperCase() + dataTxt0.slice(1);
  const t = tygodnieZapisane().find(x => dzis >= x.start && dzis <= dodajDni(x.start, 6));
  window._wBy = {};
  let h = `<div class="hero-gora"><small>${esc(dataTxt)}</small><h1>${pow}!</h1></div>` + wskazowka('dzis', 'Tu jest Twój dzień: co jeść teraz i co przygotować. Zaznacz „zjedzone” przy posiłku, a apka sama odejmie składniki z lodówki. Cały plan jest w zakładce „Plan”.');
  if (!t) {
    h += `<div class="karta pusta-karta"><b>Na dziś nie ma jeszcze planu</b><p class="mute">Ułóż tydzień, a pokażę tu, co jeść i kiedy.</p><button class="btn glowny szeroki" id="nowyBiez">Ułóż bieżący tydzień</button></div>`;
    $('#view').innerHTML = h; return;
  }
  h += zTygodniem(t, () => {
    const w = oblicz(plan, c); window._wBy[t.start] = w;
    const d = Math.round((new Date(dzis + 'T12:00:00') - new Date(t.start + 'T12:00:00')) / 864e5), x = w.dni[d], day = plan.dni[d];
    const zjedz_ = g => !!zuzyte[kluczZ(d, g.slot)];
    const sloty = x.sloty;
    const nast = sloty.find(({ g }) => !zjedz_(g) && (GODZ[g.slot] || 12) >= godz - 1.5) || sloty.find(({ g }) => !zjedz_(g));
    let o = `<section data-wk="${t.start}"><div data-d="${d}">`;
    if (nast) {
      const g = nast.g, moje = g.porcje.filter(q => q.d === d);
      o += `<div class="hero"><span class="hero-et">${(GODZ[g.slot] || 12) >= godz - 1.5 ? 'Następny posiłek' : 'Jeszcze niezjedzone'} · ${g.slot === 'm13' && g.dish.typ !== 'koktajl' ? '13:00' : PORA[g.slot].split(' · ')[0]}</span>
        <div class="hero-dan">${Obr.html(g.dish, 'duzy')}<div><b>${esc((g.dish.kod ? g.dish.kod + ' ' : '') + g.dish.nazwa)}</b>${nast.odgrzewane ? `<small>odgrzewasz z ${DNI_KR[g.d]}</small>` : ''}</div></div>
        <div class="hero-liczby">${moje.map(q => `<span>${ETY[q.p]} ${r0(q.kcal + (g.dosypka && q.p === 'on' ? g.dosypka.kcal : 0))} kcal · ${r0(q.b + (g.dosypka && q.p === 'on' ? g.dosypka.b : 0))} g białka</span>`).join('')}</div>
        <div class="rzad"><button class="btn hero-btn" data-przepis="${w.garnki.indexOf(g)}:${d}">Zobacz przepis</button>${nast.odgrzewane ? '' : `<button class="btn hero-btn jasny" data-zmien="${d}:${g.slot}">Zmień danie</button>`}</div></div>`;
    } else o += `<div class="hero ok"><span class="hero-et">Dziś</span><div class="hero-dan"><div><b>Wszystko zjedzone. Dobra robota!</b><small>Jutro zajrzyj tu po kolejny dzień.</small></div></div></div>`;
    // postęp dnia
    const zjed = p => sum(sloty.filter(({ g }) => zjedz_(g)), ({ g }) => sum(g.porcje.filter(q => q.d === d && q.p === p), q => q.kcal + (g.dosypka && p === 'on' ? g.dosypka.kcal : 0)));
    o += `<div class="postep">${OS.filter(p => !nieob(day, p)).map(p => { const cel = x[p].kcal, z = zjed(p), pr = cel ? Math.min(100, Math.round(z / cel * 100)) : 0; return `<div class="${p}"><b>${ETY[p]}</b><div class="pasek"><i style="width:${pr}%"></i></div><small>${r0(z)} / ${r0(cel)} kcal</small></div>`; }).join('')}</div>`;
    // lista posiłków
    o += `<h2>Dzisiejsze posiłki</h2><div class="karta posilki-dnia">` + sloty.map(({ g, odgrzewane }) => {
      const moje = g.porcje.filter(q => q.d === d), ez = zjedz_(g), gl = g.slot === 'm13' && g.dish.typ !== 'koktajl' ? '13:00 · drugie danie' : PORA[g.slot];
      return `<div class="pos-wiersz ${ez ? 'zjedzone' : ''} ${nast && nast.g === g ? 'nast' : ''}"><label class="pos-ptak"><input type="checkbox" data-zuz="${d}:${g.slot}" ${ez ? 'checked' : ''} aria-label="zjedzone"><span></span></label>
        <button class="pos-tx" data-przepis="${w.garnki.indexOf(g)}:${d}"><small>${gl}${g.slot === 'm13ona' ? ' · ONA' : g.slot === 'm13on' ? ' · ON' : ''}${odgrzewane ? ' · odgrzewasz' : ''}</small><b>${esc(g.dish.nazwa)}</b><span class="mute">${moje.map(q => `${ETY[q.p]} ${r0(q.kcal + (g.dosypka && q.p === 'on' ? g.dosypka.kcal : 0))} kcal`).join(' · ')}</span></button></div>`;
    }).join('') + `</div>`;
    const sh = OS.filter(p => day.tr[p] && !nieob(day, p));
    if (sh.length) o += `<div class="karta"><b>Po treningu · shake</b><p class="mute">${sh.map(p => `${ETY[p]}: odżywka ${DB.shake[p].odzywka_g} g + mleko ${DB.shake[p].mleko_ml} ml`).join(' · ')}</p></div>`;
    // co dalej
    const wi = wieczorem(w, d), kar = [];
    if (wi.length) kar.push(`<div class="karta zad"><b>Wieczorem przygotuj na jutro</b><ul>${wi.map(tt => `<li>${esc(tt)}</li>`).join('')}</ul></div>`);
    const idx = dzienTyg();
    if (idx === 0 || idx === 4) kar.push(`<div class="karta zad"><b>Dziś dzień zakupów</b><p class="mute">Lista na ${idx === 0 ? 'wtorek–piątek' : 'sobotę–poniedziałek'} jest gotowa.</p><button class="btn glowny szeroki" id="doZakupow">Otwórz listę zakupów</button></div>`);
    const lastW = p => Object.keys(waga[p] || {}).sort().pop();
    if (OS.some(p => !lastW(p) || (new Date(dzis) - new Date(lastW(p))) / 864e5 >= 7)) kar.push(`<div class="karta zad"><b>Czas na ważenie</b><p class="mute">Raz w tygodniu, rano. Wynik pomaga ocenić, czy kalorie są dobre.</p><button class="btn szeroki" data-tab="waga">Zapisz wagę</button></div>`);
    const pr = przypomnieniaDzis(w); if (pr) kar.push(pr);
    return o + (kar.length ? `<h2>Co dalej</h2>${kar.join('')}` : '') + `<button class="btn szeroki" data-tab="tydzien" style="margin-top:12px">Cały plan</button></div></section>`;
  });
  $('#view').innerHTML = h;
  window._w = window._wBy[t.start];
}
function widokWiecej() {
  const kafel = (tab, tytul, opis, ik) => `<button class="kafel" data-tab="${tab}"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ik}"/></svg></span><span class="kafel-tx"><b>${tytul}</b><small>${opis}</small></span><span class="kafel-str">›</span></button>`;
  const q = (pyt, odp) => `<details class="faq"><summary>${pyt}</summary><p>${odp}</p></details>`;
  $('#view').innerHTML = `<h1>Więcej</h1>
    ${kafel('waga', 'Waga', 'Pomiary i trend dla obojga', 'M3 6h18v12H3zM8.5 11a4 4 0 0 1 7 0M12 14l2-2.5')}
    ${kafel('ustawienia', 'Ustawienia', 'Profile, cele, wspólny plan, ulubione dania', 'M4 7h9M17 7h3M4 17h3M11 17h9')}
    <button class="kafel" data-intro="0"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></span><span class="kafel-tx"><b>Jak to działa</b><small>Krótkie wprowadzenie krok po kroku</small></span><span class="kafel-str">›</span></button>
    <h2>Najczęstsze pytania</h2>
    ${q('Jak zrobić zakupy?', 'Wejdź w „Zakupy”, zaznacz dni, na które kupujecie, i odhaczaj w sklepie. Danie na dwa dni kupujesz w całości. Odhaczone pozycje trafiają do lodówki.')}
    ${q('Jak zmienić jedzenie na inne?', 'W „Planie” rozwiń dzień i kliknij „zmień” przy posiłku. Możesz szukać po nazwie lub składniku. Gramatury nowego dania dopasują się do tych samych kalorii.')}
    ${q('Kogoś nie ma w danym dniu', 'W „Planie” rozwiń dzień i wybierz „Bez niego” albo „Bez niej”. Posiłki tej osoby znikną, a obiad i zakupy policzą się na jedną osobę.')}
    ${q('Jak ułożyć następny tydzień?', 'W „Planie” na dole jest karta „Ułóż następny tydzień”. Oba tygodnie są potem w jednym widoku, jeden pod drugim.')}
    ${q('Jak podzielić mięso po zakupach?', 'Na liście zakupów jest karta „Mięso i ryby”: kolejność woreczków, co zostaje w lodówce, co do zamrażarki i co wpisać na etykiecie.')}
    ${q('Co zrobić z resztkami po zakupach?', 'Przy produktach z resztą opakowania lista pisze, w których daniach w planie ich użyjesz, i podpowiada pomysły. W „Lodówce” działa też „Spontaniczne gotowanie”.')}
    ${q('Telefon drugiej osoby', 'W „Ustawieniach” utwórz wspólny plan i wyślij zaproszenie. Plan, lodówka i zakupy synchronizują się między telefonami.')}`;
}

function rysuj() {
  $('#view').oninput = null;
  ekranStartowy = ekranCzekania = false;
  const S = window.Sync;
  if (S && S.kod && !plan && S.stan !== 'blad') {
    ekranCzekania = true; $('#tabs').hidden = true;
    $('#view').innerHTML = `<p class="pusty">Łączę ze wspólnym planem…</p>`;
    return;
  }
  if (!profil || !zapotrzebowanie(profil.ona) || !zapotrzebowanie(profil.on)) { ekranStartowy = true; $('#tabs').hidden = true; widokUstawienia(true); return; }
  naprawBrakujace();
  if (inny && inny.start < poniedzialek()) { inny = null; LS.del('inny'); Z([[['inny'], undefined]]); }
  if (!planAktualny()) {
    if (S && S.kod && plan) {   // wspólny plan z daniem, którego ten telefon nie zna — nie układam nowego, żeby nie nadpisać planu drugiej osoby
      $('#tabs').hidden = false;
      $('#view').innerHTML = `<div class="uwaga">Wspólny plan zawiera dania, których nie ma jeszcze w bazie na tym telefonie.</div><button class="btn glowny szeroki" id="odswiezBaze">Odśwież bazę dań</button>`;
      return;
    }
    ulozTydzien();
  }
  $('#tabs').hidden = false;
  const pod = ['waga', 'ustawienia'].includes(zakladka);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('akt', b.dataset.tab === (pod ? 'wiecej' : zakladka)));
  if (zakladka === 'dzis') widokDzis(); else if (zakladka === 'tydzien') widokTydzien(); else if (zakladka === 'zakupy') widokZakupy(); else if (zakladka === 'lodowka') widokLodowka(); else if (zakladka === 'waga') widokWaga(); else if (zakladka === 'ustawienia') widokUstawienia(false); else widokWiecej();
  if (pod) $('#view').insertAdjacentHTML('afterbegin', `<button class="wstecz" data-tab="wiecej">‹ Więcej</button>`);
  if (!LS.get('intro', false) && profil && plan) { LS.set('intro', true); pokazIntro(0); }
}

function kartaUkryte() {
  const uk = [...DB.dania.values()].filter(d => ukryte(d.id)), ul = [...DB.dania.values()].filter(d => oceny[d.id] === 1);
  return `<h2>Ulubione i ukryte dania</h2><div class="karta"><p class="mute">Ulubione (${ul.length}) pojawiają się w planie częściej i na początku listy przy zamianie. Ukryte nie trafiają do nowych tygodni.</p>
    ${uk.length ? uk.map(d => `<div class="wpis"><span>${esc(d.nazwa)}</span><button class="btn maly" data-ocena="${esc(d.id)}:-1">Przywróć</button></div>`).join('') : '<p class="mute">Nie ukryto żadnego dania. Ukryjesz je w oknie dania lub przy zamianie posiłku.</p>'}</div>`;
}

// ---------- waga ----------
function wykresWagi(daty, p) {
  if (daty.length < 2) return daty.length ? '' : '<p class="mute">Brak pomiarów — dodaj pierwszy poniżej.</p>';
  const pkt = daty.map(([d, v]) => [new Date(d + 'T12:00:00').getTime(), v]);
  const W = 320, H = 150, L = 38, R = 10, T = 10, B = 22;
  const x0 = pkt[0][0], x1 = pkt[pkt.length - 1][0], vs = pkt.map(q => q[1]);
  const mn = Math.min(...vs), mx = Math.max(...vs), pad = Math.max(0.3, (mx - mn) * 0.15), lo = mn - pad, hi = mx + pad;
  const X = t => L + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const f = t => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' });
  const lin = pkt.map(([t, v]) => X(t).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  return `<svg class="wykres ${p}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wykres wagi">
    <line x1="${L}" x2="${W - R}" y1="${Y(mx)}" y2="${Y(mx)}" stroke="currentColor" stroke-opacity=".15"/><line x1="${L}" x2="${W - R}" y1="${Y(mn)}" y2="${Y(mn)}" stroke="currentColor" stroke-opacity=".15"/>
    <text x="${L - 4}" y="${Y(mx) + 3}" text-anchor="end">${mx.toString().replace('.', ',')}</text><text x="${L - 4}" y="${Y(mn) + 3}" text-anchor="end">${mn.toString().replace('.', ',')}</text>
    <text x="${L}" y="${H - 6}">${f(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${f(x1)}</text>
    <polyline points="${lin}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>${pkt.map(([t, v]) => `<circle cx="${X(t).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="currentColor"/>`).join('')}</svg>`;
}
function tempoWagi(p) {
  const e = Object.entries(waga[p] || {}).sort();
  if (e.length < 2) return null;
  const ms = d => new Date(d + 'T12:00:00').getTime(), lim = ms(e[e.length - 1][0]) - 28 * 864e5, okno = e.filter(([d]) => ms(d) >= lim);
  if (okno.length < 2) return null;
  const dni = (ms(okno[okno.length - 1][0]) - ms(okno[0][0])) / 864e5;
  return dni < 6 ? null : (okno[okno.length - 1][1] - okno[0][1]) / dni * 7;
}
function opisTempa(cel, t) {
  const z = t.toFixed(2).replace('.', ',');
  const o = cel === 'redukcja' ? (t > -0.1 ? 'waga prawie stoi — wahania wody są normalne, oceniaj po 3–4 tygodniach' : t < -1 ? 'spada szybciej niż zalecane (ok. 0,25–0,75 kg/tydz.) — rozważ jeść trochę więcej' : 'tempo w normie')
    : cel === 'masa' ? (t < 0.05 ? 'waga nie rośnie — rozważ więcej kcal' : t > 0.5 ? 'rośnie szybko — część może być tłuszczem' : 'tempo w normie')
      : (Math.abs(t) < 0.3 ? 'waga stabilna' : 'waga się zmienia mimo celu „utrzymanie”');
  return `tempo ${t > 0 ? '+' : ''}${z} kg/tydz. — ${o}`;
}
function widokWaga() {
  let h = `<h1>Waga</h1><p class="mute">Ważcie się o stałej porze (np. raz w tygodniu, rano, na czczo). Pojedynczy pomiar waha się z wodą, ważny jest trend. To szacunek, nie zalecenie medyczne.</p>`;
  OS.forEach(p => {
    const e = Object.entries(waga[p] || {}).sort(), ost = e[e.length - 1], t = tempoWagi(p);
    h += `<div class="karta"><h2 class="${p}" style="margin-top:0">${ETY[p]}</h2>${wykresWagi(e, p)}`;
    if (ost) h += `<p><b>${ost[1].toString().replace('.', ',')} kg</b> <span class="mute">(${new Date(ost[0] + 'T12:00:00').toLocaleDateString('pl-PL')})</span>${e.length > 1 ? ` · od początku ${((ost[1] - e[0][1]) > 0 ? '+' : '') + (ost[1] - e[0][1]).toFixed(1).replace('.', ',')} kg` : ''}</p>`;
    if (t !== null) h += `<p class="mute">${esc(opisTempa((profil[p] || {}).cel, t))}</p>`;
    h += `<div class="dwa"><label class="pole"><span>Data</span><input type="date" id="wd-${p}" value="${isoDzis()}" max="${isoDzis()}"></label>
      <label class="pole"><span>Waga (kg)</span><input type="text" inputmode="decimal" id="wk-${p}" placeholder="np. 62,4"></label></div>
      <button class="btn szeroki" data-zapisz-wage="${p}">Zapisz pomiar</button>`;
    if (ost && profil[p] && Math.abs(profil[p].waga - ost[1]) >= 0.5) h += `<button class="btn szeroki" style="margin-top:8px" data-wage-profil="${p}">Zaktualizuj wagę w profilu (${ost[1].toString().replace('.', ',')} kg) i przelicz zapotrzebowanie</button>`;
    h += e.slice(-6).reverse().map(([d, v]) => `<div class="wpis"><span>${new Date(d + 'T12:00:00').toLocaleDateString('pl-PL')} — <b>${v.toString().replace('.', ',')} kg</b></span><button class="btn maly" data-usun-wage="${p}|${d}">Usuń</button></div>`).join('');
    h += `</div>`;
  });
  $('#view').innerHTML = h;
}
function zapiszWage(p) {
  const v = parseFloat(String(($('#wk-' + p) || {}).value).replace(',', '.')), d = ($('#wd-' + p) || {}).value || isoDzis();
  if (!(v >= 25 && v <= 300)) { alert('Wpisz wagę w kilogramach, np. 62,4.'); return; }
  const w = Math.round(v * 10) / 10;
  waga[p] = waga[p] || {}; waga[p][d] = w;
  LS.set('waga', waga); Z([[['waga', p, d], w]]);
  rysuj();
}

// ---------- lodówka ----------
function zmienLodowke(p, u, delta) {
  delta = Math.round(delta * 100) / 100;
  if (!delta) return;
  lodowka[p] = lodowka[p] || {};
  lodowka[p][u] = Math.round(((lodowka[p][u] || 0) + delta) * 100) / 100;
  LS.set('lodowka', lodowka);
  Z([[['lodowka', p, u], { __inc: delta }]]);   // przyrost, nie wartość: dwa telefony dodają się do siebie
}
function skladGarnka(g) {
  const out = [];
  for (const i of g.dish.skladniki) if (i.ilosc && i.produkt) out.push([i.produkt, i.kategoria, i.ilosc * skala(g, i), i.jednostka]);
  if (g.dosypka) { out.push(['odżywka białkowa', 'zapas', DB.dosypka.odzywka * g.dosypka.skala, 'g']); out.push(['skyr naturalny', 'świeże', DB.dosypka.skyr * g.dosypka.skala, 'g']); }
  if (g.dodatek) out.push(['skyr naturalny', 'świeże', g.dodatek.g, 'g']);
  return out;
}
// Prognoza: odejmuję od stanu lodówki kolejne niezjedzone posiłki tygodnia i szukam, gdzie czegoś zabraknie.
function prognoza(w) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const od = Math.round((t - dataDnia(0)) / 864e5);
  if (od > 6) return [];
  const stan = {}, pierwszy = {}, kolej = ['sn', 'm13', 'm13ona', 'm13on', 'ob', 'k18'];
  for (const [p, us] of Object.entries(lodowka)) for (const [u, q] of Object.entries(us)) stan[p + '|' + u] = q;
  const od0 = Math.max(od, 0);
  const wiersze = [];
  for (const g of w.garnki) for (const dd of dniGarnka(g)) if (dd >= od0 && !zuzyte[kluczZ(dd, g.slot)]) wiersze.push([g, dd]);
  wiersze.sort((a, b) => a[1] - b[1] || kolej.indexOf(a[0].slot) - kolej.indexOf(b[0].slot));
  for (const [g, dd] of wiersze) {
    const f = udzialDnia(g, dd);
    for (const [p, , q, u] of skladGarnka(g)) {
      const k = p + '|' + u;
      if (!(k in stan)) continue;                        // śledzę tylko to, co jest w lodówce
      stan[k] -= ileZuzyto(q, u, f);
      if (stan[k] < -0.5 && !pierwszy[k]) pierwszy[k] = { d: dd, dish: g.dish.nazwa };
    }
  }
  return Object.entries(pierwszy).map(([k, x]) => { const [p, u] = k.split('|'); return { produkt: p, u, brakuje: -stan[k], d: x.d, dish: x.dish, pilne: x.d <= od0 + 1 }; }).sort((a, b) => a.d - b.d);
}
function widokLodowka() {
  const w = oblicz(plan, cele()), pr = prognoza(w), kat = { 'świeże': 'Świeże', 'zamrażarka': 'Zamrażarka', 'zapas': 'Zapasy' };
  let h = `<h1>Lodówka</h1>${wskazowka('lodowka', 'Lodówka liczy się sama: zakupy ją dopisują, a „zjedzone” odejmuje. Możesz też wpisać ręcznie, co macie.')}
    <button class="btn glowny szeroki" id="spont">Spontaniczne gotowanie — co możemy zrobić?</button>`;
  if (pr.length) h += `<h2>Zaczyna brakować</h2><div class="karta">${pr.map(x => `<p class="${x.pilne ? 'ostrz-txt' : ''}"><b>${esc(x.produkt)}</b> — zabraknie ${fmtStan(x.brakuje, x.u)}<br><span class="mute">od: ${esc(x.dish)} (${DNI[x.d].toLowerCase()})</span></p>`).join('')}<p class="mute">Kup przed pierwszym z tych dni. Prognoza zakłada, że jecie według planu i zaznaczacie „zjedzone”.</p></div>`;
  const grupy = { 'świeże': [], 'zamrażarka': [], 'zapas': [] };
  for (const [p, us] of Object.entries(lodowka)) for (const [u, q] of Object.entries(us)) grupy[(DB.produkty.get(p) || {}).kat in grupy ? DB.produkty.get(p).kat : 'zapas'].push([p, u, q]);
  let ile = 0;
  for (const k of ['świeże', 'zamrażarka', 'zapas']) {
    const l = grupy[k].sort((a, b) => a[0].localeCompare(b[0], 'pl')); if (!l.length) continue; ile += l.length;
    h += `<h2>${kat[k]}</h2><div class="karta">${l.map(([p, u, q]) => `<div class="stan"><span class="co"><b>${esc(p)}</b>${q < 0.5 ? ' <span class="ostrz-txt">— skończone</span>' : ''}</span><input type="text" inputmode="decimal" data-sp="${esc(p)}" data-su="${esc(u)}" value="${String(Math.max(0, Math.round(q * 10) / 10)).replace('.', ',')}"><span class="mute">${esc(u)}</span><button class="btn maly" data-stanusun="${esc(p)}|${esc(u)}" aria-label="Usuń z lodówki">✕</button></div>`).join('')}</div>`;
  }
  if (!ile) h += `<p class="pusty">Lodówka jest pusta. Wpisz poniżej, co macie, albo odhaczaj zakupy na liście.</p>`;
  h += `<h2>Dodaj do lodówki</h2><div class="karta"><div class="dwa"><label class="pole"><span>Produkt</span><input id="nowy-p" list="produkty" autocomplete="off" placeholder="np. kurczak"></label>
    <label class="pole"><span>Ilość</span><input id="nowy-q" type="text" inputmode="decimal" placeholder="np. 500"></label></div>
    <label class="pole"><span>Jednostka</span><select id="nowy-u">${['g', 'ml', 'szt.', 'krom.', 'pusz.'].map(u => `<option>${u}</option>`).join('')}</select></label>
    <datalist id="produkty">${[...DB.produkty.keys()].sort((a, b) => a.localeCompare(b, 'pl')).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <button class="btn szeroki" id="dodajStan">Dodaj</button></div>
    <h2>Wpisz kilka rzeczy naraz</h2><div class="karta"><p class="mute">Po jednej w linii, np. „kurczak 500 g”, „jajka 6”, „ryż”. Bez ilości wstawię typową paczkę.</p>
    <textarea id="szybkie-tekst" rows="4" placeholder="kurczak 500 g&#10;jajka 6&#10;ryż"></textarea><button class="btn szeroki" id="szybkie">Dodaj wszystko</button></div>`;
  $('#view').innerHTML = h;
}
function dodajStanReczny() {
  const n = ($('#nowy-p').value || '').trim(), q = parseFloat(String($('#nowy-q').value).replace(',', '.'));
  if (!n || !(q > 0)) { alert('Wpisz nazwę produktu i ilość.'); return; }
  zmienLodowke(n, $('#nowy-u').value, q); rysuj();
}
function szybkieDodanie(tekst) {
  const mapa = { g: 'g', gr: 'g', kg: 'kg', ml: 'ml', l: 'l', szt: 'szt.', 'szt.': 'szt.', sztuk: 'szt.', sztuki: 'szt.', krom: 'krom.', 'krom.': 'krom.', pusz: 'pusz.', 'pusz.': 'pusz.', puszka: 'pusz.', puszki: 'pusz.', łyżka: 'łyż.', łyżki: 'łyż.', łyżeczka: 'łyżecz.', łyżeczki: 'łyżecz.' };
  let n = 0;
  for (const lin of tekst.split(/[\n;]+/)) {
    const m = lin.trim().match(/^(.+?)(?:\s+(\d+(?:[.,]\d+)?)\s*([a-ząćęłńóśźż.]*))?$/i);
    if (!m || !m[1].trim()) continue;
    const wpis = m[1].trim(), zn = znorm(wpis);
    let nazwa = [...DB.produkty.keys()].find(k => znorm(k) === zn);
    if (!nazwa && zn.length >= 3) nazwa = [...DB.produkty.keys()].filter(k => znorm(k).includes(zn) || zn.includes(znorm(k))).sort((a, b) => a.length - b.length)[0];
    const znany = nazwa ? DB.produkty.get(nazwa) : null, op = nazwa && DB.opak[nazwa];
    let q = m[2] ? parseFloat(m[2].replace(',', '.')) : null, u = mapa[(m[3] || '').toLowerCase()] || null;
    if (q !== null && !u) u = znany ? znany.u : (q >= 20 ? 'g' : 'szt.');
    if (q === null) { if (op) { q = op.wielkosc; u = op.jednostka; } else { u = znany ? znany.u : 'g'; q = u === 'g' || u === 'ml' ? 500 : 4; } }
    if (u === 'kg') { q *= 1000; u = 'g'; } else if (u === 'l') { q *= 1000; u = 'ml'; } else if (u === 'łyż.' || u === 'łyżecz.') { q *= gNaLyzke(nazwa || wpis, u); u = 'g'; }
    zmienLodowke(nazwa || wpis, u, q); n++;
  }
  if (n) rysuj(); else alert('Nie rozpoznałem żadnej linii.');
}

// ---------- spontaniczne gotowanie ----------
const ZAKLADANE = /oliw|olej|\bsol\b|pieprz|przypraw|cukier|ocet|woda|bulion|czosnek|curry|oregano|bazyli|kmin|cynamon|ziele|lisc|majeran|tymian|proszek|sos sojowy|musztard|keczup|koncentrat|papryka (slodka|wedzona|mielona)|miod|ekstrakt|wanili/;
function mozliwosci() {
  const out = [];
  for (const d of DB.dania.values()) {
    if (ukryte(d.id)) continue;
    const brak = []; let ma = 0, razem = 0, min = Infinity;
    for (const i of d.skladniki) {
      if (!i.produkt || !i.ilosc) continue;
      razem++;
      const st = lodowka[i.produkt], q = st && st[i.jednostka];
      if (q == null) {
        if (st && Object.keys(st).length) { ma++; continue; }                       // jest w innej jednostce — nie porównuję
        if (ZAKLADANE.test(znorm(i.produkt))) continue;                            // sól, oliwa, przyprawy: zakładam, że są
        brak.push(i.produkt); continue;
      }
      const r = q / i.ilosc;
      if (r < 0.6) brak.push(`${i.produkt} (masz ${fmtStan(Math.max(0, q), i.jednostka)}, w przepisie ${fmtStan(i.ilosc, i.jednostka)})`);
      else { ma++; min = Math.min(min, r); }
    }
    if (razem && ma) out.push({ d, brak, ma, razem, skala: clamp(isFinite(min) ? min : 1, 0.5, 1.2) });
  }
  return out.sort((a, b) => a.brak.length - b.brak.length || b.ma / b.razem - a.ma / a.razem);
}
function garnekSpont(dish, s) {
  const K = dish.razem.kcal * s, P = dish.razem.bialko * s;
  const porcje = OS.map(p => ({ p, d: 0, kcal: K / 2, udzial: 0.5, b: P / 2 }));
  return { dish, slot: 'spont', d: 0, porcje, K, ratio: null, a: s, b: s, lev: new Set(), s, P, dodatek: null, roznica: 0, wyrownane: null };
}
const TYPY_SPONT = { wszystko: null, sniadania: ['sniadanie'], obiady: ['obiad', 'obiad_zupa', 'obiad_2dni', 'obiad_sroda', 'obiad_sobota', 'obiad_niedziela'], przekaski: ['drugie_on'], koktajle: ['koktajl', 'koktajl_maly'] };
function oknoSpont() {
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Spontaniczne gotowanie</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">Dania z bazy, które da się zrobić z tego, co jest w lodówce. Zakładam, że sól, oliwę i przyprawy macie. Nie ma Waszej rzeczy na liście? Dodaj ją w lodówce.</p>
    <div class="dwa"><label class="pole"><span>Rodzaj</span><select data-spont-typ="1"><option value="wszystko">wszystko</option><option value="sniadania">śniadania</option><option value="obiady">obiady i zupy</option><option value="przekaski">drugie śniadania</option><option value="koktajle">koktajle</option></select></label>
    <label class="pole"><span>Szukaj</span><input id="szukaj-sp" type="search" autocomplete="off" placeholder="np. kurczak"></label></div><div id="spont-lista"></div>`;
  $('#modal').hidden = false;
  $('#szukaj-sp').value = spontFiltr.q; document.querySelector('[data-spont-typ]').value = spontFiltr.typ;
  listaSpont();
}
function listaSpont() {
  if (!Object.keys(lodowka).length) { $('#spont-lista').innerHTML = '<p class="pusty">Lodówka jest pusta. Wpisz najpierw, co macie.</p>'; return; }
  const slowa = slowaZ(spontFiltr.q), typy = TYPY_SPONT[spontFiltr.typ];
  const lista = mozliwosci().filter(x => (!typy || typy.includes(x.d.typ)) && slowa.every(w => szukany(x.d).includes(w))).filter(x => x.brak.length <= 3).slice(0, 40);
  $('#spont-lista').innerHTML = lista.length ? lista.map(x => `<div class="wiersz"><button class="wybor" data-przepis-spont="${esc(x.d.id)}">${Obr.html(x.d)}<span class="tx"><b>${oceny[x.d.id] === 1 ? '★ ' : ''}${esc(x.d.nazwa)}</b>
      <span class="${x.brak.length ? 'mute' : 'ok-txt'}">${x.brak.length ? 'brakuje: ' + esc(x.brak.join(', ')) : '✓ masz wszystko'}${x.skala < 0.95 ? ` · porcja ×${x.skala.toFixed(1).replace('.', ',')}` : ''}</span></span></button></div>`).join('')
    : '<p class="pusty">Nic nie pasuje — dopisz więcej rzeczy do lodówki albo zmień filtr.</p>';
}

// ---------- zdarzenia ----------
// Klik w dzień drugiego tygodnia: ten tydzień staje się „aktywny” (tak jak dotąd działają zamiany, treningi, „zjedzone”), ale ekran się nie zmienia.
function przygotujTydzien(e) {
  const sek = e.target.closest('[data-wk]');
  if (!sek) return;
  const st = sek.dataset.wk, dEl = e.target.closest('[data-d]');
  if (st !== plan.start && inny && inny.start === st) przelaczTydzien();
  otwartyTyg = plan.start; if (dEl) otwartyDzien = +dEl.dataset.d;
  if (window._wBy && window._wBy[plan.start]) window._w = window._wBy[plan.start];
}
document.addEventListener('click', e => {
  const t = e.target.closest('button, summary');
  if (!t) { if (e.target.id === 'modal') zamknijOkno(); return; }
  if (t.tagName !== 'SUMMARY' && !t.dataset.tab) przygotujTydzien(e);
  if (t.dataset.wsk) { wskazowki[t.dataset.wsk] = 1; LS.set('wskazowki', wskazowki); rysuj(); return; }
  if (t.dataset.intro !== undefined) { pokazIntro(+t.dataset.intro); return; }
  if (t.dataset.tab) { zakladka = t.dataset.tab; rysuj(); window.scrollTo(0, 0); }
  else if (t.dataset.przepis) { const [g, d] = t.dataset.przepis.split(':'); oknoPrzepis(+g, +d); }
  else if (t.dataset.zmien) { const [d, s] = t.dataset.zmien.split(':'); oknoZmien(+d, s); }
  else if (t.dataset.wybierz) { const [d, s, ...id] = t.dataset.wybierz.split(':'); wybierz(+d, s, id.join(':')); }
  else if ('zamknij' in t.dataset) zamknijOkno();
  else if (t.id === 'udostepnijPlan') { t.disabled = true; window.Sync.utworz().then(ok => { rysuj(); if (ok) wyslijZaproszenie(); }); }
  else if (t.id === 'wyslijLink') wyslijZaproszenie();
  else if (t.id === 'odlacz') { if (confirm('Odłączyć ten telefon od wspólnego planu? Plan zostanie tu jako kopia, a u drugiej osoby nic się nie zmieni.')) { window.Sync.odlacz(); rysuj(); } }
  else if (t.id === 'dolacz') {
    const v = ($('#kodDom') || {}).value || '';
    if (plan && profil && !confirm('Dołączyć do wspólnego planu? Plan zapisany na tym telefonie zostanie zastąpiony wspólnym.')) return;
    t.disabled = true;
    window.Sync.dolacz(v).then(() => rysuj());
  }
  else if (t.id === 'odswiezBaze') wczytajBaze().then(rysuj);
  else if (t.id === 'nowyNast' || t.id === 'nowyBiez') {
    const st = t.id === 'nowyNast' ? dodajDni(poniedzialek(), 7) : poniedzialek();
    if (plan.start !== st) { if (inny && inny.start === st) przelaczTydzien(); else ulozTydzien(st, true); }   // drugi tydzień zostaje zapisany
    otwartyDzien = null; zakladka = 'tydzien'; rysuj(); window.scrollTo(0, 0);
  }
  else if (t.dataset.kto) {
    const [d, k] = t.dataset.kto.split(':'), day = plan.dni[+d];
    day.nb = { ona: k === 'bezona', on: k === 'bezon' };            // „bez niego” = on nieobecny, „bez niej” = ona nieobecna
    LS.set('plan', plan); Z([[['dni', +d, 'nb'], day.nb]]); otwartyDzien = +d; rysuj();
  }
  else if (t.dataset.pdzien !== undefined) { if (t.dataset.pdzien) { const [st, d] = t.dataset.pdzien.split(':'); otwartyTyg = st; otwartyDzien = +d; rysuj(); } }
  else if (t.dataset.zakdzien) {
    const s = wybraneDni(); s.has(t.dataset.zakdzien) ? s.delete(t.dataset.zakdzien) : s.add(t.dataset.zakdzien);
    zakDni = [...s].sort(); LS.set('zakDni', zakDni); rysuj();
  }
  else if (t.dataset.zakweek) {
    const s = wybraneDni(), dniT = dniDostepne().filter(x => x.start === t.dataset.zakweek).map(x => x.iso), wsz = dniT.every(x => s.has(x));
    dniT.forEach(x => wsz ? s.delete(x) : s.add(x)); zakDni = [...s].sort(); LS.set('zakDni', zakDni); rysuj();
  }
  else if (t.dataset.zakpreset) { zakDni = t.dataset.zakpreset === 'auto' ? null : []; if (zakDni) LS.set('zakDni', zakDni); else LS.del('zakDni'); rysuj(); }
  else if ('nowy' in t.dataset) { if (confirm('Ułożyć ten tydzień od nowa? Twoje zamiany w nim przepadną.')) { ulozTydzien(plan.start); rysuj(); } }
  else if (t.id === 'doZakupow') { zakladka = 'zakupy'; rysuj(); window.scrollTo(0, 0); }
  else if (t.id === 'udostepnij') {
    const tekst = tekstListy();
    if (navigator.share) navigator.share({ title: 'Zakupy', text: tekst }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(tekst).then(() => alert('Lista skopiowana — wklej ją do notatek albo SMS-a.'), () => alert(tekst));
    else alert(tekst);
  }
  else if (t.dataset.tryb && zmienCtx) {
    zmienCtx.pula = t.dataset.tryb === 'kokt' ? DB.pula.m13kokt : DB.pula.m13dania;
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('akt', b === t));
    listaWyboru(($('#szukaj') || {}).value || '');
  }
  else if (t.id === 'przeladuj') location.reload();
  else if (t.id === 'aktualizuj') aktualizujApke();
  else if (t.id === 'kupWszystko') {
    for (const kat of ['świeże', 'zamrażarka', 'zapas']) for (const pp of window._z.wynik[kat]) odhaczKup(kluczKup(pp.produkt), true);
    LS.set('odhaczone', odhaczone); rysuj();
  }
  else if (t.id === 'odznaczWszystko') {
    if (!confirm('Odznaczyć wszystkie zakupy i odjąć kupione ilości z lodówki?')) return;
    for (const k of Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).filter(x => x.startsWith('zak|'))) odhaczKup(k, false);
    LS.set('odhaczone', odhaczone); rysuj();
  }
  else if (t.dataset.sugestie) oknoSugestie(t.dataset.sugestie);
  else if (t.dataset.sug) { const [d, sl, id, r] = t.dataset.sug.split('|'); ustawDanie(+d, sl, id, +r); rysuj(); oknoSugestie(sugOsoba); }
  else if (t.dataset.autoPopraw) { const n = autoPopraw(t.dataset.autoPopraw); rysuj(); oknoSugestie(sugOsoba, n); }
  else if (t.dataset.nudge) {
    const [d, sl, kier] = t.dataset.nudge.split(':'), g = window._w.garnki.find(x => x.d === +d && x.slot === sl);
    if (g) {
      const cur = g.P / g.K, y = $('#modal-box').scrollTop;
      const r = +kier > 0 ? cur + 0.25 * (rz(g.dish, g.K, 1, g.slot).P / g.K - cur) : cur - 0.25 * (cur - rz(g.dish, g.K, 0.0001, g.slot).P / g.K);
      ustawDanie(+d, sl, g.dish.id, r); rysuj();
      const gi = window._w.garnki.findIndex(x => x.d === +d && x.slot === sl);
      if (gi >= 0) { oknoPrzepis(gi); $('#modal-box').scrollTop = y; }
    }
  }
  else if (t.dataset.ocena) { const k = t.dataset.ocena.lastIndexOf(':'); ocen(t.dataset.ocena.slice(0, k), +t.dataset.ocena.slice(k + 1)); }
  else if (t.dataset.zapiszWage) zapiszWage(t.dataset.zapiszWage);
  else if (t.dataset.usunWage) { const [pp, dd] = t.dataset.usunWage.split('|'); delete waga[pp][dd]; LS.set('waga', waga); Z([[['waga', pp, dd], undefined]]); rysuj(); }
  else if (t.dataset.wageProfil) { const pp = t.dataset.wageProfil, e = Object.entries(waga[pp] || {}).sort(); if (e.length) { profil[pp].waga = e[e.length - 1][1]; LS.set('profil', profil); Z([[['profil', pp], profil[pp]]]); rysuj(); } }
  else if (t.dataset.stanusun) { const [pp, uu] = t.dataset.stanusun.split('|'); if (lodowka[pp]) { delete lodowka[pp][uu]; if (!Object.keys(lodowka[pp]).length) delete lodowka[pp]; } LS.set('lodowka', lodowka); Z([[['lodowka', pp, uu], undefined]]); rysuj(); }
  else if (t.id === 'dodajStan') dodajStanReczny();
  else if (t.id === 'szybkie') szybkieDodanie(($('#szybkie-tekst') || {}).value || '');
  else if (t.id === 'spont') oknoSpont();
  else if (t.dataset.przepisSpont) { const x = mozliwosci().find(m => m.d.id === t.dataset.przepisSpont); if (x) pokazPrzepis(garnekSpont(x.d, x.skala), true); }
  else if (t.dataset.spontGotuj) { const g = spontG; if (g) { for (const [pp, , q, uu] of skladGarnka(g)) if (lodowka[pp] && lodowka[pp][uu] != null) zmienLodowke(pp, uu, -ileZuzyto(q, uu)); } spontWroc = false; spontG = null; $('#modal').hidden = true; rysuj(); }
  else if (t.tagName === 'SUMMARY' && t.parentElement.dataset.zakdni !== undefined) { zakOtw = !t.parentElement.open; }
  else if (t.tagName === 'SUMMARY') { const d = +t.parentElement.dataset.d, sek = t.closest('[data-wk]'); otwartyTyg = sek ? sek.dataset.wk : plan.start; otwartyDzien = t.parentElement.open ? -1 : d; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'szukaj' && zmienCtx) listaWyboru(t.value);
  else if (t.id === 'szukaj-sp') { spontFiltr.q = t.value; listaSpont(); }
  else if (t.id === 'nowy-p') { const k = DB.produkty.get(t.value); if (k && $('#nowy-u')) $('#nowy-u').value = ['g', 'ml', 'szt.', 'krom.', 'pusz.'].includes(k.u) ? k.u : 'g'; }
});
document.addEventListener('change', e => {
  const t = e.target;
  przygotujTydzien(e);
  if (t.dataset.nb) {
    const [d, pp] = t.dataset.nb.split(':'), day = plan.dni[+d];
    day.nb = Object.assign({ ona: false, on: false }, day.nb); day.nb[pp] = t.checked;
    LS.set('plan', plan); Z([[['dni', +d, 'nb', pp], t.checked]]); otwartyDzien = +d; rysuj();
  }
  else if (t.dataset.tr) { const [d, p] = t.dataset.tr.split(':'); plan.dni[+d].tr[p] = t.checked; otwartyDzien = +d; LS.set('plan', plan); Z([[['dni', +d, 'tr', p], t.checked]]); rysuj(); }
  else if (t.dataset.zuz) {
    const [d, sl] = t.dataset.zuz.split(':'), g = window._w.garnki.find(x => x.slot === sl && x.porcje.some(q => q.d === +d));
    if (!g) return;
    zjedz(g, +d, t.checked); otwartyDzien = +d; rysuj();
  }
  else if (t.dataset.sp) {
    const v = parseFloat(String(t.value).replace(',', '.')), cur = (lodowka[t.dataset.sp] || {})[t.dataset.su] || 0;
    if (!isNaN(v) && v >= 0) zmienLodowke(t.dataset.sp, t.dataset.su, v - cur);
    rysuj();
  }
  else if (t.dataset.spontTyp) { spontFiltr.typ = t.value; listaSpont(); }
  else if (t.dataset.kup) {
    odhaczKup(t.dataset.kup, t.checked); LS.set('odhaczone', odhaczone);
    const poz = t.closest('.poz'), kart = poz.parentNode;
    poz.classList.toggle('kupione', t.checked);
    if (t.checked) kart.appendChild(poz);                              // odhaczone spada na koniec listy
    else { const pierwsze = kart.querySelector('.poz.kupione'); kart.insertBefore(poz, pierwsze); }   // odznaczone wraca przed odhaczone
  }
});

// ---------- interfejs dla sync.js ----------
window.App = {
  stanDoChmury: () => ({ profil, start: plan.start, dni: dniMapa(), odhaczone, oceny, waga, lodowka, zuzyte, inny: paczkaDoChmury(inny) }),
  zdalny(data) {
    const nowyProfil = data.profil && data.profil.ona && data.profil.on ? data.profil : profil;
    let nowyPlan = plan;
    if (data.start && data.dni) {
      const dni = [0, 1, 2, 3, 4, 5, 6].map(i => data.dni[i]);
      if (dni.every(Boolean)) nowyPlan = { start: data.start, dni: dni.map(d => Object.assign({ ratio: {}, tr: { ona: false, on: false } }, d)) };
    }
    const noweOdh = data.odhaczone || {};
    const przed = stabilny({ profil, plan, odhaczone, oceny, waga, lodowka, zuzyte, inny });
    profil = nowyProfil; plan = nowyPlan; odhaczone = noweOdh;
    oceny = data.oceny || {}; zuzyte = data.zuzyte || {}; lodowka = data.lodowka || {}; inny = paczkaZChmury(data.inny);
    waga = { ona: (data.waga && data.waga.ona) || {}, on: (data.waga && data.waga.on) || {} };
    if (stabilny({ profil, plan, odhaczone, oceny, waga, lodowka, zuzyte, inny }) === przed && !ekranCzekania) return;   // nic nowego (np. potwierdzenie własnej zmiany)
    LS.set('profil', profil); LS.set('plan', plan); LS.set('odhaczone', odhaczone);
    LS.set('oceny', oceny); LS.set('waga', waga); LS.set('lodowka', lodowka); LS.set('zuzyte', zuzyte); LS.set('inny', inny);
    if (!$('#modal').hidden) { odroczone = true; return; }                        // nie zamykam otwartego przepisu
    if (zakladka === 'ustawienia' && !ekranStartowy && !ekranCzekania) return;    // nie kasuję wypełnianego formularza
    if ((zakladka === 'waga' || zakladka === 'lodowka') && document.activeElement && document.activeElement.matches('input, textarea, select')) return;
    rysuj();
  },
  syncZmiana() {
    const el = $('#sync-status');
    if (el) el.innerHTML = opisSync();
    if (ekranCzekania) return rysuj();
    const S = window.Sync;
    if (ekranStartowy && S && ((S.dostepny && !$('#dolacz')) || S.kod)) rysuj();
  }
};

// ---------- aktualizacje aplikacji ----------
let swReg = null;
function pokazNowaWersja() {
  if ($('#nowa-wersja')) return;
  const d = document.createElement('div'); d.id = 'nowa-wersja'; d.className = 'nowa-wersja';
  d.innerHTML = 'Jest nowa wersja aplikacji. <button class="btn maly" id="przeladuj">Odśwież</button>';
  document.body.appendChild(d);
}
// twarda aktualizacja: kasuje pamięć podręczną i service workera, po czym ładuje wszystko od nowa (dane planu zostają)
async function aktualizujApke() {
  try {
    if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()));
  } catch (e) { /* nic */ }
  location.reload();
}

// ---------- start ----------
(async function start() {
  try { await wczytajBaze(); }
  catch (e) { $('#view').innerHTML = '<p class="pusty">Nie udało się wczytać bazy dań. Sprawdź połączenie i odśwież.</p>'; return; }
  rysuj();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Aplikacja z ekranu głównego jest tylko wznawiana, nie ładowana od nowa — dlatego sama sprawdzam aktualizacje przy powrocie do niej.
    const mialKontroler = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!mialKontroler) return;                       // pierwsza instalacja: nie ma czego odświeżać
      const ae = document.activeElement;
      if (!$('#modal').hidden || (ae && ae.matches('input, textarea, select'))) pokazNowaWersja(); else location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      swReg = reg;
      const sprawdz = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sprawdz(); });
      window.addEventListener('focus', sprawdz);
      setInterval(sprawdz, 10 * 60 * 1000);
    }).catch(() => {});
  }
})();
