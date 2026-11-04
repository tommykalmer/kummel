#!/usr/bin/env bash
# Diagnostik: vilka lager finns i Traficoms Oskari (nedladdningstjänst), och Ålands flygbilder
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
for route in "GetHierarchicalMapLayerGroups&lang=fi" "GetMapLayers&lang=fi&epsg=EPSG:3067"; do
  echo "## Oskari $route" >> $out
  curl -s -m 60 "https://julkinen.traficom.fi/oskari/action?action_route=$route" -o /tmp/o.json
  python3 - >> $out <<'PY'
import json,re
try:
  d=json.load(open('/tmp/o.json'))
except Exception as e:
  print("  ej json:", open('/tmp/o.json','rb').read()[:300]); raise SystemExit
s=json.dumps(d,ensure_ascii=False)
names=set(re.findall(r'"(?:name|layerName|title)"\s*:\s*(?:\{[^}]*"fi"\s*:\s*)?"([^"]{2,80})"',s))
print("  storlek",len(s),"namn:",len(names))
for n in sorted(names): print("  -",n)
urls=set(re.findall(r'https?://[^"]+/(?:wfs|wms|ows)[^"]*',s))
for u in sorted(urls)[:20]: print("  url:",u)
PY
done
echo "## Åland karttjänster" >> $out
for u in "https://kartor.regeringen.ax/geoserver/ows?service=WMS&request=GetCapabilities" "https://geodata.regeringen.ax/geoserver/ows?service=WMS&request=GetCapabilities" "https://karta.ax/geoserver/ows?service=WMS&request=GetCapabilities"; do
  code=$(curl -s -m 30 -o /tmp/r -w "%{http_code}" "$u"); echo "- $u → $code $(grep -o '<Name>[^<]*</Name>' /tmp/r | head -15 | tr '\n' ' ')" >> $out
done
cat $out
