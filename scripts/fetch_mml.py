#!/usr/bin/env python3
"""
Hämtar stenar och grund ur Maanmittauslaitos terrängdatabas (OGC API Features, öppen data CC BY 4.0)
och skriver data/rocks.geojson. Nyckeln läses ur config.js.
  k = 1 vattensten under ytan (38511), 2 i ytan (38512), 3 över ytan (38513),
  stenigt område (38600) och grund (38700) som ytor.
"""
import json, re, time, urllib.parse, urllib.request
BBOX = (19.0, 59.65, 21.35, 60.65)
BASE = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
key = re.search(r'mmlKey:\s*"([^"]+)"', open("config.js").read()).group(1)
KIND = {38511: 1, 38512: 2, 38513: 3}

def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/geo+json"}), timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == 3: raise
            time.sleep(5 * (i + 1))

def items(coll):
    # delas upp i rutor så att varje anrop blir litet
    out, step = [], 0.25
    x = BBOX[0]
    while x < BBOX[2]:
        y = BBOX[1]
        while y < BBOX[3]:
            q = urllib.parse.urlencode({"api-key": key, "f": "json", "limit": 10000, "bbox": f"{x},{y},{min(x+step,BBOX[2])},{min(y+step,BBOX[3])}"})
            url = f"{BASE}/collections/{coll}/items?{q}"
            while url:
                d = get(url)
                out += d.get("features", [])
                url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
                if url and "api-key=" not in url: url += ("&" if "?" in url else "?") + "api-key=" + key
            y += step
        x += step
    seen, uniq = set(), []
    for f in out:
        i = f.get("id") or f["properties"].get("mtk_id")
        if i in seen: continue
        seen.add(i); uniq.append(f)
    return uniq

def rnd(c): return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [rnd(q) for q in c]
feats = []
for f in items("vesikivi"):
    k = KIND.get(f["properties"].get("kohdeluokka"))
    if k and f.get("geometry", {}).get("type") == "Point":
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": rnd(f["geometry"]["coordinates"])}, "properties": {"k": k}})
n_rocks = len(feats)
for coll, k in (("vesikivikko", 4), ("matalikko", 5)):
    for f in items(coll):
        g = f.get("geometry")
        if g and g["type"] in ("Polygon", "MultiPolygon", "Point", "LineString"):
            feats.append({"type": "Feature", "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}, "properties": {"k": k}})
json.dump({"type": "FeatureCollection", "features": feats}, open("data/rocks.geojson", "w"), separators=(",", ":"))
with open("data/chart-log.md", "a") as fh:
    fh.write(f"\n## Stenar och grund (Maanmittauslaitos)\n- {n_rocks} stenar, {len(feats) - n_rocks} stenområden och grund\n")
print("stenar:", n_rocks, "övrigt:", len(feats) - n_rocks)
