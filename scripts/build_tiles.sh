#!/usr/bin/env bash
# Bygger data/chart-aland.pmtiles av de förberedda kartlagren. Skippar filen om den blir för stor för GitHub.
set -euo pipefail
shopt -s nullglob
python3 scripts/prepare_layers.py
files=(build/layers/*.geojsonl)
if [ ${#files[@]} -eq 0 ]; then echo "Inga lager att bygga"; exit 1; fi
args=()
for f in "${files[@]}"; do args+=(-L "$(basename "$f" .geojsonl):${f}"); done
tippecanoe -o build/chart-aland.pmtiles --force -P \
  -Z5 -z14 --simplification=4 --detect-shared-borders \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name "Kummel sjökort Åland" \
  --attribution "Traficom, Väylävirasto, CC BY 4.0. Ej för navigering." \
  "${args[@]}" 2>&1 | grep -v "%" | tail -20
size=$(stat -c %s build/chart-aland.pmtiles)
echo "- Tiles byggda: $((size/1024/1024)) MB" >> data/chart-log.md
if [ "$size" -lt 95000000 ]; then cp build/chart-aland.pmtiles data/; else echo "- För stor för repot, sparas inte" >> data/chart-log.md; fi
