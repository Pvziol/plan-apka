# -*- coding: utf-8 -*-
"""Wyciąga dania, koktajle, tygodnie wzorcowe, kategorie i opakowania z 4 PDF-ów do data/*.json.

Uruchom:  python tools/extract.py
Nic nie jest przepisywane ręcznie - jedyna ręczna część to tabela ALIASY (nazwa składnika -> produkt).
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data"
PDF1 = ROOT / "1-menu-zupy-i-dania-na-2-dni.pdf"
PDF2 = ROOT / "2-tydzien-A.pdf"
PDF3 = ROOT / "3-tydzien-B.pdf"
PDF4 = ROOT / "4-zakupy-i-przygotowanie.pdf"

DNI = ["PONIEDZIAŁEK", "WTOREK", "ŚRODA", "CZWARTEK", "PIĄTEK", "SOBOTA", "NIEDZIELA"]
DNI_KROTKO = dict(zip(DNI, ["pon", "wto", "sro", "czw", "pia", "sob", "nie"]))
RE_DZIEN = re.compile(r"^(%s) · tydzień ([AB])$" % "|".join(DNI))
RE_BAR = re.compile(r"^(11:00|13:00|17:00|~18:00|trening|wieczorem)\s+(.*)$")
RE_TYTUL = re.compile(
    r"^(?:OPCJA \d+: )?(?:(D\d) (?:· )?)?(.+?) · (\d+) kcal · (\d+) g białka(?: / os\.)?$"
)
FRAC = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3}
RE_QTY = re.compile(
    r"(\d+(?:,\d+)?[½¼¾⅓]?|[½¼¾⅓])\s*(łyżecz\.|łyż\.|szt\.|krom\.|pusz\.|ml|g|l)(?!\w)"
)
RE_GRUPA = re.compile(r"^([A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ ]+): (.+)$")

# nazwa składnika (regex, po małych literach) -> produkt kanoniczny do zakupów
ALIASY = [
    (r"^odżywka", "odżywka białkowa"),
    (r"^skyr", "skyr naturalny"),
    (r"^jogurt", "jogurt naturalny"),
    (r"^twaróg", "twaróg półtłusty"),
    (r"^(jaja|jajko)", "jaja"),
    (r"^mąka", "mąka pszenna"),
    (r"^(oliwa|olej)(?! sezam)", "oliwa / olej"),
    (r"^ser żółty", "ser żółty"),
    (r"^ziemniaki", "ziemniaki"),
    (r"^passata", "passata"),
    (r"^skrobia", "skrobia ziemniaczana"),
    (r"^ogórek kiszony", "ogórek kiszony"),
    (r"^ogórek", "ogórek świeży"),
    (r"^orzechy", "orzechy włoskie"),
    (r"^granola", "granola"),
    (r"^cebula czerwona", "cebula czerwona"),
    (r"^cebula", "cebula"),
    (r"^mrożone jagody", "jagody mrożone"),
    (r"^mrożone maliny", "maliny mrożone"),
    (r"^mrożone truskawki", "truskawki mrożone"),
    (r"^owoce mrożone", "owoce mrożone (mieszanka)"),
    (r"^papryka", "papryka"),
    (r"^pomidory świeże", "pomidory świeże"),
    (r"^pomidory krojone", "pomidory krojone (puszka)"),
    (r"^tuńczyk", "tuńczyk w sosie własnym (puszka 185 g)"),
    (r"^kukurydza", "kukurydza konserwowa"),
    (r"^ananas", "ananas z puszki (mała 230 g)"),
    (r"^chleb żytni", "chleb żytni"),
    (r"^paluszki rybne", "paluszki rybne"),
    (r"^bułka do burgera", "bułka do burgera (mrożona)"),
    (r"^łosoś", "łosoś filet"),
    (r"^rzodkiewka", "rzodkiewka (pęczek)"),
    (r"^zakwas na żurek", "zakwas na żurek"),
    (r"^zakwas na barszcz", "zakwas na barszcz biały"),
    (r"^ćwiartki", "ćwiartki / porcja rosołowa z kurczaka"),
    (r"^wołowina mielona", "wołowina mielona"),
    (r"^wołowina", "wołowina (pręga/łopatka)"),
    (r"^wieprzowina", "wieprzowina mielona (łopatka)"),
    (r"^kiełbasa biała", "kiełbasa biała"),
    (r"^makaron nitki", "makaron nitki"),
    (r"^pietruszka", "pietruszka (korzeń)"),
    (r"^jabłko", "jabłko"),
    (r"^owoce mrożone", "owoce mrożone (mieszanka)"),
]
# kategorie, których nie ma w pliku 4 pod tą nazwą (rozbicie "owoce mrożone" na rodzaje)
KAT_DODATKOWE = {
    "jagody mrożone": "zamrażarka",
    "maliny mrożone": "zamrażarka",
    "truskawki mrożone": "zamrażarka",
    "owoce mrożone (mieszanka)": "zamrażarka",
    "bułka do burgera (mrożona)": "zamrażarka",
    "łosoś filet": "zamrażarka",
    "paluszki rybne": "zamrażarka",
    "wołowina mielona": "zamrażarka",
}

log = []


def slug(s):
    s = s.lower().replace("ł", "l")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def num(s):
    """'9½' -> 9.5, '12,5' -> 12.5, '½' -> 0.5"""
    f = 0.0
    if s and s[-1] in FRAC:
        f = FRAC[s[-1]]
        s = s[:-1]
    v = float(s.replace(",", ".")) if s else 0.0
    return round(v + f, 3)


def depth_mask(s):
    d, out = 0, []
    for ch in s:
        if ch == "(":
            d += 1
        out.append(d)
        if ch == ")":
            d -= 1
    return out


def produkt(nazwa):
    n = nazwa.lower().strip()
    for rx, kan in ALIASY:
        if re.search(rx, n):
            return kan
    n = re.sub(r"\s*\([^)]*\)", "", n)  # bez dopisków w nawiasach
    return n.strip()


def parse_skladnik(tekst, kcal, bialko):
    tekst = " ".join(tekst.split())
    grupa = None
    m = RE_GRUPA.match(tekst)
    if m:
        grupa, tekst = m.group(1), m.group(2)
    mask = depth_mask(tekst)
    # uwaga po " — " na poziomie 0 nawiasów
    uwaga = None
    for mm in re.finditer(" — ", tekst):
        if mask[mm.start()] == 0:
            uwaga = tekst[mm.end():].strip()
            tekst = tekst[: mm.start()].strip()
            mask = mask[: len(tekst)]
            break
    top = [q for q in RE_QTY.finditer(tekst) if mask[q.start()] == 0]
    zlozony = " + " in tekst and len(top) > 1
    ilosc = jedn = None
    nazwa = tekst
    if top and not zlozony:
        q = top[-1]
        ilosc, jedn = num(q.group(1)), q.group(2)
        nazwa = tekst[: q.start()].strip()
    else:
        nazwa = re.sub(r"\s*\((dzielone równo)\)$", "", tekst)
    kc = int(kcal) if kcal and kcal.strip().isdigit() else 0
    b = re.match(r"(\d+)", bialko or "")
    return {
        "nazwa": nazwa,
        "produkt": produkt(nazwa),
        "ilosc": ilosc,
        "jednostka": jedn,
        "kcal": kc,
        "bialko": int(b.group(1)) if b else 0,
        "grupa": grupa,
        "uwaga": uwaga,
    }


def elementy(pdf):
    """Linie tekstu (poza tabelami) i tabele, w kolejności czytania, przez wszystkie strony."""
    for pno, page in enumerate(pdf.pages, 1):
        tabs = page.find_tables()
        boxes = [t.bbox for t in tabs]
        els = [(t.bbox[1], "table", t.extract()) for t in tabs]
        for l in page.extract_text_lines(return_chars=True):
            mid = (l["top"] + l["bottom"]) / 2
            if any(b[1] <= mid <= b[3] for b in boxes):
                continue
            txt = l["text"].strip()
            if re.match(r"^PLIK \d", txt) or re.search(r"· strona \d+ z \d+$", txt):
                continue
            c = l["chars"][0]
            els.append((l["top"], "line", {"text": txt, "size": c["size"], "font": c["fontname"]}))
        for _, kind, val in sorted(els, key=lambda e: e[0]):
            yield pno, kind, val


def kcal_bialko(t):
    m = re.search(r"(\d+) kcal, (\d+) g", t)
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


class Parser:
    def __init__(self):
        self.dania = {}      # klucz -> danie
        self.kolejnosc = []
        self.tygodnie = {}
        self.shake = None

    def run(self, path, plik, tydzien=None):
        self.plik, self.tydzien = plik, tydzien
        self.dzien = self.bar = self.sekcja = None
        self.tytul, self.czas, self.cur = [], [], None
        self.po_tytule = False
        if tydzien:
            self.tygodnie[tydzien] = {"bilans": {}, "dni": {}}
        with pdfplumber.open(path) as pdf:
            for pno, kind, val in elementy(pdf):
                self.pno = pno
                (self.line if kind == "line" else self.table)(val)
        self.close()

    # ---------- linie ----------
    def line(self, l):
        t = l["text"]
        bold, obl = "Bold" in l["font"], "Oblique" in l["font"]
        m = RE_DZIEN.match(t)
        if m:
            self.close()
            self.dzien, self.bar = m.group(1), None
            self.tygodnie[self.tydzien]["dni"][DNI_KROTKO[self.dzien]] = {"dzis": [], "wieczorem": []}
            return
        m = RE_BAR.match(t)
        if m and not bold and not obl and l["size"] > 10.1:
            self.close()
            self.bar = t
            self.tytul, self.czas, self.po_tytule = [], [], False
            return
        if bold and l["size"] > 12.5:
            self.close()
            self.tytul, self.czas, self.po_tytule = [], [], False
            if l["size"] >= 15:
                self.dzien = None if "ZAMIENNIKI" in t or "–" in t else self.dzien
                self.sekcja, self.bar = t, None
            return
        if bold and not t.startswith("UWAGA"):
            self.close()
            self.tytul.append(t)
            self.po_tytule = True
            return
        if obl and self.po_tytule:
            self.czas.append(t)
            return
        if self.cur is not None:
            self.cur["_post"].append(t)

    # ---------- tabele ----------
    def table(self, rows):
        rows = [[(c or "").strip() for c in r] for r in rows]
        if not rows:
            return
        first = " ".join(rows[0][0].split())
        if RE_BAR.match(first) and len([c for c in rows[0] if c]) == 1 and len(rows) > 1 and rows[1][0].startswith(("Składnik", "•", "KOSZYK", "ONA")):
            self.close()
            self.bar = first
            rows = rows[1:]
            first = " ".join(rows[0][0].split())
        if first.startswith("Składnik"):
            self.skladniki(rows)
            return
        self.tytul, self.czas, self.po_tytule = [], [], False
        if len(rows) == 1 and len(rows[0]) == 2 and rows[0][0].startswith("ONA"):
            self.podzial(rows[0])
        elif first == "DZIŚ" and self.dzien:
            d = self.tygodnie[self.tydzien]["dni"][DNI_KROTKO[self.dzien]]
            d["dzis"] = [" ".join(r[0].split()).lstrip("☐ ").strip() for r in rows[1:]]
            self.close()
        elif first.startswith("•") and self.dzien:
            d = self.tygodnie[self.tydzien]["dni"][DNI_KROTKO[self.dzien]]
            d["wieczorem"] += [" ".join(r[0].split()).lstrip("• ").strip() for r in rows]
            self.close()
        elif first == "Dzień" and len(rows[0]) == 5 and "ONA kcal" in rows[0][1]:
            for r in rows[1:]:
                self.tygodnie[self.tydzien]["bilans"][r[0]] = dict(zip(["ona_kcal", "ona_bialko", "on_kcal", "on_bialko"], r[1:]))
            self.close()
        else:
            self.close()

    def typ(self, naglowek):
        if "porcja dla niego" in naglowek:
            return "drugie_on", 1
        if "POŁOWA" in naglowek:
            return "koktajl_maly", 1
        if "cały kielich" in naglowek:
            return "koktajl", 2
        if "4 porcje" in naglowek:
            return ("obiad_zupa" if "zupa" in (self.sekcja or "") else "obiad_2dni"), 4
        bar = self.bar or ""
        if bar.startswith("11:00"):
            return "sniadanie", 2
        if bar.startswith("17:00"):
            return {"ŚRODA": "obiad_sroda", "SOBOTA": "obiad_sobota", "NIEDZIELA": "obiad_niedziela"}.get(self.dzien, "obiad"), 2
        log.append(f"!! nieznany typ: plik {self.plik} str. {self.pno} bar={bar!r}")
        return "inne", 2

    def skladniki(self, rows):
        self.close()
        naglowek = " ".join(rows[0][0].split())
        typ, porcje = self.typ(naglowek)
        d = {"typ": typ, "porcje": porcje, "kod": None, "skladniki": [], "przyprawy": [],
             "razem": None, "na_porcje": None, "warianty": [], "_post": [],
             "zrodlo": [f"plik {self.plik}, str. {self.pno}"], "podzial": {}}
        if typ.startswith("koktajl"):
            m = re.search(r"(K\d) (.+?)(?: \(mały koktajl\))?$", self.bar or "")
            d["kod"], d["nazwa"] = m.group(1), m.group(2)
            if typ == "koktajl_maly":
                d["nazwa"] += " (mały)"
            mm = re.search(r"~(\d+) g", naglowek)
            d["masa_g"] = int(mm.group(1)) if mm else None
            d["pora"] = (self.bar or "").split()[0]
        else:
            tyt = " ".join(self.tytul)
            m = RE_TYTUL.match(tyt)
            if not m:
                log.append(f"!! tytuł nie pasuje: {tyt!r} (plik {self.plik} str. {self.pno})")
                d["nazwa"] = tyt
            else:
                d["kod"], d["nazwa"] = m.group(1), m.group(2).lstrip("— ").strip()
                d["tytul_kcal"], d["tytul_bialko"] = int(m.group(3)), int(m.group(4))
            cz = " ".join(self.czas)
            m = re.match(r"^Czas: (.*?)(?: · Sprzęt: (.*))?$", cz)
            d["czas"], d["sprzet"] = (m.group(1), m.group(2)) if m else (None, None)
        self.tytul, self.czas, self.po_tytule = [], [], False
        tryb = "skl"
        for r in rows[1:]:
            cells = [c for c in r if c != ""]
            if not cells:
                continue
            name = " ".join(r[0].split())
            if name == "RAZEM":
                d["razem"] = {"kcal": int(r[-2]), "bialko": int(re.match(r"\d+", r[-1]).group())}
            elif name == "NA PORCJĘ" or name == "NA OSOBĘ":
                d["na_porcje"] = {"kcal": int(r[-2]), "bialko": int(re.match(r"\d+", r[-1]).group())}
            elif name == "Glazura":
                tryb = "war"
            elif tryb == "war":
                d["warianty"].append({"nazwa": name.replace("musztardo wa", "musztardowa"),
                                      "sklad": " ".join(cells[1].split()), "kcal_os": int(cells[-1])})
            elif r[-2] in ("—", ""):
                d["przyprawy"].append(name)
            else:
                d["skladniki"].append(parse_skladnik(name, r[-2], r[-1]))
        if d["na_porcje"] is None and d["razem"]:
            d["na_porcje"] = {"kcal": round(d["razem"]["kcal"] / porcje) if typ != "koktajl" else None,
                              "bialko": round(d["razem"]["bialko"] / porcje) if typ != "koktajl" else None}
        if self.tydzien and self.dzien:
            d["wystapienia"] = [f"{self.tydzien}:{DNI_KROTKO[self.dzien]}"]
        else:
            d["wystapienia"] = []
        self.cur = d

    def podzial(self, row):
        ona = " ".join(row[0].split())[4:].strip()
        on = " ".join(row[1].split())[3:].strip()
        if (self.bar or "").startswith("trening"):
            if not self.shake:
                def sh(t):
                    k, b = kcal_bialko(t)
                    o = re.search(r"odżywka białkowa (\d+) g", t)
                    ml = re.search(r"mleko 2% (\d+) ml", t)
                    return {"odzywka_g": int(o.group(1)), "mleko_ml": int(ml.group(1)), "kcal": k, "bialko": b}
                self.shake = {"ona": sh(ona), "on": sh(on)}
            self.close()
            return
        if self.cur is not None:
            p = {"ona": ona, "on": on}
            g = re.search(r"na wadze (\d+) g", ona)
            if g:
                p["ona_g"] = int(g.group(1))
            p["ona_kcal"], p["ona_bialko"] = kcal_bialko(ona)
            p["on_kcal"], p["on_bialko"] = kcal_bialko(on)
            if self.cur["typ"] == "koktajl":
                p["dosypka"] = "BEZ dosypki" not in on
                self.cur["podzial"] = {self.cur["pora"]: p}
            else:
                self.cur["podzial"] = p
        self.close()

    # ---------- domknięcie dania ----------
    def close(self):
        d, self.cur = self.cur, None
        if d is None:
            return
        kroki, odg, uw, tryb = [], [], [], "k"
        for t in d.pop("_post"):
            if t == "Wykonanie:":
                continue
            if t.startswith("Odgrzewanie (drugi dzień):"):
                tryb = "o"
                t = t.split(":", 1)[1].strip()
            elif t.startswith("UWAGA:"):
                tryb = "u"
                t = t.split(":", 1)[1].strip()
            m = re.match(r"^(\d+)\. (.*)$", t)
            if tryb == "k" and m and int(m.group(1)) == len(kroki) + 1:
                kroki.append(m.group(2))
            elif tryb == "k" and kroki:
                kroki[-1] += " " + t
            elif tryb == "o":
                odg.append(t)
            elif tryb == "u":
                uw.append(t)
        d["kroki"] = kroki
        d["odgrzewanie"] = " ".join(odg) or None
        d["uwaga"] = " ".join(uw) or None
        d["wieczorem"] = [k for k in kroki if k.startswith("WIECZOREM")]
        d["id"] = slug((d["kod"] + "-" if d["kod"] else "") + d["nazwa"])
        key = (d["typ"], d["id"])
        if key in self.dania:
            o = self.dania[key]
            if o["skladniki"] != d["skladniki"] or o["razem"] != d["razem"]:
                log.append(f"!! różne wersje dania {d['nazwa']}: {o['zrodlo'][0]} vs {d['zrodlo'][0]}")
            o["zrodlo"] += d["zrodlo"]
            o["wystapienia"] += d["wystapienia"]
            if d["typ"] == "koktajl":
                for pora, p in d["podzial"].items():
                    if pora in o["podzial"] and o["podzial"][pora] != p:
                        log.append(f"!! różny podział koktajlu {d['kod']} o {pora}")
                    o["podzial"][pora] = p
        else:
            self.dania[key] = d
            self.kolejnosc.append(key)


# ---------- plik 4: kategorie i opakowania ----------
def nazwa_z_listy(item):
    item = " ".join(item.split())
    item = re.sub(r"^(Z|P): ", "", item)
    mask = depth_mask(item)
    for m in re.finditer(r" (?=(\d|[½¼¾]|potrzeba))", item):
        if mask[m.start()] == 0 and not re.match(r" \d+%", item[m.start():]) and not re.match(r" 185 g", item[m.start():]):
            return item[: m.start()].strip()
    return item.strip()


def plik4():
    kategorie, opak, konflikty = {}, {}, []

    def dodaj(item, kat):
        item = " ".join(item.split())
        if not item or item.startswith("na niedzielę"):
            return
        prod = produkt(nazwa_z_listy(item))
        if prod in kategorie and kategorie[prod] != kat:
            konflikty.append(f"{prod}: {kategorie[prod]} / {kat}")
        kategorie.setdefault(prod, kat)
        m = re.search(r"→ (\d+)× (opak\.|karton|kubek|kostka|puszka|bloczek|butelka)(?: po)? (\d+)(?: ?(g|ml|l))?", item)
        if m:
            o = {"rodzaj": m.group(2), "wielkosc": int(m.group(3)), "jednostka": m.group(4) or "szt."}
            if o["jednostka"] == "l":
                o["wielkosc"], o["jednostka"] = o["wielkosc"] * 1000, "ml"
            szt = re.search(r"\(ok\. (\d+) szt\.\)", item)
            if szt:
                o["sztuk_ok"] = int(szt.group(1))
            if prod in opak and opak[prod] != o:
                konflikty.append(f"opakowanie {prod}: {opak[prod]} / {o}")
            opak.setdefault(prod, o)

    with pdfplumber.open(PDF4) as pdf:
        for page in pdf.pages:
            for t in page.extract_tables():
                if not t or not t[0]:
                    continue
                h = (t[0][0] or "").strip()
                if h in ("Świeże", "Zapas", "Zamrażarka"):
                    for r in t:
                        kat = {"Świeże": "świeże", "Zapas": "zapas", "Zamrażarka": "zamrażarka"}.get((r[0] or "").strip())
                        if kat:
                            for it in " ".join((r[1] or "").split()).split(" · "):
                                dodaj(it, kat)
                elif h == "Danie" and len(t[0]) == 3:
                    for r in t[1:]:
                        sw = (r[1] or "").split("\nalbo zamiast cebuli")[0]
                        for it in " ".join(sw.split()).split(" · "):
                            dodaj(it, "świeże")
                        zp = " ".join((r[2] or "").split())
                        mz = re.match(r"^Z: (.*?)(?: P: (.*))?$", zp)
                        if mz:
                            for it in mz.group(1).split(" · "):
                                dodaj(it, "zamrażarka")
                            for it in (mz.group(2) or "").split(" · "):
                                dodaj(it, "zapas")
    kategorie.update({k: v for k, v in KAT_DODATKOWE.items()})
    return kategorie, opak, konflikty


def main():
    p = Parser()
    p.run(PDF1, 1)
    p.run(PDF2, 2, "A")
    p.run(PDF3, 3, "B")
    kategorie, opak, konflikty = plik4()

    dania = [p.dania[k] for k in p.kolejnosc]
    bez_kat = set()
    for d in dania:
        for s in d["skladniki"]:
            if s["ilosc"] is None and (" + " in s["nazwa"] or s["nazwa"].startswith("GLAZURA")):
                s["produkt"], s["kategoria"] = None, "zapas"  # pozycja złożona - skład w nazwie / wariantach
                continue
            s["kategoria"] = kategorie.get(s["produkt"])
            if s["kategoria"] is None:
                bez_kat.add(s["produkt"])

    OUT.mkdir(parents=True, exist_ok=True)
    def zapis(nazwa, obj):
        (OUT / nazwa).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    zapis("dania.json", dania)
    zapis("tygodnie.json", p.tygodnie)
    zapis("shake.json", p.shake)
    zapis("kategorie.json", dict(sorted(kategorie.items())))
    zapis("opakowania.json", dict(sorted(opak.items())))

    # ---------- raport ----------
    print("=== DANIA PER TYP ===")
    typy = {}
    for d in dania:
        typy.setdefault(d["typ"], []).append(d)
    for t, ds in typy.items():
        print(f"\n[{t}] {len(ds)}")
        for d in ds:
            np_ = d["na_porcje"] or {}
            print(f"  {(d['kod'] or ''):3} {d['nazwa']}  | razem {d['razem']['kcal']} kcal / {d['razem']['bialko']} g"
                  f" | porcja {np_.get('kcal')} / {np_.get('bialko')} | skł. {len(d['skladniki'])} kroki {len(d['kroki'])}")

    print("\n=== TEST: suma kcal składników = RAZEM (±1) ===")
    zle_k, zle_b = [], []
    for d in dania:
        sk = sum(s["kcal"] for s in d["skladniki"])
        sb = sum(s["bialko"] for s in d["skladniki"])
        if abs(sk - d["razem"]["kcal"]) > 1:
            zle_k.append(f"{d['nazwa']}: składniki {sk} vs RAZEM {d['razem']['kcal']}")
        if abs(sb - d["razem"]["bialko"]) > 1:
            zle_b.append(f"{d['nazwa']}: {sb} vs {d['razem']['bialko']}")
        if d.get("tytul_kcal") and d["na_porcje"] and d["tytul_kcal"] != d["na_porcje"]["kcal"]:
            zle_k.append(f"{d['nazwa']}: tytuł {d['tytul_kcal']} vs tabela {d['na_porcje']['kcal']}")
    print(f"kcal: {len(dania) - len(zle_k)}/{len(dania)} OK")
    for z in zle_k:
        print("  NIE:", z)
    print(f"białko (informacyjnie, różnica >1 g): {len(zle_b)} dań")
    for z in zle_b:
        print("   ", z)

    print("\n=== SKŁADNIKI BEZ ILOŚCI (złożone / 'tylko dla niego') ===")
    for d in dania:
        for s in d["skladniki"]:
            if s["ilosc"] is None:
                print(f"  {d['nazwa']}: {s['nazwa']} ({s['kcal']} kcal)")
    print("\n=== PRODUKTY BEZ KATEGORII ===", sorted(bez_kat))
    print("=== KONFLIKTY PLIK 4 ===", konflikty)
    print("=== OPAKOWANIA ===")
    for k, v in sorted(opak.items()):
        print(f"  {k}: {v}")
    print("=== SHAKE ===", p.shake)
    print("=== TYGODNIE ===")
    for tyg, t in p.tygodnie.items():
        print(tyg, "bilans:", len(t["bilans"]), "wierszy; dni:", {k: (len(v["dzis"]), len(v["wieczorem"])) for k, v in t["dni"].items()})
    print("\n=== LOG ===")
    for l in log:
        print(l)
    print(f"\nprodukty: {len(kategorie)}, dania: {len(dania)}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
