"use strict";
/* =========================================================
   Kummel – sjökortsstil för MapLibre
   Lager från data/chart-aland.pmtiles (Traficom + Väylävirasto, CC BY 4.0)
   och OpenFreeMap (OpenStreetMap) för land, ortnamn och vägar.
   ========================================================= */
const KummelChart = (() => {
  const C = {
    land: "#f3e6b3", landLine: "#8a7a4a",
    water: "#ffffff",
    d0: "#b9ddf3",      // 0–3 m
    d3: "#c7e4f5",      // 3–6 m
    d6: "#e3f2fb",      // 6–10 m
    d10: "#ffffff",     // djupare
    unsafe: "#79b4e0",  // grundare än båten behöver
    drying: "#bfd9a8",
    contour: "#5f9fcc", safety: "#1b5f95",
    sounding: "#4a5a66", soundingShallow: "#0b1620",
    nav: "#16222b", magenta: "#b0258f", red: "#d22b2b", green: "#1d9a46", yellow: "#f4c20d",
    fish: "#17b06f"
  };
  const SAFETY_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];
  const safetyContour = need => SAFETY_STEPS.find(v => v >= need) || 50;
  const FONT = ["Noto Sans Regular"], FONT_B = ["Noto Sans Medium"], FONT_I = ["Noto Sans Italic"];

  const d1 = ["coalesce", ["get", "d1"], 0];
  const depthFill = need => ["case",
    ["<", d1, 0], C.drying,
    ["<", d1, need], C.unsafe,
    ["<", d1, 3], C.d0,
    ["<", d1, 6], C.d3,
    ["<", d1, 10], C.d6,
    C.d10];

  const OFM = "ofm", CH = "chart", DETAIL_Z = 13;
  const dangerFilter = need => ["<", ["coalesce", ["get", "d1"], 0], need];
  const WMTS = layer => `https://julkinen.traficom.fi/rasteripalvelu/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(layer)}&STYLE=&FORMAT=image%2Fpng&TILEMATRIXSET=WGS84_Pseudo-Mercator&TILEMATRIX=WGS84_Pseudo-Mercator%3A{z}&TILEROW={y}&TILECOL={x}`;
  const FI = [19, 59.3, 32, 70.2];
  const rasterSources = () => ({
    "tr-coast": { type: "raster", tiles: [WMTS("Traficom:Rannikkokartat public")], tileSize: 256, minzoom: 12, maxzoom: 15, bounds: FI, attribution: "Sjökort: Traficom" },
    "tr-sea": { type: "raster", tiles: [WMTS("Traficom:Merikarttasarjat public")], tileSize: 256, minzoom: 12, maxzoom: 15, bounds: FI },
    "tr-harbour": { type: "raster", tiles: [WMTS("Traficom:Satamakartat")], tileSize: 256, minzoom: 14, maxzoom: 16, bounds: FI }
  });
  const DETAIL_IDS = ["detail-coast", "detail-sea", "detail-harbour", "danger-ovl"];
  function layers(o) {
    const need = o.need, sc = safetyContour(need);
    return [
      /* bas från OpenStreetMap: hav överallt, land = bakgrund */
      { id: "ofm-water", type: "fill", source: OFM, "source-layer": "water", paint: { "fill-color": C.d10 } },
      { id: "ofm-landcover", type: "fill", source: OFM, "source-layer": "landcover", minzoom: 11, filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": "#e6dca6", "fill-opacity": .6 } },

      /* djupområden */
      { id: "depare", type: "fill", source: CH, "source-layer": "depare", paint: { "fill-color": depthFill(need), "fill-antialias": false } },
      { id: "unsurv", type: "fill", source: CH, "source-layer": "unsurv", paint: { "fill-color": "#9aa6ad", "fill-opacity": .25 } },
      { id: "dredged", type: "fill", source: CH, "source-layer": "dredged", paint: { "fill-color": "#dfe6ea", "fill-outline-color": "#7f8c93" } },

      /* djupkurvor */
      { id: "depcnt", type: "line", source: CH, "source-layer": "depcnt", paint: { "line-color": C.contour, "line-width": ["interpolate", ["linear"], ["zoom"], 9, .4, 14, .9] } },
      { id: "depcnt-safety", type: "line", source: CH, "source-layer": "depcnt", filter: ["==", ["get", "v"], sc], paint: { "line-color": C.safety, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2.2] } },
      { id: "depcnt-lbl", type: "symbol", source: CH, "source-layer": "depcnt", minzoom: 13, layout: { "symbol-placement": "line", "symbol-spacing": 320, "text-field": ["to-string", ["get", "v"]], "text-font": FONT_I, "text-size": 10, "text-keep-upright": true }, paint: { "text-color": C.contour, "text-halo-color": "#fff", "text-halo-width": 1.5 } },

      /* land (kustlinje från OSM-vattnet), kustkonstruktioner */
      { id: "ofm-coast", type: "line", source: OFM, "source-layer": "water", minzoom: 9, paint: { "line-color": C.landLine, "line-width": ["interpolate", ["linear"], ["zoom"], 9, .3, 15, 1] } },
      { id: "ofm-road", type: "line", source: OFM, "source-layer": "transportation", minzoom: 11, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"]]], paint: { "line-color": "#b9a76c", "line-width": ["interpolate", ["linear"], ["zoom"], 11, .4, 16, 2] } },
      { id: "ofm-building", type: "fill", source: OFM, "source-layer": "building", minzoom: 14, paint: { "fill-color": "#cdbb82" } },
      { id: "shoreline", type: "line", source: CH, "source-layer": "shoreline", paint: { "line-color": "#3d3a2e", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 2.5] } },

      /* trafikområden och begränsningar */
      { id: "tss-fill", type: "fill", source: CH, "source-layer": "tss", filter: ["in", ["get", "k"], ["literal", ["zone", "caution"]]], paint: { "fill-color": C.magenta, "fill-opacity": .12 } },
      { id: "tss-line", type: "line", source: CH, "source-layer": "tss", paint: { "line-color": C.magenta, "line-width": 1, "line-dasharray": [4, 2] } },
      { id: "restrict", type: "line", source: CH, "source-layer": "restrict", paint: { "line-color": C.magenta, "line-width": 1.2, "line-dasharray": [3, 2] } },
      { id: "speed", type: "line", source: CH, "source-layer": "speed", paint: { "line-color": C.magenta, "line-width": 1.4, "line-dasharray": [1, 1.5] } },
      { id: "speed-lbl", type: "symbol", source: CH, "source-layer": "speed", minzoom: 11, layout: { "text-field": ["concat", ["to-string", ["get", "kmh"]], " km/h"], "text-font": FONT_B, "text-size": 11 }, paint: { "text-color": C.magenta, "text-halo-color": "#fff", "text-halo-width": 2 } },

      /* farleder */
      { id: "fwyarea", type: "line", source: CH, "source-layer": "fwyarea", minzoom: 12, paint: { "line-color": "#8c6aa8", "line-width": .6, "line-opacity": .6 } },
      { id: "leadline", type: "line", source: CH, "source-layer": "leadline", paint: { "line-color": C.nav, "line-width": 1, "line-dasharray": [6, 3] } },
      { id: "navline", type: "line", source: CH, "source-layer": "navline", paint: { "line-color": C.nav, "line-width": ["interpolate", ["linear"], ["zoom"], 9, .7, 14, 1.6] } },
      { id: "navline-lbl", type: "symbol", source: CH, "source-layer": "navline", minzoom: 12, filter: [">", ["coalesce", ["get", "draft"], 0], 0], layout: { "symbol-placement": "line-center", "text-field": ["concat", ["number-format", ["get", "draft"], { "min-fraction-digits": 1, "max-fraction-digits": 1 }], " m"], "text-font": FONT_B, "text-size": 11, "text-keep-upright": true, "text-offset": [0, -.8] }, paint: { "text-color": C.nav, "text-halo-color": "#fff", "text-halo-width": 2 } },
      { id: "fwyname", type: "symbol", source: CH, "source-layer": "fwyname", minzoom: 11, layout: { "symbol-placement": "line", "symbol-spacing": 600, "text-field": ["get", "name"], "text-font": FONT_I, "text-size": 11, "text-keep-upright": true, "text-offset": [0, 1] }, paint: { "text-color": "#5a4a6e", "text-halo-color": "#fff", "text-halo-width": 1.5 } },

      /* ljussektorer */
      { id: "seclegs", type: "line", source: CH, "source-layer": "seclegs", paint: { "line-color": "#5d6b73", "line-width": .7, "line-dasharray": [3, 3] } },
      { id: "sectors", type: "line", source: CH, "source-layer": "sectors", paint: { "line-color": ["match", ["get", "c"], "red", C.red, "green", C.green, C.yellow], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5], "line-opacity": .9 } },

      /* djupsiffror */
      { id: "soundg", type: "symbol", source: CH, "source-layer": "soundg", filter: [">=", ["get", "d"], need], layout: { "text-field": ["number-format", ["get", "d"], { "max-fraction-digits": 1 }], "text-font": FONT_I, "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 12], "text-padding": 1 }, paint: { "text-color": C.sounding } },
      { id: "soundg-shallow", type: "symbol", source: CH, "source-layer": "soundg", filter: ["<", ["get", "d"], need], layout: { "text-field": ["number-format", ["get", "d"], { "max-fraction-digits": 1 }], "text-font": FONT_B, "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13], "text-padding": 0, "text-allow-overlap": true }, paint: { "text-color": C.soundingShallow, "text-halo-color": "#fff", "text-halo-width": 1 } },

      /* ortnamn */
      { id: "ofm-place", type: "symbol", source: OFM, "source-layer": "place", minzoom: 8, filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet", "island", "islet", "locality"]]], layout: { "text-field": ["coalesce", ["get", "name:sv"], ["get", "name"]], "text-font": ["match", ["get", "class"], ["island", "islet"], ["literal", FONT_I], ["literal", FONT]], "text-size": ["match", ["get", "class"], "city", 15, "town", 13, ["island"], 12, 11], "text-max-width": 8, "text-padding": 4 }, paint: { "text-color": "#3a3424", "text-halo-color": C.land, "text-halo-width": 1.5 } },
      { id: "ofm-water-name", type: "symbol", source: OFM, "source-layer": "water_name", minzoom: 9, layout: { "text-field": ["coalesce", ["get", "name:sv"], ["get", "name"]], "text-font": FONT_I, "text-size": 11 }, paint: { "text-color": "#3e6d8f", "text-halo-color": "#fff", "text-halo-width": 1.5 } },

      /* sjömärken */
      { id: "daymarks", type: "symbol", source: CH, "source-layer": "daymarks", minzoom: 12, layout: { "icon-image": "daymark", "icon-size": .9, "icon-allow-overlap": false } },
      { id: "lights", type: "symbol", source: CH, "source-layer": "lights", layout: { "icon-image": "light", "icon-anchor": "bottom-left", "icon-offset": [-3, 3], "icon-allow-overlap": true, "text-field": ["step", ["zoom"], "", 13, ["coalesce", ["get", "chr"], ""]], "text-font": FONT, "text-size": 10, "text-anchor": "top-left", "text-offset": [.8, .4], "text-optional": true }, paint: { "text-color": C.magenta, "text-halo-color": "#fff", "text-halo-width": 1.5 } },
      { id: "aids", type: "symbol", source: CH, "source-layer": "aids", layout: {
          "icon-image": ["match", ["to-number", ["get", "nav"], 99], 1, "aid-port", 2, "aid-stbd", 3, "aid-n", 4, "aid-s", 5, "aid-w", 6, "aid-e", 7, "aid-iso", 8, "aid-safe", 9, "aid-spec", ["case", ["==", ["get", "lit"], 1], "aid-lit", "aid-other"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, .55, 14, .9, 17, 1.1],
          "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true,
          "text-field": ["step", ["zoom"], "", 14, ["coalesce", ["get", "name"], ""]], "text-font": FONT, "text-size": 10, "text-anchor": "top", "text-offset": [0, .3], "text-optional": true
        }, paint: { "text-color": C.nav, "text-halo-color": "#fff", "text-halo-width": 1.5, "icon-opacity": ["case", ["==", ["get", "st"], 2], .45, 1] } },
      { id: "pilot", type: "symbol", source: CH, "source-layer": "pilot", layout: { "text-field": "Lots", "text-font": FONT_B, "text-size": 11 }, paint: { "text-color": C.magenta, "text-halo-color": "#fff", "text-halo-width": 2 } },
      { id: "signs", type: "symbol", source: CH, "source-layer": "signs", layout: { "icon-image": "sign", "icon-size": .8, "text-field": ["case", ["has", "val"], ["to-string", ["get", "val"]], ""], "text-font": FONT_B, "text-size": 9 }, paint: { "text-color": C.red } },
      { id: "faults", type: "symbol", source: CH, "source-layer": "faults", layout: { "icon-image": "fault", "icon-allow-overlap": true, "text-field": "Fel på sjömärke", "text-font": FONT_B, "text-size": 10, "text-anchor": "top", "text-offset": [0, 1.2], "text-optional": true }, paint: { "text-color": C.red, "text-halo-color": "#fff", "text-halo-width": 2 } },

      /* detaljkort från Traficom (inskannade sjökort med grynnor och stenar) när man zoomar in.
         Ligger över vektorkortet; där bladen saknas syns vektorkortet igenom. */
      { id: "detail-coast", type: "raster", source: "tr-coast", minzoom: DETAIL_Z, paint: { "raster-fade-duration": 250 } },
      { id: "detail-sea", type: "raster", source: "tr-sea", minzoom: DETAIL_Z, paint: { "raster-fade-duration": 250 } },
      { id: "detail-harbour", type: "raster", source: "tr-harbour", minzoom: 14, paint: { "raster-fade-duration": 250 } },
      /* ovanpå detaljkortet: farozon för den aktiva båten och djupintervall för fiske */
      { id: "danger-ovl", type: "fill", source: CH, "source-layer": "depare", minzoom: DETAIL_Z, filter: dangerFilter(need), paint: { "fill-color": C.red, "fill-opacity": .16 } },
      { id: "fishband", type: "fill", source: CH, "source-layer": "depare", filter: ["==", ["get", "d1"], -9999], paint: { "fill-color": C.fish, "fill-opacity": .45 } },
      { id: "fishband-line", type: "line", source: CH, "source-layer": "depare", filter: ["==", ["get", "d1"], -9999], paint: { "line-color": "#0b6e44", "line-width": 1 } }
    ];
  }

  const ALL = layers({ need: 1 }).map(l => l.id).filter(id => !DETAIL_IDS.includes(id));
  const OVERLAY = ["depcnt", "depcnt-safety", "navline", "navline-lbl", "leadline", "fwyname", "sectors", "seclegs", "lights", "aids", "faults", "speed", "speed-lbl", "restrict", "tss-line", "pilot", "signs", "soundg-shallow", "fishband", "fishband-line"];

  function setNeed(map, need) {
    if (map.getLayer("depare")) map.setPaintProperty("depare", "fill-color", depthFill(need));
    if (map.getLayer("depcnt-safety")) map.setFilter("depcnt-safety", ["==", ["get", "v"], safetyContour(need)]);
    if (map.getLayer("soundg")) map.setFilter("soundg", [">=", ["get", "d"], need]);
    if (map.getLayer("soundg-shallow")) map.setFilter("soundg-shallow", ["<", ["get", "d"], need]);
    if (map.getLayer("danger-ovl")) map.setFilter("danger-ovl", dangerFilter(need));
  }
  function setFishBand(map, band) {
    const f = band ? ["all", ["<", ["coalesce", ["get", "d1"], 0], band[1]], [">", ["coalesce", ["get", "d2"], 999], band[0]], [">=", ["coalesce", ["get", "d1"], 0], band[0] - 5]] : ["==", ["get", "d1"], -9999];
    ["fishband", "fishband-line"].forEach(id => map.getLayer(id) && map.setFilter(id, f));
  }

  /* ---------- symboler, ritade i canvas ---------- */
  const R = 2; // pixel ratio
  function canvas(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w * R; c.height = h * R;
    const g = c.getContext("2d"); g.scale(R, R); g.lineJoin = "round"; draw(g);
    return { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }
  const tri = (g, x, y, s, up) => { g.beginPath(); if (up) { g.moveTo(x, y - s); g.lineTo(x + s * .9, y + s * .6); g.lineTo(x - s * .9, y + s * .6); } else { g.moveTo(x, y + s); g.lineTo(x + s * .9, y - s * .6); g.lineTo(x - s * .9, y - s * .6); } g.closePath(); g.fill(); g.stroke(); };
  function pole(g, bands, topmark) {
    // stång 8x18 med färgfält uppifrån, toppmärke ovanför
    const x = 8, y = 12, w = 8, h = 18, bh = h / bands.length;
    bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(x, y + i * bh, w, bh); });
    g.strokeStyle = "#111"; g.lineWidth = 1.2; g.strokeRect(x, y, w, h);
    g.fillStyle = "#111"; g.strokeStyle = "#111"; g.lineWidth = .8;
    if (topmark) topmark(g, x + w / 2);
  }
  const ICONS = {
    "aid-port": () => canvas(24, 32, g => pole(g, [C.red], (g, cx) => { g.fillStyle = C.red; g.fillRect(cx - 4, 2, 8, 7); g.strokeRect(cx - 4, 2, 8, 7); })),
    "aid-stbd": () => canvas(24, 32, g => pole(g, [C.green], (g, cx) => { g.fillStyle = C.green; tri(g, cx, 6, 5, true); })),
    "aid-n": () => canvas(24, 32, g => pole(g, ["#111", C.yellow], (g, cx) => { tri(g, cx, 3.5, 3.2, true); tri(g, cx, 9, 3.2, true); })),
    "aid-s": () => canvas(24, 32, g => pole(g, [C.yellow, "#111"], (g, cx) => { tri(g, cx, 3.5, 3.2, false); tri(g, cx, 9, 3.2, false); })),
    "aid-e": () => canvas(24, 32, g => pole(g, ["#111", C.yellow, "#111"], (g, cx) => { tri(g, cx, 3.2, 3.2, true); tri(g, cx, 9.5, 3.2, false); })),
    "aid-w": () => canvas(24, 32, g => pole(g, [C.yellow, "#111", C.yellow], (g, cx) => { tri(g, cx, 3.5, 3.2, false); tri(g, cx, 9, 3.2, true); })),
    "aid-iso": () => canvas(24, 32, g => pole(g, ["#111", C.red, "#111"], (g, cx) => { g.beginPath(); g.arc(cx, 3.5, 2.6, 0, 7); g.fill(); g.beginPath(); g.arc(cx, 9, 2.6, 0, 7); g.fill(); })),
    "aid-safe": () => canvas(24, 32, g => pole(g, [C.red, "#fff", C.red, "#fff"], (g, cx) => { g.fillStyle = C.red; g.beginPath(); g.arc(cx, 6, 3.5, 0, 7); g.fill(); g.stroke(); })),
    "aid-spec": () => canvas(24, 32, g => pole(g, [C.yellow], (g, cx) => { g.strokeStyle = C.yellow; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 4, 2); g.lineTo(cx + 4, 10); g.moveTo(cx + 4, 2); g.lineTo(cx - 4, 10); g.stroke(); })),
    "aid-lit": () => canvas(24, 32, g => { g.fillStyle = "#111"; g.beginPath(); g.arc(12, 27, 3.2, 0, 7); g.fill(); g.fillStyle = C.magenta; g.beginPath(); g.moveTo(12, 25); g.quadraticCurveTo(22, 12, 16, 5); g.quadraticCurveTo(9, 14, 12, 25); g.fill(); }),
    "aid-other": () => canvas(24, 32, g => { g.fillStyle = "#111"; g.fillRect(10.5, 14, 3, 15); g.beginPath(); g.arc(12, 29, 2.5, 0, 7); g.fill(); }),
    "light": () => canvas(22, 22, g => { g.fillStyle = C.magenta; g.globalAlpha = .9; g.beginPath(); g.moveTo(3, 19); g.quadraticCurveTo(18, 12, 19, 2); g.quadraticCurveTo(8, 6, 3, 19); g.fill(); }),
    "daymark": () => canvas(16, 16, g => { g.fillStyle = "#1e1e1e"; g.beginPath(); g.moveTo(8, 2); g.lineTo(14, 14); g.lineTo(2, 14); g.closePath(); g.fill(); }),
    "sign": () => canvas(18, 18, g => { g.fillStyle = "#fff"; g.strokeStyle = C.red; g.lineWidth = 2.2; g.beginPath(); g.arc(9, 9, 7, 0, 7); g.fill(); g.stroke(); }),
    "fault": () => canvas(24, 22, g => { g.fillStyle = C.red; g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(12, 2); g.lineTo(22, 20); g.lineTo(2, 20); g.closePath(); g.fill(); g.stroke(); g.fillStyle = "#fff"; g.fillRect(11, 8, 2, 6); g.fillRect(11, 15.5, 2, 2); })
  };
  function image(map, id) {
    if (!ICONS[id] || map.hasImage(id)) return;
    map.addImage(id, ICONS[id](), { pixelRatio: R });
  }


  return {
    colors: () => ({ water: C.d10, land: C.land }),
    layers, setNeed, setFishBand, image, rasterSources,
    detailIds: () => DETAIL_IDS,
    layerIds: () => ALL,
    isOverlay: id => OVERLAY.includes(id),
    soundingIds: () => ["soundg", "soundg-shallow"],
    depthAreaIds: () => ["depare"],
    minDepthOf: f => f.properties.d1 ?? null,
    maxDepthOf: f => f.properties.d2 ?? null
  };
})();
