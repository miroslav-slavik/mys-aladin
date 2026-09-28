# Spouštěč na Cloudflare

Plánované běhy v GitHub Actions jsou jen „best effort“. V září 2026 se
z šestnácti slotů denně spouštělo zhruba devět, s hodinovým až dvouhodinovým
zpožděním, a noční sloty mezi 02 a 09 UTC odpadaly celé. Běh modelu se tak na
web dostával za 3–6 hodin po zveřejnění místo plánovaných 34–42 minut.

Spouštěč je Cloudflare Worker v adresáři `cloudflare/dispatch/`. Workflow
`forecast` spouští přes `workflow_dispatch`, a to jen tehdy, když na serveru
ČHMÚ čeká novější kompletní běh, než jaký ukazuje web. Cron ve workflow zůstává
jako záloha.

## Jak rozhoduje

Worker se probouzí každých deset minut a při každém probuzení postupuje takto:

1. Z publikovaného `data/forecast.json` na Pages přečte `run_id`, tedy běh,
   který je na webu. K adrese přidá parametr s časem, aby obešel
   desetiminutovou cache GitHub Pages.
2. Spočítá, které další běhy už ČHMÚ mohl zveřejnit. Běhy jdou po šesti
   hodinách a nejdřív se čekají tři hodiny po nominálním čase (naměřeno 3,5 h
   u běhů 00 a 12, 4,5 h u běhů 06 a 18). Pokud žádný takový běh není, skončí
   a na ČHMÚ se vůbec neptá.
3. Přečte výpis adresáře jen u těch běhů, které čeká, obvykle tedy jediný.
   Kompletnost posuzuje stejně jako pipeline: běh má všech 31 souborů.
4. Pokud je novější běh kompletní, spustí workflow a zapíše pokus do KV.

Čekání na zveřejnění obvykle trvá od třetí hodiny po nominálním čase do
zveřejnění, tedy půl hodiny až hodinu a půl, což je 3–9 výpisů na běh.
Denně to dělá 12–36 výpisů adresáře; stránky Pages se Worker ptá při každém
probuzení. Když se běh opozdí o víc než tři
hodiny oproti nejdřívější očekávané době, Worker se ptá už jen jednou za hodinu.

Očekávané zpoždění publikace je do deseti minut na další tik a zhruba dvě
minuty na běh `forecast` a nasazení `pages`.

## Pojistky

- **Nejvýš tři spuštění na jeden běh modelu, s odstupem 30 minut.** Záznam
  `dispatch:<run_id>` v KV nese počet pokusů a čas posledního. Odstup pokrývá
  doběhnutí workflow, nasazení Pages i jejich cache, takže běh, který se právě
  publikuje, se nespustí podruhé. Workflow, které opakovaně padá, se tak
  nespouští každých deset minut. Každý takový pokus totiž může stáhnout celý
  běh z ČHMÚ. Po třech pokusech se běh nechá záložnímu cronu. Záznamy samy
  vyprší po třech dnech.
- **Odmítnuté spuštění se nepočítá.** Když GitHub spuštění odmítne (například
  kvůli prošlému tokenu), nic neběželo a nic se nestáhlo. Worker to zapíše do
  logu jako chybu a zkusí to při dalším probuzení.
- **Bez vstupů.** Worker nikdy nepředává `force`, vynucené přestavění zůstává
  ruční volbou.
- **Bez veřejné adresy.** `workers_dev = false`: Worker reaguje jen na svůj
  plán, zvenku se na něj nedá zavolat.

Některá fakta pipeline Worker opakuje v JavaScriptu: počet souborů běhu, vzor
jejich názvů, krok mezi běhy a adresu zdroje. Test `tests/test_dispatch.py`
hlídá, že se obě kopie nerozejdou.

## Nasazení

Potřeba je účet Cloudflare (plán Free) a na GitHubu fine-grained token:
Settings → Developer settings → Fine-grained tokens, Repository access jen
`mys-aladin`, Permissions → Actions: Read and write, nic dalšího.

### Z příkazové řádky

Na počítači s Node.js v adresáři `cloudflare/dispatch/`:

```sh
npx wrangler@4 login
npx wrangler@4 kv namespace create STATE
```

Druhý příkaz vypíše `id` jmenného prostoru. To patří do `wrangler.toml` místo
`REPLACE_WITH_NAMESPACE_ID`; není tajné, může být v gitu. Pak:

```sh
npx wrangler@4 deploy
npx wrangler@4 secret put GITHUB_TOKEN
```

Token se vkládá až na výzvu příkazu, do historie shellu se tak nedostane.
Mezi nasazením a vložením tokenu Worker při případném probuzení jen zapíše do
logu odmítnuté spuštění, nic tím nerozbije.

Průběh jde sledovat příkazem `npx wrangler@4 tail`. Každé probuzení zapíše
jeden řádek, například `wait: 2026-09-28T00:00Z has 30/31 files` nebo
`dispatch: attempt 1 of 3`. Stejné řádky jsou v dashboardu v logu Workeru.

### Přes dashboard

Workers & Pages → Create → Worker. Do editoru vlož `src/index.js`. V nastavení
Workeru přidej:

- proměnné z oddílu `[vars]` ve `wrangler.toml`,
- secret `GITHUB_TOKEN`,
- vazbu na KV namespace pod jménem `STATE`,
- Cron Trigger `*/10 * * * *`,
- a vypni veřejnou adresu `workers.dev`.

### Místní vyzkoušení

`npx wrangler@4 dev --test-scheduled` spustí Worker lokálně. Jedno probuzení
vyvolá `curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"`. Token pro
lokální běh patří do souboru `.dev.vars`, který git ignoruje. Bez tokenu dojde
lokální běh nejvýš ke spuštění, které GitHub odmítne.

## Testy

Logika Workeru má vlastní testy pro vestavěný běhový nástroj Node.js, bez
dalších závislostí:

```sh
cd cloudflare/dispatch && node --test
```

Běží proti falešnému webu, výpisům ČHMÚ a API GitHubu, takže nic nestahují.
Workflow `forecast` je zatím nespouští, pouští jen `tests/test_dispatch.py`.

## Neověřeno

Limity plánu Free jsem nemohl ověřit online; dokumentace Cloudflare je
z prostředí, kde spouštěč vznikl, blokovaná. Podle znalostí z paměti jde
o 100 000 požadavků denně, Cron Triggery jsou v ceně a CPU je 10 ms na volání,
přičemž čekání na síť se nepočítá. KV má kolem 100 000 čtení a 1 000 zápisů
denně. Spouštěč potřebuje 144 probuzení, desítky čtení a nejvýš jednotky
zápisů denně.
