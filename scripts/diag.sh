#!/usr/bin/env bash
# Diagnostik: vilka lager finns i Traficoms WMS-tjänster, och tillåter kartbildstjänsten CORS?
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
for svc in avoin rajoitettu; do
  echo "## WMS $svc" >> $out
  curl -s -m 60 "https://julkinen.traficom.fi/inspirepalvelu/$svc/wms?service=WMS&request=GetCapabilities" \
    | grep -o "<Name>[^<]*</Name>" | sed 's/<[^>]*>//g' | sort -u | sed 's/^/- /' >> $out
done
echo "## CORS kartbild" >> $out
curl -s -m 30 -o /dev/null -D - -H "Origin: https://tommykalmer.github.io" \
  "https://julkinen.traficom.fi/rasteripalvelu/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=Traficom%3AMerikarttasarjat%20public&STYLE=&FORMAT=image%2Fpng&TILEMATRIXSET=WGS84_Pseudo-Mercator&TILEMATRIX=WGS84_Pseudo-Mercator%3A14&TILEROW=4752&TILECOL=9100" \
  | grep -iE "^HTTP|access-control|content-type" | sed 's/^/    /' >> $out
echo "## Syvyysmalli / bathymetri (sök i avoin + andra tjänster)" >> $out
for u in "https://julkinen.traficom.fi/inspirepalvelu/syvyysmalli/wfs?service=WFS&request=GetCapabilities" \
         "https://julkinen.traficom.fi/syvyysmalli/wfs?service=WFS&request=GetCapabilities" \
         "https://julkinen.traficom.fi/inspirepalvelu/wcs?service=WCS&request=GetCapabilities"; do
  code=$(curl -s -m 30 -o /tmp/r -w "%{http_code}" "$u"); echo "- $u → $code, $(grep -o '<[a-zA-Z:]*Name>[^<]*' /tmp/r | head -5 | tr '\n' ' ')" >> $out
done
cat $out
