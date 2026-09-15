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

**Mřížka je nejspodnější vrstva.** Vodicí čáry i šestihodinové svislice se
kreslí jako první a ořezávají se na tu část plochy, kterou křivka nezakrývá
(`clipPath` s pravidlem even-odd). Dřív prosvítaly poloprůhlednou výplní a
svislice se navíc kreslily až po křivce, takže přecházely přes graf i přes
čísla. Nad mřížkou tak leží plocha, křivka, sloupce srážek, popisky, linka
**teď** i čárkovaný kurzor. Texty v grafu mají kolem sebe tenkou svatozář
v barvě podkladu, aby zůstaly čitelné i tam, kde za nimi vede čára.

**Dny jsou odlišené podkladem.** Podklad se střídá: dnešek stojí na barvě
stránky, zítřek má o odstín světlejší pozadí (`--day-band`, bílá s krytím
0,06), pozítří je zase na barvě stránky. Každá hranice dne je tím změnou
podkladu.

Noc se v grafu nepodbarvuje. Dřív měla vlastní tmavý pás přes hodiny 21 až 6,
ale vedle podkladu dnů začalo být pásů v grafu příliš; noc nese řádek ikon
s měsícem a hodiny na ose.

Podklad je pozadí ve stejném smyslu jako mřížka a **ořezává se stejným
`clipPath`**, takže se skrz poloprůhlednou výplň grafu vůbec neprojeví. Bez
toho prosvítal a působil, jako by ležel před grafem. Důsledek je, že v
pohledech, kde plocha zabírá skoro celou výšku, je podklad vidět jen nad
křivkou.
Půlnoc navíc kreslí silnější svislici než ostatní šestihodinové značky.

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

## Volba místa

Název místa v hlavičce je tlačítko a otevírá panel míst. Ten nabízí tři cesty,
jak se dostat k předpovědi pro místo, které pipeline nezná:

- **Moje poloha** přes `navigator.geolocation`. Bod se pojmenuje podle nejbližší
  obce, pokud leží do zhruba pěti kilometrů, jinak podle souřadnic.
- **Hledání podle názvu.** Seznam 15 279 míst je zabalený v aplikaci
  (`web/places.json`, 575 kB, po gzipu 196 kB), takže hledání funguje offline
  a aplikace za běhu nikam nevolá. Je v něm 6 256 obcí a 9 023 částí obcí,
  tedy i městské čtvrti. Hledá se bez ohledu na diakritiku, takže „sumper"
  najde Šumperk, a obec má přednost před částí, aby „Brno" našlo město, ne
  Brno-Bystrc. Seznam vyrábí `scripts/make-places.py` ze dvou vrstev služby
  Geonames ČÚZK; spouští se ručně, není součástí plánovaného běhu.

  Části obcí jsou v seznamu hlavně kvůli velkým městům a kvůli pojmenování
  polohy z telefonu. Praha je jako obec jediný bod v centru, takže poloha
  v Kyjích od něj leží asi 10,5 km a nejbližší samostatná obec je Radonice
  5,1 km daleko; místo se pak pojmenovalo souřadnicemi. S částmi vyjde
  nejbližší místo 0,6 km daleko, tedy Černý Most. Část pojmenovaná stejně jako
  její obec se do seznamu nepřidává, protože už tam ta obec je; z 15 128
  částí proto zbylo 9 023.

  Podrobnosti u výsledků, tedy okres u obce a nadřazená obec u části, se
  opakují po tisících, takže leží v tabulce `details` a řádky do ní jen
  odkazují indexem.
- **Souřadnice** zadané jako „50,11 14,56" nebo „50.11, 14.56".

Panel je přisazený k dolní hraně obrazovky a jeho výška se počítá z toho, co je
skutečně vidět, ne z `vh`. Safari na iPhonu totiž počítá `vh` i s plochou za
lištami prohlížeče a pevně umístěné prvky váže na rozvržení stránky, ne na
viditelnou část, takže panel sahal pod okraj displeje a po vyvolání klávesnice
zmizel za ní. Použije se `dvh` a nad tím ještě dopočet z `window.visualViewport`
při otevření panelu a při každé změně viditelné plochy. Ověřeno v prohlížeči
i pro případ zmenšené viditelné plochy, který odpovídá vysunuté klávesnici.

Bod uložený dřív, než seznam znal části obcí, nese jako název své souřadnice.
Při otevření panelu, kdy se seznam stejně načítá, aplikace takový název
přepíše na nejbližší místo; týká se to zvoleného místa i posledních bodů.
Místa, která už jednou název dostala, zůstávají beze změny.

Zvolené místo se pamatuje v `localStorage`, takže aplikace se otevře tam, kde
naposledy skončila, a posledních šest bodů zůstává v panelu k opakovanému
výběru. Když je úložiště nedostupné, aplikace se prostě otevře na prvním
uloženém místě.

### Dvě třídy míst

| | Uložená místa | Místo zadané v aplikaci |
|---|---|---|
| Zdroj | `data/forecast.json` | dlaždice plošného balíku |
| Mřížka | 1 km | 2 km, u názvu je odznak „2 km" |
| Veličiny | všech pět | teplota, srážky, oblačnost |
| Vítr | ano | ne |

Vítr v plošném balíku není, takže se u zadaného místa skryje: tlačítko **Vítr**
zmizí z přepínače, dlaždice s větrem z hlavičky a sloupec z tabulky. Řídí to
jediná třída `no-wind` na `body`, zbytek je v CSS. Kdyby byl zrovna aktivní
pohled na vítr, přepne se na teplotu.

Patička u zadaného místa uvádí, jak daleko leží nejbližší bod mřížky. Bod mimo
doménu modelu panel odmítne se srozumitelnou hláškou, stejně jako situaci, kdy
plošný balík ještě není publikovaný; v obou případech zůstane na obrazovce
poslední funkční místo.

### Povýšení místa na plné rozlišení

U místa zadaného v aplikaci nabídne panel, že ho přidá mezi uložená. Aplikace
do repozitáře psát nemůže — neměla by k tomu přístupové údaje a mít je ve
stránce, která běží v telefonu, by bylo horší než ta trocha nepohodlí. Připraví
tedy obsah souboru a předá ho dál:

- **Založit soubor na GitHubu** otevře webový editor s předvyplněnou cestou
  `places/<název>.json` i obsahem, takže stačí potvrdit commit.
- **Zkopírovat obsah souboru** dá totéž do schránky, kdyby předvyplnění
  nefungovalo.

Název souboru vznikne z názvu místa bez diakritiky, tedy „Pec pod Sněžkou" dá
`places/pec-pod-snezkou.json`. Po nejbližším běhu modelu je místo v
`forecast.json` v rozlišení 1 km a s větrem.

Aplikace si toho všimne sama: uložený bod, ke kterému se v předpovědi objeví
místo se shodnými souřadnicemi, se tiše nahradí tím místem. Odznak „2 km"
zmizí, vítr se vrátí. Ověřeno v prohlížeči proti předpovědi, která to místo už
obsahuje.

### Čtení dlaždice

Kód je v `web/area.js` a o formátu nic nepředpokládá: počátek a krok mřížky,
velikost dlaždice, pořadí veličin i jejich měřítka bere z `data/area/index.json`.
Z indexu se spočítá nejbližší bod, z něj dlaždice, a z ní se přečte celá časová
řada jednoho bodu. Hodnoty se čtou přes `DataView` po jednotlivých číslech,
nikoli typovaným polem nad `ArrayBuffer`, aby na zarovnání sekcí nezáleželo.

Řádky mají stejný tvar jako řádky z `forecast.json`, takže graf, ikony
i tabulka nepoznají, odkud data přišla. Popis formátu je v `pipeline.md`.

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
i bez čtení grafu.

## Offline a instalace

Service worker ukládá skořápku aplikace a poslední předpověď. Předpověď se
načítá strategií „nejdřív síť", takže nový běh vždy vyhraje, a při výpadku se
použije uložená kopie.

Dlaždice plošného balíku mají vlastní cache `mys-aladin-tiles-v1` a drží se
z nich posledních dvanáct. Oddělená cache brání tomu, aby pár míst prohlédnutých
na cestách vytlačilo skořápku aplikace; dlaždice patří jednomu běhu modelu,
takže i u nich rozhoduje síť a uložená kopie je až náhradní odpověď.

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

Po změně souborů v `web/` je potřeba zvýšit `CACHE` v `web/sw.js` **a zároveň
`APP_VERSION` v `web/app.js`**. Obě čísla hlídá `tests/test_web.py`, takže se
nemohou rozejít.

Poslední řádek patičky uvádí obojí: verzi aplikace, která je zapsaná v právě
běžícím `app.js`, a název cache, na který odpoví service worker. Když se
rozcházejí, je na obrazovce stará verze a nová už čeká nainstalovaná; po
zavření a otevření aplikace se srovnají. Když stránku žádný worker neřídí,
třeba při prvním otevření, řádek to říká místo názvu cache.

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

Kromě obsahu repozitáře bere nasazení ještě plošný balík, který v repozitáři
není: vyzvedne si jej z cache Actions, kam ho uložil poslední běh `forecast`.
Podrobnosti jsou v `pipeline.md`. Skript `scripts/build-site.sh` hledá balík
v `build/area`, respektive v adresáři z proměnné `AREA_DIR`, a když ho
nenajde, sestaví web bez něj.

Před prvním nasazením je potřeba v **Settings → Pages** nastavit zdroj na
**GitHub Actions**.
