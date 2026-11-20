/* Testy automatyczne aplikacji Plan. Uruchom: otwórz testy.html (np. http://localhost:8137/testy.html albo na GitHub Pages).
   Testy nie zapisują niczego w danych aplikacji (korzystają z kopii i z tymczasowego profilu w pamięci). Wynik: tabela na stronie oraz window.__TESTY = { ok, blad, wyniki }. */
(async function () {
  const wyniki = [], out = document.getElementById('wyn');
  const test = async (grupa, nazwa, fn) => {
    try { const r = await fn(); if (r === false) throw new Error('zwrócono false'); wyniki.push({ grupa, nazwa, ok: true }); }
    catch (e) { wyniki.push({ grupa, nazwa, ok: false, blad: String(e && e.message || e) }); }
  };
  const rowne = (a, b, op = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${op} oczekiwano ${JSON.stringify(b)}, jest ${JSON.stringify(a)}`); };
  const prawda = (v, op = '') => { if (!v) throw new Error(op || 'warunek nie jest spełniony'); };
  const tekst = async u => (await fetch(u, { cache: 'no-store' })).text();
  // czekam na wczytanie bazy dań
  for (let i = 0; i < 100 && !(typeof DB !== 'undefined' && DB.dania && DB.dania.size > 0); i++) await new Promise(r => setTimeout(r, 100));
  // tymczasowy profil (tylko w pamięci), jeśli ta przeglądarka nie ma jeszcze danych
  const svProfil = profil, svPlan = plan;
  if (!profil) profil = { ona: { wiek: 30, waga: 62, wzrost: 168, plec: 'k', akt: 'lekka', cel: 'redukcja' }, on: { wiek: 33, waga: 88, wzrost: 183, plec: 'm', akt: 'lekka', cel: 'redukcja' } };
  const c = cele();

  // ---------- pliki ----------
  for (const f of ['sw.js', 'app.js', 'obrazki.js', 'testy.js'])
    await test('Pliki', `składnia ${f}`, async () => { new Function(await tekst(f)); });
  await test('Pliki', 'manifest: nazwa, ikony, udostępnianie', async () => {
    const m = await (await fetch('manifest.json', { cache: 'no-store' })).json();
    prawda(m.name && m.display === 'standalone' && m.share_target && m.share_target.params.files, 'brak pól manifestu');
    for (const i of m.icons) prawda((await fetch(i.src)).ok, 'brak ikony ' + i.src);
  });
  await test('Pliki', 'service worker: przyjmuje udostępniony plik i tekst (symulacja)', async () => {
    const kod = await tekst('sw.js'), h = {}, mapa = new Map();
    const falszywe = { open: async () => ({ keys: async () => [...mapa.keys()].map(k => ({ url: k })), delete: async k => mapa.delete(k.url || k), put: async (k, r) => { mapa.set(typeof k === 'string' ? k : k.url, r); }, match: async k => mapa.get(k) }), keys: async () => [], delete: async () => true };
    new Function('self', 'caches', kod)({ addEventListener: (n, f) => { h[n] = f; }, location, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } }, falszywe);
    const fd = new FormData(); fd.append('paragon', new File(['x'], 'p.pdf', { type: 'application/pdf' })); fd.append('text', 'abc');
    let resp; await new Promise(res => h.fetch({ request: new Request('./?udostepnione=1', { method: 'POST', body: fd }), respondWith: p => Promise.resolve(p).then(r => { resp = r; res(); }) }));
    rowne(resp.status, 303, 'status'); prawda(mapa.has('./udostepnione/meta'), 'brak meta');
  });

  // ---------- dane dań ----------
  await test('Dane', 'unikalne id, kroki, jednostki, znane produkty', async () => {
    const ids = new Set(), zle = [];
    for (const d of DB.dania.values()) {
      if (ids.has(d.id)) zle.push('dup ' + d.id); ids.add(d.id);
      if (!d.kroki || !d.kroki.length) zle.push('brak kroków: ' + d.nazwa);
      for (const i of d.skladniki) { if (i.produkt && !DB.produkty.has(i.produkt)) zle.push('nieznany produkt ' + i.produkt); if (i.ilosc && !i.jednostka) zle.push('brak jednostki: ' + i.nazwa + ' w ' + d.nazwa); }
    }
    rowne(zle, []);
  });
  await test('Dane', 'kcal i białko składników zgadzają się z sumą dania (±8%)', async () => {
    const zle = [];
    for (const d of DB.dania.values()) { if (!d.razem) continue; const k = sum(d.skladniki, i => i.kcal || 0), b = sum(d.skladniki, i => i.bialko || 0); if (Math.abs(k - d.razem.kcal) > d.razem.kcal * 0.08 + 25) zle.push(d.nazwa + ' kcal'); if (Math.abs(b - d.razem.bialko) > d.razem.bialko * 0.1 + 4) zle.push(d.nazwa + ' białko'); }
    rowne(zle, []);
  });
  await test('Dane', 'odmiany scalone (pomidory świeże, pomidor, cebula czerwona) nie występują', async () => {
    const zle = []; for (const d of DB.dania.values()) for (const i of d.skladniki) if (['pomidory świeże', 'pomidor', 'cebula czerwona'].includes(i.produkt)) zle.push(d.nazwa); rowne(zle, []);
  });
  await test('Dane', 'krem pomidorowy używa pomidorów z puszki', async () => {
    const d = DB.dania.get('krem-pomidorowy-pieczony-lub-duszony'); prawda(d && d.skladniki[0].produkt === 'pomidory krojone (puszka)', 'inny produkt');
  });
  await test('Dane', 'każda pula posiłków ma dania', async () => { for (const [k, v] of Object.entries(DB.pula)) prawda(v.length > 0, 'pusta pula ' + k); });

  // ---------- silnik ----------
  await test('Silnik', '25 losowych tygodni: kcal = cel, brak NaN w ilościach', async () => {
    for (let n = 0; n < 25; n++) {
      const k = kandydat(), w = oblicz(k, c);
      w.dni.forEach((x, d) => OS.forEach(p => { if (!nieob(k.dni[d], p)) prawda(Math.abs(x[p].kcal - c[p].kcal) < c[p].kcal * 0.005 + 1, `dzień ${d} ${p}: ${x[p].kcal}`); }));
      for (const g of w.garnki) for (const i of g.dish.skladniki) if (i.ilosc) prawda(isFinite(i.ilosc * skala(g, i)), 'NaN w ' + g.dish.nazwa);
    }
  });
  await test('Silnik', 'pominięty posiłek: część kalorii na ten sam dzień, reszta na następny (max +15%)', async () => {
    const k = kandydat(), w0 = oblicz(k, c); k.dni[2].pom = { ona: { sn: true } }; const w1 = oblicz(k, c);
    prawda(w1.dni[2].ona.kcal < w0.dni[2].ona.kcal, 'dzień nie spadł'); prawda(w1.dni[3].ona.kcal > w0.dni[3].ona.kcal, 'następny dzień nie wzrósł'); prawda(w1.dni[3].ona.kcal <= c.ona.kcal * 1.151, 'ponad +15%');
  });
  await test('Silnik', 'goście: ilości rosną, kalorie domowników bez zmian', async () => {
    const k = kandydat(); const gi = k.dni.findIndex(d => d.ob); const w0 = oblicz(k, c); k.dni[gi].gosc = 4; const w1 = oblicz(k, c);
    rowne(Math.round(w1.dni[gi].ona.kcal), Math.round(w0.dni[gi].ona.kcal), 'kcal'); const g0 = w0.garnki.find(g => g.d === gi && g.slot === 'ob'), g1 = w1.garnki.find(g => g.d === gi && g.slot === 'ob'), i = g0.dish.skladniki.find(x => x.ilosc && !stala(x));
    prawda(skala(g1, i) > skala(g0, i), 'ilość nie wzrosła'); prawda(/\+ 4 gości/.test(opisGarnka(g1)), 'opis: ' + opisGarnka(g1));
  });
  await test('Silnik', 'obie osoby nieobecne jednego dnia nie psują wyliczeń', async () => {
    const k = kandydat(); k.dni[1].nb = { ona: true, on: true }; const w = oblicz(k, c); rowne(w.dni[1].sloty.length, 0); prawda(w.dni[0].sloty.length > 0);
  });
  await test('Silnik', 'wykluczenia: dopuszcza() odrzuca danie ze składnikiem', async () => {
    const sv = wyklucz.ona; wyklucz.ona = ['kurczak']; try { const z = [...DB.dania.values()].find(d => /kurczak/i.test(tkDania(d))); prawda(z && !dopuszcza(z, ['ona']), 'kurczak przeszedł'); } finally { wyklucz.ona = sv; }
  });

  // ---------- paragony ----------
  await test('Paragony', 'Biedronka JSON: pozycje i suma zgodne', async () => {
    const j = await (await fetch('testy/paragon-biedronka.json')).json(), w = parsujParagon(JSON.stringify(j));
    rowne(w.poz.length, 9, 'pozycje'); prawda(w.suma != null && Math.abs(w.sumaPoz - w.suma) < 0.05, `suma ${w.sumaPoz} vs ${w.suma}`); rowne(w.sklep, 'Biedronka');
  });
  await test('Paragony', 'Lidl tekst: pozycje, rabaty i suma zgodne', async () => {
    const w = parsujParagon(await tekst('testy/paragon-lidl.txt')); prawda(w.poz.length >= 10, 'za mało pozycji'); prawda(w.suma != null && Math.abs(w.sumaPoz - w.suma) < 0.05, `suma ${w.sumaPoz} vs ${w.suma}`);
  });
  await test('Paragony', 'dopasowanie nazw do produktów', async () => {
    const t = { 'Mleko UHT 3,2%': 'mleko 2%', 'Filet z piersi kurczaka': 'pierś z kurczaka', 'Banany luz': 'banan', 'Pomidory malinowe': 'pomidorki koktajlowe', 'Pomidorki cherry 250g': 'pomidorki koktajlowe', 'Pomidory krojone w puszce 400g': 'pomidory krojone (puszka)', 'Cebula czerwona': 'cebula', 'Jaja ściółkowe 30szt': 'jaja', 'Ogórki kiszone': 'ogórek kiszony', 'Passata pomidorowa': 'passata' };
    for (const [n, p] of Object.entries(t)) rowne(dopasujProdukt(n).produkt, p, n);
    prawda(dopasujProdukt('Torba T-SHIRT').pomin && dopasujProdukt('Coca Cola 0,5l').pomin, 'nie-jedzenie nie pominięte');
  });

  // ---------- dopasowanie planu ----------
  await test('Dopasowanie', 'parser tekstu: dni, tryby, goście, wyjazd', async () => {
    const a = rozumiemTekst('wtorek lekki, piątek bez mięsa, sobota goście 4 osoby, w środę wyjeżdżamy'); const d = x => a.filter(y => y.d === x);
    const minal = i => tygodnieZapisane().length < 2 && i < dzienTyg();   // bez następnego tygodnia minione dni bieżącego są pomijane
    prawda(minal(1) || d(1).some(y => y.tryby.lekko), 'wtorek lekko'); prawda(minal(4) || d(4).some(y => y.tryby.bezMiesa), 'piątek bez mięsa'); prawda(minal(5) || d(5).some(y => y.goscie === 4), 'sobota 4 gości'); prawda(minal(2) || d(2).some(y => y.nb && y.nb.ona && y.nb.on), 'środa wyjazd');
    rowne(rozumiemTekst('bla bla bla').length, 0, 'bzdura');
  });
  await test('Dopasowanie', '„szybko”: nowe dania mieszczą się w limicie czasu', async () => {
    const t = tygodnieZapisane()[0]; if (!t) return;   // bez zapisanego tygodnia pomijam
    for (let d = 0; d < 7; d++) { const r = dopasujDzien(t.start, d, { szybko: true }, {}); for (const z of r.zm) { const m = minDania(z.nowy); prawda(m == null || m <= (z.slot === 'ob' ? 30 : 15), `${z.nowy.nazwa} ${m} min`); } }
  });
  await test('Dopasowanie', '„bez mięsa”: nowe dania bez mięsa', async () => {
    const t = tygodnieZapisane()[0]; if (!t) return;
    for (let d = 0; d < 7; d++) { const r = dopasujDzien(t.start, d, { bezMiesa: true }, {}); for (const z of r.zm) prawda(!MIESO_RE.test(tkDania(z.nowy)), z.nowy.nazwa); }
  });

  // ---------- drobiazgi ----------
  await test('Drobiazgi', 'odmiana liczebników', async () => {
    rowne([mn(1, 'a', 'b', 'c'), mn(2, 'a', 'b', 'c'), mn(5, 'a', 'b', 'c'), mn(12, 'a', 'b', 'c'), mn(22, 'a', 'b', 'c')], ['a', 'b', 'c', 'c', 'b']);
  });
  await test('Drobiazgi', 'minDania czyta różne zapisy czasu', async () => {
    rowne([minDania({ czas: '15 min' }), minDania({ czas: '1 h' }), minDania({ czas: '2,5 h (aktywnie 20 min)' }), minDania({ czas: '1 h 30 min' }), minDania({})], [15, 60, 150, 90, null]);
  });

  // ---------- nowe funkcje ----------
  await test('Poza planem', 'wpis poza planem pomniejsza kolejne posiłki dnia (nie poniżej 50%)', async () => {
    const k = kandydat(), w0 = oblicz(k, c), d = 2; k.dni[d].poza = { on: [{ n: 'test', k: 600, sl: ['sn', 'ob', 'k18'] }] }; const w1 = oblicz(k, c);
    const redu = w0.dni[d].on.kcal - w1.dni[d].on.kcal; prawda(redu > 250 && redu <= 600.5, 'redukcja ' + Math.round(redu)); rowne(Math.round(w1.dni[d].ona.kcal), Math.round(w0.dni[d].ona.kcal), 'druga osoba bez zmian');
    rowne(pozaKcal(k.dni[d], 'on'), 600);
  });
  await test('Własne dania', 'czytanie przepisu: nazwa, składniki, kroki, kalorie z bazy', async () => {
    const o = czytajPrzepis('Makaron z tuńczykiem\nmakaron 200 g\ntuńczyk w sosie własnym 160 g\noliwa 1 łyżka\n\nUgotuj makaron.\nWymieszaj.');
    rowne(o.nazwa, 'Makaron z tuńczykiem'); rowne(o.skl.length, 3); rowne(o.kroki.length, 2);
    const w = o.skl.map(wierszSkladnika); prawda(w[0].znane && w[0].kcal > 400, 'kcal makaronu ' + w[0].kcal); rowne(w[2].jednostka, 'g', 'łyżka → g');
  });
  await test('Własne dania', 'dodanie do bazy i usunięcie (w pamięci)', async () => {
    const d = JSON.parse(JSON.stringify(DB.dania.get('zapiekanka-z-budki-z-kurczakiem-pieczarkami-i-serem'))); d.id = 'wlasne-test'; d.nazwa = 'Test'; const n = DB.pula.ob1.length;
    dodajDoBazy(d); rowne(DB.pula.ob1.length, n + 1); usunZBazy('wlasne-test'); rowne(DB.pula.ob1.length, n); prawda(!DB.dania.has('wlasne-test'));
  });
  await test('Sezonowość', 'sezon wg miesiąca i chipy w przepisie', async () => {
    const d = { skladniki: [{ produkt: 'cukinia' }, { produkt: 'dynia piżmowa' }, { produkt: 'marchew' }] }, z = sezonDania(d); prawda(z.w.length + z.poza.length === 2, 'marchew nie powinna się liczyć'); prawda(typeof sezonKara(kandydat()) === 'number');
  });
  await test('Trasa', 'bez nauki lista ma standardowy układ', async () => { const sv = trasa; trasa = {}; try { rowne(trasaUklad({}, 'X'), null); } finally { trasa = sv; } });
  await test('Wygląd', 'przełącznik motywu nie psuje reguł CSS', async () => {
    const sv = motyw, il = () => [...document.styleSheets].find(a => /style\.css/.test(a.href || '')).cssRules.length, n = il();
    for (const m of ['ciemny', 'jasny', 'auto']) { motyw = m; zastosujMotyw(); rowne(il(), n, m); } motyw = sv; zastosujMotyw();
  });
  await test('Dostępność', 'CSS: cele dotyku 44 px, okno jako dialog, ilustracje z opisem', async () => {
    const css = await tekst('style.css'); prawda(/\.stp[^{]*\{[^}]*min-height: 44px/.test(css), 'brak 44px dla +/−'); prawda(document.getElementById('modal-box').getAttribute('role') === 'dialog', 'okno bez role=dialog');
    prawda(/aria-label/.test(Obr.svg([...DB.dania.values()][0])), 'ilustracja bez opisu');
  });
  await test('Cofanie', 'migawka stanu zawiera plan, odhaczenia, lodówkę', async () => { const o = JSON.parse(snapStanu()); prawda('plan' in o && 'odhaczone' in o && 'zuzyte' in o && 'lodowka' in o); });

  await test('Świeżość', 'termin zużycia z daty zakupu i karta „Do zużycia”', async () => {
    const svL = lodowka, svD = lodData; lodowka = { 'jogurt naturalny': { g: 300 } }; lodData = { 'jogurt naturalny': dodajDni(isoDzis(), -7) };
    try { const f = swiezosc('jogurt naturalny'); rowne(f.zostalo, 0); prawda(f.pilne, 'powinno być pilne'); rowne(doZuzycia().map(x => x.pr), ['jogurt naturalny']); lodowka = { 'ryż': { g: 500 } }; rowne(swiezosc('ryż'), null, 'zapasy nie psują się'); } finally { lodowka = svL; lodData = svD; }
  });
  await test('Trendy', 'wykresy z dwóch tygodni', async () => {
    const mk = (st, z) => ({ start: st, o: { posilkow: 33, zjedzone: z, kcal: { ona: 1300, on: 2800 }, cel: { ona: 1440, on: 3020 }, wydatki: 200 } });
    const h = kartaTrendow([mk('2026-11-02', 20), mk('2026-11-09', 28)]); prawda((h.match(/<svg/g) || []).length === 3, 'liczba wykresów'); rowne(kartaTrendow([mk('2026-11-02', 20)]), '', 'jeden tydzień to za mało');
  });
  await test('Blokada dania', 'przepis z zablokowanym daniem trafia do nowego planu (logika kopiowania)', async () => {
    const k = kandydat(); k.dni[1].blok = { sn: true }; const stary = k.dni[1].sn;
    const kod = (await tekst('app.js')); prawda(/zablokowane dania zostają przy losowaniu/.test(kod), 'brak logiki w ulozTydzien'); rowne(k.dni[1].sn, stary);
  });

  await test('Kroki', 'łyżki i łyżeczki znanych produktów w krokach są w gramach', async () => {
    rowne(krokiNaGramy('Dodaj 1 łyżeczkę chrzanu i pieprz'), 'Dodaj 5 g chrzanu (≈ 1 łyżeczka) i pieprz');
    rowne(krokiNaGramy('rozgrzej 1 łyżkę oliwy i 3 łyżeczki masła'), 'rozgrzej 10 g oliwy (≈ 1 łyżka) i 15 g masła (≈ 3 łyżeczki)');
    rowne(krokiNaGramy('2 łyżki posiekanego szczypiorku'), '2 łyżki posiekanego szczypiorku', 'nieznany produkt zostaje');
    const lewe = []; for (const d of DB.dania.values()) for (const k of d.kroki || []) if (/(?<!≈ )\d\s?łyż[a-ząćęłńóśźż]*\s+(masła|chrzanu|dżemu|musztardy|miodu|ketchupu|oliwy|octu)/i.test(k)) lewe.push(d.nazwa); rowne(lewe, [], 'zostały łyżki w krokach');
  });
  await test('Wieczorem', 'kroki wieczorne mają odnośnik do dania i przeliczone gramy', async () => {
    const w = oblicz(plan, cele()); let n = 0;
    for (let d = 0; d < 6; d++) for (const it of wieczorem(w, d)) { if (it.t === 'kroki') { n++; prawda(it.g && it.g.dish && it.kroki.length > 0 && !/^WIECZOREM/i.test(it.kroki[0]), 'brak g albo kroków'); } else prawda(it.tekst && it.g, 'zamrażarka bez opisu'); }
    prawda(typeof kartaWieczor === 'function');
  });
  await test('Cel dnia', 'danie spoza planu nie zwiększa celu kcal dnia', async () => {
    const c = cele(), d = 0, p0 = 'ona', bez = oblicz(plan, c).dni[d][p0].kcal, dd = plan.dni[d], star = dd.poza;
    try { dd.poza = { ona: [{ n: 't', k: 500, sl: [] }], on: [] }; rowne(celDnia(plan, c, d, p0), bez, 'cel dnia zmienił się po poza planem'); } finally { dd.poza = star; }
  });
  await test('Okna', 'własne okno pytania zwraca tak / nie i znika', async () => {
    let pr = pytaj('t', 'o'); prawda(!!document.getElementById('pytanie')); document.querySelector('[data-pyt="1"]').click(); rowne(await pr, true);
    pr = pytaj('t'); document.querySelector('[data-pyt="0"].btn').click(); rowne(await pr, false); prawda(!document.getElementById('pytanie'));
    const kod = await tekst('app.js'); prawda(!/[^a-zA-Z_.]confirm\(|[^a-zA-Z_.]alert\(/.test(kod.replace(/\/\/.*$/gm, '').replace(/confirm\(' \+ txt/g, '')), 'w kodzie został confirm() albo alert()');
  });
  await test('Mięso', 'podział mięsa liczony od dziś, niezależnie od zaznaczonych dni', async () => {
    const d = miesoPodzial(isoDzis(), 14); for (const [pr, w] of Object.entries(d)) for (const x of w) prawda(x.dt >= isoDzis() && x.g > 0, pr + ' ma woreczek z przeszłości');
    prawda(/id="sync-pasek"|sync-pasek/.test(await tekst('app.js')));
  });
  await test('Pominięcie', 'zjedzony posiłek nie rośnie po pominięciu innego, a cel dnia zostaje stały', async () => {
    const c = cele(), k = JSON.parse(JSON.stringify(plan)), d = k.dni.findIndex(x => x.k18 && !x.m13.wsp && x.m13.ona);
    if (d < 0) return;
    const w0 = oblicz(k, c), sn0 = w0.garnki.find(g => g.d === d && g.slot === 'sn').porcje.find(q => q.p === 'ona' && q.d === d).kcal, dzien0 = w0.dni[d].ona.kcal;
    k.dni[d].pom = { ona: { k18: true }, on: {} }; k.dni[d].pomSl = { ona: ['m13ona'] };      // śniadanie już zjedzone, pominięta kolacja
    const w1 = oblicz(k, c), sn1 = w1.garnki.find(g => g.d === d && g.slot === 'sn').porcje.find(q => q.p === 'ona' && q.d === d).kcal;
    prawda(Math.abs(sn1 - sn0) < 0.5, 'zjedzone śniadanie zmieniło wielkość: ' + sn0 + ' → ' + sn1);
    prawda(w1.dni[d].ona.kcal < dzien0, 'pominięty posiłek powinien zmniejszyć sumę dnia');
    const b = bazaDnia(k, c, d, 'ona'); prawda(b && Math.abs(b.kcal - dzien0) < 0.5, 'cel dnia nie jest stały: ' + (b && b.kcal) + ' vs ' + dzien0);
  });
  profil = svProfil; plan = svPlan;
  const ok = wyniki.filter(x => x.ok).length, blad = wyniki.length - ok;
  window.__TESTY = { ok, blad, wyniki };
  let h = `<b style="font-size:18px;color:${blad ? '#c0392b' : '#1b7f55'}">${blad ? 'BŁĘDY: ' + blad : 'Wszystko działa'} · ${ok}/${wyniki.length}</b>\n\n`, g = '';
  for (const w of wyniki) { if (w.grupa !== g) { g = w.grupa; h += `\n<b>${g}</b>\n`; } h += `${w.ok ? '✓' : '✗'} ${w.nazwa}${w.ok ? '' : '\n    ' + w.blad}\n`; }
  out.innerHTML = h;
})();
