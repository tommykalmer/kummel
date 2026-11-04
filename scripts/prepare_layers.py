#!/usr/bin/env python3
"""
Gör om hämtade lager (build/geojson/*.geojsonl) till kompakta kartlager med korta namn
och bara de fält appen använder (build/layers/*.geojsonl). Ritar även ljussektorer som bågar.
"""
import json, math, os, glob

SRC, OUT = "build/geojson", "build/layers"
os.makedirs(OUT, exist_ok=True)

def num(v):
    try: return float(str(v).replace(",", "."))
    except Exception: return None

def read(layer):
    p = f"{SRC}/{layer}.geojsonl"
    if not os.path.exists(p): return
    with open(p) as fh:
        for line in fh:
            yield json.loads(line)

def first(*vals):
    for v in vals:
        if v not in (None, ""): return v
    return None

out = {}
def emit(name, geom, props, minzoom=None):
    f = {"type": "Feature", "geometry": geom, "properties": {k: v for k, v in props.items() if v is not None}}
    if minzoom is not None: f["tippecanoe"] = {"minzoom": minzoom}
    out.setdefault(name, []).append(f)

# --- djup -------------------------------------------------------------
for f in read("deptharea_a"):
    emit("depare", f["geometry"], {"d1": num(f["properties"].get("DRVAL1")), "d2": num(f["properties"].get("DRVAL2"))})
for f in read("depthcontour_l"):
    emit("depcnt", f["geometry"], {"v": num(f["properties"].get("VALDCO"))}, 9)
for f in read("sounding_p"):
    emit("soundg", f["geometry"], {"d": num(f["properties"].get("DEPTH"))}, 12)
for name in ("unsurveyedarea_a",):
    for f in read(name): emit("unsurv", f["geometry"], {}, 8)
for name in ("dredgedarea_a", "ruoppausalueet_uusi"):
    for f in read(name): emit("dredged", f["geometry"], {}, 11)

# --- sjömärken ----------------------------------------------------------
for f in read("turvalaitteet_uusi"):
    p = f["properties"]
    emit("aids", f["geometry"], {
        "name": first(p.get("nimisv"), p.get("nimifi")),
        "typ": p.get("turvalaitetyyppisv"),
        "nav": p.get("navigointilajikoodi"),
        "float": 1 if p.get("alityyppi") == "KELLUVA" else 0,
        "lit": 1 if p.get("valaistu") == "K" else 0,
        "st": p.get("toimintatilakoodi"),
        "no": p.get("turvalaitenumero"),
        "top": 1 if p.get("huippumerkki") == "K" else 0,
    }, 10)
for f in read("loistot_uusi"):
    p = f["properties"]
    emit("lights", f["geometry"], {"chr": first(p.get("viralvalotunnuse"), p.get("virallvalotunnus")), "h": num(p.get("korkeusvedesta")), "kind": p.get("valoominaisuussv"), "no": p.get("turvalaitenumero")}, 11)
for f in read("paivatunnukset_uusi"):
    p = f["properties"]
    emit("daymarks", f["geometry"], {"col": p.get("paivamerkkivarisv"), "shape": p.get("paivamerkkimuotosv"), "kum": p.get("paivamerkkikummelitunnus")}, 12)
for name in ("vesivaylien_turvalaiteviat_kauppamerenkulku", "vesivaylien_turvalaiteviat_matalavaylat"):
    for f in read(name): emit("faults", f["geometry"], {"txt": first(*(v for k, v in f["properties"].items() if "selite" in k.lower() or "kuvaus" in k.lower()))}, 9)
for f in read("vesiliikennemerkit_uusi"):
    p = f["properties"]
    emit("signs", f["geometry"], {"val": num(p.get("rajoitusarvo")), "name": first(p.get("nimisv"), p.get("nimifi"))}, 12)
for f in read("pilotboardingplace_p"):
    emit("pilot", f["geometry"], {}, 9)

# ljussektorer: bågar runt fyren (vinklar anges från sjön mot fyren)
COL = {"v": "white", "p": "red", "vi": "green", "k": "yellow"}
def dest(lon, lat, brg, m):
    R = 6371008.8; d = m / R; b = math.radians(brg); la = math.radians(lat); lo = math.radians(lon)
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return [round(math.degrees(lo2), 6), round(math.degrees(la2), 6)]
for f in read("valosektorit_uusi"):
    p = f["properties"]; g = f.get("geometry") or {}
    if g.get("type") != "Point": continue
    lon, lat = g["coordinates"][:2]
    a, b = num(p.get("alkukulma")), num(p.get("loppukulma"))
    if a is None or b is None: continue
    if b <= a: b += 360
    if b - a >= 359.9: continue   # runtomlysande fyr: ingen båge, som på papperskortet
    full = False
    r = 260
    steps = max(4, int((b - a) / 4))
    arc = [dest(lon, lat, (a + (b - a) * i / steps + 180) % 360, r) for i in range(steps + 1)]
    emit("sectors", {"type": "LineString", "coordinates": arc}, {"c": COL.get(p.get("vari"), "white")}, 12)
    if not full:
        for ang in (a, b):
            emit("seclegs", {"type": "LineString", "coordinates": [[lon, lat], dest(lon, lat, (ang + 180) % 360, r * 1.9)]}, {}, 13)

# --- farleder ------------------------------------------------------------
for f in read("navigointilinjat_uusi"):
    p = f["properties"]
    emit("navline", f["geometry"], {"draft": num(p.get("mitoitussyvays")), "t": p.get("tyyppikoodi"), "q": p.get("laatulk")}, 9)
for f in read("taululinjat_uusi"):
    emit("leadline", f["geometry"], {"dir": num(f["properties"].get("suunta"))}, 11)
for f in read("vaylaalueet_uusi"):
    p = f["properties"]
    emit("fwyarea", f["geometry"], {"draft": num(p.get("mitoitussyvays")), "t": p.get("tyyppikoodi")}, 10)
for f in read("vaylat_uusi"):
    p = f["properties"]
    emit("fwyname", f["geometry"], {"name": first(p.get("nimisv"), p.get("nimifi")), "cls": p.get("vaylaluokkakoodi")}, 10)
for f in read("vesivaylien_nopeusrajoitusalueet"):
    emit("speed", f["geometry"], {"kmh": num(f["properties"].get("suuruus"))}, 10)
for name in ("vesivaylien_muut_rajoitusalueet", "rajoitusalue_a_uusi", "kohtaamis_ja_ohittamiskieltoalueet"):
    for f in read(name): emit("restrict", f["geometry"], {}, 10)
for name, kind in (("trafficseparationschemelanepart_a", "lane"), ("trafficseparationzone_a", "zone"), ("trafficseaparationzone_a", "zone"),
                   ("trafficseparationline_l", "line"), ("trafficseaparationline_l", "line"), ("trafficseparationschemeboundary_l", "bnd"),
                   ("precautionaryarea_a", "caution"), ("deepwaterroutepart_a", "deep"), ("twowayroutepart_a", "twoway")):
    for f in read(name): emit("tss", f["geometry"], {"k": kind}, 7)

# --- kust ----------------------------------------------------------------
for f in read("shorelineconstruction_l"):
    emit("shoreline", f["geometry"], {"c": f["properties"].get("CATSLC")}, 12)
for f in read("pontoon_a"):
    emit("shoreline", f["geometry"], {"c": "pontoon"}, 12)

for name, feats in out.items():
    with open(f"{OUT}/{name}.geojsonl", "w") as fh:
        for ft in feats: fh.write(json.dumps(ft, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{name}: {len(feats)}")
with open("data/chart-log.md", "a") as fh:
    fh.write("\n## Kartlager i tiles\n" + "\n".join(f"- {n}: {len(f)}" for n, f in out.items()) + "\n")
