#!/usr/bin/env bash
# Diagnostik: hämta flygbildsrutor där användaren såg rosa fläckar
key=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
mkdir -p data/diag
python3 - > /tmp/tiles <<'PY'
import math
for lat,lon in [(60.0350,19.905),(60.030,19.898)]:
  for z in (13,14):
    n=2**z; x=int((lon+180)/360*n); y=int((1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n)
    print(z,x,y)
PY
while read z x y; do
  curl -s -m 30 -o "data/diag/orto_${z}_${x}_${y}.jpg" "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/$z/$y/$x.jpg?api-key=$key"
  curl -s -m 30 -o "data/diag/esri_${z}_${x}_${y}.jpg" "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/$z/$y/$x"
done < /tmp/tiles
ls -la data/diag > data/diag.md
