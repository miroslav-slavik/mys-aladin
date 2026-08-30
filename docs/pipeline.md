# Pipeline

Výstup Fáze 2. Popisuje, co pipeline dělá, jak je členěná a jaká rozhodnutí
za návrhem stojí. Ověřená fakta o zdrojových datech jsou v `parametry.md`.

## Spuštění

```bash
~/.venvs/grib/bin/python -m pipeline              # běžný běh
~/.venvs/grib/bin/python -m pipeline --force      # přepíše i již zpracovaný běh
~/.venvs/grib/bin/python -m pipeline --output x.json
```

Běh nad novým během modelu trvá zhruba 40 sekund, z toho většinu zabere
stažení asi 67 MB komprimovaných dat. Běh nad již zpracovaným během skončí
do pěti sekund, protože se nestahuje nic.

## Členění

| Modul | Odpovědnost |
|---|---|
| `pipeline/config.py` | Místa včetně zobrazovaného názvu, seznam veličin, hranice mřížky |
| `pipeline/source.py` | Nalezení nejnovějšího kompletního běhu, stažení a dekomprese |
| `pipeline/reader.py` | Čtení GRIB, extrakce bodu, převod jednotek |
| `pipeline/build.py` | Sestavení a zápis `data/forecast.json` |
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

## Publikace

Workflow `.github/workflows/forecast.yml` běží šestnáctkrát denně, spustí testy,
sestaví předpověď a commitne `data/forecast.json` jen tehdy, když se změnil.
Časy cronu odpovídají naměřenému zpoždění publikace, viz `parametry.md`. Ke
čtyřem hlavním slotům je přidána záchytná vrstva každé dvě hodiny, protože
plánované běhy v Actions se v provozu opožďovaly i o hodiny a jeden slot byl
vynechán. Většina běhů proto skončí bez akce, což je levné: čtení výpisu
adresářů a nic víc.

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
