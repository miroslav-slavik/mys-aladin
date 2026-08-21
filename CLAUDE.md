# mys-aladin — osobní počasí z modelu ALADIN (ČHMÚ)

## Cíl projektu

Osobní aplikace pro iPhone (PWA) zobrazující předpověď počasí z numerického
modelu ALADIN ČHMÚ pro pevně daná místa. Jediný uživatel, žádná
autentizace, žádný trvale běžící server.

## Rozhodnutí uživatele

- **Sledované parametry:** teplota 2 m, úhrn srážek, celková oblačnost,
  rychlost a směr větru
- **Místa (název, lat, lon):**
  - `DOPLNIT`, `49.xxxx`, `16.xxxx`
  - `DOPLNIT` (volitelné druhé místo)
- **Hosting:** GitHub Actions (cron) + GitHub Pages

## Zdroj dat

- Otevřená data ČHMÚ: https://opendata.chmi.cz/meteorology/weather/nwp_aladin/
- Použij sadu **CZ_1km** (pravidelná lat/lon mřížka nad ČR). Sadu
  Lambert_2.3km nepoužívej.
- Struktura: podadresáře `00/`, `06/`, `12/`, `18/` podle běhu modelu (UTC).
  Výstup běhu je dostupný přibližně tři hodiny po nominálním čase běhu,
  předpověď sahá 72 hodin dopředu.
- Popis obsahu: soubor `Popis_obsahu.xlsx` v kořeni datové sady.
- Formát: GRIB2. Parsuj knihovnou `cfgrib` nad `xarray`.
- Licence CC BY 4.0. V uživatelském rozhraní uváděj „Zdroj dat: ČHMÚ,
  model ALADIN".

## Architektura

1. **Pipeline (`pipeline/`)** — Python skript spouštěný přes GitHub Actions
   cronem čtyřikrát denně (03:30, 09:30, 15:30, 21:30 UTC):
   - zjistí nejnovější kompletní běh modelu,
   - stáhne pouze GRIB soubory potřebných parametrů,
   - metodou nejbližšího bodu extrahuje časové řady pro definovaná místa,
   - zapíše `data/forecast.json` podle schématu níže,
   - je idempotentní: pokud je běh podle `run_id` již zpracován, skončí
     bez akce.
2. **PWA (`web/`)** — statická aplikace bez backendu:
   - stáhne `data/forecast.json` a vykreslí meteogram na 72 hodin,
   - obsahuje manifest a service worker pro instalaci na plochu iPhonu
     a offline zobrazení posledních stažených dat,
   - zobrazuje čas běhu modelu a čas poslední aktualizace.

## Schéma data/forecast.json

Návrh k upřesnění ve Fázi 2 podle skutečných jednotek zjištěných ve Fázi 1.

```json
{
  "run_id": "2026-08-21T06:00Z",
  "generated_at": "2026-08-21T09:35:12Z",
  "locations": [
    {
      "name": "...",
      "lat": 0,
      "lon": 0,
      "series": [
        {
          "time": "2026-08-21T07:00Z",
          "t2m": 21.4,
          "precip_mm": 0.0,
          "cloud_pct": 45,
          "wind_ms": 3.2,
          "wind_dir": 270
        }
      ]
    }
  ]
}
```

## Fáze práce

- **Fáze 1 — průzkum dat (žádný produkční kód):** stáhni `Popis_obsahu.xlsx`
  a jeden vzorový GRIB soubor z posledního běhu. Otevři jej přes `cfgrib`
  a ověř dostupnost parametrů, geometrii mřížky, jednotky a konvenci
  srážek, tedy zda jsou úhrny kumulativní od začátku běhu, nebo intervalové.
  Výstupem je `docs/parametry.md` s ověřenými fakty. Bez tohoto ověření
  nepokračuj do Fáze 2.
- **Fáze 2 — pipeline:** parser, extrakce bodů, výstupní JSON, workflow pro
  GitHub Actions, publikace. Přidej jednotkové testy parseru nad uloženým
  vzorovým GRIB souborem.
- **Fáze 3 — PWA:** meteogram, manifest, service worker, nasazení na
  GitHub Pages.

Pracuj vždy jen na fázi, o kterou tě uživatel požádá. Nezačínej další fázi
bez vyzvání.

## Konvence

- **Interpret Pythonu:** pro veškeré spouštění používej
  `~/.venvs/grib/bin/python`. Systémový `python3` nemá nainstalované
  závislosti projektu.
- **Příprava prostředí:** virtuální prostředí vytvoří skript
  `scripts/setup-env.sh`, který do něj nainstaluje závislosti
  z `requirements.txt`. V relacích Claude Code on the web jej automaticky
  spouští SessionStart hook `.claude/hooks/session-start.sh`. Instalace jde
  z PyPI, nikoli z distribučních balíčků: ty jsou přeložené pro Python 3.12,
  zatímco výchozím interpretem je zde Python 3.11.
- Závislosti udržuj v `requirements.txt`.
- GRIB soubory necommituj. Vzorový soubor pro testy drž malý (jeden
  parametr, jeden časový krok) v `tests/fixtures/`.
- Ke zdroji dat se chovej šetrně: stahuj jen potřebné soubory, neopakuj
  hromadné stahování.
- **Jazyk:** identifikátory, kód a komentáře v kódu anglicky. Dokumentace
  (soubory v `docs/`, `README.md`, tento soubor) česky.
