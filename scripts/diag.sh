#!/usr/bin/env bash
# Diagnostik: hur ser MML:s fastighetsgränser ut på olika zoomnivåer (Mariehamn)?
key=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
mkdir -p data/diag; out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
python3 - "$key" >> $out <<'PY'
import math, sys, urllib.request
key = sys.argv[1]; lat, lng = 60.095, 19.94
for z in (10, 11, 12, 13, 14, 15):
    n = 2 ** z; x = int((lng + 180) / 360 * n); la = math.radians(lat); y = int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n)
    u = f"https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/kiinteistojaotus/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key={key}"
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"Referer": "https://www.kummel.app/"}), timeout=30); d = r.read()
        open(f"data/diag/prop-{z}.png", "wb").write(d); print(f"- z{z}: {r.status} {len(d)} byte")
    except Exception as e: print(f"- z{z}: fel {e}")
PY
cat $out
