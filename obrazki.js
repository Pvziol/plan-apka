'use strict';
/* Generowane ilustracje dań (SVG rysowany w kodzie). Kształt i kolory zależą od nazwy i typu dania,
   więc nowe dania z bazy dostają obrazek automatycznie. Żadnych plików ze zdjęciami. */
const Obr = (() => {
  const norm = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hash = s => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
  const pick = (n, tab, def) => { for (const [re, c] of tab) if (re.test(n)) return c; return def; };
  const dots = (pts, c, r = 2.2) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('');
  const OBR = '#0003';

  const szklanka = (n, h) => {
    const c = pick(n, [[/wisn|kakao/, '#7a4630'], [/jagod|borow/, '#6c4aa0'], [/malin/, '#d8466e'], [/truskaw/, '#ea6a80'], [/mango/, '#f5a82c'], [/jablk|cynam/, '#d8c47c'], [/banan|maslo/, '#dcbc80']], '#c9a0c0');
    const gran = /granol|owsian/.test(n) ? dots([[27, 25], [33, 23], [39, 26], [30, 28], [36, 29]], '#c98a3a', 2) : '';
    return `<path d="M19 11h26l-3 41a4 4 0 0 1-4 3H26a4 4 0 0 1-4-3z" fill="#fff" fill-opacity=".55" stroke="${OBR}"/>
      <path d="M20.3 22h23.4l-2 29.6a3 3 0 0 1-3 2.4H25.3a3 3 0 0 1-3-2.4z" fill="${c}"/>
      <ellipse cx="32" cy="22" rx="11.7" ry="2.4" fill="${c}"/><ellipse cx="32" cy="22" rx="11.7" ry="2.4" fill="#fff" fill-opacity=".25"/>${gran}
      <rect x="36" y="4" width="4" height="30" rx="2" fill="#e9e9e9" stroke="${OBR}" transform="rotate(12 38 19)"/>`;
  };

  const miska = (c, ozd, gorace) => `
    <path d="M9 30a23 23 0 0 0 46 0z" fill="#f6f2ea" stroke="${OBR}"/>
    <ellipse cx="32" cy="30" rx="23" ry="7" fill="#fff" stroke="${OBR}"/>
    <ellipse cx="32" cy="30" rx="19.5" ry="5.4" fill="${c}"/>${ozd}
    ${gorace ? `<g fill="none" stroke="${OBR}" stroke-width="2" stroke-linecap="round"><path d="M24 22q-3-4 0-8q3-4 0-7"/><path d="M33 22q-3-4 0-8q3-4 0-7"/><path d="M42 22q-3-4 0-8q3-4 0-7"/></g>` : ''}`;

  const zupa = n => {
    const c = pick(n, [[/pomidor/, '#d7472f'], [/papryk/, '#da4a2a'], [/ogork/, '#b4c47c'], [/dyni/, '#f0a232'], [/brokul/, '#74aa50'], [/szczaw/, '#a9b862'], [/rosol/, '#f1d27a'],
      [/zurek|barszcz/, '#eee4c0'], [/soczewic/, '#e9a352'], [/meksyk|chili/, '#b2432c'], [/cebul/, '#d9aa62'], [/curry/, '#e3a32f'], [/gulasz/, '#b5532f'], [/serow|gnocchi|zacierk/, '#f1dc96']], '#e7c27a');
    const dod = pick(n, [[/jajk/, dots([[26, 29.5], [38, 30.5]], '#fffaf0', 3) + dots([[26, 29.5], [38, 30.5]], '#f2b72c', 1.4)], [/kielbas/, dots([[25, 30], [32, 28.5], [39, 30.5]], '#a24b36', 2.4)],
      [/ryz|ziemniak|kasz|zacierk/, dots([[25, 30], [31, 28.5], [38, 30], [34, 31.5]], '#fbf7e8', 1.8)], [/krem/, '<path d="M24 30q8 -4 16 0" stroke="#fff" stroke-opacity=".7" fill="none" stroke-width="1.6"/>'],
      [/kurczak|indyk|mieso|mielon/, dots([[26, 30], [34, 28.8], [39, 31]], '#d9a66b', 2.4)]], dots([[27, 30], [37, 29]], '#7aa84a', 1.5));
    return miska(c, dod, true);
  };

  const miskaDeser = n => {
    const c = pick(n, [[/kakao|czekolad|snickers/, '#8a5a40'], [/kuskus|owsian|granol/, '#f3e5c3']], '#fbf8f0');
    const owoc = pick(n, [[/jagod/, '#4a4fa0'], [/malin/, '#d8466e'], [/truskaw/, '#e8506e'], [/jablk/, '#e3d08c']], '#d8466e');
    const dod = dots([[25, 29], [32, 27.8], [39, 29.5], [29, 31.5], [36, 31.4]], owoc, 2.2) + (/banan/.test(n) ? dots([[33, 29.5]], '#f4dc7c', 2.8) : '') + (/granol|owsian|orzech/.test(n) ? dots([[22, 30.5], [41, 31], [31, 30]], '#c98a3a', 1.5) : '');
    return miska(c, dod, false);
  };

  const salatka = n => miska('#7fb352', dots([[24, 29.5], [31, 27.8], [38, 29.2]], '#e0462f', 2.2) + dots([[28, 31.2], [35, 30.6], [41, 30.8]], /kukurydz/.test(n) ? '#f2c62c' : '#fffaf0', 1.9) + dots([[33, 29.8]], /tunczyk/.test(n) ? '#c68a73' : '#f0d58a', 2), false);

  const tosty = n => {
    const top = pick(n, [[/pasta|jajecz/, '#f2cf55'], [/tunczyk/, '#d8a58f'], [/awokado/, '#8ab84a'], [/losos/, '#f08a5d'], [/pizza|pomidor/, '#d7472f']], '#f2cf55');
    const sl = (x, y, r) => `<g transform="rotate(${r} ${x + 14} ${y + 14})"><rect x="${x}" y="${y}" width="28" height="28" rx="8" fill="#d9a65e"/><rect x="${x + 3}" y="${y + 3}" width="22" height="22" rx="5.5" fill="#f6e4b4"/>
      <ellipse cx="${x + 14}" cy="${y + 14}" rx="9" ry="7" fill="${top}"/><ellipse cx="${x + 10}" cy="${y + 12}" rx="3" ry="2" fill="#fff" fill-opacity=".35"/>${/szynk|zapiekank/.test(n) ? `<circle cx="${x + 17}" cy="${y + 16}" r="3.4" fill="#e89aa0"/>` : ''}</g>`;
    return sl(8, 22, -8) + sl(27, 14, 8);
  };

  const burger = () => `<path d="M10 30a22 15 0 0 1 44 0z" fill="#d9954a"/>${dots([[24, 21], [32, 18], [40, 21], [29, 25], [36, 25]], '#f6e4b4', 1.3)}
    <path d="M9 31h46l-3 3.5-4-2-4 2-4-2-4 2-4-2-4 2-4-2-4 2z" fill="#79b046"/><path d="M11 36h42l-2 4H13z" fill="#f2c230"/><rect x="10" y="34" width="44" height="6.5" rx="3" fill="#6b3e26" opacity=".95"/>
    <rect x="10" y="42" width="44" height="9" rx="4.5" fill="#d9954a"/>`;

  const wrap = n => `<g transform="rotate(-18 32 32)"><rect x="8" y="22" width="48" height="22" rx="11" fill="#e8c783" stroke="${OBR}"/>
    <ellipse cx="52" cy="33" rx="5.5" ry="10" fill="#f3dca4"/>${dots([[50, 29], [52, 34], [50, 37]], '#e0462f', 2)}${dots([[53, 31], [50, 33]], '#79b046', 2)}${dots([[52, 37]], '#f2cf55', 1.8)}</g>`;

  const pizza = () => `<circle cx="32" cy="32" r="24" fill="#dfa55a"/><circle cx="32" cy="32" r="20.5" fill="#f2c14e"/><circle cx="32" cy="32" r="20.5" fill="#d7472f" fill-opacity=".25"/>
    ${dots([[24, 24], [38, 25], [31, 34], [42, 38], [22, 40], [33, 45]], '#b8342a', 4.2)}${dots([[30, 26], [41, 32], [26, 34], [36, 42], [45, 26]], '#6fa84c', 1.8)}`;

  const talerz = tresc => `<circle cx="32" cy="33" r="25" fill="#fff" stroke="${OBR}"/><circle cx="32" cy="33" r="18.5" fill="none" stroke="${OBR}" stroke-opacity=".5"/>${tresc}`;

  const jajka = n => {
    const szak = /szakszuk|turecku/.test(n);
    return `<circle cx="32" cy="34" r="25" fill="#3a3d3b"/><circle cx="32" cy="34" r="21" fill="#4a4e4c"/>
      ${szak ? `<circle cx="32" cy="34" r="17" fill="#c8402b"/>${dots([[26, 30], [38, 33], [30, 40]], '#fffaf0', 6)}${dots([[26, 30], [38, 33], [30, 40]], '#f2b72c', 2.6)}`
        : `<path d="M16 34a16 14 0 0 1 32 0a16 12 0 0 1-32 0z" fill="#f4d442"/>${dots([[24, 31], [32, 28], [39, 33], [28, 37], [36, 38]], '#fbe784', 3.6)}${/szynk|feta|ser/.test(n) ? dots([[30, 33], [40, 36]], '#e89aa0', 2.4) : ''}${/szpinak|papryk/.test(n) ? dots([[26, 35], [35, 31]], '#5c9a3c', 1.9) : ''}`}`;
  };

  const makaron = n => /lasagne/.test(n)
    ? talerz(`<rect x="15" y="22" width="34" height="22" rx="3" fill="#f2dc96"/><rect x="15" y="26" width="34" height="4" fill="#c8402b"/><rect x="15" y="34" width="34" height="4" fill="#c8402b"/><rect x="15" y="22" width="34" height="5" rx="3" fill="#f2c230"/>`)
    : talerz(`<path d="M17 36q15-16 30 0q-15 10-30 0z" fill="#f0d38a"/><path d="M20 34q12-9 24 0M22 38q10-6 20 0" fill="none" stroke="#d8b560" stroke-width="1.5"/>
      <ellipse cx="32" cy="29" rx="8" ry="4.5" fill="${/pomidor|bolognese|spaghetti|zapiekank|tunczyk/.test(n) ? '#c8402b' : '#f8f3e4'}"/>${dots([[31, 28], [35, 30]], '#6fa84c', 1.6)}`);

  const ryba = n => {
    const f = /losos/.test(n) ? '#f08a5d' : /paluszk/.test(n) ? '#dca03c' : '#f4ecda';
    return talerz(`<g transform="rotate(-20 32 32)"><path d="M12 30q20-12 38 0q-3 8-19 9q-14 0-19-9z" fill="${f}"/>${/losos/.test(n) ? '<path d="M18 31q12-7 26 0M20 35q12-5 22 0" stroke="#fff" stroke-opacity=".5" fill="none" stroke-width="1.4"/>' : ''}</g>
      ${/frytk/.test(n) ? `<g stroke="#f1c84b" stroke-width="3.2" stroke-linecap="round"><path d="M38 44l8-6M42 46l7-5M34 47l9-5"/></g>` : dots([[24, 44], [31, 46], [38, 44]], '#f3e3a0', 3.6)}
      <circle cx="46" cy="24" r="5.5" fill="#f4e04a"/><path d="M46 18.5v11M40.5 24h11" stroke="#fff" stroke-opacity=".6"/>`);
  };

  const danie = n => {
    const bialko = pick(n, [[/kurczak|indyk|gyros|strogon|curry/, '#cd8f4e'], [/wolow|mielon|pulpet|kotlecik|poledwiczka|bolognese/, '#8c5a3a']], '#cd8f4e');
    const dod = pick(n, [[/ryz/, '#fdfdf6'], [/kasz|bulgur/, '#b88c58'], [/kuskus/, '#ead08e'], [/ziemniak|puree/, '#f4e4a2'], [/frytk/, '#f1c84b'], [/makaron/, '#f0d38a']], '#fdfdf6');
    const frytki = /frytk/.test(n);
    return talerz(`<path d="M14 26q4-10 15-8q7 3 4 12q-4 8-13 6q-7-2-6-10z" fill="${bialko}"/><path d="M19 24q5-3 9 0" stroke="#fff" stroke-opacity=".3" fill="none" stroke-width="1.5"/>
      ${frytki ? `<g stroke="${dod}" stroke-width="3.4" stroke-linecap="round"><path d="M38 40l9-9M42 43l8-7M34 44l9-9M45 28l5 5"/></g>` : dots([[40, 28], [45, 33], [38, 34], [43, 39], [36, 40]], dod, 3.6)}
      <path d="M17 40q6-5 11 0q-1 7-8 6q-4-1-3-6z" fill="#6fae4f"/>${dots([[25, 43]], '#e0462f', 2.6)}`);
  };

  function rysuj(d) {
    const n = norm(d.nazwa), typ = d.typ || '';
    let t;
    if (typ === 'koktajl' || typ === 'koktajl_maly') t = szklanka(n);
    else if (/pizza/.test(n)) t = pizza();
    else if (/burger/.test(n)) t = burger();
    else if (/wrap|tortill|kebab|fajitas/.test(n)) t = wrap(n);
    else if (typ === 'obiad_zupa' || /zupa|krem|rosol|chili|gulasz|curry/.test(n) && !/ryz/.test(n) && !/curry z kurczaka/.test(n)) t = zupa(n);
    else if (/salatk/.test(n) && !/makaron/.test(n)) t = salatka(n);
    else if (/jajecznic|omlet|szakszuk|frittat|jajka po/.test(n)) t = jajka(n);
    else if (/kanapk|tost|zapiekanki z|pieczywo|bulka|bulce/.test(n)) t = tosty(n);
    else if (/owsiank|skyr|kuskus na|pudding|miska skyru|placki|serek/.test(n)) t = miskaDeser(n);
    else if (/makaron|spaghetti|lasagne|zapiekanka makaronowa/.test(n)) t = makaron(n);
    else if (/losos|dorsz|ryb|paluszki/.test(n)) t = ryba(n);
    else if (/miska z/.test(n)) t = miska('#fdfdf6', dots([[25, 29], [33, 28], [40, 30]], '#f08a5d', 3) + dots([[30, 31]], '#8ab84a', 2.6), false);
    else t = danie(n);
    const tlo = `hsl(${hash(d.id || d.nazwa) % 360} 55% 62% / .28)`;
    return `<svg viewBox="0 0 64 64" role="img" aria-label="${(d.nazwa || '').replace(/"/g, '')}" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="14" fill="${tlo}"/>${t}</svg>`;
  }
  const cache = new Map();
  return {
    svg(d) { if (!cache.has(d.id)) cache.set(d.id, rysuj(d)); return cache.get(d.id); },
    html(d, klasa = '') { return `<span class="obr ${klasa}">${this.svg(d)}</span>`; }
  };
})();
