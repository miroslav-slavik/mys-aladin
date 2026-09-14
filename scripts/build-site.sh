#!/usr/bin/env bash
# Assemble the static site: the PWA at the root, the forecast under data/, and
# the area pack under data/area/ when a run has produced one.
# Used both by the Pages workflow and for local preview, so the layout the
# browser sees is the same in both places.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/site}"
AREA="${AREA_DIR:-$ROOT/build/area}"

rm -rf "$OUT"
mkdir -p "$OUT/data"
cp -R "$ROOT/web/." "$OUT/"
cp "$ROOT/data/forecast.json" "$OUT/data/forecast.json"

# The pack is never committed, so it reaches the deploy through the cache of
# the forecast workflow. Without it the site still works, only places that
# were not listed in advance cannot be answered.
if [ -d "$AREA" ]; then
  mkdir -p "$OUT/data/area"
  cp -R "$AREA/." "$OUT/data/area/"
  echo "area pack: $(find "$OUT/data/area" -name '*.bin' | wc -l) tiles, $(du -sh "$OUT/data/area" | cut -f1)"
else
  echo "area pack missing at $AREA: publishing the listed locations only"
fi

echo "site assembled in $OUT"
