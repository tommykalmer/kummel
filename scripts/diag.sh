#!/usr/bin/env bash
# Diagnostik: flygbildens skärpa. Jämför WMTS z18 (Pseudo-Mercator) med WMS i högre upplösning för samma ruta.
KEY=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
mkdir -p data/diag; out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
read x y minx miny maxx maxy < <(python3 -c "
import math
z=18;la=60.10292;lo=20.05887;n=2**z
x=int((lo+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(la)))/math.pi)/2*n)
R=20037508.342789244;s=2*R/n
print(x,y,-R+x*s,R-(y+1)*s,-R+(x+1)*s,R-y*s)")
r=$(curl -s -o data/diag/sharp-wmts-z18.jpg -w '%{http_code} %{size_download}' "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/18/$y/$x.jpg?api-key=$KEY")
echo "- wmts z18: $r" >> $out
for px in 256 1024; do
  r=$(curl -s -o data/diag/sharp-wms-$px.jpg -w '%{http_code} %{size_download} %{content_type}' "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wms?service=WMS&version=1.3.0&request=GetMap&layers=ortokuva&styles=&crs=EPSG:3857&bbox=$minx,$miny,$maxx,$maxy&width=$px&height=$px&format=image/jpeg&api-key=$KEY")
  echo "- wms $px px: $r" >> $out
done
head -c 300 data/diag/sharp-wms-1024.jpg | strings | head -3 >> $out
cat $out
