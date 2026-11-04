#!/usr/bin/env bash
# Diagnostik: AIS från Digitraffic (format och CORS)
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
from=$(( ($(date +%s) - 900) * 1000 ))
echo "## AIS locations (radius)" >> $out
curl -s -m 60 -D /tmp/h -H "Origin: https://tommykalmer.github.io" -H "Accept-Encoding: gzip" --compressed \
  "https://meri.digitraffic.fi/api/ais/v1/locations?latitude=60.1&longitude=19.95&radius=30&from=$from" -o /tmp/loc.json
grep -iE "^HTTP|access-control|content-type" /tmp/h | sed 's/^/    /' >> $out
python3 - >> $out <<'PY'
import json
d=json.load(open('/tmp/loc.json'))
print("    typ:", type(d).__name__, "keys:", list(d.keys())[:6] if isinstance(d,dict) else "")
f=(d.get("features") or [])
print("    antal:", len(f))
for x in f[:2]: print("    exempel:", json.dumps(x)[:400])
PY
echo "## AIS vessels (metadata)" >> $out
curl -s -m 60 -D /tmp/h2 -H "Origin: https://tommykalmer.github.io" --compressed "https://meri.digitraffic.fi/api/ais/v1/vessels?from=$from" -o /tmp/ves.json
grep -iE "^HTTP|access-control|content-type|content-length" /tmp/h2 | sed 's/^/    /' >> $out
python3 - >> $out <<'PY'
import json,os
d=json.load(open('/tmp/ves.json'))
print("    storlek:", os.path.getsize('/tmp/ves.json'), "typ:", type(d).__name__, "antal:", len(d))
for x in (d[:2] if isinstance(d,list) else []): print("    exempel:", json.dumps(x)[:400])
PY
echo "## Preflight med Digitraffic-User" >> $out
curl -s -m 30 -o /dev/null -D - -X OPTIONS -H "Origin: https://tommykalmer.github.io" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: digitraffic-user" \
  "https://meri.digitraffic.fi/api/ais/v1/locations" | grep -iE "^HTTP|access-control" | sed 's/^/    /' >> $out
cat $out
