# Pipeline

Výstup Fáze 2. Popisuje, co pipeline dělá, jak je členěná a jaká rozhodnutí
za návrhem stojí. Ověřená fakta o zdrojových datech jsou v `parametry.md`.

## Spuštění

```bash
~/.venvs/grib/bin/python -m pipeline              # běžný běh
~/.venvs/grib/bin/python -m pipeline --force      # přepíše i již zpracovaný běh
~/.venvs/grib/bin/python -m pipeline --output x.json
~/.venvs/grib/bin/python -m pipeline --no-area    # jen vyjmenovaná místa
~/.venvs/grib/bin/python -m pipeline --area-output build/area
```

Běh nad novým během modelu trvá zhruba 40 sekund, z toho většinu zabere
stažení asi 67 MB komprimovaných dat. Běh nad již zpracovaným během skončí
do pěti sekund, protože se nestahuje nic.

## Členění

| Modul | Odpovědnost |
|---|---|
| `pipeline/config.py` | Místa včetně zobrazovaného názvu, seznam veličin, hranice mřížky |
| `pipeline/source.py` | Nalezení nejnovějšího kompletního běhu, stažení a dekomprese |
| `pipeline/reader.py` | Čtení GRIB, extrakce bodu i celé mřížky, převod jednotek |
| `pipeline/build.py` | Sestavení a zápis `data/forecast.json` |
| `pipeline/area.py` | Kvantizace, dlaždice a index plošného balíku |
| `pipeline/__main__.py` | Orchestrace a idempotence |

## Návrhová rozhodnutí

**Identifikace veličiny podle čísla parametru.** Soubor se vybírá podle názvu,
ale po otevření se kontroluje klíč `indicatorOfParameter`. Kdyby ČHMÚ změnil
obsah souboru při zachování názvu, pipeline skončí chybou místo toho, aby
tiše publikovala jinou veličinu. Kontrola je nutná i proto, že dvě z pěti
veličin nemají v `cfgrib` jméno a rozlišit je podle názvu proměnné nelze.

**Hodinové srážky rozdílem.** Zdroj kumuluje od začátku běhu. První krok se
bere přímo, protože už sám pokrývá první hodinu. Rozdíly se ořezávají zdola
nulou kvůli šumu z kvantizace, popsanému v `parametry.md`.

**Řada začíná až hodinu po běhu.** Okamžité veličiny mají krok 0, srážky až
krok 1. Sestavení bere průnik časů, takže analýza vypadne sama a každý řádek
výstupu je úplný. Řada má proto 72 hodin, nikoli 73.

**Typ hodnoty podle veličiny, ne podle čísla.** Teplota a vítr jsou vždy
desetinné číslo, oblačnost a směr větru celé. Bez toho by teplota rovných
25 °C vypadla jako `25` a klient by musel řešit dva různé typy.

**Atomický zápis.** Výstup se zapisuje do dočasného souboru a teprve pak
přesune na místo. Přerušený běh tak nezanechá poškozený JSON.

**Idempotence podle `run_id`.** Pokud už `data/forecast.json` obsahuje
nejnovější kompletní běh, pipeline se ukončí před stahováním. Opakované
spuštění tedy nezatěžuje zdroj.

**Kompletnost běhu podle počtu souborů.** Za kompletní se považuje běh s 31
soubory. Nekompletní běh se přeskočí a použije se starší, aby se nestalo, že
se pipeline pokusí stáhnout soubor, který ještě nebyl publikován.

## Místa

Vyjmenovaná místa nejsou v kódu, ale v adresáři `places/`, jeden soubor na
místo. Důvod je praktický: nové místo pak vzniká založením souboru, což zvládne
i telefon přes webový editor GitHubu, a aplikace to umí nabídnout.

```json
{
  "name": "pec-pod-snezkou",
  "label": "Pec pod Sněžkou",
  "lat": 50.6935,
  "lon": 15.7332
}
```

`lat` a `lon` jsou povinné, `name` se jinak vezme z názvu souboru a `label` je
text, který uvidí uživatel. Neznámý klíč je chyba, protože nejčastější překlep
je právě v názvu klíče a tiché ignorování by ho schovalo.

Pořadí je dané: `home.json` první, zbytek podle názvu souboru. Aplikace otevírá
první místo v seznamu, pokud si nepamatuje vlastní volbu.

**Vadný soubor se přeskočí, běh pokračuje.** Chyba v jednom místě nesmí stát
předpověď pro ostatní. Přeskočení se ale zapíše do logu běhu jako `ERROR`,
takže je v Actions vidět, proč se nové místo neobjevilo. Když nezbude žádné
použitelné místo, běh skončí chybou.

Kontrola, že místo leží v doméně modelu, probíhá už při načtení souboru, nikoli
až při čtení GRIBu.

## Plošný balík

Vyjmenovaná místa se extrahují v plném rozlišení zdroje a jdou do
`data/forecast.json`. Na místo zadané v aplikaci to nestačí, a proto vzniká
druhý výstup: **plošný balík** nad celou doménou, prořídlý na každý druhý bod
mřížky, tedy krok asi dva kilometry, rozřezaný na dlaždice.

| Vlastnost | Hodnota |
|---|---|
| Prořídnutí | `AREA_STRIDE = 2`, mřížka 251 × 145 = 36 395 bodů |
| Dlaždice | `AREA_TILE = 12` bodů na stranu, 21 × 13 = 273 dlaždic |
| Veličiny | teplota `int16` po 0,1 °C, srážky `uint16` po 0,1 mm, oblačnost `uint8` v procentech |
| Velikost | 13,1 MB na běh, největší dlaždice 50,6 kB, po gzipu asi 17 kB |
| Zápis | do 0,3 sekundy, měřeno na plné velikosti |

**Co prořídnutí stojí na přesnosti.** Měřeno na běhu `2026-09-14T12:00Z` pro
domácí místo: bod prořídlé mřížky se od bodu plné mřížky liší v průměru
o 0,30 °C a nejvýše o 0,56 °C přes všech 73 kroků. Kyje leží v rovině, takže
v členitém terénu bude rozdíl větší; přesně proto zůstávají vyjmenovaná místa
na plném rozlišení. Čtení celé mřížky trvá 1,1 sekundy na veličinu, což k době
běhu přidá necelé čtyři sekundy.

Vítr v balíku není. Stál by další dva bajty na bod a hodinu u veličiny, která
je pro čtení předpovědi nejméně podstatná, a u vyjmenovaných míst je k
dispozici tak jako tak. Oblačnost naopak zůstává, přestože také není hlavní:
stojí jediný bajt a bez ní by nešly nakreslit hodinové ikony.

### Formát dlaždice

Jeden binární soubor `{tx}-{ty}.bin` na dlaždici, bez hlavičky. Sekce jdou za
sebou v pořadí `AREA_FIELDS` a uvnitř sekce leží celá časová řada jednoho bodu
pohromadě:

```
index = (řádek * šířka + sloupec) * počet_hodin + hodina
```

Hodnoty jsou celá čísla v pořadí bajtů little endian a výsledek se získá
dělením měřítkem dané veličiny. Dlaždice na okraji domény jsou užší nebo nižší;
aplikace si šířku dopočítá jako `min(tile, nx - tx * tile)`.

Vše potřebné ke čtení nese `index.json` vedle dlaždic: počátek a krok mřížky,
velikost dlaždice, počet dlaždic, seznam platných časů, pořadí veličin a jejich
měřítka, `run_id` a `generated_at`. Aplikace tedy formát nikde neodhaduje.
Krok mřížky se do indexu zapisuje změřený z dat, nikoli jako konstanta: ve
směru délky vychází 0,01399°, nikoli kulatých 0,014°, jak uvádí dokumentace.

Balík se zapisuje do `build/area`, tedy mimo git. Při 13,1 MB na běh a čtyřech
nových bězích denně by historie repozitáře rostla zhruba o 50 MB denně, což je
neúnosné. Publikaci řeší workflow, viz níže.

Adresář se před zápisem maže celý, aby balík nikdy nemíchal dlaždice ze dvou
běhů. Běh, který nenajde nová data, balík nepřepisuje, stejně jako nepřepisuje
`forecast.json`.

## Publikace

Workflow `.github/workflows/forecast.yml` běží šestnáctkrát denně, spustí testy,
sestaví předpověď a commitne `data/forecast.json` jen tehdy, když se změnil.
Časy cronu odpovídají naměřenému zpoždění publikace, viz `parametry.md`. Ke
čtyřem hlavním slotům je přidána záchytná vrstva každé dvě hodiny, protože
plánované běhy v Actions se v provozu opožďovaly i o hodiny a jeden slot byl
vynechán. Většina běhů proto skončí bez akce, což je levné: čtení výpisu
adresářů a nic víc.

### Předání plošného balíku

Balík se do repozitáře nedostane, a přitom ho musí nasadit workflow `pages`.
Cestou mezi nimi je cache Actions. Běh `forecast`, který balík vyrobil, jej
uloží pod klíčem `area-v1-{běh}-{číslo běhu workflow}`; workflow `pages` si
před sestavením webu vyžádá cache podle předpony `area-v1-`, což vrátí
nejnovější uloženou. Číslo běhu workflow je v klíči proto, aby vynucený
přepočet téhož běhu modelu nenarazil na klíč, který už existuje, protože
záznamy v cache se nepřepisují.

Důsledek, na kterém záleží: nasazení vyvolané změnou v `web/` si vyzvedne
balík z posledního běhu modelu, takže úprava rozhraní balík ze stránky
neodstraní. Když cache chybí, například hned po zavedení této funkce, web se
nasadí bez balíku a `scripts/build-site.sh` to vypíše. Aplikace pak zvládne jen
vyjmenovaná místa.

Ruční spuštění přes **Actions → forecast → Run workflow** má volitelný přepínač
`force`. Bez něj se workflow chová stejně jako plánovaný běh. S ním předá
pipeline `--force`, takže se předpověď přepočítá i pro už zpracovaný běh.
Slouží k odladění publikace mimo okno, kdy ČHMÚ zveřejňuje nová data. Počítejte
s tím, že vynucený běh změní pole `generated_at`, takže vždy vznikne commit,
i když jsou samotné hodnoty předpovědi shodné. Plánované běhy nikdy nevynucují.

## Testy

```bash
~/.venvs/grib/bin/python -m pytest tests -q
```

Testy parseru běží nad vzorky v `tests/fixtures/`, což jsou jednotlivé zprávy
GRIB vyříznuté z běhu `2026082106`. Vzorky jsou dva záměrně: `t2m_step0.grb`
pro veličinu, kterou ecCodes pojmenuje, a `cloud_step0.grb` pro veličinu
z lokální tabulky, která přijde jako proměnná `unknown`. Právě druhý případ je
ten křehčí a bez vzorku by nebyl pokrytý.

Logika hodinových srážek se testuje nad syntetickými řadami, protože k jejímu
ověření není potřeba skutečný GRIB a vzorek by kvůli více časovým krokům
zbytečně narostl.
