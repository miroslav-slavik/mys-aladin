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

Graf ukazuje prvních **60 hodin** a vejde se na šířku displeje, takže se nikam
neposouvá a celý průběh je vidět najednou. To je proti dřívější verzi zásadní
změna: ta měla graf v posuvníku a bylo nutné jej rolovat.

Posledních dvanáct hodin se do grafu nekreslí. Při všech 72 hodinách vychází na
telefonu asi čtyři pixely na hodinu, což je na čtení málo, a konec dosahu je
zároveň nejméně spolehlivá část běhu. Tabulka nadále obsahuje všech 72 hodin.
Rozsah řídí konstanta `CHART_HOURS` v `web/app.js`.

| Pohled | Forma |
|---|---|
| Teplota | plocha s křivkou, k tomu modré sloupce srážek |
| Vítr | plocha s křivkou rychlosti a řádek šipek se směrem |
| Oblačnost | plocha na pevné ose 0 až 100 % |
| Tabulka | všech 72 hodin předpovědi |

**Svislé osy nemají popisky.** Na přání uživatele zmizely jak stupně vlevo, tak
milimetry vpravo. Graf tím získal obě postranní pásma a kreslí se přes celou
šířku karty. Konkrétní hodnoty nese trojice přímých popisků v křivce, hlavička
při dotyku a tabulka. Vodorovné vodicí čáry zůstávají, takže tvar průběhu si
zachovává měřítko, jen bez čísel.

**Popisek na začátku křivky.** Vedle maxima a minima je označena i hodnota
prvního kroku, aby bylo hned zřejmé, odkud předpověď vychází.

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

**Veličiny v hlavičce označují ikony, ne slova**, stejně jako v předloze:
teploměr, přeháňka, větrná turbína a mrak. Kreslené jsou zdejší, jen podle
předlohy: obrázky na `aladinonline.oblacno.cz` jsou cizí dílo bez otevřené
licence (CC BY 4.0 se týká dat ČHMÚ, ne grafiky té stránky), takže se
nepřebírají. Každá ikona nese barvu, kterou má veličina v grafu, a název
veličiny zůstává v textu pro čtečky obrazovky.

Ikony počasí se odvozují z oblačnosti, srážek, teploty a denní doby. Kreslí se
jako SVG přímo v kódu, takže nejsou potřeba žádné obrázkové soubory.

Kreslí se v 32 px, aby byly na telefonu čitelné na první pohled. Kolik se jich
do řádku vejde, tolik se jich ukáže, a krok se zaokrouhlí na celé hodiny: na
šířce iPhonu vychází ikona po šesti hodinách.

## Vzhled

Aplikace má jen tmavou podobu, stejně jako předloha. Barvy jsou tmavé kroky
ověřené palety a trojice akcentů prošla kontrolou odstupu pro barvosleposti.

## Dotyk v grafu

Přejetím prstem nebo myší se zobrazí svislá čárkovaná čára a hodnoty vybrané
hodiny se objeví **v hlavičce**, tedy tam, kde se čtou i bez dotyku. U čáry
zůstává jen bublina se dnem a pod ním s hodinou. Po zvednutí prstu se hlavička
vrací na aktuální hodinu.

Prst smí po grafu jezdit i svisle: graf si při dotyku zabírá celé gesto
(`touch-action: none`) a zachytává ukazatel. Dřív stačilo svislé škubnutí,
prohlížeč jej vyhodnotil jako rolování stránky, gesto si vzal a čára zmizela.
Odečítá se jen vodorovná poloha, takže svislý pohyb hodnotu nemění. Stránka se
roluje odkudkoli mimo graf.

Den je v bublině slovem: „dnes", „zítra", „pozítří". Čte se rychleji než číslo
a v dosahu grafu jiný den skoro nepřipadá v úvahu. Zbytek pokrývá datum: běh
může začínat před půlnocí a šedesát hodin z pozdního večera dosáhne až na
čtvrtý den.

Samostatný řádek s hodnotami pod grafem tím zanikl: dvě místa se stejnými čísly
si konkurovala a hodnoty byly daleko od velkého údaje nahoře.

Hlavička neuvádí směr větru. Úhel ve stupních se špatně čte a v grafu ho lépe
ukáží šipky v pohledu **Vítr**; v tabulce zůstává číselně.

Svislá linka **teď** je světle žlutá, aby ji nešlo splést s čárkovaným kurzorem.

## Přístupnost a ovládání

Tlačítko **Tabulka** přepne na všech 72 řádků, takže hodnoty jsou dostupné
i bez čtení grafu. Noc je v grafu podbarvená.

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

**Nová verze se ukáže po jednom otevření.** Skořápka jde z cache, takže se nové
soubory dostanou na obrazovku, až převezme řízení nový service worker. Sám od
sebe to trvá dvě otevření: první nový worker jen na pozadí nainstaluje a zobrazí
přitom starou stránku. Aplikace proto při každém otevření i při návratu na
popředí volá `registration.update()` a při události `controllerchange` se sama
načte znovu. Ověřeno v prohlížeči: s touto úpravou stačí jedno otevření, bez ní
zůstala po prvním otevření stará verze.

Service worker si navíc soubory při instalaci stahuje s `cache: "reload"`.
GitHub Pages je posílá s desetiminutovou platností, takže bez toho může nová
cache dostat právě ty soubory, které má nová verze nahradit.

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
