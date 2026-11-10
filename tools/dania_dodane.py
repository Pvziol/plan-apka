# -*- coding: utf-8 -*-
"""Dania dopisane do bazy (poza 4 PDF-ami). Uruchom:  python tools/dania_dodane.py

Jak dodać danie: dopisz wpis do listy DANIA niżej i uruchom skrypt. Kcal i białko liczą się same:
- produkty znane z PDF-ów mają wartości wyliczone z PDF-ów (żeby zgadzały się z planem),
- nowe produkty dopisujesz do NOWE_PRODUKTY (wartości z typowej etykiety / tabel).
Wynik: app/data/dania-dodane.json — w aplikacji wystarczy odświeżyć.
"""
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "data"

# produkt: (jednostka, kcal na jednostkę, białko na jednostkę, kategoria)
NOWE_PRODUKTY = {
    "kuskus": ("g", 3.6, 0.12, "zapas"),
    "kasza bulgur": ("g", 3.4, 0.12, "zapas"),
    "soczewica czerwona": ("g", 3.4, 0.25, "zapas"),
    "ciecierzyca z puszki (odsączona)": ("g", 1.3, 0.07, "zapas"),
    "fasola czerwona z puszki (odsączona)": ("g", 1.1, 0.075, "zapas"),
    "tortilla pełnoziarnista": ("szt.", 180, 5, "świeże"),
    "serek wiejski": ("g", 0.97, 0.11, "świeże"),
    "feta": ("g", 2.6, 0.14, "świeże"),
    "łosoś wędzony": ("g", 1.7, 0.21, "świeże"),
    "cukinia": ("szt.", 50, 3.5, "świeże"),
    "polędwiczka wieprzowa": ("g", 1.2, 0.21, "zamrażarka"),
    "dorsz filet": ("g", 0.8, 0.18, "zamrażarka"),
    "filet z indyka": ("g", 1.05, 0.24, "zamrażarka"),
    "mango mrożone": ("g", 0.6, 0.007, "zamrażarka"),
    "wiśnie mrożone": ("g", 0.5, 0.01, "zamrażarka"),
}

# (nazwa produktu, ilość, jednostka[, grupa])
S, D, O, O2, Z, K, KM = "sniadanie", "drugie_on", "obiad", "obiad_2dni", "obiad_zupa", "koktajl", "koktajl_maly"
DANIA = [
    # ---------------- ŚNIADANIA (na 2 osoby) ----------------
    dict(typ=S, nazwa="Kuskus na słodko ze skyrem, jabłkiem i orzechami", czas="10 min", sprzet="miska, czajnik",
         skl=[("kuskus", 120, "g"), ("mleko 2%", 100, "ml"), ("skyr naturalny", 300, "g"), ("odżywka białkowa", 30, "g"),
              ("jabłko", 1, "szt."), ("orzechy włoskie", 30, "g"), ("miód", 1, "łyż.")],
         przyprawy=["cynamon, szczypta soli"],
         kroki=["Kuskus (120 g) wsyp do miski ze szczyptą soli, zalej 100 ml gorącego mleka i 100 ml wrzątku. Przykryj talerzem na 5 min, potem rozdrobnij widelcem.",
                "Skyr (300 g) wymieszaj z odżywką (30 g) i miodem na gładki krem.",
                "Jabłko pokrój w kostkę, orzechy posiekaj.",
                "Do dwóch misek: kuskus, krem ze skyru, jabłko i orzechy. Posyp cynamonem."]),
    dict(typ=S, nazwa="Pudding kuskusowy z granolą i truskawkami", czas="5 min wieczorem + 2 min rano", sprzet="2 słoiki ~500 ml",
         skl=[("kuskus", 100, "g"), ("mleko 2%", 250, "ml"), ("skyr naturalny", 250, "g"), ("odżywka białkowa", 30, "g"),
              ("granola", 60, "g"), ("truskawki mrożone", 150, "g"), ("miód", 1, "łyż.")],
         kroki=["WIECZOREM: do każdego słoika wsyp 50 g kuskusu, wlej 125 ml mleka i dodaj 125 g skyru. Wymieszaj, zakręć i wstaw do lodówki — kuskus napęcznieje na zimno.",
                "WIECZOREM: odsyp 150 g mrożonych truskawek do miseczki i wstaw do lodówki.",
                "RANO: do każdego słoika dosyp 15 g odżywki i ½ łyżki miodu, wymieszaj 30 s.",
                "Na wierzch po 75 g truskawek i po 30 g granoli (granolę dosyp tuż przed jedzeniem)."]),
    dict(typ=S, nazwa="Miska skyru z granolą, bananem i malinami", czas="5 min", sprzet="2 miski",
         skl=[("skyr naturalny", 600, "g"), ("odżywka białkowa", 15, "g"), ("granola", 100, "g"), ("banan", 1, "szt."),
              ("maliny mrożone", 150, "g"), ("masło orzechowe", 20, "g")],
         kroki=["WIECZOREM: odsyp 150 g mrożonych malin do miseczki i wstaw do lodówki.",
                "Skyr (600 g) wymieszaj z odżywką (15 g) i rozłóż do 2 misek.",
                "Banana pokrój w plasterki. Na skyr połóż banana, maliny i po 10 g masła orzechowego.",
                "Granolę (po 50 g) dosyp tuż przed jedzeniem, żeby została chrupiąca."]),
    dict(typ=S, nazwa="Omlet ze szpinakiem i fetą + chleb", czas="15 min", sprzet="patelnia nieprzywierająca z pokrywką, miska",
         skl=[("jaja", 6, "szt."), ("szpinak świeży", 100, "g"), ("feta", 60, "g"), ("szynka z indyka", 80, "g"),
              ("oliwa / olej", 0.5, "łyż."), ("chleb żytni", 4, "krom."), ("pomidorki koktajlowe", 10, "szt.")],
         przyprawy=["czosnek 1 ząbek, sól, pieprz"],
         kroki=["Szynkę (80 g) pokrój w paski, fetę (60 g) pokrusz, pomidorki przekrój na pół.",
                "Na patelni rozgrzej ½ łyżki oliwy. Wrzuć szpinak (100 g) z przeciśniętym ząbkiem czosnku i smaż 1–2 min, aż zwiędnie. Dodaj szynkę.",
                "6 jaj roztrzep z solą i pieprzem, wylej na patelnię. Smaż pod przykryciem na małym ogniu 5–6 min, aż wierzch się zetnie.",
                "Posyp fetą, złóż na pół i podziel na 2 części. Podaj z chlebem i pomidorkami."]),
    dict(typ=S, nazwa="Tortilla śniadaniowa z jajecznicą, szynką i serem", czas="15 min", sprzet="patelnia, miska",
         skl=[("tortilla pełnoziarnista", 2, "szt."), ("jaja", 5, "szt."), ("szynka z indyka", 80, "g"), ("ser żółty", 40, "g"),
              ("papryka", 1, "szt."), ("pomidor", 1, "szt."), ("oliwa / olej", 0.5, "łyż.")],
         przyprawy=["szczypiorek, sól, pieprz"],
         kroki=["Paprykę i szynkę (80 g) pokrój w kostkę, pomidora w plasterki. Ser (40 g) zetrzyj.",
                "Na patelni rozgrzej ½ łyżki oliwy, podsmaż paprykę i szynkę 3 min.",
                "Wlej 5 roztrzepanych jaj z solą i pieprzem. Mieszaj szpatułką 2–3 min, zdejmij, gdy jajecznica jest jeszcze lekko wilgotna.",
                "Tortille podgrzej 20 s na suchej patelni. Na każdą połóż połowę jajecznicy, ser, pomidora i szczypiorek, zwiń ciasno."]),
    dict(typ=S, nazwa="Serek wiejski z jajkiem, awokado i chlebem", czas="10 min (jajka z wieczora)", sprzet="garnek, 2 talerze",
         skl=[("serek wiejski", 400, "g"), ("jaja", 2, "szt."), ("chleb żytni", 4, "krom."), ("awokado", 1, "szt."),
              ("rzodkiewka (pęczek)", 10, "szt."), ("ogórek świeży", 1, "szt."), ("pomidor", 1, "szt.")],
         przyprawy=["szczypiorek, sól, pieprz"],
         kroki=["WIECZOREM: 2 jaja ugotuj na twardo (9 min od wrzenia), schłodź w zimnej wodzie.",
                "Rzodkiewki i ogórka pokrój w drobną kostkę, wymieszaj z serkiem wiejskim (400 g), szczypiorkiem, solą i pieprzem.",
                "Awokado i pomidora pokrój w plastry, jajka w ćwiartki.",
                "Na 2 talerze: serek z warzywami, jajko, awokado, pomidor i po 2 kromki chleba."]),
    dict(typ=S, nazwa="Kanapki z wędzonym łososiem, twarożkiem i jajkiem", czas="10 min (jajka z wieczora)", sprzet="garnek, miska",
         skl=[("chleb żytni", 4, "krom."), ("twaróg półtłusty", 150, "g"), ("skyr naturalny", 60, "g"), ("łosoś wędzony", 100, "g"),
              ("jaja", 2, "szt."), ("awokado", 1, "szt."), ("ogórek świeży", 1, "szt.")],
         przyprawy=["koperek, sok z cytryny, pieprz"],
         kroki=["WIECZOREM: 2 jaja ugotuj na twardo (9 min od wrzenia), schłodź i obierz.",
                "Twaróg (150 g) rozgnieć widelcem ze skyrem (60 g), koperkiem i pieprzem na pastę.",
                "Na każdą z 4 kromek: pasta, 25 g łososia, plastry ogórka. Skrop sokiem z cytryny.",
                "Obok podaj jajko w ćwiartkach i awokado w plastrach (po ½ na osobę)."]),
    dict(typ=S, nazwa="Placki owsiano-bananowe ze skyrem i jagodami", czas="20 min", sprzet="blender lub widelec, patelnia nieprzywierająca",
         skl=[("płatki owsiane", 120, "g"), ("jaja", 3, "szt."), ("banan", 2, "szt."), ("oliwa / olej", 0.5, "łyż."),
              ("skyr naturalny", 250, "g", "KREM"), ("odżywka białkowa", 20, "g"), ("jagody mrożone", 100, "g")],
         przyprawy=["cynamon, szczypta soli"],
         kroki=["WIECZOREM: odsyp 100 g mrożonych jagód do miseczki i wstaw do lodówki.",
                "Płatki (120 g), 3 jaja, 2 banany, cynamon i szczyptę soli zblenduj na gęste ciasto (albo rozgnieć banany widelcem i wymieszaj). Odstaw na 5 min.",
                "Patelnię posmaruj cienko oliwą. Smaż małe placki (po 1 łyżce ciasta) 2 min z każdej strony na średnim ogniu.",
                "KREM: 250 g skyru wymieszaj z 20 g odżywki. Placki podaj z kremem i jagodami."]),

    # ---------------- JEGO DRUGIE ŚNIADANIA (1 porcja) ----------------
    dict(typ=D, kod="D8", nazwa="Sałatka z kuskusem, kurczakiem i fetą", czas="15 min wieczorem", sprzet="miska, patelnia lub airfryer, pojemnik",
         skl=[("kuskus", 50, "g"), ("pierś z kurczaka", 120, "g"), ("feta", 30, "g"), ("ogórek świeży", 1, "szt."),
              ("pomidorki koktajlowe", 5, "szt."), ("oliwa / olej", 0.5, "łyż.")],
         przyprawy=["sok z cytryny, papryka słodka, sól, pieprz"],
         kroki=["WIECZOREM: kuskus (50 g) zalej 80 ml wrzątku ze szczyptą soli, przykryj na 5 min i rozdrobnij widelcem.",
                "WIECZOREM: kurczaka (120 g) pokrój w paski, dopraw solą, pieprzem i papryką. Usmaż na suchej patelni 6–7 min (albo airfryer 190°C 10 min). Ostudź.",
                "Ogórka pokrój w kostkę, pomidorki na pół, fetę (30 g) pokrusz.",
                "Wymieszaj wszystko z ½ łyżki oliwy i łyżką soku z cytryny. Przełóż do pojemnika."]),
    dict(typ=D, kod="D9", nazwa="Wrap z kurczakiem, serem i warzywami", czas="15 min", sprzet="patelnia lub airfryer, folia",
         skl=[("tortilla pełnoziarnista", 1, "szt."), ("pierś z kurczaka", 120, "g"), ("ser żółty", 20, "g"), ("skyr naturalny", 40, "g"),
              ("papryka", 0.5, "szt."), ("sałata", 25, "g"), ("kukurydza konserwowa", 40, "g")],
         przyprawy=["czosnek, papryka słodka, sól, pieprz"],
         kroki=["WIECZOREM: kurczaka (120 g) pokrój w paski, dopraw solą, pieprzem i papryką. Usmaż na suchej patelni 6–7 min. Ostudź.",
                "Skyr (40 g) wymieszaj z odrobiną czosnku i solą — to sos.",
                "Tortillę posmaruj sosem. Ułóż sałatę, kurczaka, paprykę w paskach, kukurydzę (40 g) i starty ser (20 g).",
                "Zwiń ciasno, zawiń w folię. Do pracy bierzesz w całości."]),
    dict(typ=D, kod="D10", nazwa="Skyr z granolą, malinami i orzechami", czas="3 min", sprzet="pojemnik z pokrywką, mały woreczek",
         skl=[("skyr naturalny", 300, "g"), ("odżywka białkowa", 10, "g"), ("granola", 40, "g"), ("maliny mrożone", 100, "g"), ("orzechy włoskie", 10, "g")],
         kroki=["Do pojemnika daj 300 g skyru i 10 g odżywki, wymieszaj 30 s.",
                "Na wierzch wsyp 100 g mrożonych malin — rozmrożą się do południa.",
                "Granolę (40 g) i orzechy (10 g) weź w osobnym woreczku i dosyp tuż przed jedzeniem."]),
    dict(typ=D, kod="D11", nazwa="Sałatka z ciecierzycą i tuńczykiem", czas="5 min", sprzet="sitko, pojemnik",
         skl=[("ciecierzyca z puszki (odsączona)", 120, "g"), ("tuńczyk w sosie własnym (puszka 185 g)", 1, "pusz."), ("papryka", 0.5, "szt."),
              ("ogórek kiszony", 2, "szt."), ("oliwa / olej", 0.5, "łyż."), ("chleb żytni", 1, "krom.")],
         przyprawy=["sok z cytryny, natka, pieprz"],
         kroki=["Ciecierzycę (120 g) i tuńczyka odsącz na sitku.",
                "Paprykę i 2 ogórki kiszone pokrój w kostkę.",
                "Wymieszaj wszystko z ½ łyżki oliwy, łyżką soku z cytryny i pieprzem. Przełóż do pojemnika, kromkę chleba weź osobno."]),
    dict(typ=D, kod="D12", nazwa="Serek wiejski z szynką, pieczywem chrupkim i orzechami", czas="3 min", sprzet="—",
         skl=[("serek wiejski", 200, "g"), ("szynka z indyka", 80, "g"), ("pieczywo chrupkie", 4, "szt."),
              ("pomidorki koktajlowe", 5, "szt."), ("orzechy włoskie", 8, "g")],
         kroki=["Serek wiejski (200 g) weź w oryginalnym kubku albo przełóż do pojemnika, dodaj pieprz.",
                "Na pieczywo chrupkie nakładasz serek i szynkę (80 g) na miejscu — inaczej zmięknie.",
                "Pomidorki i orzechy (8 g) zjadasz obok."]),
    dict(typ=D, kod="D13", nazwa="Sałatka ryżowa z kurczakiem i kukurydzą", czas="20 min wieczorem", sprzet="garnek, patelnia lub airfryer, pojemnik",
         skl=[("ryż", 50, "g"), ("pierś z kurczaka", 130, "g"), ("kukurydza konserwowa", 60, "g"), ("papryka", 0.5, "szt."),
              ("ser żółty", 15, "g"), ("skyr naturalny", 50, "g", "DRESSING"), ("musztarda", 1, "łyżecz.")],
         przyprawy=["papryka słodka, sól, pieprz"],
         kroki=["WIECZOREM: ryż (50 g) ugotuj w osolonej wodzie wg opakowania, odcedź i ostudź.",
                "WIECZOREM: kurczaka (130 g) pokrój w kostkę, dopraw solą, pieprzem i papryką. Usmaż na suchej patelni 6–7 min. Ostudź.",
                "Paprykę i ser (15 g) pokrój w kostkę, kukurydzę (60 g) odsącz.",
                "DRESSING: 50 g skyru z 1 łyżeczką musztardy, solą i pieprzem. Wymieszaj wszystko i przełóż do pojemnika."]),

    # ---------------- OBIADY NA 1 DZIEŃ (na 2 osoby) ----------------
    dict(typ=O, nazwa="Kurczak z kuskusem, pieczonymi warzywami i fetą", czas="30 min", sprzet="airfryer lub piekarnik, miska",
         skl=[("pierś z kurczaka", 360, "g"), ("kuskus", 120, "g"), ("cukinia", 1, "szt."), ("papryka", 1, "szt."),
              ("oliwa / olej", 1.5, "łyż."), ("feta", 40, "g")],
         przyprawy=["czosnek 2 ząbki, oregano, papryka wędzona, sok z cytryny, sól, pieprz"],
         kroki=["Kurczaka (360 g) pokrój w kostkę 2–3 cm. Wymieszaj z ½ łyżki oliwy, czosnkiem, papryką wędzoną, solą i pieprzem.",
                "Cukinię i paprykę pokrój w kostkę 2 cm, wymieszaj z 1 łyżką oliwy, oregano i solą.",
                "Airfryer 200°C: warzywa 12–15 min, potem kurczak 12 min (albo wszystko na jednej blasze w piekarniku 200°C, 20–25 min).",
                "Kuskus (120 g) zalej 200 ml wrzątku ze szczyptą soli, przykryj na 5 min, rozdrobnij widelcem.",
                "Na talerze: kuskus, warzywa, kurczak. Posyp pokruszoną fetą (40 g) i skrop sokiem z cytryny."]),
    dict(typ=O, nazwa="Dorsz pieczony z ziemniakami i surówką z marchwi", czas="35 min (dorsza rozmroź dzień wcześniej w lodówce)", sprzet="airfryer lub piekarnik, garnek, tarka",
         skl=[("dorsz filet", 400, "g"), ("ziemniaki", 600, "g"), ("masło", 2, "łyżecz."), ("oliwa / olej", 1, "łyż."),
              ("marchew", 2, "szt.", "SURÓWKA"), ("ogórek kiszony", 2, "szt."), ("jogurt naturalny", 100, "g")],
         przyprawy=["koperek, sok z cytryny, czosnek, sól, pieprz"],
         kroki=["Ziemniaki (600 g) obierz i ugotuj w osolonej wodzie 20 min. Odcedź, dodaj 2 łyżeczki masła i koperek.",
                "Dorsza (400 g) osusz ręcznikiem, podziel na 2 porcje. Natrzyj 1 łyżką oliwy, solą, pieprzem i sokiem z cytryny.",
                "Airfryer 180°C, 10–12 min (albo piekarnik 200°C, 15 min). Gotowy, gdy rozchodzi się widelcem na płatki.",
                "SURÓWKA: 2 marchewki zetrzyj na drobnej tarce, dodaj 2 ogórki kiszone w kostce, 100 g jogurtu, sól i pieprz."]),
    dict(typ=O, nazwa="Polędwiczka wieprzowa w sosie musztardowym z kaszą", czas="35 min (mięso rozmroź dzień wcześniej w lodówce)", sprzet="patelnia z pokrywką, garnek",
         skl=[("polędwiczka wieprzowa", 360, "g"), ("kasza gryczana", 120, "g"), ("pieczarki", 250, "g"), ("cebula", 1, "szt."),
              ("oliwa / olej", 1, "łyż."), ("śmietana 12%", 100, "g", "SOS"), ("musztarda", 2, "łyżecz.")],
         przyprawy=["majeranek, natka, sól, pieprz"],
         kroki=["KASZA: 120 g wsyp do 300 ml wrzącej osolonej wody, gotuj pod przykryciem 15 min, odstaw na 5 min.",
                "Polędwiczkę (360 g) pokrój w plastry 1,5 cm, lekko rozbij dłonią, dopraw solą, pieprzem i majerankiem.",
                "Na mocnym ogniu rozgrzej 1 łyżkę oliwy. Smaż mięso po 2 min z każdej strony, odłóż na talerz.",
                "Na tej samej patelni smaż cebulę (lub por dla niej) 3 min, dodaj pieczarki (250 g) w plastrach i smaż 6–7 min, aż odparują.",
                "Wlej 100 ml wody, włóż mięso i duś 5 min. ZDEJMIJ Z OGNIA: śmietanę (100 g) z 2 łyżeczkami musztardy zahartuj 3 łyżkami sosu i wlej na patelnię. Posyp natką."],
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),
    dict(typ=O, nazwa="Makaron z kurczakiem i szpinakiem w sosie śmietanowym", czas="25 min", sprzet="duża patelnia, garnek",
         skl=[("makaron pszenny", 140, "g"), ("pierś z kurczaka", 320, "g"), ("szpinak świeży", 150, "g"), ("śmietana 12%", 100, "g"),
              ("parmezan", 20, "g"), ("oliwa / olej", 1, "łyż.")],
         przyprawy=["czosnek 3 ząbki, gałka muszkatołowa, sól, pieprz"],
         kroki=["Makaron (140 g) ugotuj al dente w osolonej wodzie. Przed odcedzeniem odlej pół szklanki wody z gotowania.",
                "Kurczaka (320 g) pokrój w paski, dopraw solą i pieprzem. Na mocnym ogniu rozgrzej 1 łyżkę oliwy i smaż 5–6 min.",
                "Dodaj 3 przeciśnięte ząbki czosnku na 30 s, potem szpinak (150 g) — mieszaj 1–2 min, aż zwiędnie.",
                "Zdejmij z ognia. Śmietanę (100 g) zahartuj 3 łyżkami wody z makaronu i wlej na patelnię ze szczyptą gałki.",
                "Wmieszaj makaron, w razie potrzeby rozrzedź wodą z gotowania. Posyp parmezanem (20 g)."]),
    dict(typ=O, nazwa="Chili z indykiem, fasolą i ryżem", czas="35 min", sprzet="garnek z grubym dnem, garnek na ryż",
         skl=[("indyk mielony", 320, "g"), ("fasola czerwona z puszki (odsączona)", 240, "g"), ("pomidory krojone (puszka)", 400, "g"),
              ("ryż", 100, "g"), ("papryka", 1, "szt."), ("cebula", 1, "szt."), ("oliwa / olej", 0.5, "łyż.")],
         przyprawy=["czosnek 2 ząbki, kmin, papryka słodka i wędzona, chili (dla niej mniej), sól"],
         kroki=["RYŻ: 100 g ugotuj w osolonej wodzie wg opakowania.",
                "W garnku rozgrzej ½ łyżki oliwy. Smaż cebulę (lub por) i paprykę w kostce 4 min, dodaj czosnek na 30 s.",
                "Dodaj mięso (320 g) i smaż na mocnym ogniu 6–7 min, rozbijając łopatką. Dopraw 1 łyżeczką kminu, 1 łyżeczką papryki, solą i chili.",
                "Wlej pomidory (400 g) i 100 ml wody, dodaj odsączoną fasolę (240 g — cała puszka). Duś bez przykrycia 15 min, aż zgęstnieje.",
                "Podaj na ryżu."],
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),
    dict(typ=O, nazwa="Fajitas — tortille z kurczakiem i papryką", czas="25 min", sprzet="duża patelnia lub grill elektryczny",
         skl=[("tortilla pełnoziarnista", 4, "szt."), ("pierś z kurczaka", 320, "g"), ("papryka", 2, "szt."), ("cebula", 1, "szt."),
              ("oliwa / olej", 0.5, "łyż."), ("sałata", 60, "g"), ("jogurt naturalny", 100, "g", "SOS")],
         przyprawy=["czosnek, kmin, papryka wędzona, sok z limonki lub cytryny, sól"],
         kroki=["Kurczaka (320 g) pokrój w paski. Wymieszaj z ½ łyżki oliwy, kminem, papryką wędzoną, czosnkiem i solą, odstaw na 10 min.",
                "Papryki pokrój w paski, cebulę w piórka (cebula tylko na jego porcję — smaż ją osobno z boku patelni).",
                "Na mocnym ogniu smaż kurczaka 5–6 min, odłóż. Na tej samej patelni smaż paprykę 4 min — ma zostać jędrna.",
                "SOS: 100 g jogurtu z przeciśniętym czosnkiem, sokiem z limonki i solą.",
                "Tortille podgrzej po 20 s na suchej patelni. Nakładaj sałatę, kurczaka, paprykę i sos — po 2 tortille na osobę."]),
    dict(typ=O, nazwa="Miska z łososiem, ryżem i awokado", czas="30 min (łososia rozmroź dzień wcześniej w lodówce)", sprzet="airfryer lub piekarnik, garnek",
         skl=[("łosoś filet", 300, "g"), ("ryż", 100, "g"), ("awokado", 1, "szt."), ("ogórek świeży", 1, "szt."),
              ("sos sojowy", 2, "łyż."), ("sezam", 1, "łyż.")],
         przyprawy=["sok z cytryny, imbir, sól"],
         kroki=["RYŻ: 100 g przepłucz i ugotuj w osolonej wodzie wg opakowania.",
                "Łososia (300 g) osusz, podziel na 2 kawałki, skrop 1 łyżką sosu sojowego i sokiem z cytryny.",
                "Airfryer 180°C, 10–12 min, skórą do dołu (albo piekarnik 200°C, 12–15 min).",
                "Awokado i ogórka pokrój w plastry. Sezam praż 2 min na suchej patelni.",
                "Do misek: ryż, łosoś w kawałkach, awokado i ogórek. Polej resztą sosu sojowego, posyp sezamem."],
         uwaga="Mniej białka niż w większości obiadów — apka wyrówna to porcją albo zaznaczy różnicę."),
    dict(typ=O, nazwa="Kotleciki z indyka z puree i mizerią", czas="40 min", sprzet="patelnia, garnek, tłuczek do ziemniaków",
         skl=[("indyk mielony", 360, "g"), ("jaja", 1, "szt."), ("oliwa / olej", 1, "łyż."),
              ("ziemniaki", 500, "g", "PUREE"), ("mleko 2%", 50, "ml"), ("masło", 2, "łyżecz."),
              ("ogórek świeży", 2, "szt.", "MIZERIA"), ("jogurt naturalny", 100, "g")],
         przyprawy=["czosnek, majeranek, koperek, sól, pieprz"],
         kroki=["PUREE: ziemniaki (500 g) obierz i gotuj w osolonej wodzie 20 min. Odcedź, utłucz z 50 ml ciepłego mleka i 2 łyżeczkami masła.",
                "Mięso (360 g) wymieszaj z jajkiem, czosnkiem, majerankiem, ½ łyżeczki soli i pieprzem. Mokrymi dłońmi uformuj 6 płaskich kotlecików.",
                "Na średnim ogniu rozgrzej 1 łyżkę oliwy. Smaż kotleciki 4–5 min z każdej strony, aż będą rumiane i ścięte w środku.",
                "MIZERIA: 2 ogórki pokrój w cienkie plasterki, posól, po 5 min odlej wodę. Wymieszaj ze 100 g jogurtu i koperkiem."]),

    # ---------------- DANIA NA 2 DNI (4 porcje) ----------------
    dict(typ=O2, nazwa="Curry z kurczaka z ciecierzycą i ryżem", czas="45 min", sprzet="duży garnek lub głęboka patelnia, garnek na ryż",
         skl=[("pierś z kurczaka", 720, "g"), ("ciecierzyca z puszki (odsączona)", 240, "g"), ("pomidory krojone (puszka)", 400, "g"),
              ("ryż", 240, "g"), ("cebula", 2, "szt."), ("oliwa / olej", 2, "łyż."), ("jogurt naturalny", 200, "g")],
         przyprawy=["czosnek 3 ząbki, imbir 1 łyżeczka, curry 2 łyżki, kurkuma, sól"],
         kroki=["Kurczaka (720 g) pokrój w kostkę 2–3 cm, dopraw solą i 1 łyżką curry.",
                "Na mocnym ogniu rozgrzej 1 łyżkę oliwy. Smaż kurczaka w 2 partiach po 5 min, odłóż.",
                "Na drugiej łyżce oliwy smaż cebulę (lub por) 4 min, dodaj czosnek, imbir i drugą łyżkę curry na 1 min.",
                "Wlej pomidory (400 g) i 200 ml wody, dodaj odsączoną ciecierzycę (240 g — cała puszka) i kurczaka. Duś 15 min.",
                "ZDEJMIJ Z OGNIA i odczekaj 1 min. Jogurt (200 g) zahartuj 3 łyżkami sosu i wmieszaj.",
                "RYŻ: 120 g ugotuj dziś, 120 g jutro świeży. Połowę curry przełóż do pojemnika."],
         odgrzewanie="Curry w garnku 5 min na małym ogniu, nie gotuj mocno. Ryż ugotuj świeży.",
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),
    dict(typ=O2, nazwa="Gulasz z indyka z papryką i kaszą bulgur", czas="1 h", sprzet="garnek z grubym dnem, garnek na kaszę",
         skl=[("filet z indyka", 720, "g"), ("kasza bulgur", 240, "g"), ("papryka", 2, "szt."), ("pieczarki", 500, "g"),
              ("cebula", 2, "szt."), ("passata", 350, "g"), ("oliwa / olej", 2, "łyż.")],
         przyprawy=["czosnek 3 ząbki, papryka słodka 2 łyżeczki, papryka wędzona, majeranek, liść laurowy, sól, pieprz"],
         kroki=["Indyka (720 g) pokrój w kostkę 3 cm, dopraw solą, pieprzem i 1 łyżeczką papryki słodkiej.",
                "Na mocnym ogniu rozgrzej 1 łyżkę oliwy. Obsmaż mięso w 2 partiach po 4–5 min, odłóż.",
                "Na drugiej łyżce oliwy smaż cebulę (lub por) 4 min, dodaj pieczarki (500 g) w ćwiartkach i smaż 7 min, aż odparują. Dodaj czosnek.",
                "Dodaj papryki w kostce, mięso, passatę (350 g), 300 ml wody, liść laurowy, majeranek i resztę papryki. Duś pod przykryciem 30 min.",
                "BULGUR: 120 g wsyp do 250 ml wrzącej osolonej wody, gotuj pod przykryciem 10–12 min. Drugie 120 g ugotuj jutro.",
                "Połowę gulaszu przełóż do pojemnika na jutro."],
         odgrzewanie="Gulasz w garnku 5–7 min na małym ogniu z łyżką wody. Bulgur ugotuj świeży.",
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),
    dict(typ=O2, nazwa="Pulpety z indyka w sosie pomidorowym z kuskusem", czas="50 min", sprzet="głęboka patelnia z pokrywką, miska",
         skl=[("indyk mielony", 720, "g"), ("jaja", 1, "szt."), ("kuskus", 240, "g"), ("passata", 700, "g"),
              ("cebula", 1, "szt."), ("marchew", 2, "szt."), ("oliwa / olej", 1, "łyż."), ("parmezan", 40, "g")],
         przyprawy=["czosnek 3 ząbki, oregano, bazylia, szczypta cukru, sól, pieprz"],
         kroki=["Mięso (720 g) wymieszaj z jajkiem, 20 g parmezanu, 1 ząbkiem czosnku, ¾ łyżeczki soli i pieprzem. Mokrymi dłońmi uformuj ok. 20 pulpetów.",
                "Na patelni rozgrzej 1 łyżkę oliwy. Smaż cebulę (lub por) i startą marchew 4 min, dodaj resztę czosnku.",
                "Wlej passatę (700 g) i 150 ml wody, dodaj oregano, bazylię, szczyptę cukru i sól. Zagotuj.",
                "Włóż pulpety do sosu, przykryj i duś 20 min na małym ogniu, raz delikatnie obracając.",
                "KUSKUS: 120 g zalej 200 ml wrzątku ze szczyptą soli, przykryj na 5 min. Drugie 120 g zrób jutro.",
                "Połowę pulpetów z sosem przełóż do pojemnika. Porcje posyp resztą parmezanu."],
         odgrzewanie="Pulpety w sosie na patelni 6–8 min pod przykryciem. Kuskus zrób świeży (5 min).",
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),

    # ---------------- ZUPY NA 2 DNI (4 porcje) ----------------
    dict(typ=Z, nazwa="Zupa z czerwonej soczewicy z kurczakiem", czas="45 min", sprzet="garnek 5 l, airfryer lub patelnia",
         skl=[("pierś z kurczaka", 600, "g"), ("soczewica czerwona", 240, "g"), ("pomidory krojone (puszka)", 400, "g"),
              ("marchew", 2, "szt."), ("cebula", 1, "szt."), ("oliwa / olej", 1, "łyż."), ("chleb żytni", 4, "krom.")],
         przyprawy=["czosnek 3 ząbki, kmin, kurkuma, papryka słodka, sok z cytryny, bulion 1,5 l (1 kostka na 1 l wody)"],
         kroki=["KURCZAK: 600 g dopraw solą, pieprzem i papryką. Airfryer 200°C, 18–20 min. Pokrój w kostkę.",
                "W garnku rozgrzej 1 łyżkę oliwy. Smaż cebulę (lub por) i marchew w kostce 5 min, dodaj czosnek, 1 łyżeczkę kminu i ½ łyżeczki kurkumy na 1 min.",
                "Soczewicę (240 g) przepłucz na sitku. Dodaj do garnka z pomidorami (400 g) i 1,5 l bulionu.",
                "Gotuj 20 min, aż soczewica się rozpadnie. Dopraw solą i sokiem z cytryny. Można częściowo zblendować.",
                "Do misek dodaj kurczaka. Podaj z kromką chleba."],
         odgrzewanie="W garnku 5–7 min. Soczewica gęstnieje — dolej 150 ml wody.",
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),
    dict(typ=Z, nazwa="Zupa meksykańska z indykiem, fasolą i kukurydzą", czas="45 min", sprzet="garnek 5 l",
         skl=[("indyk mielony", 720, "g"), ("fasola czerwona z puszki (odsączona)", 480, "g"), ("kukurydza konserwowa", 200, "g"),
              ("passata", 700, "g"), ("papryka", 2, "szt."), ("cebula", 1, "szt."), ("oliwa / olej", 1, "łyż."), ("śmietana 12%", 200, "g")],
         przyprawy=["czosnek 3 ząbki, kmin, papryka słodka i wędzona, chili (dla niej mniej), bulion 1 l (1 kostka na 1 l wody)"],
         kroki=["W garnku rozgrzej 1 łyżkę oliwy. Smaż mięso (720 g) na mocnym ogniu 8 min, rozbijając łopatką. Dopraw solą, kminem i papryką.",
                "Dodaj cebulę (lub por), papryki w kostce i czosnek. Smaż 5 min.",
                "Wlej passatę (700 g) i 1 l bulionu. Dodaj odsączoną fasolę (480 g — 2 puszki) i kukurydzę (200 g). Gotuj 20 min.",
                "Zdejmij z ognia. HARTOWANIE ŚMIETANY: 200 g śmietany (całe opakowanie) wymieszaj w kubku z 3 łyżkami gorącej zupy, potem wlej do garnka, mieszając."],
         odgrzewanie="W garnku 5–7 min na małym ogniu, nie gotuj mocno.",
         uwaga="Cebula tylko dla niego — dla niej użyj pora."),

    # ---------------- KOKTAJLE ----------------
    dict(typ=K, kod="K8", nazwa="Mango z granolą", pora="~18:00",
         skl=[("skyr naturalny", 300, "g"), ("mleko 2%", 250, "ml"), ("odżywka białkowa", 25, "g"), ("mango mrożone", 200, "g"),
              ("miód", 1, "łyż."), ("granola", 20, "g")]),
    dict(typ=K, kod="K9", nazwa="Wiśniowo-kakaowy", pora="~18:00",
         skl=[("skyr naturalny", 300, "g"), ("mleko 2%", 250, "ml"), ("odżywka białkowa", 25, "g"), ("wiśnie mrożone", 200, "g"),
              ("kakao gorzkie", 2, "łyżecz."), ("miód", 1, "łyż.")]),
    dict(typ=KM, kod="K10", nazwa="Truskawkowo-owsiany (mały)", pora="13:00",
         skl=[("skyr naturalny", 150, "g"), ("mleko 2%", 125, "ml"), ("odżywka białkowa", 12.5, "g"), ("truskawki mrożone", 100, "g"),
              ("płatki owsiane", 15, "g"), ("masło orzechowe", 5, "g")]),
    dict(typ=KM, kod="K11", nazwa="Wiśniowy z granolą (mały)", pora="13:00",
         skl=[("skyr naturalny", 150, "g"), ("mleko 2%", 125, "ml"), ("odżywka białkowa", 12.5, "g"), ("wiśnie mrożone", 100, "g"),
              ("granola", 15, "g"), ("masło orzechowe", 5, "g")]),
]
KROKI_KOKTAJL = [
    "Do kielicha wkładaj w tej kolejności: mleko, skyr, odżywka, dodatki suche (płatki, kakao, masło orzechowe), na końcu owoce mrożone. Tak blender nie stanie.",
    "Blenduj 30–45 s na wysokich obrotach, aż będzie gładko.",
    "Za gęsty? Dolej 30–50 ml wody (0 kcal).",
]
MASA = {"g": 1, "ml": 1, "łyż.": 20, "łyżecz.": 5, "szt.": 120}
PORCJE = {S: 2, D: 1, O: 2, O2: 4, Z: 4, K: 2, KM: 1}


def slug(s):
    s = s.lower().replace("ł", "l")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    baza = json.loads((DATA / "dania.json").read_text(encoding="utf-8"))
    kategorie = json.loads((DATA / "kategorie.json").read_text(encoding="utf-8"))
    # wartości na jednostkę wyliczone z PDF-ów: suma kcal / suma ilości dla (produkt, jednostka)
    acc = defaultdict(lambda: [0.0, 0.0, 0.0])
    for d in baza:
        for s in d["skladniki"]:
            if s["ilosc"] and s["produkt"]:
                a = acc[(s["produkt"], s["jednostka"])]
                a[0] += s["ilosc"]; a[1] += s["kcal"]; a[2] += s["bialko"]
    jedn = {k: (v[1] / v[0], v[2] / v[0]) for k, v in acc.items()}
    for p, (u, kc, b, kat) in NOWE_PRODUKTY.items():
        jedn[(p, u)] = (kc, b)
        kategorie[p] = kat

    zajete = {d["id"] for d in baza}
    out, bledy = [], []
    dosypka = (183, 34)   # jak w PDF: 30 g odżywki + 100 g skyru
    for src in DANIA:
        typ = src["typ"]
        skl, masa = [], 0
        for t in src["skl"]:
            nazwa, il, u = t[0], t[1], t[2]
            if (nazwa, u) not in jedn:
                bledy.append(f"{src['nazwa']}: brak wartości dla '{nazwa}' [{u}]")
                continue
            kc, b = jedn[(nazwa, u)]
            skl.append({"nazwa": nazwa, "produkt": nazwa, "ilosc": il, "jednostka": u, "kcal": round(kc * il), "bialko": round(b * il),
                        "grupa": t[3] if len(t) > 3 else None, "uwaga": None, "kategoria": kategorie.get(nazwa, "zapas"),
                        "_b": b * il})
            masa += il * MASA.get(u, 0)
        # grupa obowiązuje do końca listy (jak w PDF-ach) — w aplikacji wystarczy nagłówek przy pierwszym składniku
        kcal = sum(s["kcal"] for s in skl)
        bialko = round(sum(s.pop("_b") for s in skl))
        kroki = src.get("kroki") or (KROKI_KOKTAJL if typ in (K, KM) else [])
        d = {
            "id": slug((src.get("kod", "") + " " + src["nazwa"]).strip()),
            "typ": typ, "porcje": PORCJE[typ], "kod": src.get("kod"), "nazwa": src["nazwa"], "dodane": True,
            "czas": src.get("czas"), "sprzet": src.get("sprzet"),
            "skladniki": skl, "przyprawy": src.get("przyprawy", []),
            "razem": {"kcal": kcal, "bialko": bialko},
            "na_porcje": {"kcal": round(kcal / PORCJE[typ]), "bialko": round(bialko / PORCJE[typ])},
            "warianty": [], "kroki": kroki, "odgrzewanie": src.get("odgrzewanie"), "uwaga": src.get("uwaga"),
            "wieczorem": [k for k in kroki if k.startswith("WIECZOREM")],
            "podzial": {}, "zrodlo": ["dodane do bazy"], "wystapienia": [],
        }
        if typ in (K, KM):
            d["masa_g"] = round(masa / 5) * 5
            d["pora"] = src["pora"]
        if typ == K:
            ona_k = 270
            ona_b = round(bialko * ona_k / kcal)
            d["podzial"] = {src["pora"]: {
                "ona_g": round(d["masa_g"] * ona_k / kcal), "ona_kcal": ona_k, "ona_bialko": ona_b,
                "on_kcal": kcal - ona_k + dosypka[0], "on_bialko": bialko - ona_b + dosypka[1], "dosypka": True}}
        if d["id"] in zajete:
            bledy.append(f"powtórzone id: {d['id']}")
        zajete.add(d["id"])
        out.append(d)

    if bledy:
        print("BŁĘDY — nic nie zapisano:")
        for b in bledy:
            print("  ", b)
        sys.exit(1)
    (DATA / "dania-dodane.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Zapisano {len(out)} dań do app/data/dania-dodane.json\n")
    for d in out:
        g = 100 * d["razem"]["bialko"] / d["razem"]["kcal"]
        print(f"[{d['typ']:13}] {(d['kod'] or ''):4}{d['nazwa'][:52]:52} {d['razem']['kcal']:5} kcal {d['razem']['bialko']:4} g  ({g:.1f} g/100 kcal)")


if __name__ == "__main__":
    main()
