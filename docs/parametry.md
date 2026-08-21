# Parametry datové sady ALADIN CZ_1km — ověřená fakta

Výstup Fáze 1. Všechna tvrzení níže jsou ověřena přímo na datech, nikoli
převzata z dokumentace. Kde se dokumentace a data rozcházejí, je to
výslovně uvedeno.

## Metodika ověření

- **Datum ověření:** 21. 8. 2026
- **Ověřovaný běh:** `2026082106`, tedy běh 06 UTC z 21. 8. 2026
- **Stažené soubory:** `Popis_obsahu.xlsx` a pět souborů GRIB pro sledované
  parametry (celkem přibližně 67 MB komprimovaně). Žádné hromadné stahování
  neproběhlo.
- **Nástroje:** `eccodes` 2.47.0 nad knihovnou ecCodes 2.48.0,
  `cfgrib` 0.9.15.1, `xarray` 2026.7.0
- **Kontrolní bod pro časové řady:** 49,195 N, 16,607 E (Brno), nejbližší
  bod mřížky 49,193 N, 16,606 E

## Struktura datové sady

Kořen sady je `https://opendata.chmi.cz/meteorology/weather/nwp_aladin/`,
použitá podsada je `CZ_1km/`. Ta obsahuje čtyři podadresáře podle nominálního
času běhu v UTC: `00/`, `06/`, `12/`, `18/`.

Název souboru má tvar `ALADCZ1K4opendata_{YYYYMMDDHH}_{PARAMETR}.grb.bz2`,
kde `{YYYYMMDDHH}` je nominální čas běhu v UTC. Soubory jsou komprimované
bzip2 a je nutné je před parsováním rozbalit.

Každý běh sestává z **31 souborů**, jeden soubor na veličinu. Tento počet byl
shodný u všech deseti běhů dostupných v době ověření, takže jej lze použít
jako kritérium kompletnosti běhu.

**Retence** je tři běhy v každém adresáři, tedy zhruba tři dny historie.

### Zpoždění publikace

Toto je provozně nejdůležitější zjištění Fáze 1. Měřeno z hlaviček
`Last-Modified` a z indexu adresáře, jehož časy jsou v UTC (ověřeno
porovnáním s hlavičkou `Date` odpovědi serveru).

| Běh | Zpoždění publikace | Naměřeno u běhů |
|---|---|---|
| 00 UTC | +3 h 32 m až +3 h 34 m | 19., 20., 21. 8. |
| 06 UTC | +4 h 24 m až +4 h 26 m | 19., 20., 21. 8. |
| 12 UTC | +3 h 12 m až +3 h 18 m | 19., 20. 8. |
| 18 UTC | +4 h 22 m až +4 h 25 m | 19., 20. 8. |

Zpoždění tedy není rovnoměrné: běhy 00 a 12 jsou k dispozici asi po třech a
půl hodinách, běhy 06 a 18 až po čtyřech a půl hodinách. Vzorek je deset běhů
ze tří dnů, což pro nastavení cronu považuji za dostatečné, ale nikoli za
důkaz, že se odchylka nikdy nezvětší.

**Důsledek pro plánování:** časy uvedené v `CLAUDE.md`, tedy 03:30, 09:30,
15:30 a 21:30 UTC, by minuly běhy 06 a 18 a u běhu 00 by byly na hraně,
protože ten se objevuje až v 03:32 až 03:34. Doporučené časy s rezervou
zhruba půl hodiny jsou **04:15, 11:00, 16:00 a 23:00 UTC**. Pipeline má být
podle zadání idempotentní vůči `run_id`, takže případný předčasný běh je
neškodný, jen zbytečný.

## Formát souborů

| Vlastnost | Zjištěná hodnota |
|---|---|
| Edice GRIB | **1**, nikoli 2 |
| Centrum | 89 (Praha), `subCentre` 0 |
| Tabulka parametrů | `table2Version` = 1 |
| Balení | `grid_simple`, 8 až 24 bitů podle veličiny |
| Bitmapa chybějících hodnot | není (`bitmapPresent` = 0) |
| Počet zpráv v souboru | 73 pro okamžité veličiny, 72 pro srážky |
| Časový krok | 1 hodina, dosah 72 hodin |

Zadání v `CLAUDE.md` uvádí formát GRIB2. Skutečná data jsou **GRIB edice 1**.
Pro parsování přes `cfgrib` to není překážka, protože knihovna obě edice
zvládá, ale má to dva praktické důsledky popsané níže: jinou identifikaci
parametrů a jiné názvy proměnných.

## Geometrie mřížky

Geometrie je shodná ve všech pěti ověřených souborech.

| Vlastnost | Hodnota |
|---|---|
| Typ mřížky | `regular_ll`, tedy pravidelná lat/lon mřížka |
| Rozměry | 501 × 290 = 145 290 bodů |
| Zeměpisná šířka | 48,500 N až 51,098 N, krok 0,009° |
| Zeměpisná délka | 12,000 E až 18,995 E, krok 0,014° |
| Pořadí řádků | `scanningMode` 64, `jScansPositively` = 1, tedy od jihu k severu |
| Skutečný krok při 49,5 N | 1,012 km ve směru x, 1,002 km ve směru y |

Doména pokrývá celé území ČR, ale na jihu jen s malou rezervou: nejjižnější
bod republiky leží zhruba na 48,55 N, tedy asi 5 km od okraje mřížky. Při
zadávání míst je proto vhodné ověřit, že bod do domény spadá.

## Sledované parametry

Ověřeno na běhu `2026082106`. Sloupec „proměnná v cfgrib" uvádí název, pod
kterým veličinu zpřístupní `xarray`.

| Soubor | GRIB parametr | Proměnná v cfgrib | Jednotka v datech | Kroků | Hladina |
|---|---|---|---|---|---|
| `CLSTEMPERATURE` | 11 | `t2m` | K | 73 | 2 m |
| `SURFPREC_TOTAL` | 61 | `unknown` | kg/m² (= mm) | 72 | povrch |
| `SURFNEBUL_TOTALE` | 171 | `unknown` | frakce 0 až 1 | 73 | povrch |
| `CLSWIND_SPEED` | 32 | `ws` | m/s | 73 | 10 m |
| `CLSWIND_DIREC` | 31 | `wdir` | stupně | 73 | 10 m |

Rozsahy hodnot v kontrolním bodě odpovídají očekávání: teplota 284,8 až
298,6 K, rychlost větru 0,9 až 10,7 m/s, směr větru 7,3 až 351,8°, oblačnost
0,000 až 1,000.

### Identifikace parametrů

Parametry 11, 31 a 32 jsou standardní podle WMO, takže je ecCodes pojmenuje
(`t2m`, `wdir`, `ws`). Parametry **61 a 171 zůstávají nepojmenované**,
`shortName` i `units` mají hodnotu `unknown` a `paramId` je 0. Jde o čísla
z lokální tabulky centra 89, kterou ecCodes nezná.

Pipeline proto **nesmí identifikovat veličinu podle názvu proměnné**.
Spolehlivé jsou dvě cesty, které doporučuji použít obě a vzájemně ověřit:
název souboru, který veličinu určuje jednoznačně, a klíč
`indicatorOfParameter` spolu s `table2Version`. Klíč lze v `cfgrib`
zpřístupnit přes `backend_kwargs={"read_keys": ["indicatorOfParameter"]}`.

### Převod na cílové jednotky

| Pole v `forecast.json` | Převod ze zdroje |
|---|---|
| `t2m` | `hodnota - 273.15`, tedy K na °C |
| `precip_mm` | rozdíl sousedních kroků, viz níže; kg/m² odpovídá 1 mm |
| `cloud_pct` | `hodnota * 100`, frakce na procenta |
| `wind_ms` | beze změny |
| `wind_dir` | beze změny |

## Konvence srážek

Toto byla klíčová otázka Fáze 1 a odpověď je jednoznačná: **srážky jsou
kumulativní od začátku běhu**, nikoli intervalové.

Dokumentace ČHMÚ to uvádí slovy „srážky celkové (kumul od startu
předpovědi)". Ověření na datech to potvrzuje třemi nezávislými pozorováními.
Řada v kontrolním bodě je neklesající a roste od 0,008 mm v kroku 1 na
6,555 mm v kroku 72. Plošný průměr monotónně roste v celém rozsahu
předpovědi. Soubor navíc obsahuje 72 zpráv začínajících krokem 1, zatímco
okamžité veličiny mají 73 zpráv od kroku 0, což odpovídá tomu, že kumulace
za interval 0 až 0 hodin nemá smysl.

**Hodinový úhrn je proto nutné počítat rozdílem sousedních kroků.** Krok 1
se přitom bere přímo, protože reprezentuje interval od 0 do 1 hodiny.

Při diferencování je potřeba ošetřit jeden praktický detail. Rozdíly vycházejí
v 13,6 % bodů mírně záporné, přestože veličina je kumulativní. Jde o šum
z kvantizace při balení GRIB: medián absolutní hodnoty těchto záporných
rozdílů je 3,5 × 10⁻⁴ mm a 99. percentil 2,0 × 10⁻³ mm, tedy hluboko pod
rozlišením, které má pro předpověď smysl. Pouze 808 rozdílů z 10,3 milionu
je menších než −0,01 mm, s nejzápornější hodnotou −0,144 mm.

Doporučené ošetření je oříznout hodinový úhrn zdola nulou, tedy
`max(rozdíl, 0)`. Zaokrouhlení na jedno desetinné místo tento šum odstraní
také, ale ořez je bezpečnější, protože nezávisí na volbě přesnosti výstupu.

Poznámka ke klíčům GRIB: `stepType` hlásí u srážek hodnotu `instant` a
`startStep` se rovná `endStep`, což je pro kumulativní veličinu zavádějící.
Skutečnou konvenci nese `timeRangeIndicator` = 10 s `P1` = 0 a `P2` = krok.
Na `stepType` se tedy nelze spolehnout a kumulaci je nutné brát jako
vlastnost veličiny podle dokumentace a ověření výše.

## Ověřená ukázka časové řady

Běh `2026082106`, kontrolní bod u Brna, prvních osm hodin. Sloupec „srážky
hodinové" je dopočítaný rozdíl, ostatní hodnoty jsou po převodu jednotek.

| Platnost (UTC) | Teplota [°C] | Vítr [m/s] | Směr [°] | Oblačnost [%] | Srážky kumul. [mm] | Srážky hodinové [mm] |
|---|---|---|---|---|---|---|
| 2026-08-21 07:00 | 19,72 | 0,98 | 183,9 | 47,7 | 0,008 | 0,008 |
| 2026-08-21 08:00 | 20,83 | 1,27 | 155,7 | 47,7 | 0,022 | 0,014 |
| 2026-08-21 09:00 | 21,99 | 1,31 | 150,7 | 68,0 | 0,032 | 0,010 |
| 2026-08-21 10:00 | 23,30 | 1,92 | 167,4 | 92,2 | 0,036 | 0,004 |
| 2026-08-21 11:00 | 23,89 | 1,35 | 153,1 | 92,1 | 0,046 | 0,010 |
| 2026-08-21 12:00 | 24,88 | 2,12 | 161,5 | 89,9 | 0,054 | 0,008 |
| 2026-08-21 13:00 | 25,11 | 2,70 | 162,0 | 99,9 | 0,055 | 0,001 |
| 2026-08-21 14:00 | 25,28 | 2,77 | 168,4 | 67,0 | 0,056 | 0,001 |

## Poznámky k použití cfgrib

Souřadnice, které `cfgrib` vytvoří, jsou `time` s časem běhu, `step` jako
`timedelta` a `valid_time` jako jejich součet. Do JSON patří `valid_time`.

Extrakce nejbližšího bodu je přímočará přes
`da.sel(latitude=..., longitude=..., method="nearest")`, protože mřížka je
pravidelná a `cfgrib` ji zpřístupní jako indexované osy.

`cfgrib` si vedle souboru GRIB zakládá indexový soubor s příponou `.idx`.
V pipeline je vhodné jej vypnout přes `backend_kwargs={"indexpath": ""}`,
aby nevznikaly vedlejší soubory. Vzor `*.idx` je pro jistotu i v `.gitignore`.

## Rozdíly oproti zadání v CLAUDE.md

Dva body zadání se s ověřenou skutečností rozcházejí a je potřeba je ve
Fázi 2 zohlednit.

1. **Formát není GRIB2, ale GRIB edice 1.** Na volbu knihovny to nemá vliv,
   na identifikaci parametrů ano.
2. **Časy cronu jsou nastavené příliš brzy.** Podle naměřeného zpoždění by
   plán 03:30, 09:30, 15:30 a 21:30 UTC minul dva ze čtyř běhů.

Schéma `data/forecast.json` navržené v zadání zůstává použitelné beze změny.
Jednotky, které předpokládá, tedy °C, mm, procenta, m/s a stupně, odpovídají
převodům uvedeným výše.

## Co ověřeno nebylo

Uvádím kvůli poctivosti hranic Fáze 1.

- **Konvence směru větru.** Parametr 31 je podle WMO meteorologický směr,
  tedy odkud vítr vane, a ecCodes u něj uvádí jednotku „Degree true". Data
  samotná ale konvenci potvrdit neumožňují, protože k tomu by bylo potřeba
  srovnání se složkami u a v nebo s měřením.
- **Chování při neúplném běhu.** Všech deset dostupných běhů bylo kompletních,
  takže jak se sada chová při výpadku, ověřeno nemám. Kritérium 31 souborů je
  proto návrh, nikoli ověřená detekce.
- **Stabilita zpoždění publikace v čase.** Vzorek pokrývá tři dny.

## Licence zdroje

Data jsou zveřejněna pod licencí CC BY 4.0. V uživatelském rozhraní je proto
nutné uvádět „Zdroj dat: ČHMÚ, model ALADIN".
