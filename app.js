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
let zakladka = 'tydzien';
let otwartyDzien = null;
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
function krokPrzeliczony(g, tekst) {
  return tekst.replace(/(\d+(?:,\d+)?)(\s?)(kg|ml|g|l)(?![\wąćęłńóśźż°])/g, (cale, liczba, odstep, u) => {
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
async function wczytajBaze() {
  const [dania, dodane, shake, opak] = await Promise.all([
    wczytaj('dania.json'), wczytaj('dania-dodane.json', []), wczytaj('shake.json'), wczytaj('opakowania.json', {})
  ]);
  DB.dania.clear();
  for (const d of dania.concat(dodane)) DB.dania.set(d.id, d);
  const wsz = [...DB.dania.values()];
  const typ = (...t) => wsz.filter(d => t.includes(d.typ));
  DB.pula = {
    sn: typ('sniadanie'),
    m13ona: typ('koktajl_maly'),
    m13on: typ('drugie_on'),
    m13: typ('koktajl').filter(d => d.podzial && d.podzial['13:00']),
    k18: typ('koktajl').filter(d => d.podzial && d.podzial['~18:00']),
    ob2: typ('obiad_zupa', 'obiad_2dni'),
    ob1: typ('obiad', 'obiad_sroda', 'obiad_sobota', 'obiad_niedziela')
  };
  DB.shake = shake; DB.opak = opak;
  const k = DB.pula.k18[0], pz = k.podzial['~18:00'];
  DB.dosypka = { kcal: pz.on_kcal - (k.razem.kcal - pz.ona_kcal), b: pz.on_bialko - (k.razem.bialko - pz.ona_bialko), odzywka: 30, skyr: 100 };
}

// ---------- silnik: skalowanie garnka ----------
// Kc = ile kcal ma mieć cały garnek. ratio = docelowe białko na 1 kcal (ustawiane przy zamianie dania).
function rozwiaz(dish, Kc, ratio) {
  const ing = dish.skladniki, K = dish.razem.kcal;
  const pf = dish.razem.bialko / (sum(ing, i => i.bialko) || 1);
  let s = Kc / K;
  let a = s, b = s, lev = new Set(), dodatek = null;
  let P = dish.razem.bialko * s;
  if (ratio) {
    // 1) dźwignia: składniki bogatsze w białko niż średnia dania skaluję osobno od reszty (od 0,35× do 2,5× porcji)
    const MIN = 0.35 * s, MAX = 2.5 * s;
    const srednia = dish.razem.bialko / K;
    const L = ing.filter(i => i.ilosc && i.kcal > 0 && i.bialko * pf / i.kcal > srednia);
    const Kl = sum(L, i => i.kcal), Pl = sum(L, i => i.bialko * pf), Kr = K - Kl, Pr = dish.razem.bialko - Pl;
    const det = Kl * Pr - Kr * Pl;
    if (Kl > 0 && Kr > 0 && Math.abs(det) > 1e-6) {
      let aa = clamp(Kc * (Pr - Kr * ratio) / det, MIN, MAX);
      let bb = (Kc - aa * Kl) / Kr;
      if (bb < MIN || bb > MAX) { bb = clamp(bb, MIN, MAX); aa = (Kc - bb * Kr) / Kl; }
      if (aa >= MIN - 1e-9 && aa <= MAX + 1e-9) { a = aa; b = bb; lev = new Set(L); P = a * Pl + b * Pr; }
    }
    // 2) nadal za mało białka: dokładam skyr obok dania (najwyżej 30% kcal posiłku), a danie odpowiednio zmniejszam
    if (P < ratio * Kc - 0.5) {
      const ro = P / Kc, ros = SKYR.b / SKYR.kcal;
      const x = clamp((ratio - ro) / (ros - ro), 0, 0.3);
      if (x > 0.01) {
        a *= 1 - x; b *= 1 - x; s *= 1 - x;
        dodatek = { g: x * Kc / SKYR.kcal, kcal: x * Kc, b: x * Kc * ros };
        P = P * (1 - x) + dodatek.b;
      }
    }
  }
  const roznica = ratio ? P - ratio * Kc : 0;
  return { a, b, lev, s, P, dodatek, roznica, wyrownane: ratio ? Math.abs(roznica) < 1 : null };
}
const SKYR = { kcal: 0.63, b: 0.11 };   // na 1 g, jak w PDF-ach
const skala = (g, i) => g.lev.has(i) ? g.a : g.b;

// ---------- silnik: cały tydzień ----------
function oblicz(pl, c) {
  const dni = pl.dni.map(() => ({ ona: { kcal: 0, b: 0 }, on: { kcal: 0, b: 0 }, sloty: [] }));
  const garnki = [];
  const bud = (p, d, slot) => UDZIAL[p][slot] * (c[p].kcal - (pl.dni[d].tr[p] ? DB.shake[p].kcal : 0));
  function garnek(id, slot, d, porcje, ratio) {
    const dish = DB.dania.get(id);
    if (!dish) return null;
    const K = sum(porcje, x => x.kcal);
    const g = Object.assign({ dish, slot, d, porcje, K, ratio }, rozwiaz(dish, K, ratio));
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
    garnek(day.sn, 'sn', d, OS.map(p => ({ p, d, kcal: bud(p, d, 'sn') })), r.sn);
    if (day.m13.wsp) garnek(day.m13.wsp, 'm13', d, OS.map(p => ({ p, d, kcal: bud(p, d, 'm13') })), r.m13);
    else OS.forEach(p => garnek(day.m13[p], 'm13' + p, d, [{ p, d, kcal: bud(p, d, 'm13') }], r['m13' + p]));
    if (day.ob) {
      const dd = day.ob2 && d + 1 < 7 ? [d, d + 1] : [d];
      garnek(day.ob, 'ob', d, dd.flatMap(x => OS.map(p => ({ p, d: x, kcal: bud(p, x, 'ob') }))), r.ob);
    }
    const k = DB.dania.get(day.k18);
    if (k) {
      const pz = k.podzial['~18:00'], bn = bud('on', d, 'k18');
      const gs = bn / pz.on_kcal, reszta = (k.razem.kcal - pz.ona_kcal) * gs;
      const g = garnek(day.k18, 'k18', d, [{ p: 'ona', d, kcal: bud('ona', d, 'k18') }, { p: 'on', d, kcal: reszta }], r.k18);
      g.dosypka = { skala: gs, kcal: bn - reszta, b: DB.dosypka.b * gs };
      dni[d].on.kcal += g.dosypka.kcal; dni[d].on.b += g.dosypka.b;
    }
    OS.forEach(p => { if (day.tr[p]) { dni[d][p].kcal += DB.shake[p].kcal; dni[d][p].b += DB.shake[p].bialko; } });
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
function kandydat() {
  const P = DB.pula;
  const sn = tasuj(P.sn); while (sn.length < 7) sn.push(los(P.sn));
  const bezPowt = (pula, n) => { const out = []; while (out.length < n) { const x = los(pula); if (pula.length < 2 || x !== out[out.length - 1]) out.push(x); } return out; };
  const dd = bezPowt(P.m13on, 5), kk = bezPowt(P.k18, 7), mm = tasuj(P.m13ona), wk = tasuj(P.m13);
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
  w.dni.forEach(x => OS.forEach(p => { kara += 2 * Math.max(0, c[p].bMin - x[p].b) + Math.max(0, x[p].b - c[p].bMax); }));
  const nz = id => DB.dania.get(id).nazwa.toLowerCase();
  let tunczyk = 0;
  pl.dni.forEach((day, d) => {
    if (d && nz(day.sn).startsWith('owsianka') && nz(pl.dni[d - 1].sn).startsWith('owsianka')) kara += 25;
    if (day.m13.on && nz(day.m13.on).includes('tuńczyk')) tunczyk++;
    if (day.m13.on && nz(day.m13.on).includes('past') && nz(day.sn).includes('past')) kara += 15;
  });
  kara += 20 * Math.max(0, tunczyk - 1);
  w.garnki.forEach(g => { if (g.s > 1.7 || g.s < 0.55) kara += 10; });
  return kara;
}
function ulozTydzien() {
  const c = cele();
  let naj = null, najK = Infinity;
  for (let i = 0; i < 300; i++) { const k = kandydat(), o = ocena(k, c); if (o < najK) { naj = k; najK = o; } }
  // zachowaj zaznaczone treningi z poprzedniego planu
  if (plan) naj.dni.forEach((d, i) => { d.tr = Object.assign({ ona: false, on: false }, plan.dni[i] && plan.dni[i].tr); });
  plan = naj; odhaczone = {};
  LS.set('plan', plan); LS.set('odhaczone', odhaczone);
  Z([[['start'], plan.start], [['dni'], dniMapa()], [['odhaczone'], {}]]);
}
function planAktualny() {
  if (!plan || !plan.dni || plan.dni.length !== 7) return false;
  return plan.dni.every(d => [d.sn, d.k18, d.ob, d.m13.wsp, d.m13.ona, d.m13.on].every(id => !id || DB.dania.has(id)));
}

// ---------- lista zakupów ----------
function zakupy(w) {
  const poz = new Map(), inne = new Set(), przyprawy = new Set();
  const dodaj = (produkt, kat, q, u) => {
    if (!poz.has(produkt)) poz.set(produkt, { produkt, kat: kat || 'zapas', il: {} });
    const p = poz.get(produkt); p.il[u] = (p.il[u] || 0) + q;
    if (kat === 'zamrażarka' || (kat === 'świeże' && p.kat === 'zapas')) p.kat = kat;
  };
  for (const g of w.garnki) {
    for (const i of g.dish.skladniki) {
      if (i.ilosc && i.produkt) dodaj(i.produkt, i.kategoria, i.ilosc * skala(g, i), i.jednostka);
      else inne.add(i.nazwa + (g.dish.warianty && g.dish.warianty.length && i.nazwa.startsWith('GLAZURA') ? '' : '') + ' — ' + g.dish.nazwa);
    }
    (g.dish.przyprawy || []).forEach(t => przyprawy.add(t));
    if (g.dosypka) { dodaj('odżywka białkowa', 'zapas', DB.dosypka.odzywka * g.dosypka.skala, 'g'); dodaj('skyr naturalny', 'świeże', DB.dosypka.skyr * g.dosypka.skala, 'g'); }
    if (g.dodatek) dodaj('skyr naturalny', 'świeże', g.dodatek.g, 'g');
  }
  plan.dni.forEach(day => OS.forEach(p => {
    if (day.tr[p]) { dodaj('odżywka białkowa', 'zapas', DB.shake[p].odzywka_g, 'g'); dodaj('mleko 2%', 'świeże', DB.shake[p].mleko_ml, 'ml'); }
  }));
  const wynik = { 'świeże': [], 'zapas': [], 'zamrażarka': [] };
  for (const p of poz.values()) {
    const czesci = Object.entries(p.il).map(([u, q]) => {
      if (u === 'g' || u === 'ml') return Math.ceil(q / 10) * 10 + ' ' + u;
      const krok = (u === 'szt.' || u === 'krom.' || u === 'pusz.') ? 1 : 0.5;
      return ulamek(Math.ceil(q / krok - 1e-6) * krok) + ' ' + u;
    });
    let dop = '';
    const o = DB.opak[p.produkt];
    if (o) {
      const q = p.il[o.jednostka], szt = p.il['szt.'];
      if (q) { const qz = o.jednostka === 'szt.' ? Math.ceil(q - 1e-6) : Math.ceil(q / 10) * 10, n = Math.ceil(qz / o.wielkosc); dop = `${n}× ${o.rodzaj} ${o.wielkosc} ${o.jednostka}, zostaje ${n * o.wielkosc - qz} ${o.jednostka}`; }
      else if (szt && o.sztuk_ok) { const n = Math.ceil(szt / o.sztuk_ok - 1e-6); dop = `${n}× ${o.rodzaj} ${o.wielkosc} ${o.jednostka} (ok. ${o.sztuk_ok} szt.)`; }
    }
    (wynik[p.kat] || wynik.zapas).push({ produkt: p.produkt, ile: czesci.join(' + '), dop });
  }
  Object.values(wynik).forEach(a => a.sort((x, y) => x.produkt.localeCompare(y.produkt, 'pl')));
  return { wynik, inne: [...inne], przyprawy: [...przyprawy] };
}

// ---------- widoki ----------
function dataDnia(d) { const t = new Date(plan.start + 'T12:00:00'); t.setDate(t.getDate() + d); return t; }
function dzisIdx() { const t = new Date(); t.setHours(12, 0, 0, 0); const i = Math.round((t - dataDnia(0)) / 864e5); return i >= 0 && i < 7 ? i : 0; }
function stan(b, c) { return b < c.bMin ? ['za mało', 'zle'] : b > c.bMax ? ['za dużo', 'zle'] : ['w celu', 'ok']; }

function widokTydzien() {
  const c = cele(), w = oblicz(plan, c);
  if (otwartyDzien === null) otwartyDzien = dzisIdx();
  const sr = p => sum(w.dni, x => x[p].b) / 7, srK = p => sum(w.dni, x => x[p].kcal) / 7;
  let h = `<h1>Tydzień ${dataDnia(0).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}–${dataDnia(6).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</h1>
  <p class="mute">Propozycja apki. Nie pasuje Ci posiłek? Kliknij „zmień” — nowe danie dostanie gramatury pod to samo makro.</p>
  <div class="cele">${OS.map(p => { const [t, kl] = stan(sr(p), c[p]); return `<div class="cel ${p}"><b>${ETY[p]}</b><span class="duze">${r0(srK(p))} kcal</span>
    <small>średnio / dzień · cel ${c[p].kcal}</small><small>białko ${r0(sr(p))} g · cel ${c[p].bMin}–${c[p].bMax} g <span class="znak ${kl}">${t}</span></small></div>`; }).join('')}</div>`;
  w.dni.forEach((x, d) => {
    const day = plan.dni[d];
    h += `<details class="dzien" data-d="${d}" ${d === otwartyDzien ? 'open' : ''}><summary><b>${DNI[d]} <span class="mute">${dataDnia(d).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</span></b>
      <span><span class="ona">${r0(x.ona.kcal)} kcal · ${r0(x.ona.b)} g</span><br><span class="on">${r0(x.on.kcal)} kcal · ${r0(x.on.b)} g</span></span></summary><div class="dzien-tresc">
      <div class="trening"><span class="mute">Trening:</span>${OS.map(p => `<label class="${p}"><input type="checkbox" data-tr="${d}:${p}" ${day.tr[p] ? 'checked' : ''}> ${ETY[p]}</label>`).join('')}</div>`;
    x.sloty.forEach(({ g, odgrzewane }) => {
      const moje = g.porcje.filter(q => q.d === d);
      const liczby = moje.map(q => { const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 }; return `<span class="${q.p}">${ETY[q.p]} ${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g</span>`; }).join(' &nbsp; ');
      let zn = '';
      if (odgrzewane) zn += `<span class="znaczek">odgrzewasz z ${DNI_KR[g.d]}</span> `;
      else if (g.porcje.length > 2) zn += `<span class="znaczek">gotujesz na 2 dni</span> `;
      if (g.ratio) zn += g.wyrownane ? `<span class="znaczek">makro wyrównane po zamianie</span> ` : `<span class="znaczek ostrz">białko ${g.roznica > 0 ? '+' : '−'}${r0(Math.abs(g.roznica) / g.porcje.length)} g na porcję względem poprzedniego dania</span> `;
      if (g.dodatek) zn += `<span class="znaczek">+ skyr ${fq(g.dodatek.g, 'g')} obok dania</span> `;
      if (g.s > 1.7 || g.s < 0.55) zn += `<span class="znaczek ostrz">porcja ×${g.s.toFixed(2)} względem przepisu</span>`;
      h += `<div class="posilek"><div class="pora">${PORA[g.slot]}${g.slot === 'm13ona' ? ' · ONA' : g.slot === 'm13on' ? ' · ON' : ''}</div>
        <div class="gora"><button class="nazwa" data-przepis="${w.garnki.indexOf(g)}:${d}">${esc((g.dish.kod ? g.dish.kod + ' ' : '') + g.dish.nazwa)}</button>
        ${odgrzewane ? '' : `<button class="btn maly" data-zmien="${d}:${g.slot}">zmień</button>`}</div>
        <div class="liczby">${liczby}</div>${zn}</div>`;
    });
    const sh = OS.filter(p => day.tr[p]);
    if (sh.length) h += `<div class="posilek"><div class="pora">po treningu · shake</div><div class="liczby">${sh.map(p => `<span class="${p}">${ETY[p]}: odżywka ${DB.shake[p].odzywka_g} g + mleko ${DB.shake[p].mleko_ml} ml · ${DB.shake[p].kcal} kcal · ${DB.shake[p].bialko} g</span>`).join('<br>')}</div></div>`;
    const wi = wieczorem(w, d);
    if (wi.length) h += `<div class="wieczor"><b>Wieczorem przygotuj na jutro</b><ul>${wi.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    h += `</div></details>`;
  });
  h += `<div class="rzad" style="margin-top:16px"><button class="btn" id="nowy">Ułóż inny tydzień</button><button class="btn glowny" id="doZakupow">Lista zakupów</button></div>`;
  $('#view').innerHTML = h;
  window._w = w;
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

function oknoPrzepis(gi, d) {
  const g = window._w.garnki[gi], dish = g.dish;
  let wiersze = '', grupa = null;
  for (const i of dish.skladniki) {
    if (i.grupa && i.grupa !== grupa) { grupa = i.grupa; wiersze += `<tr class="grupa"><td colspan="2">${esc(grupa)}</td></tr>`; }
    wiersze += `<tr><td>${esc(i.nazwa)}${i.uwaga ? `<br><span class="mute">${esc(i.uwaga)}</span>` : ''}</td><td>${i.ilosc ? fq(i.ilosc * skala(g, i), i.jednostka) : ''}</td></tr>`;
  }
  if (g.dodatek) wiersze += `<tr class="grupa"><td colspan="2">DODATEK BIAŁKOWY — OBOK DANIA</td></tr><tr><td>skyr naturalny<br><span class="mute">wyrównuje białko po zamianie dania; dzielicie jak danie</span></td><td>${fq(g.dodatek.g, 'g')}</td></tr>`;
  const masa = dish.masa_g ? dish.masa_g * g.s : null;
  const pod = g.porcje.map(q => {
    let t = `${r0(q.udzial * 100)}% całości`;
    if (masa) t = q.p === 'ona' ? `nalej do szklanki na wadze ${r0(masa * q.udzial / 5) * 5} g` : 'reszta kielicha';
    if (g.dosypka && q.p === 'on') t += ` + dosypka: odżywka ${fq(DB.dosypka.odzywka * g.dosypka.skala, 'g')} i skyr ${fq(DB.dosypka.skyr * g.dosypka.skala, 'g')}`;
    const dk = g.dosypka && q.p === 'on' ? g.dosypka : { kcal: 0, b: 0 };
    return `<div class="${q.p}"><b>${ETY[q.p]}${g.porcje.length > 2 ? ' · ' + DNI_KR[q.d] : ''}</b>${t}<br>${r0(q.kcal + dk.kcal)} kcal · ${r0(q.b + dk.b)} g białka</div>`;
  }).join('');
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>${esc((dish.kod ? dish.kod + ' ' : '') + dish.nazwa)}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">${dish.czas ? 'Czas: ' + esc(dish.czas) : ''}${dish.sprzet ? ' · Sprzęt: ' + esc(dish.sprzet) : ''}</p>
    ${dish.dodane ? '<p class="mute">Danie dodane do bazy — wartości liczone z tabel, nie z Twojego planu.</p>' : ''}
    <h3>Składniki — ${g.porcje.length > 2 ? 'na 2 dni' : g.porcje.length === 1 ? 'jedna porcja' : 'dla Was dwojga'}</h3>
    <table class="skl">${wiersze}</table>
    ${(dish.przyprawy || []).length ? `<p class="mute">Do tego: ${esc(dish.przyprawy.join('; '))}</p>` : ''}
    ${(dish.warianty || []).length ? `<h3>Glazura — wybierz jedną</h3>${dish.warianty.map(v => `<p><b>${esc(v.nazwa)}</b>: ${esc(v.sklad)}</p>`).join('')}` : ''}
    <h3>Kto ile bierze</h3><div class="podzial">${pod}</div>
    ${dish.kroki && dish.kroki.length ? `<h3>Wykonanie</h3><p class="mute">Gramy i mililitry w krokach są już przeliczone na Waszą porcję. Liczbę sztuk i łyżek bierz z tabeli składników.</p><ol class="kroki">${dish.kroki.map(k => `<li>${esc(krokPrzeliczony(g, k))}</li>`).join('')}</ol>` : ''}
    ${dish.odgrzewanie ? `<p><b>Drugi dzień:</b> ${esc(dish.odgrzewanie)}</p>` : ''}
    ${dish.uwaga ? `<div class="uwaga">${esc(dish.uwaga)}</div>` : ''}`;
  $('#modal').hidden = false;
}

function oknoZmien(d, slot) {
  const day = plan.dni[d];
  const teraz = slot === 'm13' ? day.m13.wsp : slot === 'm13ona' ? day.m13.ona : slot === 'm13on' ? day.m13.on : day[slot];
  const pula = slot === 'ob' ? (day.ob2 ? DB.pula.ob2 : DB.pula.ob1) : DB.pula[slot];
  const lista = pula.slice().sort((x, y) => x.nazwa.localeCompare(y.nazwa, 'pl'));
  $('#modal-box').innerHTML = `<div class="okno-gora"><h2>Zmień: ${esc(PORA[slot].split(' · ')[1])}</h2><button class="btn maly" data-zamknij>Zamknij</button></div>
    <p class="mute">${DNI[d]}. Kalorie zostają takie same, a gramatury nowego dania dobiorę tak, żeby białko też się zgadzało.</p>
    ${lista.map(x => `<button class="wybor ${x.id === teraz ? 'teraz' : ''}" data-wybierz="${d}:${slot}:${esc(x.id)}"><b>${esc((x.kod ? x.kod + ' ' : '') + x.nazwa)}</b>
      <span class="mute">${x.id === teraz ? 'obecnie w planie · ' : ''}${x.czas ? esc(x.czas) + ' · ' : ''}w przepisie ${r0(x.razem.bialko / x.razem.kcal * 1000) / 10} g białka na 100 kcal${x.dodane ? ' · dodane' : ''}</span></button>`).join('')}`;
  $('#modal').hidden = false;
}
function wybierz(d, slot, id) {
  const day = plan.dni[d];
  const stary = window._w.garnki.find(g => g.d === d && g.slot === slot);
  const teraz = stary ? stary.dish.id : null;
  if (id !== teraz) {
    day.ratio = day.ratio || {};
    if (stary) day.ratio[slot] = stary.P / stary.K;      // białko na kcal w zastępowanym daniu
    if (slot === 'm13') day.m13.wsp = id; else if (slot === 'm13ona') day.m13.ona = id; else if (slot === 'm13on') day.m13.on = id; else day[slot] = id;
    LS.set('plan', plan);
    const pole = slot === 'm13' ? ['m13', 'wsp'] : slot === 'm13ona' ? ['m13', 'ona'] : slot === 'm13on' ? ['m13', 'on'] : [slot];
    const zm = [[['dni', d, ...pole], id]];
    if (stary) zm.push([['dni', d, 'ratio', slot], day.ratio[slot]]);
    Z(zm);
  }
  odroczone = false;
  $('#modal').hidden = true;
  rysuj();
}

function widokZakupy() {
  const w = oblicz(plan, cele()), z = zakupy(w);
  const klucz = t => plan.start + '|' + t;
  let h = `<h1>Zakupy na tydzień</h1><p class="mute">Suma ze wszystkich dań, koktajli, dosypki i shake'ów w dni treningowe, na Was dwoje. Zmiana dania od razu przelicza listę.</p>`;
  const nazwy = { 'świeże': 'Świeże', 'zapas': 'Zapas — sprawdź, czy masz', 'zamrażarka': 'Do zamrażarki' };
  for (const kat of ['świeże', 'zamrażarka', 'zapas']) {
    if (!z.wynik[kat].length) continue;
    h += `<h2>${nazwy[kat]}</h2><div class="karta">` + z.wynik[kat].map(p => {
      const k = klucz(p.produkt), on = !!odhaczone[k];
      return `<label class="poz ${on ? 'kupione' : ''}"><input type="checkbox" data-kup="${esc(k)}" ${on ? 'checked' : ''}><span class="co"><b>${esc(p.produkt)}</b> — ${esc(p.ile)}${p.dop ? `<small>${esc(p.dop)}</small>` : ''}</span></label>`;
    }).join('') + `</div>`;
  }
  if (z.inne.length) h += `<h2>Bez gramatury</h2><div class="karta">${z.inne.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (z.przyprawy.length) h += `<h2>Przyprawy i dodatki</h2><div class="karta"><p class="mute">Sprawdź w szafce:</p>${z.przyprawy.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  h += `<button class="btn glowny szeroki" id="udostepnij">Udostępnij listę</button>`;
  $('#view').innerHTML = h;
  window._z = z;
}
function tekstListy() {
  const z = window._z, n = { 'świeże': 'ŚWIEŻE', 'zamrażarka': 'ZAMRAŻARKA', 'zapas': 'ZAPAS' };
  let t = `Zakupy — tydzień od ${dataDnia(0).toLocaleDateString('pl-PL')}\n`;
  for (const kat of ['świeże', 'zamrażarka', 'zapas']) if (z.wynik[kat].length) t += `\n${n[kat]}\n` + z.wynik[kat].map(p => `- ${p.produkt}: ${p.ile}${p.dop ? ' (' + p.dop + ')' : ''}`).join('\n') + '\n';
  return t;
}

function widokUstawienia(pierwszy) {
  const p0 = profil || { ona: { plec: 'k', akt: '1.375', cel: 'redukcja' }, on: { plec: 'm', akt: '1.375', cel: 'redukcja' } };
  const pole = (p, k, et, typ = 'number', dod = '') => `<label class="pole"><span>${et}</span><input type="${typ}" inputmode="decimal" data-p="${p}" data-k="${k}" value="${esc(p0[p][k] ?? '')}" ${dod}></label>`;
  const blok = p => `<div class="karta"><h2 class="${p}" style="margin-top:0">${ETY[p]}</h2>
    <div class="dwa">${pole(p, 'wiek', 'Wiek (lata)')}${pole(p, 'waga', 'Waga (kg)')}</div>
    <div class="dwa">${pole(p, 'wzrost', 'Wzrost (cm)')}<label class="pole"><span>Płeć</span><select data-p="${p}" data-k="plec"><option value="k" ${p0[p].plec === 'k' ? 'selected' : ''}>kobieta</option><option value="m" ${p0[p].plec === 'm' ? 'selected' : ''}>mężczyzna</option></select></label></div>
    <label class="pole"><span>Aktywność</span><select data-p="${p}" data-k="akt">${AKT.map(([v, t]) => `<option value="${v}" ${p0[p].akt === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="pole"><span>Cel diety</span><select data-p="${p}" data-k="cel">${Object.entries(CEL).map(([v, t]) => `<option value="${v}" ${p0[p].cel === v ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>
    ${pole(p, 'wlasne', 'Własny cel kcal (opcjonalnie — zastępuje wyliczenie)', 'number', 'placeholder="np. 1750"')}
    <div class="wynik ${p}" data-wynik="${p}"></div></div>`;
  $('#view').innerHTML = `<h1>${pierwszy ? 'Zacznijmy od Was' : 'Ustawienia'}</h1>
    <p class="mute">Z tych danych liczę dzienne zapotrzebowanie (wzór Mifflina-St Jeora) i pod nie układam tydzień. To szacunek, nie zalecenie medyczne.</p>
    ${pierwszy ? kartaDolacz() : ''}${blok('ona')}${blok('on')}
    <button class="btn glowny szeroki" id="zapisz">${pierwszy ? 'Ułóż mój tydzień' : 'Zapisz i przelicz plan'}</button>
    ${pierwszy ? '' : kartaWspolny() + `<h2>Baza dań</h2><div class="karta"><p>${DB.dania.size} dań w bazie (w tym ${[...DB.dania.values()].filter(d => d.dodane).length} dodanych poza planem z PDF-ów).</p><p class="mute">Nowe dania pojawiają się po odświeżeniu aplikacji.</p>
    <div class="rzad"><button class="btn" id="odswiez">Odśwież bazę</button><button class="btn" id="wyczysc">Wyczyść dane</button></div></div>`}`;
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
    zakladka = 'tydzien'; rysuj();
  };
  if (!pierwszy) {
    $('#odswiez').onclick = async () => { await wczytajBaze(); rysuj(); };
    $('#wyczysc').onclick = () => {
      if (!confirm('Usunąć zapisane dane, plan i odhaczone zakupy z tego telefonu?' + (window.Sync && window.Sync.kod ? ' Telefon zostanie odłączony od wspólnego planu — u drugiej osoby plan zostaje.' : ''))) return;
      if (window.Sync && window.Sync.kod) window.Sync.odlacz();
      ['profil', 'plan', 'odhaczone'].forEach(LS.del); profil = plan = null; odhaczone = {}; rysuj();
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
  $('#modal').hidden = true;
  if (odroczone) { odroczone = false; rysuj(); }
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
  if (!planAktualny()) {
    if (S && S.kod && plan) {   // wspólny plan z daniem, którego ten telefon nie zna — nie układam nowego, żeby nie nadpisać planu drugiej osoby
      $('#tabs').hidden = false;
      $('#view').innerHTML = `<div class="uwaga">Wspólny plan zawiera dania, których nie ma jeszcze w bazie na tym telefonie.</div><button class="btn glowny szeroki" id="odswiezBaze">Odśwież bazę dań</button>`;
      return;
    }
    ulozTydzien();
  }
  $('#tabs').hidden = false;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('akt', b.dataset.tab === zakladka));
  if (zakladka === 'tydzien') widokTydzien(); else if (zakladka === 'zakupy') widokZakupy(); else widokUstawienia(false);
}

// ---------- zdarzenia ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button, summary');
  if (!t) { if (e.target.id === 'modal') zamknijOkno(); return; }
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
  else if (t.id === 'nowy') { if (confirm('Ułożyć nowy tydzień? Twoje zamiany przepadną.')) { ulozTydzien(); rysuj(); } }
  else if (t.id === 'doZakupow') { zakladka = 'zakupy'; rysuj(); window.scrollTo(0, 0); }
  else if (t.id === 'udostepnij') {
    const tekst = tekstListy();
    if (navigator.share) navigator.share({ title: 'Zakupy', text: tekst }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(tekst).then(() => alert('Lista skopiowana — wklej ją do notatek albo SMS-a.'), () => alert(tekst));
    else alert(tekst);
  }
  else if (t.tagName === 'SUMMARY') { const d = +t.parentElement.dataset.d; otwartyDzien = t.parentElement.open ? -1 : d; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.tr) { const [d, p] = t.dataset.tr.split(':'); plan.dni[+d].tr[p] = t.checked; otwartyDzien = +d; LS.set('plan', plan); Z([[['dni', +d, 'tr', p], t.checked]]); rysuj(); }
  else if (t.dataset.kup) {
    if (t.checked) odhaczone[t.dataset.kup] = 1; else delete odhaczone[t.dataset.kup];
    LS.set('odhaczone', odhaczone); Z([[['odhaczone', t.dataset.kup], t.checked ? 1 : undefined]]);
    t.closest('.poz').classList.toggle('kupione', t.checked);
  }
});

// ---------- interfejs dla sync.js ----------
window.App = {
  stanDoChmury: () => ({ profil, start: plan.start, dni: dniMapa(), odhaczone }),
  zdalny(data) {
    const nowyProfil = data.profil && data.profil.ona && data.profil.on ? data.profil : profil;
    let nowyPlan = plan;
    if (data.start && data.dni) {
      const dni = [0, 1, 2, 3, 4, 5, 6].map(i => data.dni[i]);
      if (dni.every(Boolean)) nowyPlan = { start: data.start, dni: dni.map(d => Object.assign({ ratio: {}, tr: { ona: false, on: false } }, d)) };
    }
    const noweOdh = data.odhaczone || {};
    const przed = stabilny({ profil, plan, odhaczone });
    profil = nowyProfil; plan = nowyPlan; odhaczone = noweOdh;
    if (stabilny({ profil, plan, odhaczone }) === przed && !ekranCzekania) return;   // nic nowego (np. potwierdzenie własnej zmiany)
    LS.set('profil', profil); LS.set('plan', plan); LS.set('odhaczone', odhaczone);
    if (!$('#modal').hidden) { odroczone = true; return; }                        // nie zamykam otwartego przepisu
    if (zakladka === 'ustawienia' && !ekranStartowy && !ekranCzekania) return;    // nie kasuję wypełnianego formularza
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

// ---------- start ----------
(async function start() {
  try { await wczytajBaze(); }
  catch (e) { $('#view').innerHTML = '<p class="pusty">Nie udało się wczytać bazy dań. Sprawdź połączenie i odśwież.</p>'; return; }
  rysuj();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
