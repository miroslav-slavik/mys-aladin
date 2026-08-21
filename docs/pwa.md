# PWA

Výstup Fáze 3. Statická aplikace v `web/`, která zobrazuje `data/forecast.json`
jako meteogram na 72 hodin a dá se nainstalovat na plochu iPhonu.

## Místní náhled

```bash
./scripts/build-site.sh /tmp/site      # sestaví site/ ve tvaru, který uvidí prohlížeč
cd /tmp/site && ~/.venvs/grib/bin/python -m http.server 8765
```

Stejný skript používá i workflow, takže rozvržení při náhledu odpovídá nasazení.
Aplikace se nesmí otevírat přes `file://`, protože service worker vyžaduje
`http(s)`.

## Rozvržení meteogramu

Čtyři panely nad společnou časovou osou, shora dolů: teplota, srážky, oblačnost
a vítr. Panely jsou v jediném SVG, takže sdílejí vodorovný posun a nemohou se
vzájemně rozejít.

| Veličina | Forma | Proč |
|---|---|---|
| Teplota | čára s jemnou plochou | průběh v čase, jedna řada |
| Srážky | sloupce od nulové základny | hodinové úhrny jsou množství, ne průběh |
| Oblačnost | pruh se sekvenční šedou | podíl 0 až 100 %, více oblačnosti tmavší |
| Vítr | čára a řádek šipek | rychlost je veličina, směr je úhel |

Dvě rozhodnutí stojí za vysvětlení. **Žádná dvojitá osa.** Pět veličin má různé
jednotky i rozsahy, takže každá dostala vlastní panel; sdílená je jen osa času.
**Šipky místo druhé osy.** Směr větru je úhel, který na lineární ose nedává
smysl, protože 359° a 1° leží vedle sebe. Šipka letí po větru, tedy pryč od
směru, odkud vane.

Barvy pocházejí z ověřené palety. Trojice akcentů prošla kontrolou odstupu pro
barvosleposti v obou režimech; v světlém režimu má zelená kontrast vůči podkladu
pod 3:1, což si vynucuje čitelné popisky a dostupnou tabulku, a obojí aplikace
má.

## Přístupnost a ovládání

Osy y jsou v samostatném, pevném SVG nad posuvníkem. Na telefonu je graf skoro
vždy posunutý a osa, která odjede, je osa k ničemu.

Přejetím myší nebo prstem se zobrazí svislý kurzor a řádek s hodnotami pro danou
hodinu. Tlačítko **Tabulka** přepne na všech 72 řádků, takže hodnoty jsou
dostupné i bez čtení grafu. Noc je podbarvená, v obou režimech ztmavením.

Tmavý režim je samostatně navržený, ne automatická inverze: barvy jsou vlastní
kroky téže palety pro tmavý podklad.

## Offline a instalace

Service worker ukládá skořápku aplikace a poslední předpověď. Předpověď se
načítá strategií „nejdřív síť", takže nový běh vždy vyhraje, a při výpadku se
použije uložená kopie.

Odznak **offline** v hlavičce říká, že zobrazená data nemusí být nejnovější.
Řídí se stavem připojení, nikoli hlavičkou odpovědi: ověřením v prohlížeči se
ukázalo, že požadavek může uspět z cache prohlížeče, aniž by se záložní větev
service workeru vůbec spustila, takže samotná hlavička by řadu případů minula.

Instalace na iPhonu: Safari, tlačítko Sdílet, **Přidat na plochu**. Manifest
nastaví samostatné okno bez adresního řádku, ikony jsou v `web/icons/`.

Po změně souborů v `web/` je potřeba zvýšit `CACHE` v `web/sw.js`. Bez toho si
zařízení podrží starou skořápku.

## Ikony

Generuje je `scripts/make-icons.py` do `web/icons/`. Prostředí nemá grafickou
knihovnu, takže se kreslí analytickými tvary v numpy se čtyřnásobným
převzorkováním a zapisují minimálním PNG enkodérem. Skript je deterministický,
opakované spuštění dá bajtově shodné soubory.

## Nasazení

Workflow `.github/workflows/pages.yml` sestaví web a nasadí jej na GitHub Pages.
Spouští se při změně `web/` nebo předpovědi, ručně, a také po doběhnutí
workflow `forecast`. Poslední spouštěč je nutný: commit, který workflow
`forecast` vytvoří přes `GITHUB_TOKEN`, sám o sobě další workflow nespustí.

Před prvním nasazením je potřeba v **Settings → Pages** nastavit zdroj na
**GitHub Actions**.
