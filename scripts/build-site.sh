#!/usr/bin/env bash
# Assemble the static site: the PWA at the root, the forecast under data/.
# Used both by the Pages workflow and for local preview, so the layout the
# browser sees is the same in both places.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/site}"

rm -rf "$OUT"
mkdir -p "$OUT/data"
cp -R "$ROOT/web/." "$OUT/"
cp "$ROOT/data/forecast.json" "$OUT/data/forecast.json"

echo "site assembled in $OUT"
