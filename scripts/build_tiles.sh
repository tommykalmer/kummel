#!/usr/bin/env bash
# Bygger data/chart-aland.pmtiles av alla hämtade lager (ett vektorlager per fil).
set -euo pipefail
shopt -s nullglob
files=(build/geojson/*.geojsonl)
if [ ${#files[@]} -eq 0 ]; then echo "Inga lager att bygga"; exit 1; fi
args=()
for f in "${files[@]}"; do
  name=$(basename "$f" .geojsonl)
  args+=(-L "${name}:${f}")
done
tippecanoe -o data/chart-aland.pmtiles --force -P \
  -Z5 -z14 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name "Kummel sjökort Åland" \
  --attribution "Traficom, CC BY 4.0. Ej för navigering." \
  "${args[@]}" 2>&1 | tail -20
ls -la data/
echo "- Tiles byggda: $(du -h data/chart-aland.pmtiles | cut -f1)" >> data/chart-log.md
