#!/usr/bin/env bash
# Diagnostik: vilka zoomnivåer har MML:s flygbild (ortokuva) i WGS84_Pseudo-Mercator?
KEY=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
out=data/diag.md; echo "# Diagnostik $(date -u)" > $out; echo "## ortokuva zoomnivåer (Mariehamn 60.09,19.94)" >> $out
for z in 14 15 16 17 18 19 20; do
  read x y < <(python3 -c "import math;z=$z;la=60.0905;lo=19.9255;n=2**z;x=int((lo+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(la)))/math.pi)/2*n);print(x,y)")
  r=$(curl -s -o /tmp/t.jpg -w '%{http_code} %{size_download} %{content_type}' "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/$z/$y/$x.jpg?api-key=$KEY")
  echo "- z$z: $r" >> $out
done
cat $out
