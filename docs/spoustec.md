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

Worker nasazuje workflow `.github/workflows/dispatcher.yml`. Spustí se samo po
každé změně v `cloudflare/dispatch/` ve větvi `main` a jde spustit i ručně přes
**Actions → dispatcher → Run workflow**. Nejdřív spustí testy Workeru. Pak
najde jmenný prostor KV `mys-aladin-dispatch-state`, nebo ho při prvním běhu
založí, a jeho `id` doplní do `wrangler.toml` místo
`REPLACE_WITH_NAMESPACE_ID`. Potom Worker nasadí a předá mu token pro GitHub
jako secret `GITHUB_TOKEN`.

Přihlašovací údaje leží jen v secrets repozitáře (Settings → Secrets and
variables → Actions):

| Secret | Obsah |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Account API token Cloudflare s oprávněními Workers Scripts Write, Workers KV Storage Write a Account Settings Read, nic víc |
| `CLOUDFLARE_ACCOUNT_ID` | Identifikátor účtu, hexadecimální řetězec v adrese dashboardu (`dash.cloudflare.com/<id>/…`) |
| `DISPATCH_GITHUB_TOKEN` | Fine-grained token GitHubu jen pro repozitář `mys-aladin`, oprávnění Actions: Read and write, nic dalšího |

Účet Cloudflare musí mít subdoménu `*.workers.dev`, jinak Cloudflare odmítne
nastavit plán (chyba 10063), i když Worker veřejnou adresu nemá. Subdoména se
založí při prvním otevření stránky Workers & Pages v dashboardu. Při prvním
nasazení 10. 10. 2026 chyběla, Worker se nahrál bez plánu a pomohlo otevřít
dashboard a spustit workflow znovu.

Chybějící secret workflow ohlásí jménem hned v prvním kroku. Obnovený token
stačí uložit do secretu a workflow spustit ručně; secret Workeru se nastavuje
při každém nasazení znovu.

Mezi nasazením a předáním tokenu Worker při případném probuzení jen zapíše do
logu odmítnuté spuštění, nic tím nerozbije. Každé probuzení zapíše jeden řádek,
například `wait: 2026-09-28T00:00Z has 30/31 files` nebo `dispatch: attempt 1
of 3`. Řádky jsou v dashboardu Cloudflare v logu Workeru (Workers & Pages →
`mys-aladin-dispatch` → Logs).

Nasazeno 10. 10. 2026 během `dispatcher` #1 (druhý pokus): plán
`*/10 * * * *`, úložiště KV `mys-aladin-dispatch-state` a secret
`GITHUB_TOKEN`.

### Ruční nasazení

Bez GitHub Actions jde Worker nasadit z počítače s Node.js v adresáři
`cloudflare/dispatch/`. Postup: `npx wrangler@4 login`, pak `npx wrangler@4 kv
namespace create STATE` a vypsané `id` vložit do `wrangler.toml`. Potom `npx
wrangler@4 deploy` a `npx wrangler@4 secret put GITHUB_TOKEN`, který si token
vyžádá na výzvu, takže se nedostane do historie shellu.

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
Pouští je workflow `dispatcher` před každým nasazením. Workflow `forecast` je
nespouští, z kontroly Workeru u něj běží jen `tests/test_dispatch.py`.

## Neověřeno

Limity plánu Free jsem nemohl ověřit online; dokumentace Cloudflare je
z prostředí, kde spouštěč vznikl, blokovaná. Podle znalostí z paměti jde
o 100 000 požadavků denně, Cron Triggery jsou v ceně a CPU je 10 ms na volání,
přičemž čekání na síť se nepočítá. KV má kolem 100 000 čtení a 1 000 zápisů
denně. Spouštěč potřebuje 144 probuzení, desítky čtení a nejvýš jednotky
zápisů denně.
