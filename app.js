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
let wyklucz = LS.get('wyklucz', { ona: [], on: [] });         // czego kto nie je: grupy („g:ryby”) i własne słowa; wspólne dla pary
let smaki = LS.get('smaki', {});                           // smaki[id dania][osoba] = { n, s }: ile razy oceniono i suma (0 nie, 1 może być, 2 super); wspólne
let korekta = LS.get('korekta', { ona: { kcal: 0, od: null, hist: [] }, on: { kcal: 0, od: null, hist: [] } });   // adaptacyjna korekta kalorii wg trendu wagi; wspólna
let paragony = LS.get('paragony', []);                     // ostatnie paragony: [{ id, data, sklep, lokal, suma, poz: [{ n, p, q, u, c, b }] }]; wspólne
let ceny = LS.get('ceny', {});                             // ceny[produkt][sklep] = { u, ost, sr, cb, n, t, h }: zł za kg / l / szt. po rabatach; wspólne
let mapaPar = LS.get('mapaPar', {});                       // nazwa z paragonu (bez liczb) -> produkt albo '' (pomiń); wspólne
let kody = LS.get('kody', {});                               // zeskanowane kody kreskowe: kody[ean] = { p: produkt, r: rozmiar opakowania, u }; wspólne
let wlasneProd = LS.get('wlasneProd', {});                   // produkty dodane z paragonów: wlasneProd[nazwa] = { kat, u }; wspólne
let pakiety = LS.get('pakiety', {});                       // pakiety[produkt] = { r, u, et, w: [rozmiary], t }: standardowe opakowania poznane z paragonów; wspólne
let trasa = LS.get('trasa', {});                          // trasa[sklep][produkt] = 0..1: gdzie w kolejności zakupów zwykle trafia ten produkt (uczone z odhaczania), wspólne
let sklepZak = LS.get('sklepZak', ''), trasaTryb = LS.get('trasaTryb', 'moja'), sesjaKup = LS.get('sesjaKup', null);
let motyw = LS.get('motyw', 'auto');                        // wygląd: auto (jak system), jasny, ciemny — tylko na tym telefonie
let wlasneDania = LS.get('wlasneDania', []);                // dania dodane przez Was w aplikacji (ten sam format co baza), wspólne
let lodData = LS.get('lodData', {});                          // lodData[produkt] = data ostatniego dokupienia (dla ostrzeżeń „zużyj”), wspólne
let historia = LS.get('historia', []);                     // zapisane podsumowania minionych tygodni (patrz zbierzTydzien), wspólne
let sesje = LS.get('sesje', []);                           // zapisane sesje meal prep: [{ id, od, h, komp: [{ prod, nazwa, u, suchy, ugot, uzycia: [{ iso, slot, id, dish, wk, d, suchy, ugot }] }], zrobione }]; wspólne
let prepOd = null; const prepH = 5;   // okno planowania; każdy składnik i tak jest ucinany do swojego terminu przydatności
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
// Duże ilości scalonych produktów (np. 100 pomidorków) pokazuję w gramach: „1500 g”, a nie „100 szt.”.
function fqS(i, q) { return (i.gSzt && i.jednostka === 'szt.' && q > 30) ? fq(q * i.gSzt, 'g') : fq(q, i.jednostka); }
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
const opisGarnka = g => { if (g.prep) return 'sesja meal prep'; const os = [...new Set(g.porcje.map(q => q.p))], dn = new Set(g.porcje.map(q => q.d)).size; return (os.length === 1 ? 'dla ' + (os[0] === 'ona' ? 'niej' : 'niego') : (dn > 1 ? '' : 'dla Was dwojga')) + (dn > 1 ? (os.length === 1 ? ' ' : '') + 'na ' + dn + ' dni' : '') + (g.gosc ? ' + ' + g.gosc + ' ' + mn(g.gosc, 'gość', 'gości', 'gości') : ''); };
const sredniaOsoby = (w, p, pole) => { const ix = obecneDni(plan, p); return ix.length ? sum(ix, i => w.dni[i][p][pole]) / ix.length : 0; };
const fmtStan = (q, u) => (u === 'g' || u === 'ml') ? Math.round(q) + ' ' + u : (Math.round(q * 2) / 2).toString().replace('.', ',') + ' ' + u;

// ---------- zapotrzebowanie ----------
function zapotrzebowanie(o, kor = 0) {
  if (!o || !o.wiek || !o.waga || !o.wzrost) return null;
  const bmr = 10 * o.waga + 6.25 * o.wzrost - 5 * o.wiek + (o.plec === 'm' ? 5 : -161);   // Mifflin-St Jeor
  const cpm = bmr * parseFloat(o.akt || '1.375');
  const [, mnoznik, gkg] = CEL[o.cel] || CEL.utrzymanie;
  const kcal = o.wlasne ? +o.wlasne : Math.round(cpm * mnoznik / 10) * 10 + (kor || 0);   // kor = adaptacyjna korekta wg trendu wagi
  const b = Math.round(gkg * o.waga);
  return { bmr: r0(bmr), cpm: r0(cpm), kcal, b, bMin: r0(b * 0.9), bMax: r0(b * 1.15) };
}
// Aktualna waga = ostatni pomiar z zakładki Waga (jeśli jest), inaczej waga z profilu. Z niej liczą się cele, a więc gramatury całego planu.
function wagaAktualna(p) {
  const e = Object.keys((waga && waga[p]) || {}).sort();
  return e.length ? waga[p][e[e.length - 1]] : (profil && profil[p] ? profil[p].waga : null);
}
const profilEf = p => profil && profil[p] ? Object.assign({}, profil[p], { waga: wagaAktualna(p) }) : null;
function cele() { return { ona: zapotrzebowanie(profilEf('ona'), korekta.ona.kcal), on: zapotrzebowanie(profilEf('on'), korekta.on.kcal) }; }

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
// Jeden produkt zamiast kilku odmian: zawsze kupujecie pomidorki koktajlowe i zwykłą cebulę, więc „pomidory świeże”, „pomidor” i „cebula czerwona”
// łączę z nimi w przepisach, zakupach i lodówce. [nowy produkt, gramów na sztukę]. Pomidory z puszki, passata i ogórek kiszony zostają osobno.
const SCAL = { 'pomidory świeże': ['pomidorki koktajlowe', 15], 'pomidor': ['pomidorki koktajlowe', 15], 'cebula czerwona': ['cebula', 100] };
function normalizujScalone(d) {
  for (const i of d.skladniki) {
    const sc = SCAL[i.produkt]; if (!sc) continue;
    if (i.jednostka === 'g' && i.ilosc) { i.ilosc = Math.round(i.ilosc / sc[1] * 10) / 10; i.jednostka = 'szt.'; i.gSzt = sc[1]; }
    i.nazwa = i.nazwa === i.produkt ? sc[0] : i.nazwa.replace(/pomidory świeże/i, 'pomidorki koktajlowe').replace(/cebula czerwona/i, 'cebula');
    i.produkt = sc[0]; if (i.kategoria === undefined || i.kategoria === null) i.kategoria = sc[0] === 'cebula' ? 'zapas' : 'świeże';
  }
  const widziane = new Map(), nowe = new Set(Object.values(SCAL).map(x => x[0]));
  d.skladniki = d.skladniki.filter(i => {
    if (!nowe.has(i.produkt) || !i.ilosc) return true;
    const k = (i.grupa || '') + '|' + i.produkt + '|' + i.jednostka, pr = widziane.get(k);
    if (!pr) { widziane.set(k, i); return true; }
    pr.ilosc += i.ilosc; pr.kcal = (pr.kcal || 0) + (i.kcal || 0); pr.bialko = (pr.bialko || 0) + (i.bialko || 0);
    return false;
  });
}
// Dane zapisane na telefonie (lodówka, mapowania paragonów, kody) przenoszę na połączone produkty.
function migrujScalenia() {
  const zm = [], lacz = (a, b) => Math.round(((a || 0) + b) * 10) / 10;
  for (const [stary, [nowy, g]] of Object.entries(SCAL)) {
    const us = lodowka[stary];
    if (us) {
      lodowka[nowy] = lodowka[nowy] || {};
      for (const [u, q] of Object.entries(us)) { const nu = u === 'g' ? 'szt.' : u, nq = u === 'g' ? q / g : (stary === 'pomidor' && u === 'szt.' ? q * 10 : q); lodowka[nowy][nu] = lacz(lodowka[nowy][nu], nq); zm.push([['lodowka', nowy, nu], lodowka[nowy][nu]]); }
      delete lodowka[stary]; zm.push([['lodowka', stary], undefined]); LS.set('lodowka', lodowka);
    }
    if (ceny[stary]) { delete ceny[stary]; zm.push([['ceny', stary], undefined]); LS.set('ceny', ceny); }
    if (pakiety[stary]) { delete pakiety[stary]; zm.push([['pakiety', stary], undefined]); LS.set('pakiety', pakiety); }
    if (wlasneProd[stary]) { delete wlasneProd[stary]; zm.push([['wlasneProd', stary], undefined]); LS.set('wlasneProd', wlasneProd); }
    for (const [k, v] of Object.entries(mapaPar)) if (v === stary) { mapaPar[k] = nowy; zm.push([['mapaPar', k], nowy]); LS.set('mapaPar', mapaPar); }
    for (const [k, v] of Object.entries(kody)) if (v && v.p === stary) { delete kody[k]; zm.push([['kody', k], undefined]); LS.set('kody', kody); }
  }
  if (zm.length) Z(zm);
}
// Jeden produkt „owoce mrożone”: w przepisach, zakupach i lodówce nie rozróżniam, jakie to owoce (maliny, jagody, mango, brzoskwinie…).
// Nazwy dań zostają bez zmian (np. „Jagodowy klasyk”). Kcal i białko wierszy zostają, powtórzone wiersze w daniu łączę.
const OWOCE_MROZ = 'owoce mrożone';
const STARE_OWOCE = ['owoce mrożone (mieszanka)', 'mieszanka tropikalna mrożona (mango, ananas…)', 'maliny mrożone', 'truskawki mrożone', 'jagody mrożone', 'wiśnie mrożone', 'mango mrożone', 'brzoskwinie mrożone'];
const owoceTekst = t => String(t)
  .replace(/mrożon(?:ej|ych|e|ego) mieszank\w+ (?:owoców leśnych|tropikaln\w+)(?: \([^)]*\))?/gi, 'mrożonych owoców')
  .replace(/mrożon(?:ych|e) (?:malin|jagód|truskawek|wiśni|brzoskwiń)/gi, 'mrożonych owoców')
  .replace(/mrożon(?:ego|e) mango/gi, 'mrożonych owoców')
  .replace(/mieszank\w+ owoców leśnych/gi, 'owoców')
  .replace(/owoce mrożone \(mieszanka(?: leśna)?\)/gi, 'owoce mrożone');
function normalizujOwoce(d) {
  const widziane = new Map(); let bylo = false;
  d.skladniki = d.skladniki.filter(i => {
    if (!STARE_OWOCE.includes(i.produkt || '')) return true;
    bylo = true; i.produkt = OWOCE_MROZ; i.nazwa = OWOCE_MROZ;
    const k = (i.grupa || '') + '|' + i.jednostka, p = widziane.get(k);
    if (!p) { widziane.set(k, i); return true; }
    p.ilosc += i.ilosc; p.kcal = (p.kcal || 0) + (i.kcal || 0); p.bialko = (p.bialko || 0) + (i.bialko || 0);
    return false;
  });
  for (const pole of ['kroki', 'wieczorem']) if (Array.isArray(d[pole])) d[pole] = d[pole].map(owoceTekst);
}
// Dane zapisane na telefonie (lodówka, ceny, paragony, kody) przenoszę na jeden produkt „owoce mrożone”.
function migrujOwoceMroz() {
  const zm = [], lacz = (a, b) => Math.round(((a || 0) + b) * 10) / 10;
  for (const stary of STARE_OWOCE) {
    if (stary === OWOCE_MROZ) continue;
    const us = lodowka[stary];
    if (us) { lodowka[OWOCE_MROZ] = lodowka[OWOCE_MROZ] || {}; for (const [u, q] of Object.entries(us)) { lodowka[OWOCE_MROZ][u] = lacz(lodowka[OWOCE_MROZ][u], q); zm.push([['lodowka', OWOCE_MROZ, u], lodowka[OWOCE_MROZ][u]]); } delete lodowka[stary]; zm.push([['lodowka', stary], undefined]); LS.set('lodowka', lodowka); }
    if (lodData && lodData[stary]) { if (!lodData[OWOCE_MROZ] || lodData[stary] > lodData[OWOCE_MROZ]) { lodData[OWOCE_MROZ] = lodData[stary]; zm.push([['lodData', OWOCE_MROZ], lodData[OWOCE_MROZ]]); } delete lodData[stary]; zm.push([['lodData', stary], undefined]); LS.set('lodData', lodData); }
    if (ceny[stary]) { if (!ceny[OWOCE_MROZ]) { ceny[OWOCE_MROZ] = ceny[stary]; zm.push([['ceny', OWOCE_MROZ], ceny[OWOCE_MROZ]]); } delete ceny[stary]; zm.push([['ceny', stary], undefined]); LS.set('ceny', ceny); }
    if (pakiety[stary]) { if (!pakiety[OWOCE_MROZ]) { pakiety[OWOCE_MROZ] = pakiety[stary]; zm.push([['pakiety', OWOCE_MROZ], pakiety[OWOCE_MROZ]]); } delete pakiety[stary]; zm.push([['pakiety', stary], undefined]); LS.set('pakiety', pakiety); }
    if (wlasneProd[stary]) { delete wlasneProd[stary]; zm.push([['wlasneProd', stary], undefined]); LS.set('wlasneProd', wlasneProd); }
    for (const [k, v] of Object.entries(mapaPar)) if (v === stary) { mapaPar[k] = OWOCE_MROZ; zm.push([['mapaPar', k], OWOCE_MROZ]); LS.set('mapaPar', mapaPar); }
    for (const [k, v] of Object.entries(kody)) if (v && v.p === stary) { v.p = OWOCE_MROZ; zm.push([['kody', k, 'p'], OWOCE_MROZ]); LS.set('kody', kody); }
    const ok = 'zak|' + stary;
    if (odhaczone[ok] !== undefined) { if (odhaczone['zak|' + OWOCE_MROZ] === undefined) { odhaczone['zak|' + OWOCE_MROZ] = odhaczone[ok]; zm.push([['odhaczone', 'zak|' + OWOCE_MROZ], odhaczone[ok]]); } delete odhaczone[ok]; zm.push([['odhaczone', ok], undefined]); LS.set('odhaczone', odhaczone); }
  }
  if (zm.length) Z(zm);
}
// Wszystko w gramach: łyżki i łyżeczki z przepisów zamieniam na gramy (wg produktu), a opis „≈ 1 łyżka” zostaje jako podpowiedź.
const G_LYZKA = { 'oliwa / olej': 10, 'miód': 20, 'sos sojowy': 15, 'sezam': 10, 'koncentrat pomidorowy': 15, 'dżem': 20, 'ketchup': 20, 'pesto bazyliowe': 15 };
const G_LYZECZKA = { 'masło': 5, 'musztarda': 5, 'kakao gorzkie': 3, 'miód': 7, 'chrzan': 5, 'skrobia ziemniaczana': 5, 'gochujang': 6, 'olej sezamowy': 4 };
const gNaLyzke = (prod, jedn) => jedn === 'łyż.' ? (G_LYZKA[prod] || 15) : (G_LYZECZKA[prod] || 5);
// Łyżki i łyżeczki w opisach kroków („1 łyżeczkę chrzanu”, „3 łyżeczki masła”) → gramy wg produktu: „5 g chrzanu (≈ 1 łyżeczka)”.
// Tylko produkty ze znaną wagą łyżki; reszta (np. szczypiorek, przyprawy w nawiasach) zostaje bez zmian.
const KROK_LYZKI = [[/^masła orzechowego/i, 20, 7], [/^masła/i, 15, 5], [/^chrzanu/i, 15, 5], [/^dżemu/i, 20, 7], [/^musztardy/i, 15, 5], [/^miodu/i, 20, 7], [/^ketchupu/i, 20, 7], [/^(oliwy|oleju)/i, 10, 4], [/^octu/i, 15, 5], [/^sosu sojowego/i, 15, 5], [/^syropu/i, 25, 8], [/^koncentratu/i, 15, 5], [/^śmietany/i, 20, 7], [/^skyru/i, 25, 8], [/^jogurtu/i, 20, 7], [/^cukru/i, 15, 5], [/^soku z cytryny/i, 15, 5], [/^pesto/i, 15, 5], [/^sezamu/i, 10, 3], [/^skrobi/i, 10, 5], [/^kakao/i, 8, 3], [/^gochujang/i, 18, 6]];
const KROK_UL = { '½': .5, '¼': .25, '¾': .75 };
const KROK_RE = new RegExp(String.raw`(\d+(?:,\d+)?\s?[½¼¾]?|[½¼¾])?(\s?)(łyżk[a-ząćęłńóśźż]*|łyżecz[a-ząćęłńóśźż]*)((?:\s+czubat[a-ząćęłńóśźż]+)?)\s+(${KROK_LYZKI.map(r => r[0].source.slice(1)).join('|')})`, 'gi');
function krokiNaGramy(t) {
  const ul = n => { const c = Math.floor(n), r = n - c, fr = r === .5 ? '½' : r === .25 ? '¼' : r === .75 ? '¾' : ''; return String(c || '') + fr || '0'; };
  return String(t).replace(KROK_RE, (c, l, sp, sl, cz, prod) => {
    const dod = (l || '').trim(), ecz = /^łyżecz/i.test(sl);
    const v = dod ? (parseFloat(dod.replace(/[½¼¾]/g, '').replace(',', '.')) || 0) + (KROK_UL[(dod.match(/[½¼¾]/) || [''])[0]] || 0) : (/^łyż(k|eczk)[ęą]$/i.test(sl) ? 1 : 0);
    const hit = KROK_LYZKI.find(([re]) => re.test(prod));
    if (!v || !hit) return c;
    const g = Math.round(v * (ecz ? hit[2] : hit[1]) * 10) / 10;
    return `${String(g).replace('.', ',')} g ${prod}`;
  });
}
const KROK_PRZED = [[/(masł(?:em|o|a))\b/i, 'masło'], [/(ketchup(?:em|u)?)\b/i, 'ketchup'], [/(sezam(?:em|u)?)\b/i, 'sezam'], [/(miod(?:em|u)?|miód|miodem)\b/i, 'miód'], [/(musztard(?:ą|a|y))\b/i, 'musztarda'], [/(dżem(?:em|u)?)\b/i, 'dżem'], [/(chrzan(?:em|u)?)\b/i, 'chrzan'], [/(pesto)\b/i, 'pesto'], [/(kakao)\b/i, 'kakao gorzkie'], [/(skrob[a-ząćęłńóśźż]*)/i, 'skrobia ziemniaczana'], [/(syrop[a-ząćęłńóśźż]*)/i, 'syrop'], [/(koncentrat[a-ząćęłńóśźż]*)/i, 'koncentrat pomidorowy'], [/(ocet|octu|octem)\b/i, 'ocet'], [/(olej[a-ząćęłńóśźż]*|oliw[a-ząćęłńóśźż]*)/i, 'oliwa / olej']];
// „masłem (po ½ łyżeczki = 3 g)” → „masłem (po 3 g)”: nawiasy z łyżką po nazwie produktu też zamieniam na gramy.
function krokiNaGramyPrzed(t) {
  return String(t).replace(/(masł(?:em|o|a)|ketchup(?:em|u)?|sezam(?:em|u)?|miód|miodem|miodu|musztard(?:ą|a|y)|dżem(?:em|u)?|chrzan(?:em|u)?|pesto|kakao|skrob[a-ząćęłńóśźż]*|syrop[a-ząćęłńóśźż]*|koncentrat[a-ząćęłńóśźż]*|ocet|octu|octem|olej[a-ząćęłńóśźż]*|oliw[a-ząćęłńóśźż]*)(\s*)\((po |razem |ok\. )?(\d+(?:,\d+)?\s?[½¼¾]?|[½¼¾]|1)\s*(łyżk[a-ząćęłńóśźż]*|łyżecz[a-ząćęłńóśźż]*)(?:\s+łącznie)?(?:\s*=\s*\d+(?:,\d+)?\s*g(?:\s+łącznie)?)?\)/gi, (c, prod, sp, przed, l, sl) => {
    const hit = KROK_PRZED.find(([re]) => re.test(prod)), n = String(l).trim(), v = (parseFloat(n.replace(/[½¼¾]/g, '').replace(',', '.')) || 0) + ({ '½': .5, '¼': .25, '¾': .75 }[(n.match(/[½¼¾]/) || [''])[0]] || 0);
    if (!hit || !v) return c;
    const ecz = /^łyżecz/i.test(sl), g = Math.round(v * gNaLyzke(hit[1], ecz ? 'łyżecz.' : 'łyż.') * 10) / 10;
    return `${prod}${sp}(${przed || ''}${String(g).replace('.', ',')} g)`;
  });
}
function normalizujLyzki(d) {
  if (Array.isArray(d.kroki)) d.kroki = d.kroki.map(k => krokiNaGramyPrzed(krokiNaGramy(k)).replace(/(drugiej|pierwszej|kolejnej) (łyżce|łyżeczce) (oliwy|masła|oleju)/gi, (c, ktora, sl, prod) => `${ktora} porcji ${prod} (${/oliw|olej/i.test(prod) ? 10 : 5} g)`));
  for (const i of d.skladniki) if (i.ilosc && (i.jednostka === 'łyż.' || i.jednostka === 'łyżecz.')) {
    const per = gNaLyzke(i.produkt, i.jednostka);
    i.orig = { ilosc: i.ilosc, jednostka: i.jednostka, g: per };
    i.ilosc = Math.round(i.ilosc * per * 10) / 10; i.jednostka = 'g';
  }
}
// „2 łyżki” w tekście → „2 łyżki (30 g)” (bez skalowania; do tekstów przypraw)
const wNawiasie = (t, off) => t.slice(0, off).split('(').length > t.slice(0, off).split(')').length;     // czy miejsce w tekście jest już w nawiasie
const lyzkiOpis = t => String(t).replace(/(\d+(?:,\d+)?)?([½¼¾])?(\s)(łyżk[a-ząćęłńóśźż]*|łyżecz[a-ząćęłńóśźż]*)/g, (c, l, f, sp, sl, off, str) => {
  if (!l && !f) return c;
  const v = (l ? parseFloat(l.replace(',', '.')) : 0) + ({ '½': .5, '¼': .25, '¾': .75 }[f] || 0), per = /^łyżecz/.test(sl) ? 5 : 15;
  return `${l || ''}${f || ''}${sp}${sl} ${wNawiasie(str, off) ? '= ' : '('}${Math.round(v * per)} g${wNawiasie(str, off) ? '' : ')'}`;
});
// Puszki (tuńczyk) w gramach, jak łyżki: przepis liczy 185 g na puszkę, a lodówka i zakupy liczą w gramach — wtedy puszki z paragonu (np. 160 g) odliczają się dokładnie.
function normalizujPuszki(d) {
  for (const i of d.skladniki) if (i.ilosc && i.jednostka === 'pusz.') {
    const m = (i.produkt || '').match(/puszka\s+(\d+)\s*g/i), per = m ? +m[1] : 185;
    i.orig = { ilosc: i.ilosc, jednostka: 'pusz.', g: per };
    i.ilosc = Math.round(i.ilosc * per * 10) / 10; i.jednostka = 'g';
    i.produkt = i.produkt.replace(/\s*\(puszka[^)]*\)/i, '').trim(); i.nazwa = (i.nazwa || '').replace(/\s*\(puszka[^)]*\)/i, '').trim();
  }
}
// Stare wpisy lodówki „tuńczyk (puszka 185 g)” w puszkach przeliczam na gramy (wartości ustawiam, nie dodaję — dwa telefony dadzą ten sam wynik).
function migrujPuszki() {
  const zm = [];
  for (const [k, us] of Object.entries(lodowka)) if (us && us['pusz.'] != null && /puszka\s+\d+\s*g/i.test(k)) {
    const per = +(k.match(/puszka\s+(\d+)\s*g/i)[1]), nowy = k.replace(/\s*\(puszka[^)]*\)/i, '').trim(), g = Math.round(us['pusz.'] * per * 10) / 10;
    lodowka[nowy] = lodowka[nowy] || {}; lodowka[nowy].g = Math.round(((lodowka[nowy].g || 0) + g) * 10) / 10; delete us['pusz.']; if (!Object.keys(us).length) delete lodowka[k];
    zm.push([['lodowka', k, 'pusz.'], undefined], [['lodowka', nowy, 'g'], lodowka[nowy].g]);
  }
  if (zm.length) { LS.set('lodowka', lodowka); Z(zm); }
}
// Stare stany w łyżkach i łyżeczkach (lodówka, kupione ilości przy odhaczonych zakupach) → gramy albo ml, zależnie od tego, w czym liczy się dany produkt.
// Wartości ustawiam, nie dodaję, żeby dwa telefony dały ten sam wynik.
function migrujLyzkiStanow() {
  const jedn = u => /^łyżecz/.test(u) ? 'łyżecz.' : /^łyż/.test(u) ? 'łyż.' : null, zm = [];
  const przelicz = (obj, prod, sciezka) => {
    let ruszone = false;
    for (const u of Object.keys(obj)) {
      const j = jedn(u); if (!j || typeof obj[u] !== 'number') continue;
      const info = DB.produkty && DB.produkty.get(prod), cel = info && info.u === 'ml' ? 'ml' : 'g', q = obj[u];
      delete obj[u]; obj[cel] = Math.round(((obj[cel] || 0) + q * gNaLyzke(prod, j)) * 10) / 10; ruszone = true;
      zm.push([[...sciezka, u], undefined], [[...sciezka, cel], obj[cel]]);
    }
    return ruszone;
  };
  for (const [prod, us] of Object.entries(lodowka)) if (us && typeof us === 'object') przelicz(us, prod, ['lodowka', prod]);
  for (const [k, v] of Object.entries(odhaczone)) if (v && typeof v === 'object' && k.startsWith('zak|')) przelicz(v, k.slice(4), ['odhaczone', k]);
  if (zm.length) { LS.set('lodowka', lodowka); LS.set('odhaczone', odhaczone); Z(zm); pokazToast('Przeliczyłem łyżki w lodówce i zakupach na gramy.'); }
}
// ---------- standardowe opakowania: z paragonów („Ciecierzyca 540g”, „Tortilla 6szt”) do zasady zero waste ----------
function etykietaPaku(prod) {
  const n = znorm(prod);
  if (DB.opak[prod] && DB.opak[prod].rodzaj) return DB.opak[prod].rodzaj;
  if (/^(tunczyk|ciecierzyc|fasol|kukurydza konserw|ananas z puszki|pomidory krojone)/.test(n)) return 'puszka';
  if (/passata|ketchup|oliw|olej|sos |mleko/.test(n)) return 'butelka';
  if (/miod|dzem|musztard|chrzan|pesto|maslo orzech|ogorek kiszony/.test(n)) return 'słoik';
  return 'opak.';
}
function zastosujPakiety() {
  for (const [prod, x] of Object.entries(pakiety)) if (x && x.r > 0) DB.opak[prod] = { rodzaj: x.et || 'opak.', wielkosc: x.r, jednostka: x.u };
}
function uczPak(prod, r, u) {
  if (!(r > 0) || !u) return;
  const x = (pakiety[prod] = pakiety[prod] || { w: [] });
  x.r = r; x.u = u; x.et = etykietaPaku(prod); x.t = isoDzis(); x.w = [r].concat((x.w || []).filter(v => v !== r)).slice(0, 4);
  zastosujPakiety();
}
const pakProd = prod => { const o = DB.opak[prod]; return o && o.wielkosc > 0 ? { r: o.wielkosc, u: o.jednostka, et: o.rodzaj || 'opak.', w: (pakiety[prod] && pakiety[prod].w) || [o.wielkosc] } : null; };
const fmtPak = x => String(Math.round(x * 10) / 10).replace('.', ',');
async function wczytajBaze() {
  const [dania, dodane, shake, opak] = await Promise.all([
    wczytaj('dania.json'), wczytaj('dania-dodane.json', []), wczytaj('shake.json'), wczytaj('opakowania.json', {})
  ]);
  DB.dania.clear();
  for (const d of dania.concat(dodane, wlasneDania.map(x => JSON.parse(JSON.stringify(x))))) { normalizujPomidory(d); normalizujScalone(d); normalizujOwoce(d); normalizujLyzki(d); normalizujPuszki(d); DB.dania.set(d.id, d); }
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
const skala = (g, i) => (stala(i) ? (g.nF || 1) : (g.lev.has(i) ? g.a : g.b)) + (g.gosc ? g.gosc / ((g.dish && g.dish.porcje) || 2) : 0);   // goście: każdy dojada 1 standardową porcję przepisu

// ---------- silnik: cały tydzień ----------
// Pominięty posiłek (day.pom[osoba][slot]): znika z dnia tej osoby. Jego kalorie nie przepadają:
// 40% (max +25%) rozkładam na pozostałe posiłki tego samego dnia, reszta idzie na następny dzień (max +15% jego celu).
const pozaKcal = (day, p) => sum((day && day.poza && day.poza[p]) || [], x => x.k || 0);
// Sztywny cel dnia (kcal i białko): plan tego dnia BEZ pominięć i BEZ posiłków spoza planu. Zjedzone poza planem zwiększają tylko „zjedzone”, a pominięcie tylko przesuwa kalorie, nie zmienia celu.
function bazaDnia(pl, c, d, p) {
  const day = pl.dni[d], maPom = !!(day.pom && day.pom[p] && Object.keys(day.pom[p]).some(k => day.pom[p][k]));
  if (!pozaKcal(day, p) && !maPom) return null;
  const kopia = Object.assign({}, pl, { dni: pl.dni.map((dd, i) => i === d ? Object.assign({}, dd, { poza: { ona: [], on: [] }, pom: { ona: {}, on: {} }, pomSl: {} }) : dd) });
  const x = oblicz(kopia, c).dni[d][p]; return { kcal: x.kcal, b: x.b };
}
const celDnia = (pl, c, d, p) => { const b = bazaDnia(pl, c, d, p); return b ? b.kcal : null; };
const pomija = (day, p, slot) => !!(day && day.pom && day.pom[p] && day.pom[p][slot]);
const shakeAkt = (day, p) => !!(day.tr[p] && !nieob(day, p) && !pomija(day, p, 'shake'));
function oblicz(pl, c) {
  const dni = pl.dni.map(() => ({ ona: { kcal: 0, b: 0 }, on: { kcal: 0, b: 0 }, sloty: [], przenos: { ona: {}, on: {} } }));
  const garnki = [];
  const udz = slot => slot.startsWith('m13') ? 'm13' : slot;
  const bud0 = (p, d, slot) => UDZIAL[p][udz(slot)] * (c[p].kcal - (pl.dni[d].tr[p] ? DB.shake[p].kcal : 0));
  const maOb = x => !!(pl.dni[x].ob || (x > 0 && pl.dni[x - 1].ob2 && pl.dni[x - 1].ob));
  const slotyOsoby = (d, p) => ['sn', pl.dni[d].m13.wsp ? 'm13' : 'm13' + p, maOb(d) ? 'ob' : null, 'k18'].filter(Boolean);
  const mnoz = pl.dni.map(() => ({ ona: 1, on: 1 }));
  // day.pomSl[osoba] = posiłki, które były jeszcze do zjedzenia w chwili pominięcia: tylko one dostają przeniesione kalorie (zjedzony posiłek nie rośnie wstecz). Brak wpisu = wszystkie (stare dane).
  const nm = x => String(x).startsWith('m13') ? 'm13' : x;
  const el = (day, p, x) => !(day.pomSl && day.pomSl[p]) || day.pomSl[p].some(y => nm(y) === nm(x));
  OS.forEach(p => {
    let wchodzi = 0;
    pl.dni.forEach((day, d) => {
      if (nieob(day, p)) { wchodzi = 0; return; }
      const sl = slotyOsoby(d, p), rem = sum(sl.filter(x => !pomija(day, p, x) && el(day, p, x)), x => bud0(p, d, x));
      const skp = sum(sl.filter(x => pomija(day, p, x)), x => bud0(p, d, x)) + (day.tr[p] && pomija(day, p, 'shake') ? DB.shake[p].kcal : 0);
      const przyj = rem > 0 ? Math.min(wchodzi, 0.15 * c[p].kcal) : 0, same = rem > 0 ? Math.min(0.4 * skp, 0.25 * rem) : 0;
      mnoz[d][p] = rem > 0 ? Math.min(1.4, 1 + (przyj + same) / rem) : 1;
      dni[d].przenos[p] = { przyj, same, skp };
      wchodzi = (rem > 0 ? 0 : wchodzi) + skp - same;
    });
  });
  // Jedzenie poza planem (day.poza[osoba] = [{ n, k, sl: [posiłki, które zostały do zjedzenia w chwili wpisu] }]): te posiłki dostają mniej, żeby dzień zgadzał się z celem (nie mniej niż 50%).
  const fPz = pl.dni.map((day, d) => { const o = { ona: {}, on: {} }; OS.forEach(p => ((day.poza && day.poza[p]) || []).forEach(e => { const E = (e.sl || []).filter(x => slotyOsoby(d, p).includes(x) && !pomija(day, p, x)), S = sum(E, x => bud0(p, d, x) * (el(day, p, x) ? mnoz[d][p] : 1)); if (!S) return; const f = Math.max(0.5, (S - (e.k || 0)) / S); E.forEach(x => { o[p][x] = (o[p][x] || 1) * f; }); })); return o; });
  const bud = (p, d, slot) => bud0(p, d, slot) * (el(pl.dni[d], p, slot) ? mnoz[d][p] : 1) * (fPz[d][p][slot] || 1);
  const obecni = d => OS.filter(p => !nieob(pl.dni[d], p));
  const obecniSlot = (d, slot) => OS.filter(p => !nieob(pl.dni[d], p) && !pomija(pl.dni[d], p, slot));
  function garnek(id, slot, d, porcje, ratio) {
    const dish = DB.dania.get(id);
    if (!dish || !porcje.length) return null;                 // nikt nie je tego posiłku (nieobecność albo pominięty)
    let K = sum(porcje, x => x.kcal);
    const r = rz(dish, K, ratio, slot);
    if (Math.abs(r.Kreal - K) > 0.5) { const f = r.Kreal / K; porcje.forEach(x => { x.kcal *= f; }); K = r.Kreal; }   // stałe woreczki mogą lekko zmienić kcal posiłku
    const g = Object.assign({ dish, slot, d, porcje, K, ratio }, r);
    for (const x of porcje) {
      x.udzial = x.kcal / K; x.b = x.udzial * g.P;
      dni[x.d][x.p].kcal += x.kcal; dni[x.d][x.p].b += x.b;
      if (!dni[x.d].sloty.some(s => s.g === g)) dni[x.d].sloty.push({ g, odgrzewane: x.d !== d });
    }
    if (slot === 'ob') g.gosc = sum([...new Set(porcje.map(q => q.d))], x => pl.dni[x].gosc || 0);   // goście na obiad nie zmieniają kalorii domowników, tylko ilości do kupienia i ugotowania
    garnki.push(g);
    return g;
  }
  pl.dni.forEach((day, d) => {
    const r = day.ratio || {};
    garnek(day.sn, 'sn', d, obecniSlot(d, 'sn').map(p => ({ p, d, kcal: bud(p, d, 'sn') })), r.sn);
    if (day.m13.wsp) garnek(day.m13.wsp, 'm13', d, obecniSlot(d, 'm13').map(p => ({ p, d, kcal: bud(p, d, 'm13') })), r.m13);
    else obecni(d).forEach(p => { if (!pomija(day, p, 'm13' + p)) garnek(day.m13[p], 'm13' + p, d, [{ p, d, kcal: bud(p, d, 'm13') }], r['m13' + p]); });
    if (day.ob) {
      const dd = day.ob2 && d + 1 < 7 ? [d, d + 1] : [d];
      garnek(day.ob, 'ob', d, dd.flatMap(x => obecniSlot(x, 'ob').map(p => ({ p, d: x, kcal: bud(p, x, 'ob') }))), r.ob);
    }
    const k = DB.dania.get(day.k18);
    if (k) {
      const pz = k.podzial['~18:00'], bn = bud('on', d, 'k18'), onJe = !nieob(day, 'on') && !pomija(day, 'on', 'k18'), onaJe = !nieob(day, 'ona') && !pomija(day, 'ona', 'k18');
      const gs = bn / pz.on_kcal, reszta = (k.razem.kcal - pz.ona_kcal) * gs;
      const por = [];
      if (onaJe) por.push({ p: 'ona', d, kcal: bud('ona', d, 'k18') });
      if (onJe) por.push({ p: 'on', d, kcal: reszta });
      const g = garnek(day.k18, 'k18', d, por, r.k18);
      if (g && onJe) {
        g.dosypka = { skala: gs, kcal: bn - reszta, b: DB.dosypka.b * gs };
        dni[d].on.kcal += g.dosypka.kcal; dni[d].on.b += g.dosypka.b;
      }
    }
    OS.forEach(p => { if (shakeAkt(day, p)) { dni[d][p].kcal += DB.shake[p].kcal; dni[d][p].b += DB.shake[p].bialko; } });
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
// ---------- czego nie jecie ----------
const GRUPY_WYKL = {
  ryby: ['Ryby i owoce morza', /(^|[^a-z0-9])(losos|dorsz|tunczyk|ryb|krewet|sledz|makrel|paluszki rybne)/],
  wieprzowina: ['Wieprzowina', /(^|[^a-z0-9])(wieprzow|boczek|kielbas|schab|zeberk|karkowk)/],
  wolowina: ['Wołowina', /(^|[^a-z0-9])wolowin/],
  drob: ['Drób', /(^|[^a-z0-9])(kurczak|indyk|drob|cwiartki)/],
  jaja: ['Jaja', /(^|[^a-z0-9])(jaj|jajk|jajecz)/],
  nabial: ['Nabiał (bez odżywki)', /(^|[^a-z0-9])(mleko|skyr|jogurt|ser |ser$|serek|twarog|smietan|maslo(?! orzech)|kefir|feta|parmezan|mozzarella)/],
  orzechy: ['Orzechy i orzeszki', /(^|[^a-z0-9])(orzech|orzesz|migdal|nerkowc|pistacj)/],
  gluten: ['Gluten (pszenica, żyto)', /(^|[^a-z0-9])(pszen|zytn|maka|makaron(?! ryzow)|manna|chleb|bulk|tortilla|pieczywo|kuskus|bulgur|lasagne|gnocchi|zacierk|zakwas)/],
  ostre: ['Ostre (chili)', /(^|[^a-z0-9])(chili|gochujang)/],
  grzyby: ['Grzyby i pieczarki', /(^|[^a-z0-9])(pieczark|grzyb)/],
  cebula: ['Cebula', /(^|[^a-z0-9])cebul/],
  czosnek: ['Czosnek', /(^|[^a-z0-9])czosnek/]
};
const tekstDania = d => d._tw || (d._tw = znorm([d.nazwa, ...d.skladniki.map(i => (i.produkt || '') + ' ' + (i.nazwa || '')), ...(d.przyprawy || [])].join(' | ')));
const KOMP_WYKL = {};
function wzorWykl(w) {
  if (KOMP_WYKL[w]) return KOMP_WYKL[w];
  const m = w.startsWith('g:') ? (GRUPY_WYKL[w.slice(2)] || [w, /$^/])[1] : new RegExp('(^|[^a-z0-9])' + znorm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return (KOMP_WYKL[w] = m);
}
const etykietaWykl = w => w.startsWith('g:') ? (GRUPY_WYKL[w.slice(2)] || [w])[0] : w;
// Co z listy osoby p zawiera danie (puste = można jeść).
function naruszenia(d, p) {
  const lista = (wyklucz[p] || []).filter(w => znorm(w.replace(/^g:/, '')).length >= 2);
  if (!lista.length) return [];
  const t = tekstDania(d);
  return lista.filter(w => {
    if (!wzorWykl(w).test(t)) return false;
    if (p === 'ona' && /cebul/.test(w.replace(/^g:/, '')) && /uzyj pora/.test(znorm(d.uwaga || ''))) return false;   // „cebula tylko dla niego — dla niej por”
    return true;
  }).map(etykietaWykl);
}
const dopuszcza = (d, osoby) => osoby.every(p => !naruszenia(d, p).length);
const KTO_PULI = { sn: OS, m13ona: ['ona'], m13on: ['on'], m13: OS, k18: OS, ob1: OS, ob2: OS, m13kokt: OS, m13dania: OS };
const osobySlotu = slot => slot === 'm13ona' ? ['ona'] : slot === 'm13on' ? ['on'] : OS;
// Naruszenia w całym planie: gdzie posiłek zawiera coś, czego ktoś z jedzących go nie je.
function naruszeniaPlanu(pl, odDnia = '') {
  const out = [];
  pl.dni.forEach((day, d) => {
    if (odDnia && dodajDni(pl.start, d) < odDnia) return;
    const sloty = [['sn', day.sn], day.m13.wsp ? ['m13', day.m13.wsp] : null, !day.m13.wsp ? ['m13ona', day.m13.ona] : null, !day.m13.wsp ? ['m13on', day.m13.on] : null, day.ob ? ['ob', day.ob] : null, ['k18', day.k18]].filter(Boolean);
    for (const [slot, id] of sloty) {
      const dish = DB.dania.get(id); if (!dish) continue;
      const kto = osobySlotu(slot).filter(p => !nieob(day, p) && !pomija(day, p, slot));
      const nar = kto.map(p => [p, naruszenia(dish, p)]).filter(x => x[1].length);
      if (nar.length) out.push({ d, slot, id, nar });
    }
  });
  return out;
}
function kandydat() {
  // ukryte dania pomijam (chyba że w danej puli zostałoby mniej niż 2 dania)
  const P = Object.fromEntries(Object.entries(DB.pula).map(([k, v]) => { const ok = v.filter(d => !ukryte(d.id) && dopuszcza(d, KTO_PULI[k] || OS)); const ok2 = v.filter(d => !ukryte(d.id)); return [k, ok.length >= 1 ? ok : ok2.length >= 2 ? ok2 : v]; }));   // dozwolone dania nawet jeśli został 1 (będzie się powtarzał); dopiero przy 0 dozwolonych wracam do pełnej puli
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
  kara += 300 * naruszeniaPlanu(pl).length + smakKara(pl) + sezonKara(pl);                       // dania z wykluczonymi składnikami to ostateczność
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
  if (plan && plan.start === naj.start) naj.dni.forEach((d, i) => {   // zablokowane dania zostają przy losowaniu tego samego tygodnia
    const st = plan.dni[i]; if (!st || !st.blok) return; d.blok = st.blok; d.ratio = d.ratio || {};
    for (const sl of Object.keys(st.blok).filter(k => st.blok[k])) {
      if (sl === 'm13') d.m13.wsp = st.m13.wsp; else if (sl === 'm13ona') d.m13.ona = st.m13.ona; else if (sl === 'm13on') d.m13.on = st.m13.on; else if (sl === 'ob') { d.ob = st.ob; d.ob2 = st.ob2; } else d[sl] = st[sl];
      if (st.ratio && st.ratio[sl] !== undefined) d.ratio[sl] = st.ratio[sl];
    }
  });
  if (plan && plan.start === naj.start) naj.dni.forEach((d, i) => { if (plan.dni[i] && plan.dni[i].nb) d.nb = plan.dni[i].nb; if (plan.dni[i] && plan.dni[i].pom) d.pom = plan.dni[i].pom; });   // przy losowaniu tego samego tygodnia zostają dni „bez niego/niej”
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
      const kand = pula.filter(x => !ukryte(x.id) && dopuszcza(x, KTO_PULI[slot === 'm13' ? 'm13' : slot === 'ob' ? 'ob1' : slot] || OS)), n = los(kand.length ? kand : pula);
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
const TRWALE = new Set(['mleko 2%', 'jaja', 'masło', 'parmezan', 'ser żółty', 'jogurt naturalny', 'śmietana 12%']);   // długo się trzymają — bez ostrzeżeń o resztkach
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
    t.dni.forEach((day, d) => { if (wyb.has(dodajDni(t.start, d))) OS.forEach(pp => { if (shakeAkt(day, pp)) { dodaj('odżywka białkowa', 'zapas', DB.shake[pp].odzywka_g, 'g'); dodaj('mleko 2%', 'świeże', DB.shake[pp].mleko_ml, 'ml'); } }); });
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
    const pomysly = reszta && a.kat === 'świeże' && !TRWALE.has(prod) && reszta.ulamek >= 0.4 ? pomyslyResztki(prod, reszta, wyb) : null;
    (wynik[a.kat] || wynik.zapas).push({ produkt: prod, ile: czesci.join(' + '), dop, kupno, stan: stanTxt, worki: worki[prod] || null, reszta, pomysly });
  }
  // zero waste: przycisk „Zużyj resztkę” tylko przy 4 największych resztkach, żeby lista nie była usiana ostrzeżeniami
  Object.values(wynik).flat().filter(x => x.pomysly).sort((x, y) => y.reszta.ulamek - x.reszta.ulamek).slice(4).forEach(x => { x.pomysly = null; });
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
    <div class="dnia-liczby">${OS.filter(p => !nieob(day, p)).map(p => `<div class="${p}"><b>${ETY[p]}</b><span>${r0(x[p].kcal)} kcal</span><small>${r0(x[p].b)} g białka</small>${pozaKcal(day, p) ? `<small class="poza-nota">+${r0(pozaKcal(day, p))} kcal poza planem</small>` : ''}${x.przenos[p].przyj > 1 ? `<small class="przen">w tym +${r0(x.przenos[p].przyj)} kcal z poprzedniego dnia</small>` : ''}${x.przenos[p].skp > 1 ? `<small class="przen">pominięte ${r0(x.przenos[p].skp)} kcal: +${r0(x.przenos[p].same)} dziś, reszta jutro</small>${x[p].b < c[p].bMin - 3 ? `<small class="ostrz-txt">brakuje ${r0(c[p].bMin - x[p].b)} g białka do celu — dopij np. skyr lub odżywkę</small>` : ''}` : ''}</div>`).join('')}</div>
    <div class="dnia-ust"><div class="trening"><span class="mute">Trening:</span>${OS.map(p => `<label class="${p}"><input type="checkbox" data-tr="${d}:${p}" ${day.tr[p] ? 'checked' : ''}> ${ETY[p]}</label>`).join('')}</div>
      <div class="kto-dnia"><span class="mute">Kto je w tym dniu:</span><div class="seg mini">${[['oboje', 'Oboje'], ['bezon', 'Bez niego'], ['bezona', 'Bez niej']].map(([k, et]) => `<button data-kto="${d}:${k}" class="${stanKto(day) === k ? 'akt' : ''}">${et}</button>`).join('')}</div></div>
      <button class="btn maly dop-toggle" data-dop-toggle="1" aria-expanded="${dopDzien}">Dopasuj dzień i goście ${dopDzien ? '▴' : '▾'}${day.gosc ? ` · ${day.gosc} ${mn(day.gosc, 'gość', 'gości', 'gości')}` : ''}</button><div class="dop-panel" ${dopDzien ? '' : 'hidden'}><div class="dop-dnia"><span class="mute">Dopasuj dzień:</span><div class="chips">${[['szybko', 'Szybko'], ['bezMiesa', 'Bez mięsa'], ['zimno', 'Bez gotowania'], ['lekko', 'Lekko']].map(([k, et]) => `<button class="chip" data-dop="${d}:${k}">${et}</button>`).join('')}</div></div>
      <div class="gosc-dnia"><span class="mute">Goście na obiad:</span><div class="gosc-ster"><button class="stp" data-gosc="${d}:-1" aria-label="Mniej gości" ${day.gosc ? '' : 'disabled'}>−</button><b>${day.gosc || 0}</b><button class="stp" data-gosc="${d}:1" aria-label="Więcej gości">+</button></div></div></div></div>`;
  x.sloty.forEach(({ g, odgrzewane }) => {
    const moje = g.porcje.filter(q => q.d === d), ez = !!zuzyte[kluczZ(d, g.slot)];
    const liczby = moje.map(q => { const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 }; return `<span class="${q.p}">${ETY[q.p]} ${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g</span>`; }).join('');
    let zn = '';
    { const nar = [...new Set(moje.map(q => q.p))].map(pp => [pp, naruszenia(g.dish, pp)]).filter(x => x[1].length); if (nar.length) zn += `<span class="znaczek ostrz">Uwaga: zawiera ${esc([...new Set(nar.flatMap(x => x[1]))].join(', '))}, a ${nar.map(x => ETY[x[0]]).join(' i ')} ${nar.length > 1 ? 'tego nie jedzą' : 'tego nie je'}</span> `; }
    if (odgrzewane) zn += `<span class="znaczek">Odgrzewasz porcję z dnia: ${DNI_KR[g.d]}</span> `;
    else if (new Set(g.porcje.map(q => q.d)).size > 1) zn += `<span class="znaczek">Gotujesz raz, starcza na 2 dni</span> `;
    // po zamianie dania apka stara się utrzymać białko z poprzedniego dania; pokazuję tylko wyraźną różnicę (3 g na porcję lub więcej)
    if (g.ratio && !g.wyrownane) { const rb = Math.round(Math.abs(g.roznica) / g.porcje.length); if (rb >= 3) zn += `<span class="znaczek ${g.roznica < 0 ? 'ostrz' : ''}">Białko: o ${rb} g ${g.roznica > 0 ? 'więcej' : 'mniej'} na porcję niż w daniu, które tu było wcześniej</span> `; }
    if (g.dodatek) zn += `<span class="znaczek">+ skyr ${fq(g.dodatek.g, 'g')} obok dania</span> `;
    if (((g.sw || g.s) > 1.7 || (g.sw || g.s) < 0.55) && new Set(g.porcje.map(q => q.p)).size > 1) zn += `<span class="znaczek ostrz">Porcja ${(g.sw || g.s) > 1 ? 'większa' : 'mniejsza'} niż w przepisie (${(g.sw || g.s).toFixed(1).replace('.', ',')}×), dopasowana do Waszych kalorii</span>`;
    h += `<div class="pk ${ez ? 'zjedzone' : ''}"><div class="pk-pora">${g.slot === 'm13' && g.dish.typ !== 'koktajl' ? '13:00 · drugie danie' : PORA[g.slot]}${g.slot === 'm13ona' ? ' · ONA' : g.slot === 'm13on' ? ' · ON' : ''}</div>
      <div class="pk-gora">${Obr.html(g.dish)}<div class="pk-tx"><button class="nazwa" data-przepis="${w.garnki.indexOf(g)}:${d}">${oceny[g.dish.id] === 1 ? '★ ' : ''}${esc((g.dish.kod ? g.dish.kod + ' ' : '') + g.dish.nazwa)}</button><div class="liczby">${liczby}</div></div></div>
      ${zn ? `<div class="pk-zn">${zn}</div>` : ''}
      <div class="pk-akcje"><label class="zuzyj"><input type="checkbox" data-zuz="${d}:${g.slot}" ${ez ? 'checked' : ''}> zjedzone</label>${odgrzewane ? '' : `<button class="btn maly" data-zmien="${d}:${g.slot}">Zmień danie</button><button class="btn maly blok blok-ik ${day.blok && day.blok[g.slot] ? 'akt' : ''}" data-blok="${d}:${g.slot}" aria-pressed="${!!(day.blok && day.blok[g.slot])}" aria-label="${day.blok && day.blok[g.slot] ? 'Odblokuj danie' : 'Zablokuj danie (zostanie przy losowaniu tygodnia)'}" title="Zablokuj danie"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${day.blok && day.blok[g.slot] ? 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z' : 'M7 11V8a5 5 0 0 1 9.5-2M6 11h12v9H6z'}"/></svg></button>`}<button class="btn maly pomin" data-pomin="${d}:${g.slot}">Pomiń</button></div></div>`;
  });
  if (day.tr.ona || day.tr.on) h += OS.filter(p => day.tr[p] && !nieob(day, p) && !pomija(day, p, 'shake')).map(p => `<button class="pomin-shake" data-pomin-shake="${d}:${p}">Pomiń shake (${ETY[p]})</button>`).join('');
  h += pominLista(day, d);
  const sh = OS.filter(p => shakeAkt(day, p));
  if (sh.length) h += `<div class="pk"><div class="pk-pora">po treningu · shake</div><div class="liczby">${sh.map(p => `<span class="${p}">${ETY[p]}: odżywka ${DB.shake[p].odzywka_g} g + mleko ${DB.shake[p].mleko_ml} ml · ${DB.shake[p].kcal} kcal · ${DB.shake[p].bialko} g</span>`).join('')}</div></div>`;
  const wi = wieczorem(w, d);
  window._wiecz = wi;
  if (wi.length) h += `<div class="wieczor"><b>Wieczorem przygotuj na jutro</b><ul>${wi.map((it, i) => it.t === 'kroki' ? `<li><b>${esc(it.dish)}</b>: ${esc(it.kroki.join(' '))} <button class="link" data-wiecz-przepis="${i}">Zobacz przepis</button></li>` : `<li>${esc(it.tekst)}</li>`).join('')}</ul></div>`;
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
  h += paskAkcji(['opisz', 'swipe', 'prep', 'podsum', 'wykl', 'zakupy']);
  { const nar = naruszeniaDwochTygodni(); if (nar.length) h += `<div class="przyp"><b>${nar.length} ${nar.length === 1 ? 'posiłek zawiera' : 'posiłków zawiera'} składniki, których nie jecie.</b> <button class="btn maly" data-zamien-wykl>Zamień automatycznie</button> <button class="btn maly" data-tab="wykluczone">Lista</button></div>`; }
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
    if (g.dish.wieczorem && g.dish.wieczorem.length) out.push({ t: 'kroki', klucz: 'w:' + g.dish.id, dish: g.dish.nazwa, g, kroki: g.dish.wieczorem.map(k => krokPrzeliczony(g, k).replace(/^WIECZOREM:\s*/i, '')) });
    for (const i of g.dish.skladniki) {
      if (i.kategoria === 'zamrażarka' && i.ilosc && !/mrożon|paluszki|bułka/.test(i.produkt)) { const tx = `Wyjmij z zamrażarki do lodówki: ${i.produkt} ${fqS(i, i.ilosc * skala(g, i))} (${g.dish.nazwa})`; out.push({ t: 'mroz', klucz: 'z:' + tx, tekst: tx, g }); }
    }
  }
  return out;
}

// Pominięte posiłki dnia (z nazwą dania i przyciskiem „Przywróć”): w Planie i na Dziś.
function pominLista(day, d) {
  const lista = []; OS.forEach(p => { const pm = !nieob(day, p) && day.pom && day.pom[p]; if (pm) Object.keys(pm).filter(k => pm[k]).forEach(k => lista.push([p, k])); });
  if (!lista.length) return '';
  const nazwa = k => { const id = k === 'sn' ? day.sn : k === 'm13' ? day.m13.wsp : k === 'm13ona' ? day.m13.ona : k === 'm13on' ? day.m13.on : k === 'ob' ? (day.ob || (d > 0 && plan.dni[d - 1].ob2 && plan.dni[d - 1].ob)) : k === 'k18' ? day.k18 : null, dd = id && DB.dania.get(id); return dd ? dd.nazwa : ''; };
  return `<div class="pomin-lista"><b>Pominięte posiłki</b>${lista.map(([p, k]) => `<div class="pomin-w"><span><i class="${p}">${ETY[p]}</i> ${k === 'shake' ? 'shake po treningu' : esc(PORA[k].split(' · ').join(' · '))}${nazwa(k) ? `<br><span class="mute">${esc(nazwa(k))}</span>` : ''}</span><button class="btn maly" data-przywroc="${d}:${p}:${k}">Przywróć</button></div>`).join('')}</div>`;
}
function oknoPrzepis(gi) { pokazPrzepis(window._w.garnki[gi], false); }
function pokazPrzepis(g, spont) {
  const dish = g.dish; window._przepisG = g;
  spontG = spont ? g : null; spontWroc = !!spont;
  let wiersze = '', grupa = null;
  for (const i of dish.skladniki) {
    if (i.grupa && i.grupa !== grupa) { grupa = i.grupa; wiersze += `<tr class="grupa"><td colspan="2">${esc(grupa)}</td></tr>`; }
    wiersze += `<tr><td>${esc(i.nazwa)}${i.uwaga ? `<br><span class="mute">${esc(i.uwaga)}</span>` : ''}</td><td>${i.ilosc ? fqS(i, i.ilosc * skala(g, i)) : ''}${i.orig && i.orig.jednostka === 'pusz.' ? `<br><span class="mute">≈ ${(n => ulamek(n) + ' ' + (i.orig.jednostka === 'pusz.' ? (n === 1 ? 'puszka' : n < 5 ? 'puszki' : 'puszek') : n === 1 ? (i.orig.jednostka === 'łyż.' ? 'łyżka' : 'łyżeczka') : (i.orig.jednostka === 'łyż.' ? 'łyżki' : 'łyżeczki')))(Math.max(0.5, Math.round(i.ilosc * skala(g, i) / (i.orig.jednostka === 'pusz.' && pakProd(i.produkt) ? pakProd(i.produkt).r : i.orig.g) * 2) / 2))}</span>` : ''}${i.gSzt && i.ilosc ? (i.ilosc * skala(g, i) > 30 ? `<br><span class="mute">≈ ${Math.round(i.ilosc * skala(g, i))} szt. (${Math.ceil(i.ilosc * skala(g, i) * i.gSzt / 250)} opak. po 250 g)</span>` : `<br><span class="mute">≈ ${Math.max(5, Math.round(i.ilosc * skala(g, i) * i.gSzt / 5) * 5)} g</span>`) : ''}${stala(i) ? '<br><span class="mute">woreczek z zamrażarki</span>' : ''}</td></tr>`;
  }
  // przyprawy i dodatki: osobne wiersze tabeli, z ilością albo „do smaku”
  const spr = przyprawyWiersze(dish);
  if (spr.length) wiersze += `<tr class="grupa"><td colspan="2">PRZYPRAWY I DODATKI</td></tr>` + spr.map(x => `<tr><td>${esc(x.nazwa)}${x.nota ? `<br><span class="mute">${esc(x.nota)}</span>` : ''}</td><td>${x.ilosc ? esc(x.ilosc) : '<span class="mute">do smaku</span>'}</td></tr>`).join('');
  if (g.dodatek) wiersze += `<tr class="grupa"><td colspan="2">DODATEK BIAŁKOWY — OBOK DANIA</td></tr><tr><td>skyr naturalny<br><span class="mute">wyrównuje białko po zamianie dania; dzielicie jak danie</span></td><td>${fq(g.dodatek.g, 'g')}</td></tr>`;
  const pod = podzialPorcji(g);
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>${esc((dish.kod ? dish.kod + ' ' : '') + dish.nazwa)}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <div class="przepis-gora">${Obr.html(dish, 'duzy')}<div class="oceny">${przyciskiOceny(dish.id)}</div></div>
    ${sezonChipy(g.dish)}${notaPrepu(g)}${wskazPrepuPrzepis(g)}
    ${dish.kroki && dish.kroki.length ? `<button class="btn glowny szeroki" data-gotuj="1" style="margin-bottom:6px">Gotuj krok po kroku</button>` : ''}
    <h3 style="margin-top:6px">Jak smakuje?</h3><div class="smak-blok" data-dish="${esc(dish.id)}">${smakWiersze(dish.id, OS)}</div>
    <p class="mute">${dish.czas ? 'Czas: ' + esc(dish.czas) : ''}${dish.sprzet ? ' · Sprzęt: ' + esc(dish.sprzet) : ''}</p>
    ${dish.dodane ? '<p class="mute">Danie dodane do bazy — wartości liczone z tabel, nie z Twojego planu.</p>' : ''}
    <h3>Składniki — ${opisGarnka(g)}</h3>${(() => { const k = kosztDania(g); return k ? `<p class="mute" style="margin:-4px 0 8px">Szacowany koszt składników: <b>ok. ${zl(k.zl)}</b> (ceny z paragonów, ${k.zn} z ${k.raz} składników)</p>` : ''; })()}
    <table class="skl">${wiersze}</table>
    ${(dish.warianty || []).length ? `<h3>Glazura — wybierz jedną</h3>${dish.warianty.map(v => `<p><b>${esc(v.nazwa)}</b>: ${esc(v.sklad)}</p>`).join('')}` : ''}
    ${spont || g.slot === 'ob' ? '' : `<div class="rzad" style="margin-top:12px"><button class="btn maly" data-nudge="${g.d}:${g.slot}:-1">− białka w daniu</button><button class="btn maly" data-nudge="${g.d}:${g.slot}:1">+ białka w daniu</button></div><p class="mute">Zmienia proporcje składników przy tych samych kcal. Przeliczy się makro, lista zakupów i lodówka.</p>`}
    <h3>Kto ile bierze</h3><div class="podzial">${pod}</div>
    ${dish.wieczorem && dish.wieczorem.length ? `<div class="uwaga wiecz-uwaga"><b>Przygotuj dzień wcześniej wieczorem</b><br>W „Wykonaniu” poniżej oznaczone: ${dish.kroki.map((k, n) => /^WIECZOREM/i.test(k) ? n + 1 : 0).filter(Boolean).map(n => 'krok ' + n).join(', ')}.</div>` : ''}${dish.kroki && dish.kroki.length ? `<h3>Wykonanie</h3><p class="mute">Gramy i mililitry w krokach są już przeliczone na Waszą porcję. Liczbę sztuk bierz z tabeli składników.</p><ol class="kroki">${dish.kroki.map(k => { const zs = krokZSesji(g, k), wi = /^WIECZOREM/i.test(k); return `<li class="${zs ? 'krok-prep' : ''} ${wi ? 'krok-wiecz' : ''}">${wi ? '<span class="znaczek wiecz-znak">Dzień wcześniej, wieczorem</span> ' : ''}${esc(krokPrzeliczony(g, k).replace(/^WIECZOREM:\s*/i, ''))}${zs ? `<small>${esc(zs)} — możesz pominąć</small>` : ''}</li>`; }).join('')}</ol>` : ''}
    ${dish.odgrzewanie ? `<p><b>Drugi dzień:</b> ${esc(dish.odgrzewanie)}</p>` : ''}
    ${dish.uwaga ? `<div class="uwaga">${esc(dish.uwaga)}</div>` : ''}
    ${spont ? `<button class="btn glowny szeroki" data-spont-gotuj="1" style="margin-top:14px">Ugotowaliśmy — zdejmij z lodówki</button>` : ''}`;
  $('#modal').hidden = false;
}

// ---------- paragony i ceny ----------
const liczbaZ = t => parseFloat(String(t).replace(/\s/g, '').replace(',', '.'));
const zl = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' zł';
const G_SZT = { banan: 150, 'jabłko': 180, papryka: 200, 'ogórek świeży': 200, cebula: 100, marchew: 90, cukinia: 300, awokado: 200, por: 200, 'pomidorki koktajlowe': 15, 'pietruszka (korzeń)': 80, 'rzodkiewka (pęczek)': 10 };
// E-paragon w JSON (Moja Biedronka i inne sklepy używające e-paragonu JPK): linie w `body[].sellLine`, nagłówek z nazwą i adresem sklepu w `header`,
// a pełny dokument także zakodowany w `data` (pozycja[].towar). Nazwy są skrócone i sklejone („PałeczkiKukurGłod60g C”), więc je rozdzielam.
const htmlNaTekst = h => String(h || '').replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
const czyscNazwe = n => String(n || '').replace(/\s+[A-G]\s*$/, '').replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1 $2').replace(/([a-ząćęłńóśźż%])(\d)/gi, '$1 $2').replace(/\s+/g, ' ').trim();
const wielkieZMalych = t => t.toLowerCase().replace(/(^|[\s.-])([a-ząćęłńóśźż])/g, (m, a, b) => a + b.toUpperCase());
function parsujParagonJson(j) {
  const out = { sklep: '', lokal: '', data: '', godz: '', suma: null, poz: [], ostrz: [] };
  let body = Array.isArray(j.body) ? j.body : null, dok = null;
  try { if (typeof j.data === 'string') { let b = j.data.split('.')[1] || ''; b = b.replace(/-/g, '+').replace(/_/g, '/'); b += '='.repeat((4 - b.length % 4) % 4); dok = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).dokument; } } catch (e) { dok = null; }
  const hl = (Array.isArray(j.header) ? j.header : []).filter(x => x.headerText).flatMap(x => htmlNaTekst(x.headerText.headerTextLines));
  const hd = (Array.isArray(j.header) ? j.header : []).find(x => x.headerData), podm = hl.join(' ');
  out.sklep = /lidl/i.test(podm) ? 'Lidl' : /biedronk|jeronimo/i.test(podm) ? 'Biedronka' : /kaufland/i.test(podm) ? 'Kaufland' : /auchan/i.test(podm) ? 'Auchan' : /carrefour/i.test(podm) ? 'Carrefour' : /netto/i.test(podm) ? 'Netto' : /(żabka|zabka)/i.test(podm) ? 'Żabka' : '';
  if (hl[1]) out.lokal = wielkieZMalych(hl[1]).replace(/\bUl\./, 'ul.');
  const dt = new Date((hd && hd.headerData && hd.headerData.date) || (dok && dok.paragon && dok.paragon.zakSprzed) || NaN);
  if (!isNaN(dt)) { out.data = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; out.godz = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`; }
  const dodaj = (nazwa, q, cenaJ, wartosc) => {
    const ilosc = parseFloat(String(q).replace(',', '.')) || 1, waga = ilosc % 1 !== 0 ? ilosc : null;
    out.poz.push({ raw: czyscNazwe(nazwa), ilosc: waga ? 1 : ilosc, waga, cenaJ, wartosc, rabaty: [] });
  };
  if (body) {
    for (const x of body) {
      if (x.sellLine) {
        const l = x.sellLine;
        if (l.isStorno) { const i = out.poz.map(q => q.raw).lastIndexOf(czyscNazwe(l.name)); if (i >= 0) out.poz.splice(i, 1); continue; }
        dodaj(l.name, l.quantity, (l.price || 0) / 100, (l.total != null ? l.total : l.price) / 100);
      } else if (x.sumInCurrency) out.suma = (x.sumInCurrency.fiscalTotal != null ? x.sumInCurrency.fiscalTotal : x.sumInCurrency.totalWithPacks) / 100;
      else { const k = Object.keys(x).find(kk => /discount|rabat|opust|promo/i.test(kk)); if (k && out.poz.length) { const o = x[k], kw = [o.value, o.amount, o.total, o.price].find(v => typeof v === 'number'); if (kw) out.poz[out.poz.length - 1].rabaty.push({ et: String(o.name || k), kw: -Math.abs(kw) / 100 }); } }
    }
  } else if (dok && dok.paragon && Array.isArray(dok.paragon.pozycja)) {
    for (const x of dok.paragon.pozycja) if (x.towar) dodaj(x.towar.nazwa, x.towar.ilosc, (x.towar.cena || 0) / 100, (x.towar.brutto || 0) / 100);
    if (dok.paragon.podsum) out.suma = (dok.paragon.podsum.sumaBrutto || 0) / 100;
  }
  if (out.suma == null && dok && dok.paragon && dok.paragon.total) out.suma = dok.paragon.total.zaplZwrot / 100;
  if (!out.poz.length) return null;
  out.poz.forEach(x => { x.rabat = sum(x.rabaty, r => r.kw); x.netto = Math.round((x.wartosc + x.rabat) * 100) / 100; });
  out.sumaPoz = Math.round(sum(out.poz, x => x.netto) * 100) / 100;
  if (out.suma != null && Math.abs(out.sumaPoz - out.suma) > 0.05) out.ostrz.push(`Suma pozycji (${zl(out.sumaPoz)}) różni się od sumy na paragonie (${zl(out.suma)}). Mogło się nie wczytać kilka linii.`);
  if (!out.data) out.data = isoDzis();
  return out;
}
// Wklejony tekst paragonu (Lidl Plus / Biedronka / podobne): nazwa w jednej linii, pod nią „1 * 20.99 20.99 C” albo „0,244kg x 6.99 1.71 C”, a rabaty jako linie z ujemną kwotą.
function parsujParagon(tekst) {
  const t0 = String(tekst || '').trim();
  if (t0[0] === '{') { try { const w = parsujParagonJson(JSON.parse(t0)); if (w) return w; } catch (e) { /* nie JSON — czytam jak tekst */ } }
  const lin = String(tekst || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '').replace(/\t/g, '  '));
  const pelny = lin.join('\n'), out = { sklep: '', lokal: '', data: '', godz: '', suma: null, poz: [], ostrz: [] };
  out.sklep = /lidl/i.test(pelny) ? 'Lidl' : /biedronk|jeronimo/i.test(pelny) ? 'Biedronka' : /kaufland/i.test(pelny) ? 'Kaufland' : /auchan/i.test(pelny) ? 'Auchan' : /carrefour/i.test(pelny) ? 'Carrefour' : /netto/i.test(pelny) ? 'Netto' : /(żabka|zabka)/i.test(pelny) ? 'Żabka' : '';
  let m = pelny.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) out.data = `${m[1]}-${m[2]}-${m[3]}`;
  else { m = pelny.match(/(\d{2})[.-](\d{2})[.-](\d{4})/); if (m) out.data = `${m[3]}-${m[2]}-${m[1]}`; }
  m = pelny.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/); if (m) out.godz = m[0];
  m = pelny.match(/ul\.\s*[^,\n]+(?:,\s*\d{2}-\d{3}\s*[^\n]+)?/i); if (m) out.lokal = m[0].replace(/\s+/g, ' ').trim();
  const reA = /^\s*(\d+)\s*[*xX×]\s*(\d+[.,]\d{2})\s+(\d+[.,]\d{1,2})\s*([A-G])?\s*$/;
  const reB = /^\s*(\d+[.,]\d+)\s*(kg|g)?\s*[xX*×]\s*(\d+[.,]\d{2})\s+(\d+[.,]\d{1,2})\s*([A-G])?\s*$/i;
  const reC = /^(.+?)\s{2,}(\d+(?:[.,]\d+)?)\s*(kg|szt\.?)?\s*[xX*×]\s*(\d+[.,]\d{2})\s+(\d+[.,]\d{1,2})\s*([A-G])?\s*$/i;
  const reR = /^\s*(.+?)\s+(-\s?\d+[.,]\d{2})\s*$/, reSuma = /^\s*(SUMA\s+PLN|DO\s+ZAPŁATY|RAZEM)\b[^\d-]*(\d+[.,]\d{2})/i;
  let nazwa = '', ostatnia = null;
  for (const l of lin) {
    if (!l.trim()) continue;
    const ms = l.match(reSuma);
    if (ms) { out.suma = liczbaZ(ms[2]); break; }
    let a = l.match(reA), b = !a && l.match(reB), c = !a && !b && l.match(reC);
    if (a || b || c) {
      let poz;
      if (a) poz = { raw: nazwa, ilosc: +a[1], waga: null, cenaJ: liczbaZ(a[2]), wartosc: liczbaZ(a[3]) };
      else if (b) { const v = liczbaZ(b[1]); poz = /g$/i.test(b[2] || '') && !/kg/i.test(b[2] || '') ? { raw: nazwa, ilosc: 1, waga: v / 1000, cenaJ: liczbaZ(b[3]), wartosc: liczbaZ(b[4]) } : { raw: nazwa, ilosc: 1, waga: v, cenaJ: liczbaZ(b[3]), wartosc: liczbaZ(b[4]) }; }
      else { const v = liczbaZ(c[2]); poz = /kg/i.test(c[3] || '') || (v % 1 !== 0) ? { raw: c[1].trim(), ilosc: 1, waga: v, cenaJ: liczbaZ(c[4]), wartosc: liczbaZ(c[5]) } : { raw: c[1].trim(), ilosc: v, waga: null, cenaJ: liczbaZ(c[4]), wartosc: liczbaZ(c[5]) }; }
      poz.raw = (poz.raw || '').trim(); poz.rabaty = []; ostatnia = poz; nazwa = '';
      if (poz.raw) out.poz.push(poz); else out.ostrz.push('Pozycja bez nazwy (' + zl(poz.wartosc) + ')');
      continue;
    }
    const r = l.match(reR);
    if (r && ostatnia) { ostatnia.rabaty.push({ et: r[1].trim(), kw: liczbaZ(r[2].replace(/\s/g, '')) }); continue; }
    if (/^\s*(PTU|Kwota\s|Suma\s|Sprzedaż|NIP|Nr\s|nr\s|Kasa|Kasjer)/i.test(l)) continue;
    nazwa = l.trim(); ostatnia = null;
  }
  out.poz.forEach(x => { x.rabat = sum(x.rabaty, r => r.kw); x.netto = Math.round((x.wartosc + x.rabat) * 100) / 100; });
  out.sumaPoz = Math.round(sum(out.poz, x => x.netto) * 100) / 100;
  if (!out.poz.length) out.ostrz.push('Nie rozpoznałem żadnych pozycji. Ten format paragonu może wymagać dopasowania.');
  else if (out.suma != null && Math.abs(out.sumaPoz - out.suma) > 0.05) out.ostrz.push(`Suma pozycji (${zl(out.sumaPoz)}) różni się od sumy na paragonie (${zl(out.suma)}). Mogło się nie wczytać kilka linii.`);
  if (!out.data) out.data = isoDzis();
  return out;
}
const NIE_JEDZENIE = /(torba|\bmata\b|pod miski|miski|kubek|szczotk|gabka|zabawk|swieczk|baterie|bateria|cola|pepsi|fanta|sprite|napoj|energy|red bull|monster|black napoj|piwo|\bipa\b|wino|whisk|wodka|vodka|likier|jameson|\bgin\b|\brum\b|lomza|kaucj|torba|reklamow|papier toal|recznik|worki?\b|mydl|plyn|detergent|proszek|tabletk|pielucha|zmywar|czekolad|baton|chips|lody\b|ciastka|wafle|zelki|cukierk|guma do zucia|papieros|gazeta|bilet|doladowanie)/;
const ALIASY = [
  ['jaja', /^jaj(a|ka)\b|^jaja/], ['mleko 2%', /^mleko(?! kokos| owsiane)/], ['jogurt naturalny', /jogurt nat/], ['skyr naturalny', /skyr/], ['masło orzechowe', /maslo orzech/], ['masło', /^maslo/],
  ['ser topiony', /ser topion|serek topion/], ['serek wiejski', /serek wiejski|twarog wiejski/], ['twaróg półtłusty', /twarog/], ['feta', /\bfeta\b|ser salatk/], ['parmezan', /parmezan|grana padano|pecorino/],
  ['ser żółty', /ser (zolty|gouda|edam|tylz|cheddar|ementaler)|^gouda|^edam|plastry ser|ser w plastrach/], ['śmietana 12%', /^smietana(?!nk)|smietana \d+/],
  ['pierś z kurczaka', /piers.*kurcz|filet.*kurcz|kurczak.*(piers|filet)/], ['ćwiartki / porcja rosołowa z kurczaka', /cwiartk|udka|podudzi|porcja rosolowa|rosolow/], ['indyk mielony', /mielon.*indyk|indyk.*mielon/],
  ['wołowina mielona', /mielon.*wolow|wolow.*mielon/], ['wieprzowina mielona (łopatka)', /mielon.*wieprz|wieprz.*mielon|mielone? z lopatki/], ['polędwiczka wieprzowa', /poledwicz/],
  ['filet z indyka', /filet.*indyk|piers.*indyk/], ['szynka z indyka', /szynka/], ['kiełbasa biała', /kielbasa bial/], ['łosoś wędzony', /losos wedz|losos.*wedz/], ['łosoś filet', /^losos|filet.*losos/], ['dorsz filet', /dorsz/],
  ['tuńczyk w sosie własnym', /tunczyk/], ['ryż', /^ryz\b/], ['kasza gryczana', /kasza gryczan/], ['kasza jaglana', /jaglan|kasza jagl/], ['kasza manna', /\bmanna\b/], ['kasza bulgur', /bulgur/], ['kuskus', /kuskus|couscous/],
  ['makaron ryżowy', /makaron ryzow/], ['makaron pszenny', /makaron|spaghetti|penne|fusilli|rurki|wstazki/], ['płaty lasagne', /lasagne|lazanki/], ['gnocchi', /gnocchi|kopytka/],
  ['płatki owsiane', /platki owsiane/], ['granola', /granola|musli/], ['miód', /^miod\b/], ['oliwa / olej', /^oliw|^olej(?! sezam)|olej rzepak/], ['passata', /passata/], ['koncentrat pomidorowy', /koncentrat pomidor/],
  ['pomidory krojone (puszka)', /pomidory krojone|pomidory w puszce|pomidory (w )?sosie wlasnym/], ['ketchup', /ketchup/], ['musztarda', /musztard/], ['dżem', /dzem|konfitur/], ['sos sojowy', /sos sojowy/],
  ['kukurydza konserwowa', /^kukurydza|kukurydza (konserw|z puszki|w puszce|slodka)/], ['ciecierzyca z puszki (odsączona)', /ciecierzyc/], ['fasola czerwona z puszki (odsączona)', /fasol/], ['soczewica czerwona', /soczewic/], ['ogórek kiszony', /korniszon|ogorki kiszon|ogorek kiszon/],
  ['ogórek świeży', /ogork|ogorek/], ['cebula', /^cebul(?!k|a prazon)/], ['papryka', /^papryk(?!a mielon|a wedzon)/], ['pomidorki koktajlowe', /koktajl|cherry|^pomidor(?!y krojon|y w |y suszon|y pelati)/],
  ['marchew', /marchew/], ['ziemniaki', /ziemniak/], ['bataty', /batat/], ['por', /^por\b/], ['seler korzeniowy', /^seler/], ['pietruszka (korzeń)', /pietruszk/], ['brokuł', /brokul/], ['kalafior', /kalafior/], ['cukinia', /cukini/],
  ['sałata', /^salat|rukola|roszponka|mix salat/], ['szpinak świeży', /szpinak/], ['pieczarki', /pieczark/], ['awokado', /awokad/], ['banan', /banan/], ['jabłko', /jablk/], ['dynia piżmowa', /^dyni/], ['rzodkiewka (pęczek)', /rzodkiew/],
  ['tortilla pełnoziarnista', /tortill/], ['chleb żytni', /chleb|pieczywo (zytnie|razowe)/], ['bułka pełnoziarnista', /^bulk/], ['pieczywo chrupkie', /chrupk/], ['paluszki rybne', /paluszki rybne/],
  ['owoce mrożone', /maliny|truskawk|jagod|owoce mrozon|mrozone owoce|mieszanka owocow mrozon|^mango|tropikaln/], ['ananas z puszki (mała 230 g)', /ananas/],
  ['orzechy włoskie', /orzechy wloskie|orzech wloski/], ['orzeszki ziemne', /orzeszki/], ['sezam', /^sezam/], ['chia', /^chia|nasiona chia/], ['pesto bazyliowe', /pesto/], ['chrzan', /chrzan/], ['mąka pszenna', /make pszenna|^maka\b/],
  ['kakao gorzkie', /kakao/], ['skrobia ziemniaczana', /skrobia/], ['odżywka białkowa', /odzywka|\bwpc\b|protein/]
];
const nPar = raw => znorm(raw).replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();
const kluczPar = raw => nPar(raw).replace(/\b\d+[a-z%]*\b/g, ' ').replace(/\s+/g, ' ').trim();
function dopasujProdukt(raw) {
  const n = nPar(raw), k = kluczPar(raw);
  if (mapaPar[k] !== undefined) return mapaPar[k] === '' ? { pomin: true, powod: 'pomijasz tę pozycję' } : { produkt: mapaPar[k], pew: 1, zapamietane: true };
  const zh = zHistorii(raw); if (zh) return { produkt: zh, pew: 0.8 };       // podobna nazwa z wcześniejszych paragonów
  if (NIE_JEDZENIE.test(n)) return { pomin: true, powod: 'napój, alkohol lub nie jedzenie' };
  for (const [prod, re] of ALIASY) if (re.test(n)) return { produkt: prod, pew: 1 };
  // przybliżenie (tylko podpowiedź do sprawdzenia): pierwsze słowo nazwy z paragonu zaczyna się tak jak słowo nazwy znanego produktu
  const pierwsze = (n.split(' ').filter(w => w.length >= 4)[0] || ''); let naj = null, ns = 0;
  if (pierwsze) for (const prod of DB.produkty.keys()) { const tok = znorm(prod).split(/[^a-z0-9]+/).filter(w => w.length >= 4); if (tok.some(t => pierwsze.startsWith(t.slice(0, 5)) && Math.abs(pierwsze.length - t.length) <= 3)) { const sc = 1 / tok.length; if (sc > ns) { ns = sc; naj = prod; } } }
  return naj ? { produkt: naj, pew: 0.5 } : { produkt: null, pew: 0 };
}
// Ilość kupiona w jednostce bazowej produktu (g / ml / szt.), z wagi na paragonie albo z rozmiaru w nazwie („30szt”, „540g”, „2l”).
function ilosciPozycji(poz, prod) {
  const baza = (DB.produkty.get(prod) || {}).u || 'g', mm = poz.raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|szt)\b/i);
  let q = null, u = null;
  if (poz.waga) { q = poz.waga * 1000; u = 'g'; }
  else if (mm) { const v = liczbaZ(mm[1]), j = mm[2].toLowerCase(); if (j === 'szt') { q = v * poz.ilosc; u = 'szt.'; } else if (j === 'kg' || j === 'l') { q = v * 1000 * poz.ilosc; u = j === 'kg' ? 'g' : 'ml'; } else { q = v * poz.ilosc; u = j; } }
  else if (['szt.', 'krom.', 'pusz.'].includes(baza)) { q = poz.ilosc; u = baza; }
  else if (DB.opak[prod] && DB.opak[prod].jednostka === baza) { q = DB.opak[prod].wielkosc * poz.ilosc; u = baza; }
  if (q == null) return { q: null, u: baza };
  let pak = null; if (mm && !poz.waga) { const v = liczbaZ(mm[1]), j = mm[2].toLowerCase(); pak = j === 'szt' ? v : (j === 'kg' || j === 'l') ? v * 1000 : v; }
  if (/odsączona/.test(prod) && u === 'g') { q = Math.round(q * 0.55 / 10) * 10; if (pak) pak = Math.round(pak * 0.55 / 10) * 10; }   // produkty „odsączone”: waga na puszce to waga z zalewą, w przepisach liczy się po odsączeniu (ok. 55%)
  if (u === 'g' && baza === 'ml') u = 'ml';
  if (u === 'ml' && baza === 'g') u = 'g';
  if (baza === 'szt.' && u === 'g') { q = Math.max(1, Math.round(q / (G_SZT[prod] || 120))); u = 'szt.'; }
  else if ((baza === 'g' || baza === 'ml') && u === 'szt.') return { q: null, u: baza };
  else if (u !== baza && ['g', 'ml', 'szt.'].includes(baza)) u = baza;
  return { q: Math.round(q * 10) / 10, u, pak };
}
function zapiszCene(prod, sklep, netto, brutto, q, u, data) {
  if (!(q > 0) || !(netto > 0)) return;
  const kg = (u === 'g' || u === 'ml') ? 1000 : 1, e = (ceny[prod] = ceny[prod] || {}), x = (e[sklep] = e[sklep] || { u, n: 0, h: [] });
  const c = netto / q * kg, cb = brutto / q * kg;
  x.u = u; x.ost = Math.round(c * 100) / 100; x.cb = Math.round(cb * 100) / 100; x.t = data; x.n = (x.n || 0) + 1;
  x.h = (x.h || []).concat([[data, x.ost]]).slice(-6); x.sr = Math.round(sum(x.h, y => y[1]) / x.h.length * 100) / 100;
}
let cenyTryb = LS.get('cenyTryb', 'polkowe');                // porównania: ceny półkowe (bez rabatów) albo po rabatach z paragonu
const cenaX = x => cenyTryb === 'rabaty' ? x.ost : (x.cb || x.ost);
const cenaJedn = (prod, sklep) => { const e = ceny[prod] && ceny[prod][sklep]; return e && (Date.now() - new Date(e.t)) / 864e5 <= 180 ? e : null; };
const jednCeny = u => u === 'g' ? 'kg' : u === 'ml' ? 'l' : 'szt.';
// koszt zakupu q (g/ml/szt.) w danym sklepie albo w najtańszym znanym
function kosztProduktu(prod, q, u, sklep) {
  const e = ceny[prod]; if (!e) return null;
  let naj = null;
  for (const [sk, x] of Object.entries(e)) {
    if (sklep && sk !== sklep) continue; if (!cenaJedn(prod, sk)) continue;
    let qq = q;
    if (x.u === 'g' && u === 'szt.') qq = q * (G_SZT[prod] || 120);          // cena za kg, ilość w sztukach
    else if (x.u === 'szt.' && u === 'g') qq = q / (G_SZT[prod] || 120);     // cena za sztukę, ilość w gramach
    const kw = cenaX(x) * ((x.u === 'g' || x.u === 'ml') ? qq / 1000 : qq);
    if (!naj || kw < naj.zl) naj = { zl: kw, sklep: sk };
  }
  return naj;
}
const sklepyZnane = () => [...new Set(Object.values(ceny).flatMap(e => Object.keys(e)))].sort();

// ---------- szybkie akcje: najważniejsze funkcje zawsze pod ręką (nie tylko w „Więcej”) ----------
const AKCJE = {
  skan: ['Skanuj kod', 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8'],
  paragon: ['Dodaj paragon', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'],
  prep: ['Meal prep', 'M5 11h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM4 8h16M9 5h6'],
  spont: ['Co ugotować', 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z'],
  waga: ['Zważ się', 'M3 6h18v12H3zM8.5 11a4 4 0 0 1 7 0M12 14l2-2.5'],
  wykl: ['Czego nie jecie', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12'],
  dodaj: ['Dodaj ręcznie', 'M12 5v14M5 12h14'],
  opisz: ['Opisz tydzień', 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'],
  czas: ['Nie mam czasu', 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  swipe: ['Co lubicie?', 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
  poza: ['Zjadłem coś innego', 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 2-3 4-3 7h3v11'],
  podsum: ['Podsumowanie tygodnia', 'M5 20V10M12 20V4M19 20v-7'],
  zakupy: ['Zakupy', 'M5 8.5h14l-1.2 11.5H6.2zM9 8.5a3 3 0 0 1 6 0']
};
const paskAkcji = lista => `<div class="szybkie" role="group" aria-label="Szybkie akcje">${lista.map(k => `<button class="szybka" data-szybka="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${AKCJE[k][1]}"/></svg><span>${AKCJE[k][0]}</span></button>`).join('')}</div>`;
function szybkaAkcja(k) {
  if (k === 'opisz') { oknoOpisz(); return; }
  if (k === 'poza') { oknoPoza(); return; }
  if (k === 'czas') { const dz = isoDzis(), t = tygodnieZapisane().find(x => dz >= x.start && dz <= dodajDni(x.start, 6)); if (!t) { pokazToast('Na dziś nie ma planu'); return; } oknoDopasuj([{ start: t.start, d: Math.round((new Date(dz + 'T12:00:00') - new Date(t.start + 'T12:00:00')) / 864e5), iso: dz, tryby: { szybko: true } }]); return; }
  if (k === 'skan') oknoSkaner(); else if (k === 'paragon') oknoParagonWklej(); else if (k === 'spont') oknoSpont(); else if (k === 'dodaj') oknoDodaj('jeden');
  else { zakladka = { prep: 'prep', waga: 'waga', wykl: 'wykluczone', zakupy: 'zakupy', podsum: 'podsum', swipe: 'swipe' }[k]; rysuj(); window.scrollTo(0, 0); }
}
// ---------- skaner kodów kreskowych (aparat + Open Food Facts) ----------
let skan = null, skanWynik = null;
const kodWazny = k => /^\d{8}$|^\d{12,14}$/.test(k);
function zaladujZxing() {
  return window.ZXing ? Promise.resolve() : new Promise((ok, err) => { const sc = document.createElement('script'); sc.src = 'lib/zxing/index.min.js'; sc.onload = ok; sc.onerror = () => err(new Error('zxing')); document.head.appendChild(sc); });
}
function zatrzymajSkan(wszystko) {
  if (!skan) return;
  clearInterval(skan.loop); skan.loop = null;
  if (skan.reader) { try { skan.reader.reset(); } catch (e) { /* nic */ } skan.reader = null; }
  if (wszystko) { try { skan.stream && skan.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* nic */ } skan = null; }
}
function oknoSkaner(komunikat) {
  zatrzymajSkan();
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Skanuj produkt</h2><button class="btn maly" data-skan-zamknij>Gotowe</button></div>
    <div class="skan-ramka"><video id="skan-video" playsinline muted autoplay></video><div class="skan-celownik"></div></div>
    <p class="mute" id="skan-info">${esc(komunikat || 'Naprowadź kod kreskowy na ramkę. Rozpoznam go sam.')}</p>
    <label class="pole"><span>Albo wpisz numer kodu</span></label><div class="lod-rzad" style="margin-top:-6px"><input id="skan-reczny" type="text" inputmode="numeric" placeholder="np. 5900497011211" autocomplete="off"><button class="btn glowny maly" data-skan-szukaj>Szukaj</button></div>`;
  $('#modal').hidden = false; startSkan();
}
async function startSkan() {
  const info = $('#skan-info'), v = $('#skan-video');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { info.textContent = 'Ta przeglądarka nie udostępnia kamery. Wpisz kod ręcznie poniżej.'; return; }
  try {
    skan = skan || { stream: null, ostatni: '', t: 0 };
    if ('BarcodeDetector' in window) {
      if (!skan.stream || !skan.stream.active) skan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      v.srcObject = skan.stream; await v.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      skan.loop = setInterval(async () => { try { const r = await det.detect(v); if (r && r[0]) znalezionyKod(r[0].rawValue); } catch (e) { /* klatka bez kodu */ } }, 280);
    } else {
      info.textContent = 'Ładuję moduł rozpoznawania kodów…'; await zaladujZxing();
      const hints = new Map(); hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
      const reader = new ZXing.BrowserMultiFormatReader(hints); skan.reader = reader;
      reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, 'skan-video', (res) => { if (res) znalezionyKod(res.getText()); });
      info.textContent = 'Naprowadź kod kreskowy na ramkę. Rozpoznam go sam.';
    }
  } catch (e) {
    info.textContent = e && e.name === 'NotAllowedError' ? 'Brak zgody na kamerę. Zezwól w ustawieniach przeglądarki albo wpisz kod ręcznie.' : 'Nie udało się uruchomić kamery. Wpisz kod ręcznie poniżej.';
  }
}
function znalezionyKod(kod) {
  if (!kodWazny(kod) || !skan || (kod === skan.ostatni && Date.now() - skan.t < 3000)) return;
  skan.ostatni = kod; skan.t = Date.now();
  try { navigator.vibrate && navigator.vibrate(60); } catch (e) { /* nic */ }
  wynikSkanu(kod);
}
// Rozmiar opakowania z tekstu Open Food Facts („500 g”, „1,5 l”, „6 x 100 g”) w jednostce bazowej (g / ml / szt.).
function rozmiarZTekstu(t) {
  const m = String(t || '').toLowerCase().replace(',', '.').match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|szt)\b/);
  if (!m) return null;
  const n = m[1] ? +m[1] : 1, v = parseFloat(m[2]), j = m[3];
  return j === 'kg' ? { r: v * 1000 * n, u: 'g' } : j === 'g' ? { r: v * n, u: 'g' } : j === 'l' ? { r: v * 1000 * n, u: 'ml' } : j === 'cl' ? { r: v * 10 * n, u: 'ml' } : j === 'ml' ? { r: v * n, u: 'ml' } : { r: v * n, u: 'szt.' };
}
async function szukajOFF(kod) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${kod}.json?fields=product_name,product_name_pl,generic_name_pl,brands,quantity,product_quantity,product_quantity_unit`, { signal: ctl.signal });
    const j = await r.json();
    if (j.status !== 1 || !j.product) return { brak: true };
    const x = j.product, nazwa = (x.product_name_pl || x.product_name || x.generic_name_pl || '').trim();
    let roz = x.product_quantity ? { r: +x.product_quantity, u: /ml|l/i.test(x.product_quantity_unit || '') ? 'ml' : 'g' } : rozmiarZTekstu(x.quantity);
    return { nazwa, marka: (x.brands || '').split(',')[0].trim(), ilosc: String(x.quantity || '').replace(/\s*[℮e]\s*$/i, '').trim(), roz };
  } catch (e) { return { blad: true }; } finally { clearTimeout(tm); }
}
async function wynikSkanu(kod) {
  clearInterval(skan && skan.loop); if (skan && skan.reader) { try { skan.reader.reset(); } catch (e) { /* nic */ } skan.reader = null; }
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Szukam produktu…</h2><button class="btn maly" data-skan-zamknij>Gotowe</button></div><p class="pusty" style="padding:40px 0">Kod ${esc(kod)}</p>`;
  const rek = kody[kod], off = rek ? null : await szukajOFF(kod);
  if (!$('#modal') || $('#modal').hidden) return;
  let nazwa = '', produkt = '', r = null, u = 'g', kat = 'zapas', stan = '', info = '';
  if (rek) { produkt = rek.p; r = rek.r; u = rek.u; info = 'Znam ten kod — zapamiętany wcześniej.'; stan = 'znany'; }
  else if (off && off.nazwa) {
    nazwa = off.nazwa + (off.marka ? ' (' + off.marka + ')' : ''); stan = 'off';
    const d = dopasujProdukt(off.nazwa), sug = sugerujNowy({ raw: off.nazwa, waga: null, ilosc: 1 });
    if (d && d.produkt && !d.pomin) { produkt = d.produkt; u = (DB.produkty.get(produkt) || {}).u || 'g'; }
    else { produkt = sug.nazwa; kat = sug.kat; u = off.roz ? off.roz.u : sug.u; }
    if (off.roz && (!DB.produkty.has(produkt) || off.roz.u === u || (u === 'g' && off.roz.u === 'ml') || (u === 'ml' && off.roz.u === 'g'))) { r = Math.round(off.roz.r * 10) / 10; if (DB.produkty.has(produkt)) u = off.roz.u === 'szt.' && u !== 'szt.' ? u : off.roz.u; else u = off.roz.u; }
    info = 'Znaleziono w Open Food Facts. Sprawdź nazwę i rozmiar.';
  } else { stan = off && off.blad ? 'blad' : 'brak'; info = stan === 'blad' ? 'Brak połączenia z bazą produktów. Wpisz nazwę i rozmiar ręcznie — zapamiętam kod.' : 'Nie ma tego kodu w bazie Open Food Facts. Wpisz nazwę i rozmiar — zapamiętam kod na przyszłość.'; }
  skanWynik = { kod, stan, kat, ile: 1 };
  const nowy = produkt && !DB.produkty.has(produkt);
  let naLiscie = null;
  try { const z = zakupyDni(wybraneDni()); naLiscie = ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]).find(x => x.produkt === produkt && !odhK(kluczKup(x.produkt))); window._z = z; } catch (e) { /* nic */ }
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>${stan === 'znany' || stan === 'off' ? 'Znaleziono produkt' : 'Nowy kod'}</h2><button class="btn maly" data-skan-zamknij>Gotowe</button></div>
    ${nazwa ? `<p class="sk-nazwa">${esc(nazwa)}${off && off.ilosc ? `<small>${esc(off.ilosc)}</small>` : ''}</p>` : ''}<p class="mute" style="margin:4px 0 10px">Kod ${esc(kod)} · ${esc(info)}</p>
    <label class="pole"><span>Produkt w apce</span><input id="sk-prod" list="produkty" type="text" autocomplete="off" value="${esc(produkt)}" placeholder="np. mleko 2%"></label>
    <datalist id="produkty">${[...DB.produkty.keys()].sort((a, b) => a.localeCompare(b, 'pl')).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div id="sk-nowy" ${nowy || !produkt ? '' : 'hidden'}><p class="mute" style="margin:0 0 6px">To nowy produkt — gdzie go trzymasz?</p><div class="seg mini" id="sk-kat">${[['świeże', 'Świeże'], ['zamrażarka', 'Mrożone'], ['zapas', 'Zapasy']].map(([k, et]) => `<button data-sk-kat="${k}" class="${kat === k ? 'akt' : ''}">${et}</button>`).join('')}</div></div>
    <div class="dwa" style="margin-top:10px"><label class="pole"><span>Rozmiar opakowania</span><input id="sk-rozm" type="text" inputmode="decimal" value="${r == null ? '' : String(r).replace('.', ',')}" placeholder="np. 160"></label>
    <label class="pole"><span>Jednostka</span><select id="sk-u">${['g', 'ml', 'szt.'].map(x => `<option ${u === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <h3>Ile opakowań?</h3><div class="wpisz"><button class="strz" data-sk-ile="-1" aria-label="Mniej">−</button><label class="wpisz-pole"><input type="text" inputmode="numeric" id="sk-ile" value="1" aria-label="Liczba opakowań"><span>szt.</span></label><button class="strz" data-sk-ile="1" aria-label="Więcej">+</button></div>
    <p class="mute" id="sk-info" style="text-align:center;margin:0 0 10px"></p>
    <button class="btn glowny szeroki" data-sk-dodaj="1">Dodaj do lodówki</button>
    ${naLiscie ? `<button class="btn szeroki" data-sk-odhacz="${esc(produkt)}" style="margin-top:8px">To jest na liście zakupów — odhacz zamiast dopisywać</button>` : ''}
    <button class="btn szeroki" data-sk-dalej style="margin-top:8px">Skanuj kolejny</button>`;
  $('#modal').hidden = false; odswiezSkan();
}
function odswiezSkan() {
  const p = (($('#sk-prod') || {}).value || '').trim(), znany = [...DB.produkty.keys()].some(k => znorm(k) === znorm(p)), nw = $('#sk-nowy');
  if (nw) nw.hidden = !p || znany;
  const r = parseFloat(String(($('#sk-rozm') || {}).value).replace(',', '.')), n = parseInt(($('#sk-ile') || {}).value, 10) || 1, u = ($('#sk-u') || {}).value || 'g';
  if ($('#sk-info')) $('#sk-info').innerHTML = r > 0 ? `${n} × ${fmtPak(r)} ${esc(u)} = <b>${fmtPak(n * r)} ${esc(u)}</b>` : 'Wpisz rozmiar opakowania, a policzę gramy.';
}
function skanDodaj() {
  const w = skanWynik, nazwa = (($('#sk-prod') || {}).value || '').trim(), r = parseFloat(String(($('#sk-rozm') || {}).value).replace(',', '.')), n = parseInt(($('#sk-ile') || {}).value, 10) || 1, u = ($('#sk-u') || {}).value || 'g';
  if (nazwa.length < 2) { pokazToast('Wpisz nazwę produktu'); return false; }
  if (!(r > 0)) { pokazToast('Wpisz rozmiar opakowania, np. 160'); return false; }
  const znany = [...DB.produkty.keys()].find(k => znorm(k) === znorm(nazwa)), kat = (document.querySelector('#sk-kat .akt') || {}).dataset ? document.querySelector('#sk-kat .akt').dataset.skKat : w.kat;
  const prod = znany || dodajWlasnyProdukt(nazwa, kat, u);
  kody[w.kod] = { p: prod, r, u }; LS.set('kody', kody);
  uczPak(prod, r, u); LS.set('pakiety', pakiety); Z([[['kody', w.kod], kody[w.kod]], [['pakiety'], pakiety]]);
  zmienLodowke(prod, u, n * r);
  pokazToast(`Dodano: ${prod} ${n} × ${fmtPak(r)} ${u} = ${fmtStan(n * r, u)}`);
  return prod;
}

// Własne produkty (z paragonów): wspólne dla pary, widoczne w lodówce, podpowiedziach i dopasowaniu paragonów.
function zastosujWlasne() { for (const [n, x] of Object.entries(wlasneProd)) if (x && !DB.produkty.has(n)) DB.produkty.set(n, { kat: x.kat || 'zapas', u: x.u || 'g' }); }
function dodajWlasnyProdukt(nazwa, kat, u) {
  nazwa = String(nazwa || '').trim().toLowerCase().replace(/\s+/g, ' '); if (!nazwa) return null;
  const istn = [...DB.produkty.keys()].find(k => znorm(k) === znorm(nazwa)); if (istn) return istn;
  wlasneProd[nazwa] = { kat: kat || 'zapas', u: u || 'g' }; DB.produkty.set(nazwa, { kat: kat || 'zapas', u: u || 'g' });
  LS.set('wlasneProd', wlasneProd); Z([[['wlasneProd', nazwa], wlasneProd[nazwa]]]);
  return nazwa;
}
// Słownik polskich słów z bazy dań (do rozwijania skrótów z paragonów: „Kukur” → „kukurydza”) — tylko gdy jest jedna wyraźna możliwość.
let _slownik = null;
function slownik() {
  if (_slownik) return _slownik; const m = new Map();
  for (const d of DB.dania.values()) [d.nazwa, ...d.skladniki.map(i => i.produkt || '')].forEach(tx => tx.toLowerCase().split(/[^a-ząćęłńóśźż]+/).filter(w => w.length >= 5).forEach(w => m.set(w, (m.get(w) || 0) + 1)));
  return (_slownik = m);
}
function rozwinSkrot(slowo) {
  const z = znorm(slowo); if (z.length < 6) return slowo;      // krótkie skróty („Kuk”, „Jagl”) zostawiam: zgadywanie zepsułoby nazwę
  const m = slownik(); for (const w of m.keys()) if (znorm(w) === z) return slowo;
  const kand = [...m.entries()].filter(([w]) => znorm(w).startsWith(z) && w.length - z.length >= 2).sort((a, b) => b[1] - a[1]);
  return kand.length === 1 || (kand.length > 1 && kand[0][1] >= 2 * kand[1][1]) ? kand[0][0] : slowo;
}
function zgadnijKat(nazwa) { if (/chrup|paluszk|paleczk|pałeczk|chips|krakers|ciastk|baton|snack|przekask|wafel|zelki|cukierk/.test(znorm(nazwa)) && !/rybne/.test(znorm(nazwa))) return 'zapas'; const d = dzialSklepu({ produkt: nazwa, kat: '' }); return d === 'mrozonki' ? 'zamrażarka' : d === 'spizarnia' ? 'zapas' : 'świeże'; }
function zgadnijJedn(poz) {
  if (poz.waga) return 'g';
  const mm = poz.raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|szt)\b/i);
  if (mm) { const j = mm[2].toLowerCase(); return j === 'ml' || j === 'l' ? 'ml' : j === 'szt' ? 'szt.' : 'g'; }
  return /napoj|sok\b|mleko|olej|ocet|woda|syrop|sos\b/.test(nPar(poz.raw)) ? 'ml' : 'szt.';
}
// Podpowiedź nowego produktu z pozycji paragonu: czytelna nazwa (bez rozmiaru, ze rozwiniętymi skrótami), kategoria i jednostka.
function sugerujNowy(poz) {
  const n = poz.raw.replace(/\d+(?:[.,]\d+)?\s*(kg|g|ml|l|szt|tb)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const nazwa = n.split(' ').map(w => /^[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+$/.test(w) ? rozwinSkrot(w.toLowerCase()) : w.toLowerCase()).join(' ');
  return { nazwa, kat: zgadnijKat(nazwa), u: zgadnijJedn(poz) };
}
// Czy ta pozycja wygląda jak coś, co już dopasowywałeś na wcześniejszych paragonach (inny zapis nazwy w tym samym sklepie)?
function zHistorii(raw) {
  const tok = nPar(raw).replace(/\b\d+[a-z%]*\b/g, ' ').split(' ').filter(w => w.length >= 3); if (tok.length < 2) return null;
  const zg = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));
  let naj = null, ns = 0;
  for (const par of paragony) for (const q of par.poz) {
    if (!q.p) continue; const t2 = nPar(q.n).replace(/\b\d+[a-z%]*\b/g, ' ').split(' ').filter(w => w.length >= 3); if (t2.length < 2) continue;
    const wsp = tok.filter(a => t2.some(b => zg(a, b))).length, sim = wsp / (tok.length + t2.length - wsp);
    if (sim > ns) { ns = sim; naj = q.p; }
  }
  return ns >= 0.6 ? naj : null;
}
let nowyP = null;
function oknoNowyProdukt(i, nazwaStart) {
  const x = parag.w.poz[i], sug = sugerujNowy(x);
  nowyP = { i, nazwa: (nazwaStart || sug.nazwa), kat: sug.kat, u: sug.u };
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Nowy produkt</h2><button class="btn maly" data-par-wroc>Wróć</button></div>
    <p class="mute">Z paragonu: <b>${esc(x.raw)}</b> · ${esc(opisPozycji(x))}. Zapamiętam ten produkt, jego ceny i opakowanie, a przy następnych paragonach rozpoznam go sam.</p>
    <label class="pole"><span>Nazwa produktu</span><input id="np-nazwa" type="text" value="${esc(nowyP.nazwa)}" autocomplete="off"></label>
    <h3>Gdzie go trzymasz?</h3><div class="seg" id="np-kat">${[['świeże', 'Świeże'], ['zamrażarka', 'Mrożone'], ['zapas', 'Zapasy']].map(([k, et]) => `<button data-np-kat="${k}" class="${nowyP.kat === k ? 'akt' : ''}">${et}</button>`).join('')}</div>
    <label class="pole"><span>Jak liczyć ilość</span><select id="np-u">${[['g', 'w gramach'], ['ml', 'w mililitrach'], ['szt.', 'w sztukach']].map(([u, et]) => `<option value="${u}" ${nowyP.u === u ? 'selected' : ''}>${et}</option>`).join('')}</select></label>
    <button class="btn glowny szeroki" data-np-dodaj style="margin-top:12px">Dodaj produkt i użyj</button>`;
  $('#modal').hidden = false;
}

const _skrypty = {};
const zaladujSkrypt = url => _skrypty[url] || (_skrypty[url] = new Promise((ok, err) => { const sc = document.createElement('script'); sc.src = url; sc.onload = ok; sc.onerror = () => { delete _skrypty[url]; err(new Error('Nie udało się pobrać modułu rozpoznawania (sprawdź internet).')); }; document.head.appendChild(sc); }));
// OCR działa z plików w lib/ (bez zewnętrznych serwerów). Ścieżki muszą być bezwzględne: worker ładuje je z kontekstu blob.
const bezwzgl = p => new URL(p, location.href).href;
const TESS_URL = 'lib/tesseract/tesseract.min.js', TESS_LANG = bezwzgl('lib/tessdata'), TESS_WORKER = bezwzgl('lib/tesseract/worker.min.js'), TESS_CORE = bezwzgl('lib/tesseract/');
async function inflateBajty(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); }
function unfilterPng(dane, kol, kan) {
  const rowLen = kol * kan, rows = Math.floor(dane.length / (rowLen + 1)), out = new Uint8Array(rows * rowLen);
  for (let y = 0; y < rows; y++) {
    const f = dane[y * (rowLen + 1)], src = y * (rowLen + 1) + 1, dst = y * rowLen;
    for (let x = 0; x < rowLen; x++) {
      const a = x >= kan ? out[dst + x - kan] : 0, b = y ? out[dst - rowLen + x] : 0, c = (x >= kan && y) ? out[dst - rowLen + x - kan] : 0; let v = dane[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[dst + x] = v & 255;
    }
  }
  return out;
}
// E-paragon z aplikacji sklepu to zwykle PDF zawierający tylko obraz (bez warstwy tekstu): wyciągam obraz z PDF bez dodatkowych bibliotek (Flate / JPEG, z maską przezroczystości).
async function pdfObrazy(buf) {
  const u8 = new Uint8Array(buf), txt = new TextDecoder('latin1').decode(u8), obj = {}, re = /(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g; let m;
  while ((m = re.exec(txt))) { const start = m.index + m[0].length, koniec = txt.indexOf('endstream', start); obj[m[1]] = { d: m[2], raw: u8.subarray(start, koniec > 0 ? koniec : u8.length) }; }
  const liczba = (d, k) => { const x = d.match(new RegExp('/' + k + '\\s+(\\d+)')); return x ? +x[1] : null; };
  const rozpakuj = async o => {
    const d = o.d, f = (d.match(/\/Filter\s*\[?\s*\/(\w+)/) || [])[1], w = liczba(d, 'Width'), h = liczba(d, 'Height'); let raw = o.raw;
    if (raw[raw.length - 1] === 10) raw = raw.subarray(0, raw.length - (raw[raw.length - 2] === 13 ? 2 : 1));
    if (f === 'DCTDecode') return { jpeg: raw, w, h };
    if (f === 'FlateDecode' || !f) {
      const kan = /DeviceRGB/.test(d) ? 3 : /DeviceGray/.test(d) ? 1 : null; if (!kan) return null;
      let b = f ? await inflateBajty(raw) : raw; const pred = liczba(d, 'Predictor'); if (pred >= 10) b = unfilterPng(b, liczba(d, 'Columns') || w, kan);
      return { px: b, w, h, kan };
    }
    return null;
  };
  const wyniki = [], maski = new Set(Object.values(obj).map(o => (o.d.match(/\/SMask\s+(\d+)\s+0\s+R/) || [])[1]).filter(Boolean));
  for (const [id, o] of Object.entries(obj)) {
    if (maski.has(id) || !/\/Subtype\s*\/Image/.test(o.d) || /\/ImageMask\s+true/.test(o.d)) continue;
    const img = await rozpakuj(o); if (!img) continue;
    if (img.jpeg) { const bm = await createImageBitmap(new Blob([img.jpeg], { type: 'image/jpeg' })), cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bm, 0, 0); wyniki.push(cv); continue; }
    let alfa = null; const sm = (o.d.match(/\/SMask\s+(\d+)\s+0\s+R/) || [])[1];
    if (sm && obj[sm]) { const a = await rozpakuj(obj[sm]); if (a && a.kan === 1) alfa = a.px; }
    const cv = document.createElement('canvas'); cv.width = img.w; cv.height = img.h; const cx = cv.getContext('2d'), dd = cx.createImageData(img.w, img.h), n = img.w * img.h;
    for (let i = 0; i < n; i++) { const a = alfa ? alfa[i] / 255 : 1; for (let c = 0; c < 3; c++) dd.data[i * 4 + c] = Math.round((img.kan === 3 ? img.px[i * 3 + c] : img.px[i]) * a + 255 * (1 - a)); dd.data[i * 4 + 3] = 255; }
    cx.putImageData(dd, 0, 0); wyniki.push(cv);
  }
  return wyniki;
}
let ocrWorker = null;
// Obraz → skala szarości, powiększenie ×2 (drobny druk paragonu) → rozpoznanie tekstu (Tesseract, język polski).
async function ocrObraz(cv, postep) {
  const wi = cv.width * 2, he = cv.height * 2, c2 = document.createElement('canvas'); c2.width = wi; c2.height = he;
  const cx = c2.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.filter = 'grayscale(1) contrast(1.4)'; cx.drawImage(cv, 0, 0, wi, he);
  await zaladujSkrypt(TESS_URL);
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker('pol', 1, { workerPath: TESS_WORKER, corePath: TESS_CORE, langPath: TESS_LANG, workerBlobURL: false, logger: m => postep && postep(m) });
  await ocrWorker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  return (await ocrWorker.recognize(c2)).data.text;
}
function oknoPostepu(tekst, proc) {
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Czytam paragon</h2><button class="btn maly" data-zamknij>Anuluj</button></div><p class="pusty" style="padding:26px 0 8px" id="postep-tx">${esc(tekst)}</p><div class="pasek" style="color:var(--zielony);margin:0 0 24px"><i id="postep-pas" style="width:${proc || 8}%"></i></div><p class="mute" style="text-align:center">Za pierwszym razem pobieram moduł rozpoznawania tekstu (kilka MB). Potem działa szybciej.</p>`;
  $('#modal').hidden = false;
}
async function wczytajPlik(f) {
  const typ = (f.type || '').toLowerCase(), nazwa = (f.name || '').toLowerCase();
  try {
    if (/json|text\/plain/.test(typ) || /\.(json|txt)$/.test(nazwa)) { wczytajParagon(await f.text()); return; }
    oknoPostepu('Otwieram plik…', 5);
    let obrazy;
    if (/pdf/.test(typ) || /\.pdf$/.test(nazwa)) { obrazy = await pdfObrazy(await f.arrayBuffer()); if (!obrazy.length) throw new Error('W tym PDF-ie nie znalazłem obrazu paragonu.'); }
    else if (/^image\//.test(typ)) { const bm = await createImageBitmap(f), cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); obrazy = [cv]; }
    else throw new Error('Ten typ pliku nie jest obsługiwany. Wybierz PDF, zdjęcie, JSON albo plik tekstowy.');
    let tekst = '';
    for (let i = 0; i < obrazy.length; i++) {
      tekst += (i ? '\n' : '') + await ocrObraz(obrazy[i], m => { const t = $('#postep-tx'), pa = $('#postep-pas'); if (t) t.textContent = (m.status === 'recognizing text' ? 'Rozpoznaję tekst… ' : 'Pobieram moduł… ') + Math.round((m.progress || 0) * 100) + '%'; if (pa) pa.style.width = Math.max(8, Math.round((m.progress || 0) * 100)) + '%'; });
    }
    wczytajParagon(tekst, true);
  } catch (e) { oknoParagonWklej(); pokazToast(e && e.message ? e.message : 'Nie udało się odczytać pliku'); }
}
async function schowekParagon() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const it = await navigator.clipboard.read();
      for (const x of it) { const im = x.types.find(t => /^image\//.test(t)); if (im) { wczytajPlik(new File([await x.getType(im)], 'schowek', { type: im })); return; } }
      for (const x of it) if (x.types.includes('text/plain')) { const tx = await (await x.getType('text/plain')).text(); if (tx && tx.length > 20) { const a = $('#par-tekst'); if (a) a.value = tx; wczytajParagon(tx); return; } }
    } else if (navigator.clipboard && navigator.clipboard.readText) { const tx = await navigator.clipboard.readText(); if (tx && tx.length > 20) { const a = $('#par-tekst'); if (a) a.value = tx; wczytajParagon(tx); return; } }
    pokazToast('Schowek jest pusty albo nie zawiera paragonu');
  } catch (e) { pokazToast('Nie mogę odczytać schowka. Użyj „Wybierz plik” albo wklej tekst w pole.'); }
}
// Paragon udostępniony z aplikacji sklepu (Android, zainstalowana aplikacja): service worker zapisuje go w pamięci, a ja go tu odczytuję.
async function przyjmijUdostepnione() {
  try {
    const c = await caches.open('udostepnione'), m = await c.match('./udostepnione/meta'); if (!m) return null;
    const meta = await m.json(), pliki = [];
    for (const p of meta.pliki) { const r = await c.match(p.klucz); if (r) pliki.push(new File([await r.blob()], p.nazwa || 'paragon', { type: p.typ })); }
    for (const k of await c.keys()) await c.delete(k);
    return { tekst: meta.tekst || '', pliki };
  } catch (e) { return null; }
}
async function wczytajUdostepnione() {
  history.replaceState(null, '', location.pathname);
  const d = await przyjmijUdostepnione();
  if (!d) { pokazToast('Nie udało się odebrać udostępnionego paragonu'); return; }
  zakladka = 'paragony'; rysuj();
  if (d.pliki.length) wczytajPlik(d.pliki[0]);
  else if (d.tekst && d.tekst.length > 20) wczytajParagon(d.tekst);
  else pokazToast('Udostępniono coś, co nie wygląda jak paragon');
}

let parag = null;
const SKLEPY_DOM = ['Lidl', 'Biedronka', 'Kaufland', 'Auchan', 'Carrefour', 'Netto', 'Żabka', 'Inny sklep'];
function oknoParagonWklej() {
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Dodaj paragon</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">Wczytaj paragon: wybierz PDF lub zdjęcie (Lidl, Biedronka i inne), wklej obraz albo tekst ze schowka. Biedronkowy JSON też działa. Zapamiętam ceny produktów i sklep, żeby podpowiadać, gdzie taniej zrobić zakupy.</p>
    <button class="btn glowny szeroki" id="parSchowek">Wklej ze schowka (obraz lub tekst)</button>
    <label class="btn szeroki plik-btn" style="margin-top:8px">Wybierz plik (PDF, zdjęcie, JSON)<input type="file" id="par-plik" accept=".pdf,.json,.txt,application/pdf,application/json,text/plain,image/*" hidden></label>
    <p class="mute" style="margin:8px 0 0"><b>Z Lidla:</b> e-paragon to PDF z obrazem — w aplikacji Lidl wybierz „Udostępnij” i zapisz w Plikach (albo udostępnij do tej aplikacji na Androidzie), a tu wybierz plik. Odczytam go automatycznie.</p>
    <label class="pole"><span>…albo ręcznie</span><textarea id="par-tekst" rows="8" placeholder="Albo wklej tu tekst lub JSON paragonu"></textarea></label>
    <button class="btn szeroki" id="parWczytaj">Wczytaj paragon</button>`;
  $('#modal').hidden = false;
}
function wczytajParagon(tekst, ocr) {
  const w = parsujParagon(tekst);
  if (!w.poz.length) { if (ocr) { oknoParagonWklej(); const a = $('#par-tekst'); if (a) a.value = tekst; pokazToast('Nie udało się odczytać pozycji. Popraw tekst poniżej albo spróbuj lepszego zdjęcia.'); } else pokazToast(w.ostrz[0] || 'Nie rozpoznałem paragonu'); return; }
  if (ocr) w.poz.forEach(x => { x.raw = czyscNazwe(x.raw.replace(/\s*[\[\(|{][A-Za-z]?\s*$/, '')); });
  if (ocr) w.ostrz.unshift('Paragon odczytany automatycznie z obrazu. Sprawdź nazwy i ceny (ceny możesz poprawić dotknięciem).');
  const sumaP = w.suma != null ? w.suma : w.sumaPoz;
  const dubel = paragony.some(x => x.data === w.data && Math.abs(x.suma - sumaP) < 0.01 && (!w.sklep || x.sklep === w.sklep));
  const wiersze = w.poz.map((x, i) => { const d = dopasujProdukt(x.raw), prod = d.produkt || '', il = prod ? ilosciPozycji(x, prod) : { q: null, u: 'g' }; return { i, produkt: prod, pomin: !!d.pomin, powod: d.powod || '', pew: d.pew || 0, q: il.q, u: il.u, wlacz: !d.pomin && !!prod && (d.pew || 0) >= 1 && il.q > 0, zmieniony: false, pak: il.pak || null }; });
  const juzOdh = Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).filter(k => k.startsWith('zak|')).map(k => k.slice(4));
  parag = { w, wiersze, sklep: w.sklep, data: w.data, lod: !juzOdh.length, juzOdh, dubel };
  oknoParagon();
}
const opisPozycji = x => (x.waga ? `${String(Math.round(x.waga * 1000) / 1000).replace('.', ',')} kg × ${zl(x.cenaJ)}/kg` : `${x.ilosc} × ${zl(x.cenaJ)}`) + (x.rabat ? ` · rabat −${zl(-x.rabat).replace('-', '')}` : '');
function oknoParagon() {
  const { w, wiersze } = parag;
  const wiersz = r => { const x = w.poz[r.i];
    return `<div class="par-w ${r.wlacz ? '' : 'wyl'}"><label class="par-wl"><input type="checkbox" data-par-wl="${r.i}" ${r.wlacz ? 'checked' : ''}><span class="zk-ptak"></span></label>
      <div class="par-tx"><b>${esc(x.raw)}</b><small>${esc(opisPozycji(x))}</small>
      <button class="par-prod ${r.produkt ? '' : 'brak'}" data-par-prod="${r.i}">${r.produkt ? '→ ' + esc(r.produkt) + (r.pew < 1 ? ' (sprawdź)' : '') : 'Wybierz produkt'}</button>${r.produkt ? '' : ` <button class="par-prod nowy" data-par-nowy-formularz="${r.i}">＋ Nowy produkt</button>`}
      ${r.produkt ? `${r.pak && r.q > 0 ? `<small class="par-pak">${fmtPak(r.q / r.pak)} × opakowanie ${r.pak} ${r.u} (zapamiętam rozmiar)</small>` : ''}<div class="par-q"><input type="text" inputmode="decimal" data-par-q="${r.i}" value="${r.q == null ? '' : String(r.q).replace('.', ',')}" placeholder="ile?" aria-label="Ilość"><select data-par-u="${r.i}">${['g', 'ml', 'szt.', 'krom.', 'pusz.'].map(u => `<option ${r.u === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>` : ''}</div>
      <input class="par-cena" type="text" inputmode="decimal" data-par-cena="${r.i}" value="${String(x.netto.toFixed(2)).replace('.', ',')}" aria-label="Cena po rabatach"></div>`; };
  const doSpr = wiersze.filter(r => !r.pomin && (!r.produkt || r.pew < 1 || !(r.q > 0))), rozp = wiersze.filter(r => !r.pomin && r.produkt && r.pew >= 1 && r.q > 0), pom = wiersze.filter(r => r.pomin);
  const sklepy = SKLEPY_DOM.includes(parag.sklep) || !parag.sklep ? SKLEPY_DOM : [parag.sklep].concat(SKLEPY_DOM);
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Sprawdź paragon</h2><button class="btn maly" data-zamknij>Anuluj</button></div>
    ${parag.dubel ? '<div class="uwaga">Ten paragon wygląda na już dodany (ta sama data, sklep i suma).</div>' : ''}
    ${w.ostrz.map(o => `<div class="uwaga">${esc(o)}</div>`).join('')}
    <div class="dwa"><label class="pole"><span>Sklep</span><select id="par-sklep">${!parag.sklep ? '<option value="">— wybierz —</option>' : ''}${sklepy.map(k => `<option ${parag.sklep === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    <label class="pole"><span>Data</span><input type="date" id="par-data" value="${esc(parag.data)}" max="${isoDzis()}"></label></div>
    <p class="mute" style="margin:0 0 6px">${w.lokal ? esc(w.lokal) + ' · ' : ''}Suma paragonu: <b>${zl(w.suma != null ? w.suma : w.sumaPoz)}</b> · suma pozycji: <b id="par-sumapoz">${zl(w.sumaPoz)}</b> · rozpoznano ${rozp.length + doSpr.length} pozycji do sprawdzenia i zapisania, ${pom.length} pominiętych</p>
    ${doSpr.length ? `<h3>Do sprawdzenia (${doSpr.length})</h3>${doSpr.map(wiersz).join('')}` : ''}
    ${rozp.length ? `<h3>Rozpoznane (${rozp.length})</h3>${rozp.map(wiersz).join('')}` : ''}
    ${pom.length ? `<details class="faq"><summary>Pominięte (${pom.length}) — napoje, alkohol, nie jedzenie</summary><div style="padding-bottom:10px">${pom.map(r => `<div class="par-pom"><span>${esc(w.poz[r.i].raw)}<br><span class="mute">${esc(r.powod)}</span></span><button class="btn maly" data-par-prod="${r.i}">Zmień</button></div>`).join('')}</div></details>` : ''}
    <label class="adapt-auto" style="margin:14px 0 4px"><input type="checkbox" id="par-lod" ${parag.lod ? 'checked' : ''}><span>Dopisz kupione produkty do lodówki${parag.juzOdh.length ? ' (na liście zakupów masz już odhaczone pozycje, więc domyślnie nie dopisuję, żeby ich nie zdublować)' : ''}</span></label>
    <button class="btn glowny szeroki" id="parZapisz" style="margin-top:12px">Zapisz paragon i ceny</button>`;
  $('#modal').hidden = false;
}
function oknoWyborProduktu(i, q) {
  const x = parag.w.poz[i];
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Co to za produkt?</h2><button class="btn maly" data-par-wroc>Wróć</button></div>
    <p class="mute"><b>${esc(x.raw)}</b> · ${esc(opisPozycji(x))}</p>
    <label class="pole"><span>Szukaj w produktach apki</span><input id="pw-szukaj" type="search" autocomplete="off" placeholder="np. ser, szynka" value="${esc(q || '')}"></label>
    <div id="pw-lista"></div>`;
  $('#modal').hidden = false; listaProduktowPar(i, q || '');
}
function listaProduktowPar(i, q) {
  const zn = znorm(q.trim()), lista = [...DB.produkty.keys()].filter(k => !zn || znorm(k).includes(zn)).sort((a, b) => a.localeCompare(b, 'pl')).slice(0, 60);
  $('#pw-lista').innerHTML = `<button class="btn szeroki" data-par-pomin-poz="${i}" style="margin-bottom:8px">Pomiń tę pozycję (nie jedzenie / poza planem)</button>`
    + (q.trim().length >= 2 && !lista.some(k => znorm(k) === zn) ? `<button class="btn glowny szeroki" data-par-nowy-prod="${i}|${esc(q.trim())}" style="margin-bottom:8px">＋ Nowy produkt: „${esc(q.trim())}”</button>` : '')
    + (() => {
      const wiersz = k => `<button class="wybor" data-par-wybrany="${i}|${esc(k)}" style="margin:6px 0"><span class="tx"><b>${esc(k)}</b><span class="mute">${esc((DB.produkty.get(k) || {}).u || '')}</span></span></button>`;
      let podobne = [];
      if (!zn) {
        const sl = znorm(parag.w.poz[i].raw).split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 4));
        podobne = [...DB.produkty.keys()].map(k => { const nk = znorm(k); return [k, sl.filter(w => nk.includes(w)).length]; }).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl')).slice(0, 5).map(x => x[0]);
      }
      return (podobne.length ? `<h3>Najbardziej podobne</h3>${podobne.map(wiersz).join('')}<h3>Wszystkie produkty</h3>` : '') + lista.map(wiersz).join('');
    })();
}
async function zapiszParagon() {
  const { w, wiersze } = parag, sklep = ($('#par-sklep') || {}).value || parag.sklep, data = ($('#par-data') || {}).value || parag.data;
  if (!sklep) { pokazToast('Wybierz sklep'); return; }
  if (parag.dubel && !(await pytaj('Ten paragon wygląda na już dodany', 'Dodać go jeszcze raz?', 'Dodaj jeszcze raz', false))) return;
  const lod = !!($('#par-lod') || {}).checked, poz = []; let nCen = 0, nLod = 0;
  for (const r of wiersze) {
    const x = w.poz[r.i], k = kluczPar(x.raw);
    if (r.pomin) { if (r.zmieniony) mapaPar[k] = ''; continue; }
    if (!r.produkt || !r.wlacz) continue;
    if (r.zmieniony || r.pew < 1) mapaPar[k] = r.produkt;
    if (!DB.produkty.has(r.produkt)) dodajWlasnyProdukt(r.produkt, zgadnijKat(r.produkt), r.u || 'g');
    if (r.pak && r.u && !x.waga) uczPak(r.produkt, r.pak, r.u);
    if (r.q > 0) { if (x.waga) zapiszCene(r.produkt, sklep, x.netto, x.wartosc, x.waga * 1000, 'g', data); else zapiszCene(r.produkt, sklep, x.netto, x.wartosc, r.q, r.u, data); nCen++; if (lod) { zmienLodowke(r.produkt, r.u, r.q); nLod++; } }
    poz.push({ n: x.raw, p: r.produkt, q: r.q || 0, u: r.u, c: x.netto, b: x.wartosc });
  }
  paragony.unshift({ id: Date.now().toString(36), data, sklep, lokal: w.lokal || '', suma: w.suma != null ? w.suma : w.sumaPoz, poz });
  paragony = paragony.slice(0, 40);
  LS.set('paragony', paragony); LS.set('ceny', ceny); LS.set('mapaPar', mapaPar); LS.set('pakiety', pakiety);
  Z([[['paragony'], paragony], [['ceny'], ceny], [['mapaPar'], mapaPar], [['pakiety'], pakiety]]);
  parag = null; $('#modal').hidden = true; rysuj();
  pokazToast(`Zapisano paragon z ${sklep}: ${nCen} ${mn(nCen, 'cena', 'ceny', 'cen')}${nLod ? `, ${nLod} ${mn(nLod, 'produkt', 'produkty', 'produktów')} w lodówce` : ''}`);
}
const mn = (n, a, b, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c;   // odmiana: 1 / 2–4 / 5+
function widokParagony() {
  const teraz = isoDzis().slice(0, 7), mies = paragony.filter(x => x.data.startsWith(teraz)), sumaM = sum(mies, x => x.suma);
  const wSkl = {}; paragony.forEach(x => { const e = (wSkl[x.sklep] = wSkl[x.sklep] || { n: 0, suma: 0 }); e.n++; e.suma += x.suma; });
  let h = `<h1>Paragony i ceny</h1>` + wskazowka('paragony', 'Dodaj paragon po zakupach: wybierz PDF lub zdjęcie albo wklej go ze schowka. Zapamiętam ceny i sklep, a na liście zakupów podpowiem, gdzie wyjdzie taniej.');
  h += `<div class="lod-kafle"><div><b>${zl(sumaM).replace(' zł', '')}</b><small>zł wydane w tym miesiącu</small></div><div><b>${paragony.length}</b><small>${mn(paragony.length, 'zapisany paragon', 'zapisane paragony', 'zapisanych paragonów')}</small></div></div>
    <button class="btn glowny szeroki" data-par-nowy>＋ Dodaj paragon</button>`;
  if (Object.keys(wSkl).length) h += `<div class="chips" style="margin-top:12px">${Object.entries(wSkl).map(([k, e]) => `<span class="chip stat">${esc(k)} · ${e.n}× · ${zl(e.suma)}</span>`).join('')}</div>`;
  h += `<h2>Ostatnie paragony</h2>` + (paragony.length ? paragony.map(x => `<details class="karta par-karta"><summary><span><b>${esc(x.sklep)}</b><small>${new Date(x.data + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })} · ${x.poz.length} ${mn(x.poz.length, 'pozycja', 'pozycje', 'pozycji')}</small></span><b>${zl(x.suma)}</b></summary>
      ${x.poz.map(q => `<div class="par-pw"><span>${esc(q.n)}${q.p ? `<br><span class="mute">→ ${esc(q.p)}${q.q ? ' · ' + String(q.q).replace('.', ',') + ' ' + esc(q.u) : ''}</span>` : ''}</span><b>${zl(q.c)}</b></div>`).join('')}
      <button class="btn maly" data-par-usun="${esc(x.id)}" style="margin:10px 0 14px">Usuń paragon</button></details>`).join('') : '<div class="karta pusta-karta"><b>Brak paragonów</b><p class="mute">Dodaj pierwszy, a apka zacznie pamiętać ceny.</p></div>');
  const wl = Object.entries(wlasneProd).sort((a, b) => a[0].localeCompare(b[0], 'pl'));
  if (wl.length) h += `<h2>Moje produkty (${wl.length})</h2><div class="karta"><p class="mute" style="margin:0 0 6px">Dodane z paragonów. Dotknij kategorii, żeby ją zmienić.</p>${wl.map(([n, x]) => `<div class="wpis"><span>${esc(n)}<br><span class="mute">${esc(x.u)}</span></span><span class="rzad" style="flex:none;flex-wrap:nowrap"><button class="chip" data-wlasny-kat="${esc(n)}">${x.kat === 'zamrażarka' ? 'Mrożone' : x.kat === 'zapas' ? 'Zapasy' : 'Świeże'}</button><button class="chip" data-wlasny-usun="${esc(n)}" aria-label="Usuń">✕</button></span></div>`).join('')}</div>`;
  const prod = Object.keys(ceny).sort((a, b) => a.localeCompare(b, 'pl'));
  h += `<h2>Ceny produktów (${prod.length})</h2>`;
  if (prod.length) h += `<div class="lod-filtr"><div class="lod-rzad"><input id="cena-szukaj" type="search" placeholder="Szukaj produktu…" autocomplete="off"></div></div><div class="karta ceny-karta">${prod.slice(0, 300).map(pr => { const e = ceny[pr], naj = Math.min(...Object.values(e).map(v => cenaX(v))); return `<div class="cena-w" data-nm="${esc(znorm(pr))}"><b>${esc(pr)}</b><div class="cena-sk">${Object.entries(e).map(([sk, v]) => `<span class="${cenaX(v) === naj && Object.keys(e).length > 1 ? 'naj' : ''}">${esc(sk)}: <b>${zl(cenaX(v))}</b>/${jednCeny(v.u)}${v.ost !== v.cb && v.cb ? `<small>po rabatach ${zl(v.ost)}</small>` : ''}<small>${new Date(v.t + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</small></span>`).join('')}</div></div>`; }).join('')}</div>`;
  else h += `<div class="karta pusta-karta"><p class="mute">Ceny pojawią się po dodaniu pierwszego paragonu.</p></div>`;
  $('#view').innerHTML = h;
}
// Porównanie sklepów dla listy zakupów (ceny z paragonów, do 180 dni wstecz).
function porownajSklepy(z) {
  const poz = ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]).map(p => { const u = Object.keys(p.kupno || {})[0]; return u ? { produkt: p.produkt, q: p.kupno[u], u } : null; }).filter(Boolean);
  const sk = sklepyZnane(), info = {};
  poz.forEach(x => { x.c = {}; for (const s of sk) { const k = kosztProduktu(x.produkt, x.q, x.u, s); if (k) x.c[s] = k.zl; } info[x.produkt] = x; });
  const uzyte = sk.filter(s => poz.filter(x => x.c[s] != null).length >= 3);
  const wspolne = uzyte.length >= 2 ? poz.filter(x => uzyte.every(s => x.c[s] != null)) : [];
  const razem = Object.fromEntries(uzyte.map(s => [s, sum(wspolne, x => x.c[s])]));
  const podzial = sum(wspolne, x => Math.min(...uzyte.map(s => x.c[s])));
  const naj = uzyte.length ? uzyte.slice().sort((a, b) => razem[a] - razem[b])[0] : null;
  const znane = poz.filter(x => Object.keys(x.c).length), szac = sum(znane, x => Math.min(...Object.values(x.c)));
  const okazje = wspolne.map(x => { const sorted = uzyte.slice().sort((a, b) => x.c[a] - x.c[b]); return { x, tani: sorted[0], drogi: sorted[sorted.length - 1], roznica: x.c[sorted[sorted.length - 1]] - x.c[sorted[0]] }; }).filter(o => o.roznica >= 0.5).sort((a, b) => b.roznica - a.roznica);
  return { poz, info, uzyte, wspolne, razem, podzial, naj, szac, znane: znane.length, okazje };
}
function kartaSklepy(c) {
  if (!c.poz.length || !sklepyZnane().length) return '';
  const kosztTxt = c.znane ? `<p class="mute" style="margin:0 0 8px">Szacowany koszt listy: <b>ok. ${zl(c.szac)}</b> <span class="mute">(ceny znane dla ${c.znane} z ${c.poz.length} pozycji, wg najtańszego znanego sklepu)</span></p>` : '';
  if (!(c.uzyte.length >= 2 && c.wspolne.length >= 3)) return `${c.znane ? kosztTxt.replace('<p class="mute" style="margin:0 0 8px">', '<p class="mute sklepy-info">') : ''}<p class="mute sklepy-info">Gdzie taniej? Po kilku paragonach z tymi samymi produktami w dwóch sklepach podpowiem, gdzie wyjdzie taniej.</p>`;
  let h = `<details class="karta zk-zwin sklepy-karta" open><summary>Gdzie taniej? ${c.naj ? `<span class="licznik">${esc(c.naj)}</span>` : ''}</summary><div class="seg mini" style="margin:0 0 10px"><button data-ceny-tryb="polkowe" class="${cenyTryb === 'rabaty' ? '' : 'akt'}">Ceny półkowe</button><button data-ceny-tryb="rabaty" class="${cenyTryb === 'rabaty' ? 'akt' : ''}">Po rabatach</button></div>${kosztTxt}`;
  if (c.uzyte.length >= 2 && c.wspolne.length >= 3) {
    const max = Math.max(...Object.values(c.razem)), min = Math.min(...Object.values(c.razem));
    h += `<div class="sk-slupki">${c.uzyte.slice().sort((a, b) => c.razem[a] - c.razem[b]).map(s => `<div class="sk-sl ${s === c.naj ? 'naj' : ''}"><span>${esc(s)}</span><div class="pasek"><i style="width:${Math.round(c.razem[s] / max * 100)}%"></i></div><b>${zl(c.razem[s])}</b></div>`).join('')}</div>
      <p class="mute" style="margin:6px 0">Porównanie na ${c.wspolne.length} produktach, które mają ceny w każdym z tych sklepów. <b>${esc(c.naj)}</b> wychodzi taniej o <b>${zl(max - min)}</b> (${Math.round((max - min) / max * 100)}%).</p>`;
    const zysk = c.razem[c.naj] - c.podzial;
    if (zysk >= 2 && c.okazje.length) h += `<p class="mute" style="margin:6px 0">Jeśli kupisz każdą rzecz tam, gdzie taniej, zaoszczędzisz jeszcze ok. <b>${zl(zysk)}</b>. Największe różnice:</p>${c.okazje.slice(0, 5).map(o => `<div class="okazja"><span>${esc(o.x.produkt)}</span><span>tanio: <b>${esc(o.tani)}</b> <small>−${zl(o.roznica)}</small></span></div>`).join('')}`;
  } else h += `<p class="mute" style="margin:0">Za mało wspólnych cen, żeby porównać sklepy (potrzebuję min. 3 produktów z listy z cenami w co najmniej dwóch sklepach). Dodaj więcej paragonów.</p>`;
  return h + `</details>`;
}
function kosztDania(g) {
  let zlk = 0, zn = 0, raz = 0;
  for (const i of g.dish.skladniki) { if (!i.ilosc || !i.produkt) continue; raz++; const k = kosztProduktu(i.produkt, i.ilosc * skala(g, i), i.jednostka); if (k) { zlk += k.zl; zn++; } }
  return raz && zn ? { zl: zlk, zn, raz } : null;
}

// ---------- smak: oceny dań przez osoby (0 nie, 1 może być, 2 super); uczą plan ----------
const OCENY_SMAKU = [[2, 'Super'], [1, 'Może być'], [0, 'Nie']];
function ocenSmak(id, pp, v) {
  smaki[id] = smaki[id] || {};
  const st = smaki[id][pp];
  if (st && st.v === v && st.t === isoDzis()) { delete smaki[id][pp]; LS.set('smaki', smaki); Z([[['smaki', id, pp], undefined]]); return; }   // drugi klik tej samej oceny cofa
  smaki[id][pp] = { v, t: isoDzis(), n: (st ? st.n : 0) + 1 };
  LS.set('smaki', smaki); Z([[['smaki', id, pp], smaki[id][pp]]]);
}
const smakWiersze = (id, osoby) => osoby.map(pp => `<div class="smak-w"><b class="${pp}">${ETY[pp]}</b><div class="seg mini">${OCENY_SMAKU.map(([v, et]) => `<button data-smak="${esc(id)}:${pp}:${v}" class="${smaki[id] && smaki[id][pp] && smaki[id][pp].v === v ? 'akt' : ''}">${et}</button>`).join('')}</div></div>`).join('');
function odswiezSmak() {
  if (got) rysujGot();
  document.querySelectorAll('.smak-blok[data-dish]').forEach(el => { el.innerHTML = smakWiersze(el.dataset.dish, OS); });
  const o = $('#smak-okno'); if (o) o.innerHTML = smakWiersze(o.dataset.dish, JSON.parse(o.dataset.osoby));
}
function oknoSmak(id, osoby) {
  const d = DB.dania.get(id); if (!d) return;
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Jak smakowało?</h2><button class="btn maly" data-zamknij>Gotowe</button></div><p class="mute">${esc(d.nazwa)}. Dania, które lubicie, będą wracać częściej, a te, które Wam nie smakują, rzadziej.</p><div id="smak-okno" data-dish="${esc(id)}" data-osoby='${JSON.stringify(osoby)}'>${smakWiersze(id, osoby)}</div>`;
  $('#modal').hidden = false;
}
function zapytajSmak(g, d) {
  const os = [...new Set(g.porcje.filter(q => q.d === d).map(q => q.p))], id = g.dish.id;
  const trzeba = os.filter(pp => { const x = smaki[id] && smaki[id][pp]; return !x || (Date.now() - new Date(x.t)) > 45 * 864e5; });
  if (trzeba.length) pokazToast('Zjedzone. Jak smakowało?', 'Oceń', () => oknoSmak(id, trzeba));
}
function smakTagi(id) {
  const x = smaki[id]; if (!x) return '';
  const lub = OS.filter(pp => x[pp] && x[pp].v === 2), nie = OS.filter(pp => x[pp] && x[pp].v === 0);
  return (lub.length ? `smakuje: ${lub.map(pp => ETY[pp]).join(', ')} · ` : '') + (nie.length ? `nie smakowało: ${nie.map(pp => ETY[pp]).join(', ')} · ` : '');
}
// Kara / bonus do oceny planu za zebrane smaki (kto je dany posiłek).
function smakKara(pl) {
  let k = 0;
  pl.dni.forEach(day => {
    const sl = [['sn', day.sn], day.m13.wsp ? ['m13', day.m13.wsp] : null, !day.m13.wsp ? ['m13ona', day.m13.ona] : null, !day.m13.wsp ? ['m13on', day.m13.on] : null, day.ob ? ['ob', day.ob] : null, ['k18', day.k18]].filter(Boolean);
    for (const [slot, id] of sl) { const x = smaki[id]; if (!x) continue; osobySlotu(slot).forEach(pp => { if (x[pp]) k += x[pp].v === 2 ? -4 : x[pp].v === 0 ? 30 : 0; }); }
  });
  return k;
}
// ---------- meal prep: gotuj raz, jedz kilka razy ----------
// fazy: przyg = czynne przygotowanie, gotuj = bierne gotowanie, post = czynne po gotowaniu, studz = bierne studzenie, porc = czynne porcjowanie (minuty).
const PREP = {
  'ryż': { nazwa: 'Ryż', u: 'g', ugot: 2.8, woda: 2, dni: 2, wzor: /ry[żz]/i, fazy: { przyg: 3, gotuj: 12, post: 6, studz: 25, porc: 4 }, gar: 1,
    przyg: (c, w) => `Ryż: odmierz ${w.suchy} g i przepłucz na sitku zimną wodą, aż woda będzie prawie czysta.`, gotuj: (c, w) => `Ryż: do garnka wlej ${w.woda} ml wody i szczyptę soli, zagotuj, wsyp ryż, przykryj i gotuj na najmniejszym ogniu 12 min.`,
    post: () => `Ryż: zdejmij z ognia i nie otwieraj pokrywki — odstaw na 5 min, potem napuszyj widelcem.`, studz: () => `Ryż: rozłóż cienką warstwą na blasze albo dużym talerzu i studź 20 min. Do godziny od ugotowania musi trafić do lodówki.`,
    przech: 'Lodówka do 2 dni, zamknięty pojemnik. Ryż psuje się szybciej niż inne dodatki, więc nie zostawiaj go w temperaturze pokojowej.', podgrzej: 'Mikrofala 2 min pod przykryciem z łyżką wody albo patelnia 3 min. Podgrzewaj tylko raz, do gorącego.' },
  'kasza gryczana': { nazwa: 'Kasza gryczana', u: 'g', ugot: 2.6, woda: 2, dni: 3, wzor: /gryczan/i, fazy: { przyg: 2, gotuj: 15, post: 5, studz: 15, porc: 4 }, gar: 1,
    przyg: (c, w) => `Kasza gryczana: odmierz ${w.suchy} g i przepłucz na sitku.`, gotuj: (c, w) => `Kasza gryczana: zagotuj ${w.woda} ml osolonej wody, wsyp kaszę, przykryj i gotuj na małym ogniu 15 min.`,
    post: () => `Kasza gryczana: zdejmij z ognia, odstaw przykrytą na 5 min i rozdrobnij widelcem.`, studz: () => `Kasza gryczana: rozłóż na talerzu i studź 15 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik.', podgrzej: 'Mikrofala 2 min z łyżką wody albo patelnia 3 min.' },
  'kasza jaglana': { nazwa: 'Kasza jaglana', u: 'g', ugot: 2.8, woda: 2.2, dni: 3, wzor: /jaglan|jaglank/i, fazy: { przyg: 3, gotuj: 15, post: 5, studz: 15, porc: 4 }, gar: 1,
    przyg: (c, w) => `Kasza jaglana: odmierz ${w.suchy} g i przepłucz kilka razy na sitku, na końcu przelej wrzątkiem (usuwa goryczkę).`, gotuj: (c, w) => `Kasza jaglana: zagotuj ${w.woda} ml wody, wsyp kaszę, przykryj i gotuj na małym ogniu 15 min.`,
    post: () => `Kasza jaglana: odstaw przykrytą na 5 min, rozdrobnij widelcem.`, studz: () => `Kasza jaglana: rozłóż na talerzu i studź 15 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik.', podgrzej: 'Mikrofala 2 min z odrobiną mleka lub wody.' },
  'kuskus': { nazwa: 'Kuskus', u: 'g', ugot: 2.3, woda: 1.1, dni: 3, wzor: /kuskus/i, fazy: { przyg: 2, gotuj: 5, post: 2, studz: 10, porc: 4 }, gar: 0,
    przyg: (c, w) => `Kuskus: odmierz ${w.suchy} g do miski, dodaj szczyptę soli.`, gotuj: (c, w) => `Kuskus: zalej ${w.woda} ml wrzątku, przykryj talerzem i odstaw na 5 min.`,
    post: () => `Kuskus: rozdrobnij widelcem, żeby się nie sklejał.`, studz: () => `Kuskus: rozłóż na talerzu i studź 10 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik.', podgrzej: 'Mikrofala 1–2 min z łyżką wody albo zjedz na zimno.' },
  'kasza bulgur': { nazwa: 'Kasza bulgur', u: 'g', ugot: 2.7, woda: 2, dni: 3, wzor: /bulgur/i, fazy: { przyg: 2, gotuj: 12, post: 5, studz: 15, porc: 4 }, gar: 1,
    przyg: (c, w) => `Bulgur: odmierz ${w.suchy} g i przepłucz na sitku.`, gotuj: (c, w) => `Bulgur: zagotuj ${w.woda} ml osolonej wody, wsyp kaszę, przykryj i gotuj na małym ogniu 12 min.`,
    post: () => `Bulgur: odstaw przykryty na 5 min i rozdrobnij widelcem.`, studz: () => `Bulgur: rozłóż na talerzu i studź 15 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik.', podgrzej: 'Mikrofala 2 min z łyżką wody albo zjedz na zimno w sałatce.' },
  'makaron pszenny': { nazwa: 'Makaron', u: 'g', ugot: 2.3, woda: 10, dni: 3, wzor: /makaron/i, fazy: { przyg: 2, gotuj: 9, post: 3, studz: 8, porc: 4 }, gar: 1,
    przyg: (c, w) => `Makaron: odmierz ${w.suchy} g. W dużym garnku zagotuj ${w.woda} ml wody (1 litr na 100 g) i dosól.`, gotuj: (c, w) => `Makaron: wrzuć do wrzątku i gotuj 9 min (o minutę krócej niż na opakowaniu, żeby był al dente).`,
    post: () => `Makaron: odcedź i przepłucz zimną wodą, żeby przestał się gotować. Skrop łyżeczką oliwy i wymieszaj.`, studz: () => `Makaron: rozłóż na talerzu i ostudź 8 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik (skropiony oliwą nie skleja się).', podgrzej: 'Wrzuć na patelnię z sosem na 2–3 min albo zalej wrzątkiem na minutę.' },
  'makaron ryżowy': { nazwa: 'Makaron ryżowy', u: 'g', ugot: 2.5, woda: 10, dni: 2, wzor: /makaron/i, fazy: { przyg: 2, gotuj: 6, post: 3, studz: 8, porc: 4 }, gar: 1,
    przyg: (c, w) => `Makaron ryżowy: odmierz ${w.suchy} g i zagotuj wodę.`, gotuj: (c, w) => `Makaron ryżowy: zalej gorącą (nie wrzącą) wodą i odstaw na czas z opakowania (zwykle 5–6 min).`,
    post: () => `Makaron ryżowy: odcedź, przepłucz zimną wodą i skrop odrobiną oleju.`, studz: () => `Makaron ryżowy: rozłóż na talerzu i ostudź 8 min.`,
    przech: 'Lodówka do 2 dni, zamknięty pojemnik.', podgrzej: 'Zalej gorącą wodą na minutę albo smaż krótko w woku.' },
  'ziemniaki': { nazwa: 'Ziemniaki', u: 'g', ugot: 1, woda: 0, dni: 3, wzor: /ziemniak/i, fazy: { przyg: 6, gotuj: 20, post: 2, studz: 15, porc: 4 }, gar: 1,
    przyg: (c, w) => `Ziemniaki: obierz ${w.suchy} g, pokrój w kostkę 3 cm i opłucz.`, gotuj: () => `Ziemniaki: zalej zimną osoloną wodą, zagotuj i gotuj pod uchyloną pokrywką 20 min, aż będą miękkie.`,
    post: () => `Ziemniaki: odcedź i odparuj 2 min.`, studz: () => `Ziemniaki: rozłóż na talerzu i ostudź 15 min.`,
    przech: 'Lodówka do 3 dni, zamknięty pojemnik.', podgrzej: 'Najlepiej na patelni 4–5 min z odrobiną oleju, w mikrofali robią się gumowate.' },
  'jaja': { nazwa: 'Jajka na twardo', u: 'szt.', ugot: 1, woda: 0, dni: 5, wzor: /jaj/i, twarde: true, fazy: { przyg: 1, gotuj: 9, post: 5, studz: 5, porc: 3 }, gar: 1,
    przyg: (c, w) => `Jajka: wyjmij ${w.suchy} jaj z lodówki i przygotuj garnek z wodą, żeby jajka były zalane.`, gotuj: () => `Jajka: włóż do wrzątku i gotuj na twardo 9 min.`,
    post: () => `Jajka: przelej zimną wodą i trzymaj w niej 5 min — łatwiej się obierają.`, studz: () => `Jajka: osusz. Możesz je obrać teraz albo tuż przed jedzeniem.`,
    przech: 'Lodówka do 5 dni (nieobrane do 7), w pojemniku.', podgrzej: 'Jedz na zimno albo zalej gorącą wodą na minutę.' }
};
// Czy danie gotuje ten składnik osobno (a nie w garnku z zupą)? Wtedy da się go ugotować na zapas.
function gotowaneOsobno(dish, prod) {
  const c = PREP[prod]; if (!c || dish.typ === 'obiad_zupa') return false;
  return (dish.kroki || []).some(k => c.twarde ? /na twardo/i.test(k) : (/(ugotuj|gotuj|zagotuj|wsyp|zalej|przepłucz)/i.test(k) && c.wzor.test(k)));
}
const nazwaSlotu = sl => (PORA[sl] || sl).split(' · ').slice(-1)[0];
const dzienKrotki = iso => `${DNI_KR[(new Date(iso + 'T12:00:00').getDay() + 6) % 7]} ${krotkaData(iso)}`;
// Plan sesji: składniki z dań w oknie [od, od + h dni], które opłaca się ugotować raz (max tyle dni, ile wytrzymują w lodówce).
function planPrepu(od, h) {
  const doo = dodajDni(od, h), wg = {}, dzis = isoDzis();
  for (const t of tygodnieZapisane()) {
    const wk = oblicz({ start: t.start, dni: t.dni }, cele());
    for (const g of wk.garnki) for (const i of g.dish.skladniki) {
      if (!PREP[i.produkt] || !i.ilosc || !gotowaneOsobno(g.dish, i.produkt)) continue;
      for (const x of dniGarnka(g)) {
        const iso = dodajDni(t.start, x);
        if (iso < od || iso > doo || iso < dzis || t.zuz[kluczZ(x, g.slot, t.start)]) continue;
        const c = PREP[i.produkt], ilosc = i.ilosc * skala(g, i) * udzialDnia(g, x);
        (wg[i.produkt] = wg[i.produkt] || []).push({ iso, slot: g.slot, id: g.dish.id, dish: g.dish.nazwa, wk: t.start, d: x, suchy: c.u === 'szt.' ? Math.max(1, Math.round(ilosc)) : Math.round(ilosc / 5) * 5 || 5, kto: [...new Set(g.porcje.filter(q => q.d === x).map(q => q.p))] });
      }
    }
  }
  const komp = [], pojedyncze = []; let min = 0, gar = 0;
  for (const [prod, uz] of Object.entries(wg)) {
    const c = PREP[prod]; uz.sort((a, b) => a.iso.localeCompare(b.iso) || a.slot.localeCompare(b.slot));
    // jeden dzień = jedna porcja do pojemnika; w obrębie limitu przechowywania
    const wOkn = uz.filter(x => (new Date(x.iso) - new Date(od)) / 864e5 <= c.dni), poza = uz.filter(x => !wOkn.includes(x));
    if (wOkn.length < 2) { pojedyncze.push({ prod, nazwa: c.nazwa, uzycia: uz }); continue; }
    wOkn.forEach(x => { x.ugot = c.u === 'szt.' ? x.suchy : Math.round(x.suchy * c.ugot / 5) * 5; });
    const suchy = sum(wOkn, x => x.suchy), ugot = sum(wOkn, x => x.ugot), czynne = c.fazy.przyg + c.fazy.post + c.fazy.porc + 5;
    const oszcz = (wOkn.length - 1) * czynne; min += oszcz; gar += (wOkn.length - 1) * c.gar;
    komp.push({ prod, nazwa: c.nazwa, u: c.u, suchy, ugot, uzycia: wOkn, poza, oszczMin: oszcz });
  }
  komp.sort((a, b) => b.oszczMin - a.oszczMin);
  const kroki = krokiSesji(komp);
  return { od, doo, h, komp, pojedyncze, oszczMin: min, oszczGar: gar, kroki: kroki.kroki, czas: kroki.czas };
}
// Harmonogram jednej osoby: najpierw ustawia najdłuższe gotowania, potem kończy je w kolejności, na końcu porcjuje do pojemników.
function krokiSesji(komp) {
  if (!komp.length) return { kroki: [], czas: 0 };
  const kroki = [], zad = komp.map(c => ({ c, p: PREP[c.prod], w: { suchy: c.suchy, woda: Math.round(c.suchy * PREP[c.prod].woda / 10) * 10 } })).sort((a, b) => b.p.fazy.gotuj - a.p.fazy.gotuj);
  let t = 0;
  for (const z of zad) { kroki.push(z.p.przyg(z.c, z.w)); t += z.p.fazy.przyg; kroki.push(z.p.gotuj(z.c, z.w)); z.gotowe = t + z.p.fazy.gotuj; }
  const wgGot = zad.slice().sort((a, b) => a.gotowe - b.gotowe);
  for (const z of wgGot) { t = Math.max(t, z.gotowe); kroki.push(z.p.post(z.c, z.w)); t += 2; z.stygnie = t + z.p.fazy.studz; kroki.push(z.p.studz(z.c, z.w)); }
  const wgSt = zad.slice().sort((a, b) => a.stygnie - b.stygnie);
  for (const z of wgSt) {
    t = Math.max(t, z.stygnie);
    const lista = z.c.uzycia.map(x => `${dzienKrotki(x.iso)} ${nazwaSlotu(x.slot)} — ${x.ugot} ${z.c.u === 'szt.' ? 'szt.' : 'g'}`).join('; ');
    kroki.push(`${z.p.nazwa}: podziel na ${z.c.uzycia.length} ${z.c.uzycia.length < 5 ? 'pojemniki' : 'pojemników'} i opisz: ${lista}. Zamknij i wstaw do lodówki (zjedz najpóźniej do ${dzienKrotki(z.c.uzycia[z.c.uzycia.length - 1].iso)}, czyli maks. ${z.p.dni} dni po ugotowaniu).`);
    t += z.p.fazy.porc;
  }
  return { kroki, czas: Math.round(t) };
}
const sesjaDla = (g) => sesje.flatMap(se => se.komp.flatMap(k => k.uzycia.filter(u => u.wk === plan.start && u.id === g.dish.id && u.slot === g.slot).map(u => ({ se, k, u }))));
// Który krok przepisu został zrobiony w sesji meal prep (ten składnik ugotowany wcześniej)?
function krokZSesji(g, tekst) {
  for (const { k } of sesjaDla(g)) { const c = PREP[k.prod]; if (c && /(ugotuj|gotuj|zagotuj|wsyp|zalej|przepłucz)/i.test(tekst) && (c.twarde ? /na twardo/i.test(tekst) : c.wzor.test(tekst))) return `${c.nazwa} z sesji ${dzienKrotki(sesje.find(x => x.komp.includes(k)).od)}`; }
  return null;
}
function wskazPrepuPrzepis(g) {
  if (!g || g.prep || sesjaDla(g).length) return '';
  const k = g.dish.skladniki.find(i => PREP[i.produkt] && i.ilosc && gotowaneOsobno(g.dish, i.produkt)); if (!k) return '';
  return `<button class="prep-wsk" data-szybka="prep"><b>${esc(PREP[k.produkt].nazwa)} możesz ugotować na zapas</b><small>Zobacz, czy meal prep się opłaca ›</small></button>`;
}
function notaPrepu(g) {
  const ws = sesjaDla(g); if (!ws.length) return '';
  return `<div class="prep-nota"><b>Z sesji meal prep</b>${ws.map(({ se, k, u }) => `<div>${esc(PREP[k.prod].nazwa)}: weź <b>${u.ugot} ${k.u === 'szt.' ? 'szt.' : 'g ugotowanego'}</b> z pojemnika${se.zrobione ? '' : ' (sesja zaplanowana na ' + dzienKrotki(se.od) + ')'}. Pomiń gotowanie tego składnika.</div>`).join('')}</div>`;
}
function zapiszSesje(pl) {
  const id = pl.od + '_' + pl.h, kopia = { id, od: pl.od, h: pl.h, zrobione: false, t: Date.now(), komp: pl.komp.map(c => ({ prod: c.prod, nazwa: c.nazwa, u: c.u, suchy: c.suchy, ugot: c.ugot, uzycia: c.uzycia.map(x => ({ iso: x.iso, slot: x.slot, id: x.id, dish: x.dish, wk: x.wk, d: x.d, suchy: x.suchy, ugot: x.ugot })) })) };
  sesje = sesje.filter(x => x.id !== id && x.od >= dodajDni(isoDzis(), -3)).concat([kopia]).sort((a, b) => a.od.localeCompare(b.od)).slice(-6);
  LS.set('sesje', sesje); Z([[['sesje'], sesje]]);
  return kopia;
}
function otworzSesje(pl, se) {
  if (!pl.komp.length) return;
  const skl = pl.komp.map(c => ({ nazwa: `${c.nazwa}${c.u === 'szt.' ? '' : ' (suchy)'}`, produkt: c.prod, ilosc: c.suchy, jednostka: c.u, kategoria: 'zapas' }));
  const g = { prep: true, dish: { id: 'prep_' + pl.od, nazwa: `Meal prep ${dzienKrotki(pl.od)}`, kroki: pl.kroki, skladniki: skl, przyprawy: [], czas: `ok. ${pl.czas} min`, sprzet: 'garnki, sitko, pojemniki, widelec', typ: 'prep' }, slot: 'prep', d: 0, porcje: [], K: 1, s: 1, sw: 1, a: 1, b: 1, lev: new Set(), nF: 1 };
  otworzGotowanie(g, false); got.prep = true; got.sesja = se; rysujGot();
}

// ---------- jedzenie poza planem ----------
const POZA_GOTOWE = [['Kawa z mlekiem', 80], ['Batonik', 250], ['Ciastko / drożdżówka', 300], ['Lody', 200], ['Piwo', 200], ['Kieliszek wina', 130], ['Burger z frytkami', 900], ['Pizza (pół)', 700], ['Kebab', 800], ['Obiad w restauracji', 900]];
function oknoPoza() {
  const dz = isoDzis(), d = Math.round((new Date(dz + 'T12:00:00') - new Date(plan.start + 'T12:00:00')) / 864e5);
  if (d < 0 || d > 6) { pokazToast('Na dziś nie ma planu'); return; }
  const day = plan.dni[d], kto = OS.filter(p => !nieob(day, p));
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Zjadłem coś spoza planu</h2><button class="btn maly" data-zamknij>Anuluj</button></div>
    <p class="mute">Wpisz, co to było i ile miało kalorii. Pomniejszę kolejne dzisiejsze posiłki, żeby dzień się zgadzał.</p>
    <label class="pole"><span>Co to było? (opcjonalnie)</span><input id="poza-n" type="text" autocomplete="off" placeholder="np. pizza z kolegami"></label>
    <div class="chips">${POZA_GOTOWE.map(([n, k]) => `<button class="chip" data-poza-gotowe="${esc(n)}|${k}">${esc(n)} · ${k}</button>`).join('')}</div>
    <h3>Kto zjadł?</h3><div class="poza-osoby">${kto.map(p => `<div class="poza-os ${p}"><label class="poza-et"><input type="checkbox" data-poza-os="${p}" ${kto.length === 1 ? 'checked' : ''}><span>${ETY[p]}</span></label><input id="poza-k-${p}" type="text" inputmode="decimal" placeholder="kcal" aria-label="Kalorie ${ETY[p]}"></div>`).join('')}</div>
    <button class="btn glowny szeroki" data-poza-zapisz="${d}" style="margin-top:14px">Zapisz</button>`;
  $('#modal').hidden = false;
}
function zapiszPoza(d) {
  const day = plan.dni[d], nazwa = (($('#poza-n') || {}).value || '').trim() || 'Poza planem', w = oblicz(plan, cele()); let n = 0; const sn = snapStanu();
  for (const p of OS) {
    const k = liczbaZ((($('#poza-k-' + p) || {}).value || '0')); if (!(k > 0)) continue;
    const sl = w.dni[d].sloty.filter(({ g, odgrzewane }) => !odgrzewane && !zuzyte[kluczZ(d, g.slot)] && g.porcje.some(q => q.d === d && q.p === p)).map(({ g }) => g.slot);
    day.poza = day.poza || {}; (day.poza[p] = day.poza[p] || []).push({ n: nazwa, k: Math.round(k), sl, t: Date.now() }); n++;
  }
  if (!n) { pokazToast('Wpisz kalorie'); return; }
  LS.set('plan', plan); Z([[['dni', d, 'poza'], day.poza]]); zamknijOkno(); otwartyDzien = d; rysuj();
  const w2 = oblicz(plan, cele()), braki = OS.filter(p => (day.poza && day.poza[p]) && w.dni[d][p].kcal - w2.dni[d][p].kcal < 0.9 * (day.poza[p][day.poza[p].length - 1].k)).length;
  toastCofnij(braki ? 'Zapisane. Część kalorii zostaje, bo nie wszystkie dzisiejsze dania da się jeszcze pomniejszyć' : 'Zapisane. Kolejne posiłki dziś są mniejsze', sn);
}
function pozaLista(day, d) {
  const wp = OS.flatMap(p => ((day.poza && day.poza[p]) || []).map((e, i) => ({ p, e, i }))); if (!wp.length) return '';
  return `<h2>Poza planem</h2><div class="karta posilki-dnia">${wp.map(({ p, e, i }) => `<div class="pos-wiersz poza-wiersz"><span class="poza-ik ${p}">${ETY[p]}</span><div class="pos-tx"><b>${esc(e.n)}</b><span class="mute">${r0(e.k)} kcal${(e.sl || []).length ? ' · reszta dnia pomniejszona' : ' · dzień był już zjedzony'}</span></div><button class="pos-pomin" data-poza-usun="${d}|${p}|${i}" aria-label="Usuń wpis">Usuń</button></div>`).join('')}</div>`;
}
// ---------- dostępność okien ----------
(function () {
  const m = document.getElementById('modal'), box = document.getElementById('modal-box'); if (!m || !box || !window.MutationObserver) return;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Okno'); box.tabIndex = -1;
  let poprz = null;
  new MutationObserver(() => {
    if (!m.hidden) { poprz = document.activeElement; setTimeout(() => { if (!m.hidden && !box.contains(document.activeElement)) box.focus({ preventScroll: true }); }, 60); }
    else if (poprz && document.contains(poprz)) { try { poprz.focus({ preventScroll: true }); } catch (e) { /* element zniknął */ } poprz = null; }
  }).observe(m, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden && !got) zamknijOkno(); });
})();
// ---------- „Co lubicie?”: przesuwanie dań (uczy plan, co Wam smakuje) ----------
let sw = null;
const SW_TYPY = { ob: ['Obiady', () => DB.pula.ob1.concat(DB.pula.ob2)], sn: ['Śniadania', () => DB.pula.sn], m13: ['Drugie śniadanie', () => DB.pula.m13on] };
function swBudujTalie() {
  const os = sw.kto === 'oboje' ? OS : [sw.kto];
  sw.talia = tasuj(SW_TYPY[sw.typ][1]().filter(d => !ukryte(d.id) && dopuszcza(d, os) && os.some(p => !(smaki[d.id] && smaki[d.id][p]))).slice()).slice(0, 25); sw.i = 0;
}
function widokSwipe() {
  if (!sw) { sw = { typ: 'ob', kto: 'oboje', licz: 0 }; swBudujTalie(); }
  $('#view').innerHTML = `<h1>Co lubicie?</h1><p class="mute">Przesuń w prawo, co Wam smakuje, w lewo, czego nie chcecie. Plan będzie z tego korzystał.</p>
    <div class="seg mini" role="group" aria-label="Dla kogo">${[['oboje', 'Oboje'], ['ona', 'ONA'], ['on', 'ON']].map(([k, et]) => `<button data-sw-kto="${k}" class="${sw.kto === k ? 'akt' : ''}">${et}</button>`).join('')}</div>
    <div class="seg mini" style="margin-top:8px" role="group" aria-label="Rodzaj dań">${Object.entries(SW_TYPY).map(([k, [et]]) => `<button data-sw-typ="${k}" class="${sw.typ === k ? 'akt' : ''}">${et}</button>`).join('')}</div>
    <div id="sw-stos"></div>`;
  swKarta();
}
function swKarta() {
  const el = $('#sw-stos'); if (!el) return; const d = sw.talia[sw.i];
  if (!d) { el.innerHTML = `<div class="pusty"><b>${sw.talia.length ? 'To wszystko na teraz' : 'Wszystko już ocenione'}</b><span>${sw.licz ? `Zapamiętałem ${sw.licz} ${mn(sw.licz, 'ocenę', 'oceny', 'ocen')}.` : 'Zmień osobę albo rodzaj dań, żeby zobaczyć kolejne.'}</span></div>`; return; }
  const m = minDania(d), top = d.skladniki.filter(i => i.produkt && i.ilosc).slice(0, 4).map(i => i.produkt.replace(/ \(.*\)/, ''));
  el.innerHTML = `<div class="sw-licznik mute">${sw.i + 1} z ${sw.talia.length}</div>
    <div class="sw-karta" id="sw-karta"><div class="sw-obr">${Obr.html(d, 'duzy')}</div><h2>${esc(d.nazwa)}</h2>
      <div class="chips" style="justify-content:center">${m ? `<span class="chip stat">${m} min</span>` : ''}<span class="chip stat">${d.na_porcje.kcal} kcal</span><span class="chip stat">${d.na_porcje.bialko} g białka</span></div>
      <p class="mute">${esc(top.join(', '))}</p><div class="sw-znak sw-nie">NIE</div><div class="sw-znak sw-tak">CHĘTNIE</div></div>
    <div class="sw-przyciski"><button class="sw-btn nie" data-sw="nie" aria-label="Nie dla nas">✕</button><button class="btn" data-sw="pomin">Pomiń</button><button class="sw-btn tak" data-sw="tak" aria-label="Chętnie">♥</button></div>`;
  swPrzesuwanie($('#sw-karta'));
}
function swDecyduj(co) {
  const d = sw.talia[sw.i]; if (!d) return;
  if (co !== 'pomin') (sw.kto === 'oboje' ? OS : [sw.kto]).forEach(p => { if (!(smaki[d.id] && smaki[d.id][p])) ocenSmak(d.id, p, co === 'tak' ? 2 : 0); }), sw.licz++;
  sw.i++; swKarta();
}
function swPrzesuwanie(k) {
  if (!k) return; let x0 = null, dx = 0;
  const ustaw = () => { k.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`; k.classList.toggle('sw-prawo', dx > 30); k.classList.toggle('sw-lewo', dx < -30); };
  k.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; k.setPointerCapture(e.pointerId); k.style.transition = 'none'; });
  k.addEventListener('pointermove', e => { if (x0 === null) return; dx = e.clientX - x0; ustaw(); });
  const koniec = () => { if (x0 === null) return; x0 = null; k.style.transition = 'transform .28s ease, opacity .28s'; if (Math.abs(dx) > 90) { const tak = dx > 0; k.style.transform = `translateX(${tak ? 420 : -420}px) rotate(${tak ? 22 : -22}deg)`; k.style.opacity = '0'; setTimeout(() => swDecyduj(tak ? 'tak' : 'nie'), 240); } else { dx = 0; k.style.transform = ''; k.classList.remove('sw-prawo', 'sw-lewo'); } };
  k.addEventListener('pointerup', koniec); k.addEventListener('pointercancel', koniec);
}
// ---------- sezonowość ----------
// Świeże warzywa i owoce z krajowej uprawy: w których miesiącach (1–12) są w sezonie. Produkty bez wpisu (marchew, ziemniaki, cebula, banany…) są neutralne.
const SEZON = { 'pomidorki koktajlowe': [6, 7, 8, 9, 10], 'ogórek świeży': [5, 6, 7, 8, 9], papryka: [7, 8, 9, 10], cukinia: [6, 7, 8, 9, 10], 'brokuł': [6, 7, 8, 9, 10], kalafior: [6, 7, 8, 9, 10], 'szpinak świeży': [4, 5, 6, 9, 10], 'rzodkiewka (pęczek)': [4, 5, 6, 9], 'dynia piżmowa': [9, 10, 11, 12], 'sałata': [5, 6, 7, 8, 9], 'jabłko': [8, 9, 10, 11, 12, 1, 2, 3] };
const miesiac = () => new Date().getMonth() + 1;
function sezonDania(d) {
  const m = miesiac(), w = [], poza = [];
  for (const i of d.skladniki || []) { const z = SEZON[i.produkt]; if (!z) continue; (z.includes(m) ? w : poza).push(i.produkt.replace(/ \(.*\)/, '')); }
  return { w: [...new Set(w)], poza: [...new Set(poza)] };
}
function sezonKara(pl) {
  let k = 0;
  for (const day of pl.dni) for (const id of [day.sn, day.k18, day.ob, day.m13 && day.m13.wsp, day.m13 && day.m13.ona, day.m13 && day.m13.on]) { const d = id && DB.dania.get(id); if (!d) continue; const z = sezonDania(d); k += 1.2 * z.poza.length - 1.0 * Math.min(2, z.w.length); }
  return k;
}
const sezonChipy = d => { const z = sezonDania(d); return (z.w.length || z.poza.length) ? `<div class="sezon-chipy">${z.w.length ? `<span class="chip stat sezon-tak">W sezonie: ${esc(z.w.join(', '))}</span>` : ''}${z.poza.length ? `<span class="chip stat">Poza sezonem: ${esc(z.poza.join(', '))}</span>` : ''}</div>` : ''; };
// ---------- własne dania ----------
const TYPY_WLASNE = { sniadanie: ['Śniadanie (na dwoje)', 2], obiad: ['Obiad na 1 dzień (na dwoje)', 2], obiad_zupa: ['Obiad na 2 dni (duży garnek)', 4], drugie_on: ['Drugie śniadanie 13:00 (dla niego)', 1] };
let _nutri = null;
function tabelaOdzywcza() {
  if (_nutri) return _nutri; const t = {};
  for (const d of DB.dania.values()) for (const i of d.skladniki) if (i.produkt && i.ilosc && i.kcal != null) (t[i.produkt + '|' + i.jednostka] = t[i.produkt + '|' + i.jednostka] || []).push([i.kcal / i.ilosc, (i.bialko || 0) / i.ilosc]);
  for (const k of Object.keys(t)) { const a = t[k].map(x => x[0]).sort((x, y) => x - y), b = t[k].map(x => x[1]).sort((x, y) => x - y); t[k] = [a[Math.floor(a.length / 2)], b[Math.floor(b.length / 2)]]; }
  return (_nutri = t);
}
function dodajDoBazy(d) {
  DB.dania.set(d.id, d); const P = DB.pula;
  ({ sniadanie: [P.sn], drugie_on: [P.m13on, P.m13dania], obiad: [P.ob1], obiad_zupa: [P.ob2] }[d.typ] || []).forEach(a => { if (!a.some(x => x.id === d.id)) a.push(d); });
  for (const i of d.skladniki) if (i.produkt && i.ilosc && !DB.produkty.has(i.produkt)) DB.produkty.set(i.produkt, { kat: i.kategoria || 'zapas', u: i.jednostka });
  _nutri = null;
}
function usunZBazy(id) { DB.dania.delete(id); for (const a of Object.values(DB.pula)) { const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); } }
function zastosujWlasneDania() { for (const d of wlasneDania) if (!DB.dania.has(d.id) && DB.pula) { const k = JSON.parse(JSON.stringify(d)); normalizujPomidory(k); normalizujScalone(k); normalizujOwoce(k); normalizujLyzki(k); normalizujPuszki(k); dodajDoBazy(k); } for (const id of [...DB.dania.keys()]) if (id.startsWith('wlasne-') && !wlasneDania.some(x => x.id === id)) usunZBazy(id); }
// Czyta wklejony przepis: pierwsza linia to nazwa, linie typu „kurczak 300 g” albo „300 g kurczaka” to składniki, reszta to kroki.
function czytajPrzepis(tekst) {
  const linie = String(tekst || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean), skl = [], kroki = [];
  const JED = '(kg|g|ml|l|szt\\.?|sztuk[a-z]*|łyż[a-z.]*|lyz[a-z.]*|krom[a-z.]*|puszk[a-z]*)';
  const reA = new RegExp('^[-•*]?\\s*(.+?)[\\s:–-]+([0-9]+(?:[.,][0-9]+)?)\\s*' + JED + '?\\s*$', 'i'), reB = new RegExp('^[-•*]?\\s*([0-9]+(?:[.,][0-9]+)?)\\s*' + JED + '\\s+(.+)$', 'i');
  let nazwa = '';
  linie.forEach((l, idx) => {
    if (/^(składniki|skladniki|wykonanie|przygotowanie|sposób przygotowania|sposob przygotowania|kroki)[: ]*$/i.test(l)) return;
    if (!nazwa && idx === 0 && !reA.test(l) && !reB.test(l)) { nazwa = l; return; }
    let m = l.match(reB), n, q, j;
    if (m) { q = m[1]; j = m[2]; n = m[3]; } else { m = l.match(reA); if (m && m[1].length < 45 && !/[.!?]$/.test(m[1])) { n = m[1]; q = m[2]; j = m[3]; } }
    if (n) skl.push({ nazwa: n.replace(/[,;]+$/, '').trim(), ilosc: parseFloat(String(q).replace(',', '.')), jed: (j || '').toLowerCase() });
    else kroki.push(l.replace(/^[0-9]+[.)]\s*/, ''));
  });
  return { nazwa, skl, kroki };
}
function wierszSkladnika(x) {
  const dp = dopasujProdukt(x.nazwa), produkt = dp && dp.produkt && !dp.pomin ? dp.produkt : x.nazwa.toLowerCase();
  const natywna = (DB.produkty.get(produkt) || {}).u || 'g'; let q = x.ilosc, u = x.jed;
  if (u === 'kg') { q *= 1000; u = 'g'; } else if (u === 'l') { q *= 1000; u = 'ml'; } else if (/^lyz|^łyż/.test(u)) { q *= (G_LYZKA[produkt] || 10); u = natywna === 'ml' ? 'ml' : 'g'; } else if (/^szt/.test(u)) u = 'szt.'; else if (/^krom/.test(u)) u = 'krom.'; else if (/^puszk/.test(u)) { q *= 400; u = 'g'; } else if (!u) u = natywna;
  const t = tabelaOdzywcza()[produkt + '|' + u], zna = !!t;
  return { nazwa: x.nazwa, produkt, ilosc: Math.round(q * 10) / 10, jednostka: u, kcal: zna ? Math.round(t[0] * q) : 0, bialko: zna ? Math.round(t[1] * q) : 0, znane: zna, kategoria: (DB.produkty.get(produkt) || {}).kat || 'zapas' };
}
let wd = null;
function oknoWlasne(krok) {
  if (!wd) wd = { tekst: '', typ: 'obiad', czas: '', skl: [], kroki: '', nazwa: '' };
  if (krok === 2) {
    const por = TYPY_WLASNE[wd.typ][1];
    $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Sprawdź danie</h2><button class="btn maly" data-wlasne-wstecz="1">Wróć</button></div>
      <label class="pole"><span>Nazwa</span><input id="wd-nazwa" type="text" value="${esc(wd.nazwa)}"></label>
      <div class="dwa"><label class="pole"><span>Rodzaj</span><select id="wd-typ">${Object.entries(TYPY_WLASNE).map(([k, [et]]) => `<option value="${k}" ${wd.typ === k ? 'selected' : ''}>${et}</option>`).join('')}</select></label>
      <label class="pole"><span>Czas (min)</span><input id="wd-czas" type="text" inputmode="numeric" value="${esc(wd.czas)}" placeholder="np. 30"></label></div>
      <h3>Składniki — kalorie i białko policzyłem z bazy, popraw jeśli trzeba</h3>
      <div class="karta wd-skl">${wd.skl.map((x, i) => `<div class="wd-w ${x.znane ? '' : 'nowe'}"><div class="wd-n"><b>${esc(x.nazwa)}</b><small>${x.ilosc} ${esc(x.jednostka)}${x.znane ? '' : ' · nie znam tego produktu, wpisz kalorie'}</small></div><label class="wd-pole"><input data-wd-k="${i}" type="text" inputmode="decimal" value="${x.kcal}" aria-label="Kalorie ${esc(x.nazwa)}"><span>kcal</span></label><label class="wd-pole"><input data-wd-b="${i}" type="text" inputmode="decimal" value="${x.bialko}" aria-label="Białko ${esc(x.nazwa)}"><span>g białka</span></label><button class="pos-pomin" data-wd-usun="${i}" aria-label="Usuń składnik">✕</button></div>`).join('') || '<p class="mute">Nie rozpoznałem składników. Wróć i wpisz je w liniach typu „kurczak 300 g”.</p>'}</div>
      <p class="wd-suma" id="wd-suma"></p>
      <label class="pole"><span>Kroki (po jednym w linii)</span><textarea id="wd-kroki" rows="6">${esc(wd.kroki)}</textarea></label>
      <button class="btn glowny szeroki" data-wlasne-zapisz="1" style="margin-top:12px">Zapisz danie</button>`;
    wdSuma(); return;
  }
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Własne danie</h2><button class="btn maly" data-zamknij>Anuluj</button></div>
    <p class="mute">Wklej przepis albo wpisz po swojemu: w pierwszej linii nazwa, potem składniki (np. „kurczak 300 g”, „jajka 4”), a na końcu kroki. Resztę policzę sam.</p>
    <label class="pole"><span>Przepis</span><textarea id="wd-tekst" rows="10" placeholder="Makaron z tuńczykiem&#10;makaron 200 g&#10;tuńczyk w sosie własnym 160 g&#10;pomidorki koktajlowe 10 szt.&#10;oliwa 1 łyżka&#10;&#10;Ugotuj makaron. Wymieszaj z tuńczykiem i pomidorkami.">${esc(wd.tekst)}</textarea></label>
    <button class="btn glowny szeroki" data-wlasne-dalej="1">Dalej</button>`;
  $('#modal').hidden = false;
}
function wdSuma() {
  const k = sum(wd.skl, x => x.kcal), b = sum(wd.skl, x => x.bialko), por = TYPY_WLASNE[wd.typ][1], el = $('#wd-suma');
  if (el) el.innerHTML = `Razem <b>${r0(k)}</b> kcal i <b>${r0(b)}</b> g białka · na porcję (${por}) <b>${r0(k / por)}</b> kcal, <b>${r0(b / por)}</b> g białka`;
}
function zapiszWlasneDanie() {
  const nazwa = (($('#wd-nazwa') || {}).value || '').trim(); if (!nazwa) { pokazToast('Wpisz nazwę dania'); return; }
  wd.nazwa = nazwa; wd.czas = (($('#wd-czas') || {}).value || '').trim(); wd.kroki = (($('#wd-kroki') || {}).value || '');
  const kroki = wd.kroki.split(/\r?\n/).map(x => x.trim()).filter(Boolean), skl = wd.skl.filter(x => x.ilosc > 0);
  if (!skl.length) { pokazToast('Dodaj choć jeden składnik'); return; }
  if (!kroki.length) kroki.push('Przygotuj składniki i połącz je według własnego pomysłu.');
  const por = TYPY_WLASNE[wd.typ][1], k = sum(skl, x => x.kcal), b = sum(skl, x => x.bialko), id = 'wlasne-' + znorm(nazwa).replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + (Date.now() % 100000);
  const d = { id, typ: wd.typ, porcje: por, kod: null, nazwa, dodane: true, wlasne: true, czas: wd.czas ? wd.czas + ' min' : '', sprzet: '', skladniki: skl.map(x => ({ nazwa: x.nazwa, produkt: x.produkt, ilosc: x.ilosc, jednostka: x.jednostka, kcal: x.kcal, bialko: x.bialko, grupa: null, uwaga: null, kategoria: x.kategoria })), przyprawy: [], razem: { kcal: k, bialko: b }, na_porcje: { kcal: Math.round(k / por), bialko: Math.round(b / por) }, tytul_kcal: Math.round(k / por), tytul_bialko: Math.round(b / por), tylko_wybor: false, weekend: false, warianty: [], kroki, odgrzewanie: null, uwaga: null, wieczorem: [], podzial: wd.typ === 'drugie_on' ? { ona: '—', on: `całość · ${Math.round(k)} kcal`, ona_kcal: null, ona_bialko: null, on_kcal: Math.round(k), on_bialko: Math.round(b) } : {}, zrodlo: ['własne'], wystapienia: [] };
  wlasneDania.push(d); LS.set('wlasneDania', wlasneDania); Z([[['wlasneDania'], wlasneDania]]);
  const kopia = JSON.parse(JSON.stringify(d)); normalizujPomidory(kopia); normalizujScalone(kopia); normalizujOwoce(kopia); normalizujLyzki(kopia); normalizujPuszki(kopia); dodajDoBazy(kopia);
  wd = null; zamknijOkno(); rysuj(); pokazToast('Danie dodane. Znajdziesz je przy zmianie dania');
}
function widokWlasne() {
  $('#view').innerHTML = `<h1>Własne dania</h1><p class="mute">Dania, które dodaliście sami. Pojawiają się w planie i przy zmianie dania tak jak reszta.</p>
    <button class="btn glowny szeroki" data-wlasne-nowe="1">＋ Dodaj własne danie</button>
    ${wlasneDania.length ? wlasneDania.map(d => `<div class="karta wd-kart"><div class="rzad-nag"><div><b>${esc(d.nazwa)}</b><br><span class="mute">${esc(TYPY_WLASNE[d.typ] ? TYPY_WLASNE[d.typ][0] : d.typ)} · ${d.na_porcje.kcal} kcal, ${d.na_porcje.bialko} g białka na porcję${d.czas ? ' · ' + esc(d.czas) : ''}</span></div><button class="btn maly" data-wlasne-usun="${esc(d.id)}">Usuń</button></div></div>`).join('') : '<div class="pusty"><b>Brak własnych dań</b><span>Dodaj pierwsze: wklej przepis, a policzę kalorie i białko.</span></div>'}`;
}
// ---------- wygląd: auto / jasny / ciemny ----------
// Style ciemne są w regułach @media (prefers-color-scheme: dark): wymuszam motyw, przestawiając warunek tych reguł (zawsze / nigdy / jak system).
function zastosujMotyw() {
  try {
    for (const arkusz of document.styleSheets) {
      if (!arkusz.href || !/style\.css/.test(arkusz.href)) continue;
      for (const r of arkusz.cssRules) {
        if (!r.media) continue;
        const mt = r.media.mediaText;
        if ((/prefers-color-scheme: *dark/.test(mt) && !/reduced/.test(mt)) || mt === 'all' || mt === 'not all') r.media.mediaText = motyw === 'ciemny' ? 'all' : motyw === 'jasny' ? 'not all' : '(prefers-color-scheme: dark)';
      }
    }
    document.documentElement.style.colorScheme = motyw === 'ciemny' ? 'dark' : motyw === 'jasny' ? 'light' : '';
    document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.removeAttribute('media'); m.content = motyw === 'ciemny' ? '#0f1311' : motyw === 'jasny' ? '#f3f7f2' : (matchMedia('(prefers-color-scheme: dark)').matches ? '#0f1311' : '#f3f7f2'); });
  } catch (e) { /* motyw nie może blokować aplikacji */ }
}
zastosujMotyw();
// ---------- trasa po sklepie ----------
// Apka uczy się kolejności, w jakiej odhaczacie produkty w sklepie (osobno dla każdego sklepu), i układa następną listę w tej kolejności. Bez gazetek i bez usług zewnętrznych.
function sklepAktywny() {
  if (sklepZak) return sklepZak;
  const l = {}; paragony.forEach(x => { l[x.sklep] = (l[x.sklep] || 0) + 1; });
  const naj = Object.entries(l).sort((a, b) => b[1] - a[1])[0];
  return naj ? naj[0] : 'Mój sklep';
}
function sklepyDoWyboru() {
  const l = []; paragony.forEach(x => { if (x.sklep && !l.includes(x.sklep)) l.push(x.sklep); });
  Object.keys(trasa).forEach(k => { if (!l.includes(k)) l.push(k); });
  const a = sklepAktywny(); if (!l.includes(a)) l.push(a);
  return l.slice(0, 5);
}
function trasaZapis(klucz, on) {
  const sk = sklepAktywny(), teraz = Date.now();
  if (!sesjaKup || sesjaKup.sklep !== sk || teraz - (sesjaKup.t || 0) > 4 * 36e5) sesjaKup = { sklep: sk, t: teraz, snap: JSON.parse(JSON.stringify(trasa[sk] || {})), kol: [] };
  sesjaKup.t = teraz; sesjaKup.kol = sesjaKup.kol.filter(x => x !== klucz);
  if (on) sesjaKup.kol.push(klucz);
  LS.set('sesjaKup', sesjaKup);
  const n = sesjaKup.kol.length; if (n < 8) return;
  const nowa = Object.assign({}, sesjaKup.snap);
  sesjaKup.kol.forEach((k, i) => { const pr = k.slice(4), r = i / (n - 1); nowa[pr] = nowa[pr] == null ? r : Math.round((0.5 * nowa[pr] + 0.5 * r) * 1000) / 1000; });
  const nowo = !trasa[sk] || Object.keys(trasa[sk]).length < 8;
  trasa[sk] = nowa; LS.set('trasa', trasa); Z([[['trasa', sk], nowa]]);
  if (nowo) pokazToast(`Zapamiętuję kolejność w sklepie: ${sk}`);
}
function trasaUklad(l, sk) {   // zwraca { dzialy: kolejność kodów, r: produkt → pozycja } albo null, gdy za mało danych
  const tr = trasa[sk]; if (trasaTryb !== 'moja' || !tr || Object.keys(tr).length < 8) return null;
  const wynik = {};
  DZIALY.forEach(([kod], i) => {
    const p = (l[kod] || []).map(x => tr[x.produkt]).filter(v => v != null);
    wynik[kod] = p.length ? sum(p, v => v) / p.length : (i + 0.5) / DZIALY.length;
  });
  return { dzialy: DZIALY.map(d => d[0]).sort((a, b) => wynik[a] - wynik[b]), sr: wynik, tr };
}
// ---------- dopasowanie dnia i tygodnia („Opisz tydzień”, „Nie mam czasu”) ----------
// Z tekstu albo jednego przycisku: szybkie dania, bez mięsa, bez gotowania, lekko, goście, nieobecność. Wszystko liczy się na telefonie, bez żadnych usług zewnętrznych.
function minDania(d) {
  const sx = String(d.czas || ''), hm = sx.match(/([0-9]+) *h *([0-9]+) *min/), h = sx.match(/([0-9]+(?:,[0-9]+)?) *h/), m = sx.match(/([0-9]+) *min/);
  const v = hm ? +hm[1] * 60 + +hm[2] : h ? Math.round(parseFloat(h[1].replace(',', '.')) * 60) : m ? +m[1] : null;
  return v || null;
}
const tkDania = d => d._tk || (d._tk = znorm(d.nazwa + ' ' + d.skladniki.map(i => i.nazwa + ' ' + (i.produkt || '')).join(' ')));
const MIESO_RE = /(^|[^a-z0-9])(kurczak|indyk|drob|cwiartki|wieprzow|boczek|kielbas|schab|szynk|zeberk|karkowk|wolowin|poledwic|pulpet|bekon|mielon)/;
const TRYBY = {
  szybko: { et: 'Szybko', ok: (d, slot, o) => { const m = minDania(d), lim = slot === 'ob' ? Math.max(30, o.min || 30) : (o.min || 15); return m == null || m <= lim; } },
  zimno: { et: 'Bez gotowania', ok: d => !/(patelni|garnek|piekarnik|airfryer|blacha|grill|toster|opiekacz|rondel)/i.test(d.sprzet || '') },
  bezMiesa: { et: 'Bez mięsa', ok: d => !MIESO_RE.test(tkDania(d)) },
  bezRyb: { et: 'Bez ryb', ok: d => !GRUPY_WYKL.ryby[1].test(tkDania(d)) },
  lekko: { et: 'Lekko', ok: d => { const m = minDania(d); return (m == null || m <= 35) && !['obiad_sobota', 'obiad_niedziela'].includes(d.typ) && !/frytk|airfryer/i.test(d.nazwa + ' ' + (d.sprzet || '')); } }
};
function dopasujDzien(start, d, tryby, o) {
  const t = tygodnieZapisane().find(x => x.start === start); if (!t) return { zm: [], uw: ['Na ten dzień nie ma planu.'] };
  const w = oblicz({ start, dni: t.dni }, cele()), day = t.dni[d], zm = [], uw = [], akt = Object.keys(tryby || {}).filter(k => tryby[k] && TRYBY[k]);
  if (!akt.length) return { zm, uw };
  const ok = (dish, slot) => akt.every(k => TRYBY[k].ok(dish, slot, o || {}));
  for (const { g, odgrzewane } of w.dni[d].sloty) {
    if (odgrzewane || t.zuz[kluczZ(d, g.slot, start)]) continue;       // odgrzewane z wczoraj albo już zjedzone: nic do zmiany
    if (day.blok && day.blok[g.slot]) { if (!akt.every(k => TRYBY[k].ok(g.dish, g.slot, o || {}))) uw.push(`${nazwaSlotu(g.slot)}: zablokowane, więc zostaje bez zmian.`); continue; }
    if (g.slot === 'ob' && day.ob2) { if (!ok(g.dish, g.slot)) uw.push('Obiad na dwa dni zostawiam bez zmian (garnek jest na dwa dni).'); continue; }
    if (ok(g.dish, g.slot)) continue;
    const kto = osobySlotu(g.slot), pula = puleDlaSlotu(day, g.slot);
    let kand = pula.filter(x => x.id !== g.dish.id && !ukryte(x.id) && dopuszcza(x, kto) && ok(x, g.slot) && (g.slot !== 'm13on' || !x.tylko_wybor));
    const tenSam = kand.filter(x => x.typ === g.dish.typ); if (tenSam.length) kand = tenSam;
    if (!kand.length) { uw.push(`${nazwaSlotu(g.slot)}: w bazie nie ma dania spełniającego te warunki.`); continue; }
    const dens = x => x.razem.bialko / x.razem.kcal, d0 = dens(g.dish);
    kand.sort((a, b) => Math.abs(dens(a) - d0) - Math.abs(dens(b) - d0));
    zm.push({ slot: g.slot, stary: g.dish, nowy: los(kand.slice(0, 3)), ratio: g.P / g.K });
  }
  return { zm, uw };
}
const DNI_PREF = [['poniedzia', 0], ['wtor', 1], ['srod', 2], ['czwart', 3], ['piat', 4], ['sobot', 5], ['niedziel', 6]], DNI_EX = { pon: 0, wt: 1, sr: 2, czw: 3, pt: 4, sob: 5, nd: 6, niedz: 6 };
function rozumiemTekst(txt) {
  const t = znorm(txt), dzis = isoDzis(), tyg = tygodnieZapisane();
  const wszystkie = tyg.flatMap(w => [0, 1, 2, 3, 4, 5, 6].map(d => ({ start: w.start, d, iso: dodajDni(w.start, d) })));
  const poIso = iso => wszystkie.find(x => x.iso === iso) || null;
  const nastepny = idx => wszystkie.filter(x => x.d === idx && x.iso >= dzis).sort((a, b) => a.iso.localeCompare(b.iso))[0] || null;
  const akcje = [];
  let poprz = [];
  for (const kl of t.split(/[,;.]+| a /)) {
    const sl = kl.split(/[^a-z0-9]+/).filter(Boolean), cele_ = new Map(), dodaj = x => { if (x) cele_.set(x.iso, x); };
    sl.forEach(wd => {
      if (DNI_EX[wd] !== undefined) dodaj(nastepny(DNI_EX[wd]));
      else for (const [pr, i] of DNI_PREF) if (wd.startsWith(pr)) dodaj(nastepny(i));
      if (wd === 'dzis' || wd === 'dzisiaj') dodaj(poIso(dzis));
      if (wd === 'jutro') dodaj(poIso(dodajDni(dzis, 1)));
      if (wd === 'pojutrze') dodaj(poIso(dodajDni(dzis, 2)));
    });
    if (/weekend/.test(kl)) { dodaj(nastepny(5)); dodaj(nastepny(6)); }
    if (/caly tydzien|kazdy dzien|codziennie/.test(kl)) wszystkie.filter(x => x.iso >= dzis && x.iso <= dodajDni(dzis, 6)).forEach(dodaj);
    if (/w tygodniu|robocze|dni robocze/.test(kl)) wszystkie.filter(x => x.iso >= dzis && x.iso <= dodajDni(dzis, 6) && x.d <= 4).forEach(dodaj);
    const tr = {}, o = {};
    if (/szybk|malo czasu|nie mam czasu|spiesz/.test(kl)) { tr.szybko = true; const m = kl.match(/do ([0-9]+) min/); if (m) o.min = +m[1]; }
    if (/bez gotowania|na zimno|nie chce gotowac|nie gotuj|bez kuchni/.test(kl)) tr.zimno = true;
    if (/lekk/.test(kl)) tr.lekko = true;
    if (/wegetarian|bez miesa|bezmies/.test(kl)) { tr.bezMiesa = true; if (/wegetarian|bez ryb/.test(kl)) tr.bezRyb = true; }
    let nb = null;
    if (/wyjezdz|wyjazd|nie ma nas|nas nie ma|nie bedzie nas/.test(kl)) nb = { ona: true, on: true };
    else if (/bez niego|nie ma go|jego nie ma|on nie je/.test(kl)) nb = { ona: false, on: true };
    else if (/bez niej|nie ma jej|jej nie ma|ona nie je/.test(kl)) nb = { ona: true, on: false };
    let go = null; const mg = kl.match(/([0-9]+) *(osob|gosc)|gosc[a-z]* *([0-9]+)/);
    if (mg) go = +(mg[1] || mg[3]); else if (/gosc/.test(kl)) go = 2;
    const cos = Object.keys(tr).length || nb || go != null;
    if (!cos) { if (cele_.size) poprz = [...cele_.values()]; continue; }
    let cel = [...cele_.values()]; if (!cel.length) cel = poprz.length ? poprz : [poIso(dzis)].filter(Boolean);
    if (cele_.size) poprz = cel;
    cel.forEach(c => akcje.push({ start: c.start, d: c.d, iso: c.iso, tryby: tr, min: o.min, goscie: go, nb }));
  }
  return akcje;
}
function oknoDopasuj(akcje) {
  if (!akcje.length) { pokazToast('Nie rozumiem. Spróbuj np.: „wtorek lekki, piątek bez mięsa”'); return; }
  const prop = akcje.map(a => Object.assign({}, a, dopasujDzien(a.start, a.d, a.tryby, a)));
  window._dop = prop;
  const ile = sum(prop, a => a.zm.length), zmienia = prop.some(a => a.zm.length || a.nb || a.goscie != null);
  const kart = prop.map(a => {
    const et = Object.keys(a.tryby).filter(k => TRYBY[k]).map(k => TRYBY[k].et + (k === 'szybko' && a.min ? ` do ${a.min} min` : '')).concat(a.nb ? [a.nb.ona && a.nb.on ? 'Wyjazd (nikogo nie ma)' : a.nb.on ? 'Bez niego' : 'Bez niej'] : []).concat(a.goscie != null ? [`${a.goscie} ${mn(a.goscie, 'gość', 'gości', 'gości')} na obiad`] : []);
    return `<div class="karta dop-kart"><div class="dop-gora"><b>${DNI[a.d]} ${krotkaData(a.iso)}</b></div><div class="chips">${et.map(x => `<span class="chip akt stat">${esc(x)}</span>`).join('')}</div>
      ${a.zm.map(z => `<div class="dop-zm"><small>${esc(nazwaSlotu(z.slot))}</small><span>${esc(z.stary.nazwa)}${minDania(z.stary) ? ` <em>${minDania(z.stary)} min</em>` : ''}</span><span class="dop-str">→</span><b>${esc(z.nowy.nazwa)}${minDania(z.nowy) ? ` <em>${minDania(z.nowy)} min</em>` : ''}</b></div>`).join('')}
      ${a.uw.map(u => `<p class="mute dop-uw">${esc(u)}</p>`).join('')}
      ${!a.zm.length && !a.uw.length && Object.keys(a.tryby).length ? '<p class="mute dop-uw">Ten dzień już pasuje, nic nie trzeba zmieniać.</p>' : ''}</div>`;
  }).join('');
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Dopasowanie planu</h2><button class="btn maly" data-zamknij>Anuluj</button></div>
    <p class="mute">Kalorie i białko zostają takie same, zmieniają się tylko dania. „Szybko”: śniadania i drugie śniadania do 15 min, obiad do 30 min.</p>${kart}
    <button class="btn glowny szeroki" data-dop-ok="1" ${zmienia ? '' : 'disabled'}>${ile ? `Zastosuj (${ile} ${mn(ile, 'zmiana', 'zmiany', 'zmian')})` : 'Zastosuj'}</button>`;
  $('#modal').hidden = false;
}
function zastosujDopasowanie() {
  const prop = window._dop || []; if (!prop.length) return;
  const sn = snapStanu();
  const orig = plan.start, wg = {}; let n = 0;
  prop.forEach(a => { (wg[a.start] = wg[a.start] || []).push(a); });
  for (const [start, lista] of Object.entries(wg)) {
    if (plan.start !== start) { if (inny && inny.start === start) przelaczTydzien(); else continue; }
    for (const a of lista) {
      const day = plan.dni[a.d];
      if (a.nb) { day.nb = a.nb; Z([[['dni', a.d, 'nb'], day.nb]]); }
      if (a.goscie != null) { day.gosc = Math.max(0, Math.min(12, a.goscie)); Z([[['dni', a.d, 'gosc'], day.gosc]]); }
      for (const z of a.zm) { ustawDanie(a.d, z.slot, z.nowy.id, z.ratio); n++; }
    }
    LS.set('plan', plan);
  }
  if (plan.start !== orig && inny && inny.start === orig) przelaczTydzien();
  window._dop = null; zamknijOkno(); otwartyDzien = null; rysuj();
  toastCofnij(n ? `Zmieniono ${n} ${mn(n, 'posiłek', 'posiłki', 'posiłków')}` : 'Zapisano ustawienia dnia', sn);
}
function oknoOpisz() {
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Opisz tydzień</h2><button class="btn maly" data-zamknij>Zamknij</button></div>${kartaOpisTygodnia(true)}`;
  $('#modal').hidden = false; setTimeout(() => { const i = $('#dop-tekst'); if (i) i.focus(); }, 120);
}
let dopOtw = false;
function kartaOpisTygodnia(otwarta) {
  if (!dopOtw && !otwarta) return `<button class="kafel dop-zwin" data-dop-pokaz="1"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg></span><span class="kafel-tx"><b>Opisz tydzień</b><small>np. „wtorek lekki, piątek bez mięsa, sobota goście”</small></span><span class="kafel-str">›</span></button>`;
  const ex = ['wtorek lekki', 'piątek bez mięsa', 'sobota goście 4 osoby', 'środa nie mam czasu'];
  return `<div class="karta dop-karta"><b>Opisz tydzień</b><p class="mute" style="margin:4px 0 10px">Napisz po swojemu, a dopasuję dania (kalorie zostają).</p>
    <div class="lod-rzad"><input id="dop-tekst" type="text" autocomplete="off" placeholder="np. wtorek lekki, piątek bez mięsa"><button class="btn glowny maly" data-dop-tekst="1">Dopasuj</button></div>
    <div class="chips" style="margin-top:10px">${ex.map(x => `<button class="chip" data-dop-przyklad="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
}
// ---------- świeżość produktów w lodówce ----------
// Orientacyjna trwałość świeżych produktów (dni od zakupu). Mrożonki i zapasy się nie psują, więc ich nie liczę.
const TRWALOSC = [[/kurczak|indyk|mielon|wolowin|wieprz|losos|dorsz|ryb|cwiartki|polendwic/, 3], [/szynk|kielbas|wedzon/, 6], [/mleko|jogurt|skyr|smietan|twarog|serek|maslo/, 7], [/(^| )ser |feta|parmezan|mozzarella/, 14], [/jaj/, 21],
  [/salat|szpinak|rukol|natk|szczypior|koper/, 4], [/pieczark/, 5], [/pomidor|ogork|papryk|cukini|brokul|kalafior|awokado|rzodkiew/, 6], [/chleb|bulk|tortill|bagiet|pieczywo/, 4], [/banan|jablk|owoc|maliny|truskaw/, 6]];
function swiezosc(prod) {
  const info = DB.produkty.get(prod); if (!info || info.kat !== 'świeże' || !lodData[prod] || !lodowka[prod] || sum(Object.values(lodowka[prod]), v => v) < 0.5) return null;
  const n = znorm(prod), dni = (TRWALOSC.find(([re]) => re.test(n)) || [0, 5])[1], wiek = Math.round((new Date(isoDzis() + 'T12:00:00') - new Date(lodData[prod] + 'T12:00:00')) / 864e5), zostalo = dni - wiek;
  return { dni, wiek, zostalo, pilne: zostalo <= 1, po: zostalo < 0 };
}
const swiezoscTxt = f => f.po ? `po terminie o ${-f.zostalo} ${mn(-f.zostalo, 'dzień', 'dni', 'dni')}` : f.zostalo === 0 ? 'zużyj dziś' : f.zostalo === 1 ? 'zużyj do jutra' : `jeszcze ok. ${f.zostalo} ${mn(f.zostalo, 'dzień', 'dni', 'dni')}`;
function doZuzycia() { return Object.keys(lodowka).map(pr => ({ pr, f: swiezosc(pr) })).filter(x => x.f && x.f.pilne).sort((a, b) => a.f.zostalo - b.f.zostalo); }
// ---------- wykresy trendów ----------
function wykresSlupki(wart, et, kolor, fmt) {
  const w = 300, h = 86, n = wart.length, mx = Math.max(...wart, 1), sz = Math.min(34, (w - 10) / n - 8);
  return `<svg viewBox="0 0 ${w} ${h + 22}" class="wykres" role="img" aria-label="Wykres słupkowy">${wart.map((v, i) => { const x = 6 + i * ((w - 12) / n) + ((w - 12) / n - sz) / 2, bh = Math.max(2, v / mx * h); return `<rect x="${x.toFixed(1)}" y="${(h - bh + 4).toFixed(1)}" width="${sz.toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="${kolor}" opacity="${i === n - 1 ? 1 : .55}"/><text x="${(x + sz / 2).toFixed(1)}" y="${h + 18}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">${esc(et[i])}</text><text x="${(x + sz / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">${esc(fmt(v))}</text>`; }).join('')}</svg>`;
}
function wykresLinie(serie, et, fmt) {
  const w = 300, h = 86, n = et.length, wsz = serie.flatMap(x => x.w.filter(v => v != null)), mn_ = Math.min(...wsz, 90), mx_ = Math.max(...wsz, 110), px = i => 14 + i * ((w - 28) / Math.max(1, n - 1)), py = v => 6 + (1 - (v - mn_) / ((mx_ - mn_) || 1)) * h;
  return `<svg viewBox="0 0 ${w} ${h + 22}" class="wykres" role="img" aria-label="Wykres liniowy"><line x1="8" x2="${w - 8}" y1="${py(100).toFixed(1)}" y2="${py(100).toFixed(1)}" stroke="currentColor" opacity=".25" stroke-dasharray="3 4"/><text x="${w - 8}" y="${(py(100) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="currentColor" opacity=".6">cel</text>${serie.map(x => { const pts = x.w.map((v, i) => v == null ? null : [px(i), py(v)]).filter(Boolean); return pts.length ? `<polyline points="${pts.map(q => q.map(z => z.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${x.kolor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${pts.map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.2" fill="${x.kolor}"/>`).join('')}` : ''; }).join('')}${et.map((e, i) => `<text x="${px(i).toFixed(1)}" y="${h + 18}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">${esc(e)}</text>`).join('')}</svg>`;
}
function kartaTrendow(lista) {
  const dane = lista.slice(-8).map(x => ({ et: (d => `${new Date(d + 'T12:00:00').getDate()}.${String(new Date(d + 'T12:00:00').getMonth() + 1).padStart(2, '0')}`)(x.start), o: x.o || zbierzTydzien(x.t) })).filter(x => x.o.posilkow);
  if (dane.length < 2) return '';
  const et = dane.map(x => x.et), proc = dane.map(x => Math.round(x.o.zjedzone / x.o.posilkow * 100)), kc = p => dane.map(x => x.o.kcal[p] != null && x.o.cel[p] ? Math.round(x.o.kcal[p] / x.o.cel[p] * 100) : null), wyd = dane.map(x => x.o.wydatki || 0);
  return `<h2>Trendy</h2><div class="karta"><b>Zjedzone posiłki (% planu)</b>${wykresSlupki(proc, et, 'var(--zielony2)', v => v + '%')}</div>
    <div class="karta"><b>Kalorie względem celu (%)</b><div class="wykres-leg"><span class="ona">ONA</span><span class="on">ON</span></div>${wykresLinie([{ w: kc('ona'), kolor: 'var(--ona)' }, { w: kc('on'), kolor: 'var(--on)' }], et, v => v + '%')}</div>
    ${wyd.some(v => v > 0) ? `<div class="karta"><b>Wydatki z paragonów (zł)</b>${wykresSlupki(wyd, et, 'var(--on)', v => Math.round(v))}</div>` : ''}`;
}
// Słupki dzień po dniu: wysokość = zjedzone, kreska = cel dnia, kolor = czy w celu. klucz: 'kcal' albo 'b' (białko).
function wykresTydzien(o, p, klucz) {
  const ck = klucz === 'kcal' ? 'cel' : 'bc', dane = o.dni.map(x => ({ v: x[klucz][p], c: x[ck][p] })), ma = dane.filter(x => x.v != null && x.c);
  if (!ma.length) return '';
  const w = 300, h = 92, n = 7, krok = (w - 12) / n, sz = Math.min(26, krok - 8), mx = Math.max(...ma.map(x => Math.max(x.v, x.c * 1.15)), 1), y = v => h - v / mx * h + 14;
  const kol = r => klucz === 'kcal' ? (r > 1.1 ? 'var(--ostrz)' : r < 0.85 ? 'var(--on)' : 'var(--zielony2)') : (r < 0.85 ? 'var(--on)' : 'var(--zielony2)');
  return `<svg viewBox="0 0 ${w} ${h + 34}" class="wykres wykres-dni" role="img" aria-label="${klucz === 'kcal' ? 'Kalorie' : 'Białko'} dzień po dniu">${dane.map((x, i) => {
    const x0 = 6 + i * krok + (krok - sz) / 2, et = `<text x="${(x0 + sz / 2).toFixed(1)}" y="${h + 30}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">${esc(DNI_KR[i])}</text>`;
    if (x.v == null || !x.c) return `<rect x="${x0.toFixed(1)}" y="${h + 12}" width="${sz.toFixed(1)}" height="2.5" rx="1.2" fill="currentColor" opacity=".18"/>${et}`;
    const r = x.v / x.c, top = y(x.v), bh = Math.max(3, h + 14 - top);
    return `<rect class="sl" style="--i:${i}" x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${sz.toFixed(1)}" height="${bh.toFixed(1)}" rx="6" fill="${kol(r)}"><title>${DNI_KR[i]}: ${x.v} / ${x.c} ${klucz === 'kcal' ? 'kcal' : 'g'}</title></rect><line x1="${(x0 - 4).toFixed(1)}" x2="${(x0 + sz + 4).toFixed(1)}" y1="${y(x.c).toFixed(1)}" y2="${y(x.c).toFixed(1)}" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2.5" opacity=".55"/><text x="${(x0 + sz / 2).toFixed(1)}" y="${(top - 3.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">${Math.round(r * 100)}%</text>${et}`;
  }).join('')}</svg>`;
}
function kartyDni(o) {
  if (!o.dni || !o.dni.some(x => x.z > 0 || OS.some(p => x.kcal[p] != null))) return '';
  const pas = `<div class="karta ps-dni"><b>Posiłki dzień po dniu</b><div class="ps-kolumny">${o.dni.map((x, d) => `<div class="ps-dz ${x.n && x.z === x.n ? 'pelny' : ''}"><div class="ps-kr">${Array.from({ length: x.n }, (_, k) => `<i class="${k < x.z ? 'zj' : ''}" style="--k:${k}"></i>`).join('')}</div><span class="ps-dz-et">${DNI_KR[d]}</span><small>${x.z}/${x.n}</small></div>`).join('')}</div></div>`;
  const osoby = OS.map(p => { const k = wykresTydzien(o, p, 'kcal'), b = wykresTydzien(o, p, 'b'); return k ? `<div class="karta ps-wyk ${p}"><div class="ps-wyk-gora"><b>${ETY[p]}</b><span class="wykres-leg2"><i class="zg"></i>w celu <i class="am"></i>ponad <i class="bl"></i>poniżej <i class="kr"></i>cel dnia</span></div><small class="mute">Kalorie dzień po dniu</small>${k}${b ? `<small class="mute">Białko dzień po dniu</small>${b}` : ''}</div>` : ''; }).join('');
  return `<h2>Dzień po dniu</h2>${pas}${osoby}`;
}
// ---------- podsumowanie tygodnia ----------
// Co się faktycznie stało w tygodniu: ile posiłków zjedzonych, średnio kcal i białka (tylko z dni z odhaczonym jedzeniem), zmiana wagi, wydatki z paragonów, ulubione danie.
function zbierzTydzien(t) {
  const c = cele(), w = oblicz({ start: t.start, dni: t.dni }, c), zj = (d, g) => !!t.zuz[kluczZ(d, g.slot, t.start)];
  const koniec = dodajDni(t.start, 6), o = { start: t.start, posilkow: 0, zjedzone: 0, dniZ: 0, kcal: {}, b: {}, cel: {}, bCel: {}, waga: {}, wydatki: 0, nPar: 0, ulub: null };
  OS.forEach(p => { o.kcal[p] = []; o.b[p] = []; o.cel[p] = []; o.bCel[p] = []; });
  o.dni = w.dni.map(x => ({ z: 0, n: x.sloty.length, kcal: {}, b: {}, cel: {}, bc: {} }));
  w.dni.forEach((x, d) => {
    const jedz = x.sloty.filter(({ g }) => zj(d, g));
    o.posilkow += x.sloty.length; o.zjedzone += jedz.length; o.dni[d].z = jedz.length;
    const pozaD = OS.some(p => pozaKcal(t.dni[d], p) > 0);
    if (!jedz.length && !pozaD) return; o.dniZ++;
    for (const p of OS) {
      if (nieob(t.dni[d], p)) continue;
      const dos = g => (g.dosypka && p === 'on' ? g.dosypka : { kcal: 0, b: 0 });
      const kv = sum(jedz, ({ g }) => sum(g.porcje.filter(q => q.d === d && q.p === p), q => q.kcal + dos(g).kcal)) + pozaKcal(t.dni[d], p), bv = sum(jedz, ({ g }) => sum(g.porcje.filter(q => q.d === d && q.p === p), q => q.b + dos(g).b)), bz = bazaDnia({ start: t.start, dni: t.dni }, cele(), d, p), cv = bz ? bz.kcal : x[p].kcal, bcv = bz ? bz.b : x[p].b;
      o.kcal[p].push(kv); o.b[p].push(bv); o.cel[p].push(cv); o.bCel[p].push(bcv);
      Object.assign(o.dni[d], { kcal: Object.assign(o.dni[d].kcal, { [p]: Math.round(kv) }), b: Object.assign(o.dni[d].b, { [p]: Math.round(bv) }), cel: Object.assign(o.dni[d].cel, { [p]: Math.round(cv) }), bc: Object.assign(o.dni[d].bc, { [p]: Math.round(bcv) }) });
    }
  });
  const sr = a => a.length ? sum(a, v => v) / a.length : null;
  for (const p of OS) {
    o.kcal[p] = sr(o.kcal[p]); o.b[p] = sr(o.b[p]); o.cel[p] = sr(o.cel[p]); o.bCel[p] = sr(o.bCel[p]);
    const e = Object.entries(waga[p] || {}).filter(([d]) => d >= dodajDni(t.start, -3) && d <= dodajDni(koniec, 3)).sort();
    o.waga[p] = e.length >= 2 ? Math.round((e[e.length - 1][1] - e[0][1]) * 10) / 10 : null;
  }
  const par = paragony.filter(x => x.data >= t.start && x.data <= koniec); o.nPar = par.length; o.wydatki = Math.round(sum(par, x => x.suma) * 100) / 100;
  const lub = {}; for (const [id, v] of Object.entries(smaki)) if (OS.some(p => v[p] && v[p].v === 2 && v[p].t && String(v[p].t).slice(0, 10) >= t.start && String(v[p].t).slice(0, 10) <= koniec)) lub[id] = 1;
  const id0 = Object.keys(lub)[0]; if (id0 && DB.dania.has(id0)) o.ulub = DB.dania.get(id0).nazwa;
  return o;
}
function zapiszHistorie() {
  if (!plan || !DB.dania.size) return;
  let zm = false;
  for (const t of tygodnieZapisane()) {
    if (dodajDni(t.start, 6) >= isoDzis() || historia.some(h => h.start === t.start)) continue;
    try { const o = zbierzTydzien(t); if (o.zjedzone > 0) { historia.push(o); zm = true; } } catch (e) { /* tydzień z nieznanym daniem */ }
  }
  if (zm) { historia = historia.sort((a, b) => a.start.localeCompare(b.start)).slice(-12); LS.set('historia', historia); Z([[['historia'], historia]]); }
}
let podsumStart = '';
function widokPodsumowanie() {
  const biez = tygodnieZapisane().find(t => isoDzis() >= t.start && isoDzis() <= dodajDni(t.start, 6));
  const lista = [...historia.map(h => ({ start: h.start, o: h })), ...(biez ? [{ start: biez.start, o: null, t: biez }] : [])].sort((a, b) => a.start.localeCompare(b.start));
  if (!lista.length) { $('#view').innerHTML = `<h1>Podsumowanie</h1><div class="pusty"><b>Jeszcze nie ma tygodnia do podsumowania</b><span>Zaznaczaj „zjedzone” przy posiłkach, a tu pojawi się, jak Wam poszło.</span></div>`; return; }
  const wyb = lista.find(x => x.start === podsumStart) || lista[lista.length - 1]; podsumStart = wyb.start;
  const o = wyb.o || zbierzTydzien(wyb.t), live = !wyb.o, proc = o.posilkow ? Math.round(o.zjedzone / o.posilkow * 100) : 0;
  const zl2 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const dzienN = iso => `${new Date(iso + 'T12:00:00').getDate()}.${String(new Date(iso + 'T12:00:00').getMonth() + 1).padStart(2, '0')}`;
  const ocena = proc >= 90 ? 'Świetny tydzień — plan prawie w całości dowieziony.' : proc >= 70 ? 'Dobry tydzień. Większość posiłków zgodnie z planem.' : proc >= 40 ? 'Wyszło połowicznie. Warto sprawdzić, które posiłki najczęściej wypadają, i je zamienić.' : 'Mało odhaczonych posiłków. Jeśli jecie według planu, zaznaczajcie „zjedzone”, a podsumowanie będzie dokładne.';
  const os = OS.filter(p => o.kcal[p] != null).map(p => {
    const k = o.kcal[p], cel = o.cel[p], b = o.b[p], bc = o.bCel[p], pr = cel ? Math.min(130, Math.round(k / cel * 100)) : 0, d = cel ? Math.round((k - cel) / cel * 100) : 0;
    return `<div class="ps-os ${p}"><b>${ETY[p]}</b>
      <div class="ps-wiersz"><span>Kalorie dziennie</span><span><b>${r0(k)}</b> / ${r0(cel)} kcal</span></div><div class="pasek"><i style="width:${Math.min(100, pr)}%"></i></div><small>${Math.abs(d) <= 5 ? 'w celu' : d > 0 ? `${d}% ponad cel` : `${-d}% poniżej celu`}</small>
      <div class="ps-wiersz"><span>Białko dziennie</span><span><b>${r0(b)}</b> / ${r0(bc)} g</span></div>
      <div class="ps-wiersz"><span>Waga w tygodniu</span><span><b>${o.waga[p] == null ? '—' : (o.waga[p] > 0 ? '+' : '') + zl2(o.waga[p]) + ' kg'}</b></span></div></div>`;
  }).join('');
  $('#view').innerHTML = `<h1>Podsumowanie</h1>
    ${lista.length > 1 ? `<div class="chips ps-tyg">${lista.map(x => `<button class="chip ${x.start === wyb.start ? 'akt' : ''}" data-podsum="${x.start}">${dzienN(x.start)}–${dzienN(dodajDni(x.start, 6))}${!x.o ? ' · teraz' : ''}</button>`).join('')}</div>` : ''}
    <div class="hero ps-hero"><span class="hero-et">${live ? 'Ten tydzień, jak dotąd' : `Tydzień ${dzienN(o.start)}–${dzienN(dodajDni(o.start, 6))}`}</span>
      <div class="ps-gl"><div class="kolo ps-kolo" style="--d:${(Math.min(100, proc) * 1.1938).toFixed(1)}"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="t" r="19" cx="22" cy="22"/><circle class="w" r="19" cx="22" cy="22"/></svg><span><span data-licz="${proc}">${proc}</span><small>%</small></span></div>
      <div><b class="ps-duze">${o.zjedzone} z ${o.posilkow}</b><small>posiłków zjedzonych</small></div></div>
      <p class="ps-ocena">${esc(ocena)}</p></div>
    ${os ? `<div class="ps-osoby">${os}</div>` : ''}
    ${kartyDni(o)}
    <div class="lod-kafle"><div><b>${o.nPar ? zl(o.wydatki).replace(' zł', '') : '—'}</b><small>${o.nPar ? `zł z ${o.nPar} ${mn(o.nPar, 'paragonu', 'paragonów', 'paragonów')}` : 'brak paragonów'}</small></div><div><b>${o.dniZ}</b><small>${mn(o.dniZ, 'dzień', 'dni', 'dni')} z odhaczonym jedzeniem</small></div></div>
    ${kartaTrendow(lista)}
    ${o.ulub ? `<div class="karta"><b>Najlepiej smakowało</b><p class="mute" style="margin:4px 0 0">${esc(o.ulub)}</p></div>` : ''}
    <p class="mute" style="margin-top:10px">Średnie liczone tylko z dni, w których zaznaczono jedzenie. Podsumowania minionych tygodni zapisują się same.</p>`;
  setTimeout(animujLiczby, 150);
}
// ---------- ekran meal prep ----------
function okazjePrepu() {   // oszczędność dla każdego z najbliższych 7 dni
  return Array.from({ length: 7 }, (_, i) => { const od = dodajDni(isoDzis(), i), pl = planPrepu(od, prepH); return { od, min: pl.oszczMin, n: pl.komp.length }; });
}
// Karta na ekranie Dziś: czy dzisiaj opłaca się meal prep, co już leży w pojemnikach (zapas) i kiedy najlepszy dzień.
function zapasPrepu(dzis) {
  const zapas = [];
  for (const se of sesje) if (se.zrobione) for (const k of se.komp) {
    const reszta = k.uzycia.filter(u => u.iso >= dzis && !(u.wk === plan.start && zuzyte[kluczZ(u.d, u.slot)]));
    if (!reszta.length) continue;
    const dzisiaj = reszta.filter(u => u.iso === dzis), ost = reszta.reduce((a, u) => u.iso > a ? u.iso : a, dzis);
    zapas.push({ nazwa: PREP[k.prod] ? PREP[k.prod].nazwa : k.nazwa, u: k.u, dzisiaj: sum(dzisiaj, u => u.ugot), ost, n: reszta.length, dni: PREP[k.prod] ? PREP[k.prod].dni : 3 });
  }
  const zapasHtml = zapas.length ? `<div class="prep-zapas"><b>Z zapasu w lodówce</b>${zapas.map(z => `<div><span>${esc(z.nazwa)}</span><span class="mute">${z.dzisiaj ? `dziś weź ${z.dzisiaj} ${z.u === 'szt.' ? 'szt.' : 'g'} · ` : ''}starczy do ${dzienKrotki(z.ost)}${z.ost > dodajDni(dzis, z.dni) ? ' (sprawdź świeżość)' : ''}</span></div>`).join('')}</div>` : '';
  return { zapas, html: zapasHtml };
}
let dalejWiecej = false, dopDzien = false;
// Osobna, wyraźna sekcja: co przygotować wieczorem na jutro (z odhaczaniem; po 17:00 mocniej podświetlona).
function kartaWieczor(wi, dzis) {
  window._wiecz = wi;
  if (!wi.length) return '';
  const ok = (LS.get('wieczOk', {}) || {})[dzis] || [], wieczor = new Date().getHours() >= 17, zrob = wi.filter(x => !ok.includes(x.klucz)).length;
  return `<h2>Wieczorem na jutro</h2><div class="karta wiecz ${wieczor ? 'teraz' : ''} ${zrob ? '' : 'gotowe'}"><div class="wiecz-gora"><span class="wiecz-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg></span><div><b>${zrob ? (wieczor ? 'Zrób to dziś wieczorem' : 'Przygotuj wieczorem') : 'Wszystko gotowe na jutro'}</b><small>${zrob ? `${zrob} ${mn(zrob, 'rzecz', 'rzeczy', 'rzeczy')} do zrobienia, żeby jutro poszło szybciej` : 'Dobra robota, jutro będzie łatwiej'}</small></div></div>
    ${wi.map((it, i) => { const z = ok.includes(it.klucz); return `<div class="wiecz-w ${z ? 'zrobione' : ''}"><button class="wiecz-chk" data-wiecz="${i}" role="checkbox" aria-checked="${z}" aria-label="Zrobione"><span class="wiecz-ptak"></span></button>
      <div class="wiecz-tx">${it.t === 'kroki' ? `<b>${esc(it.dish)}</b><ol class="wiecz-kroki">${it.kroki.map(k => `<li>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</li>`).join('')}</ol>
        <div class="wiecz-ak"><button class="btn maly" data-wiecz-przepis="${i}">Cały przepis</button><button class="btn maly" data-wiecz-got="${i}">Gotuj krok po kroku</button></div>` : `<span>${esc(it.tekst)}</span>`}</div></div>`; }).join('')}</div>`;
}
function kartaPrepDzis(dzis) {
  const ik = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM4 8h16M9 5h6"/></svg>';
  const ok = okazjePrepu(), dz = ok[0], naj = ok.reduce((a, b) => b.min > a.min ? b : a, ok[0]);
  const zaplan = sesje.find(x => x.od === dzis && !x.zrobione);
  const { zapas, html: zapasHtml } = zapasPrepu(dzis);
  if (zaplan) return `<div class="karta prep-radar tak"><div class="prep-r-gora"><span class="prep-r-ik">${ik}</span><div><b>Dziś meal prep</b><small>zaplanowana sesja · ${zaplan.komp.map(k => esc(k.nazwa.toLowerCase())).join(', ')}</small></div></div><div class="rzad"><button class="btn glowny" data-prep-dzis="${esc(zaplan.id)}">Zacznij sesję</button><button class="btn" data-prep-otworz="${dzis}">Szczegóły</button></div>${zapasHtml}</div>`;
  if (dz.min >= 20) { const pl = planPrepu(dzis, prepH); return `<div class="karta prep-radar tak"><div class="prep-r-gora"><span class="prep-r-ik">${ik}</span><div><b>Dziś dobry dzień na meal prep</b><small>oszczędzisz ok. ${dz.min} min przy kuchni w następnych dniach</small></div></div><p class="mute" style="margin:8px 0 10px">Ugotuj raz: ${esc(pl.komp.map(c => c.nazwa.toLowerCase()).join(', '))}.</p><div class="rzad"><button class="btn glowny" data-prep-dzis="">Zacznij sesję</button><button class="btn" data-prep-otworz="${dzis}">Zobacz plan</button></div>${zapasHtml}</div>`; }
  if (zapas.length) return `<div class="karta prep-radar"><div class="prep-r-gora"><span class="prep-r-ik">${ik}</span><div><b>Masz jedzenie na zapas</b><small>dziś nie trzeba gotować tych składników</small></div></div>${zapasHtml}</div>`;
  return '';   // meal prep dziś niedostępny: karta się chowa (kafel „Meal prep” jest w Więcej)
}
function widokPrep() {
  const ok = okazjePrepu(), naj = ok.reduce((a, b) => b.min > a.min ? b : a, ok[0]);
  if (!prepOd || prepOd < isoDzis()) prepOd = naj.min > 0 ? naj.od : isoDzis();
  const pl = planPrepu(prepOd, prepH), sesjaZapisana = sesje.find(x => x.id === prepOd + '_' + prepH);
  let h = `<h1>Meal prep</h1>` + wskazowka('prep', 'Ugotuj raz, jedz kilka razy: apka znajduje w planie ryż, makaron, kaszę, ziemniaki i jajka gotowane osobno, liczy ile ugotować, jak podzielić do pojemników i dopilnuje, ile dni wytrzymają w lodówce.');
  h += `<h3>Kiedy gotujesz?</h3><div class="prep-dni">${ok.map(x => `<button class="prep-dz ${x.od === prepOd ? 'akt' : ''}" data-prep-dzien="${x.od}"><small>${dzienKrotki(x.od).split(' ')[0]}</small><b>${new Date(x.od + 'T12:00:00').getDate()}</b>${x.min > 0 ? `<em>−${x.min}′</em>` : '<em>&nbsp;</em>'}${x.od === naj.od && naj.min > 0 ? '<i class="prep-naj">najlepszy</i>' : ''}</button>`).join('')}</div>
    <p class="mute prep-info">Wybierz dzień gotowania. Każdy składnik ugotuję tylko na tyle dni, ile wytrzyma w lodówce: ryż 2 dni, kasze, makaron i ziemniaki 3, jajka 5. Resztę dni apka pominie albo oznaczy jako „ugotuj świeże”.</p>`;
  if (!pl.komp.length) {
    h += `<div class="karta pusta-karta"><b>W tym oknie nie ma czego gotować na zapas</b><p class="mute">${pl.pojedyncze.length ? 'Znalazłem ' + pl.pojedyncze.map(x => esc(x.nazwa)).join(', ') + ', ale tylko w jednym posiłku, więc gotuj na bieżąco.' : 'W planie na te dni nie ma dań z osobno gotowanym ryżem, makaronem, kaszą, ziemniakami ani jajkami na twardo.'} Spróbuj innego dnia albo dłuższego okna.</p></div>`;
  } else {
    h += `<div class="hero prep-hero"><span class="hero-et">${dzienKrotki(pl.od)}</span><div class="hero-dan"><div><b>Ugotuj raz: ${pl.komp.map(c => esc(c.nazwa.toLowerCase())).join(', ')}</b><small>${sum(pl.komp, c => c.uzycia.length)} posiłków z jednego gotowania</small></div></div>
      <div class="hero-liczby"><span>ok. ${pl.oszczMin} min mniej przy kuchni</span><span>${pl.oszczGar} ${pl.oszczGar === 1 ? 'garnek' : pl.oszczGar < 5 ? 'garnki' : 'garnków'} mniej</span><span>sesja ok. ${pl.czas} min</span></div>
      <div class="rzad"><button class="btn hero-btn" data-prep-start="1">Zacznij sesję</button><button class="btn hero-btn jasny" data-prep-zapisz="1">${sesjaZapisana ? 'Zapisane ✓' : 'Zapisz plan'}</button></div></div>`;
    h += pl.komp.map(c => {
      const cc = PREP[c.prod];
      return `<div class="karta prep-komp"><div class="prep-gora"><b>${esc(c.nazwa)}</b><span class="znaczek">${c.uzycia.length} ${c.uzycia.length < 5 ? 'porcje' : 'porcji'}</span></div>
        <p class="prep-suma">${c.u === 'szt.' ? `<b>${c.suchy} jaj</b> ugotuj na twardo` : `<b>${c.suchy} g</b> suchego → ok. <b>${c.ugot} g</b> ugotowanego`}${c.u !== 'szt.' && cc.woda ? ` · woda ${Math.round(c.suchy * cc.woda / 10) * 10} ml` : ''}</p>
        ${c.uzycia.map(x => `<div class="prep-uz"><span><b>${dzienKrotki(x.iso)}</b> · ${esc(nazwaSlotu(x.slot))}<br><span class="mute">${esc(x.dish)}</span></span><b>${x.ugot} ${c.u === 'szt.' ? 'szt.' : 'g'}</b></div>`).join('')}
        <p class="mute" style="margin:8px 0 0"><b>Przechowywanie:</b> ${esc(cc.przech)}</p><p class="mute" style="margin:4px 0 0"><b>Podgrzewanie:</b> ${esc(cc.podgrzej)}</p>
        ${c.poza.length ? `<p class="prep-poza">Poza limitem ${cc.dni} dni (${c.poza.map(x => dzienKrotki(x.iso)).join(', ')}): ugotuj świeże albo zrób drugą sesję.</p>` : ''}</div>`;
    }).join('');
    if (pl.pojedyncze.length) h += `<p class="mute">Tylko w jednym posiłku (gotuj na bieżąco): ${pl.pojedyncze.map(x => esc(x.nazwa)).join(', ')}.</p>`;
    h += `<h2>Kolejność w sesji</h2><div class="karta"><ol class="kroki">${pl.kroki.map(k => `<li>${esc(k)}</li>`).join('')}</ol><p class="mute" style="margin:6px 0 0">Orientacyjny czas: ${pl.czas} min. „Zacznij sesję” prowadzi krok po kroku z timerami.</p></div>`;
  }
  if (sesje.length) h += `<h2>Zapisane sesje</h2>${sesje.map(se => `<div class="karta prep-se"><div class="rzad-nag"><div><b>${dzienKrotki(se.od)}</b><br><span class="mute">${se.komp.map(k => esc(k.nazwa)).join(', ')} · ${se.h} dni</span></div><span class="chips"><button class="chip ${se.zrobione ? 'akt' : ''}" data-prep-zrobione="${esc(se.id)}">${se.zrobione ? 'Zrobione ✓' : 'Oznacz jako zrobione'}</button><button class="chip" data-prep-usun="${esc(se.id)}">✕</button></span></div></div>`).join('')}`;
  $('#view').innerHTML = h;
}

// Kto ile bierze: udział w daniu, kcal i białko każdej osoby (+ dosypka skyru i odżywki dla ON, nalewanie shake'a na wadze).
function podzialPorcji(g) {
  const dish = g.dish;
  const masa = dish.masa_g ? dish.masa_g * g.s : null;
  return g.porcje.map(q => {
    let t = `${r0(q.udzial * 100)}% całości`;
    if (masa) t = q.p === 'ona' ? `nalej do szklanki na wadze ${r0(masa * q.udzial / 5) * 5} g` : 'reszta kielicha';
    if (g.dosypka && q.p === 'on') t += ` + dosypka: odżywka ${fq(DB.dosypka.odzywka * g.dosypka.skala, 'g')} i skyr ${fq(DB.dosypka.skyr * g.dosypka.skala, 'g')}`;
    const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 };
    return `<div class="${q.p}"><b>${ETY[q.p]}${new Set(g.porcje.map(x => x.d)).size > 1 ? ' · ' + DNI_KR[q.d] : ''}</b>${t}<br>${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g białka</div>`;
  }).join('');
}
// ---------- tryb gotowania ----------
let got = null, timery = [], timeryInt = null, wakeLock = null, audioCtx = null, timerSeq = 0;
const TIMER_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)(?:\\s?[–-]\\s?(\\d+(?:[.,]\\d+)?))?\\s*(godz\\w*|min\\w*|sek\\w*|s)(?!${PL})`, 'gi');
function wykryjTimery(tekst) {
  const out = [], widziane = new Set();
  for (const m of tekst.matchAll(TIMER_RE)) {
    const v = parseFloat(m[1].replace(',', '.')), j = m[3].toLowerCase(), sek = Math.round(v * (/^g/.test(j) ? 3600 : /^m/.test(j) ? 60 : 1));
    if (!(sek >= 10 && sek <= 6 * 3600) || widziane.has(sek)) continue;
    widziane.add(sek); out.push({ et: m[0].trim(), sek });
  }
  return out.slice(0, 3);
}
const fmtCzas = sek => { sek = Math.max(0, Math.round(sek)); const h = Math.floor(sek / 3600), m = Math.floor(sek % 3600 / 60), x = sek % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function podswietl(t) { return esc(t).replace(new RegExp(`(\\d+(?:[.,]\\d+)?(?:\\s?[–-]\\s?\\d+)?\\s?(?:g|ml|kg|l|min|s|sek|°C|szt\\.?|krom${PL}*|łyż${PL}*)(?!${PL}))`, 'gi'), '<mark>$1</mark>'); }
function skladnikiKroku(g, tekst) {
  const t = znorm(tekst), slowa = new Set(t.split(/[^a-z0-9]+/).filter(Boolean)), out = [];
  for (const i of g.dish.skladniki) {
    if (!i.ilosc || !i.produkt) continue;
    const tok = znorm(i.produkt).split(/[^a-z0-9]+/).filter(x => x.length >= 4 && !['swieze', 'naturalny', 'pelnoziarnista', 'sloiku', 'puszka', 'odsaczona', 'konserwowa', 'sosie', 'wlasnym', 'mrozone', 'mrozona'].includes(x));
    if (tok.some(x => [...slowa].some(w => w.startsWith(x.slice(0, Math.min(5, x.length)))))) out.push(`${i.produkt} — ${fqS(i, i.ilosc * skala(g, i))}`);
  }
  return out.slice(0, 4);
}
async function blokujEkran() { try { if ('wakeLock' in navigator && got) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* nic */ } }
document.addEventListener('visibilitychange', () => { if (got && !document.hidden) { blokujEkran(); tykTimerow(); } });
// Dźwięk: element <audio> z wygenerowanym sygnałem (na iPhonie gra mimo przełącznika ciszy, w przeciwieństwie do WebAudio) + WebAudio jako zapas.
let alarmAudio = null, alarmUrl = null, alarmOstatni = 0;
function alarmWav() {
  const sr = 22050, dl = Math.round(sr * 1.05), buf = new ArrayBuffer(44 + dl * 2), v = new DataView(buf), zapisz = (o, t) => { for (let k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); };
  zapisz(0, 'RIFF'); v.setUint32(4, 36 + dl * 2, true); zapisz(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); zapisz(36, 'data'); v.setUint32(40, dl * 2, true);
  for (let k = 0; k < dl; k++) { const t = k / sr, ph = t % 0.34, w = ph < 0.22 ? Math.min(1, ph / 0.01, (0.22 - ph) / 0.03) : 0; v.setInt16(44 + k * 2, Math.round(Math.sin(2 * Math.PI * 880 * t) * w * 0.7 * 32767), true); }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function odblokujAlarm() {   // wołane z kliknięcia: przeglądarka pozwala potem odtworzyć dźwięk bez gestu
  try {
    if (!alarmAudio) { alarmUrl = alarmUrl || alarmWav(); alarmAudio = new Audio(alarmUrl); alarmAudio.preload = 'auto'; }
    alarmAudio.muted = true; const pr = alarmAudio.play();
    const koniec = () => { try { alarmAudio.pause(); alarmAudio.currentTime = 0; alarmAudio.muted = false; } catch (e) { /* nic */ } };
    if (pr && pr.then) pr.then(koniec).catch(() => { try { alarmAudio.muted = false; } catch (e) { /* nic */ } }); else koniec();
  } catch (e) { /* nic */ }
}
function pikniecie() {
  alarmOstatni = Date.now();
  try { if (alarmAudio) { alarmAudio.muted = false; alarmAudio.currentTime = 0; const pr = alarmAudio.play(); if (pr && pr.catch) pr.catch(() => { /* nic */ }); } } catch (e) { /* nic */ }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.35, 0.7].forEach(dt => { const o = audioCtx.createOscillator(), gn = audioCtx.createGain(); o.type = 'sine'; o.frequency.value = 880; gn.gain.value = 0.25; o.connect(gn); gn.connect(audioCtx.destination); o.start(audioCtx.currentTime + dt); o.stop(audioCtx.currentTime + dt + 0.22); });
  } catch (e) { /* nic */ }
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* nic */ }
}
function startTimer(et, sek) {
  odblokujAlarm();
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* nic */ }
  timery.push({ id: ++timerSeq, et, ile: sek, koniec: Date.now() + sek * 1000, pauza: null, zrobiony: false });
  if (!timeryInt) timeryInt = setInterval(tykTimerow, 500);
  rysujGot();
}
function tykTimerow() {
  let zmiana = false;
  for (const t of timery) {
    if (t.zrobiony || t.pauza) continue;
    if (Date.now() >= t.koniec) { t.zrobiony = true; zmiana = true; pikniecie(); }
    else { const el = document.querySelector(`[data-tid="${t.id}"]`); if (el) el.textContent = fmtCzas((t.koniec - Date.now()) / 1000); }
  }
  if (zmiana) rysujGot();
  else if (timery.some(t => t.zrobiony) && Date.now() - alarmOstatni > 4000) pikniecie();
  if (!timery.length) { clearInterval(timeryInt); timeryInt = null; }
}
function otworzGotowanie(g, spont) {
  if (!g || !g.dish.kroki || !g.dish.kroki.length) return;
  got = { g, spont: !!spont, kroki: g.dish.kroki.map(k => krokPrzeliczony(g, k)), i: 0, odhacz: {}, skl: false, zjedzone: false };
  timery = []; $('#gotuj').hidden = false; document.body.classList.add('got-otwarte');
  blokujEkran(); rysujGot(); const m = $('#gotuj .got-main'); if (m) m.scrollTop = 0;
}
function zamknijGotowanie(bezPytania) {
  if (!bezPytania && timery.some(t => !t.zrobiony)) { pytaj('Timery jeszcze działają', 'Zamknąć tryb gotowania i je wyłączyć?', 'Zamknij i wyłącz').then(ok => { if (ok) zamknijGotowanie(true); }); return; }
  got = null; timery = []; clearInterval(timeryInt); timeryInt = null;
  try { wakeLock && wakeLock.release(); } catch (e) { /* nic */ }
  wakeLock = null; $('#gotuj').hidden = true; document.body.classList.remove('got-otwarte');
}
function gotIdz(n) { if (!got) return; got.i = Math.max(0, Math.min(got.kroki.length + 1, n)); rysujGot(); const m = $('#gotuj .got-main'); if (m) m.scrollTop = 0; }
function rysujGot() {
  if (!got) return;
  const { g, kroki, i } = got, N = kroki.length, dish = g.dish;
  const pasek = `<div class="got-postep">${Array.from({ length: N + 2 }, (_, k) => `<i class="${k < i ? 'zrob' : k === i ? 'akt' : ''}"></i>`).join('')}</div>`;
  const aktywne = timery.filter(t => !t.zrobiony).length;
  const tim = timery.length ? `<div class="got-timery">${navigator.vibrate ? '' : '<p class="got-vib mute">Ten telefon nie wibruje z przeglądarki (iPhone), więc timer przypomni dźwiękiem, a alarm powtarza się, dopóki nie klikniesz OK. Sprawdź, czy głośność jest włączona.</p>'}${timery.map(t => `<div class="got-t ${t.zrobiony ? 'koniec' : ''}"><span class="got-t-et">${esc(t.et)}</span><b data-tid="${t.id}">${t.zrobiony ? 'Czas minął!' : fmtCzas(t.pauza ? (t.koniec - t.pauza) / 1000 : (t.koniec - Date.now()) / 1000)}</b>${t.zrobiony ? `<button data-got-tx="${t.id}">OK</button>` : `<button data-got-tp="${t.id}" aria-label="${t.pauza ? 'Wznów' : 'Pauza'}">${t.pauza ? '▶' : '❚❚'}</button><button data-got-t1="${t.id}" aria-label="Dodaj minutę">+1′</button><button data-got-tx="${t.id}" aria-label="Usuń">✕</button>`}</div>`).join('')}</div>` : '';
  let tresc = '';
  if (i === 0) {
    const spr = przyprawyWiersze(dish);
    tresc = `<p class="got-et">Przed startem</p><h2 class="got-tyt">${esc(dish.nazwa)}</h2><p class="mute">${dish.czas ? 'Czas: ' + esc(dish.czas) + '. ' : ''}${dish.sprzet ? 'Sprzęt: ' + esc(dish.sprzet) + '. ' : ''}Ekran nie będzie się wygaszał podczas gotowania${'wakeLock' in navigator ? '' : ' (ta przeglądarka tego nie obsługuje — wyłącz automatyczną blokadę ekranu)'}.</p>
      <h3>Przygotuj składniki — ${opisGarnka(g)}</h3><div class="got-lista">${dish.skladniki.filter(x => x.ilosc || x.nazwa).map((x, k) => `<label class="got-sk ${got.odhacz[k] ? 'ok' : ''}"><input type="checkbox" data-got-odh="${k}" ${got.odhacz[k] ? 'checked' : ''}><span class="zk-ptak"></span><span class="got-sk-tx">${esc(x.nazwa)}${stala(x) ? '<small>woreczek z zamrażarki — rozmroź wcześniej</small>' : ''}</span><b>${x.ilosc ? fqS(x, x.ilosc * skala(g, x)) : ''}</b></label>`).join('')}${spr.length ? `<p class="mute" style="margin:10px 0 2px">Przyprawy: ${esc(spr.map(x => x.nazwa + (x.ilosc ? ' ' + x.ilosc : '')).join(', '))}</p>` : ''}</div>`;
  } else if (i <= N) {
    const t = kroki[i - 1], wiecz = /^WIECZOREM/i.test(t), tm = wykryjTimery(t), sk = skladnikiKroku(g, t), zs = got.prep ? null : krokZSesji(g, t);
    tresc = `<p class="got-et">Krok ${i} z ${N}${wiecz ? ' · przygotowanie wcześniej' : got.prep ? ' · meal prep' : ''}</p>${zs ? `<div class="got-sesja">${esc(zs)}: ten krok możesz pominąć.</div>` : ''}<p class="got-tekst">${podswietl(t.replace(/^WIECZOREM:\s*/i, ''))}</p>
      ${tm.length ? `<div class="got-tm">${tm.map(x => `<button class="btn" data-got-timer="${x.sek}|${esc(x.et)}">⏱ Timer ${esc(x.et)}</button>`).join('')}</div>` : ''}
      ${sk.length ? `<div class="got-sk-krok"><b>W tym kroku</b>${sk.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}`;
  } else if (got.prep) {
    tresc = `<div class="got-koniec"><div class="intro-ik"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2>Sesja gotowa!</h2><p class="mute">Pojemniki w lodówce. Podczas gotowania w tygodniu apka pokaże, ile ugotowanego składnika wziąć i które kroki pominąć.</p>${got.sesja && !got.sesja.zrobione ? `<button class="btn glowny szeroki" data-got-prep-ok="1">Zapisz jako zrobioną</button>` : ''}<button class="btn szeroki" data-got-zamknij style="margin-top:10px">Zamknij</button></div>`;
  } else {
    const dzien = dniGarnka(g).find(x => !zuzyte[kluczZ(x, g.slot)]), os = dzien !== undefined ? [...new Set(g.porcje.filter(q => q.d === dzien).map(q => q.p))] : [];
    tresc = `<div class="got-koniec"><div class="intro-ik"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2>Smacznego!</h2><p class="mute">${esc(dish.nazwa)}</p>
      <h3 class="got-podz-tyt">Podziel na porcje</h3><div class="podzial got-podzial">${podzialPorcji(g)}</div>
      ${dish.odgrzewanie ? `<p><b>Drugi dzień:</b> ${esc(dish.odgrzewanie)}</p>` : ''}
      ${got.spont ? `<button class="btn glowny szeroki" data-got-spont="1">Ugotowaliśmy — zdejmij z lodówki</button>` : (dzien !== undefined && !got.zjedzone ? `<button class="btn glowny szeroki" data-got-zjedz="${dzien}">Oznacz jako zjedzone (${DNI_KR[dzien]})</button>` : '')}
      ${os.length ? `<h3 style="margin-top:18px">Jak smakowało?</h3>${os.map(pp => `<div class="smak-w"><b class="${pp}">${ETY[pp]}</b><div class="seg mini">${[[2, 'Super'], [1, 'Może być'], [0, 'Nie']].map(([v, et]) => `<button data-smak="${esc(dish.id)}:${pp}:${v}" class="${smaki[dish.id] && smaki[dish.id][pp] && smaki[dish.id][pp].v === v ? 'akt' : ''}">${et}</button>`).join('')}</div></div>`).join('')}` : ''}
      <button class="btn szeroki" data-got-zamknij style="margin-top:18px">Zamknij</button></div>`;
  }
  $('#gotuj').innerHTML = `<div class="got-gora"><button class="got-x" data-got-zamknij aria-label="Zamknij tryb gotowania">✕</button><div class="got-nazwa">${esc(dish.nazwa)}</div><button class="got-skl" data-got-skl>Składniki</button></div>${pasek}${tim}
    <div class="got-main">${got.skl && i > 0 && i <= N ? `<div class="got-panel"><h3>Składniki — ${opisGarnka(g)}</h3>${dish.skladniki.filter(x => x.ilosc).map(x => `<div class="got-pw"><span>${esc(x.nazwa)}</span><b>${fqS(x, x.ilosc * skala(g, x))}</b></div>`).join('')}</div>` : ''}${tresc}</div>
    <div class="got-dol">${i > 0 ? `<button class="btn" data-got-idz="${i - 1}">‹ Wstecz</button>` : '<span></span>'}${i <= N ? `<button class="btn glowny" data-got-idz="${i + 1}">${i === 0 ? 'Zaczynamy' : i === N ? 'Gotowe, podział porcji' : 'Dalej'} ›</button>` : ''}</div>`;
  if (got._ostI !== i) { const kier = got._ostI === undefined ? 0 : (i > got._ostI ? 1 : -1); got._ostI = i; const m = $('#gotuj .got-main'); if (m && kier) m.dataset.kier = kier; if (m) m.scrollTop = 0; }
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'dop-tekst') oknoDopasuj(rozumiemTekst(e.target.value)); });
document.addEventListener('paste', e => { if (e.target && e.target.id === 'par-tekst' && e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) { e.preventDefault(); wczytajPlik(e.clipboardData.files[0]); return; } if (e.target && e.target.id === 'par-tekst') setTimeout(() => { const v = e.target.value; if (v && v.length > 40) wczytajParagon(v); }, 30); });
document.addEventListener('keydown', e => { if (!got) return; if (e.key === 'ArrowRight') gotIdz(got.i + 1); else if (e.key === 'ArrowLeft') gotIdz(got.i - 1); else if (e.key === 'Escape') zamknijGotowanie(); });
(function () {   // przesunięcie palcem: w lewo = dalej, w prawo = wstecz
  let x0 = null, y0 = null;
  document.addEventListener('touchstart', e => { if (!got || !e.target.closest('#gotuj .got-main')) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', e => { if (x0 === null || !got) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 45) gotIdz(got.i + (dx < 0 ? 1 : -1)); }, { passive: true });
})();
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
    <button class="btn szeroki" data-wlasne-nowe="1" style="margin:4px 0 8px">＋ Dodaj własne danie</button>
    <div id="lista-wyboru"></div>`;
  listaWyboru('');
  $('#modal').hidden = false;
}
// Grupy dań w wyborze: obiady i drugie dania wg mięsa (zupy, ryby, mielone, kurczak…), śniadania wg rodzaju, koktajle wg smaku.
const GRUPY_MIESO = ['Zupy', 'Z kurczakiem', 'Z mielonym', 'Z indykiem', 'Z wołowiną i wieprzowiną', 'Ryby', 'Z wędliną', 'Skyr i słodkie', 'Bez mięsa', 'Inne'];
const GRUPY_SN = ['Owsianki i kasze', 'Naleśniki, gofry i placki', 'Kanapki i tosty', 'Jajka', 'Skyr, jogurt i twaróg', 'Inne'];
const GRUPY_KOKT = ['Owocowe', 'Kakaowe i czekoladowe', 'Z masłem orzechowym', 'Inne'];
function grupaDania(x, slot) {
  const n = znorm(x.nazwa), sk = znorm((x.skladniki || []).map(i => i.produkt || '').join(' | '));
  if (/^koktajl/.test(x.typ || '')) return /kakao|czekolad/.test(n) ? GRUPY_KOKT[1] : /maslem orzech|maslo orzech/.test(n) ? GRUPY_KOKT[2] : /owoce mrozone|malin|jagod|truskaw|mango|brzoskw|wisni|jablk|banan/.test(n + ' ' + sk) ? GRUPY_KOKT[0] : GRUPY_KOKT[3];
  if (slot === 'sn') return /owsiank|jaglank|platk|granol|kasza manna|kaszk|pudding|chia|musli|ryz na mleku|kuskus/.test(n) ? GRUPY_SN[0] : /nalesnik|gofr|placki|syrnik|tosty francusk|nalesn/.test(n) ? GRUPY_SN[1] : /kanapk|tost|chleb|wrap|tortill|bagiet|bulk|zapiek/.test(n) ? GRUPY_SN[2] : /jajk|jaja|szakszuk|omlet|jajecz|frittat/.test(n) ? GRUPY_SN[3] : /skyr|jogurt|twarog|serniczek|twarozk/.test(n) ? GRUPY_SN[4] : GRUPY_SN[5];
  if (x.typ === 'obiad_zupa' || /^(zupa|krem|barszcz|zurek|rosol|chlodnik)/.test(n) || /\b(zupa|krem z)\b/.test(n)) return GRUPY_MIESO[0];
  if (/dorsz|losos|tunczyk|ryb|makrel|sledz|mintaj|pstrag|sandacz/.test(sk + ' ' + n)) return GRUPY_MIESO[5];
  if (/mielon/.test(sk + ' ' + n)) return GRUPY_MIESO[2];
  if (/kurczak|piers z kurcz|udko|skrzydl/.test(sk + ' ' + n)) return GRUPY_MIESO[1];
  if (/indyk/.test(sk + ' ' + n)) return GRUPY_MIESO[3];
  if (/wolowin|wieprz|schab|karkowk|poledwic|boczek|zeberk|pregi|lopatk/.test(sk + ' ' + n)) return GRUPY_MIESO[4];
  if (/szynk|kielbas|parowk|wedlin|salami|boczek/.test(sk + ' ' + n)) return GRUPY_MIESO[6];
  if (/skyr|snickers|overnight|owsiank|granol|jogurt|pudding|chia|serniczek|twarozek slodk/.test(n)) return GRUPY_MIESO[7];
  if (/jaj|ser |feta|twarog|tofu|ciecierzyc|fasol|soczewic|kuskus|kasza|ryz|makaron|ziemniak|warzyw|salatk|szpinak|kanapk|tost|wrap/.test(sk + ' ' + n)) return GRUPY_MIESO[8];
  return GRUPY_MIESO[9];
}
function grupyDlaSlotu(x, slot) { return /^koktajl/.test(x.typ || '') ? GRUPY_KOKT : slot === 'sn' ? GRUPY_SN : GRUPY_MIESO; }
document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details.wyb-grp') && zmienCtx) { zmienCtx.otw = zmienCtx.otw || {}; zmienCtx.otw[d.dataset.grp] = d.open; } }, true);
function wierszWyboru(x, teraz, d, slot) {
  return `<div class="wiersz ${ukryte(x.id) ? 'ukryte' : ''}"><button class="wybor ${x.id === teraz ? 'teraz' : ''}" data-wybierz="${d}:${slot}:${esc(x.id)}">${Obr.html(x)}<span class="tx"><b>${oceny[x.id] === 1 ? '★ ' : ''}${esc((x.kod ? x.kod + ' ' : '') + x.nazwa)}</b>
      <span class="mute">${x.id === teraz ? 'obecnie w planie · ' : ''}${ukryte(x.id) ? 'ukryte · ' : ''}${smakTagi(x.id)}${x.tylko_wybor && slot !== 'm13' ? 'na świeżo, nie na wieczór wcześniej · ' : ''}${x.czas ? esc(x.czas) + ' · ' : ''}${r0(x.razem.bialko / x.razem.kcal * 1000) / 10} g białka na 100 kcal${x.dodane ? ' · dodane' : ''}</span></span></button>
      <div class="oceny">${przyciskiOceny(x.id)}</div></div>`;
}
function listaWyboru(q) {
  const { d, slot, teraz, pula } = zmienCtx;
  const slowa = slowaZ(q);
  const rang = x => oceny[x.id] === 1 ? 0 : ukryte(x.id) ? 2 : 1;
  const kto = osobySlotu(slot), zakazane = pula.filter(x => !dopuszcza(x, kto)), pokaz = !!zmienCtx.pokazZakazane;
  const lista = pula.filter(x => (pokaz || dopuszcza(x, kto) || x.id === teraz) && slowa.every(w => szukany(x).includes(w))).sort((x, y) => rang(x) - rang(y) || x.nazwa.localeCompare(y.nazwa, 'pl'));
  const info = zakazane.length ? `<p class="mute" style="margin:4px 0">${pokaz ? 'Pokazuję też' : 'Ukryłem'} ${zakazane.length} ${zakazane.length === 1 ? 'danie' : 'dań'} z wykluczonymi składnikami. <button class="btn maly" data-pokaz-zakazane>${pokaz ? 'Ukryj je' : 'Pokaż mimo to'}</button></p>` : '';
  if (!lista.length) { $('#lista-wyboru').innerHTML = info + '<p class="pusty">Nic nie pasuje do tych słów.</p>'; return; }
  // grupy rozsuwane: ulubione na górze, potem rodzaje dań; przy szukaniu wszystko rozsunięte, inaczej otwarta tylko grupa z obecnym daniem
  const grupy = new Map(), ulub = lista.filter(x => oceny[x.id] === 1 && !ukryte(x.id));
  if (ulub.length) grupy.set('★ Ulubione', ulub);
  for (const x of lista) { if (oceny[x.id] === 1 && !ukryte(x.id)) continue; const g = ukryte(x.id) ? 'Ukryte' : grupaDania(x, slot); (grupy.get(g) || grupy.set(g, []).get(g)).push(x); }
  const kolej = ['★ Ulubione', ...grupyDlaSlotu(lista[0], slot), 'Ukryte'], nazwy = [...grupy.keys()].sort((a, b) => (kolej.indexOf(a) < 0 ? 99 : kolej.indexOf(a)) - (kolej.indexOf(b) < 0 ? 99 : kolej.indexOf(b)));
  const otw = zmienCtx.otw || {}, szuka = slowa.length > 0, gTeraz = (lista.find(x => x.id === teraz) || {}).id;
  $('#lista-wyboru').innerHTML = info + `<p class="mute wyb-ile">${lista.length} ${mn(lista.length, 'danie', 'dania', 'dań')} w ${nazwy.length} ${mn(nazwy.length, 'grupie', 'grupach', 'grupach')}. Rozsuń grupę, żeby wybrać.</p>` + nazwy.map(g => {
    const el = grupy.get(g), czyTeraz = el.some(x => x.id === gTeraz), jawnie = otw[g], dom = jawnie !== undefined ? jawnie : (szuka || czyTeraz || g === '★ Ulubione');
    return `<details class="wyb-grp" data-grp="${esc(g)}" ${dom ? 'open' : ''}><summary><span class="wyb-nazwa">${esc(g)}</span><span class="licznik">${el.length}</span>${czyTeraz ? '<span class="znaczek">tu jest obecne</span>' : ''}</summary>${el.map(x => wierszWyboru(x, teraz, d, slot)).join('')}</details>`;
  }).join('');
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
        const zm = [...n.lev].filter(i => i.ilosc).slice(0, 3).map(i => `${i.nazwa}: ${fqS(i, i.ilosc * skala(g, i))} → ${fq(i.ilosc * n.a, i.jednostka)}`);
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

// Opcje „zużyj resztkę”: dania, które używają produktu, i miejsca w planie (od dziś, niezjedzone), gdzie mogą zastąpić inne danie.
function opcjeZuzycia(prod, reszta) {
  const dzis = isoDzis(), out = new Map();
  const pulaSlotu = (day, slot) => slot === 'sn' ? DB.pula.sn : slot === 'm13ona' ? DB.pula.m13ona : slot === 'm13on' ? DB.pula.m13on : slot === 'm13' ? DB.pula.m13kokt.concat(DB.pula.m13dania) : slot === 'k18' ? DB.pula.k18 : (day.ob2 ? DB.pula.ob2 : DB.pula.ob1);
  for (const t of tygodnieZapisane()) t.dni.forEach((day, d) => {
    const iso = dodajDni(t.start, d); if (iso < dzis) return;
    const sloty = [['sn', day.sn], day.m13.wsp ? ['m13', day.m13.wsp] : null, !day.m13.wsp ? ['m13ona', day.m13.ona] : null, !day.m13.wsp ? ['m13on', day.m13.on] : null, day.ob ? ['ob', day.ob] : null, ['k18', day.k18]].filter(Boolean);
    for (const [slot, teraz] of sloty) {
      if (t.zuz[kluczZ(d, slot, t.start)] || (slot === 'm13ona' && nieob(day, 'ona')) || (slot === 'm13on' && nieob(day, 'on'))) continue;
      for (const dish of pulaSlotu(day, slot)) {
        if (dish.id === teraz || ukryte(dish.id) || !dopuszcza(dish, osobySlotu(slot))) continue;
        const i = dish.skladniki.find(x => x.produkt === prod && x.jednostka === reszta.u && x.ilosc > 0);
        if (!i || i.ilosc > reszta.q * 1.15) continue;
        const uzycie = Math.min(i.ilosc, reszta.q) / reszta.q;
        if (uzycie < 0.25) continue;
        const wynik = uzycie * 10 + (oceny[dish.id] === 1 ? 1 : 0) - (new Date(iso) - new Date(dzis)) / 864e5 * 0.15;
        const ex = out.get(dish.id);
        if (!ex || wynik > ex.wynik) out.set(dish.id, { dish, start: t.start, d, slot, iso, ilosc: i.ilosc, u: i.jednostka, wynik, stare: (DB.dania.get(teraz) || {}).nazwa || '' });
      }
    }
  });
  return [...out.values()].sort((a, b) => b.wynik - a.wynik).slice(0, 6);
}
function oknoZuzyj(prod) {
  const poz = Object.values(window._z.wynik).flat().find(x => x.produkt === prod && x.reszta);
  if (!poz) return;
  const op = opcjeZuzycia(prod, poz.reszta);
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Zużyj: ${esc(prod)}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">Po zakupie zostanie ok. <b>${poz.reszta.q} ${poz.reszta.u}</b>. Wybierz danie — wstawię je w planie w miejsce innego, a gramatury dopasują się do tych samych kalorii.</p>
    ${op.length ? op.map(x => `<div class="wiersz"><button class="wybor" data-zuz-wstaw="${x.start}|${x.d}|${x.slot}|${esc(x.dish.id)}">${Obr.html(x.dish)}<span class="tx"><b>${esc(x.dish.nazwa)}</b><span class="mute">zużyje ok. ${fmtStan(Math.min(x.ilosc, poz.reszta.q), x.u)} · ${dzienTxt(x.iso)} · ${esc(PORA[x.slot].split(' · ')[1])}</span><span class="mute">zastąpi: ${esc(x.stare)}</span></span></button></div>`).join('') : '<p class="pusty" style="padding:24px 0">Nie znalazłem pasującego dania w planie. Zajrzyj do „Lodówki” → „Co ugotować z tego, co mamy?” po zakupach.</p>'}`;
  $('#modal').hidden = false;
}
const dzienTxt = iso => `${DNI_KR[(new Date(iso + 'T12:00:00').getDay() + 6) % 7]} ${krotkaData(iso)}`;
// Podział mięsa i ryb do lodówki / zamrażarki: zawsze liczony od DZIŚ na kolejne dni planu (niezależnie od zaznaczonych dni zakupów),
// więc da się go sprawdzić i wykonać także po zakupach zrobionych wcześniej.
const MIESO_DNI = 14;   // od dziś do końca zapisanych tygodni planu
function miesoPodzial(od, h) {
  const out = {}, doo = dodajDni(od, h - 1);
  for (const t of tygodnieZapisane()) {
    const wk = oblicz({ start: t.start, dni: t.dni }, cele());
    for (const g of wk.garnki) {
      const f = pozostalo(g, t.start, t.zuz), dni = dniGarnka(g).filter(d => !t.zuz[kluczZ(d, g.slot, t.start)]);
      if (f < 0.999 || !dni.length) continue;       // danie już ruszone: woreczek został użyty
      const dt = dodajDni(t.start, dni[0]); if (dt < od || dt > doo) continue;
      for (const i of g.dish.skladniki) if (i.ilosc && i.produkt && stala(i)) { const nb = g.nF || 1; for (let n = 0; n < Math.ceil(nb); n++) (out[i.produkt] = out[i.produkt] || []).push({ g: Math.round(i.ilosc * Math.min(1, nb - n)), dt, dish: g.dish.nazwa, slot: g.slot }); }
    }
  }
  return out;
}
// „2,5 kg”, „2500 g”, „2,5” (poniżej 50 = kilogramy) → gramy
function parsujMase(t) {
  const m = String(t || '').trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(kg|g)?$/); if (!m) return null;
  const v = parseFloat(m[1]); if (!(v > 0)) return null;
  return Math.round(m[2] === 'kg' ? v * 1000 : m[2] === 'g' ? v : (v < 50 ? v * 1000 : v));
}
// Rozdziela kupioną ilość B (g) na woreczki w kolejności dni: pełne woreczki, ewentualnie jeden niepełny, reszta „nie starczy”, albo nadwyżka.
function rozdzielMieso(bags, B) {
  const ord = bags.slice().sort((x, y) => x.dt.localeCompare(y.dt) || y.g - x.g), pelne = [], brak = []; let zost = B, czesc = null;
  for (const x of ord) {
    if (czesc || brak.length) { brak.push(x); continue; }
    if (zost >= x.g) { pelne.push(x); zost -= x.g; }
    else if (zost >= 0.35 * x.g) { czesc = { x, g: Math.round(zost / 5) * 5 }; zost = 0; }
    else brak.push(x);
  }
  return { pelne, czesc, brak, zostaje: Math.round(Math.max(0, zost) / 5) * 5, potrzeba: ord.reduce((a, x) => a + x.g, 0) };
}
const gTxt = g => g >= 1000 ? (g / 1000).toFixed(2).replace(/0$/, '').replace('.', ',') + ' kg' : g + ' g';
// Karta w Zakupach: wpisujesz, ile mięsa lub ryby kupiliście, a apka dzieli to na woreczki na kolejne dni planu od dziś (lodówka do 2 dni, reszta zamrażarka).
function kartaMiesa() {
  const dzis = isoDzis(), dane = miesoPodzial(dzis, MIESO_DNI), prods = Object.keys(dane).sort((a, b) => a.localeCompare(b, 'pl')), kup = LS.get('miesoKup', {}) || {};
  window._miesoProds = prods;
  const dniDo = dt => Math.round((new Date(dt + 'T12:00:00') - new Date(dzis + 'T12:00:00')) / 864e5);
  const ik = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6.5l2.5-2M9.5 19.5l2.5-2 2.5 2"/></svg>';
  let h = `<section class="karta miesc"><div class="miesc-gora"><span class="miesc-ik">${ik}</span><div><b>Podział mięsa i ryb</b><small>Wpisz, ile kupiliście, a podzielę na kolejne dni od dziś (${dzienTxt(dzis)})</small></div></div>`;
  if (!prods.length) return h + `<p class="mute miesc-pusto">W planie na kolejne dni nie ma dań z mięsem ani rybą z zamrażarki.</p></section>`;
  h += prods.map((pr, i) => {
    const bags = dane[pr], k = kup[pr], nazwaEt = pr.replace(/ filet| mielon\w*/g, '');
    let wynik = '';
    if (k && k.g > 0) {
      const r = rozdzielMieso(bags, k.g), wor = x => { const lod = dniDo(x.dt) <= 2, za = dniDo(x.dt); return { lod, za }; };
      const wiersz = (x, g, niep) => { const { lod, za } = wor(x); return `<div class="wor ${lod ? 'lod' : 'mroz'}"><span class="wor-g">${g}<small>g</small></span><span class="wor-tx"><b>${dzienTxt(x.dt)}${za === 0 ? ' · dziś' : za === 1 ? ' · jutro' : ''}</b><span class="mute">${esc(x.dish)}</span>${niep ? `<small class="ostrz-txt">tylko ${g} g z ${x.g} g potrzebnych</small>` : `<small>Podpisz: ${esc(nazwaEt)} ${g} g · ${dzienTxt(x.dt)}</small>`}</span><span class="znaczek ${lod ? '' : 'mroz'}">${lod ? 'LODÓWKA' : 'ZAMRAŻARKA'}</span></div>`; };
      const pierwszy = r.pelne[0] || (r.czesc && r.czesc.x);
      wynik = `<div class="miesc-wynik"><p class="miesc-pod"><b>${esc(gTxt(k.g))}</b> na ${r.pelne.length + (r.czesc ? 1 : 0)} ${mn(r.pelne.length + (r.czesc ? 1 : 0), 'posiłek', 'posiłki', 'posiłków')}${pierwszy ? ` · pierwszy woreczek: ${dzienTxt(pierwszy.dt)}` : ''}</p>${r.pelne.map(x => wiersz(x, x.g, false)).join('')}${r.czesc ? wiersz(r.czesc.x, r.czesc.g, true) : ''}
        ${r.brak.length ? `<p class="miesc-brak">Na te dni już nie starczy: ${esc(r.brak.map(x => dzienTxt(x.dt)).join(', '))}. Do planu brakuje ok. ${gTxt(Math.max(0, r.potrzeba - k.g))}.</p>` : ''}
        ${!r.brak.length && !r.czesc && r.zostaje >= 20 ? (() => { const typ = Math.round(bags.map(x => x.g).sort((x, y) => x - y)[Math.floor(bags.length / 2)] / 5) * 5, n = typ ? Math.floor(r.zostaje / typ) : 0; return `<p class="miesc-zostaje">Zostaje ${esc(gTxt(r.zostaje))} ponad plan na najbliższe dni${n >= 1 ? `: to ${n} ${mn(n, 'woreczek', 'woreczki', 'woreczków')} po ${typ} g (typowa porcja) na kolejne tygodnie` : ''}. Zamroź osobno i podpisz.</p>`; })() : ''}
        <div class="rzad"><button class="btn maly" data-mieso-gotowe="${i}">Gotowe, schowaj</button></div></div>`;
    }
    return `<div class="miesc-prod"><div class="miesc-prod-gora"><b>${esc(pr)}</b><span class="mute">plan na ${MIESO_DNI} dni: ${esc(gTxt(bags.reduce((a, x) => a + x.g, 0)))}</span></div>
      <div class="lod-rzad miesc-wpis"><input id="mieso-in-${i}" type="text" inputmode="decimal" autocomplete="off" placeholder="Ile kupiliście? np. 2,5 kg" value="${k ? esc(gTxt(k.g)) : ''}" aria-label="Ile ${esc(pr)} kupiliście"><button class="btn glowny maly" data-mieso-podziel="${i}">${k ? 'Przelicz' : 'Podziel'}</button></div>${wynik}</div>`;
  }).join('');
  return h + `<details class="miesc-tipy"><summary>Jak pakować i rozmrażać</summary><ul class="mute"><li>Woreczki strunowe, mięso rozpłaszczone na płasko; ważysz na wadze kuchennej.</li><li>Rozmrażanie w lodówce wieczorem dzień wcześniej (apka przypomni w „Wieczorem na jutro”). Rozmrożonego surowego mięsa nie mrozisz ponownie.</li><li>Mięso i ryby zjadaj w ciągu ok. 3 miesięcy.</li></ul></details></section>`;
}
let zakOtw = false;
// „sob 21.11 – pon 23.11” zamiast listy dat (zakresy ciągłe, reszta po przecinku)
function zakresDni(wyb) {
  const d = [...wyb].sort(); if (!d.length) return 'nic nie zaznaczono';
  const grupy = []; d.forEach(x => { const g = grupy[grupy.length - 1]; if (g && dodajDni(g[g.length - 1], 1) === x) g.push(x); else grupy.push([x]); });
  return grupy.map(g => g.length === 1 ? dzienTxt(g[0]) : `${dzienTxt(g[0])} – ${dzienTxt(g[g.length - 1])}`).join(', ');
}
// Układ listy jak w sklepie: działy zamiast „świeże / zapas / zamrażarka”.
const DZIALY = [
  ['warzywa', 'Warzywa i owoce', 'M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l7-7'],
  ['nabial', 'Nabiał i jaja', 'M9 3h6v3l2 3v11H7V9l2-3zM7 13h10'],
  ['pieczywo', 'Pieczywo', 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1h-1v7H5v-7H4z'],
  ['mieso', 'Mięso i ryby', 'M14 4a5 5 0 0 1 5 5c0 3-2 5-5 5l-3 3-3-3 3-3c0-3 0-7 3-7z'],
  ['mrozonki', 'Mrożonki', 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9'],
  ['spizarnia', 'Spiżarnia', 'M8 3h8v3H8zM6 6h12v15H6zM6 12h12']
];
function dzialSklepu(p) {
  const n = znorm(p.produkt);
  if (/mrozon|paluszki rybne/.test(n)) return 'mrozonki';
  if (/gnocchi|pestki|konserw|puszk|sloik|odsaczon|passata|koncentrat|ananas|tunczyk|kiszony|orzechow|(^| )sos |ketchup|musztard|dzem|miod|ocet|olej|oliwa/.test(n)) return 'spizarnia';
  if (/kurczak|indyk|wolowin|wieprzow|losos|dorsz|polędwicz|polendwicz|cwiartki|mielon|prega|lopatka|szynka|kielbas|boczek|parowk|filet|ryba|krewetk/.test(n) || (p.kat === 'zamrażarka')) return 'mieso';
  if (/chleb|bulk|tortilla|pieczywo|bagiet|buleczk/.test(n)) return 'pieczywo';
  if (/^(ser|serek)\b|skyr|jogurt|twarog|smietana|maslo|mleko|jaja|jajka|parmezan|feta|mozzarella|kefir|margaryn|odzywka bialkowa/.test(n)) return /odzywka/.test(n) ? 'spizarnia' : 'nabial';
  if (/cebul|marchew|papryk|ogorek|pomidor|^por\b|awokado|banan|jablk|cukini|salat|brokul|kalafior|seler|pietruszk|dyni|rzodkiewk|szpinak|pieczark|bataty|ziemniak|czosnek|cytryn|limonk|szczypior|natka|koperek|rukola|kapust|burak|szczaw|truskawk|maliny|jagod|mango|gruszk|pomarancz|kukurydza/.test(n)) return 'warzywa';
  return p.kat === 'świeże' ? 'warzywa' : 'spizarnia';
}
function widokZakupy() {
  const dost = dniDostepne(), wyb = wybraneDni(), z = zakupyDni(wyb), dzis = isoDzis();
  const klucz = kluczKup, wszystkie = ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]);
  const razemPoz = wszystkie.length, kupione = wszystkie.filter(p => odhK(klucz(p.produkt))).length, cmp = porownajSklepy(z);
  let h = `<h1>Zakupy</h1>${wskazowka('zakupy', 'Zaznacz dni, na które kupujecie — lista sama się policzy i jest ułożona jak w sklepie. Odhaczone pozycje trafiają do lodówki i spadają na koniec działu.')}`;
  h += `<details class="zk-hero" data-zakdni ${zakOtw || !wyb.size ? 'open' : ''}><summary><span class="wd-tx"><small>Zakupy na</small><b>${zakresDni(wyb)}</b></span><span class="wd-zmien">Zmień dni</span>
    <span class="zk-prog"><span class="pasek"><i id="zkPasek" style="width:${razemPoz ? Math.round(kupione / razemPoz * 100) : 0}%"></i></span><small id="zkLicz">${razemPoz ? `Kupione ${kupione} z ${razemPoz}` : 'Brak pozycji'}</small></span></summary><div class="zk-wybor">
    <div class="rzad-nag"><h3 style="margin:0">Na które dni kupujecie?</h3><span class="chips"><button class="chip" data-zakpreset="auto">Najbliższe zakupy</button><button class="chip" data-zakpreset="zero">Wyczyść</button></span></div>
    <p class="mute" style="margin:6px 0 4px">Kliknij dni, na które robicie zakupy. Danie na kilka dni (np. zupa na 2 dni) kupujesz w całości. Dni „bez niego / bez niej” z planu są uwzględnione.</p>`;
  for (const t of tygodnieZapisane()) {
    const dniT = dost.filter(x => x.start === t.start), wsz = dniT.every(x => wyb.has(x.iso));
    h += `<div class="tyg-nag"><b>${krotkaData(t.start)}–${krotkaData(dodajDni(t.start, 6))}</b><button class="chip ${wsz ? 'akt' : ''}" data-zakweek="${t.start}">cały tydzień</button></div>`;
    h += dniT.map(x => {
      const on = wyb.has(x.iso), ob = x.day.ob && DB.dania.get(x.day.ob), prev = x.d > 0 && t.dni[x.d - 1].ob2 && DB.dania.get(t.dni[x.d - 1].ob);
      const opis = ob ? ob.nazwa : prev ? 'obiad z poprzedniego dnia' : '';
      const kto = stanKto(x.day) !== 'oboje' ? `<span class="znaczek">tylko ${stanKto(x.day) === 'bezon' ? 'ONA' : 'ON'}</span>` : '';
      return `<button class="dz-wiersz ${on ? 'akt' : ''} ${x.iso < dzis ? 'minal' : ''}" data-zakdzien="${x.iso}"><span class="dz-d"><b>${DNI_KR[x.d]}</b> ${krotkaData(x.iso)}${x.iso === dzis ? '<em class="dzis-znacz">dziś</em>' : ''}</span><span class="dz-o">${esc(opis)} ${kto}</span><span class="ptak">${on ? '✓' : ''}</span></button>`;
    }).join('');
  }
  h += `</div></details>`;
  h += kartaMiesa();
  h += kartaSklepy(cmp);
  h += paskAkcji(['paragon', 'skan']);
  if (!wyb.size) h += `<div class="karta pusta-karta"><b>Zaznacz przynajmniej jeden dzień</b><p class="mute">Kliknij „Zmień dni” powyżej.</p></div>`;
  const wDzial = {}; wszystkie.forEach(p => { (wDzial[dzialSklepu(p)] = wDzial[dzialSklepu(p)] || []).push(p); });
  const sk = sklepAktywny(), uk = trasaUklad(wDzial, sk), maTrase = !!(trasa[sk] && Object.keys(trasa[sk]).length >= 8);
  if (razemPoz) h += `<div class="trasa-wiersz"><span class="mute">Idę do:</span><div class="chips">${sklepyDoWyboru().map(x => `<button class="chip ${x === sk ? 'akt' : ''}" data-sklepzak="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <small class="mute">${maTrase ? `Lista ułożona wg Waszej trasy w sklepie. <button class="link" data-trasa-tryb="${trasaTryb === 'moja' ? 'std' : 'moja'}">${trasaTryb === 'moja' ? 'Pokaż standardową kolejność' : 'Użyj mojej trasy'}</button>` : 'Odhaczajcie po kolei, a zapamiętam trasę w sklepie.'}</small></div>`;
  const dzialyKol = uk ? uk.dzialy.map(k => DZIALY.find(d => d[0] === k)) : DZIALY;
  for (const [kod, nazwa, ikona] of dzialyKol) {
    const l = wDzial[kod]; if (!l || !l.length) continue;
    const kup = l.filter(p => odhK(klucz(p.produkt))).length;
    h += `<section class="zk-sek"><div class="zk-sek-gora"><span class="zk-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ikona}"/></svg></span><b>${nazwa}</b><em data-licznik>${kup}/${l.length}</em></div><div class="karta zk-karta">`
      + l.slice().sort((a, b) => !!odhK(klucz(a.produkt)) - !!odhK(klucz(b.produkt)) || (uk ? (uk.tr[a.produkt] != null ? uk.tr[a.produkt] : uk.sr[kod]) - (uk.tr[b.produkt] != null ? uk.tr[b.produkt] : uk.sr[kod]) : 0) || a.produkt.localeCompare(b.produkt, 'pl')).map(p => {
        const k = klucz(p.produkt), on = !!odhK(k);
        const ci = cmp.info[p.produkt], cenyTxt = ci && Object.keys(ci.c).length > 1 ? Object.entries(ceny[p.produkt] || {}).filter(([sk]) => ci.c[sk] != null).sort((a, b) => cenaX(a[1]) - cenaX(b[1])).map(([sk, v]) => `${sk} ${zl(cenaX(v))}/${jednCeny(v.u)}`).join(' · ') : '';
        const info = [p.dop, p.stan ? `w lodówce: ${p.stan}` : '', cenyTxt ? `taniej: ${cenyTxt}` : ''].filter(Boolean).join(' · ');
        const zw = p.pomysly ? `<button class="zuzyj-btn" data-zuzyj="${esc(p.produkt)}">Zużyj resztkę (${p.reszta.q} ${p.reszta.u}) ›</button>` : '';
        return `<label class="zk-poz ${on ? 'kupione' : ''}"><input type="checkbox" data-kup="${esc(k)}" ${on ? 'checked' : ''}><span class="zk-ptak"></span><span class="zk-tx"><b>${esc(p.produkt)}${SEZON[p.produkt] && SEZON[p.produkt].includes(miesiac()) ? ' <i class="sezon-lisc" title="w sezonie" aria-label="w sezonie">sezon</i>' : ''}</b>${info ? `<small>${esc(info)}</small>` : ''}${zw}</span><span class="zk-ile">${esc(p.ile)}</span></label>`;
      }).join('') + `</div></section>`;
  }
  const zwin = (tyt, n, tresc, kl = '') => `<details class="karta zk-zwin ${kl}"><summary>${tyt} <span class="licznik">${n}</span></summary>${tresc}</details>`;
  if (z.wynik.masz.length) h += zwin('Masz już w lodówce', z.wynik.masz.length, z.wynik.masz.map(p => `<div class="zk-masz"><b>${esc(p.produkt)}</b><span class="mute">potrzeba ${esc(p.ile)}, masz ${esc(p.stan)}</span></div>`).join(''));
  if (z.przyprawy.length) h += zwin('Przyprawy i dodatki — sprawdź w szafce', z.przyprawy.length, `<div class="chips zk-przyp">${z.przyprawy.map(t => `<span class="chip stat">${esc(t)}</span>`).join('')}</div>`);
  if (z.inne.length) h += zwin('Bez gramatury', z.inne.length, z.inne.map(t => `<p class="mute" style="margin:6px 0">${esc(t)}</p>`).join(''));
  h += `<div class="zk-akcje">`;
  if (wszystkie.some(p => !odhK(klucz(p.produkt)))) h += `<button class="btn glowny szeroki" id="kupWszystko">Kupione wszystko — dopisz do lodówki</button>`;
  h += `<button class="btn" data-par-nowy>Dodaj paragon z tych zakupów</button><div class="rzad"><button class="btn" id="udostepnij">Udostępnij listę</button>${Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).some(k => k.startsWith('zak|')) ? `<button class="btn" id="odznaczWszystko">Odznacz wszystko</button>` : ''}</div></div>`;
  $('#view').innerHTML = h;
  window._z = z;
}
// Po odhaczeniu: licznik w dziale, pasek postępu i przeniesienie pozycji na koniec działu.
function zkLiczniki() {
  document.querySelectorAll('.zk-sek').forEach(sek => { const r = sek.querySelectorAll('.zk-poz'), k = sek.querySelectorAll('.zk-poz.kupione'); const el = sek.querySelector('[data-licznik]'); if (el) el.textContent = `${k.length}/${r.length}`; });
  const wszystkie = document.querySelectorAll('.zk-poz'), kupione = document.querySelectorAll('.zk-poz.kupione');
  const pas = $('#zkPasek'), lic = $('#zkLicz');
  if (pas) pas.style.width = (wszystkie.length ? Math.round(kupione.length / wszystkie.length * 100) : 0) + '%';
  if (lic) lic.textContent = `Kupione ${kupione.length} z ${wszystkie.length}`;
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
  const p0 = profil ? { ona: profilEf('ona'), on: profilEf('on') } : { ona: { plec: 'k', akt: '1.375', cel: 'redukcja' }, on: { plec: 'm', akt: '1.375', cel: 'redukcja' } };
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
  const podglad = () => { const o = zbierz(); OS.forEach(p => { const z = zapotrzebowanie(o[p]); $(`[data-wynik="${p}"]`).innerHTML = z ? `<b>${z.kcal} kcal / dzień</b> · białko ${z.bMin}–${z.bMax} g<br><span class="mute">podstawowa przemiana ${z.bmr} kcal · z aktywnością ${z.cpm} kcal</span>${z.kcal < z.bmr ? `<br><span class="ostrz-txt">Uwaga: cel jest poniżej podstawowej przemiany (${z.bmr} kcal), czyli tego, co ciało zużywa w spoczynku. Na dłużej bywa to powodem osłabienia.</span>` : ''}` : '<span class="mute">Podaj wiek, wagę i wzrost.</span>'; }); };
  $('#view').oninput = podglad; podglad();
  formStart = JSON.parse(JSON.stringify(p0));
  $('#zapisz').onclick = async () => {
    const o = zbierz();
    if (!zapotrzebowanie(o.ona) || !zapotrzebowanie(o.on)) { pokazToast('Uzupełnij wiek, wagę i wzrost dla obojga.'); return; }
    const nisko = OS.filter(pp => { const z = zapotrzebowanie(o[pp]); return z && z.kcal < z.bmr; });
    if (nisko.length && !(await pytaj('Cel poniżej podstawowej przemiany', `${nisko.map(pp => ETY[pp]).join(' i ')}: ustawione kalorie są niższe niż to, co ciało zużywa w spoczynku. Na dłużej może to powodować osłabienie. Zapisać mimo to?`, 'Zapisz mimo to'))) return;
    // zapisuję tylko osobę, której dane ktoś tu zmienił — nie nadpiszę zmian zrobionych w tym czasie na drugim telefonie
    const zmienione = OS.filter(p => !profil || stabilny(o[p]) !== stabilny(formStart[p]));
    OS.forEach(pp => { if (profil && o[pp].waga && o[pp].waga !== formStart[pp].waga) { waga[pp] = waga[pp] || {}; waga[pp][isoDzis()] = o[pp].waga; LS.set('waga', waga); Z([[['waga', pp, isoDzis()], o[pp].waga]]); } });   // zmiana wagi w ustawieniach = nowy pomiar z dzisiaj
    profil = { ona: zmienione.includes('ona') ? o.ona : profil.ona, on: zmienione.includes('on') ? o.on : profil.on };
    LS.set('profil', profil);
    Z(zmienione.map(p => [['profil', p], o[p]]));
    // zmiana celu, aktywności albo własnych kcal unieważnia dotychczasową korektę z wagi (była dobrana do starego celu), więc zaczynam od zera
    zmienione.forEach(p => { const st = formStart[p] || {}, nw = o[p]; if (profil && (st.cel !== nw.cel || st.akt !== nw.akt || st.wlasne !== nw.wlasne) && korekta[p] && korekta[p].kcal) { korekta[p] = Object.assign({}, korekta[p], { kcal: 0, od: isoDzis() }); LS.set('korekta', korekta); Z([[['korekta', p], korekta[p]]]); } });
    if (!planAktualny()) ulozTydzien();
    zakladka = pierwszy ? 'dzis' : 'tydzien'; rysuj(); window.scrollTo(0, 0);
  };
  if (!pierwszy) {
    $('#odswiez').onclick = async () => { await wczytajBaze(); rysuj(); };
    if (window.caches) caches.keys().then(ks => { const e = $('#wersja'); if (e) e.textContent = 'Wersja: ' + (ks.find(k => k.startsWith('plan-')) || 'brak'); }).catch(() => {});
    $('#wyczysc').onclick = async () => {
      if (!(await pytaj('Usunąć dane z tego telefonu?', 'Zniknie zapisany plan, odhaczone zakupy i lodówka.' + (window.Sync && window.Sync.kod ? ' Telefon zostanie odłączony od wspólnego planu, u drugiej osoby plan zostaje.' : ''), 'Usuń dane'))) return;
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
  const kiedy = S.kod && S.ostatni ? ` Ostatnia synchronizacja: ${new Date(S.ostatni).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.` : '';
  return esc(t + (S.kod ? kiedy : '')) + (S.blad ? ` <span class="ostrz-txt">${esc(S.blad)}</span>` : '');
}
// Pasek na górze ekranu, gdy synchronizacja nie działa albo zmiany czekają: widać to na każdym ekranie, nie tylko w Ustawieniach.
let syncOdMs = 0;
function pasekSync() {
  const S = window.Sync; let el = $('#sync-pasek');
  let tx = '', ponow = false;
  if (S && S.kod) {
    if (S.stan === 'blad') { tx = 'Brak synchronizacji. Zmiany zostają na tym telefonie.'; ponow = true; }
    else if (S.stan === 'offline' || navigator.onLine === false) tx = 'Brak sieci. Zmiany wyślę, gdy wróci.';
    else if (S.oczekuje > 0) { syncOdMs = syncOdMs || Date.now(); if (Date.now() - syncOdMs > 8000) tx = `Zmiany czekają na wysłanie (${S.oczekuje}).`; }
    if (!(S.oczekuje > 0)) syncOdMs = 0;
  }
  if (!tx) { if (el) el.remove(); document.body.classList.remove('ma-sync-pasek'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'sync-pasek'; el.className = 'sync-pasek'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(tx)}</span>${ponow ? '<button class="btn maly" id="sync-ponow">Ponów</button>' : ''}`;
  el.title = S && S.blad ? S.blad : '';
  document.body.classList.add('ma-sync-pasek');
  document.body.style.setProperty('--sync-h', el.offsetHeight + 'px');
}
setInterval(pasekSync, 4000);
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
  else if (navigator.clipboard) navigator.clipboard.writeText(tekst).then(() => pokazToast('Zaproszenie skopiowane. Wyślij je SMS-em albo komunikatorem.'), () => pokazTekst('Zaproszenie do planu', tekst));
  else pokazTekst('Zaproszenie do planu', tekst);
}
function zamknijOkno() {
  zatrzymajSkan(true);
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
      const gh = n => (GODZ[n.g.slot] || 12), grupa = sloty.filter(n => !zjedz_(n.g) && gh(n) === gh(nast)), godzTxt = nast.g.slot === 'm13' && nast.g.dish.typ !== 'koktajl' ? '13:00' : PORA[nast.g.slot].split(' · ')[0];
      const wiersz = (n, podw) => {
        const g = n.g, moje = g.porcje.filter(q => q.d === d), kto = podw ? (g.slot === 'm13ona' ? 'ONA' : g.slot === 'm13on' ? 'ON' : moje.map(q => ETY[q.p]).join(' + ')) : '';
        return `<div class="hero-poz"><div class="hero-dan">${Obr.html(g.dish, podw ? '' : 'duzy')}<div>${kto ? `<i class="hero-kto">${kto}</i>` : ''}<b>${esc((g.dish.kod ? g.dish.kod + ' ' : '') + g.dish.nazwa)}</b>${n.odgrzewane ? `<small>odgrzewasz z ${DNI_KR[g.d]}</small>` : ''}</div></div>
        <div class="hero-liczby">${moje.map(q => `<span>${podw ? '' : ETY[q.p] + ' '}${r0(q.kcal + (g.dosypka && q.p === 'on' ? g.dosypka.kcal : 0))} kcal · ${r0(q.b + (g.dosypka && q.p === 'on' ? g.dosypka.b : 0))} g białka</span>`).join('')}</div>
        <div class="rzad"><button class="btn hero-btn" data-przepis="${w.garnki.indexOf(g)}:${d}">Zobacz przepis</button>${n.odgrzewane ? '' : `<button class="btn hero-btn jasny" data-zmien="${d}:${g.slot}">Zmień danie</button>`}</div></div>`;
      };
      const podw = grupa.length > 1;
      o += `<div class="hero ${podw ? 'podwojny' : ''}"><span class="hero-et">${gh(nast) >= godz - 1.5 ? 'Następny posiłek' : 'Jeszcze niezjedzone'} · ${godzTxt}</span>${(podw ? grupa : [nast]).map(n => wiersz(n, podw)).join('')}</div>`;
    } else o += `<div class="hero ok"><span class="hero-et">Dziś</span><div class="hero-dan"><div><b>Wszystko zjedzone. Dobra robota!</b><small>Jutro zajrzyj tu po kolejny dzień.</small></div></div></div>`;
    // postęp dnia
    const zjed = p => sum(sloty.filter(({ g }) => zjedz_(g)), ({ g }) => sum(g.porcje.filter(q => q.d === d && q.p === p), q => q.kcal + (g.dosypka && p === 'on' ? g.dosypka.kcal : 0)));
    const zjedB = p => sum(sloty.filter(({ g }) => zjedz_(g)), ({ g }) => sum(g.porcje.filter(q => q.d === d && q.p === p), q => q.b + (g.dosypka && p === 'on' ? g.dosypka.b : 0)));
    o += `<div class="postep">${OS.filter(p => !nieob(day, p)).map(p => { const baza = bazaDnia(plan, c, d, p), cel = baza ? baza.kcal : x[p].kcal, bCel = baza ? baza.b : x[p].b, z = zjed(p) + pozaKcal(day, p), pr = cel ? Math.round(z / cel * 100) : 0; return `<div class="${p}"><div class="kolo ${pr > 100 ? 'ponad' : ''}" style="--d:${(Math.min(100, pr) * 1.1938).toFixed(1)}"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="t" r="19" cx="22" cy="22"/><circle class="w" r="19" cx="22" cy="22"/></svg><span><span data-licz="${pr}">${pr}</span><small>%</small></span></div><div class="kolo-tx"><b>${ETY[p]}</b><span>${r0(z)} <em>/ ${r0(cel)} kcal</em></span><small>białko <span class="bbk">${r0(zjedB(p))}</span> <span class="nb">/ ${r0(bCel)} g</span></small></div></div>`; }).join('')}</div>`;
    o += paskAkcji(['czas', 'poza', 'skan', 'paragon', 'spont', 'waga']);
    o += kartaPrepDzis(dzis);
    // lista posiłków
    o += `<h2>Dzisiejsze posiłki</h2><div class="karta posilki-dnia">` + sloty.map(({ g, odgrzewane }) => {
      const moje = g.porcje.filter(q => q.d === d), ez = zjedz_(g), gl = g.slot === 'm13' && g.dish.typ !== 'koktajl' ? '13:00 · drugie danie' : PORA[g.slot];
      return `<div class="pos-wiersz ${ez ? 'zjedzone' : ''} ${nast && nast.g === g ? 'nast' : ''}"><label class="pos-ptak"><input type="checkbox" data-zuz="${d}:${g.slot}" ${ez ? 'checked' : ''} aria-label="zjedzone"><span></span></label>
        <button class="pos-tx" data-przepis="${w.garnki.indexOf(g)}:${d}"><small>${gl}${g.slot === 'm13ona' ? ' · ONA' : g.slot === 'm13on' ? ' · ON' : ''}${odgrzewane ? ' · odgrzewasz' : ''}</small><b>${esc(g.dish.nazwa)}</b><span class="mute">${moje.map(q => `${ETY[q.p]} ${r0(q.kcal + (g.dosypka && q.p === 'on' ? g.dosypka.kcal : 0))} kcal`).join(' · ')}</span></button>${ez ? '' : `<button class="pos-pomin" data-pomin="${d}:${g.slot}">Pomiń</button>`}</div>`;
    }).join('') + `</div>`;
    o += pozaLista(day, d);
    o += pominLista(day, d);
    o += kartaWieczor(wieczorem(w, d), dzis);
    const sh = OS.filter(p => shakeAkt(day, p));
    if (sh.length) o += `<div class="karta"><b>Po treningu · shake</b><p class="mute">${sh.map(p => `${ETY[p]}: odżywka ${DB.shake[p].odzywka_g} g + mleko ${DB.shake[p].mleko_ml} ml`).join(' · ')}</p></div>`;
    // co dalej
    const wi = wieczorem(w, d), kar = [];
    { const maOdh = Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).some(k => k.startsWith('zak|')), raz = Object.values(lodowka).reduce((a, us) => a + Object.keys(us).length, 0);
      if (maOdh && !paragony.some(x => x.data >= dodajDni(dzis, -2))) kar.push(`<div class="karta zad"><b>Masz paragon z zakupów?</b><p class="mute">Wklej go, a zapamiętam ceny i sklep, żeby podpowiadać, gdzie taniej.</p><button class="btn szeroki" data-szybka="paragon">Dodaj paragon</button></div>`);
      else if (!raz) kar.push(`<div class="karta zad"><b>Lodówka jest pusta</b><p class="mute">Zeskanuj kody produktów albo dodaj paragon, a apka będzie liczyć, co jeszcze masz.</p><div class="rzad"><button class="btn glowny" data-szybka="skan">Skanuj kod</button><button class="btn" data-szybka="paragon">Dodaj paragon</button></div></div>`); }
    { const brak = prognoza(w).filter(x => x.pilne); if (brak.length) kar.push(`<div class="karta zad ostrz-karta"><b>Zaraz zabraknie w lodówce</b><p class="mute">${brak.slice(0, 4).map(x => `${esc(x.produkt)} (${DNI_KR[x.d]})`).join(', ')}${brak.length > 4 ? ' i inne' : ''}.</p><div class="rzad"><button class="btn glowny" data-tab="zakupy">Lista zakupów</button><button class="btn" data-tab="lodowka">Lodówka</button></div></div>`); }
    { const dz = doZuzycia(); if (dz.length) kar.push(`<div class="karta zad ostrz-karta"><b>Do zużycia w lodówce</b><ul>${dz.slice(0, 4).map(x => `<li>${esc(x.pr)} — ${swiezoscTxt(x.f)}</li>`).join('')}</ul><div class="rzad"><button class="btn glowny" data-szybka="spont">Co z tego ugotować</button><button class="btn" data-tab="lodowka">Lodówka</button></div></div>`); }
    const idx = dzienTyg();
    if (Object.keys(smaki).length < 12 && LS.get('swipeP', '') !== isoDzis().slice(0, 7)) kar.push(`<div class="karta zad"><b>Poznajmy Wasz smak</b><p class="mute">Przesuń kilka dań: te, które lubicie, będą wracać częściej, a te, których nie chcecie, zostaną w tle.</p><div class="rzad"><button class="btn glowny" data-szybka="swipe">Co lubicie?</button><button class="btn" data-swipe-pozniej="1">Później</button></div></div>`);
    if ((idx === 6 || idx === 0) && (historia.length || sum(Object.keys(zuzyte), () => 1) > 4)) kar.push(`<div class="karta zad"><b>${idx === 6 ? 'Koniec tygodnia' : 'Nowy tydzień'}</b><p class="mute">${idx === 6 ? 'Zobacz, jak Wam poszło w tym tygodniu.' : 'Zobacz podsumowanie poprzedniego tygodnia.'}</p><button class="btn szeroki" data-szybka="podsum">Podsumowanie tygodnia</button></div>`);
    if (idx === 0 || idx === 4) kar.push(`<div class="karta zad"><b>Dziś dzień zakupów</b><p class="mute">Lista jest gotowa na: <b>${zakresDni(new Set(domyslneDni(dniDostepne())))}</b>.</p><button class="btn glowny szeroki" id="doZakupowDzis">Otwórz listę zakupów</button></div>`);
    const lastW = p => Object.keys(waga[p] || {}).sort().pop();
    if (OS.some(p => !lastW(p) || (new Date(dzis) - new Date(lastW(p))) / 864e5 >= 7)) kar.push(`<div class="karta zad"><b>Czas na ważenie</b><p class="mute">Raz w tygodniu, rano. Wynik pomaga ocenić, czy kalorie są dobre.</p><button class="btn szeroki" data-tab="waga">Zapisz wagę</button></div>`);
    const prop = OS.filter(pp => propozycjaKorekty(pp).stan === 'propozycja'); if (prop.length) kar.push(`<div class="karta zad"><b>Propozycja korekty kalorii</b><p class="mute">Trend wagi sugeruje małą zmianę kalorii dla: ${prop.map(pp => ETY[pp]).join(', ')}.</p><button class="btn szeroki" data-tab="waga">Zobacz w Wadze</button></div>`);
    const pr = przypomnieniaDzis(w); if (pr) kar.push(pr);
    const PRIO = [['Do zużycia', 1], ['Zaraz zabraknie', 1], ['zaczyna brakować', 2], ['Wieczorem przygotuj', 2], ['Masz paragon', 3], ['Lodówka jest pusta', 3], ['dzień zakupów', 3], ['Czas na ważenie', 4], ['Propozycja korekty', 4], ['Koniec tygodnia', 5], ['Nowy tydzień', 5], ['Poznajmy Wasz smak', 6]], prio = k => (PRIO.find(([tt]) => k.includes(tt)) || [0, 4])[1];
    let kk = kar.slice(); if (kk.some(x => x.includes('Zaraz zabraknie'))) kk = kk.filter(x => !x.includes('W lodówce zaczyna brakować'));   // jedna informacja o brakach, nie dwie
    kk.sort((a, b) => prio(a) - prio(b)); const pokaz = kk.slice(0, 3), reszta = kk.slice(3);
    return o + (kk.length ? `<h2>Co dalej</h2>${pokaz.join('')}${reszta.length ? (dalejWiecej ? reszta.join('') + '<button class="btn szeroki" data-dalej-wiecej="0">Zwiń podpowiedzi</button>' : `<button class="btn szeroki" data-dalej-wiecej="1">Więcej podpowiedzi (${reszta.length})</button>`) : ''}` : '') + `<button class="btn szeroki" data-tab="tydzien" style="margin-top:12px">Cały plan</button></div></section>`;
  });
  $('#view').innerHTML = h;
  window._w = window._wBy[t.start];
}
let wyklOsoba = 'ona';
const zapiszWykl = () => { LS.set('wyklucz', wyklucz); Z([[['wyklucz'], wyklucz]]); };
const naruszeniaDwochTygodni = () => tygodnieZapisane().flatMap(t => naruszeniaPlanu({ start: t.start, dni: t.dni }, isoDzis()).map(n => Object.assign({ start: t.start }, n)));
function puleDlaSlotu(day, slot) { return slot === 'ob' ? (day.ob2 ? DB.pula.ob2 : DB.pula.ob1) : slot === 'm13' ? DB.pula.m13kokt.concat(DB.pula.m13dania) : DB.pula[slot]; }
// Zamienia w obecnym i następnym tygodniu (od dziś, bez zjedzonych) dania z wykluczonymi składnikami na podobne: ten sam rodzaj, najbliższe białko na kcal.
function zamienNiepasujace() {
  const sn = snapStanu();
  const orig = plan.start, dzis = isoDzis(); let zmieniono = 0, brak = 0;
  for (const t of tygodnieZapisane()) {
    if (t.start !== plan.start) { if (inny && inny.start === t.start) przelaczTydzien(); else continue; }
    for (const n of naruszeniaPlanu(plan, dzis)) {
      if (zuzyte[kluczZ(n.d, n.slot)]) continue;
      const day = plan.dni[n.d], stary = DB.dania.get(n.id), kto = osobySlotu(n.slot), pula = puleDlaSlotu(day, n.slot);
      let kand = pula.filter(x => x.id !== n.id && !ukryte(x.id) && dopuszcza(x, kto) && (n.slot !== 'm13on' || !x.tylko_wybor));
      const tenSam = kand.filter(x => x.typ === stary.typ); if (tenSam.length) kand = tenSam;
      if (!kand.length) { brak++; continue; }
      const dens = x => x.razem.bialko / x.razem.kcal, d0 = dens(stary);
      kand.sort((a, b) => Math.abs(dens(a) - d0) - Math.abs(dens(b) - d0));
      const nowy = los(kand.slice(0, 3)), g = oblicz(plan, cele()).garnki.find(x => x.d === n.d && x.slot === n.slot);
      ustawDanie(n.d, n.slot, nowy.id, g ? g.P / g.K : null); zmieniono++;
    }
  }
  if (plan.start !== orig && inny && inny.start === orig) przelaczTydzien();
  otwartyDzien = null; rysuj();
  if (zmieniono) toastCofnij(`Zamieniono ${zmieniono} ${zmieniono === 1 ? 'danie' : zmieniono < 5 ? 'dania' : 'dań'}${brak ? `, ${brak} bez zamiennika` : ''}`, sn); else pokazToast( (brak ? `Brak zamienników dla ${brak} posiłków — poluzuj wykluczenia` : 'Plan jest zgodny z listą'));
}
function widokWykluczone() {
  const p = wyklOsoba, l = wyklucz[p] || [], wlasne = l.filter(w => !w.startsWith('g:'));
  const pule = [['sn', 'Śniadania'], ['m13ona', '13:00 · ONA'], ['m13on', '13:00 · ON'], ['k18', 'Koktajle ~18:00'], ['ob1', 'Obiady na 1 dzień'], ['ob2', 'Zupy i obiady na 2 dni']];
  const dost = pule.map(([k, et]) => { const wsz = DB.pula[k].filter(d => !ukryte(d.id)); const ok = wsz.filter(d => dopuszcza(d, KTO_PULI[k] || OS)); return { et, ok: ok.length, wsz: wsz.length }; });
  const nar = naruszeniaDwochTygodni().length;
  let h = `<h1>Czego nie jecie</h1><p class="mute">Plan, zamiana dania i „co ugotować z lodówki” będą omijać dania z tymi składnikami. W daniach wspólnych liczy się lista obojga.</p>
    <div class="seg">${OS.map(x => `<button data-wosoba2="${x}" class="${p === x ? 'akt' : ''}">${ETY[x]}${(wyklucz[x] || []).length ? ` · ${(wyklucz[x] || []).length}` : ''}</button>`).join('')}</div>
    <h3>Szybki wybór</h3><div class="chips">${Object.entries(GRUPY_WYKL).map(([k, [et]]) => `<button class="chip ${l.includes('g:' + k) ? 'akt' : ''}" data-wgrupa="${p}:${k}">${esc(et)}</button>`).join('')}</div>
    <h3>Własne słowa</h3><div class="lod-rzad"><input id="wykl-nowe" type="text" placeholder="np. kolendra, tuńczyk, rodzynki" autocomplete="off" autocapitalize="off"><button class="btn glowny maly" data-wdodaj="${p}">Dodaj</button></div>
    ${wlasne.length ? `<div class="chips" style="margin-top:10px">${wlasne.map(w => `<button class="chip akt" data-wusun="${p}|${esc(w)}">${esc(w)} ✕</button>`).join('')}</div>` : '<p class="mute" style="margin-top:8px">Wpisz składnik albo słowo z nazwy dania. Wystarczy początek słowa (np. „kurcz”).</p>'}
    ${(() => { const nie = Object.entries(smaki).filter(([id, x]) => DB.dania.has(id) && OS.some(pp => x[pp] && x[pp].v === 0)); return nie.length ? `<h2>Nie smakowało</h2><div class="karta"><p class="mute" style="margin:0 0 6px">Takie dania wracają rzadziej. Możesz je ukryć całkiem albo wyczyścić ocenę.</p>${nie.map(([id, x]) => `<div class="wpis"><span>${esc(DB.dania.get(id).nazwa)}<br><span class="mute">${OS.filter(pp => x[pp] && x[pp].v === 0).map(pp => ETY[pp]).join(', ')}</span></span><span class="rzad" style="flex:none;flex-wrap:nowrap"><button class="btn maly" data-smak-ukryj="${esc(id)}">Ukryj</button><button class="btn maly" data-smak-czysc="${esc(id)}">Wyczyść</button></span></div>`).join('')}</div>` : ''; })()}
    <h2>Ile dań zostaje</h2><div class="karta wykl-stat">${dost.map(x => `<div class="wykl-w ${x.ok < 2 ? 'zle' : x.ok < 4 ? 'malo' : ''}"><span>${x.et}</span><b>${x.ok} z ${x.wsz}</b>${x.ok < 2 ? '<small>za mało — użyję też dań z wykluczonymi składnikami</small>' : x.ok < 4 ? '<small>mało — plan będzie się powtarzał</small>' : ''}</div>`).join('')}</div>
    ${nar ? `<div class="przyp"><b>${nar} ${nar === 1 ? 'posiłek w planie zawiera' : 'posiłków w planie zawiera'} wykluczone składniki.</b> <button class="btn maly" data-zamien-wykl>Zamień automatycznie</button></div>` : ''}`;
  $('#view').innerHTML = h;
}
function zmienWykl(fn) {
  fn(); zapiszWykl(); rysuj();
  const n = naruszeniaDwochTygodni().length;
  if (n) pokazToast(`${n} ${n === 1 ? 'posiłek' : 'posiłków'} w planie do zamiany`, 'Zamień', zamienNiepasujace);
}
function motywWiersz() {
  return `<div class="motyw-wiersz"><span class="mute">Wygląd</span><div class="seg mini" role="group" aria-label="Wygląd aplikacji">${[['auto', 'Jak system'], ['jasny', 'Jasny'], ['ciemny', 'Ciemny']].map(([k, et]) => `<button data-motyw="${k}" class="${motyw === k ? 'akt' : ''}" aria-pressed="${motyw === k}">${et}</button>`).join('')}</div></div>`;
}
function widokWiecej() {
  const kafel = (tab, tytul, opis, ik) => `<button class="kafel" data-tab="${tab}"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ik}"/></svg></span><span class="kafel-tx"><b>${tytul}</b><small>${opis}</small></span><span class="kafel-str">›</span></button>`;
  const q = (pyt, odp) => `<details class="faq"><summary>${pyt}</summary><p>${odp}</p></details>`;
  $('#view').innerHTML = `<h1>Więcej</h1>${motywWiersz()}
    <h3>Ty i plan</h3>
    ${kafel('podsum', 'Podsumowanie tygodnia', 'Jak Wam poszło: posiłki, kalorie, białko, waga, wydatki', 'M5 20V10M12 20V4M19 20v-7')}
    ${kafel('waga', 'Waga', 'Pomiary i trend dla obojga', 'M3 6h18v12H3zM8.5 11a4 4 0 0 1 7 0M12 14l2-2.5')}
    ${kafel('swipe', 'Co lubicie?', Object.keys(smaki).length ? 'Ocenionych dań: ' + Object.keys(smaki).length + '. Przesuwaj kolejne' : 'Przesuwaj dania i ucz plan Waszego smaku', 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z')}
    ${kafel('wlasne', 'Własne dania', wlasneDania.length ? wlasneDania.length + ' ' + mn(wlasneDania.length, 'danie', 'dania', 'dań') + ' dodanych przez Was' : 'Dodaj własny przepis', 'M12 5v14M5 12h14')}
    ${kafel('wykluczone', 'Czego nie jecie', (wyklucz.ona.length + wyklucz.on.length) ? `ONA: ${wyklucz.ona.length} · ON: ${wyklucz.on.length} wykluczeń` : 'Wyklucz składniki z planu', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12')}
    <h3>Gotowanie i zakupy</h3>
    ${kafel('prep', 'Meal prep', 'Ugotuj raz, jedz kilka razy — plan sesji gotowania', 'M5 11h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM4 8h16M9 5h6')}
    <button class="kafel" data-szybka="skan"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${AKCJE.skan[1]}"/></svg></span><span class="kafel-tx"><b>Skanuj kod produktu</b><small>Dodaj do lodówki z aparatu</small></span><span class="kafel-str">›</span></button>
    ${kafel('paragony', 'Paragony i ceny', paragony.length ? `${paragony.length} ${paragony.length === 1 ? 'paragon' : [2, 3, 4].includes(paragony.length % 10) && (paragony.length % 100 < 10 || paragony.length % 100 >= 20) ? 'paragony' : 'paragonów'} · ceny ${Object.keys(ceny).length} ${Object.keys(ceny).length === 1 ? 'produktu' : 'produktów'}` : 'Dodaj paragon, a zapamiętam ceny i sklepy', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6')}
    <h3>Aplikacja</h3>
    ${kafel('ustawienia', 'Ustawienia', 'Profile, cele, wspólny plan, ulubione dania', 'M4 7h9M17 7h3M4 17h3M11 17h9')}
    <button class="kafel" data-intro="0"><span class="kafel-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></span><span class="kafel-tx"><b>Jak to działa</b><small>Krótkie wprowadzenie krok po kroku</small></span><span class="kafel-str">›</span></button>
    <h2>Najczęstsze pytania</h2>
    ${q('Jak zrobić zakupy?', 'Wejdź w „Zakupy”, zaznacz dni, na które kupujecie, i odhaczaj w sklepie. Danie na dwa dni kupujesz w całości. Odhaczone pozycje trafiają do lodówki.')}
    ${q('Jak zmienić jedzenie na inne?', 'W „Planie” rozwiń dzień i kliknij „zmień” przy posiłku. Możesz szukać po nazwie lub składniku. Gramatury nowego dania dopasują się do tych samych kalorii.')}
    ${q('Kogoś nie ma w danym dniu', 'W „Planie” rozwiń dzień i wybierz „Bez niego” albo „Bez niej”. Posiłki tej osoby znikną, a obiad i zakupy policzą się na jedną osobę.')}
    ${q('Jak ułożyć następny tydzień?', 'W „Planie” na dole jest karta „Ułóż następny tydzień”. Oba tygodnie są potem w jednym widoku, jeden pod drugim.')}
    ${q('Jak podzielić mięso po zakupach?', 'W „Zakupach”, pod wyborem dni, jest karta „Podział mięsa i ryb”: wpisujesz, ile kupiliście (np. 2,5 kg), a apka dzieli to od dziś na kolejne dni: kolejność woreczków, co zostaje w lodówce, co do zamrażarki i co wpisać na etykiecie.')}
    ${q('Co zrobić z resztkami po zakupach?', 'Przy produktach z resztą opakowania lista pisze, w których daniach w planie ich użyjesz, i podpowiada pomysły. W „Lodówce” działa też „Spontaniczne gotowanie”.')}
    ${q('Telefon drugiej osoby', 'W „Ustawieniach” utwórz wspólny plan i wyślij zaproszenie. Plan, lodówka i zakupy synchronizują się między telefonami.')}
    <p class="mute wersja-stopka">Wersja aplikacji: ${esc((window._wersja || '').replace('plan-', '') || '—')}${window.Sync && window.Sync.kod && window.Sync.ostatni ? ` · synchronizacja ${new Date(window.Sync.ostatni).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>`;
}

// Ciekła plama pod aktywną zakładką: przesuwa się sprężyście i na chwilę rozciąga.
function ustawPlame(bez) {
  const nav = $('#tabs'); if (!nav || nav.hidden) return;
  let pl = nav.querySelector('.plama'); if (!pl) { pl = document.createElement('i'); pl.className = 'plama'; nav.prepend(pl); bez = true; }
  const b = nav.querySelector('button.akt'); if (!b) return;
  const x = b.offsetLeft, w = b.offsetWidth; if (!w) return;
  if (bez) pl.style.transition = 'none';
  if (pl._x !== x) { pl.classList.remove('rozciag'); void pl.offsetWidth; if (!bez) pl.classList.add('rozciag'); }
  pl._x = x; pl.style.width = w + 'px'; pl.style.transform = `translateX(${x}px)`;
  if (bez) { void pl.offsetWidth; pl.style.transition = ''; }
}
window.addEventListener('resize', () => ustawPlame(true));
function rysuj() {
  $('#view').oninput = null;
  try { zapiszHistorie(); } catch (e) { /* podsumowanie nie może blokować aplikacji */ }
  ekranStartowy = ekranCzekania = false;
  const S = window.Sync;
  if (S && S.kod && !plan && S.stan !== 'blad') {
    ekranCzekania = true; $('#tabs').hidden = true;
    $('#view').innerHTML = `<p class="pusty">Łączę ze wspólnym planem…</p>`;
    return;
  }
  if (!profil || !zapotrzebowanie(profil.ona) || !zapotrzebowanie(profil.on)) { ekranStartowy = true; $('#tabs').hidden = true; widokUstawienia(true); return; }
  naprawBrakujace();
  if (!window._migrPusz) { window._migrPusz = true; zastosujWlasne(); zastosujPakiety(); migrujPuszki(); migrujScalenia(); migrujLyzkiStanow(); migrujOwoceMroz(); }
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
  const pod = ['waga', 'ustawienia', 'wykluczone', 'paragony', 'prep', 'podsum', 'wlasne', 'swipe'].includes(zakladka);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('akt', b.dataset.tab === (pod ? 'wiecej' : zakladka)));
  document.querySelectorAll('#tabs button').forEach(b => { if (b.classList.contains('akt')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ustawPlame(); if (window._ostZakl !== zakladka) { setTimeout(animujLiczby, 150); window._ostZakl = zakladka; const v = $('#view'); v.classList.remove('wejscie'); void v.offsetWidth; v.classList.add('wejscie'); clearTimeout(window._wejT); window._wejT = setTimeout(() => v.classList.remove('wejscie'), 900); }
  if (zakladka === 'dzis') widokDzis(); else if (zakladka === 'tydzien') widokTydzien(); else if (zakladka === 'zakupy') widokZakupy(); else if (zakladka === 'lodowka') widokLodowka(); else if (zakladka === 'waga') widokWaga(); else if (zakladka === 'ustawienia') widokUstawienia(false); else if (zakladka === 'wykluczone') widokWykluczone(); else if (zakladka === 'paragony') widokParagony(); else if (zakladka === 'podsum') widokPodsumowanie(); else if (zakladka === 'wlasne') widokWlasne(); else if (zakladka === 'swipe') widokSwipe(); else if (zakladka === 'prep') widokPrep(); else widokWiecej();
  if (pod) $('#view').insertAdjacentHTML('afterbegin', `<button class="wstecz" data-tab="wiecej">‹ Więcej</button>`);
  if (!LS.get('intro', false) && profil && plan) { LS.set('intro', true); pokazIntro(0); }
}

function kartaUkryte() {
  const uk = [...DB.dania.values()].filter(d => ukryte(d.id)), ul = [...DB.dania.values()].filter(d => oceny[d.id] === 1);
  return `<h2>Ulubione i ukryte dania</h2><div class="karta"><p class="mute">Ulubione (${ul.length}) pojawiają się w planie częściej i na początku listy przy zamianie. Ukryte nie trafiają do nowych tygodni.</p>
    ${uk.length ? uk.map(d => `<div class="wpis"><span>${esc(d.nazwa)}</span><button class="btn maly" data-ocena="${esc(d.id)}:-1">Przywróć</button></div>`).join('') : '<p class="mute">Nie ukryto żadnego dania. Ukryjesz je w oknie dania lub przy zamianie posiłku.</p>'}</div>`;
}

// ---------- waga ----------
const kgTxt = v => String(Math.round(v * 10) / 10).replace('.', ',');
let wagaOsoba = 'ona', wagaZakres = 90;
function gladkaSciezka(pts, yMin, yMax) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const cy = v => Math.max(yMin, Math.min(yMax, v));
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${cy(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${cy(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function wykresWagi(e, p) {
  if (!e.length) return `<div class="wykres-pusty"><b>Brak pomiarów</b><small>Dodaj pierwszy poniżej. Wykres pojawi się od dwóch pomiarów.</small></div>`;
  const ms = d => new Date(d + 'T12:00:00').getTime(), ost = ms(e[e.length - 1][0]);
  let pt = wagaZakres ? e.filter(([d]) => ms(d) >= ost - wagaZakres * 864e5) : e;
  if (pt.length < 2) pt = e.slice(-2);
  if (pt.length < 2) return `<div class="wykres-pusty"><b>${kgTxt(e[0][1])} kg</b><small>Dodaj kolejny pomiar, a pojawi się wykres.</small></div>`;
  const W = 340, H = 190, L = 42, R = 16, T = 22, B = 28;
  const t0 = ms(pt[0][0]), t1 = ms(pt[pt.length - 1][0]), vs = pt.map(q => q[1]), mn = Math.min(...vs), mx = Math.max(...vs), pad = Math.max(0.4, (mx - mn) * 0.25), lo = mn - pad, hi = mx + pad;
  const X = t => L + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const pts = pt.map(([d, v]) => [X(ms(d)), Y(v)]), ostP = pts[pts.length - 1], ostV = pt[pt.length - 1][1];
  const f = t => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  const lin = gladkaSciezka(pts, T, H - B), pole = `${lin} L${ostP[0].toFixed(1)},${H - B} L${pts[0][0].toFixed(1)},${H - B} Z`;
  const siatka = [hi - pad * 0.3, (hi + lo) / 2, lo + pad * 0.3].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="3 4"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${kgTxt(v)}</text>`).join('');
  const lx = Math.min(Math.max(ostP[0], L + 22), W - R - 22);
  return `<svg class="wykres ${p}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wykres wagi"><defs><linearGradient id="gw${p}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    ${siatka}<path d="${pole}" fill="url(#gw${p})"/><path d="${lin}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.slice(0, -1).map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="2.6" fill="var(--card)" stroke="currentColor" stroke-width="1.6"/>`).join('')}
    <circle cx="${ostP[0].toFixed(1)}" cy="${ostP[1].toFixed(1)}" r="9" fill="currentColor" fill-opacity=".18"/><circle cx="${ostP[0].toFixed(1)}" cy="${ostP[1].toFixed(1)}" r="5" fill="currentColor" stroke="var(--card)" stroke-width="2"/>
    <g transform="translate(${lx.toFixed(1)},${(ostP[1] - 20).toFixed(1)})"><rect x="-26" y="-12" width="52" height="20" rx="10" fill="currentColor"/><text x="0" y="2.5" text-anchor="middle" class="bab">${kgTxt(ostV)} kg</text></g>
    <text x="${L}" y="${H - 8}">${f(t0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${f(t1)}</text></svg>`;
}
// Adaptacyjne kalorie: z trendu wagi (regresja z ostatnich 4 tygodni) porównuję realne tempo z celem diety i proponuję małą korektę kcal (maks. 150 na raz, ±400 łącznie).
const TEMPO_CEL = { redukcja: { cel: -0.5, min: -0.9, max: -0.25 }, utrzymanie: { cel: 0, min: -0.15, max: 0.15 }, masa: { cel: 0.25, min: 0.1, max: 0.5 } };   // % masy ciała na tydzień
function trendWagi(p, okno = 28) {
  const e = Object.entries(waga[p] || {}).sort(); if (!e.length) return null;
  const ms = d => new Date(d + 'T12:00:00').getTime() / 864e5, ost = ms(e[e.length - 1][0]);
  const kor = korekta[p], od = kor.od ? Math.max(ms(kor.od) + 5, ost - okno) : ost - okno;   // po korekcie czekam 5 dni, aż waga zareaguje
  const pt = e.filter(([d]) => ms(d) >= od).map(([d, v]) => [ms(d), v]);
  const rozp = pt.length ? pt[pt.length - 1][0] - pt[0][0] : 0;
  if (pt.length < 3 || rozp < 10) return { zaMalo: true, n: pt.length, dni: Math.round(rozp) };
  const n = pt.length, mx = sum(pt, q => q[0]) / n, my = sum(pt, q => q[1]) / n, sxx = sum(pt, q => (q[0] - mx) ** 2), sxy = sum(pt, q => (q[0] - mx) * (q[1] - my));
  const nach = sxy / sxx;   // kg na dobę
  return { zaMalo: false, n, dni: Math.round(rozp), tydz: nach * 7, proc: nach * 7 / my * 100, masa: my, ostWiek: Math.round(new Date(isoDzis() + 'T12:00:00').getTime() / 864e5 - ost) };
}
function propozycjaKorekty(p) {
  const pr = profilEf(p), t = trendWagi(p);
  if (!pr || !profil[p]) return { stan: 'brak' };
  if (profil[p].wlasne) return { stan: 'wlasne' };
  if (!t || t.zaMalo) return { stan: 'dane', t };
  if (t.ostWiek > 10) return { stan: 'stare', t };
  const cel = TEMPO_CEL[pr.cel] || TEMPO_CEL.utrzymanie, kor = korekta[p];
  const bmi = pr.waga / ((pr.wzrost / 100) ** 2);
  if (pr.cel === 'redukcja' && bmi < 18.5 && t.proc < cel.min) return { stan: 'ok', t, cel, uwaga: 'Przy niskim BMI nie proponuję dalszego obniżania kalorii.' };
  if (t.proc >= cel.min && t.proc <= cel.max) return { stan: 'ok', t, cel };
  if (kor.odloz && kor.odloz > isoDzis()) return { stan: 'odlozone', t, cel };
  if (kor.od && (new Date(isoDzis()) - new Date(kor.od)) / 864e5 < 14) return { stan: 'czekaj', t, cel };
  let delta = Math.round(((cel.cel - t.proc) / 100 * t.masa * 7700 / 7) / 10) * 10;
  delta = Math.max(-150, Math.min(150, delta));
  const cc = cele()[p], bmr = zapotrzebowanie(pr).bmr, podloga = Math.max(pr.plec === 'm' ? 1500 : 1200, Math.round(bmr / 10) * 10);
  if (cc.kcal + delta < podloga) delta = podloga - cc.kcal;
  if (Math.abs(kor.kcal + delta) > 400) delta = Math.sign(delta) * 400 - kor.kcal;
  if (Math.abs(delta) < 40) return { stan: 'granica', t, cel };
  return { stan: 'propozycja', t, cel, delta };
}
function zastosujKorekte(p, delta, auto) {
  const kor = korekta[p]; kor.kcal += delta; kor.od = isoDzis(); kor.odloz = null; kor.hist = (kor.hist || []).concat([{ d: isoDzis(), delta }]).slice(-12);
  LS.set('korekta', korekta); Z([[['korekta', p], kor]]);
  rysuj(); pokazToast(`${auto ? 'Automatyczna korekta' : 'Zastosowano'}: ${ETY[p]} ${delta > 0 ? '+' : ''}${delta} kcal dziennie. Plan przeliczony.`);
}
function kartaAdaptacyjna(p) {
  const pr = propozycjaKorekty(p), kor = korekta[p], t = pr.t, z1 = v => (v > 0 ? '+' : '') + v.toFixed(2).replace('.', ',');
  let tr = '';
  if (pr.stan === 'dane') tr = `<p class="mute">Zbieram dane. Potrzebuję co najmniej 3 pomiarów z ostatnich 4 tygodni rozłożonych na min. 10 dni (masz ${t ? t.n : 0}${t && t.dni ? ', rozpiętość ' + t.dni + ' dni' : ''}).${kor.od ? ' Po ostatniej korekcie liczę dopiero od 5 dni później.' : ''}</p>`;
  else if (pr.stan === 'wlasne') tr = `<p class="mute">Masz ustawiony własny cel kalorii, więc nie proponuję korekt. Usuń go w Ustawieniach, żeby włączyć adaptację.</p>`;
  else if (pr.stan === 'stare') tr = `<p class="mute">Ostatni pomiar jest sprzed ponad 10 dni. Zważ się, a ocenię trend.</p>`;
  else if (pr.stan === 'brak') tr = '';
  else {
    tr = `<div class="adapt-liczby"><div><small>Tempo wagi</small><b>${z1(t.tydz)} kg/tydz.</b><small>${z1(t.proc)}% masy ciała</small></div><div><small>Cel diety</small><b>${z1(pr.cel.min)}…${z1(pr.cel.max)}%</b><small>na tydzień</small></div></div>`;
    if (pr.stan === 'ok') tr += `<p class="adapt-ok">Tempo mieści się w celu. Nic nie zmieniam.${pr.uwaga ? ' ' + esc(pr.uwaga) : ''}</p>`;
    else if (pr.stan === 'odlozone') tr += `<p class="mute">Korekta odłożona do ${new Date(kor.odloz + 'T12:00:00').toLocaleDateString('pl-PL')}.</p>`;
    else if (pr.stan === 'czekaj') tr += `<p class="mute">Ostatnia korekta była niedawno. Dam znać po 14 dniach, gdy waga zdąży zareagować.</p>`;
    else if (pr.stan === 'granica') tr += `<p class="mute">Tempo odbiega od celu, ale korekta byłaby poniżej bezpiecznej granicy lub zbyt mała, żeby ją proponować.</p>`;
    else tr += `<div class="adapt-prop"><b>Proponuję ${pr.delta > 0 ? '+' : ''}${pr.delta} kcal dziennie</b><p class="mute" style="margin:4px 0 10px">${pr.cel.cel < 0 ? (t.proc > 0.05 ? 'Waga rośnie, a cel to redukcja' : t.proc > pr.cel.max ? 'Waga spada wolniej' : 'Waga spada szybciej') : pr.cel.cel > 0 ? (t.proc < pr.cel.min ? 'Waga rośnie wolniej' : 'Waga rośnie szybciej') : (t.proc > pr.cel.max ? 'Waga rośnie' : 'Waga spada')} niż zakłada cel „${esc(CEL[profil[p].cel] ? CEL[profil[p].cel][0] : profil[p].cel)}”. Zakładam, że jecie według planu.</p><div class="rzad"><button class="btn glowny" data-kor-zastosuj="${p}:${pr.delta}">Zastosuj</button><button class="btn" data-kor-odloz="${p}">Nie teraz</button></div></div>`;
  }
  return `<div class="karta adapt"><h3 style="margin:0 0 8px">Adaptacyjne kalorie · ${ETY[p]}</h3>${tr}
    ${kor.kcal ? `<p class="mute" style="margin-top:10px">Aktywna korekta: <b>${kor.kcal > 0 ? '+' : ''}${kor.kcal} kcal</b> dziennie${kor.od ? ' (od ' + new Date(kor.od + 'T12:00:00').toLocaleDateString('pl-PL') + ')' : ''}. <button class="btn maly" data-kor-reset="${p}">Wyzeruj</button></p>` : ''}
    <label class="adapt-auto"><input type="checkbox" data-kor-auto="${p}" ${kor.auto ? 'checked' : ''}><span>Stosuj korekty automatycznie po zapisaniu wagi</span></label>
    <p class="mute" style="font-size:12.5px;margin:8px 0 0">To szacunek, nie zalecenie medyczne. Zmiany są małe (maks. 150 kcal na raz, 400 łącznie) i nigdy poniżej bezpiecznej granicy. Przy chorobach, ciąży lub zaburzeniach odżywiania skonsultuj dietę ze specjalistą.</p></div>`;
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
  const dobry = (cel, zm) => cel === 'redukcja' ? zm < 0 : cel === 'masa' ? zm > 0 : Math.abs(zm) < 1;
  const dane = p => { const e = Object.entries(waga[p] || {}).sort(), ost = e[e.length - 1], zm = ost && e.length > 1 ? ost[1] - e[0][1] : null; return { e, ost, zm, t: tempoWagi(p) }; };
  let h = `<h1>Waga</h1>` + wskazowka('waga', 'Ważcie się raz w tygodniu, rano, na czczo. Jeden pomiar waha się przez wodę, liczy się trend. To szacunek, nie zalecenie medyczne.');
  h += `<div class="wtile-rzad">` + OS.map(p => { const x = dane(p); return `<button class="wtile ${p} ${wagaOsoba === p ? 'akt' : ''}" data-wosoba="${p}"><b>${ETY[p]}</b><span class="duze">${x.ost ? kgTxt(x.ost[1]) + ' kg' : '—'}</span><small class="${x.zm == null ? '' : dobry((profil[p] || {}).cel, x.zm) ? 'dobry' : 'zly'}">${x.zm == null ? 'dodaj pomiary' : (x.zm > 0 ? '▲ +' : x.zm < 0 ? '▼ ' : '') + kgTxt(x.zm) + ' kg od początku'}</small></button>`; }).join('') + `</div>`;
  const p = wagaOsoba, x = dane(p), e = x.e, ost = x.ost, ms = d => new Date(d + 'T12:00:00').getTime();
  h += `<div class="karta wykres-karta ${p}"><div class="rzad-nag"><h3 style="margin:0" class="${p}">${ETY[p]} · trend</h3></div>
    <div class="seg mini" style="margin:10px 0 6px">${[[28, '4 tyg.'], [90, '3 mies.'], [365, 'Rok'], [0, 'Wszystko']].map(([v, et]) => `<button data-wzakres="${v}" class="${wagaZakres === v ? 'akt' : ''}">${et}</button>`).join('')}</div>
    ${wykresWagi(e, p)}`;
  if (e.length > 1) {
    const wart = e.map(q => q[1]), min = Math.min(...wart), max = Math.max(...wart);
    h += `<div class="wstat"><div><small>Najniższa</small><b>${kgTxt(min)} kg</b></div><div><small>Najwyższa</small><b>${kgTxt(max)} kg</b></div><div><small>Tempo</small><b>${x.t == null ? '—' : (x.t > 0 ? '+' : '') + x.t.toFixed(2).replace('.', ',') + ' kg/tydz.'}</b></div></div>`;
  }
  if (x.t !== null) h += `<p class="mute" style="margin:10px 0 0">${esc((t => t.charAt(0).toUpperCase() + t.slice(1))(opisTempa((profil[p] || {}).cel, x.t).replace(/^tempo [^—]*— /, '')))}.</p>`;
  h += `</div>`;
  h += kartaAdaptacyjna(p);
  const start = ost ? ost[1] : ((profil[p] || {}).waga || 70);
  h += `<div class="karta"><h3 style="margin:0 0 10px">Nowy pomiar</h3>
    <div class="wpisz"><button class="strz" data-wkstep="${p}:-0.1" aria-label="Mniej">−</button><label class="wpisz-pole"><input type="text" inputmode="decimal" id="wk-${p}" value="${kgTxt(start)}" aria-label="Waga w kg"><span>kg</span></label><button class="strz" data-wkstep="${p}:0.1" aria-label="Więcej">+</button></div>
    <label class="pole"><span>Data</span><input type="date" id="wd-${p}" value="${isoDzis()}" max="${isoDzis()}"></label>
    <button class="btn glowny szeroki" data-zapisz-wage="${p}">Zapisz pomiar</button>`;
  const cc = cele()[p]; if (ost && cc) h += `<p class="mute" style="margin:12px 0 0">Plan liczy się z ostatniego pomiaru (${kgTxt(ost[1])} kg): cel ${cc.kcal} kcal i ${cc.bMin}–${cc.bMax} g białka dziennie. Po zapisaniu nowej wagi gramatury dań dopasują się same.</p>`;
  h += `</div>`;
  if (e.length) h += `<h2>Historia</h2><div class="karta hist">` + e.slice(-10).reverse().map(([d, v], i, arr) => { const prev = e[e.length - 1 - i - 1], zm = prev ? v - prev[1] : null; return `<div class="hist-w"><span class="hist-d">${new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>${kgTxt(v)} kg</b><span class="hist-zm ${zm == null ? '' : dobry((profil[p] || {}).cel, zm) ? 'dobry' : 'zly'}">${zm == null ? '' : zm === 0 ? '=' : (zm > 0 ? '▲ ' : '▼ ') + kgTxt(Math.abs(zm))}</span><button class="btn maly" data-usun-wage="${p}|${d}" aria-label="Usuń pomiar">✕</button></div>`; }).join('') + `</div>`;
  $('#view').innerHTML = h;
}
function zapiszWage(p) {
  const v = parseFloat(String(($('#wk-' + p) || {}).value).replace(',', '.')), d = ($('#wd-' + p) || {}).value || isoDzis();
  if (!(v >= 25 && v <= 300)) { pokazToast('Wpisz wagę w kilogramach, np. 62,4.'); return; }
  const w = Math.round(v * 10) / 10;
  const przed = cele()[p];
  waga[p] = waga[p] || {}; waga[p][d] = w;
  LS.set('waga', waga); Z([[['waga', p, d], w]]);
  rysuj();
  const po = cele()[p];
  pokazToast(przed && po && przed.kcal !== po.kcal ? `Zapisano. Plan przeliczony: ${ETY[p]} ${przed.kcal} → ${po.kcal} kcal` : 'Zapisano pomiar');
  if (korekta[p].auto) { const pr = propozycjaKorekty(p); if (pr.stan === 'propozycja') setTimeout(() => zastosujKorekte(p, pr.delta, true), 600); }
}

// ---------- lodówka ----------
function zmienLodowke(p, u, delta) {
  delta = Math.round(delta * 100) / 100;
  if (!delta) return;
  lodowka[p] = lodowka[p] || {};
  const bylo = sum(Object.values(lodowka[p]), v => v);
  lodowka[p][u] = Math.round(((lodowka[p][u] || 0) + delta) * 100) / 100;
  LS.set('lodowka', lodowka);
  Z([[['lodowka', p, u], { __inc: delta }]]);   // przyrost, nie wartość: dwa telefony dodają się do siebie
  if (delta > 0 && (bylo < 0.5 || !lodData[p])) { lodData[p] = isoDzis(); LS.set('lodData', lodData); Z([[['lodData', p], lodData[p]]]); }   // data zakupu: od niej liczę świeżość
  else if (delta < 0 && lodData[p] && sum(Object.values(lodowka[p]), v => v) < 0.5) { delete lodData[p]; LS.set('lodData', lodData); Z([[['lodData', p], undefined]]); }
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
let lodKat = 'wszystko', lodSzukaj = '', dodU = 'g', dodAuto = '', toastFn = null, toastT = null;
const KROK_LOD = u => (u === 'g' || u === 'ml') ? 50 : 1;
const ILOSCI_LOD = u => u === 'g' || u === 'ml' ? [100, 250, 500, 1000] : u === 'szt.' ? [1, 2, 4, 6, 10] : u === 'krom.' ? [4, 8, 16] : [1, 2, 3];
// Krótki komunikat nad paskiem zakładek, opcjonalnie z przyciskiem (np. „Cofnij”).
const haptyka = (ms = 12) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* brak wibracji */ } };
// Konfetti po zjedzeniu wszystkich posiłków dnia: kilkadziesiąt kolorowych kawałków, sprząta się samo. Przy „ogranicz ruch” — tylko komunikat.
function konfetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const k = document.createElement('div'); k.className = 'konfetti'; k.setAttribute('aria-hidden', 'true');
  const kol = ['#3ccf91', '#7ad7a3', '#f391aa', '#86bcee', '#f0b25e', '#ffffff'];
  for (let i = 0; i < 42; i++) { const e = document.createElement('i'); e.style.cssText = `left:${Math.random() * 100}%;background:${kol[i % kol.length]};--dx:${Math.round((Math.random() - .5) * 160)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${Math.round(Math.random() * 350)}ms;animation-duration:${1500 + Math.round(Math.random() * 1100)}ms;width:${6 + Math.round(Math.random() * 6)}px;height:${9 + Math.round(Math.random() * 8)}px`; k.appendChild(e); }
  document.body.appendChild(k); haptyka([20, 40, 30]); setTimeout(() => k.remove(), 3200);
}
// Liczby w pierścieniach „liczą się” od zera przy wejściu na ekran.
function animujLiczby() {
  document.querySelectorAll('[data-licz]').forEach(el => {
    const cel = +el.dataset.licz, t0 = performance.now(), dur = 1100; if (!cel) return;
    const f = t => { const x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 3); el.firstChild.nodeValue = Math.round(cel * e); if (x < 1) requestAnimationFrame(f); }; requestAnimationFrame(f);
  });
}
function pokazToast(tekst, et, fn, ms) {
  const el = $('#toast'); if (!el) return;
  toastFn = fn || null;
  el.innerHTML = `<span>${esc(tekst)}</span>${et ? `<button data-toast>${esc(et)}</button>` : ''}`;
  el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; toastFn = null; }, ms || 5000);
}
// Cofanie akcji zbiorczych: migawka planu, odhaczeń, zjedzonych i lodówki przed zmianą; „Cofnij” w komunikacie przywraca ją (i wysyła do wspólnego planu).
function snapStanu() { return JSON.stringify({ plan, inny, odhaczone, zuzyte, lodowka }); }
function przywrocSnap(sn) {
  const o = JSON.parse(sn); plan = o.plan; inny = o.inny; odhaczone = o.odhaczone || {}; zuzyte = o.zuzyte || {}; lodowka = o.lodowka || {};
  LS.set('plan', plan); LS.set('inny', inny); LS.set('odhaczone', odhaczone); LS.set('zuzyte', zuzyte); LS.set('lodowka', lodowka);
  Z([[['start'], plan.start], [['dni'], dniMapa()], [['odhaczone'], odhaczone], [['zuzyte'], zuzyte], [['lodowka'], lodowka], [['inny'], paczkaDoChmury(inny)]]);
  otwartyDzien = null; zamknijOkno(); rysuj(); pokazToast('Cofnięto');
}
const toastCofnij = (tekst, sn) => pokazToast(tekst, 'Cofnij', () => przywrocSnap(sn), 9000);
function filtrujLodowke() {
  const q = znorm(lodSzukaj.trim());
  document.querySelectorAll('.stan2').forEach(r => { r.hidden = !!q && !r.dataset.nm.includes(q); });
  document.querySelectorAll('.lod-grupa').forEach(g => { g.hidden = ![...g.querySelectorAll('.stan2')].some(r => !r.hidden); });
  const brak = $('#lod-brak'); if (brak) brak.hidden = !q || [...document.querySelectorAll('.stan2')].some(r => !r.hidden);
}
function widokLodowka() {
  const w = oblicz(plan, cele()), pr = prognoza(w), niskie = new Map(pr.map(x => [x.produkt, x]));
  const katNazwa = { 'świeże': 'Świeże', 'zamrażarka': 'Mrożone', 'zapas': 'Zapasy' }, grupy = { 'świeże': new Map(), 'zamrażarka': new Map(), 'zapas': new Map() };
  for (const [pp, us] of Object.entries(lodowka)) { const jed = Object.entries(us); if (!jed.length) continue; const k = (DB.produkty.get(pp) || {}).kat; grupy[k in grupy ? k : 'zapas'].set(pp, jed); }
  const razem = Object.values(grupy).reduce((a, m) => a + m.size, 0);
  let h = `<h1>Lodówka</h1>` + wskazowka('lodowka', 'Lodówka liczy się sama: zakupy ją dopisują, a „zjedzone” odejmuje. Przyciskami − i + poprawisz ilość, a „＋ Dodaj” wpisze nowe produkty.');
  h += `<div class="lod-kafle"><div><b>${razem}</b><small>${mn(razem, 'produkt w domu', 'produkty w domu', 'produktów w domu')}</small></div><div class="${pr.length ? 'ostrz' : ''}"><b>${pr.length}</b><small>${pr.length === 1 ? 'zaczyna brakować' : 'zaczynają brakować'}</small></div></div>
    <div class="rzad" style="margin:10px 0"><button class="btn glowny" data-szybka="skan">Skanuj kod</button><button class="btn" data-szybka="dodaj">＋ Dodaj ręcznie</button></div>
    <button class="spont-cta" id="spont"><span class="spont-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg></span><span class="spont-tx"><b>Co ugotować z tego, co mamy?</b><small>Spontaniczne gotowanie z Waszej lodówki</small></span><span class="spont-str">›</span></button>`;
  { const zp = zapasPrepu(isoDzis()); if (zp.zapas.length) h += `<div class="karta prep-radar tak"><div class="prep-r-gora"><span class="prep-r-ik"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM4 8h16M9 5h6"/></svg></span><div><b>Ugotowane na zapas</b><small>z sesji meal prep, w pojemnikach</small></div></div>${zp.html}</div>`; }
  if (pr.length) h += `<h2>Zaczyna brakować</h2><div class="alerty">${pr.map(x => `<button class="alert ${x.pilne ? 'pilne' : ''}" data-popraw="${esc(x.produkt)}|${esc(x.u)}"><b>${esc(x.produkt)}</b><span>brakuje ${fmtStan(x.brakuje, x.u)}</span><small>od: ${esc(x.dish)} (${DNI_KR[x.d]})</small><em>Popraw ilość ›</em></button>`).join('')}</div><button class="btn szeroki" id="doZakupow" style="margin-top:10px">Otwórz listę zakupów</button><p class="mute">Kliknij kartę, jeśli ilość w lodówce się nie zgadza — poprawisz ją od razu. Prognoza zakłada, że jecie według planu i zaznaczacie „zjedzone”.</p>`;
  h += `<h2>W lodówce</h2><div class="lod-filtr"><div class="lod-rzad"><input id="lod-szukaj" type="search" placeholder="Szukaj w lodówce…" autocomplete="off" value="${esc(lodSzukaj)}"><button class="btn glowny maly" data-dodaj>＋ Dodaj</button></div>
    <div class="seg mini">${[['wszystko', 'Wszystko'], ['świeże', 'Świeże'], ['zamrażarka', 'Mrożone'], ['zapas', 'Zapasy']].map(([k, et]) => `<button data-lodkat="${k}" class="${lodKat === k ? 'akt' : ''}">${et}</button>`).join('')}</div></div>`;
  const kontrolka = (pp, u, q) => q < 0.5
    ? `<div class="stan-ster"><span class="ostrz-txt jedn-k">skończone</span><button class="btn maly" data-stanusun="${esc(pp)}|${esc(u)}">Usuń</button><button class="stp" data-stpm="${esc(pp)}|${esc(u)}|1" aria-label="Więcej">+</button></div>`
    : `<div class="stan-ster"><button class="stp" data-stpm="${esc(pp)}|${esc(u)}|-1" aria-label="Mniej">−</button><input type="text" inputmode="decimal" data-sp="${esc(pp)}" data-su="${esc(u)}" value="${String(Math.max(0, Math.round(q * 10) / 10)).replace('.', ',')}" aria-label="Ilość ${esc(pp)}"><span class="jedn">${esc(u)}</span><button class="stp" data-stpm="${esc(pp)}|${esc(u)}|1" aria-label="Więcej">+</button></div>`;
  let ile = 0;
  for (const k of ['świeże', 'zamrażarka', 'zapas']) {
    if (lodKat !== 'wszystko' && lodKat !== k) continue;
    const l = [...grupy[k].entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl')); if (!l.length) continue; ile += l.length;
    h += `<div class="lod-grupa"><h3>${katNazwa[k]} · ${l.length}</h3><div class="karta">${l.map(([pp, jed]) => { const n = niskie.get(pp); return `<div class="stan2 ${n ? 'nisko' : ''}" data-nm="${esc(znorm(pp))}"><span class="stan-ik k-${k === 'zamrażarka' ? 'zam' : k === 'zapas' ? 'zap' : 'swi'}">${esc(pp.charAt(0).toUpperCase())}</span>
      <div class="stan-nm"><b>${esc(pp)}</b>${(() => { const f = swiezosc(pp); return f ? `<small class="swiez ${f.pilne ? 'pilne' : ''}">kupione ${f.wiek === 0 ? 'dziś' : f.wiek + ' ' + mn(f.wiek, 'dzień', 'dni', 'dni') + ' temu'} · ${swiezoscTxt(f)}</small>` : ''; })()}${n ? `<small class="ostrz-txt">kończy się · od ${DNI_KR[n.d]}</small>` : ''}${(() => { const pk = pakProd(pp), jp = pk && jed.find(([u]) => u === pk.u); if (!pk || !jp) return ''; return `<small class="pak-info">${jp[1] >= 0.5 ? `≈ ${fmtPak(jp[1] / pk.r)} × ${esc(pk.et)} ${pk.r} ${esc(pk.u)} · ` : ''}<button class="link" data-stpak="${esc(pp)}|${esc(pk.u)}|${pk.r}">＋ opak.</button></small>`; })()}</div>
      <div class="stan-kol">${jed.sort((a, b) => a[0].localeCompare(b[0])).map(([u, q]) => kontrolka(pp, u, q)).join('')}</div></div>`; }).join('')}</div></div>`;
  }
  h += `<div class="karta pusta-karta" id="lod-brak" hidden><b>Nic nie pasuje</b><p class="mute">Spróbuj innego słowa albo dodaj ten produkt przyciskiem „＋ Dodaj”.</p></div>`;
  if (!ile) h += `<div class="karta pusta-karta"><b>${razem ? 'Nic w tej kategorii' : 'Lodówka jest pusta'}</b><p class="mute">${razem ? 'Zmień filtr powyżej.' : 'Odhaczaj zakupy na liście — wpadną tu same. Możesz też wpisać, co macie w domu.'}</p><button class="btn glowny szeroki" data-dodaj>＋ Dodaj produkty</button></div>`;
  $('#view').innerHTML = h;
  filtrujLodowke();
}
// Okno dodawania: podpowiedzi produktów, wybór jednostki, szybkie ilości; zostaje otwarte, żeby dodać kilka rzeczy pod rząd.
function oknoDodaj(tryb) {
  tryb = tryb || 'jeden'; dodAuto = '';
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Dodaj do lodówki</h2><button class="btn maly" data-zamknij>Gotowe</button></div>
    <div class="seg"><button data-dodtryb="jeden" class="${tryb === 'jeden' ? 'akt' : ''}">Jeden produkt</button><button data-dodtryb="wiele" class="${tryb === 'wiele' ? 'akt' : ''}">Wiele naraz</button></div>` + (tryb === 'jeden' ? `
    <label class="pole"><span>Produkt</span><input id="dod-p" autocomplete="off" autocapitalize="off" placeholder="np. kurczak, ryż, jajka"></label>
    <div class="chips" id="dod-sug"></div>
    <label class="pole"><span>Ilość</span><input id="dod-q" type="text" inputmode="decimal" placeholder="np. 500"></label>
    <div class="chips" id="dod-ilosci"></div>
    <div class="seg mini" id="dod-jedn" style="margin-top:10px"></div><p class="mute" id="dod-info" style="margin:8px 0 0"></p>
    <button class="btn glowny szeroki" id="dodajStan" style="margin-top:14px">Dodaj do lodówki</button>` : `
    <p class="mute">Po jednej w linii, np. „kurczak 500 g”, „jajka 6”, „ryż”. Bez ilości wstawię typową paczkę.</p>
    <textarea id="szybkie-tekst" rows="6" placeholder="kurczak 500 g&#10;jajka 6&#10;ryż"></textarea><button class="btn glowny szeroki" id="szybkie">Dodaj wszystko</button>`);
  $('#modal').hidden = false;
  if (tryb === 'jeden') { odswiezDodawanie(); setTimeout(() => { const i = $('#dod-p'); if (i) i.focus(); }, 60); }
}
// Korekta ilości z karty „zaczyna brakować”: gdy apka źle liczy (zły wpis, coś dokupione poza listą), wpisujesz, ile faktycznie jest.
function oknoPopraw(pp, uu) {
  const cur = (lodowka[pp] || {})[uu] || 0, x = prognoza(oblicz(plan, cele())).find(y => y.produkt === pp && y.u === uu);
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Popraw ilość: ${esc(pp)}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">${x ? `Wg planu zabraknie ${fmtStan(x.brakuje, uu)}, najpierw przy: ${esc(x.dish)} (${DNI[x.d].toLowerCase()}). ` : ''}Apka myśli, że masz <b>${fmtStan(Math.max(0, cur), uu)}</b>. Jeśli to nieprawda, wpisz, ile masz naprawdę.</p>
    <div class="wpisz"><button class="strz" data-pop-step="${KROK_LOD(uu) * -1}" aria-label="Mniej">−</button><label class="wpisz-pole"><input type="text" inputmode="decimal" id="pop-q" value="${String(Math.max(0, Math.round(cur * 10) / 10)).replace('.', ',')}" aria-label="Ile masz"><span>${esc(uu)}</span></label><button class="strz" data-pop-step="${KROK_LOD(uu)}" aria-label="Więcej">+</button></div>
    <input type="hidden" id="pop-p" value="${esc(pp)}"><input type="hidden" id="pop-u" value="${esc(uu)}">
    <button class="btn glowny szeroki" id="popZapisz">Zapisz ilość</button>
    <div class="rzad" style="margin-top:8px"><button class="btn" id="popZero">Nie mam wcale</button><button class="btn" data-zamknij>Zostaw bez zmian</button></div>`;
  $('#modal').hidden = false;
  setTimeout(() => { const i = $('#pop-q'); if (i) { i.focus(); i.select(); } }, 60);
}
function zapiszPoprawke(zero) {
  const pp = $('#pop-p').value, uu = $('#pop-u').value, cur = (lodowka[pp] || {})[uu] || 0;
  const v = zero ? 0 : parseFloat(String($('#pop-q').value).replace(',', '.'));
  if (!(v >= 0)) { pokazToast('Wpisz ilość, np. 300'); return; }
  zmienLodowke(pp, uu, v - cur);
  if (v === 0 && lodowka[pp] && Math.abs(lodowka[pp][uu] || 0) < 0.01) { delete lodowka[pp][uu]; if (!Object.keys(lodowka[pp]).length) delete lodowka[pp]; LS.set('lodowka', lodowka); Z([[['lodowka', pp, uu], undefined]]); }
  $('#modal').hidden = true; rysuj();
  pokazToast(v === 0 ? `Usunięto z lodówki: ${pp}` : `Poprawiono: ${pp} ${fmtStan(v, uu)}`);
}
function odswiezDodawanie() {
  const wpis = ($('#dod-p') || {}).value || '', zn = znorm(wpis.trim()), nazwa = [...DB.produkty.keys()].find(k => znorm(k) === zn) || wpis.trim();
  const sug = zn ? [...DB.produkty.keys()].filter(k => znorm(k).includes(zn) && znorm(k) !== zn).sort((a, b) => a.length - b.length).slice(0, 6) : [];
  if ($('#dod-sug')) $('#dod-sug').innerHTML = sug.map(k => `<button class="chip" data-dodp="${esc(k)}">${esc(k)}</button>`).join('');
  const pk = pakProd(nazwa);
  { let kp = DB.produkty.get(nazwa); if (!kp && zn.length >= 3) { const dp = dopasujProdukt(wpis.trim()); if (dp && dp.produkt && !dp.pomin) kp = DB.produkty.get(dp.produkt); } if (kp && nazwa !== dodAuto && ['g', 'ml', 'szt.', 'krom.'].includes(kp.u)) { dodU = kp.u; dodAuto = nazwa; } }   // wpisany znany produkt: od razu jego jednostka (mleko → ml)
  if (dodU === 'opak.' && !pk) dodU = 'g';
  const il = dodU === 'opak.' ? [1, 2, 3, 4, 6].map(x => [x, '']) : ILOSCI_LOD(dodU).map(x => [x, '']);
  if (dodU !== 'opak.' && pk && pk.u === dodU && !il.some(x => x[0] === pk.r)) il.push([pk.r, ' (opak.)']);
  if ($('#dod-ilosci')) $('#dod-ilosci').innerHTML = il.map(([x, et]) => `<button class="chip" data-dodq="${x}">${x}${et}</button>`).join('');
  if ($('#dod-jedn')) $('#dod-jedn').innerHTML = ['g', 'ml', 'szt.', 'krom.'].concat(pk ? ['opak.'] : []).map(u => `<button data-dodu="${u}" class="${dodU === u ? 'akt' : ''}">${u === 'opak.' ? esc(pk.et) : u}</button>`).join('');
  const q = parseFloat(String(($('#dod-q') || {}).value).replace(',', '.'));
  if ($('#dod-info')) $('#dod-info').innerHTML = pk ? `1 ${esc(pk.et)} = <b>${pk.r} ${esc(pk.u)}</b> (z paragonów)${dodU === 'opak.' && q > 0 ? ` → ${fmtPak(q)} × ${pk.r} = <b>${fmtPak(q * pk.r)} ${esc(pk.u)}</b>` : ''}` : '';
}
function dodajStanReczny() {
  const n = (($('#dod-p') || {}).value || '').trim(), q = parseFloat(String(($('#dod-q') || {}).value).replace(',', '.'));
  if (!n) { pokazToast('Wpisz nazwę produktu'); const i = $('#dod-p'); if (i) i.focus(); return; }
  if (!(q > 0)) { pokazToast('Wpisz ilość, np. 500'); const i = $('#dod-q'); if (i) i.focus(); return; }
  const znany = [...DB.produkty.keys()].find(k => znorm(k) === znorm(n)) || n;
  const pk = dodU === 'opak.' ? pakProd(znany) : null, qb = pk ? q * pk.r : q, ub = pk ? pk.u : dodU;
  zmienLodowke(znany, ub, qb); rysuj();
  pokazToast(pk ? `Dodano: ${znany} ${fmtPak(q)} × ${pk.et} ${pk.r} ${pk.u} = ${fmtStan(qb, ub)}` : `Dodano: ${znany} ${fmtStan(q, dodU)}`);
  $('#dod-p').value = ''; $('#dod-q').value = ''; odswiezDodawanie(); $('#dod-p').focus();
}
function szybkieDodanie(tekst) {
  const mapa = { g: 'g', gr: 'g', kg: 'kg', ml: 'ml', l: 'l', szt: 'szt.', 'szt.': 'szt.', sztuk: 'szt.', sztuki: 'szt.', krom: 'krom.', 'krom.': 'krom.', pusz: 'opak.', 'pusz.': 'opak.', puszka: 'opak.', puszki: 'opak.', puszek: 'opak.', opak: 'opak.', 'opak.': 'opak.', opakowanie: 'opak.', opakowania: 'opak.', kostka: 'opak.', kostki: 'opak.', słoik: 'opak.', słoiki: 'opak.', butelka: 'opak.', butelki: 'opak.', łyżka: 'łyż.', łyżki: 'łyż.', łyżeczka: 'łyżecz.', łyżeczki: 'łyżecz.' };
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
    else if (u === 'opak.') { const pk = pakProd(nazwa || wpis); if (pk) { q *= pk.r; u = pk.u; } else u = znany ? znany.u : 'szt.'; }
    zmienLodowke(nazwa || wpis, u, q); n++;
  }
  if (n) { rysuj(); pokazToast(`Dodano ${n} ${n === 1 ? 'pozycję' : n < 5 ? 'pozycje' : 'pozycji'} do lodówki`); const t = $('#szybkie-tekst'); if (t) t.value = ''; } else pokazToast('Nie rozpoznałem żadnej linii');
}

// ---------- spontaniczne gotowanie ----------
const ZAKLADANE = /oliw|olej|\bsol\b|pieprz|przypraw|cukier|ocet|woda|bulion|czosnek|curry|oregano|bazyli|kmin|cynamon|ziele|lisc|majeran|tymian|proszek|sos sojowy|musztard|keczup|koncentrat|papryka (slodka|wedzona|mielona)|miod|ekstrakt|wanili/;
function mozliwosci() {
  const out = [];
  for (const d of DB.dania.values()) {
    if (ukryte(d.id) || !dopuszcza(d, OS)) continue;
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
    : '<div class="pusty"><b>Nic nie pasuje</b><span>Dopisz więcej rzeczy do lodówki albo zmień filtr.</span><button class="btn glowny" data-szybka="dodaj">＋ Dodaj do lodówki</button></div>';
}

// ---------- zdarzenia ----------
function zapiszPom(d, p, slot, on) {
  const day = plan.dni[d]; day.pom = day.pom || {}; day.pom[p] = day.pom[p] || {};
  if (on) day.pom[p][slot] = true; else delete day.pom[p][slot];
  const zm = [[['dni', d, 'pom', p, slot], on ? true : undefined]];
  if (slot !== 'shake') {
    day.pomSl = day.pomSl || {};
    const maPom = Object.keys(day.pom[p]).some(k => k !== 'shake' && day.pom[p][k]);
    if (!maPom) delete day.pomSl[p];
    else if (on) {
      const wsz = ['sn', day.m13 && day.m13.wsp ? 'm13' : 'm13' + p, (day.ob || (d > 0 && plan.dni[d - 1].ob2 && plan.dni[d - 1].ob)) ? 'ob' : null, 'k18'].filter(Boolean);
      day.pomSl[p] = wsz.filter(x => !zuzyte[kluczZ(d, x)] && (!day.pomSl[p] || day.pomSl[p].includes(x)));
    }
    zm.push([['dni', d, 'pomSl', p], day.pomSl[p] || undefined]);
  }
  LS.set('plan', plan); Z(zm);
}
function infoPrzeniesienia(d, osoby) {
  const w = oblicz(plan, cele()), t = osoby.map(p => { const x = w.dni[d].przenos[p], nast = d < 6 ? w.dni[d + 1].przenos[p] : null; return `${ETY[p]}: +${r0(x.same)} kcal dziś${nast && nast.przyj > 1 ? `, +${r0(nast.przyj)} kcal jutro` : ''}`; });
  return 'Pominięto. Kalorie rozłożone — ' + t.join('; ');
}
function pominPosilek(d, slot, osoby) {
  osoby = osoby.filter(p => !nieob(plan.dni[d], p));
  if (!osoby.length) return;
  if (plan.dni[d] && zuzyte[kluczZ(d, slot)]) { pokazToast('Ten posiłek jest już oznaczony jako zjedzony'); return; }
  osoby.forEach(p => zapiszPom(d, p, slot, true));
  otwartyDzien = d; $('#modal').hidden = true; rysuj();
  pokazToast(infoPrzeniesienia(d, osoby), 'Cofnij', () => { osoby.forEach(p => zapiszPom(d, p, slot, false)); rysuj(); });
}
function oknoPomin(d, slot) {
  const day = plan.dni[d], jedna = slot === 'm13ona' ? ['ona'] : slot === 'm13on' ? ['on'] : null;
  const kto = (jedna || OS).filter(p => !nieob(day, p) && !pomija(day, p, slot));
  if (!kto.length) return;
  if (kto.length === 1) { pominPosilek(d, slot, kto); return; }
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Pomiń posiłek</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">Kalorie pominiętego posiłku nie przepadają: część rozłożę na pozostałe posiłki tego dnia, a resztę dodam do następnego dnia (maks. +15% jego celu). Kto go pomija?</p>
    <div class="rzad" style="flex-direction:column">${kto.map(p => `<button class="btn" data-pomin-kto="${d}:${slot}:${p}">${ETY[p]}</button>`).join('')}${kto.length > 1 ? `<button class="btn glowny" data-pomin-kto="${d}:${slot}:oboje">Oboje</button>` : ''}</div>`;
  $('#modal').hidden = false;
}
// Klik w dzień drugiego tygodnia: ten tydzień staje się „aktywny” (tak jak dotąd działają zamiany, treningi, „zjedzone”), ale ekran się nie zmienia.
function przygotujTydzien(e) {
  const sek = e.target.closest('[data-wk]');
  if (!sek) return;
  const st = sek.dataset.wk, dEl = e.target.closest('[data-d]');
  if (st !== plan.start && inny && inny.start === st) przelaczTydzien();
  otwartyTyg = plan.start; if (dEl) otwartyDzien = +dEl.dataset.d;
  if (window._wBy && window._wBy[plan.start]) window._w = window._wBy[plan.start];
}
document.addEventListener('click', async e => {
  const t = e.target.closest('button, summary');
  if (!t) { if (e.target.id === 'modal') zamknijOkno(); return; }
  if (t.tagName !== 'SUMMARY' && !t.dataset.tab) przygotujTydzien(e);
  if (t.dataset.toast !== undefined) { const f = toastFn; $('#toast').hidden = true; toastFn = null; if (f) f(); return; }
  if (t.dataset.szybka) { szybkaAkcja(t.dataset.szybka); return; }
  if ('skanZamknij' in t.dataset) { zatrzymajSkan(true); $('#modal').hidden = true; rysuj(); return; }
  if ('skanSzukaj' in t.dataset) { const k = (($('#skan-reczny') || {}).value || '').replace(/\D/g, ''); if (!kodWazny(k)) { pokazToast('Kod ma 8, 12 albo 13 cyfr'); return; } if (!skan) skan = { stream: null, ostatni: '', t: 0 }; wynikSkanu(k); return; }
  if (t.dataset.skKat) { document.querySelectorAll('#sk-kat button').forEach(b => b.classList.toggle('akt', b === t)); return; }
  if (t.dataset.skIle) { const el = $('#sk-ile'); el.value = Math.max(1, (parseInt(el.value, 10) || 1) + +t.dataset.skIle); odswiezSkan(); return; }
  if (t.dataset.skDodaj) { if (skanDodaj()) { rysuj(); oknoSkaner('Dodano. Zeskanuj następny produkt albo naciśnij „Gotowe”.'); } return; }
  if ('skDalej' in t.dataset) { oknoSkaner(); return; }
  if (t.dataset.skOdhacz) { const pr = t.dataset.skOdhacz; odhaczKup(kluczKup(pr), true); LS.set('odhaczone', odhaczone); rysuj(); oknoSkaner(`Odhaczono na liście: ${pr}. Zeskanuj następny.`); return; }
  if (t.dataset.prepDzien) { prepOd = t.dataset.prepDzien; rysuj(); return; }
  if (t.dataset.dop) { const [dd, k] = t.dataset.dop.split(':'); oknoDopasuj([{ start: plan.start, d: +dd, iso: dodajDni(plan.start, +dd), tryby: { [k]: true } }]); return; }
  if (t.dataset.gosc) { const [dd, dl] = t.dataset.gosc.split(':'), day = plan.dni[+dd]; day.gosc = Math.max(0, Math.min(12, (day.gosc || 0) + +dl)); LS.set('plan', plan); Z([[['dni', +dd, 'gosc'], day.gosc]]); otwartyDzien = +dd; rysuj(); return; }
  if (t.dataset.wiecz !== undefined) { const dz = isoDzis(), it = (window._wiecz || [])[+t.dataset.wiecz]; if (it) { const all = LS.get('wieczOk', {}) || {}, a = all[dz] || []; all[dz] = a.includes(it.klucz) ? a.filter(x => x !== it.klucz) : a.concat(it.klucz); Object.keys(all).forEach(k => { if (k < dodajDni(dz, -3)) delete all[k]; }); LS.set('wieczOk', all); rysuj(); } return; }
  if (t.dataset.wieczPrzepis !== undefined) { const it = (window._wiecz || [])[+t.dataset.wieczPrzepis]; if (it && it.g) pokazPrzepis(it.g, false); return; }
  if (t.dataset.wieczGot !== undefined) { const it = (window._wiecz || [])[+t.dataset.wieczGot]; if (it && it.g) { otworzGotowanie(it.g, false); const k = got ? got.kroki.findIndex(x => /^WIECZOREM/i.test(x)) : -1; if (k >= 0) gotIdz(k + 1); } return; }
  if (t.dataset.dalejWiecej !== undefined) { dalejWiecej = t.dataset.dalejWiecej === '1'; rysuj(); return; }
  if (t.dataset.dopToggle) { dopDzien = !dopDzien; otwartyDzien = otwartyDzien; rysuj(); return; }
  if (t.dataset.blok) { const [dd, sl] = t.dataset.blok.split(':'), day = plan.dni[+dd]; day.blok = day.blok || {}; if (day.blok[sl]) delete day.blok[sl]; else day.blok[sl] = true; LS.set('plan', plan); Z([[['dni', +dd, 'blok'], Object.keys(day.blok).length ? day.blok : undefined]]); otwartyDzien = +dd; rysuj(); pokazToast(day.blok[sl] ? 'Zablokowane: zostanie przy ponownym losowaniu tygodnia' : 'Odblokowane'); return; }
  if (t.dataset.pozaGotowe) { const [n, k] = t.dataset.pozaGotowe.split('|'); const i = $('#poza-n'); if (i) i.value = n; const zazn = [...document.querySelectorAll('[data-poza-os]')].filter(c => c.checked); (zazn.length ? zazn : [...document.querySelectorAll('[data-poza-os]')]).forEach(c => { c.checked = true; const kk = $('#poza-k-' + c.dataset.pozaOs); if (kk) kk.value = k; }); return; }
  if (t.dataset.pozaZapisz) { zapiszPoza(+t.dataset.pozaZapisz); return; }
  if (t.dataset.pozaUsun) { const [dd, pp, ii] = t.dataset.pozaUsun.split('|'), day = plan.dni[+dd], sn = snapStanu(); (day.poza[pp] || []).splice(+ii, 1); if (!day.poza[pp].length) delete day.poza[pp]; LS.set('plan', plan); Z([[['dni', +dd, 'poza'], Object.keys(day.poza).length ? day.poza : undefined]]); rysuj(); toastCofnij('Wpis usunięty', sn); return; }
  if (t.dataset.swipePozniej) { LS.set('swipeP', isoDzis().slice(0, 7)); rysuj(); return; }
  if (t.dataset.swKto) { sw.kto = t.dataset.swKto; swBudujTalie(); widokSwipe(); return; }
  if (t.dataset.swTyp) { sw.typ = t.dataset.swTyp; swBudujTalie(); widokSwipe(); return; }
  if (t.dataset.sw) { swDecyduj(t.dataset.sw); return; }
  if (t.dataset.wlasneNowe) { wd = null; oknoWlasne(); return; }
  if (t.dataset.wlasneDalej) { const tx = (($('#wd-tekst') || {}).value || ''); wd = wd || { typ: 'obiad' }; wd.tekst = tx; const o = czytajPrzepis(tx); if (!o.skl.length) { pokazToast('Nie widzę składników. Wpisz je w liniach typu „kurczak 300 g”'); return; } wd.nazwa = o.nazwa; wd.skl = o.skl.map(wierszSkladnika); wd.kroki = o.kroki.join('\n'); wd.czas = wd.czas || ''; oknoWlasne(2); return; }
  if (t.dataset.wlasneWstecz) { const tt = $('#wd-kroki'); if (tt) wd.kroki = tt.value; oknoWlasne(); return; }
  if (t.dataset.wlasneZapisz) { zapiszWlasneDanie(); return; }
  if (t.dataset.wdUsun) { wd.skl.splice(+t.dataset.wdUsun, 1); wd.nazwa = (($('#wd-nazwa') || {}).value || wd.nazwa); wd.kroki = (($('#wd-kroki') || {}).value || wd.kroki); oknoWlasne(2); return; }
  if (t.dataset.wlasneUsun) { if (!(await pytaj('Usunąć to danie?', 'Z planu zniknie, jeśli było użyte.', 'Usuń danie'))) return; const id = t.dataset.wlasneUsun; wlasneDania = wlasneDania.filter(x => x.id !== id); LS.set('wlasneDania', wlasneDania); Z([[['wlasneDania'], wlasneDania]]); usunZBazy(id); naprawBrakujace(); rysuj(); pokazToast('Danie usunięte'); return; }
  if (t.dataset.motyw) { motyw = t.dataset.motyw; LS.set('motyw', motyw); zastosujMotyw(); rysuj(); return; }
  if (t.dataset.sklepzak) { sklepZak = t.dataset.sklepzak; LS.set('sklepZak', sklepZak); rysuj(); return; }
  if (t.dataset.trasaTryb) { trasaTryb = t.dataset.trasaTryb; LS.set('trasaTryb', trasaTryb); rysuj(); return; }
  if (t.dataset.dopPokaz) { dopOtw = true; rysuj(); setTimeout(() => { const i = $('#dop-tekst'); if (i) i.focus(); }, 80); return; }
  if (t.dataset.dopTekst) { oknoDopasuj(rozumiemTekst(($('#dop-tekst') || {}).value || '')); return; }
  if (t.dataset.dopPrzyklad) { const i = $('#dop-tekst'); if (i) { i.value = t.dataset.dopPrzyklad; i.focus(); } return; }
  if (t.dataset.dopOk) { zastosujDopasowanie(); return; }
  if (t.dataset.podsum) { podsumStart = t.dataset.podsum; rysuj(); return; }
  if (t.dataset.prepDzis !== undefined) { prepOd = isoDzis(); const se = sesje.find(x => x.id === t.dataset.prepDzis); const pl = planPrepu(prepOd, se ? se.h : prepH); otworzSesje(pl, zapiszSesje(pl)); return; }
  if (t.dataset.prepOtworz) { prepOd = t.dataset.prepOtworz; zakladka = 'prep'; rysuj(); window.scrollTo(0, 0); return; }
  if (t.dataset.prepStart) { const pl = planPrepu(prepOd, prepH), se = zapiszSesje(pl); otworzSesje(pl, se); return; }
  if (t.dataset.prepZapisz) { zapiszSesje(planPrepu(prepOd, prepH)); rysuj(); pokazToast('Plan sesji zapisany. Przy daniach pokażę, co już ugotowane.'); return; }
  if (t.dataset.prepZrobione) { const se = sesje.find(x => x.id === t.dataset.prepZrobione); if (se) { se.zrobione = !se.zrobione; LS.set('sesje', sesje); Z([[['sesje'], sesje]]); rysuj(); } return; }
  if (t.dataset.prepUsun) { sesje = sesje.filter(x => x.id !== t.dataset.prepUsun); LS.set('sesje', sesje); Z([[['sesje'], sesje]]); rysuj(); pokazToast('Sesja usunięta'); return; }
  if ('gotPrepOk' in t.dataset) { if (got && got.sesja) { got.sesja.zrobione = true; LS.set('sesje', sesje); Z([[['sesje'], sesje]]); } zamknijGotowanie(true); rysuj(); pokazToast('Sesja zapisana jako zrobiona'); return; }
  if (t.dataset.gotuj) { otworzGotowanie(window._przepisG, !!spontG); return; }
  if ('gotZamknij' in t.dataset) { zamknijGotowanie(); return; }
  if (t.dataset.gotIdz !== undefined) { gotIdz(+t.dataset.gotIdz); return; }
  if ('gotSkl' in t.dataset) { got.skl = !got.skl; rysujGot(); return; }
  if (t.dataset.gotTimer) { const [sek, ...et] = t.dataset.gotTimer.split('|'); startTimer(et.join('|'), +sek); return; }
  if (t.dataset.gotTp) { const tm = timery.find(x => x.id === +t.dataset.gotTp); if (tm) { if (tm.pauza) { tm.koniec += Date.now() - tm.pauza; tm.pauza = null; } else tm.pauza = Date.now(); rysujGot(); } return; }
  if (t.dataset.gotT1) { const tm = timery.find(x => x.id === +t.dataset.gotT1); if (tm) { tm.koniec += 60000; rysujGot(); } return; }
  if (t.dataset.gotTx) { timery = timery.filter(x => x.id !== +t.dataset.gotTx); rysujGot(); return; }
  if (t.dataset.gotZjedz !== undefined) { const g0 = got.g; zjedz(g0, +t.dataset.gotZjedz, true); got.zjedzone = true; rysujGot(); pokazToast('Oznaczono jako zjedzone'); return; }
  if ('gotSpont' in t.dataset) { const g0 = got.g; for (const [pp, , q, uu] of skladGarnka(g0)) if (lodowka[pp] && lodowka[pp][uu] != null) zmienLodowke(pp, uu, -ileZuzyto(q, uu)); spontWroc = false; spontG = null; zamknijGotowanie(true); $('#modal').hidden = true; rysuj(); pokazToast('Składniki zdjęte z lodówki'); return; }
  if (t.dataset.smak) { const [id, pp, v] = t.dataset.smak.split(':'); ocenSmak(id, pp, +v); odswiezSmak(); return; }
  if (t.dataset.pomin) { const [d, sl] = t.dataset.pomin.split(':'); oknoPomin(+d, sl); return; }
  if (t.dataset.pominKto) { const [d, sl, k] = t.dataset.pominKto.split(':'); pominPosilek(+d, sl, k === 'oboje' ? OS : [k]); return; }
  if (t.dataset.pominShake) { const [d, pp] = t.dataset.pominShake.split(':'); zapiszPom(+d, pp, 'shake', true); otwartyDzien = +d; rysuj(); pokazToast(infoPrzeniesienia(+d, [pp]), 'Cofnij', () => { zapiszPom(+d, pp, 'shake', false); rysuj(); }); return; }
  if (t.dataset.przywroc) { const [d, pp, sl] = t.dataset.przywroc.split(':'); zapiszPom(+d, pp, sl, false); otwartyDzien = +d; rysuj(); pokazToast('Przywrócono posiłek'); return; }
  if (t.dataset.zuzyj) { e.preventDefault(); oknoZuzyj(t.dataset.zuzyj); return; }
  if (t.dataset.zuzWstaw) { const [st, d, sl, ...id] = t.dataset.zuzWstaw.split('|'); if (st !== plan.start && inny && inny.start === st) przelaczTydzien(); wybierz(+d, sl, id.join('|')); return; }
  if (t.dataset.wsk) { wskazowki[t.dataset.wsk] = 1; LS.set('wskazowki', wskazowki); rysuj(); return; }
  if (t.dataset.intro !== undefined) { pokazIntro(+t.dataset.intro); return; }
  if (t.dataset.tab) { zakladka = t.dataset.tab; rysuj(); window.scrollTo(0, 0); }
  else if (t.dataset.przepis) { const [g, d] = t.dataset.przepis.split(':'); oknoPrzepis(+g, +d); }
  else if (t.dataset.zmien) { const [d, s] = t.dataset.zmien.split(':'); oknoZmien(+d, s); }
  else if (t.dataset.wybierz) { const [d, s, ...id] = t.dataset.wybierz.split(':'); wybierz(+d, s, id.join(':')); }
  else if ('zamknij' in t.dataset) zamknijOkno();
  else if (t.id === 'udostepnijPlan') { t.disabled = true; window.Sync.utworz().then(ok => { rysuj(); if (ok) wyslijZaproszenie(); }); }
  else if (t.id === 'wyslijLink') wyslijZaproszenie();
  else if (t.id === 'sync-ponow') { t.disabled = true; window.Sync.ponow().then(() => { pasekSync(); pokazToast('Próbuję połączyć ponownie…'); }); }
  else if (t.id === 'odlacz') { if (await pytaj('Odłączyć ten telefon od wspólnego planu?', 'Plan zostanie tu jako kopia, a u drugiej osoby nic się nie zmieni.', 'Odłącz')) { window.Sync.odlacz(); rysuj(); } }
  else if (t.id === 'dolacz') {
    const v = ($('#kodDom') || {}).value || '';
    if (plan && profil && !(await pytaj('Dołączyć do wspólnego planu?', 'Plan zapisany na tym telefonie zostanie zastąpiony wspólnym.', 'Dołącz'))) return;
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
  else if ('parNowy' in t.dataset) oknoParagonWklej()
  else if (t.id === 'parSchowek') { schowekParagon(); }
  else if (false) { (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.reject()).then(tx => { if (!tx || tx.length < 20) { pokazToast('Schowek jest pusty lub za krótki'); return; } const a = $('#par-tekst'); if (a) a.value = tx; wczytajParagon(tx); }).catch(() => pokazToast('Nie mogę odczytać schowka — wklej tekst ręcznie w pole poniżej')); }
  else if (t.id === 'parWczytaj') wczytajParagon(($('#par-tekst') || {}).value || '')
  else if (t.dataset.parProd !== undefined) oknoWyborProduktu(+t.dataset.parProd)
  else if ('parWroc' in t.dataset) oknoParagon()
  else if (t.dataset.parWybrany) { const [i, ...pr] = t.dataset.parWybrany.split('|'), r = parag.wiersze[+i], prod = pr.join('|'); Object.assign(r, { produkt: prod, pomin: false, wlacz: true, pew: 1, zmieniony: true }); const il = ilosciPozycji(parag.w.poz[+i], prod); r.q = il.q; r.u = il.u; r.pak = il.pak || null; oknoParagon(); }
  else if (t.dataset.parNowyProd) { const [i, ...pr] = t.dataset.parNowyProd.split('|'); oknoNowyProdukt(+i, pr.join('|').toLowerCase()); }
  else if (t.dataset.parNowyFormularz !== undefined) oknoNowyProdukt(+t.dataset.parNowyFormularz)
  else if (t.dataset.npKat) { nowyP.kat = t.dataset.npKat; document.querySelectorAll('[data-np-kat]').forEach(b => b.classList.toggle('akt', b.dataset.npKat === nowyP.kat)); }
  else if ('npDodaj' in t.dataset) { const nazwa = (($('#np-nazwa') || {}).value || '').trim(); if (nazwa.length < 2) { pokazToast('Wpisz nazwę produktu'); return; } const prod = dodajWlasnyProdukt(nazwa, nowyP.kat, ($('#np-u') || {}).value || nowyP.u), r = parag.wiersze[nowyP.i]; Object.assign(r, { produkt: prod, pomin: false, wlacz: true, pew: 1, zmieniony: true }); const il = ilosciPozycji(parag.w.poz[nowyP.i], prod); r.q = il.q; r.u = il.u; r.pak = il.pak || null; nowyP = null; oknoParagon(); pokazToast(`Dodano produkt: ${prod}`); }
  else if (t.dataset.wlasnyKat) { const n = t.dataset.wlasnyKat, ord = ['świeże', 'zamrażarka', 'zapas'], x = wlasneProd[n]; if (x) { x.kat = ord[(ord.indexOf(x.kat) + 1) % 3]; DB.produkty.set(n, { kat: x.kat, u: x.u }); LS.set('wlasneProd', wlasneProd); Z([[['wlasneProd', n], x]]); rysuj(); } }
  else if (t.dataset.wlasnyUsun) { const n = t.dataset.wlasnyUsun; delete wlasneProd[n]; DB.produkty.delete(n); LS.set('wlasneProd', wlasneProd); Z([[['wlasneProd', n], undefined]]); rysuj(); pokazToast('Produkt usunięty z listy własnych'); }
  else if (t.dataset.parPominPoz) { const r = parag.wiersze[+t.dataset.parPominPoz]; Object.assign(r, { pomin: true, wlacz: false, powod: 'pomijasz tę pozycję', zmieniony: true }); oknoParagon(); }
  else if (t.id === 'parZapisz') zapiszParagon()
  else if (t.dataset.cenyTryb) { cenyTryb = t.dataset.cenyTryb; LS.set('cenyTryb', cenyTryb); rysuj(); }
  else if (t.dataset.parUsun) { if (await pytaj('Usunąć ten paragon z historii?', 'Zapamiętane ceny zostaną.', 'Usuń paragon')) { paragony = paragony.filter(x => x.id !== t.dataset.parUsun); LS.set('paragony', paragony); Z([[['paragony'], paragony]]); rysuj(); } }
  else if (t.dataset.smakUkryj) { oceny[t.dataset.smakUkryj] = -1; LS.set('oceny', oceny); Z([[['oceny', t.dataset.smakUkryj], -1]]); rysuj(); pokazToast('Danie ukryte'); }
  else if (t.dataset.smakCzysc) { delete smaki[t.dataset.smakCzysc]; LS.set('smaki', smaki); Z([[['smaki', t.dataset.smakCzysc], undefined]]); rysuj(); }
  else if (t.dataset.wosoba2) { wyklOsoba = t.dataset.wosoba2; rysuj(); }
  else if (t.dataset.wgrupa) { const [pp, k] = t.dataset.wgrupa.split(':'); zmienWykl(() => { const a = wyklucz[pp], i = a.indexOf('g:' + k); if (i >= 0) a.splice(i, 1); else a.push('g:' + k); }); }
  else if (t.dataset.wdodaj) { const pp = t.dataset.wdodaj, v = (($('#wykl-nowe') || {}).value || '').trim().toLowerCase(); if (v.length < 2) { pokazToast('Wpisz co najmniej 2 litery'); return; } if (!wyklucz[pp].includes(v)) zmienWykl(() => wyklucz[pp].push(v)); else pokazToast('To słowo już jest na liście'); }
  else if (t.dataset.wusun) { const [pp, ...w] = t.dataset.wusun.split('|'), v = w.join('|'); zmienWykl(() => { wyklucz[pp] = wyklucz[pp].filter(x => x !== v); }); }
  else if ('zamienWykl' in t.dataset) zamienNiepasujace()
  else if (t.dataset.zakdzien) {
    const s = wybraneDni(); s.has(t.dataset.zakdzien) ? s.delete(t.dataset.zakdzien) : s.add(t.dataset.zakdzien);
    zakDni = [...s].sort(); LS.set('zakDni', zakDni); rysuj();
  }
  else if (t.dataset.zakweek) {
    const s = wybraneDni(), dniT = dniDostepne().filter(x => x.start === t.dataset.zakweek).map(x => x.iso), wsz = dniT.every(x => s.has(x));
    dniT.forEach(x => wsz ? s.delete(x) : s.add(x)); zakDni = [...s].sort(); LS.set('zakDni', zakDni); rysuj();
  }
  else if (t.dataset.miesoPodziel !== undefined) {
    const pr = (window._miesoProds || [])[+t.dataset.miesoPodziel], inp = $('#mieso-in-' + t.dataset.miesoPodziel), g = parsujMase(inp && inp.value);
    if (!pr) return;
    if (!g) { pokazToast('Wpisz ilość, np. 2,5 kg albo 800 g'); return; }
    const kup = LS.get('miesoKup', {}) || {}; kup[pr] = { g, dt: isoDzis() }; LS.set('miesoKup', kup); rysuj();
  }
  else if (t.dataset.miesoGotowe !== undefined) { const pr = (window._miesoProds || [])[+t.dataset.miesoGotowe], kup = LS.get('miesoKup', {}) || {}; if (pr) { delete kup[pr]; LS.set('miesoKup', kup); rysuj(); } }
  else if (t.dataset.zakpreset) { zakDni = t.dataset.zakpreset === 'auto' ? null : []; if (zakDni) LS.set('zakDni', zakDni); else LS.del('zakDni'); rysuj(); }
  else if ('nowy' in t.dataset) { if (await pytaj('Ułożyć ten tydzień od nowa?', 'Twoje zamiany w nim przepadną.', 'Ułóż od nowa')) { const sn = snapStanu(); ulozTydzien(plan.start); rysuj(); toastCofnij('Tydzień ułożony od nowa', sn); } }
  else if (t.id === 'doZakupowDzis') { zakDni = null; LS.del('zakDni'); zakOtw = false; zakladka = 'zakupy'; rysuj(); window.scrollTo(0, 0); }   // z przypomnienia: od razu najbliższa wyprawa (pon: wt–pt, pt: sob–pon)
  else if (t.id === 'doZakupow') { zakladka = 'zakupy'; rysuj(); window.scrollTo(0, 0); }
  else if (t.id === 'udostepnij') {
    const tekst = tekstListy();
    if (navigator.share) navigator.share({ title: 'Zakupy', text: tekst }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(tekst).then(() => pokazToast('Lista skopiowana. Wklej ją do notatek albo SMS-a.'), () => pokazTekst('Lista zakupów', tekst));
    else pokazTekst('Lista zakupów', tekst);
  }
  else if ('pokazZakazane' in t.dataset && zmienCtx) { zmienCtx.pokazZakazane = !zmienCtx.pokazZakazane; listaWyboru(($('#szukaj') || {}).value || ''); }
  else if (t.dataset.tryb && zmienCtx) {
    zmienCtx.pula = t.dataset.tryb === 'kokt' ? DB.pula.m13kokt : DB.pula.m13dania;
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('akt', b === t));
    listaWyboru(($('#szukaj') || {}).value || '');
  }
  else if (t.id === 'przeladuj') location.reload();
  else if (t.id === 'aktualizuj') aktualizujApke();
  else if (t.id === 'kupWszystko') {
    const sn = snapStanu();
    for (const kat of ['świeże', 'zamrażarka', 'zapas']) for (const pp of window._z.wynik[kat]) odhaczKup(kluczKup(pp.produkt), true);
    LS.set('odhaczone', odhaczone); rysuj(); toastCofnij('Wszystko kupione, lodówka uzupełniona', sn);
  }
  else if (t.id === 'odznaczWszystko') {
    if (!(await pytaj('Odznaczyć wszystkie zakupy?', 'Kupione ilości zostaną odjęte z lodówki.', 'Odznacz wszystko'))) return;
    const sn = snapStanu();
    for (const k of Object.keys(Object.assign({}, inny && inny.odhaczone, odhaczone)).filter(x => x.startsWith('zak|'))) odhaczKup(k, false);
    LS.set('odhaczone', odhaczone); rysuj(); toastCofnij('Zakupy odznaczone', sn);
  }
  else if (t.dataset.sugestie) oknoSugestie(t.dataset.sugestie);
  else if (t.dataset.sug) { const [d, sl, id, r] = t.dataset.sug.split('|'); ustawDanie(+d, sl, id, +r); rysuj(); oknoSugestie(sugOsoba); }
  else if (t.dataset.autoPopraw) { const sn = snapStanu(), n = autoPopraw(t.dataset.autoPopraw); rysuj(); oknoSugestie(sugOsoba, n); toastCofnij('Poprawiono białko w planie', sn); }
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
  else if (t.dataset.korZastosuj) { const [pp, dl] = t.dataset.korZastosuj.split(':'); zastosujKorekte(pp, +dl, false); }
  else if (t.dataset.korOdloz) { korekta[t.dataset.korOdloz].odloz = dodajDni(isoDzis(), 7); LS.set('korekta', korekta); Z([[['korekta', t.dataset.korOdloz], korekta[t.dataset.korOdloz]]]); rysuj(); pokazToast('Dam znać za tydzień'); }
  else if (t.dataset.korReset) { const pp = t.dataset.korReset; korekta[pp].kcal = 0; korekta[pp].od = null; korekta[pp].odloz = null; LS.set('korekta', korekta); Z([[['korekta', pp], korekta[pp]]]); rysuj(); pokazToast('Korekta wyzerowana. Plan przeliczony.'); }
  else if (t.dataset.wosoba) { wagaOsoba = t.dataset.wosoba; rysuj(); }
  else if (t.dataset.wzakres) { wagaZakres = +t.dataset.wzakres; rysuj(); }
  else if (t.dataset.wkstep) { const [pp, dl] = t.dataset.wkstep.split(':'), el = $('#wk-' + pp); const v = parseFloat(String(el.value).replace(',', '.')) || 70; el.value = kgTxt(Math.max(25, v + +dl)); }
  else if (t.dataset.zapiszWage) zapiszWage(t.dataset.zapiszWage);
  else if (t.dataset.usunWage) { const [pp, dd] = t.dataset.usunWage.split('|'); delete waga[pp][dd]; LS.set('waga', waga); Z([[['waga', pp, dd], undefined]]); rysuj(); }
  else if (t.dataset.wageProfil) { const pp = t.dataset.wageProfil, e = Object.entries(waga[pp] || {}).sort(); if (e.length) { profil[pp].waga = e[e.length - 1][1]; LS.set('profil', profil); Z([[['profil', pp], profil[pp]]]); rysuj(); } }
  else if (t.dataset.lodkat) { lodKat = t.dataset.lodkat; rysuj(); }
  else if (t.dataset.popraw) { const [pp, uu] = t.dataset.popraw.split('|'); oknoPopraw(pp, uu); }
  else if (t.dataset.popStep) { const el = $('#pop-q'), v = parseFloat(String(el.value).replace(',', '.')) || 0; el.value = String(Math.max(0, Math.round((v + +t.dataset.popStep) * 10) / 10)).replace('.', ','); }
  else if (t.id === 'popZapisz') zapiszPoprawke(false)
  else if (t.id === 'popZero') zapiszPoprawke(true)
  else if ('dodaj' in t.dataset) oknoDodaj('jeden')
  else if (t.dataset.dodtryb) oknoDodaj(t.dataset.dodtryb)
  else if (t.dataset.dodu) { dodU = t.dataset.dodu; odswiezDodawanie(); }
  else if (t.dataset.dodq) { $('#dod-q').value = t.dataset.dodq; }
  else if (t.dataset.dodp) { $('#dod-p').value = t.dataset.dodp; const k = DB.produkty.get(t.dataset.dodp); if (k && ['g', 'ml', 'szt.', 'krom.', 'pusz.'].includes(k.u)) dodU = k.u; odswiezDodawanie(); $('#dod-q').focus(); }
  else if (t.dataset.stpak) { const [pp, uu, r] = t.dataset.stpak.split('|'); zmienLodowke(pp, uu, +r); rysuj(); pokazToast(`Dodano opakowanie: ${pp} ${r} ${uu}`); }
  else if (t.dataset.stpm) { const [pp, uu, dl] = t.dataset.stpm.split('|'), cur = (lodowka[pp] || {})[uu] || 0, st = KROK_LOD(uu); zmienLodowke(pp, uu, +dl > 0 ? st : -Math.min(st, cur)); rysuj(); }
  else if (t.dataset.stanusun) { const [pp, uu] = t.dataset.stanusun.split('|'), byl = (lodowka[pp] || {})[uu] || 0; if (lodowka[pp]) { delete lodowka[pp][uu]; if (!Object.keys(lodowka[pp]).length) delete lodowka[pp]; } LS.set('lodowka', lodowka); Z([[['lodowka', pp, uu], undefined]]); rysuj(); pokazToast(`Usunięto: ${pp}`, 'Cofnij', () => { zmienLodowke(pp, uu, byl > 0.5 ? byl : 0.01); rysuj(); }); }
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
  else if (t.id === 'pw-szukaj' && parag) { const i = [...document.querySelectorAll('[data-par-pomin-poz]')][0]; listaProduktowPar(+(i ? i.dataset.parPominPoz : 0), t.value); }
  else if (t.id === 'cena-szukaj') { const q = znorm(t.value.trim()); document.querySelectorAll('.cena-w').forEach(r => { r.hidden = !!q && !r.dataset.nm.includes(q); }); }
  else if (t.id === 'sk-prod' || t.id === 'sk-rozm' || t.id === 'sk-ile') odswiezSkan()
  else if (t.id === 'lod-szukaj') { lodSzukaj = t.value; filtrujLodowke(); }
  else if (t.id === 'dod-p' || t.id === 'dod-q') odswiezDodawanie()
  else if (t.id === 'szukaj-sp') { spontFiltr.q = t.value; listaSpont(); }
  else if (t.id === 'nowy-p') { const k = DB.produkty.get(t.value); if (k && $('#nowy-u')) $('#nowy-u').value = ['g', 'ml', 'szt.', 'krom.', 'pusz.'].includes(k.u) ? k.u : 'g'; }
});
document.addEventListener('change', e => {
  const t = e.target;
  przygotujTydzien(e);
  if (t.dataset.parWl !== undefined && parag) { parag.wiersze[+t.dataset.parWl].wlacz = t.checked; const w = t.closest('.par-w'); if (w) w.classList.toggle('wyl', !t.checked); return; }
  if (t.dataset.parCena !== undefined && parag) { const v = liczbaZ(t.value); if (v >= 0) { const x = parag.w.poz[+t.dataset.parCena]; x.netto = Math.round(v * 100) / 100; parag.w.sumaPoz = Math.round(sum(parag.w.poz, q => q.netto) * 100) / 100; const e = $('#par-sumapoz'); if (e) e.textContent = zl(parag.w.sumaPoz); } return; }
  if (t.dataset.wdK !== undefined) { wd.skl[+t.dataset.wdK].kcal = liczbaZ(t.value) || 0; wd.skl[+t.dataset.wdK].znane = true; wdSuma(); return; }
  if (t.dataset.wdB !== undefined) { wd.skl[+t.dataset.wdB].bialko = liczbaZ(t.value) || 0; wdSuma(); return; }
  if (t.id === 'wd-typ') { wd.typ = t.value; wdSuma(); return; }
  if (t.id === 'par-plik' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; wczytajPlik(f); return; }
  if (t.dataset.parQ !== undefined && parag) { const v = liczbaZ(t.value), r = parag.wiersze[+t.dataset.parQ]; r.q = v > 0 ? v : null; if (r.q && r.produkt) { r.wlacz = true; r.pew = 1; r.zmieniony = true; } const w = t.closest('.par-w'); if (w) { w.classList.toggle('wyl', !r.wlacz); const c = w.querySelector('[data-par-wl]'); if (c) c.checked = r.wlacz; } return; }
  if (t.dataset.parU !== undefined && parag) { parag.wiersze[+t.dataset.parU].u = t.value; return; }
  if (t.id === 'par-sklep' && parag) { parag.sklep = t.value; return; }
  if (t.id === 'par-data' && parag) { parag.data = t.value; return; }
  if (t.id === 'sk-u') { odswiezSkan(); return; }
  if (t.dataset.korAuto) { korekta[t.dataset.korAuto].auto = t.checked; LS.set('korekta', korekta); Z([[['korekta', t.dataset.korAuto], korekta[t.dataset.korAuto]]]); return; }
  if (t.dataset.gotOdh !== undefined && got) { got.odhacz[t.dataset.gotOdh] = t.checked; const w = t.closest('.got-sk'); if (w) w.classList.toggle('ok', t.checked); return; }
  if (t.dataset.nb) {
    const [d, pp] = t.dataset.nb.split(':'), day = plan.dni[+d];
    day.nb = Object.assign({ ona: false, on: false }, day.nb); day.nb[pp] = t.checked;
    LS.set('plan', plan); Z([[['dni', +d, 'nb', pp], t.checked]]); otwartyDzien = +d; rysuj();
  }
  else if (t.dataset.tr) { const [d, p] = t.dataset.tr.split(':'); plan.dni[+d].tr[p] = t.checked; otwartyDzien = +d; LS.set('plan', plan); Z([[['dni', +d, 'tr', p], t.checked]]); rysuj(); }
  else if (t.dataset.zuz) {
    const [d, sl] = t.dataset.zuz.split(':'), g = window._w.garnki.find(x => x.slot === sl && x.porcje.some(q => q.d === +d));
    if (!g) return;
    zjedz(g, +d, t.checked); otwartyDzien = +d; haptyka(); rysuj();
    if (t.checked && zakladka === 'dzis' && document.querySelector('.hero.ok') && LS.get('konfetti', '') !== isoDzis()) { LS.set('konfetti', isoDzis()); konfetti(); }
    if (t.checked) zapytajSmak(g, +d);
  }
  else if (t.dataset.sp) {
    const v = parseFloat(String(t.value).replace(',', '.')), cur = (lodowka[t.dataset.sp] || {})[t.dataset.su] || 0;
    if (!isNaN(v) && v >= 0) zmienLodowke(t.dataset.sp, t.dataset.su, v - cur);
    rysuj();
  }
  else if (t.dataset.spontTyp) { spontFiltr.typ = t.value; listaSpont(); }
  else if (t.dataset.kup) {
    haptyka(10); odhaczKup(t.dataset.kup, t.checked); trasaZapis(t.dataset.kup, t.checked); LS.set('odhaczone', odhaczone);
    const poz = t.closest('.zk-poz'), kart = poz.parentNode;
    poz.classList.toggle('kupione', t.checked);
    if (t.checked) kart.appendChild(poz);                              // odhaczone spada na koniec działu
    else { const pierwsze = kart.querySelector('.zk-poz.kupione'); kart.insertBefore(poz, pierwsze); }   // odznaczone wraca przed odhaczone
    zkLiczniki();
  }
});

// ---------- interfejs dla sync.js ----------
window.App = {
  stanDoChmury: () => ({ profil, start: plan.start, dni: dniMapa(), odhaczone, oceny, waga, lodowka, zuzyte, inny: paczkaDoChmury(inny), wyklucz, smaki, korekta, paragony, ceny, mapaPar, pakiety, sesje, wlasneProd, kody, historia, trasa, wlasneDania, lodData }),
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
    wyklucz = { ona: (data.wyklucz && data.wyklucz.ona) || [], on: (data.wyklucz && data.wyklucz.on) || [] }; smaki = data.smaki || {};
    paragony = data.paragony || []; ceny = data.ceny || {}; mapaPar = data.mapaPar || {}; pakiety = data.pakiety || {}; sesje = data.sesje || []; historia = data.historia || []; trasa = data.trasa || {}; wlasneDania = data.wlasneDania || []; lodData = data.lodData || {}; zastosujWlasneDania(); wlasneProd = data.wlasneProd || {}; kody = data.kody || {}; zastosujWlasne(); zastosujPakiety(); migrujPuszki();
    korekta = { ona: Object.assign({ kcal: 0, od: null, hist: [] }, data.korekta && data.korekta.ona), on: Object.assign({ kcal: 0, od: null, hist: [] }, data.korekta && data.korekta.on) };
    waga = { ona: (data.waga && data.waga.ona) || {}, on: (data.waga && data.waga.on) || {} };
    if (stabilny({ profil, plan, odhaczone, oceny, waga, lodowka, zuzyte, inny }) === przed && !ekranCzekania) return;   // nic nowego (np. potwierdzenie własnej zmiany)
    LS.set('profil', profil); LS.set('plan', plan); LS.set('odhaczone', odhaczone);
    LS.set('wyklucz', wyklucz); LS.set('smaki', smaki); LS.set('korekta', korekta); LS.set('paragony', paragony); LS.set('ceny', ceny); LS.set('mapaPar', mapaPar); LS.set('pakiety', pakiety); LS.set('sesje', sesje); LS.set('historia', historia); LS.set('trasa', trasa); LS.set('wlasneDania', wlasneDania); LS.set('lodData', lodData); LS.set('wlasneProd', wlasneProd); LS.set('kody', kody);
    LS.set('oceny', oceny); LS.set('waga', waga); LS.set('lodowka', lodowka); LS.set('zuzyte', zuzyte); LS.set('inny', inny);
    if (!$('#modal').hidden) { odroczone = true; return; }                        // nie zamykam otwartego przepisu
    if (zakladka === 'ustawienia' && !ekranStartowy && !ekranCzekania) return;    // nie kasuję wypełnianego formularza
    if ((zakladka === 'waga' || zakladka === 'lodowka') && document.activeElement && document.activeElement.matches('input, textarea, select')) return;
    rysuj();
  },
  syncZmiana() {
    const el = $('#sync-status');
    if (el) el.innerHTML = opisSync();
    pasekSync();
    if (ekranCzekania) return rysuj();
    const S = window.Sync;
    if (ekranStartowy && S && ((S.dostepny && !$('#dolacz')) || S.kod)) rysuj();
  }
};

// ---------- własne okna zamiast confirm() i alert() ----------
function oknoDialogu(html, ok) {
  const pop = document.activeElement; let el = $('#pytanie'); if (el) el.remove();
  el = document.createElement('div'); el.id = 'pytanie'; el.className = 'pytanie'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'pyt-t');
  el.innerHTML = `<div class="pytanie-tlo" data-pyt="0"></div><div class="pytanie-box">${html}</div>`;
  const koniec = v => { document.removeEventListener('keydown', klaw, true); el.remove(); try { pop && pop.focus && pop.focus(); } catch (e) { /* nic */ } ok(v); };
  const klaw = e => { if (e.key === 'Escape') { e.stopPropagation(); koniec(false); } };
  el.addEventListener('click', e => { const b = e.target.closest('[data-pyt]'); if (b) { e.stopPropagation(); koniec(b.dataset.pyt === '1'); } });
  document.addEventListener('keydown', klaw, true);
  document.body.appendChild(el);
  const f = el.querySelector('[data-pyt="0"].btn') || el.querySelector('button'); if (f) f.focus();
}
function pytaj(tytul, tekst, et = 'Tak', grozne = true) {
  return new Promise(res => oknoDialogu(`<h2 id="pyt-t">${esc(tytul)}</h2>${tekst ? `<p class="mute">${esc(tekst)}</p>` : ''}<div class="pytanie-ak"><button class="btn" data-pyt="0">Anuluj</button><button class="btn ${grozne ? 'grozne' : 'glowny'}" data-pyt="1">${esc(et)}</button></div>`, res));
}
function pokazTekst(tytul, tekst) {   // gdy nie da się skopiować do schowka: tekst do ręcznego zaznaczenia
  oknoDialogu(`<h2 id="pyt-t">${esc(tytul)}</h2><textarea class="pytanie-tx" readonly rows="6">${esc(tekst)}</textarea><div class="pytanie-ak"><button class="btn glowny" data-pyt="0">Zamknij</button></div>`, () => {});
  const ta = $('#pytanie .pytanie-tx'); if (ta) { ta.focus(); ta.select(); }
}
window.pytaj = pytaj;
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
  try {
    const ks = window.caches ? (await caches.keys()).filter(k => /^plan-v\d+$/.test(k)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6))) : [], w = ks.pop() || '', st = LS.get('wersja', '');
    window._wersja = w; if (w) { if (st && st !== w) pokazToast('Zaktualizowano aplikację do wersji ' + w.replace('plan-', '') + '.'); LS.set('wersja', w); }
  } catch (e) { /* nic */ }
  if (/[?&]udostepnione\b/.test(location.search)) wczytajUdostepnione();
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
