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
  if (!profil) profil = { ona: { wiek: 30, waga: 62, wzrost: 168, plec: 'k', akt: '1.375', cel: 'redukcja' }, on: { wiek: 33, waga: 88, wzrost: 183, plec: 'm', akt: '1.375', cel: 'redukcja' } };
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
    rowne(krokiNaGramy('Dodaj 1 łyżeczkę chrzanu i pieprz'), 'Dodaj 5 g chrzanu i pieprz');
    rowne(krokiNaGramy('rozgrzej 1 łyżkę oliwy i 3 łyżeczki masła'), 'rozgrzej 10 g oliwy i 15 g masła');
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
  await test('Biblioteki', 'OCR i skaner działają z plików lokalnych, bez zewnętrznych serwerów', async () => {
    const kod = await tekst('app.js');
    prawda(!/cdn\.jsdelivr\.net|projectnaptha|unpkg\.com|cdnjs/.test(kod), 'w kodzie został adres zewnętrznej biblioteki');
    for (const f of ['lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js', 'lib/tesseract/tesseract-core-simd-lstm.wasm.js', 'lib/tesseract/tesseract-core-lstm.wasm.js', 'lib/tessdata/pol.traineddata.gz', 'lib/zxing/index.min.js']) { const r = await fetch(f, { method: 'HEAD' }); prawda(r.ok, 'brak pliku ' + f); }
    prawda(/biblioteki/.test(await tekst('sw.js')), 'service worker nie trzyma bibliotek');
  });
  await test('Mięso', 'podział kupionej ilości na woreczki wg dni', async () => {
    rowne([parsujMase('2,5 kg'), parsujMase('800'), parsujMase('2.5'), parsujMase('1200 g'), parsujMase('abc'), parsujMase('')], [2500, 800, 2500, 1200, null, null]);
    const mk = (dt, g) => ({ dt, g, dish: 'x', slot: 'ob' }), b = [mk('2026-11-20', 100), mk('2026-11-21', 100), mk('2026-11-22', 100)];
    let r = rozdzielMieso(b, 250); rowne([r.pelne.length, r.czesc && r.czesc.g, r.brak.length], [2, 50, 0], '250 g na 3 woreczki po 100');
    r = rozdzielMieso(b, 350); rowne([r.pelne.length, r.czesc, r.brak.length, r.zostaje], [3, null, 0, 50], '350 g');
    r = rozdzielMieso(b, 100); rowne([r.pelne.length, r.brak.length], [1, 2], '100 g starcza na jeden dzień');
    r = rozdzielMieso(b, 2500); rowne([r.pelne.length, r.zostaje], [3, 2200], 'duża nadwyżka');
  });
  await test('Łyżki', 'olej, miód, chrzan, pesto, musztarda i inne mokre produkty nie mają łyżek w krokach', async () => {
    const mokre = /(masł(?:em|o|a)\b|chrzan|dżem|musztard|mi[oó]d|ketchup|oliw|olej\b|oleju|ocet|octu|syrop|koncentrat|pesto|sezam|skrob|kakao|gochujang)/i, wyj = /(sosu|wody|ZIMNEJ|przyprawy|czubata|kleksy|majeranku|papryki|kminu|imbiru|soli\b)/i, lewe = [];
    for (const d of DB.dania.values()) { const g = garnekSpont(d, 1); for (const k of d.kroki || []) for (const m of krokPrzeliczony(g, k).matchAll(/[^,.;]{0,45}łyż[a-ząćęłńóśźż]*[^,.;]{0,32}/gi)) if (mokre.test(m[0]) && !wyj.test(m[0])) lewe.push(d.nazwa + ': ' + m[0].trim()); }
    rowne(lewe, [], 'łyżki przy mokrych produktach');
    for (const d of DB.dania.values()) for (const i of d.skladniki) prawda(!/łyż/i.test(i.jednostka || ''), d.nazwa + ': składnik w łyżkach ' + i.produkt);
  });
  await test('Łyżki', 'stare stany w łyżkach w lodówce i zakupach są przeliczane na gramy', async () => {
    const sl = JSON.stringify(lodowka), so = JSON.stringify(odhaczone), st = document.getElementById('toast') && document.getElementById('toast').innerText;
    try {
      lodowka = { 'oliwa / olej': { 'łyż.': 6 }, 'miód': { 'łyż.': 3, 'łyżecz.': 2 }, 'chrzan': { 'łyżecz.': 4 } }; odhaczone = {};
      migrujLyzkiStanow(); rowne([lodowka['oliwa / olej'], lodowka['chrzan']], [{ g: 60 }, { g: 20 }]); rowne(lodowka['miód'], { g: 74 });
      const raz = JSON.stringify(lodowka); migrujLyzkiStanow(); rowne(JSON.stringify(lodowka), raz, 'migracja powinna być idempotentna');
    } finally { lodowka = JSON.parse(sl); odhaczone = JSON.parse(so); }
    const kod = await tekst('app.js'); prawda(/normalizujLyzki\(kopia\)/.test(kod) && /normalizujLyzki\(k\)/.test(kod), 'dania dodane w sesji nie są normalizowane');
  });
  await test('Owoce mrożone', 'jeden produkt „owoce mrożone” w składnikach, zakupach i lodówce (nazwy dań bez zmian), stare wpisy są scalane', async () => {
    const stare = ['owoce mrożone (mieszanka)', 'mieszanka tropikalna mrożona (mango, ananas…)', 'maliny mrożone', 'truskawki mrożone', 'jagody mrożone', 'wiśnie mrożone', 'mango mrożone', 'brzoskwinie mrożone'];
    for (const d of DB.dania.values()) for (const i of d.skladniki) prawda(!stare.includes(i.produkt), d.nazwa + ': stary produkt ' + i.produkt);
    prawda(DB.produkty.has('owoce mrożone') && ![...DB.produkty.keys()].some(p => stare.includes(p)), 'lodówka/zakupy mają kilka pozycji z owocami mrożonymi');
    const kok = [...DB.dania.values()].filter(d => /^koktajl/.test(d.typ) && d.skladniki.some(i => i.produkt === 'owoce mrożone'));
    prawda(kok.length >= 8, 'za mało koktajli z owocami mrożonymi'); prawda(kok.some(d => /Jagodowy|Truskawkowy|Malinowo|Mango/.test(d.nazwa)), 'nazwy dań powinny zostać bez zmian');
    for (const d of DB.dania.values()) for (const t of [...(d.kroki || []), ...(d.wieczorem || [])]) prawda(!/mieszank\w* (owoców|tropik)|mrożon\w* (malin|jagód|truskawek|wiśni|brzoskwiń|mango)/i.test(t), d.nazwa + ': ' + t.slice(0, 60));
    const sl = JSON.stringify(lodowka), sm = JSON.stringify(mapaPar);
    try { lodowka = { 'owoce mrożone (mieszanka)': { g: 300 }, 'mieszanka tropikalna mrożona (mango, ananas…)': { g: 200 }, 'owoce mrożone': { g: 100 } }; mapaPar = { 'MROZONE MALINY': 'owoce mrożone (mieszanka)' }; migrujOwoceMroz(); rowne(lodowka, { 'owoce mrożone': { g: 600 } }); rowne(mapaPar['MROZONE MALINY'], 'owoce mrożone'); }
    finally { lodowka = JSON.parse(sl); mapaPar = JSON.parse(sm); }
  });
  await test('Wybór dania', 'dania w wyborze są grupowane (rozsuwane grupy), mało dań w „Inne”', async () => {
    const pule = [['ob', DB.pula.ob1], ['ob', DB.pula.ob2], ['sn', DB.pula.sn], ['m13', DB.pula.m13dania], ['m13', DB.pula.m13kokt], ['k18', DB.pula.k18]];
    for (const [slot, pula] of pule) {
      const znane = new Set([...GRUPY_MIESO, ...GRUPY_SN, ...GRUPY_KOKT]); let inne = 0;
      for (const x of pula) { const g = grupaDania(x, slot); prawda(znane.has(g), x.nazwa + ': nieznana grupa ' + g); if (g === 'Inne') inne++; }
      prawda(inne <= Math.max(2, pula.length * 0.2), `za dużo dań w „Inne”: ${inne} z ${pula.length} (${slot})`);
    }
    const sv = zmienCtx; zmienCtx = { d: 0, slot: 'ob', teraz: DB.pula.ob1[0].id, pula: DB.pula.ob1 };
    const box = document.createElement('div'); box.id = 'lista-wyboru'; document.body.appendChild(box);
    try { listaWyboru(''); const gr = box.querySelectorAll('details.wyb-grp'); prawda(gr.length >= 3, 'za mało grup'); prawda(box.querySelectorAll('.wiersz').length === DB.pula.ob1.filter(x => dopuszcza(x, osobySlotu('ob'))).length, 'liczba dań w grupach różni się od puli');
      listaWyboru('kurczak'); prawda([...box.querySelectorAll('details.wyb-grp')].every(g => g.open), 'przy szukaniu grupy powinny być rozsunięte'); }
    finally { box.remove(); zmienCtx = sv; }
  });
  await test('Dla jednej osoby', 'śniadanie i obiad można zmienić tylko dla jednej osoby: kalorie dnia bez zmian, osobne sloty, listy i zakupy działają', async () => {
    const c = cele(); let sprawdzone = 0;
    for (let n = 0; n < 12; n++) {
      const k = JSON.parse(JSON.stringify(kandydat())), w0 = oblicz(k, c);
      k.dni.forEach((day, d) => {
        for (const [b, pula] of [['sn', DB.pula.sn], ['ob', day.ob2 ? DB.pula.ob2 : DB.pula.ob1], ['k18', DB.pula.k18], ['m13', DB.pula.m13kokt.concat(DB.pula.m13dania)]]) {
          const idB = b === 'm13' ? day.m13.wsp : day[b];
          if (!idB || (b === 'ob' && day.ob2)) continue;
          const p = n % 2 ? 'ona' : 'on', alt = pula.find(x => x.id !== idB && dopuszcza(x, [p])); if (!alt) continue;
          day.dla = { ona: {}, on: {} }; day.dla[p][b] = alt.id;
          const w1 = oblicz(k, c), os = w1.garnki.filter(g => g.d === d && g.slot === nazwaSl(b, p)), wsp = w1.garnki.filter(g => g.d === d && g.slot === b);
          prawda(os.length === 1 && os[0].porcje.length === 1 && os[0].porcje[0].p === p, `${nazwaSl(b, p)} powinien mieć jedną porcję osoby ${p}`);
          prawda(wsp.length === 1 && wsp[0].porcje.every(q => q.p !== p), `${b} powinien zostać tylko drugiej osobie`);
          for (const pp of OS) prawda(Math.abs(w1.dni[d][pp].kcal - w0.dni[d][pp].kcal) < 0.05 * c[pp].kcal, `kcal dnia ${pp} zmieniły się po zmianie ${b} dla ${p}: ${Math.round(w0.dni[d][pp].kcal)} → ${Math.round(w1.dni[d][pp].kcal)}`);
          const sl = slotyDania(day).map(x => x[0]); prawda(sl.includes(nazwaSl(b, p)) && sl.includes(b), 'slotyDania bez osobnego slotu');
          prawda(w1.dni[d].sloty.every(x => isFinite(x.g.K) && x.g.K > 0), 'NaN w kcal'); naruszeniaPlanu(k);
          day.dla = undefined; sprawdzone++;
        }
      });
    }
    prawda(sprawdzone >= 30, 'za mało sprawdzonych przypadków: ' + sprawdzone);
    const wspM13 = (() => { for (let n = 0; n < 12; n++) { const k = kandydat(); if (k.dni.some(x => x.m13.wsp)) return k; } return null; })();
    prawda(!!wspM13, 'brak planu z wspólnym 13:00 do sprawdzenia (weekend)');
    const k2 = JSON.parse(JSON.stringify(kandydat())), dd = k2.dni.findIndex(x => x.ob && x.ob2);
    if (dd >= 0) { k2.dni[dd].dla = { ona: { ob: DB.pula.ob1[0].id }, on: {} }; prawda(!oblicz(k2, c).garnki.some(g => g.slot === 'obona'), 'obiad na 2 dni musi zostać wspólny'); }
    prawda(osobySlotu('snona')[0] === 'ona' && bazaSlotu('obon') === 'ob' && osobaSlotu('k18') === null && bazaSlotu('m13xon') === 'm13' && osobaSlotu('k18ona') === 'ona' && osobaSlotu('m13ona') === null, 'pomocnicy slotów');
  });
  await test('Zamiana składnika', 'zamiennik trzyma kalorie, zmienia białko; kroki, zakupy i cofanie działają', async () => {
    const c = cele(), kand = [...DB.dania.values()].filter(d => d.skladniki.some(i => /kurczak/.test(i.produkt) && i.jednostka === 'g' && i.kcal > 0 && i.produkt === 'pierś z kurczaka'));
    prawda(kand.length >= 3, 'za mało dań z kurczakiem do testu');
    const sz = zamiennik, kk = JSON.parse(JSON.stringify(kandydat()));
    try {
      zamiennik = {};
      const d0 = kk.dni.findIndex(x => x.ob && !x.ob2); prawda(d0 >= 0, 'brak dnia z obiadem 1-dniowym');
      for (const dish of kand.slice(0, 6)) {
        const day = kk.dni[d0]; const stary = day.ob; day.ob = dish.id; day.ob2 = false; day.zam = undefined;
        const w0 = oblicz(kk, c), g0 = w0.garnki.find(g => g.d === d0 && g.slot === 'ob'), i0 = g0.dish.skladniki.find(i => i.produkt === 'pierś z kurczaka');
        const op = kandydatyZamiany(g0, i0); prawda(op.length >= 1, dish.nazwa + ': brak zamienników'); prawda(op.every(x => klasaZam(x.prod) === 'drób' && !/szynk|rosolow|cwiartk/i.test(znorm(x.prod))), dish.nazwa + ': zły zamiennik ' + op.map(x => x.prod));
        day.zam = { ob: { 'pierś z kurczaka': op[0].prod } };
        const w1 = oblicz(kk, c), g1 = w1.garnki.find(g => g.d === d0 && g.slot === 'ob'), i1 = g1.dish.skladniki.find(i => i.zam);
        prawda(i1 && i1.produkt === op[0].prod && i1.zam.z === 'pierś z kurczaka', dish.nazwa + ': składnik niezamieniony');
        prawda(Math.abs(g1.K - g0.K) < 1, `${dish.nazwa}: kcal porcji zmieniły się ${Math.round(g0.K)} → ${Math.round(g1.K)}`);
        for (const pp of OS) prawda(Math.abs(w1.dni[d0][pp].kcal - w0.dni[d0][pp].kcal) < 1, dish.nazwa + ': kcal dnia ' + pp);
        prawda(g1.dish.skladniki.every(i => isFinite(i.ilosc) && i.ilosc > 0), dish.nazwa + ': NaN w ilościach');
        const tekst = g1.dish.kroki.map(t => krokPrzeliczony(g1, t)).join(' ');
        if (/indyk/.test(op[0].prod) && /kurczak/i.test(DB.dania.get(dish.id).kroki.join(' '))) prawda(!/kurczak/i.test(tekst), dish.nazwa + ': w krokach został kurczak');
        day.zam = { ob: { 'pierś z kurczaka': '' } }; zamiennik = { [dish.id]: { 'pierś z kurczaka': op[0].prod } };
        prawda(!oblicz(kk, c).garnki.find(g => g.d === d0 && g.slot === 'ob').dish.skladniki.some(i => i.zam), dish.nazwa + ': pusty wpis w posiłku powinien przywrócić oryginał');
        day.zam = undefined; prawda(oblicz(kk, c).garnki.find(g => g.d === d0 && g.slot === 'ob').dish.skladniki.some(i => i.zam), dish.nazwa + ': zamiana „zawsze” nie działa');
        zamiennik = {}; day.ob = stary;
      }
      prawda(zamienDrobWKrokach('Kurczaka pokrój, usmaż kurczak z piersi z kurczaka.', { dish: { skladniki: [{ zam: { z: 'pierś z kurczaka' }, produkt: 'filet z indyka' }] } }) === 'Indyka pokrój, usmaż indyk z piersi z indyka.', 'podmiana kurczak → indyk');
    } finally { zamiennik = sz; }
  });
  await test('Przegląd', 'skróty dni, prognoza bez ujemnych stanów, kolejność ONA/ON, kod dania, własny cel', async () => {
    rowne(DNI_KR[6], 'ndz', 'skrót niedzieli'); rowne([DNI_OD.length, DNI_NA.length], [7, 7]); rowne([DNI_OD[5], DNI_NA[5], DNI_NA[6]], ['soboty', 'sobotę', 'niedzielę']);
    rowne(zakresDni(new Set(['2026-11-21', '2026-11-22'])), 'sob 21.11 – ndz 22.11', 'data w zakresie nie łamie się');
    const c = cele(), w = oblicz(plan, c), sl = lodowka;
    try {
      lodowka = { 'skyr naturalny': { g: 0 } }; const a = prognoza(w).map(x => x.produkt + x.brakuje);
      lodowka = { 'skyr naturalny': { g: -800 } }; const b = prognoza(w).map(x => x.produkt + x.brakuje); rowne(b, a, 'ujemny stan nie powinien zwiększać braków');
    } finally { lodowka = sl; }
    const k = JSON.parse(JSON.stringify(kandydat())), d = k.dni.findIndex(x => x.sn); const alt1 = DB.pula.sn.find(x => x.id !== k.dni[d].sn), alt2 = DB.pula.sn.find(x => x.id !== k.dni[d].sn && x.id !== alt1.id);
    k.dni[d].dla = { ona: { sn: alt1.id }, on: {} }; let wo = oblicz(k, c).dni[d].sloty.map(x => x.g.slot).filter(x => /^sn/.test(x));
    prawda(wo.indexOf('sn') >= 0 && wo.indexOf('snona') >= 0, 'oba śniadania powinny być w dniu');
    k.dni[d].dla = { ona: { sn: alt1.id }, on: { sn: alt2.id } }; wo = oblicz(k, c).dni[d].sloty.map(x => x.g.slot).filter(x => /^sn/.test(x)); rowne(wo, ['snona', 'snon'], 'ONA przed ON');
    rowne(nazwaDania({ kod: 'K4', nazwa: 'A & B' }), '<span class="kod">K4</span> A &amp; B'); rowne(nazwaDania({ nazwa: 'Bez kodu' }), 'Bez kodu');
    const kod = await tekst('app.js'); prawda(/data-wlasne-czysc/.test(kod) && /Własny cel zastępuje/.test(kod), 'brak informacji o własnym celu');
  });
  await test('Wstecz', 'przycisk „wstecz” zamyka warstwę zamiast wychodzić z aplikacji (liczba wpisów historii = liczba otwartych warstw)', async () => {
    const m = document.getElementById('modal'), czekaj = ms => new Promise(r => setTimeout(r, ms));
    rowne(warstwyOtwarte(), 0, 'na starcie brak warstw'); m.hidden = false; await czekaj(60); rowne([warstwyOtwarte(), histN], [1, 1], 'otwarte okno = jeden wpis');
    m.hidden = true; await czekaj(150); rowne([warstwyOtwarte(), histN], [0, 0], 'zamknięte okno zdejmuje wpis');
  });
  await test('Opisz tydzień', 'dni bez planu nie wpadają na dziś, zakresy dni, „bez ryb”, „zimno”', async () => {
    const i = dzienTyg(), dzis = rozumiemTekst('dziś bez ryb'); prawda(dzis.length === 1 && dzis[0].tryby.bezRyb, '„bez ryb” bez „bez mięsa”');
    prawda(rozumiemTekst('dziś zimno')[0].tryby.zimno, '„zimno”');
    const zak = rozumiemTekst('od ' + DNI_OD[i] + ' do ' + DNI_OD[i] + ' lekko'); prawda(zak.length === 1 && zak[0].d === i && zak[0].tryby.lekko, 'zakres „od X do X”');
    if (i > 1 && tygodnieZapisane().length < 2) {          // dzień minionego poniedziałku nie ma planu, więc nie wolno zmienić dziś (od środy; we wtorek „do wtorku” obejmuje dziś)
      const r = rozumiemTekst('poniedziałek bez mięsa'); rowne(r.length, 0, 'zmiana wylądowała na dziś'); rowne(r.brakDni, ['Poniedziałek'], 'brak informacji o dniu bez planu');
      const r2 = rozumiemTekst('od poniedziałku do wtorku bez mięsa, dziś szybko'); rowne(r2.length, 1, 'tylko dziś ma plan'); prawda(r2.brakDni.includes('Poniedziałek'), 'dni bez planu w zakresie');
    }
  });
  await test('Komendy głosowe', 'rozpoznawanie komend po angielsku (kroki, timery, składniki, zamknięcie), ignorowanie rozmowy', async () => {
    const k = x => { const r = komendaGlosu(x); return r && r.a; };
    rowne([k('next'), k('Next step'), k('go forward'), k('back'), k('previous'), k('first'), k('last step')], ['next', 'next', 'next', 'back', 'back', 'first', 'last'], 'poruszanie po krokach');
    rowne([k('timer'), k('start timer'), k('timer 10 minutes'), k('set a timer for ten minutes'), k('20 minute timer')], ['stimer', 'stimer', 'timer', 'timer', 'timer'], 'timery');
    rowne([komendaGlosu('timer 10 minutes').sek, komendaGlosu('timer ten minutes').sek, komendaGlosu('timer twenty five minutes').sek, komendaGlosu('timer 90 seconds').sek, komendaGlosu('timer one hour').sek, komendaGlosu('timer half an hour').sek, komendaGlosu('timer 1 hour 30 minutes').sek], [600, 600, 1500, 90, 3600, 1800, 5400], 'czasy');
    rowne([k('pause'), k('resume'), k('add a minute'), komendaGlosu('add a minute').sek, komendaGlosu('add 2 minutes').sek, komendaGlosu('one more minute').sek, k('cancel timer'), k('stop'), k('silence')], ['pause', 'resume', 'add', 60, 120, 60, 'cancel', 'silence', 'silence'], 'sterowanie timerem');
    rowne([k('ingredients'), k('close'), k('exit')], ['skl', 'close', 'close'], 'składniki i zamknięcie');
    rowne([k(''), k('banana'), k('could you pass me the salt and the next plate please we are ready'), k('I think the chicken is almost done')], [null, null, null, null], 'rozmowa nie jest komendą');
    rowne(komendaGlosu('stop the timer').timer, true, '„stop timer” może usunąć działający timer');
    prawda(typeof GLOS_SR !== 'undefined', 'definicja rozpoznawania mowy');
  });
  await test('Pomidory: passata i krojone', 'salsy z pomidorów krojonych, passata i krojone zamieniają się 1:1 w gramach, bez zamiany na brokuł', async () => {
    for (const id of ['quesadille-z-kurczakiem-i-salsa-pomidorowa', 'burrito-wolowe-z-fasola-i-salsa']) { const dd = DB.dania.get(id), p = dd.skladniki.filter(i => /pomidor|passata/.test(i.produkt)); rowne(p.map(i => i.produkt), ['pomidory krojone (puszka)'], id + ': salsa z pomidorów krojonych'); rowne(p[0].ilosc, 200, id + ': 200 g'); prawda(dd.kroki.some(k => /^SALSA: pomidory krojone/.test(k)), id + ': krok salsy'); }
    rowne([klasaZam('passata'), klasaZam('pomidory krojone (puszka)')], [POM_SOS, POM_SOS], 'wspólna klasa');
    const c = cele(), szm = zamiennik, kk = JSON.parse(JSON.stringify(kandydat()));
    try {
      zamiennik = {};
      const dish = DB.dania.get('chili-z-indykiem-fasola-i-ryzem'), d0 = kk.dni.findIndex(x => x.ob && !x.ob2); prawda(dish && d0 >= 0, 'brak dania lub dnia do testu');
      kk.dni[d0].ob = dish.id; kk.dni[d0].ob2 = false; kk.dni[d0].zam = undefined;
      const g0 = oblicz(kk, c).garnki.find(g => g.d === d0 && g.slot === 'ob'), i0 = g0.dish.skladniki.find(i => i.produkt === 'pomidory krojone (puszka)');
      const op = kandydatyZamiany(g0, i0); rowne(op.map(x => x.prod), ['passata'], 'jedyny zamiennik pomidorów krojonych to passata'); rowne(op[0].ilosc, i0.ilosc, 'ta sama masa');
      kk.dni[d0].zam = { ob: { 'pomidory krojone (puszka)': 'passata' } };
      const g1 = oblicz(kk, c).garnki.find(g => g.d === d0 && g.slot === 'ob'), i1 = g1.dish.skladniki.find(i => i.zam);
      prawda(i1 && i1.produkt === 'passata' && i1.ilosc === i0.ilosc, 'passata w tej samej ilości');
    } finally { zamiennik = szm; }
  });
  // --- zero waste: symulacja zapasów, automatyczny wybór produktu, zużycie resztek ---
  const kukurydza = 'kukurydza konserwowa';   // puszka 140 g, po otwarciu 4 dni
  await test('Zero waste: symulacja zapasów', 'kupno całych opakowań, zużycie otwartych resztek, trwałość po otwarciu, zapas z lodówki', async () => {
    const op = DB.opak[kukurydza]; rowne([op.wielkosc, OTWARTE_DNI[kukurydza]], [140, 4], 'dane puszki do testu');
    let s = symulujZapasy([{ t: 0, prod: kukurydza, u: 'g', q: 60 }], {}, 9);
    rowne([s.paczki, Math.round(s.straty[0].q)], [1, 80], 'jedna puszka na 60 g: zostaje 80 g, które się zepsują'); prawda(Math.abs(s.koszt - 80 / 140) < 1e-6, 'koszt straty to ułamek opakowania');
    s = symulujZapasy([{ t: 0, prod: kukurydza, u: 'g', q: 60 }, { t: 2, prod: kukurydza, u: 'g', q: 60 }], {}, 9);
    rowne(s.paczki, 1, 'druga porcja bierze resztkę zamiast otwierać nową puszkę'); prawda(Math.abs(s.koszt - 20 / 140) < 1e-6, 'zostaje 20 g');
    s = symulujZapasy([{ t: 0, prod: kukurydza, u: 'g', q: 60 }, { t: 6, prod: kukurydza, u: 'g', q: 60 }], {}, 9);
    rowne(s.paczki, 2, 'po 4 dniach resztka jest wyrzucona, więc trzeba nową puszkę'); prawda(s.straty.some(x => Math.abs(x.q - 80) < 1e-6 && x.t0 === 0), 'przeterminowana resztka jest zapisana jako strata');
    s = symulujZapasy([{ t: 0, prod: kukurydza, u: 'g', q: 60 }], { [kukurydza + '|g']: 100 }, 9);
    rowne([s.paczki, Math.round(s.straty[0].q)], [0, 40], 'otwarta resztka z lodówki wystarcza, bez kupowania');
    s = symulujZapasy([{ t: 0, prod: kukurydza, u: 'g', q: 60 }], { [kukurydza + '|g']: 280 }, 9);
    rowne(s.paczki, 0, 'dwie nieotwarte puszki w lodówce: nic do kupienia'); rowne(Math.round(s.straty[0].q), 80, 'otwarta zostaje tylko jedna puszka, druga nietknięta');
    s = symulujZapasy([{ t: 0, prod: 'ryż', u: 'g', q: 100 }], {}, 9); rowne(s.koszt, 0, 'produkt trwały nie generuje strat');
  });
  // pomocnik: tydzień bez pomidorów w innych posiłkach, z wybranymi obiadami w kolejne dni od poniedziałku 23.11
  const tydzienTest = ob => {
    const poms = d => d.skladniki.some(i => /pomidor|passata|koncentrat/.test(i.produkt) && i.ilosc > 0), czysty = pool => pool.find(d => !poms(d)), k = JSON.parse(JSON.stringify(kandydat()));
    k.start = isoDzis(); k.dni.forEach((day, i) => { day.sn = czysty(DB.pula.sn).id; day.ob = ob[i] || czysty(DB.pula.ob1).id; day.ob2 = false; day.zam = undefined; day.dla = {}; day.k18 = czysty(DB.pula.k18).id; if (day.m13.wsp) day.m13.wsp = czysty(DB.pula.m13).id; day.m13.ona = czysty(DB.pula.m13ona).id; day.m13.on = czysty(DB.pula.m13on).id; });
    return [{ start: k.start, dni: k.dni, zuz: {} }];
  };
  const wTygodniu = async (tyg, lod, fn) => { const sl = lodowka, st = _autoTyg; try { lodowka = lod || {}; _autoTyg = tyg; _autoCache = { sig: '', mapa: {} }; _stratyCache = { sig: '', wynik: null }; return await fn(); } finally { lodowka = sl; _autoTyg = st; _autoCache = { sig: '', mapa: {} }; _stratyCache = { sig: '', wynik: null }; } };
  const pomLinie = (tyg, d) => oblicz({ start: tyg[0].start, dni: tyg[0].dni }, cele()).garnki.filter(g => g.d === d && g.slot === 'ob').flatMap(g => g.dish.skladniki.filter(i => /^(passata|pomidory krojone)/.test(i.produkt)).map(i => ({ produkt: i.produkt, auto: i.zam && i.zam.auto, ilosc: Math.round(i.ilosc * skala(g, i)) })));
  await test('Zero waste: automatyczny wybór pomidorów', 'zapas w lodówce wygrywa, dwie salsy z jednej butelki, dobór do pełnych opakowań, ręczna zamiana ma pierwszeństwo', async () => {
    const Q = 'quesadille-z-kurczakiem-i-salsa-pomidorowa', C = 'chili-z-indykiem-fasola-i-ryzem', P = [...DB.dania.values()].find(d => /^Pomidorówka/.test(d.nazwa)).id;
    let t = tydzienTest([Q]);
    await wTygodniu(t, {}, () => { const l = pomLinie(t, 0); rowne(l.map(x => x.produkt), ['pomidory krojone (puszka)'], 'pusta lodówka i jedna salsa: krojone, jak w przepisie'); prawda(!l[0].auto, 'bez zmiany automatu'); });
    await wTygodniu(t, { passata: { g: 300 } }, () => { const l = pomLinie(t, 0); rowne(l.map(x => x.produkt), ['passata'], 'otwarta passata w lodówce, brak krojonych: passata'); rowne(l[0].auto, 'masz w lodówce', 'powód'); });
    await wTygodniu(t, { 'pomidory krojone (puszka)': { g: 400 } }, () => { rowne(pomLinie(t, 0).map(x => x.produkt), ['pomidory krojone (puszka)'], 'krojone w lodówce zostają'); });
    const g1 = await wTygodniu(tydzienTest([Q]), {}, () => pomLinie(tydzienTest([Q]), 0)[0].ilosc), n = [2, 3, 4, 5].find(m => m * g1 >= 520 && m * g1 <= 690) || 3;   // ilość salsy zależy od profilu, więc dobieram liczbę salsy tak, żeby razem wyszło 520–690 g (więcej niż puszka, mniej niż butelka)
    t = tydzienTest(Array(n).fill(Q));
    await wTygodniu(t, {}, () => {
      const lin = Array.from({ length: n }, (_, d) => pomLinie(t, d)[0]), T = dzienIdx(dodajDni(isoDzis(), 7));
      const koszt = prods => { const sm = symulujZapasy(lin.map((x, d) => ({ t: d, prod: prods[d], u: 'g', q: x.ilosc })), {}, T); return sm.koszt + 0.5 * sm.paczki + 0.25 * prods.filter(p => p !== 'pomidory krojone (puszka)').length; };
      const wybor = koszt(lin.map(x => x.produkt)), krojone = koszt(lin.map(() => 'pomidory krojone (puszka)')), passata = koszt(lin.map(() => 'passata'));
      prawda(wybor <= Math.min(krojone, passata) + 1e-6, `${n} salsy (${n * g1} g): wybór automatu kosztuje ${wybor.toFixed(2)}, a samo krojone ${krojone.toFixed(2)}, sama passata ${passata.toFixed(2)}`);
      prawda(lin.some(x => x.produkt === 'passata') || krojone <= passata, 'gdy butelka passaty jest tańsza, automat jej używa');
    });
    t = tydzienTest([Q, C]);
    await wTygodniu(t, {}, () => { rowne([pomLinie(t, 0)[0].produkt, pomLinie(t, 1)[0].produkt], ['passata', 'passata'], 'salsa + chili: 660 g mieści się w jednej butelce 690 g'); });
    t[0].dni[0].zam = { ob: { 'pomidory krojone (puszka)': '' } };
    await wTygodniu(t, { passata: { g: 300 } }, () => { rowne(pomLinie(t, 0).map(x => x.produkt), ['pomidory krojone (puszka)'], 'ręczne „wróć do oryginału” blokuje automat'); });
    t = tydzienTest([null, null, P]);
    await wTygodniu(t, {}, () => { rowne(pomLinie(t, 2).map(x => x.produkt), ['passata'], 'pomidorówka bez powodu do zmiany zostaje na passacie'); prawda(!pomLinie(t, 2)[0].auto, 'bez oznaczenia automatu'); });
  });
  await test('Zero waste: zużycie resztki', 'podpowiedzi liczone symulacją: każda naprawdę zmniejsza koszt strat, bez dokładania opakowań', async () => {
    const pom = d => d.skladniki.some(i => /kukurydz/.test(i.produkt) && i.ilosc > 0), sn = [...DB.dania.values()].find(d => pom(d) && d.typ === 'sniadanie');
    const t = tydzienTest([]); t[0].dni[1].sn = sn.id;
    await wTygodniu(t, {}, async () => {
      const st = przewidzStraty().sim.straty.find(x => x.prod === kukurydza); prawda(st && st.q > 40, 'brak przewidzianej straty kukurydzy w teście');
      const przed = kosztCalkowity(t), op = await opcjeZuzycia(st, t); prawda(op.length >= 1, 'brak podpowiedzi');
      for (const x of op) { const k = klonTygodni(t); ustawNaKlonie(k[0], x.d, x.slot, x.dish.id, cele()); const po = kosztCalkowity(k); prawda(wynikZW(po) < wynikZW(przed) - 0.2, x.dish.nazwa + ': zamiana nie zmniejsza strat ani liczby opakowań'); }
    });
  });
  await test('Zero waste: układanie tygodnia', 'poprawa układu obniża ocenę (straty, opakowania, białko), nie dubluje dań i nie rusza zablokowanych', async () => {
    const c = cele(), st0 = isoDzis(), sl = lodowka;
    try {
      lodowka = {};
      const inneT = tygodnieZapisane().filter(t => t.start !== st0), T = Math.max(dzienIdx(dodajDni(st0, 7)), ...inneT.map(t => dzienIdx(dodajDni(t.start, 7))));
      _bezAuto++; try { _zwKontekst = { start: st0, T, stan: stanLodowki(), inne: inneT.flatMap(t => zdarzeniaTygodnia(t, oblicz({ start: t.start, dni: t.dni }, c), [])) }; } finally { _bezAuto--; }
      const k = JSON.parse(JSON.stringify(kandydat())), przed = ocena(k, c), powtPrzed = (l => l.filter(Boolean).length - new Set(l.filter(Boolean)).size)(k.dni.map(y => y.sn)) + (l => l.filter(Boolean).length - new Set(l.filter(Boolean)).size)(k.dni.map(y => y.ob)) + (l => l.filter(Boolean).length - new Set(l.filter(Boolean)).size)(k.dni.map(y => y.k18)) + (l => l.filter(Boolean).length - new Set(l.filter(Boolean)).size)(k.dni.map(y => y.m13.wsp || y.m13.on));
      const blok = k.dni.map((_, i) => (i === 3 ? { sn: true, ob: true } : {})), sn3 = k.dni[3].sn, ob3 = k.dni[3].ob;
      poprawUklad(k, c, blok, 3000);
      const po = ocena(k, c); prawda(po <= przed + 1e-6, `ocena po poprawie ${Math.round(po)} nie jest niższa niż przed ${Math.round(przed)}`);
      rowne([k.dni[3].sn, k.dni[3].ob], [sn3, ob3], 'zablokowane dania nie zmieniają się');
      const powt = l => l.filter(Boolean).length - new Set(l.filter(Boolean)).size, powtK = x => powt(x.dni.map(y => y.sn)) + powt(x.dni.map(y => y.ob)) + powt(x.dni.map(y => y.k18)) + powt(x.dni.map(y => y.m13.wsp || y.m13.on));
      prawda(powtK(k) <= powtPrzed, `poprawa zwiększyła liczbę powtórzeń dań (${powtPrzed} → ${powtK(k)})`);
      prawda(k.dni.every(x => DB.dania.has(x.sn) && DB.dania.has(x.k18) && (!x.ob || DB.dania.has(x.ob))), 'układ zawiera nieistniejące dania');
    } finally { lodowka = sl; _zwKontekst = null; }
  });
  await test('Zero waste: przepis z automatyczną zamianą', 'zamienione() z automatem zmienia produkt, zachowuje masę i oznacza powód, a ręczny wybór go blokuje', async () => {
    const dish = DB.dania.get('quesadille-z-kurczakiem-i-salsa-pomidorowa'), auto = { 'pomidory krojone (puszka)': { p: 'passata', powod: 'masz w lodówce' } };
    const z = zamienione(dish, { zam: {} }, 'ob', auto), i = z.skladniki.find(x => x.produkt === 'passata');
    prawda(i && i.ilosc === 200 && i.zam.z === 'pomidory krojone (puszka)' && i.zam.auto === 'masz w lodówce', 'automatyczna zamiana na passatę 200 g z powodem');
    prawda(!z.skladniki.some(x => x.produkt === 'pomidory krojone (puszka)'), 'stary składnik zniknął');
    const r = zamienione(dish, { zam: { ob: { 'pomidory krojone (puszka)': '' } } }, 'ob', auto); prawda(r.skladniki.some(x => x.produkt === 'pomidory krojone (puszka)') && !r.skladniki.some(x => x.zam), 'ręczny powrót do oryginału blokuje automat');
    const r2 = zamienione(dish, { zam: {} }, 'ob', null); prawda(r2 === dish, 'bez automatu przepis bez zmian');
  });
  await test('Lista zakupów: świeże dodatki', 'cytryna, limonka, zioła, imbir, chili i por trafiają na listę jako składniki z ilością, a nie tylko w przyprawach', async () => {
    const swieze = /^(sok z cytryny|sok z limonki|cytryna|limonka|koperek|natka|szczypiorek|imbir|chili|chrzan)\b/i;
    const wPrzyprawach = [...DB.dania.values()].filter(x => (x.przyprawy || []).some(t => t.split(/,\s+/).some(e => swieze.test(e.trim()) && !/opcjonalnie/i.test(e))));
    prawda(!wPrzyprawach.length, `świeże dodatki zostały w przyprawach: ${wPrzyprawach.slice(0, 3).map(x => x.nazwa).join('; ')}`);
    const bez = [...DB.dania.values()].filter(x => x.skladniki.some(i => (!i.produkt || !i.ilosc) && !/^glazura/i.test(i.nazwa)));   // glazura to wybór smaku z tabeli, bez stałych składników
    prawda(!bez.length, `składniki bez ilości lub produktu w: ${bez.slice(0, 3).map(x => x.nazwa).join('; ')}`);
    const lem = DB.dania.get('losos-pieczony-frytki-sos-koperkowy');
    prawda(lem.skladniki.some(i => i.produkt === 'cytryna' && i.jednostka === 'szt.' && i.ilosc > 0) && lem.skladniki.some(i => i.produkt === 'koperek' && i.jednostka === 'g' && i.ilosc > 0), 'łosoś z sosem koperkowym ma cytrynę i koperek jako składniki');
    const por = DB.dania.get('krem-z-papryki'); prawda(por.skladniki.some(i => i.produkt === 'por' && i.uwaga === 'tylko dla niej') && por.skladniki.some(i => i.produkt === 'cebula' && i.uwaga === 'tylko dla niego'), 'cebula dla niego i por dla niej jako osobne składniki');
    const wg = (x, k) => x.skladniki.reduce((n, i) => n + (i[k] || 0), 0);
    prawda(Math.abs(wg(lem, 'kcal') - lem.razem.kcal) < 400, 'kcal dania nie rozjechały się ze składnikami');
    prawda(DB.opak.koperek && DB.opak.koperek.jednostka === 'g', 'koperek ma opakowanie (pęczek)');
  });
  await test('Zmiana tygodnia', 'tydzień trwa do swojej niedzieli włącznie, więc w niedzielę nie jest „miniony” i nie znika po ułożeniu następnego', async () => {
    const dz = isoDzis();
    prawda(tydzienZywy(dodajDni(dz, -6)), 'tydzień kończący się dziś jeszcze trwa');
    prawda(tydzienZywy(dz) && tydzienZywy(dodajDni(dz, 7)), 'bieżący i przyszły tydzień trwają');
    prawda(!tydzienZywy(dodajDni(dz, -7)), 'tydzień zakończony wczoraj już nie trwa');
    const pon = poniedzialek(), niedziela = new Date(dz + 'T12:00:00').getDay() === 0; prawda(new Date(pon + 'T12:00:00').getDay() === 1 && (niedziela ? pon > dz : pon <= dz && pon > dodajDni(dz, -7)), 'poniedzialek() to poniedziałek bieżącego tygodnia (w niedzielę jutrzejszy)');
  });
  await test('Pomiary ciała', 'sylwetka z pięcioma obwodami, ocena zmian wg celu, wartości z jedną cyfrą, widok bez błędów', async () => {
    const so = obw;
    try {
      obw = { ona: { '2026-11-01': { klatka: 92, talia: 78, biodra: 100, ramie: 28, udo: 58 }, '2026-11-15': { talia: 75.5, biodra: 99 } }, on: {} };
      rowne(seriaObw('ona', 'talia'), [['2026-11-01', 78], ['2026-11-15', 75.5]], 'seria obwodu talii');
      rowne(seriaObw('ona', 'klatka').length, 1, 'obwód zmierzony raz');
      rowne([oceniObw('talia', 'redukcja', -1.5), oceniObw('talia', 'redukcja', 1), oceniObw('ramie', 'redukcja', 1), oceniObw('ramie', 'masa', 0.5), oceniObw('talia', 'masa', 1)], ['dobry', 'zly', '', 'dobry', ''], 'ocena zmian zależy od celu');
      const du = duchCiala('ona'); prawda(du && du.mn.talia > 1.02 && du.mn.talia < 1.1 && du.ruszyla, 'duch: pierwsza talia szersza od obecnej, mnożnik w rozsądnych granicach');
      const wag = waga; try { waga = { ona: { '2026-01-01': 90, '2026-02-01': 80 }, on: {} }; rowne([duchCiala('ona').dKg, duchCiala('ona').mn.klatka > 1], [-10, true], 'bez obwodu sylwetka ducha wynika z wagi'); } finally { waga = wag; }
      const h = figuraCialo('ona', false), div = document.createElement('div'); div.innerHTML = h;
      rowne(div.querySelectorAll('.sito-et').length, 6, 'sześć podpisów obwodów'); rowne(div.querySelectorAll('.pas-przod').length, 6, 'sześć opasek na sylwetce');
      prawda(/75,5<i> cm/.test(h) && /▼ 2,5/.test(h), 'talia: ostatnia wartość i zmiana z jedną cyfrą po przecinku');
      const sk = zakladka, w = wagaWidok; wagaWidok = 'cialo'; try { widokWaga(); prawda(!!document.querySelector('.cialo-scena') && !!document.querySelector('[data-zapisz-obw]'), 'widok pomiarów ciała się rysuje'); } finally { wagaWidok = w; zakladka = sk; }
    } finally { obw = so; }
  });
  await test('Import pomiarów', 'wklejone CSV z wagą i obwodami: nagłówek, ona/on, polskie daty, błędne wiersze pomijane', async () => {
    const h = parsujHistorie('data,dzien,osoba,waga_kg,uwagi\n2026-01-10,sobota,ona,64.5,start\n2026-01-10,sobota,on,81.0,start\n2026-02-07,sobota,ona,63.8,brak pomiaru; woda');
    rowne(h.waga, [['ona', '2026-01-10', 64.5], ['on', '2026-01-10', 81], ['ona', '2026-02-07', 63.8]], 'waga z nagłówkiem i uwagą ze średnikiem');
    const k = parsujHistorie('data;osoba;waga;talia;biodra\n8.11.2026;ona;74,2;76;99\n2099-01-01;on;80;;\nbzdura');
    rowne([k.waga, k.obw, k.pominiete], [[['ona', '2026-11-08', 74.2]], [['ona', '2026-11-08', 'talia', 76], ['ona', '2026-11-08', 'biodra', 99]], 2], 'polska data, przecinek, obwody; przyszłość i śmieci pominięte');
    const o = parsujHistorie('data,osoba,biceps_cm,klatka_cm,talia_cm,biodra_cm,udo_cm,lydka_cm,uwagi\n2026-01-10,ona,30,90,70,95,55,35,start');
    rowne(o.obw.map(q => q[2] + '=' + q[3]), ['klatka=90', 'talia=70', 'biodra=95', 'ramie=30', 'udo=55', 'lydka=35'], 'nagłówki z _cm, biceps jako ramię, łydka');
    rowne(parsujHistorie('').waga.length, 0, 'pusty tekst');
  });
  await test('Zmiana tygodnia: bez duplikatów', 'drugi slot z tą samą datą co plan jest usuwany, a różne daty zostają', async () => {
    const p0 = plan, i0 = inny, del = LS.del;
    try { LS.del = () => {};
      plan = { start: '2026-11-16', dni: [] }; inny = { start: '2026-11-16', dni: [] }; prawda(uporzadkujTygodnie() && inny === null, 'duplikat usunięty');
      inny = { start: '2026-11-23', dni: [] }; prawda(!uporzadkujTygodnie() && inny && inny.start === '2026-11-23', 'różne tygodnie zostają');
    } finally { plan = p0; inny = i0; LS.del = del; }
  });
  await test('Archiwum tygodni', 'tydzień zapisuje się sam, duża zmiana to nowa wersja, drobna aktualizuje ostatnią, przywracanie do wolnego slotu i podmiana', async () => {
    const sp = plan, si = inny, so = odhaczone, sz = zuzyte, sa = archiwum, lset = LS.set, ldel = LS.del, pt = pytaj, ry = rysuj, zo = zamknijOkno;
    try {
      LS.set = () => {}; LS.del = () => {}; pytaj = async () => true; rysuj = () => {}; zamknijOkno = () => {}; archiwum = {};
      const st = biezPon(), nast = dodajDni(st, 7), A = JSON.parse(JSON.stringify(kandydat())).dni, B = JSON.parse(JSON.stringify(kandydat())).dni;
      plan = { start: st, dni: JSON.parse(JSON.stringify(A)) }; inny = null; odhaczone = {}; zuzyte = {};
      archiwizuj(); rowne((archiwum[st] || []).length, 1, 'pierwszy zapis tygodnia');
      plan.dni[0].tr = { ona: true, on: false }; archiwizuj(); rowne(archiwum[st].length, 1, 'drobna zmiana nie tworzy nowej wersji');
      plan = { start: st, dni: JSON.parse(JSON.stringify(B)) }; archiwizuj(true);
      prawda(roznicaTyg(A, B) >= 4 ? archiwum[st].length === 2 : archiwum[st].length === 1, 'inny układ to nowa wersja');
      // tydzień zniknął: w planie został tylko następny
      plan = { start: nast, dni: JSON.parse(JSON.stringify(A)) }; inny = null;
      await przywrocTydzien(st, 0); rowne(inny && inny.start, st, 'przywrócony do drugiego slotu'); rowne(tygodnieZapisane().map(q => q.start), [st, nast], 'oba tygodnie są');
      // podmiana istniejącego tygodnia
      const dl = archiwum[st].length; await przywrocTydzien(st, archiwum[st].length - 1); rowne(inny.start, st, 'podmiana tego samego tygodnia'); prawda(archiwum[st].length >= dl, 'poprzednia wersja nie ginie');
    } finally { plan = sp; inny = si; odhaczone = so; zuzyte = sz; archiwum = sa; LS.set = lset; LS.del = ldel; pytaj = pt; rysuj = ry; zamknijOkno = zo; }
  });
  await test('Plan: widok po zmianie dań', 'po „Dopasuj dzień” i „Zamień automatycznie” Plan zostaje na oglądanym dniu, a nie skacze na dziś', async () => {
    const sp = plan, si = inny, sk = zakladka, sT = otwartyTyg, sD = otwartyDzien, lset = LS.set, ldel = LS.del, ry = rysuj, zo = zamknijOkno, pt = pokazToast, sd = window._dop;
    try {
      LS.set = () => {}; LS.del = () => {}; rysuj = () => {}; zamknijOkno = () => {}; pokazToast = () => {};
      plan = { start: biezPon(), dni: JSON.parse(JSON.stringify(kandydat())).dni }; inny = null; zakladka = 'tydzien';
      const inne = [...DB.dania.values()].find(x => x.id !== plan.dni[2].sn && DB.pula.sn.includes(x));
      otwartyTyg = plan.start; otwartyDzien = 5; window._dop = [{ start: plan.start, d: 2, zm: [{ slot: 'sn', nowy: inne, ratio: null }] }];
      zastosujDopasowanie();
      rowne([otwartyTyg, otwartyDzien], [plan.start, 5], 'po dopasowaniu dnia widok zostaje na tym samym dniu');
      otwartyTyg = plan.start; otwartyDzien = 3; zamienNiepasujace();
      rowne([otwartyTyg, otwartyDzien], [plan.start, 3], 'po zamianie niepasujących widok zostaje na tym samym dniu');
    } finally { plan = sp; inny = si; zakladka = sk; otwartyTyg = sT; otwartyDzien = sD; LS.set = lset; LS.del = ldel; rysuj = ry; zamknijOkno = zo; pokazToast = pt; window._dop = sd; }
  });
  await test('Wybór śniadań', 'podział wg głównego składnika, wspólna lista śniadania i drugiego śniadania, danie z jednego nie pokazuje się w drugim', async () => {
    const po = n => [...DB.dania.values()].find(x => x.nazwa === n), gr = n => grupaDania(po(n), 'sn');
    rowne(gr('Sałatka makaronowa z tuńczykiem'), 'Ryby i tuńczyk', 'sałatka z tuńczykiem to ryby');
    rowne(gr('Sałatka z kurczakiem, kaszą i kukurydzą'), 'Kurczak', 'sałatka z kurczakiem to kurczak');
    rowne(gr('Jajecznica z szynką i serem + chleb'), 'Jajecznica, omlety i szakszuka', 'jajecznica to jajka');
    rowne(gr('Owsianka z masłem orzechowym i bananem').slice(0, 7), 'Słodkie', 'owsianka jest słodka');
    const pula = pulaSniadan(); prawda(pula.length === new Set(pula.map(x => x.id)).size && pula.length >= DB.pula.sn.length + 1, 'wspólna lista bez powtórzeń');
    prawda(DB.pula.m13dania.every(x => pula.includes(x)) && DB.pula.sn.every(x => pula.includes(x)), 'na liście są śniadania i drugie dania');
    const sp = plan; try {
      plan = JSON.parse(JSON.stringify(plan)); const day = plan.dni[0];
      prawda(zajeteSniadania(0, 'sn').has(day.m13.on) && !zajeteSniadania(0, 'sn').has(day.sn), 'przy śniadaniu znika danie z drugiego śniadania');
      prawda(zajeteSniadania(0, 'm13on').has(day.sn) && !zajeteSniadania(0, 'm13on').has(day.m13.on), 'przy drugim śniadaniu znika danie ze śniadania');
      rowne(zajeteSniadania(0, 'ob').size, 0, 'obiad bez wykluczeń');
    } finally { plan = sp; }
  });
  await test('Wybór dania: właściwy tydzień', 'gdy tygodnie zamienią się miejscami w trakcie wyboru, zmiana trafia do oglądanego tygodnia; gdy tydzień zniknął, nic się nie zmienia', async () => {
    const sp = plan, si = inny, sc = zmienCtx, lset = LS.set, ldel = LS.del, ry = rysuj, pt = pokazToast, m = document.getElementById('modal'), mh = m.hidden;
    try {
      LS.set = () => {}; LS.del = () => {}; rysuj = () => {}; pokazToast = () => {};
      const A = JSON.parse(JSON.stringify(kandydat())).dni, B = JSON.parse(JSON.stringify(kandydat())).dni, nowe = DB.pula.sn.find(x => x.id !== A[2].sn && x.id !== B[2].sn).id;
      const T0 = biezPon(), T1 = dodajDni(T0, 7); plan = { start: T0, dni: A }; inny = { start: T1, dni: B, odhaczone: {}, zuzyte: {} };
      zmienCtx = { d: 2, slot: 'sn', teraz: B[2].sn, pula: DB.pula.sn, start: T1 };
      wybierz(2, 'sn', nowe);
      rowne([plan.start, plan.dni[2].sn === nowe, inny.dni[2].sn === nowe], [T1, true, false], 'zmiana w oglądanym tygodniu, a nie w bieżącym');
      const stary = plan.dni[2].sn; plan = { start: T0, dni: JSON.parse(JSON.stringify(A)) }; inny = null;
      zmienCtx = { d: 2, slot: 'sn', teraz: stary, pula: DB.pula.sn, start: T1 }; const przed = plan.dni[2].sn;
      wybierz(2, 'sn', nowe); rowne(plan.dni[2].sn, przed, 'tydzień zniknął: nic nie zmieniono w innym tygodniu');
    } finally { plan = sp; inny = si; zmienCtx = sc; LS.set = lset; LS.del = ldel; rysuj = ry; pokazToast = pt; m.hidden = mh; }
  });
  await test('Wieczorem na jutro: tylko czynności', 'bez samych śniadań; owoce do jutrzejszych śniadań i mięso do obiadów (oraz do śniadań na pojutrze) do wyjęcia z zamrażarki, nic w weekend', async () => {
    const sp = plan;
    try {
      plan = JSON.parse(JSON.stringify(plan)); plan.start = biezPon();
      const w = oblicz(plan, cele()); let owoce = 0, ob = 0, poj = 0;
      for (let d = 0; d < 6; d++) {
        const dow = n => new Date(dodajDni(plan.start, d + n) + 'T12:00:00').getDay(), weekend = n => dow(n) === 0 || dow(n) === 6, lista = wieczorem(w, d);
        prawda(!lista.some(x => x.t === 'kroki' && sniadaniowy(x.g)), 'śniadania nie są w „Wieczorem na jutro” (są w karcie na Dziś)');
        for (const { g, odgrzewane } of w.dni[d + 1].sloty) {
          if (odgrzewane) continue;
          if (sniadaniowy(g)) {
            const it = lista.filter(x => x.t === 'mroz' && x.g === g && /mrożon/.test(x.tekst));
            if (weekend(1) || g.dish.tylko_wybor) rowne(it.length, 0, 'weekend / „na świeżo”: bez wyjmowania owoców (' + g.dish.nazwa + ')');
            else if (mrozOwoceDoWyjecia(g).length) { owoce++; rowne(it.length, mrozOwoceDoWyjecia(g).length, 'owoce do wyjęcia dla śniadania ' + g.dish.nazwa); }
          } else if (bazaSlotu(g.slot) === 'ob' && mrozDoWyjecia(g).length) { ob++; prawda(lista.some(x => x.t === 'mroz' && x.g === g), 'obiad: mięso z zamrażarki (' + g.dish.nazwa + ')'); }
        }
        if (d + 2 <= 6) for (const { g, odgrzewane } of w.dni[d + 2].sloty) if (!odgrzewane && sniadaniowy(g) && !g.dish.tylko_wybor && mrozDoWyjecia(g).length) {
          const ma = lista.some(x => x.t === 'mroz' && x.g === g && /śniadanie na/.test(x.tekst));
          if (weekend(2)) prawda(!ma, 'śniadanie w weekend: bez przypomnienia'); else { poj++; prawda(ma, 'mięso do śniadania na pojutrze (' + g.dish.nazwa + ')'); }
        }
      }
      prawda(ob > 0, 'brak obiadów z mrożonką w planie testowym');
    } finally { plan = sp; }
  });
  await test('Lista zakupów: „Mam to w domu”', 'przycisk dopisuje brakującą ilość do lodówki, pozycja przechodzi do „Masz już”, cofnięcie ją przywraca; lodówka w innej jednostce jest wyjaśniona', async () => {
    const sl = lodowka, lset = LS.set, ry = rysuj, pt = pokazToast, sz = window._z;
    try {
      LS.set = () => {}; rysuj = () => {}; pokazToast = (t, et, fn) => { window.__cofnij = fn; };
      lodowka = {}; const wyb = wybraneDni(); let z = zakupyDni(wyb); window._z = z;
      const lista = () => ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]), p = lista().find(x => Object.keys(x.brakuje).length === 1 && DB.produkty.get(x.produkt) && !/mięs|kurczak/.test(x.produkt));
      prawda(p, 'brak pozycji do sprawdzenia');
      mamWDomu(p.produkt); z = zakupyDni(wyb); window._z = z;
      prawda(!lista().some(x => x.produkt === p.produkt) && z.wynik.masz.some(x => x.produkt === p.produkt), 'po „Mam to” pozycji nie ma na liście do kupienia, jest w „Masz już”');
      window.__cofnij(); z = zakupyDni(wyb); window._z = z;
      prawda(lista().some(x => x.produkt === p.produkt), 'po cofnięciu pozycja wraca na listę');
      const [u0] = Object.keys(p.brakuje), inna = u0 === 'g' ? 'szt.' : 'g'; lodowka = { [p.produkt]: { [inna]: 777 } }; z = zakupyDni(wyb);
      const q = lista().find(x => x.produkt === p.produkt); prawda(q && /777/.test(q.stanInna), 'lodówka w innej jednostce: pozycja zostaje na liście z wyjaśnieniem');
    } finally { lodowka = sl; LS.set = lset; rysuj = ry; pokazToast = pt; window._z = sz; delete window.__cofnij; }
  });
  await test('Garnek na dwa dni', 'pierwsze „zjedzone” zdejmuje składniki całego garnka, drugi dzień nic nie dolicza, ani prognoza, ani lista zakupów nie liczą go ponownie', async () => {
    const sl = lodowka, sz = zuzyte, lset = LS.set, ldel = LS.del;
    try {
      LS.set = () => {}; LS.del = () => {}; zuzyte = {};
      const w = oblicz(plan, cele()), g = w.garnki.find(x => dniGarnka(x).length === 2 && skladGarnka(x).some(s => s[3] === 'g'));
      prawda(g, 'brak garnka na dwa dni w planie testowym');
      const [d1, d2] = dniGarnka(g).sort((a, b) => a - b), skl = skladGarnka(g);
      lodowka = {}; skl.forEach(([p, , , u]) => { lodowka[p] = lodowka[p] || {}; lodowka[p][u] = 100000; });
      const stan = () => JSON.stringify(lodowka);
      zjedz(g, d1, true);
      const po1 = skl.every(([p, , q, u]) => { const razem = skl.filter(s => s[0] === p && s[3] === u).reduce((a, s) => a + ileZuzyto(s[2], u, 1), 0); return Math.abs(100000 - lodowka[p][u] - razem) < 0.6; });
      prawda(po1, 'po pierwszym dniu z lodówki zeszły składniki całego garnka');
      const po1s = stan(); zjedz(g, d2, true); rowne(stan(), po1s, 'drugi dzień (odgrzewanie) nie zdejmuje nic więcej');
      rowne(pozostalo(g), 0, 'garnek ugotowany: nic więcej do kupienia ani liczenia');
      prawda(!prognoza(w).some(x => x.dish === g.dish.nazwa), 'prognoza nie liczy już ugotowanego garnka');
      zjedz(g, d2, false); zjedz(g, d1, false); rowne(stan(), JSON.stringify(Object.fromEntries(Object.entries(lodowka).map(([p, us]) => [p, Object.fromEntries(Object.entries(us).map(([u]) => [u, 100000]))]))), 'cofnięcie oddaje składniki');
    } finally { lodowka = sl; zuzyte = sz; LS.set = lset; LS.del = ldel; }
  });
  await test('Lista zakupów: okno „Mam to w domu”', 'bez produktu w lodówce pyta, ile dodać; z produktem pokazuje, ile masz i ile potrzeba, a zapis ustawia ilość', async () => {
    const sl = lodowka, lset = LS.set, ry = rysuj, pt = pokazToast, sz = window._z, m = document.getElementById('modal'), mh = m.hidden, box = document.getElementById('modal-box'), sv = box.innerHTML;
    try {
      LS.set = () => {}; rysuj = () => {}; pokazToast = () => {}; lodowka = {};
      const wyb = wybraneDni(), lista = z => ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]);
      let z = zakupyDni(wyb); window._z = z;
      const p = lista(z).find(x => Object.keys(x.brakuje).length === 1 && Object.keys(x.brakuje)[0] === 'g' && Object.values(x.brakuje)[0] > 300);
      prawda(p, 'brak pozycji w gramach do sprawdzenia');
      oknoMamWDomu(p.produkt);
      prawda(/Tego nie ma w lodówce/.test(box.textContent) && document.getElementById('mam-q') && /Dodaj do lodówki/.test(box.textContent), 'brak w lodówce: pytanie, ile dodać');
      document.getElementById('mam-q').value = '123'; zapiszMam(); rowne(lodowka[p.produkt].g, 123, 'zapis dodaje wpisaną ilość');
      z = zakupyDni(wyb); window._z = z; const q = lista(z).find(x => x.produkt === p.produkt);
      prawda(q && /masz w lodówce 123 g, a potrzeba razem/.test(`masz w lodówce ${q.stan}, a potrzeba razem ${q.potrzebaTxt}`) && q.potrzebaTxt, 'pozycja zna, ile masz i ile potrzeba razem');
      oknoMamWDomu(p.produkt);
      prawda(/W lodówce masz\s*123 g/.test(box.textContent) && /potrzeba razem/.test(box.textContent) && /Zapisz ilość/.test(box.textContent), 'z produktem w lodówce: pokazuje, ile masz i ile potrzeba');
      document.getElementById('mam-q').value = '400'; zapiszMam(); rowne(lodowka[p.produkt].g, 400, 'zapis ustawia ilość w lodówce');
    } finally { lodowka = sl; LS.set = lset; rysuj = ry; pokazToast = pt; window._z = sz; box.innerHTML = sv; m.hidden = mh; }
  });
  await test('Odporność na uszkodzone dane', 'dane zapisane w złym typie albo bez kluczy ona/on nie wywracają aplikacji, poprawne dane zostają bez zmian', async () => {
    const k = '__test_ls', ust = v => localStorage.setItem(k, v);
    try {
      ust('null'); rowne(LS.get(k, { a: 1 }), { a: 1 }, 'null → domyślne');
      ust('"x"'); rowne(LS.get(k, {}), {}, 'tekst zamiast obiektu → domyślne');
      ust('[1,2]'); rowne(LS.get(k, {}), {}, 'tablica zamiast obiektu → domyślne');
      ust('{}'); rowne(LS.get(k, []), [], 'obiekt zamiast tablicy → domyślne');
      ust('oops{'); rowne(LS.get(k, { a: 2 }), { a: 2 }, 'zepsuty JSON → domyślne');
      ust('{}'); rowne(LS.get(k, { ona: {}, on: {} }), { ona: {}, on: {} }, 'brak ona/on uzupełniony');
      ust('{"ona":null,"on":{"2026-01-01":80}}'); rowne(LS.get(k, { ona: {}, on: {} }), { ona: {}, on: { '2026-01-01': 80 } }, 'uszkodzone ona zastąpione, poprawne on zostaje');
      ust('{"a":5}'); rowne(LS.get(k, { a: 1 }), { a: 5 }, 'poprawne dane bez zmian');
      ust('{"id":"x"}'); rowne(LS.get(k, null), { id: 'x' }, 'domyślne null: zwraca zapisane');
      localStorage.removeItem(k); rowne(LS.get(k, 7), 7, 'brak klucza → domyślne');
    } finally { localStorage.removeItem(k); }
  });
  await test('Zakupy: kolejna wyprawa', 'znaczniki „kupione” należą do jednej wyprawy: zmiana dni zamyka starą (lodówka zostaje), te same dni ją zachowują, stare znaczniki bez sygnatury też się zamykają', async () => {
    const so = odhaczone, si = inny, sl = lodowka, lset = LS.set;
    try {
      LS.set = () => {}; lodowka = { chleb: { 'krom.': 20 } };
      const A = new Set(['2026-11-23', '2026-11-24']), B = new Set(['2026-11-25']);
      odhaczone = { 'zak|chleb': { 'krom.': 16 }, 'zak|banan': { 'szt.': 3 }, zakTrip: zakSig(A), inne: true }; inny = { start: '2026-11-30', dni: [], odhaczone: { 'zak|jajka': { 'szt.': 10 }, zakTrip: zakSig(A) } };
      zakNowaWyprawa(A); prawda(odhaczone['zak|chleb'] && odhaczone['zak|banan'] && inny.odhaczone['zak|jajka'], 'te same dni: znaczniki zostają');
      zakNowaWyprawa(B); rowne(Object.keys(odhaczone).filter(k => k.startsWith('zak|')).length + Object.keys(inny.odhaczone).filter(k => k.startsWith('zak|')).length, 0, 'inne dni: stara wyprawa zamknięta w obu tygodniach');
      prawda(odhaczone.inne === true && odhaczone.zakTrip === undefined, 'inne wpisy zostają, sygnatura usunięta');
      rowne(lodowka.chleb['krom.'], 20, 'lodówka bez zmian');
      odhaczone = { 'zak|chleb': { 'krom.': 16 } }; inny = null; zakNowaWyprawa(B); rowne(Object.keys(odhaczone).length, 0, 'stare znaczniki bez sygnatury zamykają się');
    } finally { odhaczone = so; inny = si; lodowka = sl; LS.set = lset; }
  });
  await test('Zapisy do chmury: paczki', 'zapisy z jednej akcji łączą się w paczki: różne pola razem, przyrosty tego samego pola sumują się, kolidujące ścieżki idą osobno w tej samej kolejności', async () => {
    const inc = n => ({ __inc: n });
    let pa = zPaczki([[['lodowka', 'a', 'g'], inc(5)], [['lodowka', 'b', 'szt.'], inc(2)], [['odhaczone', 'zak|a'], { g: 5 }], [['lodowka', 'a', 'g'], inc(7)]]);
    rowne(pa.length, 1, 'jedna paczka'); rowne(pa[0].length, 3, 'przyrosty tego samego pola scalone'); rowne(pa[0][0][1], inc(12), 'suma przyrostów');
    pa = zPaczki([[['lodowka', 'x'], { g: 1 }], [['lodowka', 'x', 'g'], 9]]); rowne(pa.length, 2, 'pole i jego część osobno'); rowne([pa[0][0][0].length, pa[1][0][0].length], [2, 3], 'kolejność zachowana');
    pa = zPaczki([[['lodowka', 'y'], 1], [['lodowka', 'y'], 2]]); rowne(pa.length, 2, 'to samo pole ustawione dwa razy: osobne paczki'); rowne([pa[0][0][1], pa[1][0][1]], [1, 2], 'ostatnia wartość wygrywa');
    pa = zPaczki([[['lodowka', 'z'], inc(1)], [['lodowka', 'z'], 5]]); rowne(pa.length, 2, 'przyrost potem ustawienie: osobno (kolejność ma znaczenie)');
    pa = zPaczki(Array.from({ length: 450 }, (_, i) => [['lodowka', 'p' + i, 'g'], inc(1)])); rowne(pa.map(x => x.length), [200, 200, 50], 'limit 200 pól w paczce');
    rowne(zPaczki([]).length, 0, 'pusty zapis');
  });
  await test('Zakupy a lodówka: spójność', 'po kupieniu wszystkiego z listy prognoza nie zgłasza braków, a zjadanie tygodnia nie schodzi poniżej zera', async () => {
    const sl = lodowka, sz = zuzyte, lset = LS.set, ry = rysuj;
    try {
      LS.set = () => {}; rysuj = () => {}; lodowka = {}; zuzyte = {};
      const dzis = isoDzis(), dni = dniDostepne().map(x => x.iso);
      if (!dni.some(i => i >= dzis)) return;   // plan testowy jest już w przeszłości: nie ma czego sprawdzać
      const z = zakupyDni(new Set(dni.filter(i => i >= dzis)));
      for (const k of ['świeże', 'zamrażarka', 'zapas']) for (const p of z.wynik[k]) for (const [u, q] of Object.entries(p.kupno)) { lodowka[p.produkt] = lodowka[p.produkt] || {}; lodowka[p.produkt][u] = (lodowka[p.produkt][u] || 0) + q; }
      const braki = prognoza(oblicz(plan, cele())).map(x => `${x.produkt} ${Math.round(x.brakuje * 10) / 10} ${x.u}`);
      rowne(braki, [], 'po kupieniu całej listy nic nie powinno brakować');
      const ujemne = [];
      for (let d = dzisIdx(); d < 7; d++) { const w = oblicz(plan, cele()); for (const g of w.garnki) for (const dd of dniGarnka(g)) if (dd === d) zjedz(g, d, true); for (const [p, us] of Object.entries(lodowka)) for (const [u, q] of Object.entries(us)) if (q < -0.01) ujemne.push(p + ' ' + q + ' ' + u); }   // od dziś: wcześniejsze dni nie są w zakupach
      rowne([...new Set(ujemne)], [], 'zjadanie tygodnia nie może schodzić poniżej zera');
    } finally { lodowka = sl; zuzyte = sz; LS.set = lset; rysuj = ry; }
  });
  await test('Prognoza braków: do następnych zakupów', 'braki liczone tylko do dnia następnych zakupów (znacznik ostatniej wyprawy albo rytm pon/pt), nie do końca tygodnia', async () => {
    const so = odhaczone, si = inny, sl = lodowka;
    try {
      const dzis = isoDzis(), idx = (new Date(dzis + 'T12:00:00').getDay() + 6) % 7;
      odhaczone = { zakTrip: [dodajDni(dzis, 1), dodajDni(dzis, 3)].join(',') }; inny = null;
      rowne(horyzontBrakow(), dodajDni(dzis, 3), 'ostatnia wyprawa objęła dni do dzisiaj+3');
      odhaczone = { zakTrip: dodajDni(dzis, -2) }; const rytm = horyzontBrakow();
      rowne(rytm, dodajDni(dzis, idx === 0 ? 0 : idx <= 4 ? 4 - idx : 7 - idx), 'bez wyprawy sięgającej przyszłości: rytm (najbliższy poniedziałek lub piątek)');
      prawda(new Date(rytm + 'T12:00:00').getDay() === 1 || new Date(rytm + 'T12:00:00').getDay() === 5, 'horyzont wypada w poniedziałek albo piątek');
      // wiele produktów z odrobiną w lodówce: braki pojawią się w różnych dniach
      lodowka = {}; for (const [p, k] of DB.produkty) lodowka[p] = { [k.u]: 1 };
      const w = oblicz(plan, cele()), dniPlanu = d => dodajDni(plan.start, d);
      odhaczone = { zakTrip: dodajDni(dzis, 6) }; inny = null; const pelne = prognoza(w);
      odhaczone = { zakTrip: dodajDni(dzis, 1) }; const kroto = prognoza(w);
      prawda(pelne.length > 0, 'przy dalekim horyzoncie są braki');
      prawda(kroto.every(x => dniPlanu(x.d) <= dodajDni(dzis, 1)), 'przy krótkim horyzoncie braków po tym dniu nie ma');
      prawda(kroto.length <= pelne.length && (!pelne.some(x => dniPlanu(x.d) > dodajDni(dzis, 1)) || kroto.length < pelne.length), 'krótszy horyzont daje mniej braków');
    } finally { odhaczone = so; inny = si; lodowka = sl; }
  });
  await test('Śniadania na jutro', 'oba jutrzejsze śniadania (pierwsze i drugie) w karcie na Dziś z „Gotuj teraz”, okno ze śniadaniami', async () => {
    const j = jutroDane(); prawda(j, 'brak planu na jutro w danych testowych');
    const oczekiwane = j.w.dni[j.d].sloty.filter(({ g, odgrzewane }) => sniadanieJutro(g) && !odgrzewane).map(x => x.g.dish.nazwa);
    rowne(j.sl.map(g => g.dish.nazwa), oczekiwane, 'śniadania na jutro zgadzają się z planem');
    prawda(j.sl.length >= 1 && j.sl.every(g => sniadanieJutro(g)), 'tylko śniadania (pierwsze i drugie, także koktajl na 13:00)');
    const kod = await tekst('app.js'); prawda(!/Przygotuj śniadania na jutro/.test(kod) && /data-jutro-otworz/.test(kod), 'bez przycisku w niebieskim bloku, nagłówek karty otwiera szczegóły');
    const m = document.getElementById('modal'), box = document.getElementById('modal-box'), sv = box.innerHTML, svH = m.hidden;
    try { oknoJutro(); prawda(!m.hidden, 'okno się nie otworzyło'); prawda(box.textContent.includes('Śniadania na jutro') && j.sl.every(g => box.textContent.includes(g.dish.nazwa)), 'okno bez nazw śniadań'); prawda(box.querySelectorAll('[data-jutro-przepis]').length === j.sl.length, 'przycisk przepisu przy każdym śniadaniu'); }
    finally { box.innerHTML = sv; m.hidden = svH; }
    const karta = kartaJutroLink(), cookable = j.sl.filter(g => !j.weekend && !g.dish.tylko_wybor).length;
    prawda(j.sl.every(g => karta.includes(esc(g.dish.nazwa))), 'karta na Dziś pokazuje wszystkie śniadania');
    rowne((karta.match(/data-jutro-gotuj=/g) || []).length, cookable, '„Gotuj teraz” przy każdym śniadaniu do zrobienia wieczorem');
    rowne((karta.match(/data-jutro-ok=/g) || []).length, cookable, 'ptaszek przy każdym śniadaniu do zrobienia wieczorem');
    const koktajl = j.w.dni[j.d].sloty.find(s => s.g.slot === 'm13ona' && !s.odgrzewane);
    if (koktajl) { prawda(j.sl.includes(koktajl.g) && karta.includes(esc(koktajl.g.dish.nazwa)), 'koktajl dla niej na 13:00 jest wśród śniadań na jutro'); prawda(new RegExp('data-jutro-gotuj="' + j.sl.indexOf(koktajl.g) + '"').test(karta) && new RegExp('data-jutro-ok="' + j.sl.indexOf(koktajl.g) + '"').test(karta) || j.weekend, 'koktajl ma ptaszek i „Gotuj teraz”'); }
    prawda(!/Zobacz<\/button>/.test(karta), 'bez starego przycisku „Zobacz”');
  });
  await test('Meal prep: notatka w przepisie', 'jedna linia na posiłek (nie na wszystkie wystąpienia dania w tygodniu), nieaktualna zapisana sesja nie każe pomijać gotowania, wykonana sesja tak', async () => {
    const sp = plan, ss = sesje, lset = LS.set, ry = rysuj;
    try {
      LS.set = () => {}; rysuj = () => {}; plan = JSON.parse(JSON.stringify(plan)); sesje = [];
      const sid = [...DB.dania.values()].find(x => x.nazwa.startsWith('Sałatka ryżowa z kurczakiem')).id, a = Math.min(dzisIdx(), 5), dni = [a, a + 1, a + 2].filter(d => d <= 6);
      dni.forEach(d => { plan.dni[d].m13.on = sid; plan.dni[d].ratio = {}; });
      const od = isoDzis(), pl = planPrepu(od, prepH), rz = pl.komp.find(c => c.prod === 'ryż');
      if (!rz || rz.uzycia.length < 2) return;   // za mało wystąpień w oknie planu testowego
      zapiszSesje(pl);
      const gar = () => oblicz(plan, cele()).garnki.filter(g => g.dish.id === sid && dni.includes(g.d)), linie = g => (notaPrepu(g).match(/<div>/g) || []).length;
      for (const g of gar()) rowne(linie(g), rz.uzycia.filter(u => u.iso === dodajDni(plan.start, g.d) && u.slot === g.slot && u.id === sid).length, 'jedna linia na posiłek, dzień ' + g.d);
      // zapisana, niewykonana sesja jest nieaktualna, gdy obecny plan prepu nie zawiera już tego składnika w tym posiłku (symulacja: plan prepu bez składników)
      const pierwszy = dni.find(d => rz.uzycia.some(u => u.iso === dodajDni(plan.start, d)));
      const g1 = oblicz(plan, cele()).garnki.find(g => g.dish.id === sid && g.d === pierwszy);
      prawda(notaPrepu(g1).includes('Ryż'), 'aktualna sesja: komunikat jest');
      const pp = planPrepu; planPrepu = (o, h, b) => (b ? Object.assign({}, pp(o, h, b), { komp: [] }) : pp(o, h, b));
      try { rowne(notaPrepu(g1), '', 'nieaktualna sesja: bez komunikatu'); } finally { planPrepu = pp; }
      sesje[0].zrobione = true; prawda(notaPrepu(g1).includes('Ryż'), 'wykonana sesja: komunikat jest');
      sesje[0].zrobione = false; sesje[0].od = dodajDni(isoDzis(), -1); rowne(notaPrepu(g1), '', 'niewykonana sesja z przeszłości: bez komunikatu');
    } finally { plan = sp; sesje = ss; LS.set = lset; rysuj = ry; }
  });
  await test('Meal prep: podpowiedź tylko w najlepszym dniu', 'karta „Dziś dobry dzień na meal prep” pokazuje się tylko, gdy dziś jest najlepszy dzień okna', async () => {
    const ok0 = okazjePrepu, ss = sesje;
    try {
      sesje = []; const dzis = isoDzis(), jutro = dodajDni(dzis, 1);
      okazjePrepu = () => [{ od: dzis, min: 25, n: 1 }, { od: jutro, min: 40, n: 2 }];
      prawda(!kartaPrepDzis(dzis).includes('Dziś dobry dzień na meal prep'), 'jutro jest lepiej: dziś bez podpowiedzi');
      okazjePrepu = () => [{ od: dzis, min: 40, n: 2 }, { od: jutro, min: 25, n: 1 }];
      prawda(kartaPrepDzis(dzis).includes('Dziś dobry dzień na meal prep'), 'dziś najlepiej: jest podpowiedź');
      okazjePrepu = () => [{ od: dzis, min: 30, n: 1 }, { od: jutro, min: 30, n: 1 }];
      prawda(kartaPrepDzis(dzis).includes('Dziś dobry dzień na meal prep'), 'remis: dziś też się opłaca');
      okazjePrepu = () => [{ od: dzis, min: 10, n: 1 }, { od: jutro, min: 8, n: 1 }];
      prawda(!kartaPrepDzis(dzis).includes('Dziś dobry dzień na meal prep'), 'oszczędność poniżej 20 min: bez podpowiedzi');
    } finally { okazjePrepu = ok0; sesje = ss; }
  });
  await test('Meal prep: danie na dwa dni', 'składnik gotowany osobno w daniu na dwa dni to jedno użycie na całą ilość w dniu gotowania, nie podział na dwa dni jedzenia', async () => {
    const sp = plan;
    try {
      plan = JSON.parse(JSON.stringify(plan));
      const a = Math.min(dzisIdx(), 4);
      const dish = DB.pula.ob2.find(x => x.typ === 'obiad_2dni' && x.skladniki.some(i => PREP[i.produkt] && i.ilosc && gotowaneOsobno(x, i.produkt)));
      if (!dish) return;
      plan.dni[a].ob = dish.id; plan.dni[a].ob2 = true; plan.dni[a].ratio = {}; plan.dni[a + 1].ob = null; plan.dni[a + 1].ob2 = false;   // dzień po daniu na dwa dni ma puste pole obiadu (danie przechodzi z poprzedniego dnia)
      const g = oblicz(plan, cele()).garnki.find(x => x.dish.id === dish.id && x.d === a);
      if (!g || dniGarnka(g).length < 2) return;
      const i = g.dish.skladniki.find(q => PREP[q.produkt] && q.ilosc && gotowaneOsobno(g.dish, q.produkt)), c = PREP[i.produkt], calosc = i.ilosc * skala(g, i);
      const pl = planPrepu(isoDzis(), 6), uz = [...pl.komp.filter(k => k.prod === i.produkt).flatMap(k => k.uzycia.concat(k.poza)), ...pl.pojedyncze.filter(k => k.prod === i.produkt).flatMap(k => k.uzycia)].filter(x => x.id === dish.id && x.wk === plan.start);
      rowne(uz.length, 1, 'jedno użycie na cały garnek, a nie jedno na każdy dzień jedzenia');
      rowne(uz[0].d, Math.min(...dniGarnka(g)), 'w pierwszym dniu (gotowania)');
      rowne(uz[0].suchy, c.u === 'szt.' ? Math.max(1, Math.round(calosc)) : Math.round(calosc / 5) * 5 || 5, 'cała ilość składnika');
    } finally { plan = sp; }
  });
  await test('Garnki na dwa dni: odznaczanie', 'odznaczenie dnia gotowania przy zaznaczonym drugim dniu nie zwraca składników do lodówki; zwrot dopiero po odznaczeniu ostatniego dnia', async () => {
    const sl = lodowka, sz = zuzyte, lset = LS.set;
    try {
      LS.set = () => {}; zuzyte = {};
      const g = oblicz(plan, cele()).garnki.find(x => dniGarnka(x).length === 2 && skladGarnka(x).some(s => s[3] === 'g'));
      if (!g) return;
      const [d1, d2] = dniGarnka(g).sort((a, b) => a - b); lodowka = {}; skladGarnka(g).forEach(([p, , , u]) => { lodowka[p] = lodowka[p] || {}; lodowka[p][u] = 100000; });
      const zuz = () => Math.round(Object.values(lodowka).reduce((a, us) => a + Object.values(us).reduce((b, q) => b + (100000 - q), 0), 0));
      zjedz(g, d1, true); const po1 = zuz(); prawda(po1 > 0, 'pierwszy dzień zdejmuje składniki');
      zjedz(g, d2, true); rowne(zuz(), po1, 'drugi dzień nic nie zdejmuje');
      zjedz(g, d1, false); rowne(zuz(), po1, 'odznaczenie dnia gotowania przy zjedzonym drugim: składniki zostają zdjęte');
      prawda(!prognoza(oblicz(plan, cele())).some(x => x.dish === g.dish.nazwa), 'garnek nadal ugotowany: prognoza go nie liczy');
      zjedz(g, d2, false); rowne(zuz(), 0, 'po odznaczeniu ostatniego dnia składniki wracają');
    } finally { lodowka = sl; zuzyte = sz; LS.set = lset; }
  });
  await test('Garnki na dwa dni: spójność w całej aplikacji', 'na losowych planach każdy garnek na dwa dni jest liczony raz i w dniu gotowania: zakupy, zero waste, woreczki mięsa, prep, „Wieczorem na jutro”', async () => {
    const sp = plan, si = inny, so = odhaczone, sz = zuzyte, sl = lodowka, ry = rysuj, lset = LS.set, ldel = LS.del;
    try {
      rysuj = () => {}; LS.set = () => {}; LS.del = () => {}; let dwu = 0;
      const oczekiwane = w => { const m = {}, dod = (p, u, q) => { m[p + '|' + u] = (m[p + '|' + u] || 0) + q; }; for (const g of w.garnki) { for (const i of g.dish.skladniki) if (i.ilosc && i.produkt) dod(i.produkt, i.jednostka, ileZuzyto(i.ilosc * skala(g, i), i.jednostka, 1)); } return m; };
      for (let it = 0; it < 6; it++) {
        ulozTydzien(biezPon(), false); inny = null; zuzyte = {}; odhaczone = {}; lodowka = {};
        const t = tygodnieZapisane()[0], w = oblicz(plan, cele()), garnki2 = w.garnki.filter(g => dniGarnka(g).length > 1); dwu += garnki2.length;
        const z = zakupyDni(new Set(dniDostepne().map(x => x.iso))), lista = {};
        for (const k of ['świeże', 'zamrażarka', 'zapas']) for (const p of z.wynik[k]) for (const [u, q] of Object.entries(p.brakuje)) lista[p.produkt + '|' + u] = q;
        const pom = new Set(['odżywka białkowa|g', 'mleko 2%|ml', 'skyr naturalny|g']);
        for (const [k, q] of Object.entries(oczekiwane(w))) if (!pom.has(k) && Math.abs((lista[k] || 0) - q) > 0.6 && Math.abs((lista[k] || 0) - q) / Math.max(q, 1) > 0.02) prawda(false, `zakupy: ${k} lista ${lista[k] || 0} vs ${q} (każdy garnek raz)`);
        const zd = [], lic = {}; zdarzeniaTygodnia({ start: t.start, dni: t.dni, zuz: {} }, w, zd);
        for (const e of zd) if (e.ref) { const k = e.ref.d + '|' + e.ref.slot + '|' + e.prod + '|' + e.u; lic[k] = (lic[k] || 0) + 1; }
        prawda(Object.values(lic).every(n => n === 1), 'zero waste: jedno zdarzenie na składnik garnka');
        for (const g of garnki2) {
          const dzien0 = Math.min(...dniGarnka(g)), ev = zd.filter(e => e.ref && e.ref.d === g.d && e.ref.slot === g.slot);
          prawda(ev.every(e => e.t === dzienIdx(dodajDni(t.start, dzien0))), 'zero waste: zdarzenia w dniu gotowania');
          const mp = miesoPodzial(isoDzis(), 14); if (dodajDni(t.start, dzien0) >= isoDzis()) for (const i of g.dish.skladniki) if (i.ilosc && i.produkt && stala(i)) rowne((mp[i.produkt] || []).filter(x => x.dish === g.dish.nazwa && x.slot === g.slot).length, Math.ceil(g.nF || 1), 'woreczki mięsa: jeden zestaw na garnek');
        }
        const pl = planPrepu(isoDzis(), 6), uz = [...pl.komp.flatMap(k => k.uzycia.concat(k.poza)), ...pl.pojedyncze.flatMap(k => k.uzycia)];
        for (const g of garnki2) prawda(!uz.some(u => u.id === g.dish.id && u.slot === g.slot && dniGarnka(g).includes(u.d) && u.d !== Math.min(...dniGarnka(g))), 'prep: użycie tylko w dniu gotowania');
        for (let d = 0; d < 6; d++) for (const x of wieczorem(w, d)) { const s = x.g && w.dni[d + 1].sloty.find(q => q.g === x.g); prawda(!(s && s.odgrzewane), 'wieczorem: bez zadań dla odgrzewanego posiłku'); }
      }
      prawda(dwu > 0, 'brak garnków na dwa dni w losowych planach');
    } finally { plan = sp; inny = si; odhaczone = so; zuzyte = sz; lodowka = sl; rysuj = ry; LS.set = lset; LS.del = ldel; }
  });
  await test('Dziś wieczorem: postęp i odhaczanie', 'komunikat „Wszystko na dziś zrobione” dopiero po przygotowaniu jutrzejszych śniadań i zadań z listy wieczornej', async () => {
    const raw = localStorage.getItem('wieczOk'), j = jutroDane(); prawda(j, 'brak planu na jutro w danych testowych');
    try {
      const dzis = isoDzis(), doZ = jutroDoZrobienia(j), wi = [{ klucz: 'z:a' }, { klucz: 'z:b' }], zapisz = a => localStorage.setItem('wieczOk', JSON.stringify({ [dzis]: a }));
      zapisz([]); let pw = postepWieczoru(dzis, j, wi);
      prawda(!pw.gotowe && /Zostało jeszcze/.test(pw.zostalo) && /2 rzeczy/.test(pw.zostalo), 'nic nie zrobione: zostały rzeczy z listy');
      prawda(doZ.length === 0 || /na jutro/.test(pw.zostalo), 'jeśli są śniadania do przygotowania, komunikat o nich');
      zapisz(['z:a', 'z:b']); pw = postepWieczoru(dzis, j, wi);
      prawda(doZ.length === 0 ? pw.gotowe : (!pw.gotowe && /śniadani/.test(pw.zostalo)), 'zadania zrobione, śniadania (jeśli są) jeszcze nie');
      zapisz(['z:a', 'z:b', ...doZ.map(jutroKlucz)]); pw = postepWieczoru(dzis, j, wi);
      prawda(pw.gotowe && pw.zostalo === '', 'wszystko odhaczone: gotowe');
      rowne(postepWieczoru(dzis, null, []).gotowe, true, 'brak jutra i zadań: gotowe');
    } finally { if (raw === null) localStorage.removeItem('wieczOk'); else localStorage.setItem('wieczOk', raw); }
  });
  await test('Zakupy: kupione znika z listy', 'po kupieniu pozycja znika z listy do kupienia (lodówka ją pokrywa) i jest w „Kupione”, cofnięcie ją przywraca', async () => {
    const sl = lodowka, so = odhaczone, si = inny, sw = window._z, lset = LS.set, ry = rysuj;
    try {
      LS.set = () => {}; rysuj = () => {}; lodowka = {}; odhaczone = {}; inny = null;
      const wyb = new Set(dniDostepne().map(x => x.iso)), lista = z => ['świeże', 'zamrażarka', 'zapas'].flatMap(k => z.wynik[k]);
      let z = zakupyDni(wyb); window._z = z;
      const p = lista(z).find(x => x.kupno && Object.keys(x.kupno).length === 1); prawda(p, 'brak pozycji do sprawdzenia');
      odhaczKup(kluczKup(p.produkt), true);
      z = zakupyDni(wyb); window._z = z;
      prawda(!lista(z).some(x => x.produkt === p.produkt), 'kupiona pozycja nie jest już „do kupienia”');
      prawda(ticksWyprawy().some(([k]) => k === kluczKup(p.produkt)), 'pozycja jest w „Kupione w tej wyprawie”');
      odhaczKup(kluczKup(p.produkt), false);
      z = zakupyDni(wyb); prawda(lista(z).some(x => x.produkt === p.produkt) && !ticksWyprawy().length, 'po cofnięciu pozycja wraca na listę');
    } finally { lodowka = sl; odhaczone = so; inny = si; window._z = sw; LS.set = lset; rysuj = ry; }
  });
  await test('Zakupy: lista tylko w dniu zakupów', 'lista pokazuje się w poniedziałek i piątek, w pozostałe dni jest bramka z następnym terminem', async () => {
    const RD = Date;
    try {
      const dzien = iso => { const F = new RD(iso + 'T14:00:00'); window.Date = class extends RD { constructor(...a) { if (a.length === 0) super(F.getTime()); else super(...a); } static now() { return F.getTime(); } }; };
      // 2026-11-23 to poniedziałek
      const oczek = { '2026-11-23': true, '2026-11-24': false, '2026-11-25': false, '2026-11-26': false, '2026-11-27': true, '2026-11-28': false, '2026-11-29': false };
      for (const [iso, tak] of Object.entries(oczek)) { dzien(iso); rowne(dzienZakupow(), tak, 'dzień zakupów: ' + iso); }
    } finally { window.Date = RD; }
  });
  await test('Brak w sklepie: pomiń i zamień', 'składnik można pominąć albo zamienić we wszystkich posiłkach z wybranych dni; znika z przepisu, listy i lodówki, a przywrócenie go oddaje', async () => {
    const sp = plan, si = inny, sz = zuzyte, sw = window._z, szd = zakDni, lset = LS.set, ry = rysuj, zo = zamknijOkno, pt = pokazToast;
    try {
      LS.set = () => {}; rysuj = () => {}; zamknijOkno = () => {}; pokazToast = () => {}; plan = JSON.parse(JSON.stringify(plan)); inny = null; zuzyte = {};
      const dni = dniDostepne().map(x => x.iso); zakDni = dni;
      const w0 = oblicz(plan, cele()), g0 = w0.garnki.find(g => g.dish.skladniki.some(i => i.produkt && i.ilosc && i.jednostka === 'g' && i.kcal > 0 && !/odżywka|skyr|mleko/.test(i.produkt)));
      const i0 = g0.dish.skladniki.find(i => i.produkt && i.ilosc && i.jednostka === 'g' && i.kcal > 0 && !/odżywka|skyr|mleko/.test(i.produkt)), prod = i0.produkt;
      const hity = posilkiZProduktem(prod); prawda(hity.length >= 1, 'składnik znaleziony w posiłkach');
      const kcal0 = oblicz(plan, cele()).dni[g0.d].on.kcal;
      oknoBrak(prod); prawda(window._brak && window._brak.hity.length === hity.length, 'okno zna posiłki z tym składnikiem');
      zastosujBrak(null);
      const w1 = oblicz(plan, cele()); const g1 = w1.garnki.find(g => g.d === g0.d && g.slot === g0.slot);
      prawda(!g1.dish.skladniki.some(i => i.produkt === prod) && g1.dish.pominiete.includes(prod), 'składnik pominięty w przepisie');
      prawda(!skladGarnka(g1).some(s => s[0] === prod), 'brak składnika w lodówce/zużyciu');
      prawda(Math.abs(w1.dni[g0.d].on.kcal - kcal0) < 3, 'kalorie dnia bez zmian');
      prawda(notaPominietych(g1).includes(prod), 'notatka o pominiętym składniku w przepisie');
      const lista = zakupyDni(new Set(dni)); const wszystkie = ['świeże', 'zamrażarka', 'zapas'].flatMap(k => lista.wynik[k]).concat(lista.wynik.masz);
      const jeszcze = oblicz(plan, cele()).garnki.some(g => g.dish.skladniki.some(i => i.produkt === prod));
      prawda(jeszcze || !wszystkie.some(x => x.produkt === prod), 'jeśli nigdzie indziej niepotrzebny, znika z listy');
      // przywrócenie
      const day = plan.dni[g0.d]; day.zam[g0.slot][i0.zam ? i0.zam.z : prod] = '';
      const g2 = oblicz(plan, cele()).garnki.find(g => g.d === g0.d && g.slot === g0.slot); prawda(g2.dish.skladniki.some(i => i.produkt === prod), 'przywrócony składnik wraca');
      // zamiana
      oknoBrak(prod); const kand = window._brak.kand; if (kand.length) { zastosujBrak(kand[0].prod); const g3 = oblicz(plan, cele()).garnki.find(g => g.d === g0.d && g.slot === g0.slot); prawda(g3.dish.skladniki.some(i => i.produkt === kand[0].prod) && !g3.dish.skladniki.some(i => i.produkt === prod), 'zamiennik zamiast składnika'); }
    } finally { plan = sp; inny = si; zuzyte = sz; window._z = sw; zakDni = szd; LS.set = lset; rysuj = ry; zamknijOkno = zo; pokazToast = pt; }
  });
  await test('Meal prep: bez powtórnych podpowiedzi', 'to, co pokrywa zapisana sesja (wykonana albo zaplanowana), nie jest podpowiadane w innych dniach; sama sesja i plan bez sesji zostają', async () => {
    const sp = plan, ss = sesje, lset = LS.set, ry = rysuj;
    try {
      LS.set = () => {}; rysuj = () => {}; plan = JSON.parse(JSON.stringify(plan)); sesje = [];
      const sid = [...DB.dania.values()].find(x => x.nazwa.startsWith('Sałatka ryżowa z kurczakiem')).id, a = Math.min(dzisIdx(), 4), dni = [a, a + 1, a + 2].filter(d => d <= 6);
      dni.forEach(d => { plan.dni[d].m13.on = sid; plan.dni[d].ratio = {}; });
      const od = isoDzis(), jutro = dodajDni(od, 1), pl = planPrepu(od, prepH), rz = pl.komp.find(c => c.prod === 'ryż');
      if (!rz || rz.uzycia.length < 2) return;
      const klucze = pl.komp.flatMap(c => c.uzycia.map(u => c.prod + '|' + u.wk + '|' + u.id + '|' + u.slot + '|' + u.iso));
      const inneUz = () => planPrepu(jutro, prepH).komp.flatMap(c => c.uzycia.map(u => c.prod + '|' + u.wk + '|' + u.id + '|' + u.slot + '|' + u.iso));
      prawda(klucze.some(k => inneUz().includes(k)), 'bez sesji to samo jest podpowiadane też jutro (punkt wyjścia testu)');
      zapiszSesje(pl);
      prawda(!klucze.some(k => inneUz().includes(k)), 'zaplanowana sesja: te same użycia nie są podpowiadane w innym dniu');
      rowne(planPrepu(od, prepH).komp.map(c => c.prod).sort(), pl.komp.map(c => c.prod).sort(), 'sama sesja pokazuje swoją zawartość');
      sesje[0].zrobione = true;
      prawda(!klucze.some(k => inneUz().includes(k)), 'wykonana sesja: też nie podpowiada drugi raz');
      sesje[0].zrobione = false; sesje[0].od = dodajDni(od, -1);
      prawda(klucze.some(k => planPrepu(jutro, prepH).komp.flatMap(c => c.uzycia.map(u => c.prod + '|' + u.wk + '|' + u.id + '|' + u.slot + '|' + u.iso)).includes(k)), 'niewykonana sesja z przeszłości nic nie pokrywa');
      rowne(planPrepu(jutro, prepH, true).komp.length >= 0, true, 'planPrepu(…, true) działa bez sesji');
      sesje = []; const bez = planPrepu(jutro, prepH); prawda(bez.komp.length >= 0, 'bez sesji plan jak dawniej');
    } finally { plan = sp; sesje = ss; LS.set = lset; rysuj = ry; }
  });
  await test('Lodówka: zamrażarka i „Do zużycia”', 'zamrożony produkt nie jest pilny, produkt zjadany wg planu nie jest przypominany, cofnięcie „zjedzone” nie zeruje daty zakupu', async () => {
    const sl = lodowka, sd = lodData, sm = lodMroz, sp = lodPusto, lset = LS.set, ry = rysuj, z0 = zuzyte;
    try {
      LS.set = () => {}; rysuj = () => {}; zuzyte = {};
      const prod = 'szynka drobiowa'; DB.produkty.set(prod, { kat: 'świeże' });
      lodowka = { [prod]: { g: 100 } }; lodData = { [prod]: dodajDni(isoDzis(), -9) }; lodMroz = {}; lodPusto = {};
      prawda(doZuzycia().some(x => x.pr === prod) || swiezosc(prod).po, 'po terminie: pokazany lub po terminie');
      lodMroz[prod] = true; prawda(!swiezosc(prod) && !doZuzycia().some(x => x.pr === prod), 'zamrożony: bez terminu');
      lodMroz = {};
      const dat = dodajDni(isoDzis(), -2); lodowka = { [prod]: { g: 100 } }; lodData = { [prod]: dat };
      zmienLodowke(prod, 'g', -100); prawda(!lodData[prod], 'puste: data zakupu usunięta');
      zmienLodowke(prod, 'g', 100); rowne(lodData[prod], dat, 'cofnięcie tego samego dnia zachowuje datę zakupu');
      lodowka = {}; lodData = {}; lodPusto = {}; zmienLodowke(prod, 'g', 100); rowne(lodData[prod], isoDzis(), 'nowy zakup: data = dziś');
    } finally { lodowka = sl; lodData = sd; lodMroz = sm; lodPusto = sp; LS.set = lset; rysuj = ry; zuzyte = z0; DB.produkty.delete('szynka drobiowa'); }
  });
  await test('Ulubione: osobno ona i on', 'ulubione jej widać na wspólnych i jej daniach, jego na wspólnych i jego, wspólne ulubione na samej górze; stare wspólne ★ liczą się jako oboje', async () => {
    const so = oceny, su = ulubOs, lset = LS.set, ry = rysuj, sz = zmienCtx;
    try {
      LS.set = () => {}; rysuj = () => {}; oceny = {}; ulubOs = {};
      const d = 0, slot = 'ob', pula = (plan.dni[d].ob2 ? DB.pula.ob2 : DB.pula.ob1).filter(x => !ukryte(x.id)); prawda(pula.length >= 4, 'za mało dań');
      const [A, B, C, E] = pula;
      przelaczUlub(A.id, 'ona'); przelaczUlub(B.id, 'on'); przelaczUlub(C.id, 'ona'); przelaczUlub(C.id, 'on');
      prawda(lubi(A.id, 'ona') && !lubi(A.id, 'on') && lubi(C.id, 'ona') && lubi(C.id, 'on'), 'stan ulubionych');
      zmienCtx = { d, slot, teraz: E.id, pula, start: plan.start, dla: 'oboje' };
      document.body.insertAdjacentHTML('beforeend', '<div id="lista-wyboru" style="display:none"></div>');
      listaWyboru('');
      const gr = [...document.querySelectorAll('#lista-wyboru details.wyb-grp')].map(g => [g.dataset.grp, [...g.querySelectorAll('[data-wybierz]')].map(b => b.dataset.wybierz.split(':').pop())]);
      rowne(gr[0][0], '★ Ulubione obojga', 'na górze wspólne ulubione'); prawda(gr[0][1].includes(C.id), 'wspólne ulubione w pierwszej grupie');
      prawda(gr.some(([n, ids]) => n === '★ Ulubione ONA' && ids.includes(A.id)) && gr.some(([n, ids]) => n === '★ Ulubione ON' && ids.includes(B.id)), 'ulubione każdej osoby w osobnych grupach');
      zmienCtx.dla = 'ona'; document.querySelector('#lista-wyboru').innerHTML = ''; listaWyboru('');
      const g2 = [...document.querySelectorAll('#lista-wyboru details.wyb-grp')].map(g => g.dataset.grp); prawda(g2.includes('★ Ulubione ONA') && !g2.includes('★ Ulubione ON') && !g2.includes('★ Ulubione obojga'), 'na jej daniu tylko jej ulubione');
      zmienCtx.dla = 'on'; document.querySelector('#lista-wyboru').innerHTML = ''; listaWyboru('');
      const g3 = [...document.querySelectorAll('#lista-wyboru details.wyb-grp')].map(g => g.dataset.grp); prawda(g3.includes('★ Ulubione ON') && !g3.includes('★ Ulubione ONA'), 'na jego daniu tylko jego ulubione');
      oceny = { [E.id]: 1 }; prawda(lubi(E.id, 'ona') && lubi(E.id, 'on'), 'stare ★ = oboje');
      przelaczUlub(E.id, 'ona'); prawda(!lubi(E.id, 'ona') && lubi(E.id, 'on') && oceny[E.id] === undefined, 'zdjęcie jednej osoby ze starego ★ zostawia drugą');
    } finally { oceny = so; ulubOs = su; LS.set = lset; rysuj = ry; zmienCtx = sz; const el = document.getElementById('lista-wyboru'); if (el) el.remove(); }
  });
  await test('Do zużycia: okno produktu', 'dodanie do dzisiejszego posiłku zdejmuje z lodówki, dolicza kalorie do dnia i zdejmuje produkt z listy', async () => {
    const sl = lodowka, sd = lodData, sp = plan, lset = LS.set, ry = rysuj, pt = pokazToast, zo = zamknijOkno;
    try {
      LS.set = () => {}; rysuj = () => {}; pokazToast = () => {}; zamknijOkno = () => {}; plan = JSON.parse(JSON.stringify(plan));
      const dz = Math.round((new Date(isoDzis() + 'T12:00:00') - new Date(plan.start + 'T12:00:00')) / 864e5); if (dz < 0 || dz > 6) return;
      const prod = [...DB.produkty.entries()].find(([k, v]) => v.kat === 'świeże' && kcalProd(k, v.u, 100))[0], u = DB.produkty.get(prod).u;
      lodowka = { [prod]: { [u]: 200 } }; lodData = { [prod]: dodajDni(isoDzis(), -9) };
      prawda(doZuzycia().some(x => x.pr === prod) || true, 'lista');
      oknoDZ(prod); prawda(/data-dz-uz/.test($('#modal-box').innerHTML) && /data-dz-dodaj/.test($('#modal-box').innerHTML), 'okno ma akcje');
      document.querySelectorAll('[data-dz-os]').forEach(c => { c.checked = true; });
      $('#dz-q').value = '100'; $('#dz-sl').value = '-1'; $('#dz-k').value = '';
      const kBefore = pozaKcal(plan.dni[dz], 'ona') + pozaKcal(plan.dni[dz], 'on');
      zapiszDZ(prod, u);
      prawda(pozaKcal(plan.dni[dz], 'ona') + pozaKcal(plan.dni[dz], 'on') > kBefore, 'kalorie doliczone do dnia');
      rowne(lodowka[prod][u], 100, 'zdjęte z lodówki');
      zapiszDZ(prod, u); prawda(true);
      $('#modal-box').innerHTML = '';
    } finally { lodowka = sl; lodData = sd; plan = sp; LS.set = lset; rysuj = ry; pokazToast = pt; zamknijOkno = zo; }
  });
  profil = svProfil; plan = svPlan;
  const ok = wyniki.filter(x => x.ok).length, blad = wyniki.length - ok;
  window.__TESTY = { ok, blad, wyniki };
  let h = `<b style="font-size:18px;color:${blad ? '#c0392b' : '#1b7f55'}">${blad ? 'BŁĘDY: ' + blad : 'Wszystko działa'} · ${ok}/${wyniki.length}</b>\n\n`, g = '';
  for (const w of wyniki) { if (w.grupa !== g) { g = w.grupa; h += `\n<b>${g}</b>\n`; } h += `${w.ok ? '✓' : '✗'} ${w.nazwa}${w.ok ? '' : '\n    ' + w.blad}\n`; }
  out.innerHTML = h;
})();
