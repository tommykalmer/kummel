#!/usr/bin/env bash
# Bygger data/chart-aland.pmtiles av de förberedda kartlagren. Skippar filen om den blir för stor för GitHub.
set -euo pipefail
shopt -s nullglob
python3 scripts/prepare_layers.py
# sjömärken i egen fil som aldrig gallras, så att alla märken syns i alla zoomnivåer
MARKS="aids lights daymarks faults signs pilot"
margs=()
for n in $MARKS; do [ -f "build/layers/$n.geojsonl" ] && margs+=(-L "$n:build/layers/$n.geojsonl"); done
tippecanoe -o build/marks-aland.pmtiles --force -Z6 -z14 -r1 --no-feature-limit --no-tile-size-limit \
  --name "Kummel sjömärken Åland" --attribution "Väylävirasto, CC BY 4.0" "${margs[@]}" 2>&1 | grep -v "%" | tail -5
cp build/marks-aland.pmtiles data/
files=(build/layers/*.geojsonl)
if [ ${#files[@]} -eq 0 ]; then echo "Inga lager att bygga"; exit 1; fi
args=()
for f in "${files[@]}"; do n=$(basename "$f" .geojsonl); case " $MARKS " in *" $n "*) continue;; esac; args+=(-L "$n:${f}"); done
tippecanoe -o build/chart-aland.pmtiles --force -P \
  -Z5 -z14 --simplification=4 --detect-shared-borders \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name "Kummel sjökort Åland" \
  --attribution "Traficom, Väylävirasto, CC BY 4.0. Ej för navigering." \
  "${args[@]}" 2>&1 | grep -v "%" | tail -20
size=$(stat -c %s build/chart-aland.pmtiles)
echo "- Tiles byggda: $((size/1024/1024)) MB" >> data/chart-log.md
if [ "$size" -lt 95000000 ]; then cp build/chart-aland.pmtiles data/; else echo "- För stor för repot, sparas inte" >> data/chart-log.md; fi
