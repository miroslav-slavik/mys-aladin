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

## Rozvržení

Vzorem je meteogram na `aladinonline.oblacno.cz`, podle přání uživatele.
Obrazovka má shora dolů čtyři části: hlavičku s názvem místa, aktuálním časem
a tlačítkem pro načtení znovu, blok aktuální hodiny s velkou teplotou, řádek
hodinových ikon a jeden graf s přepínači.

Název místa v hlavičce bere pole `label` z `forecast.json`, tedy „Kyje, Praha 9",
nikoli interní klíč `name`, který zůstává „Home".

Celých 72 hodin se vejde na šířku displeje, takže se nikam neposouvá a celý
průběh je vidět najednou. To je proti dřívější verzi zásadní změna: ta měla graf
v posuvníku a bylo nutné jej rolovat.

| Pohled | Forma |
|---|---|
| Teplota | plocha s křivkou, k tomu modré sloupce srážek |
| Vítr | plocha s křivkou rychlosti a řádek šipek se směrem |
| Oblačnost | plocha na pevné ose 0 až 100 % |
| Tabulka | všech 72 řádků s hodnotami |

**Srážky mají vlastní popsanou osu vpravo.** Předloha je kreslí do grafu teploty
bez měřítka, takže z nich lze odečíst jen „hodně a málo". Popisky v milimetrech
tuto vadu odstraňují a od předlohy se liší jen nenápadně.

**Směr větru nesou šipky, ne druhá osa.** Úhel na lineární ose nedává smysl,
protože 359° a 1° by ležely na opačných koncích. Šipka letí po větru, tedy pryč
od směru, odkud vane.

**Interpolace je monotónní kubika**, nikoli Catmull-Rom. Hladká křivka čte
hodinová data lépe než lomená čára, ale Catmull-Rom přestřeluje: u oblačnosti
vystupoval nad 100 % a klesal pod nulu. Monotónní varianta rozsah dat opustit
nemůže.

**Popisky extrémů se vybírají podle výraznosti**, ne zleva doprava, a rozestup
se hlídá v pixelech. Jinak by se popisky slily a nejvyšší vrchol dne by zůstal
bez čísla, protože místo by zabral mírný ranní hrbol.

Ikony počasí se odvozují z oblačnosti, srážek, teploty a denní doby. Kreslí se
jako SVG přímo v kódu, takže nejsou potřeba žádné obrázkové soubory.

## Vzhled

Aplikace má jen tmavou podobu, stejně jako předloha. Barvy jsou tmavé kroky
ověřené palety a trojice akcentů prošla kontrolou odstupu pro barvosleposti.

## Přístupnost a ovládání

Přejetím myší nebo prstem se zobrazí svislý kurzor a řádek s hodnotami pro danou
hodinu. Tlačítko **Tabulka** přepne na všech 72 řádků, takže hodnoty jsou
dostupné i bez čtení grafu. Noc je v grafu podbarvená a svislá linka **teď**
ukazuje aktuální hodinu.

## Offline a instalace

Service worker ukládá skořápku aplikace a poslední předpověď. Předpověď se
načítá strategií „nejdřív síť", takže nový běh vždy vyhraje, a při výpadku se
použije uložená kopie.

Patička vždy uvádí stáří předpovědi, počítané z pole `generated_at`, a jednou
za minutu je přepočítá, aby údaj neustrnul u aplikace nechané otevřené. Když
stáří přesáhne šest hodin, přibude k němu žlutý odznak.

Stáří je spolehlivější signál než stav připojení. Hlavička odpovědi řadu případů
mine, protože požadavek může uspět z cache prohlížeče, aniž by se záložní větev
service workeru vůbec spustila, a `navigator.onLine` zase v některých
prostředích hlásí nepřipojeno i při funkční síti.

Tlačítko se šipkou v hlavičce vynutí načtení znovu. Přidává k adrese časové
razítko a žádá `cache: "reload"`, jinak by CDN před GitHub Pages mohla vrátit
právě tu kopii, kterou se uživatel snaží nahradit.

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
