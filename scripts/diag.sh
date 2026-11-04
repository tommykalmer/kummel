#!/usr/bin/env bash
# Diagnostik: Maanmittauslaitos flygbild och fastighetsgränser på Åland (nyckel från config.js)
out=data/diag.md
key=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
echo "# Diagnostik $(date -u)" > $out
python3 - > /tmp/tiles <<'PY'
import math
for name,lat,lon in [("Mariehamn",60.097,19.935),("Föglö",60.03,20.42),("Helsingfors",60.17,24.94)]:
  for z in (15,16):
    n=2**z; x=int((lon+180)/360*n); y=int((1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n)
    print(name,z,x,y)
PY
while read name z x y; do
  for layer in ortokuva:jpg kiinteistojaotus:png; do
    l=${layer%%:*}; f=${layer##*:}
    r=$(curl -s -m 30 -o /tmp/t -D /tmp/h -w "%{http_code} %{size_download}" -H "Origin: https://tommykalmer.github.io" "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/$l/default/WGS84_Pseudo-Mercator/$z/$y/$x.$f?api-key=$key")
    cors=$(grep -i "access-control-allow-origin" /tmp/h | tr -d '\r')
    echo "- $name z$z $l → $r $cors" >> $out
  done
done < /tmp/tiles
cat $out
