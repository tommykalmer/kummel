#!/usr/bin/env python3
"""
Hämtar Traficoms sjökortsdata (WFS) för ett område och skriver GeoJSONSeq per lager,
plus en logg (data/chart-log.md, data/chart-layers.json) som beskriver lager och fält.

Körs i GitHub Actions (se .github/workflows/chart.yml). Inga beroenden utöver Python 3.
"""
import json, os, sys, time, urllib.parse, urllib.request
from xml.etree import ElementTree as ET

SERVICES = {
    "avoin": "https://julkinen.traficom.fi/inspirepalvelu/avoin/wfs",
    "rajoitettu": "https://julkinen.traficom.fi/inspirepalvelu/rajoitettu/wfs",
}
# Åland med omgivande skärgård (lon/lat)
BBOX = tuple(float(x) for x in os.environ.get("CHART_BBOX", "19.0,59.65,21.35,60.65").split(","))
PAGE = 5000
MAX_FEATURES = 400000
OUT = "build/geojson"
UA = {"User-Agent": "kummel-chart-builder/0.1 (+https://github.com/tommykalmer/kummel)"}

def get(url, timeout=120, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))

def feature_types(base):
    xml = get(f"{base}?service=WFS&request=GetCapabilities&version=2.0.0")
    root = ET.fromstring(xml)
    out = []
    for ft in root.iter():
        if ft.tag.endswith("FeatureType"):
            name = title = ""
            for c in ft:
                if c.tag.endswith("Name"): name = (c.text or "").strip()
                if c.tag.endswith("Title"): title = (c.text or "").strip()
            if name: out.append((name, title))
    return out

def in_area(coord):
    x, y = coord[0], coord[1]
    return BBOX[0] - 1 <= x <= BBOX[2] + 1 and BBOX[1] - 1 <= y <= BBOX[3] + 1

def first_coord(g):
    c = g.get("coordinates") if g else None
    while isinstance(c, list) and c and isinstance(c[0], list):
        c = c[0]
    return c

def swap(c):
    if isinstance(c, list) and c and isinstance(c[0], (int, float)):
        return [c[1], c[0]] + c[2:]
    return [swap(x) for x in c]

def fetch_type(base, name, bbox_variant):
    feats, start = [], 0
    while True:
        if bbox_variant == "lonlat":
            bbox = f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]},EPSG:4326"
        else:
            bbox = f"{BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]},urn:ogc:def:crs:EPSG::4326"
        q = urllib.parse.urlencode({
            "service": "WFS", "request": "GetFeature", "version": "2.0.0", "typeNames": name,
            "outputFormat": "application/json", "srsName": "EPSG:4326", "bbox": bbox,
            "count": PAGE, "startIndex": start,
        })
        data = json.loads(get(f"{base}?{q}", timeout=300))
        page = data.get("features", [])
        feats.extend(page)
        if len(page) < PAGE or len(feats) >= MAX_FEATURES:
            break
        start += PAGE
    return feats

def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs("data", exist_ok=True)
    log, layers = [], []
    log.append(f"# Sjökortsdata – hämtlogg\n\nOmråde (lon/lat): {BBOX}\nKörd: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}\n")
    for svc, base in SERVICES.items():
        try:
            types = feature_types(base)
        except Exception as e:
            log.append(f"\n## {svc}: kunde inte läsa GetCapabilities: {e}\n"); continue
        log.append(f"\n## {svc} ({len(types)} lager)\n")
        for name, title in types:
            feats, err = [], None
            for variant in ("lonlat", "latlon"):
                try:
                    feats = fetch_type(base, name, variant)
                except Exception as e:
                    err = str(e)[:200]; feats = []
                if feats: break
            if not feats:
                log.append(f"- `{name}` ({title}): 0 objekt{' – fel: ' + err if err else ''}")
                continue
            # rätta axelordning om servern gav lat/lon
            fc = next((first_coord(f.get("geometry")) for f in feats if f.get("geometry")), None)
            swapped = False
            if fc and not in_area(fc) and in_area([fc[1], fc[0]]):
                for f in feats:
                    if f.get("geometry"): f["geometry"]["coordinates"] = swap(f["geometry"]["coordinates"])
                swapped = True
            short = name.split(":")[-1].lower().replace(" ", "_")
            layer = short if short not in [l["layer"] for l in layers] else f"{svc}_{short}"
            path = f"{OUT}/{layer}.geojsonl"
            gtypes, keys = {}, {}
            with open(path, "w") as fh:
                for f in feats:
                    g = f.get("geometry")
                    if not g: continue
                    gtypes[g["type"]] = gtypes.get(g["type"], 0) + 1
                    props = {k: v for k, v in (f.get("properties") or {}).items() if v not in (None, "")}
                    for k, v in props.items():
                        s = keys.setdefault(k, [])
                        if len(s) < 6 and v not in s: s.append(v)
                    fh.write(json.dumps({"type": "Feature", "geometry": g, "properties": props}, ensure_ascii=False) + "\n")
            layers.append({"service": svc, "name": name, "title": title, "layer": layer, "count": len(feats), "geom": gtypes, "fields": keys})
            log.append(f"- `{name}` → lager **{layer}** ({title}): {len(feats)} objekt, {gtypes}{' (axlar vända)' if swapped else ''}")
            log.append("  - fält: " + "; ".join(f"`{k}` = {json.dumps(v, ensure_ascii=False)[:120]}" for k, v in keys.items()))
            print(name, len(feats), flush=True)
    with open("data/chart-layers.json", "w") as fh:
        json.dump(layers, fh, ensure_ascii=False, indent=1)
    with open("data/chart-log.md", "w") as fh:
        fh.write("\n".join(log) + "\n")
    if not layers:
        print("Inga lager hämtades", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
