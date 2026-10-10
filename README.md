# Větev data

Publikovaná předpověď aplikace mys-aladin. Větev nemá společnou historii
s `main` a drží jediný soubor `forecast.json`, který sem commituje workflow
`forecast` po každém novém běhu modelu. Workflow `pages` odsud bere data pro
web, kde leží na adrese `data/forecast.json`.

Ručně sem necommituj. Kód, dokumentace a popis formátu jsou ve větvi `main`
(`docs/pipeline.md`).
