#!/usr/bin/env bash
# Bygger data/chart-aland.pmtiles av de förberedda kartlagren. Skippar filen om den blir för stor för GitHub.
set -euo pipefail
shopt -s nullglob
python3 scripts/prepare_layers.py
MARKS="aids lights daymarks faults signs pilot navline leadline"   # ligger i data/marks.geojson
LINES="depcnt steep"   # djupkurvor och branter: egen fil där inga linjer gallras bort (annars försvinner de flesta)
# stenar: egen fil där inget gallras från zoom 11 (-B11)
if [ -f build/rocks.geojsonl ]; then
  tippecanoe -o build/rocks-aland.pmtiles --force -Z11 -z14 -B11 --no-feature-limit --no-tile-size-limit \
    --name "Kummel stenar Åland" --attribution "Maanmittauslaitos, CC BY 4.0" -L rocks:build/rocks.geojsonl 2>&1 | { grep -v "%" || true; } | tail -3
  cp build/rocks-aland.pmtiles data/
fi
largs=()
for n in $LINES; do [ -f "build/layers/$n.geojsonl" ] && largs+=(-L "$n:build/layers/$n.geojsonl"); done
if [ ${#largs[@]} -gt 0 ]; then
  tippecanoe -o build/lines-aland.pmtiles --force -Z11 -z14 --no-feature-limit --no-tile-size-limit --simplification=4 \
    --name "Kummel djupkurvor Åland" --attribution "Traficom, CC BY 4.0. Ej för navigering." "${largs[@]}" 2>&1 | { grep -v "%" || true; } | tail -3
  lsize=$(stat -c %s build/lines-aland.pmtiles)
  echo "- Djupkurvor och branter: $((lsize/1024/1024)) MB" >> data/chart-log.md
  if [ "$lsize" -lt 95000000 ]; then cp build/lines-aland.pmtiles data/; fi
fi
files=(build/layers/*.geojsonl)
if [ ${#files[@]} -eq 0 ]; then echo "Inga lager att bygga"; exit 1; fi
args=()
for f in "${files[@]}"; do n=$(basename "$f" .geojsonl); case " $MARKS $LINES " in *" $n "*) continue;; esac; args+=(-L "$n:${f}"); done
tippecanoe -o build/chart-aland.pmtiles --force -P \
  -Z5 -z14 --simplification=4 --detect-shared-borders \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name "Kummel sjökort Åland" \
  --attribution "Traficom, Väylävirasto, CC BY 4.0. Ej för navigering." \
  "${args[@]}" 2>&1 | grep -v "%" | tail -20
size=$(stat -c %s build/chart-aland.pmtiles)
echo "- Tiles byggda: $((size/1024/1024)) MB" >> data/chart-log.md
if [ "$size" -lt 95000000 ]; then cp build/chart-aland.pmtiles data/; else echo "- För stor för repot, sparas inte" >> data/chart-log.md; fi
