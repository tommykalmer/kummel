"use strict";
/* =========================================================
   Kummel v0.2 – vektorsjökort i webbläsaren
   Kartmotor: MapLibre GL + PMTiles. Sjökortsstil: chartstyle.js
   Data: Traficom (CC BY 4.0, ej för navigering), OpenStreetMap, Open-Meteo.
   ========================================================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NM = 1852, KN = 1.943844, R_NM = 3440.065;

/* ---------- storage ---------- */
const KEY = "kummel.v1";
const DEFAULT_STATE = {
  mode: "tur",
  view: { lat: 60.08, lng: 19.94, z: 11, bearing: 0 },
  layers: { base: "chart", detail: false, detailZoom: 13, soundings: true, groups: {} },
  theme: "day",
  fishDepth: [4, 12],
  boats: [{ id: "b1", name: "Min båt", type: "motor", length: 6.5, beam: 2.4, draft: 0.6, air: 2.0, speed: 20, fuel: 18, margin: 0.5, maxWind: 10 }],
  boatId: "b1",
  places: [], routes: [], tracks: [], catches: [], v2: 1, v3: 1
};
/* Ålands flagga, liten, för Om Kummel och välkomstrutan */
const ALAND_FLAG = `<svg class="flag" viewBox="0 0 26 17" aria-label="Ålands flagga"><rect width="26" height="17" fill="#0053a5"/><rect x="7" width="5" height="17" fill="#ffce00"/><rect y="6" width="26" height="5" fill="#ffce00"/><rect x="8.5" width="2" height="17" fill="#d21034"/><rect y="7.5" width="26" height="2" fill="#d21034"/></svg>`;
const MAKER = "AsterIQ Ab", MAKER_TOWN = "Mariehamn", MAKER_ID = "3553529-1";   // FO-nummer
const SITE = "www.kummel.app", SITE_URL = "https://www.kummel.app/";   // appens adress, visas på delade bilder m.m.
let draftCatch = null;
let wl = null;   // vattenstånd {cm, at, station, km, obs:[{t,v}], fc:[{t,v}]}   // fångst som inte är sparad än (Fisk! utan att trycka Spara)
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      const st = Object.assign(structuredClone(DEFAULT_STATE), s);
      if (!s.v2) { st.layers = structuredClone(DEFAULT_STATE.layers); st.v2 = 1; } // v0.1 hade gatukarta som standard
      if (!s.v3) { st.layers.detail = false; st.v3 = 1; } // vektorkortet är standard, detaljkortet på egen knapp
      return st;
    }
  } catch (e) {}
  return structuredClone(DEFAULT_STATE);
}
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 200); }
const uid = () => Math.random().toString(36).slice(2, 9);
const boat = () => S.boats.find(b => b.id === S.boatId) || S.boats[0];
/* vattenstånd, lovande platser och drift är alltid påslagna (menyn Funktioner togs bort) */
const feat = () => true;
const boatNeed = () => { const b = boat(); return (+b.draft || 0) + (+b.margin || 0); };
/* djup som behövs på sjökortet: båtens behov, plus det vattnet står under medelvattenstånd just nu */
const wlM = () => feat("wlevel") && S.wlAdjust !== false && wl && Date.now() - wl.at < 6 * 3600000 ? wl.cm / 100 : 0;
const needDepth = () => Math.max(0, +(boatNeed() - wlM()).toFixed(2));

/* GPS state up front: map handlers read it from the first frame */
let gps = null, watchId = null, follow = false, courseUp = false, lastFix = null, wakeLock = null;

/* ---------- geo helpers ---------- */
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function distNm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function dest(p, brg, nm) {
  const d = nm / R_NM, b = rad(brg), la = rad(p.lat), lo = rad(p.lng);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: deg(la2), lng: deg(lo2) };
}
function ddm(v, pos, neg, padDeg) {
  const h = v >= 0 ? pos : neg; v = Math.abs(v);
  const d = Math.floor(v), m = (v - d) * 60;
  return `${String(d).padStart(padDeg, "0")}°${m.toFixed(3).padStart(6, "0")}′${h}`;
}
const fmtPos = ll => `${ddm(ll.lat, "N", "S", 2)}<br>${ddm(ll.lng, "E", "W", 3)}`;
const fmtPosTxt = ll => `${ddm(ll.lat, "N", "S", 2)} ${ddm(ll.lng, "E", "W", 3)}`;
const fmtDur = h => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const pad = n => String(n).padStart(2, "0");
const DAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const compass = d => ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"][Math.round(d / 22.5) % 16];
const ll = o => ({ lat: o.lat, lng: o.lng });
const lnglat = p => [p.lng, p.lat];

function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

/* ---------- map ---------- */
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
const CHART_URL = "pmtiles://" + new URL("data/chart-aland.pmtiles", location.href).href;

const EMPTY = { type: "FeatureCollection", features: [] };
/* Lantmäteriverket i Finland (Maanmittauslaitos): flygbild och fastighetsgränser, kräver egen gratis API-nyckel */
const mmlKey = () => (window.KUMMEL_CONFIG && window.KUMMEL_CONFIG.mmlKey) || "";   // appens egen nyckel för alla användare
const MML = (layer, fmt) => `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${fmt}?api-key=${encodeURIComponent(mmlKey())}`;
function mmlSources() {
  if (!mmlKey()) return {};
  return {
    "mml-orto": { type: "raster", tiles: [MML("ortokuva", "jpg")], tileSize: 256, maxzoom: 16, bounds: [19, 59.3, 32, 70.2], attribution: "Flygbild © Maanmittauslaitos" },
    "mml-prop": { type: "raster", tiles: [MML("kiinteistojaotus", "png")], tileSize: 256, minzoom: 12, maxzoom: 16, bounds: [19, 59.3, 32, 70.2], attribution: "Fastighetsgränser © Maanmittauslaitos" }
  };
}
function baseStyle() {
  return {
    version: 8,
    glyphs: location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + "fonts/{fontstack}/{range}.pbf", // egna typsnitt: fungerar offline
    sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap" },
      sat: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Bild © Esri" },
      ...mmlSources(),
      ...KummelChart.rasterSources(),
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "OpenFreeMap © OpenStreetMap" },
      marks: { type: "geojson", data: "data/marks.geojson" },
      rocks: { type: "vector", url: "pmtiles://" + new URL("data/rocks-aland.pmtiles", location.href).href, attribution: "Stenar: Maanmittauslaitos" },
      lines: { type: "vector", url: "pmtiles://" + new URL("data/lines-aland.pmtiles", location.href).href },
      chart: { type: "vector", url: CHART_URL, attribution: "Källa: Traficom (CC BY 4.0). Ej för navigering." }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": KummelChart.colors().land } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 }, layout: { visibility: "none" } },
      { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
      ...(mmlKey() ? [{ id: "mml-orto", type: "raster", source: "mml-orto", layout: { visibility: "none" } }] : []),
      ...KummelChart.layers({ need: needDepth(), fish: null, soundings: S.layers.soundings }),
      ...(mmlKey() ? [{ id: "mml-prop", type: "raster", source: "mml-prop", minzoom: 12, layout: { visibility: "none" }, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 12, .65, 14, .9] } }] : [])
    ]
  };
}

KummelChart.setTheme(S.theme === "day" || !S.theme ? "day" : "dark");
const map = new maplibregl.Map({
  container: "map", style: baseStyle(), center: [S.view.lng, S.view.lat], zoom: S.view.z, bearing: S.view.bearing || 0,
  maxZoom: 18.5, minZoom: 4, attributionControl: false, dragRotate: true, pitchWithRotate: false, touchPitch: false, hash: false
});
map.on("styleimagemissing", e => {
  if (e.id === "ship" || e.id === "ship-still") { // fartyg: spetsig skrovform i fart, romb när det ligger still (SDF)
    const c = document.createElement("canvas"); c.width = 32; c.height = 48; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.beginPath();
    if (e.id === "ship") { g.moveTo(16, 2); g.lineTo(27, 18); g.lineTo(25, 45); g.lineTo(7, 45); g.lineTo(5, 18); }
    else { g.moveTo(16, 12); g.lineTo(26, 24); g.lineTo(16, 36); g.lineTo(6, 24); }
    g.closePath(); g.fill();
    if (!map.hasImage(e.id)) map.addImage(e.id, g.getImageData(0, 0, 32, 48), { sdf: true, pixelRatio: 2 });
    return;
  }
  if (e.id === "wind") { // vindpil som pekar dit vinden blåser, färgas i lagret (SDF)
    const c = document.createElement("canvas"); c.width = c.height = 48; const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(24, 3); g.lineTo(38, 30); g.lineTo(28, 25); g.lineTo(28, 45); g.lineTo(20, 45); g.lineTo(20, 25); g.lineTo(10, 30); g.closePath(); g.fill();
    if (!map.hasImage("wind")) map.addImage("wind", g.getImageData(0, 0, 48, 48), { sdf: true, pixelRatio: 2 });
    return;
  }
  if (e.id === "catch-fish") { // fångst: liten gul fisk med mörk kant
    const c = document.createElement("canvas"); c.width = 64; c.height = 44; const g = c.getContext("2d");
    g.translate(4, -4); g.scale(2.4, 2.4); g.lineJoin = "round";
    const body = new Path2D("M3 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6z"), tail = new Path2D("M4 12 0.5 7.5v9z");
    g.fillStyle = "#f2c14e"; g.strokeStyle = "#1b1500"; g.lineWidth = 1.1;
    g.fill(tail); g.stroke(tail); g.fill(body); g.stroke(body);
    g.fillStyle = "#1b1500"; g.beginPath(); g.arc(17.2, 10.6, 1.25, 0, 7); g.fill();
    if (!map.hasImage(e.id)) map.addImage(e.id, g.getImageData(0, 0, 64, 44), { pixelRatio: 2 });
    return;
  }
  KummelChart.image(map, e.id);
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
/* källrutan: alltid hopfälld från start, stängs själv efter en stund när man öppnat den */
const attribEl = () => document.querySelector(".maplibregl-ctrl-attrib");
function foldAttrib() { const el = attribEl(); if (!el) return; el.classList.remove("maplibregl-compact-show"); el.removeAttribute("open"); }
let attribTimer = null;
map.once("idle", foldAttrib); setTimeout(foldAttrib, 1500);
document.addEventListener("click", e => {
  if (!e.target.closest(".maplibregl-ctrl-attrib-button")) return;
  clearTimeout(attribTimer); attribTimer = setTimeout(foldAttrib, 7000);
}, true);
map.addControl(new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 110 }), "bottom-left");
map.touchZoomRotate.enableRotation();
// mus/styrplatta: dra = flytta kartan, aldrig vrida (högerklick-dra och ctrl-dra vred kartan av misstag på datorn)
map.dragRotate.disable();
let mapReady = false;

/* overlay sources (route, track, boat …) */
const SRC = ["route", "track", "live", "shown", "heading", "acc", "catches", "fishzone", "mob", "wxgrid", "wxobs", "wxsst", "navto", "ais", "aisvec", "anchor", "drift", "driftpts"];
function addOverlays() {
  SRC.forEach(id => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY }); });
  const add = l => { if (!map.getLayer(l.id)) map.addLayer(l); };
  // osynliga söklager: Lovande platser och drift läser djup, branter och stenar härifrån,
  // så de fungerar oavsett bakgrundskarta och vilka lager som visas
  if (map.getSource("chart")) add({ id: "q-depare", type: "fill", source: "chart", "source-layer": "depare", paint: { "fill-opacity": 0 } });
  if (map.getSource("lines")) add({ id: "q-steep", type: "line", source: "lines", "source-layer": "steep", minzoom: 11, paint: { "line-opacity": 0, "line-width": 4 } });
  if (map.getSource("rocks")) add({ id: "q-rocks", type: "circle", source: "rocks", "source-layer": "rocks", minzoom: 11.5, filter: ["in", ["get", "k"], ["literal", [1, 2, 3]]], paint: { "circle-opacity": 0, "circle-stroke-opacity": 0, "circle-radius": 3 } });
  const wxColor = ["case", [">", ["get", "g"], ["get", "lim"]], "#d64545", [">", ["get", "g"], ["*", .75, ["get", "lim"]]], "#e2a90c", "#2f8f5b"];
  add({ id: "wx-grid", type: "symbol", source: "wxgrid", layout: { "icon-image": "wind", "icon-size": ["interpolate", ["linear"], ["get", "w"], 0, .8, 15, 1.5], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["get", "lbl"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.7], "text-allow-overlap": true }, paint: { "icon-color": wxColor, "icon-halo-color": "rgba(255,255,255,.85)", "icon-halo-width": 1.2, "text-color": "#14232e", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.6 } });
  add({ id: "wx-obs", type: "symbol", source: "wxobs", layout: { "icon-image": "wind", "icon-size": 1.6, "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["get", "lbl"], "text-font": ["Noto Sans Medium"], "text-size": 13, "text-offset": [0, 1.9], "text-allow-overlap": true }, paint: { "icon-color": wxColor, "icon-halo-color": "#0f2a3d", "icon-halo-width": 2, "text-color": "#0f2a3d", "text-halo-color": "#fff", "text-halo-width": 2 } });
  const sstColor = ["interpolate", ["linear"], ["get", "c"], 0, "#3b4cc0", .2, "#5b8ff9", .4, "#3fb6c7", .55, "#4cc38a", .7, "#e8c547", .85, "#f08a3c", 1, "#d63e3e"];   // c = relativ placering mellan kallast och varmast i bild
  add({ id: "wx-sst", type: "circle", source: "wxsst", paint: { "circle-radius": ["case", ["==", ["get", "obs"], 1], 17, 14], "circle-color": sstColor, "circle-opacity": .9, "circle-stroke-color": ["case", ["==", ["get", "obs"], 1], "#0f2a3d", "#ffffff"], "circle-stroke-width": ["case", ["==", ["get", "obs"], 1], 2.5, 1.5] } });
  add({ id: "wx-sst-lbl", type: "symbol", source: "wxsst", layout: { "text-field": ["get", "lbl"], "text-font": ["case", ["==", ["get", "obs"], 1], ["literal", ["Noto Sans Medium"]], ["literal", ["Noto Sans Regular"]]], "text-size": ["case", ["==", ["get", "obs"], 1], 12, 10.5], "text-allow-overlap": true }, paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,.45)", "text-halo-width": 1 } });
  add({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#1d6fa3", "fill-opacity": .08 } });
  add({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#1d6fa3", "line-width": 1 } });
  add({ id: "shown", type: "line", source: "shown", paint: { "line-color": "#1d6fa3", "line-width": 4, "line-opacity": .85 } });
  add({ id: "track", type: "line", source: "live", paint: { "line-color": "#d64545", "line-width": 4, "line-opacity": .85 } });
  add({ id: "route", type: "line", source: "route", paint: { "line-color": ["case", ["==", ["get", "off"], 1], "#e07b00", "#d64545"], "line-width": ["case", ["==", ["get", "off"], 1], 3, 3.5], "line-dasharray": [2, 1.5] } });
  add({ id: "route-lbl", type: "symbol", source: "route", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-allow-overlap": false }, paint: { "text-color": "#d64545", "text-halo-color": "#fff", "text-halo-width": 2 } });
  /* AIS: klara färger som inte är blå (vattnet och djupkurvorna är blå), mörk kant och en ljus ring bakom */
  const aisColor = ["match", ["get", "cat"], "pass", "#e8175d", "cargo", "#16a34a", "tank", "#dc2626", "fish", "#f97316", "sail", "#9333ea", "leis", "#facc15", "serv", "#84cc16", "#334155"];
  add({ id: "ais-vec", type: "line", source: "aisvec", paint: { "line-color": "#14232e", "line-width": 1.4, "line-dasharray": [2, 1.5], "line-opacity": .7 } });
  add({ id: "ais-bg", type: "circle", source: "ais", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 15, 16, 20], "circle-color": "#ffffff", "circle-opacity": .82, "circle-stroke-color": "#0b1620", "circle-stroke-width": 1, "circle-stroke-opacity": .5 } });
  add({ id: "ais", type: "symbol", source: "ais", layout: { "icon-image": ["case", ["==", ["get", "moving"], 1], "ship", "ship-still"], "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .75, 12, 1.15, 16, 1.5], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["step", ["zoom"], "", 11.5, ["get", "name"]], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.7], "text-anchor": "top", "text-optional": true }, paint: { "icon-color": aisColor, "icon-halo-color": "#0b1620", "icon-halo-width": 1.6, "text-color": "#14232e", "text-halo-color": "#ffffff", "text-halo-width": 1.8 } });
  add({ id: "drift-line", type: "line", source: "drift", layout: { "line-cap": "round" }, paint: { "line-color": "#7a4fb0", "line-width": 4, "line-dasharray": [1.2, 1.2] } });
  add({ id: "drift-pts", type: "circle", source: "driftpts", paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#7a4fb0", "circle-stroke-width": 3 } });
  add({ id: "drift-lbl", type: "symbol", source: "driftpts", layout: { "text-field": ["get", "lbl"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": true }, paint: { "text-color": "#4b2a7a", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
  add({ id: "navto", type: "line", source: "navto", paint: { "line-color": "#2f8f5b", "line-width": 3, "line-dasharray": [1, 1.2] } });
  add({ id: "heading", type: "line", source: "heading", paint: { "line-color": "#d64545", "line-width": 2, "line-dasharray": [3, 3] } });
  add({ id: "catch-heat", type: "heatmap", source: "catches", maxzoom: 16, layout: { visibility: "none" }, paint: { "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 14, 40], "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 8, .8, 14, 1.6], "heatmap-opacity": .75,
    "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(255,200,0,0)", .2, "rgba(255,200,0,.5)", .5, "#ff8a00", .8, "#e0218a", 1, "#7a1fa2"] } });
  add({ id: "catches", type: "symbol", source: "catches", layout: { "icon-image": "catch-fish", "icon-size": ["interpolate", ["linear"], ["zoom"], 8, .7, 14, 1, 17, 1.2], "icon-allow-overlap": true, "icon-ignore-placement": true } });
  add({ id: "anchor-fill", type: "fill", source: "anchor", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["case", ["==", ["get", "out"], 1], "#d64545", "#2f8f5b"], "fill-opacity": .12 } });
  add({ id: "anchor-line", type: "line", source: "anchor", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ["case", ["==", ["get", "out"], 1], "#d64545", "#2f8f5b"], "line-width": 2.5, "line-dasharray": [2, 1.5] } });
  add({ id: "anchor-pt", type: "circle", source: "anchor", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": "#0f2a3d", "circle-stroke-width": 3 } });
  add({ id: "mob", type: "circle", source: "mob", paint: { "circle-radius": 12, "circle-color": "#d64545", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
}
map.on("style.load", () => { // inte "load": den väntar på alla källor, och en nere OSM-källa får inte stoppa appen
  mapReady = true; addOverlays(); applyLayers(); drawPlaces(); refreshCatches(); updateFishZone(); updateCross();
  if (curTrack) setLive();
  if (wps.length) drawWps();
  if (mob) setData("mob", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lnglat(mob) } }] });
  if (gps) setData("acc", circlePoly(gps, gps.acc || 1));
  anchorDraw();
  if (wxOn) renderWxLayer();
  renderAis();
  if (nav) { setData("route", { type: "FeatureCollection", features: nav.pts.slice(1).map((p, k) => ({ type: "Feature", properties: { label: "" }, geometry: { type: "LineString", coordinates: [lnglat(nav.pts[k]), lnglat(p)] } })) }); updateNav(gps || ll(map.getCenter())); }
});
map.on("error", e => console.warn("Karta:", String(e && e.error && e.error.message || e)));
/* finns sjökortsfilen? annars gatukarta för stunden (sparas inte som val) */
new pmtiles.PMTiles(CHART_URL.replace("pmtiles://", "")).getHeader().catch(() => {
  toast("Sjökortet kunde inte laddas. Visar gatukarta tills vidare.", 4000);
  chartMissing = true; applyLayers();
});
let chartMissing = false;
const setData = (id, data) => { const s = mapReady && map.getSource(id); if (s) s.setData(data); };
const lineFC = (coords, props = {}) => ({ type: "FeatureCollection", features: coords.length > 1 ? [{ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } }] : [] });
function circlePoly(c, m, n = 48) {
  const pts = []; for (let i = 0; i <= n; i++) { const p = dest(c, i * 360 / n, m / NM); pts.push([p.lng, p.lat]); }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } }] };
}

const dz = () => +S.layers.detailZoom || 13;
function renderSatLegend(on) {
  const el = $("#satlegend"); if (!el) return;
  el.hidden = !on; if (!on) return;
  const n = needDepth().toFixed(1).replace(".", ",") + (wlM() && Math.abs(wl.cm) >= 3 ? ` (vattenst. ${fmtCm(wl.cm)})` : "");
  el.innerHTML = `<b>Djup</b><span><i style="background:#ff5a5a"></i>under ${n} m</span><span><i style="background:#7fd6ff"></i>till 3 m</span><span><i style="background:#3d9ed6"></i>3–6 m</span><span><i style="background:#1f5f9a"></i>6–10 m</span><span><i style="background:transparent;border:1px solid #fff"></i>över 10 m</span>`;
  requestAnimationFrame(() => document.documentElement.style.setProperty("--legend-h", el.offsetHeight + "px"));
}
function applyLayers() {
  if (!mapReady) return;
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  const base = chartMissing && S.layers.base === "chart" ? "osm" : S.layers.base;
  vis("osm", base === "osm");
  vis("sat", base === "sat" && !mmlKey());
  vis("mml-orto", base === "sat" && !!mmlKey());
  vis("mml-prop", !!S.layers.props);
  ["depare-sat", "depare-sat-line", "depare-sat-lbl"].forEach(id => vis(id, base === "sat"));
  renderSatLegend(base === "sat" && (S.layers.groups || {}).satdepth !== false);
  KummelChart.layerIds().forEach(id => vis(id, base === "chart" || (base === "sat" && KummelChart.isOverlay(id))));
  KummelChart.soundingIds().forEach(id => vis(id, (base === "chart" || (base === "sat" && id === "soundg-shallow")) && S.layers.soundings));
  $("#b-detail").setAttribute("aria-pressed", !!S.layers.detail);
  KummelChart.detailIds().forEach(id => { vis(id, base === "chart" && !!S.layers.detail); if (map.getLayer(id)) map.setLayerZoomRange(id, id === "detail-harbour" ? Math.max(14, dz()) : dz(), 24); });
  const G = KummelChart.groups(), on = g => (S.layers.groups || {})[g] !== false;
  Object.entries(G).forEach(([g, ids]) => { if (!on(g)) ids.forEach(id => vis(id, false)); });
  if (S.mode !== "fiske") (G.steep || []).forEach(id => vis(id, false));   // branter bara i fiskeläget
}

/* ---------- places (markers) ---------- */
const CATS = {
  hamn: { e: "⚓", c: "#1d6fa3", n: "Hamn" },
  ankring: { e: "⛵", c: "#0f2a3d", n: "Ankring / naturhamn" },
  bad: { e: "🏊", c: "#2f8f5b", n: "Bad" },
  fiske: { e: "🎣", c: "#c9921b", n: "Fiskeplats" },
  service: { e: "⛽", c: "#7a4fb0", n: "Service" },
  fara: { e: "⚠️", c: "#d64545", n: "Varning / grund" },
  ovrigt: { e: "📍", c: "#5d6b73", n: "Övrigt" }
};
let placeMarkers = [];
function drawPlaces() {
  placeMarkers.forEach(m => m.remove()); placeMarkers = [];
  S.places.forEach(p => {
    const c = CATS[p.cat] || CATS.ovrigt, el = document.createElement("button");
    el.className = "pl-icon"; el.style.background = c.c; el.innerHTML = `<span>${c.e}</span>`; el.setAttribute("aria-label", p.name);
    el.addEventListener("click", e => { e.stopPropagation(); openPlace(p.id); });
    placeMarkers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([p.lng, p.lat]).addTo(map));
  });
}
function refreshCatches() {
  if (mapReady && map.getLayer("catch-heat")) map.setLayoutProperty("catch-heat", "visibility", S.mode === "fiske" && S.heat ? "visible" : "none");
  setData("catches", { type: "FeatureCollection", features: S.mode === "fiske" ? S.catches.map(c => ({ type: "Feature", properties: { id: c.id }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } })) : [] });
}
map.on("click", "catches", e => { const id = e.features[0].properties.id; e.preventDefault(); openCatch(id); });
/* brant: linjen är smal, så ett tryck i närheten räcker (ca en fingertopp åt varje håll).
   Ett tryck till när rutan är öppen stänger den, liksom att flytta kartan eller vänta. */
let steepPop = null;
const FINGER = 22;   // px runt trycket som räknas som träff
map.on("click", e => {
  if (planning || e.defaultPrevented || !map.getLayer("steep") || map.getLayoutProperty("steep", "visibility") === "none") return;
  if (steepPop) { steepPop.remove(); steepPop = null; e.preventDefault(); return; }
  const { x, y } = e.point;
  const hits = map.queryRenderedFeatures([[x - FINGER, y - FINGER], [x + FINGER, y + FINGER]], { layers: ["steep"] });
  if (!hits.length) return;
  // närmaste brant (om flera ligger nära)
  let best = hits[0], bd = Infinity;
  hits.forEach(f => { const g = f.geometry, cs = g.type === "LineString" ? g.coordinates : g.type === "MultiLineString" ? g.coordinates.flat() : [];
    cs.forEach(c => { const q = map.project(c), d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best = f; } }); });
  const p = best.properties, v = +p.v, dv = +p.dv, s = +p.s;
  e.preventDefault();
  steepPop = new maplibregl.Popup({ closeButton: false, maxWidth: "240px" }).setLngLat(e.lngLat)
    .setHTML(`<div style="font:600 13px var(--f-ui);color:#14232e"><b>Brant</b><br>Djupet ökar från ${v} m till ${v + dv} m på ungefär ${Math.max(1, Math.round(dv / s))} m.<div style="font-weight:400;color:#5d6b73;margin-top:4px">Branter och kanter är ofta bra ställen för gädda, abborre och gös.</div></div>`).addTo(map);
  const pop = steepPop; pop.getElement().addEventListener("click", ev => { ev.stopPropagation(); pop.remove(); if (steepPop === pop) steepPop = null; });
  setTimeout(() => { pop.remove(); if (steepPop === pop) steepPop = null; }, 9000);
});
map.on("movestart", e => { if (e.originalEvent && steepPop) { steepPop.remove(); steepPop = null; } });
/* vattentrafikmärke: liten ruta med vad märket gäller. Stängs av sig själv, vid tryck någon annanstans eller när kartan flyttas */
let signPop = null;
map.on("click", "signs", e => {
  if (planning || e.defaultPrevented) return;
  e.preventDefault();
  const p = e.features[0].properties, nm = p.name && p.name !== "?" ? p.name : "";
  const cable = +p.lt === 31 || +p.lt === 32;   // kabel- och ledningstavlor (ägs av elbolag, kommuner m.fl.)
  const head = p.val ? `Fartbegränsning ${Math.round(p.val)} km/h` : cable ? "Kabel eller ledning på botten" : "Vattentrafikmärke";
  const rows = [p.t1, p.t2].filter(Boolean).map(t => `<div>Tilläggstavla: <b>${esc(t)}</b></div>`).join("")
    + (p.loc ? `<div>${esc(p.loc)}</div>` : "") + (nm ? `<div>${esc(nm)}</div>` : "")
    + (p.own ? `<div class="muted">Ägare: ${esc(p.own)}</div>` : "");
  if (signPop) signPop.remove();
  signPop = new maplibregl.Popup({ closeButton: false, maxWidth: "260px", offset: 12 }).setLngLat(e.features[0].geometry.coordinates)
    .setHTML(`<div class="sign-pop"><b>${head}</b>${rows}<div class="muted">${p.val ? "Gäller i området runt märket." : cable ? "Ankra eller tråla inte i närheten. Läs skylten på plats." : "Förbud, begränsning eller anvisning. Läs skylten på plats."} Källa: Väylävirasto.</div></div>`).addTo(map);
  const pop = signPop; pop.getElement().addEventListener("click", ev => { ev.stopPropagation(); pop.remove(); });
  setTimeout(() => pop.remove(), 9000);
});
map.on("movestart", e => { if (e.originalEvent && signPop) { signPop.remove(); signPop = null; } });
map.on("click", e => { if (signPop && !e.defaultPrevented && !map.queryRenderedFeatures(e.point, { layers: ["signs"].filter(l => map.getLayer(l)) }).length) { signPop.remove(); signPop = null; } });
map.on("mouseenter", "catches", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "catches", () => map.getCanvas().style.cursor = "");

/* ---------- modes ---------- */
const MODES = { tur: "Båttur", fiske: "Fiske" };
function setMode(m) {
  if (S.mode && S.mode !== m) track("mode_change", { mode: m });
  if (!MODES[m]) m = "tur";   // äldre sparade lägen (segling, paddling) blir Båttur
  S.mode = m; save(); applyLayers();
  document.querySelectorAll(".modes button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
  $("#b-fish").classList.toggle("hidden", m !== "fiske");
  $("#b-depth").classList.toggle("hidden", m !== "fiske");
  $("#b-idx").classList.toggle("hidden", m !== "fiske"); idxBadge();
  $("#b-spots").classList.toggle("hidden", m !== "fiske" || !(feat("hotspots") || feat("drift"))); if (m !== "fiske") clearSpots();
  refreshCatches(); updateFishZone();
  if (wx) renderChip();
}
document.querySelectorAll(".modes button").forEach(b => b.onclick = () => { setMode(b.dataset.mode); toast(`Läge: ${MODES[b.dataset.mode]}`, 1400); });

/* ---------- sheet ---------- */
let sheetView = null;
function openSheet(title, html, view) {
  if (sheetView === "welcome" && view !== "welcome" && !termsOk()) return;
  if (draftCatch && (view || title) !== "catch:" + draftCatch.id && view !== "movecatch") discardDraft();   // osparad fångst försvinner om man byter panel
  $("#sh-title").textContent = title;
  $("#sh-body").innerHTML = html;
  if (sheetView !== (view || title)) $("#sh-body").scrollTop = 0;   // en ny panel börjar alltid högst upp
  if (sheetView === "drift" && view !== "drift") driftOff();
  if (sheetView === "spots" && view !== "spots" && view !== "drift") clearSpots();
  $("#sheet").classList.add("open");
  /* alla paneler öppnas i mellanläget; samma panel behåller sitt läge när innehållet uppdateras */
  // ruttplaneringen visas hel från början (höjden följer innehållet), övriga i mellanläget
  // ny panel: samma höjd som du senast drog till (tills panelen stängs), annars mellanläget. Ruttplaneringen visas hel.
  if (sheetView !== (view || title)) { $("#sheet").classList.remove("full", "peek", "compact"); $("#sheet").classList.add(view === "route" ? "full" : sheetPref || "compact"); }
  document.body.classList.add("sheet-open");
  sheetView = view || title; syncRail();
}
function closeSheet() {
  if (sheetView === "welcome" && !termsOk()) return;   // villkoren måste godkännas först
  $("#sheet").classList.remove("open", "full", "peek"); document.body.classList.remove("sheet-open");
  if (sheetView === "route") stopPlanning(false);
  if (draftCatch && (sheetView === "catch:" + draftCatch.id || sheetView === "movecatch")) discardDraft();
  if (sheetView === "movecatch") document.body.classList.remove("plan");
  if (sheetView === "drift") driftOff();
  if (sheetView === "spots") clearSpots();
  sheetView = null; sheetPref = null; syncRail();
}
/* vilken knapp hör panelen till? Knappen lyser medan panelen är öppen, och ett nytt tryck stänger den */
let sheetPref = null;
const MENU_VIEWS = ["features", "legend", "menu", "places", "routes", "log", "catches", "data", "about", "anchor", "offline", "boats", "boatedit", "welcome", "share", "pastcatch"];
function railOwner(v) {
  if (!v) return null;
  if (v === "layers") return "#b-layers"; if (v === "place") return "#b-place"; if (v === "fishidx") return "#b-idx"; if (v === "spots" || v === "drift") return "#b-spots"; if (v === "depth") return "#b-depth";
  if (MENU_VIEWS.includes(v) || v.startsWith("track")) return "#b-menu";
  return null;
}
function syncRail() { ["#b-layers", "#b-menu", "#b-place", "#b-idx", "#b-depth", "#b-spots"].forEach(id => { const el = $(id); if (el) el.setAttribute("aria-pressed", railOwner(sheetView) === id); }); }
$("#sh-close").onclick = closeSheet;
/* dra i panelens överkant. Samma för alla paneler:
   upp = större (liten -> mellan -> helskärm), ner = mindre (helskärm -> mellan -> liten), drar man ända ner stängs den.
   En ruttplanering med punkter stängs inte med svep (då skulle rutten försvinna), den fälls bara ihop. */
let dragY = null, dragT = 0, dragH = 0;
const SH_STATES = ["peek", "compact", "full"];
function sheetState(sh) { return sh.classList.contains("peek") ? 0 : sh.classList.contains("full") ? 2 : 1; }
const SH_EASE = "cubic-bezier(.22,1,.36,1)";   // mjuk inbromsning, som i iOS
const wideUI = () => matchMedia("(min-width:900px), (orientation:landscape) and (max-height:540px)").matches;   // panelen ligger på sidan   // dator/iPad liggande: panelen ligger på sidan
/* byt läge och låt höjden glida från nuvarande till den nya */
function animSheet(sh, fromH, change) {
  change();
  if (wideUI() || !sh.classList.contains("open")) { sh.style.height = ""; sh.style.maxHeight = ""; return; }
  sh.style.transition = "none"; sh.style.height = ""; sh.style.maxHeight = "";
  const to = sh.getBoundingClientRect().height;
  sh.style.height = fromH + "px"; sh.offsetHeight;   // starta från där panelen är nu
  sh.style.transition = `height .42s ${SH_EASE}, transform .32s ${SH_EASE}`;
  sh.style.height = to + "px";
  clearTimeout(sh._t); sh._t = setTimeout(() => { sh.style.height = ""; sh.style.transition = ""; }, 460);
}
function setSheetState(sh, i, anim) {
  const go = () => { sh.classList.remove("peek", "compact", "full"); sh.classList.add(SH_STATES[i]); };
  if (anim) animSheet(sh, sh.getBoundingClientRect().height, go); else go();
}
function mayClose() { return !(sheetView === "route" && wps.length) && !(sheetView === "welcome" && !termsOk()); }
let dragSt = 0;
[".grab", ".sh-head"].forEach(sel => {
  const el = $(sel);
  el.addEventListener("touchstart", e => {
    if (e.target.closest(".x") || wideUI()) return;
    const sh = $("#sheet"); dragY = e.touches[0].clientY; dragT = Date.now(); dragSt = sheetState(sh);
    dragH = sh.getBoundingClientRect().height;
    sh.style.transition = "none"; sh.style.maxHeight = "none"; sh.style.height = dragH + "px";
    sh.classList.add("dragging");
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (dragY === null) return;
    const dy = e.touches[0].clientY - dragY, max = window.innerHeight * .9;
    let h = dragH - dy;
    if (h > max) h = max + (h - max) / 4;   // lite motstånd högst upp
    $("#sheet").style.height = Math.max(40, h) + "px";   // panelen följer fingret åt båda hållen
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (dragY === null) return;
    const dy = e.changedTouches[0].clientY - dragY, v = dy / Math.max(1, Date.now() - dragT); dragY = null;
    const sh = $("#sheet"), st = dragSt, nowH = sh.getBoundingClientRect().height;
    sh.classList.remove("dragging");
    if (Math.abs(dy) < 25) { animSheet(sh, nowH, () => setSheetState(sh, st)); return; }   // för litet drag: tillbaka
    const vh = window.innerHeight, h = dragH - dy;
    let to;
    if (Math.abs(v) > .9) to = st + (dy < 0 ? 1 : -1);    // snabbt svep: ett steg i den riktningen
    else {                                                 // annars: närmaste läge (liten, mellan, helskärm)
      const H = [72, vh * .44, vh * .88];
      to = H.reduce((b, x, i) => Math.abs(x - h) < Math.abs(H[b] - h) ? i : b, 0);
      if (to === st && dy > 0 && st > 0 && h < H[st] - 60) to = st - 1;
      if (to === st && dy < 0 && st < 2 && h > H[st] + 60) to = st + 1;
    }
    if (to < 0 || (st === 0 && dy > 30) || h < 40) {
      if (mayClose()) { sh.style.transition = ""; closeSheet(); setTimeout(() => { sh.style.height = ""; sh.style.maxHeight = ""; }, 350); return; }   // ända ner = stäng
      to = 0;
    }
    animSheet(sh, nowH, () => setSheetState(sh, Math.min(2, Math.max(0, to))));
    if (sh.classList.contains("open")) { const ns = sheetState(sh); if (ns > 0) sheetPref = SH_STATES[ns]; }
  });
  /* tryck på rubriken i det lilla läget fäller upp panelen igen */
  el.addEventListener("click", e => { const sh = $("#sheet"); if (sh.classList.contains("peek") && !e.target.closest(".x")) setSheetState(sh, 1, true); });
});

/* ---------- crosshair readout, north arrow ---------- */
function updateCross() {
  if (gps && follow) return;
  $("#g-pos").innerHTML = fmtPos(map.getCenter());
  $("#g-poslbl").textContent = "Kors";
}
map.on("move", () => { updateCross(); $("#north").style.transform = `rotate(${-map.getBearing()}deg)`; $("#b-north").classList.toggle("hidden", Math.abs(map.getBearing()) < 1 && !courseUp); });
map.on("moveend", () => { const c = map.getCenter(); S.view = { lat: c.lat, lng: c.lng, z: map.getZoom(), bearing: map.getBearing() }; save(); scheduleWx(); });
/* följ båten: att dra i kartan pausar, under gång återupptas följningen själv efter en stund */
let followWanted = false, lastTouch = 0;
function setFollow(on, quiet) {
  follow = on; if (on) followWanted = true; else courseUp = false;
  $("#b-locate").setAttribute("aria-pressed", follow);
  $("#b-locate").classList.toggle("course", courseUp);
  $("#b-follow").classList.toggle("hidden", follow || !followWanted || !gps);
  if (on && gps) { followBoat(true); $("#g-pos").innerHTML = fmtPos(gps); $("#g-poslbl").textContent = "GPS"; }
  if (!on && !quiet) updateCross();
}
function followBoat(jump) {
  const c = map.getContainer(), k = Math.min(c.clientWidth, c.clientHeight) * .22;
  const moving = gps.sog > 2 && gps.cog != null && (gps.acc || 0) < 50;   // datorns wifi-position hoppar och ger skenbar fart
  const opts = { center: lnglat(gps), duration: jump ? 600 : 900, easing: t => t };
  if (courseUp && moving) { opts.bearing = gps.cog; opts.offset = [0, k]; }
  else if (moving) { const r = rad(gps.cog - map.getBearing()); opts.offset = [-Math.sin(r) * k, Math.cos(r) * k]; }
  map.easeTo(opts);
}
map.on("movestart", e => { if (e.originalEvent && depthPop) { depthPop.remove(); depthPop = null; } });
map.on("dragstart", e => { lastTouch = Date.now(); if (follow && e.originalEvent) setFollow(false, true); });
map.on("rotatestart", e => { if (e.originalEvent) { lastTouch = Date.now(); if (courseUp) { courseUp = false; $("#b-locate").classList.remove("course"); } } });
$("#b-zin").onclick = () => map.easeTo({ zoom: map.getZoom() + 1, duration: 250, ...(follow && gps ? { center: lnglat(gps) } : {}) });
$("#b-zout").onclick = () => map.easeTo({ zoom: map.getZoom() - 1, duration: 250, ...(follow && gps ? { center: lnglat(gps) } : {}) });
$("#b-north").onclick = () => {
  if (courseUp) { courseUp = false; map.easeTo({ bearing: 0 }); toast("Norr upp", 1200); }
  else map.easeTo({ bearing: 0 });
};

/* ---------- GPS ---------- */
const boatEl = document.createElement("div");
boatEl.className = "boat-icon";
boatEl.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34"><path d="M17 3 25 29 17 24 9 29Z" fill="#d64545" stroke="#fff" stroke-width="2"/></svg>`;
const boatMarker = new maplibregl.Marker({ element: boatEl, rotationAlignment: "map" });
let boatShown = false;

/* GPS: om bevakningen tystnar (t.ex. efter att appen legat i bakgrunden på iPhone) startas den om */
let gpsErrT = 0;
function stopGps() { if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; } }
function gpsStale() { return !lastFix || Date.now() - lastFix.t > 15000; }
function restartGps() { stopGps(); startGps(); }
function startGps() {
  if (!("geolocation" in navigator)) { toast("Den här enheten saknar platstjänster."); return; }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, err => {
    if (err.code === 1) { stopGps(); toast("Platsåtkomst nekad. Tillåt plats för sidan: Inställningar → Integritet → Platstjänster → Safari-webbplatser (eller webbläsaren du använder).", 6000); return; }
    // ingen position än: be om en snabb, grövre position (wifi/mobilnät) och försök igen
    navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 });
    if (Date.now() - gpsErrT > 30000) { gpsErrT = Date.now(); toast("Söker GPS-position … Det går snabbast utomhus.", 3000); }
    if (gpsStale()) setTimeout(() => { if (gpsStale()) restartGps(); }, 5000);
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  keepAwake();
  $("#b-mob").classList.remove("hidden");
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watchId !== null && gpsStale()) restartGps(); });
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watchId !== null) keepAwake(); });

/* ---------- båtpilens riktning ----------
   GPS:ens egen kurs hoppar när det går långsamt (driver, trollar, glider in mot brygga).
   Därför: kursen räknas mellan nu och en position en bit bakåt (minst ~25 m), jämnas ut,
   och står still när farten är under ca 1 knop. Valfritt: telefonens kompass vid låg fart. */
const trail = [];   // senaste positionerna
let smoothCog = null, compassHdg = null;
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
function smoothCourse(pos, t, sog, gpsHdg, acc) {
  trail.push({ ...pos, t }); while (trail.length && t - trail[0].t > 90000) trail.shift();
  const slow = sog < 1.0;
  if (slow && S.compassSlow && compassHdg != null) return smoothCog = compassHdg;
  if (slow) return smoothCog;   // står still: behåll senaste riktning
  const base = Math.max(25, Math.min(80, (acc || 10) * 2.5));   // meter bakåt, längre när GPS:en är osäker
  let ref = null;
  for (let i = trail.length - 2; i >= 0; i--) if (distNm(trail[i], pos) * NM >= base) { ref = trail[i]; break; }
  let c = ref ? bearing(ref, pos) : null;
  const h = gpsHdg != null && !isNaN(gpsHdg) && gpsHdg >= 0 ? gpsHdg : null;
  if (h != null && sog > 3) c = c == null ? h : (c + angDiff(c, h) * .5 + 360) % 360;   // i fart är GPS:ens kurs bra, väg ihop
  if (c == null) return smoothCog;
  if (smoothCog == null) return smoothCog = c;
  const k = sog > 4 ? .6 : sog > 2 ? .4 : .25;   // mer utjämning när det går sakta
  return smoothCog = (smoothCog + angDiff(smoothCog, c) * k + 360) % 360;
}
function onCompass(e) {
  let h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  if (h == null) return;
  h = (h + (screen.orientation ? screen.orientation.angle : (window.orientation || 0)) + 360) % 360;
  compassHdg = compassHdg == null ? h : (compassHdg + angDiff(compassHdg, h) * .2 + 360) % 360;
  if (S.compassSlow && gps && gps.sog < 1.0) { gps.cog = smoothCog = compassHdg; boatMarker.setRotation(compassHdg); }
}
async function setCompass(on) {
  if (on && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
    try { if (await DeviceOrientationEvent.requestPermission() !== "granted") { toast("Kompassen fick inte användas. Tillåt rörelse och orientering för sidan.", 4000); return false; } } catch (e) { return false; }
  }
  window.removeEventListener("deviceorientationabsolute", onCompass); window.removeEventListener("deviceorientation", onCompass);
  if (on) window.addEventListener("ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation", onCompass);
  else compassHdg = null;
  return true;
}
function onFix(p) {
  const pos = { lat: p.coords.latitude, lng: p.coords.longitude }, t = p.timestamp;
  let sog = p.coords.speed != null ? p.coords.speed * KN : null;
  if (lastFix && sog == null) { const dt = (t - lastFix.t) / 3600000; if (dt > 0) sog = distNm(lastFix, pos) / dt; }
  const cog = smoothCourse(pos, t, sog ?? 0, p.coords.heading, p.coords.accuracy);
  const first = !gps;
  gps = { ...pos, sog: sog ?? 0, cog, acc: p.coords.accuracy, t };
  lastFix = { ...pos, t };
  boatMarker.setLngLat(lnglat(pos)).setRotation(cog || 0);
  if (!boatShown) { boatMarker.addTo(map); boatShown = true; }
  setData("acc", circlePoly(pos, gps.acc || 1));
  setData("heading", cog != null && gps.sog > 0.5 ? lineFC([lnglat(pos), lnglat(dest(pos, cog, gps.sog * 10 / 60))]) : EMPTY);
  $("#g-sog").textContent = gps.sog.toFixed(1);
  $("#g-cog").textContent = cog != null ? String(Math.round(cog)).padStart(3, "0") : "–";
  if (first && follow) map.jumpTo({ center: lnglat(pos), zoom: Math.max(map.getZoom(), 13) });
  if (!follow && followWanted && gps.sog > 1.5 && (gps.acc || 0) < 50 && Date.now() - lastTouch > 20000) { setFollow(true); toast("Följer båten igen", 1500); }
  if (follow) { followBoat(false); $("#g-pos").innerHTML = fmtPos(pos); $("#g-poslbl").textContent = "GPS"; }
  $("#b-follow").classList.toggle("hidden", follow || !followWanted);
  if (recording) addTrackPoint(pos, t, gps.sog);
  if (nav) updateNav(pos);
  if (mob && sheetView === "mob") updateMob();
  if (gps.sog > 0.5) depthAlarm(pos);
  anchorCheck(pos);
  if (feat("drift")) learnDrift(pos, gps.sog, gps.cog);
  if (S.wxSrc !== "map" && (first || wxPos().key !== wxKey)) loadWx();
}
$("#b-locate").onclick = () => {
  if (watchId !== null && gpsStale()) restartGps(); else startGps();
  if (!follow) {
    setFollow(true);
    if (gps) map.easeTo({ center: lnglat(gps), zoom: Math.max(map.getZoom(), 13) });
    else toast("Söker GPS-position …");
    toast("Kartan följer båten. Tryck igen för kurs upp.", 2200);
  } else if (!courseUp) { courseUp = true; setFollow(true); toast("Kurs upp: kartan vrids efter båtens kurs", 2000); }
  else { followWanted = false; setFollow(false); map.easeTo({ bearing: 0 }); toast("Fri karta", 1200); }
};
$("#b-follow").onclick = () => setFollow(true);
$("#nav-stop").onclick = () => stopNav("Navigeringen avslutad");
$("#nav-rr-yes").onclick = reroute;
$("#nav-rr-no").onclick = () => { if (nav) nav.snooze = Date.now() + 5 * 60000; $("#nav-reroute").classList.add("hidden"); };
document.querySelector(".nav-eta").onclick = setArrivalSheet;

/* shallow-water warning: what lies ahead within 3 minutes */
let lastAlarm = 0;
function depthAlarm(pos) {
  if (!gps.cog || Date.now() - lastAlarm < 60000 || !mapReady) return;
  const ahead = dest(pos, gps.cog, Math.max(0.05, gps.sog * 3 / 60));
  const pt = map.project(lnglat(ahead));
  const hits = map.queryRenderedFeatures(pt, { layers: KummelChart.depthAreaIds().filter(id => map.getLayer(id)) });
  const min = Math.min(...hits.map(f => KummelChart.minDepthOf(f)).filter(v => v != null));
  if (isFinite(min) && min < needDepth()) {
    lastAlarm = Date.now();
    toast(`Grunt framåt: ${min.toFixed(1)} m enligt kartan inom 3 min. ${boat().name} behöver ${boatNeed().toFixed(1)} m${wlM() ? ` (vattenstånd ${fmtCm(wl.cm)})` : ""}.`, 6000);
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) {}
  }
}

/* ---------- track recording ---------- */
let recording = false, curTrack = null;
const setLive = () => setData("live", lineFC(curTrack ? curTrack.pts.map(p => [p[1], p[0]]) : []));
function addTrackPoint(pos, t, sog) {
  const pts = curTrack.pts, last = pts[pts.length - 1];
  if (last && distNm({ lat: last[0], lng: last[1] }, pos) * NM < 8) return;
  pts.push([+pos.lat.toFixed(6), +pos.lng.toFixed(6), t]);
  curTrack.max = Math.max(curTrack.max, sog || 0);
  setLive();
}
$("#b-rec").onclick = () => {
  if (!recording) {
    startGps();
    recording = true; curTrack = { id: uid(), start: Date.now(), pts: [], max: 0, mode: S.mode, boat: boat().name };
    setLive();
    $("#b-rec").classList.add("on"); $("#b-rec span").textContent = "Stoppa";
    if (!follow) setFollow(true);
    toast("Spårinspelning startad. Håll skärmen på.");
  } else {
    recording = false; $("#b-rec").classList.remove("on"); $("#b-rec span").textContent = "Spela in";
    curTrack.end = Date.now(); curTrack.nm = trackNm(curTrack.pts);
    if (curTrack.pts.length > 1) { S.tracks.unshift(curTrack); save(); toast(`Tur sparad: ${curTrack.nm.toFixed(1)} nm`); }
    else toast("För kort tur för att sparas.");
    curTrack = null; setLive();
  }
};
const trackNm = pts => pts.reduce((s, p, i) => i ? s + distNm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: p[0], lng: p[1] }) : 0, 0);

/* ---------- MOB ---------- */
let mob = null;
$("#b-mob").onclick = () => {
  const pos = gps ? ll(gps) : ll(map.getCenter());
  mob = { ...pos, t: Date.now() };
  setData("mob", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lnglat(mob) } }] });
  map.easeTo({ center: lnglat(mob), zoom: Math.max(map.getZoom(), 15) });
  try { navigator.vibrate && navigator.vibrate(400); } catch (e) {}
  updateMob();
};
function updateMob() {
  if (!mob) return;
  const here = gps || ll(map.getCenter());
  const d = distNm(here, mob) * NM, b = bearing(here, mob), secs = Math.round((Date.now() - mob.t) / 1000);
  openSheet("Man överbord", `
    <div class="callout bad"><div class="big">${Math.round(d)} m</div><div>Styr <b class="num">${String(Math.round(b)).padStart(3, "0")}°</b> (${compass(b)}) · markerad för ${Math.floor(secs / 60)} min ${secs % 60} s sedan</div></div>
    <div class="muted">${fmtPosTxt(mob)}</div>
    <div class="muted">Larma 112 eller VHF kanal 16 vid nödläge.</div>
    <button class="btn warn" id="mob-clear">Avsluta MOB</button>`, "mob");
  $("#mob-clear").onclick = () => { mob = null; setData("mob", EMPTY); closeSheet(); };
}
setInterval(() => { if (mob && sheetView === "mob") updateMob(); }, 5000);

/* ---------- places ---------- */
function placeForm(p) {
  return `
    <label class="f">Namn<input id="pf-name" value="${esc(p.name)}" placeholder="t.ex. Lugna viken"></label>
    <label class="f">Typ<select id="pf-cat">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${k === p.cat ? "selected" : ""}>${c.e} ${c.n}</option>`).join("")}</select></label>
    <label class="f">Anteckning<textarea id="pf-note" rows="3" placeholder="t.ex. Bra skydd vid sydvästlig vind, 3 m djup vid berget">${esc(p.note)}</textarea></label>
    <div class="muted">${fmtPosTxt(p)}${p.depth != null ? ` · djup enligt sjökortet ${p.depth}` : ""}</div>
    <div class="row"><button class="btn pri" id="pf-save">Spara</button>${p.id ? `<button class="btn warn" id="pf-del">Ta bort</button><button class="btn" id="pf-nav">Rutt hit</button>` : ""}</div>`;
}
function newPlace(pos) {
  const p = { lat: pos.lat, lng: pos.lng, name: "", cat: S.mode === "fiske" ? "fiske" : "ankring", note: "", depth: depthAt(pos) };
  openSheet("Ny plats", placeForm(p), "place"); bindPlaceForm(p);
}
function openPlace(id) {
  const p = S.places.find(x => x.id === id); if (!p) return;
  openSheet(p.name || CATS[p.cat].n, placeForm(p), "place"); bindPlaceForm(p);
}
function bindPlaceForm(p) {
  $("#pf-save").onclick = () => {
    p.name = $("#pf-name").value.trim() || CATS[$("#pf-cat").value].n; p.cat = $("#pf-cat").value; p.note = $("#pf-note").value.trim();
    if (!p.id) { p.id = uid(); p.created = Date.now(); S.places.push(p); }
    save(); drawPlaces(); closeSheet(); toast("Platsen sparad");
  };
  const del = $("#pf-del"); if (del) del.onclick = () => { S.places = S.places.filter(x => x.id !== p.id); save(); drawPlaces(); closeSheet(); };
  const nav = $("#pf-nav"); if (nav) nav.onclick = () => { const from = gps ? ll(gps) : ll(map.getCenter()); startPlanning([from, ll(p)]); autoRoute(from, ll(p)); };
}
function depthAt(pos) {
  if (!mapReady) return null;
  const hits = map.queryRenderedFeatures(map.project(lnglat(pos)), { layers: KummelChart.depthAreaIds().filter(id => map.getLayer(id)) });
  if (!hits.length) return null;
  const f = hits[0], lo = KummelChart.minDepthOf(f), hi = KummelChart.maxDepthOf(f);
  return lo == null ? null : hi != null && hi > lo ? `${lo}–${hi} m` : `${lo} m`;
}
$("#b-place").onclick = () => newPlace(ll(map.getCenter()));
map.on("contextmenu", e => { if (!planning) newPlace(ll(e.lngLat)); });
/* long press on touch screens */
let pressT = null;
map.on("touchstart", e => {
  if (planning || (e.originalEvent.touches && e.originalEvent.touches.length > 1)) { clearTimeout(pressT); return; }
  const at = e.lngLat; pressT = setTimeout(() => { try { navigator.vibrate && navigator.vibrate(30); } catch (er) {} newPlace(ll(at)); }, 650);
});
["touchend", "touchcancel", "movestart", "zoomstart"].forEach(ev => map.on(ev, () => clearTimeout(pressT)));

/* ---------- fishing ---------- */
const SPECIES = ["Gädda", "Abborre", "Gös", "Havsöring", "Lax", "Sik", "Strömming", "Torsk", "Braxen", "Annan"];
(() => { let t = null, long = false; const b = $("#b-fish");
  b.addEventListener("pointerdown", () => { long = false; t = setTimeout(() => { long = true; try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} newPastCatch(); }, 600); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
  b.addEventListener("click", e => { if (long) { e.stopImmediatePropagation(); long = false; } }, true);
})();
$("#b-fish").onclick = async () => {
  const pos = gps ? ll(gps) : ll(map.getCenter());
  const c = { id: uid(), t: Date.now(), ...pos, depth: depthAt(pos), species: "", kg: "", lure: "", note: "", wx: null };
  draftCatch = c;   // finns först när man trycker Spara
  openCatch(c.id);
  try {
    const w = await fetchWx(pos.lat, pos.lng), h = hourIndex(w);
    c.wx = {
      wind: w.current.wind_speed_10m, gust: w.current.wind_gusts_10m, dir: w.current.wind_direction_10m,
      temp: w.current.temperature_2m, p: w.current.pressure_msl,
      pTrend: h >= 3 ? +(w.hourly.pressure_msl[h] - w.hourly.pressure_msl[h - 3]).toFixed(1) : null,
      sst: (waterNear && distNm(pos, waterNear) * 1.852 < 25 ? waterNear.v : w.marine?.current?.sea_surface_temperature) ?? null, moon: moonPhase(new Date())
    };
    save();
    if (sheetView === "catch:" + c.id) { if ($("#cf-sp")) catchForm(c); openCatch(c.id); }   // behåll det man hunnit fylla i
  } catch (e) {}
};
const findCatch = id => S.catches.find(x => x.id === id) || (draftCatch && draftCatch.id === id ? draftCatch : null);
function discardDraft() { if (!draftCatch) return; const c = draftCatch; draftCatch = null; if (c.photo) photoDel(c.id); }
function commitDraft(c) { if (draftCatch !== c) return; track("catch_saved", { species: c.species || "okand", photo: c.photo ? 1 : 0, released: c.released ? 1 : 0 }); draftCatch = null; S.catches.unshift(c); save(); refreshCatches(); }
function catchForm(c) { c.species = $("#cf-sp").value; c.kg = $("#cf-kg").value; c.len = $("#cf-len").value; c.released = $("#cf-rel").checked; c.lure = $("#cf-lure").value; c.note = $("#cf-note").value; }
/* väder vid en given tidpunkt: prognos med senaste dagarna, eller arkivet för äldre fångster */
async function wxAt(pos, t) {
  const days = (Date.now() - t) / 86400000, d = new Date(t), iso = x => x.toISOString().slice(0, 10);
  const q = `latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}&timezone=auto&wind_speed_unit=ms&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl`;
  const url = days < 80 ? `https://api.open-meteo.com/v1/forecast?${q}&past_days=${Math.min(92, Math.ceil(days) + 1)}&forecast_days=1`
    : `https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${iso(new Date(t - 86400000))}&end_date=${iso(d)}`;
  const [f, m] = await Promise.all([
    fetch(url).then(r => r.json()),
    days < 80 ? fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}&timezone=auto&hourly=sea_surface_temperature&past_days=${Math.min(92, Math.ceil(days) + 1)}&forecast_days=1`).then(r => r.ok ? r.json() : null).catch(() => null) : null
  ]);
  const H = f.hourly; if (!H) throw new Error("inget väder");
  let i = 0, best = Infinity; H.time.forEach((s, k) => { const dd = Math.abs(new Date(s).getTime() - t); if (dd < best) { best = dd; i = k; } });
  const sstI = m?.hourly?.sea_surface_temperature ? m.hourly.time.findIndex(s => Math.abs(new Date(s).getTime() - t) < 1800001) : -1;
  return {
    wind: H.wind_speed_10m[i], gust: H.wind_gusts_10m[i], dir: H.wind_direction_10m[i], temp: H.temperature_2m[i], p: H.pressure_msl[i],
    pTrend: i >= 3 ? +(H.pressure_msl[i] - H.pressure_msl[i - 3]).toFixed(1) : null,
    sst: sstI >= 0 ? m.hourly.sea_surface_temperature[sstI] : null, moon: moonPhase(d)
  };
}
/* fångster som sparades utan nät får sitt väder i efterhand, när nätet är tillbaka */
let wxFilling = false;
async function fillMissingWx() {
  if (wxFilling || !navigator.onLine) return; wxFilling = true;
  try {
    for (const c of S.catches.filter(c => !c.wx).slice(0, 10)) {
      try { c.wx = await wxAt(c, c.t); save(); if (sheetView === "catch:" + c.id && !$("#cf-sp")) openCatch(c.id); } catch (e) {}
    }
  } finally { wxFilling = false; }
}
window.addEventListener("online", () => setTimeout(fillMissingWx, 3000));
setTimeout(fillMissingWx, 8000);
/* registrera en fångst i efterhand: tid och plats väljs, vädret hämtas för just då */
function newPastCatch() {
  const now = new Date(Date.now() - 60 * 60000), pad2 = n => String(n).padStart(2, "0");
  const local = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (S.mode !== "fiske") setMode("fiske");
  openSheet("Fångst i efterhand", `
    <div class="callout">Flytta kartan så att <b>korset</b> står där du fick fisken. Du kan dra i kartan medan den här rutan är öppen.</div>
    <div class="muted" id="pc-pos">${fmtPosTxt(ll(map.getCenter()))}</div>
    <label class="f">När<input type="datetime-local" id="pc-t" value="${local}" max="${local.slice(0, 10)}T23:59"></label>
    <div class="grid2">
      <label class="f">Art<select id="pc-sp"><option value="">Välj</option>${SPECIES.map(s => `<option>${s}</option>`).join("")}</select></label>
      <label class="f">Vikt (kg)<input id="pc-kg" inputmode="decimal"></label>
      <label class="f">Längd (cm)<input id="pc-len" inputmode="decimal"></label>
      <label class="row f-chk"><input type="checkbox" id="pc-rel"> Catch &amp; release</label>
    </div>
    <label class="f">Bete / metod<input id="pc-lure" placeholder="t.ex. jigg 10 cm"></label>
    <label class="f">Anteckning<textarea id="pc-note" rows="2"></textarea></label>
    <div class="row"><button class="btn pri" id="pc-save">Spara fångst här</button></div>
    <div class="muted">Väder, lufttryck, vattentemperatur och månfas hämtas för den tidpunkt du anger.</div>`, "pastcatch");
  $("#sheet").classList.add("compact");
  const upd = () => { const el = $("#pc-pos"); if (el && sheetView === "pastcatch") el.textContent = fmtPosTxt(ll(map.getCenter())); };
  map.on("move", upd);
  $("#pc-save").onclick = async () => {
    map.off("move", upd);
    const t = new Date($("#pc-t").value).getTime();
    if (!isFinite(t) || t > Date.now() + 60000) { toast("Ange en tidpunkt som har varit."); return; }
    const pos = ll(map.getCenter());
    const c = { id: uid(), t, ...pos, depth: depthAt(pos), species: $("#pc-sp").value, kg: $("#pc-kg").value, len: $("#pc-len").value, released: $("#pc-rel").checked, lure: $("#pc-lure").value, note: $("#pc-note").value, wx: null, past: true };
    S.catches.push(c); S.catches.sort((x, y) => y.t - x.t); save(); refreshCatches(); track("catch_saved", { species: c.species || "okand", past: 1 });
    toast("Fångsten är sparad"); openCatch(c.id);
    try { c.wx = await wxAt(pos, t); save(); if (sheetView === "catch:" + c.id) openCatch(c.id); } catch (e) { toast("Vädret för den tiden kunde inte hämtas."); }
  };
}
function openCatch(id) {
  const c = findCatch(id); if (!c) return;
  const draft = c === draftCatch;
  const d = new Date(c.t), w = c.wx;
  openSheet("Fångst", `
    <div class="pos-line"><div class="muted">${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1} kl ${hm(d)} · ${fmtPosTxt(c)}${c.depth ? ` · djup ${c.depth}` : ""}</div><button class="btn sm" id="cf-move">Flytta</button></div>
    <div class="ph-box" id="cf-ph"><span class="muted">Inget foto</span></div>
    <label class="btn ph-btn">${c.photo ? "Byt foto" : "📷 Lägg till foto"}<input type="file" id="cf-file" accept="image/*" hidden></label>
    <div class="grid2">
      <label class="f">Art<select id="cf-sp"><option value="">Välj</option>${SPECIES.map(s => `<option ${s === c.species ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="f">Vikt (kg)<input id="cf-kg" inputmode="decimal" value="${esc(c.kg)}"></label>
      <label class="f">Längd (cm)<input id="cf-len" inputmode="decimal" value="${esc(c.len || "")}"></label>
      <label class="row f-chk"><input type="checkbox" id="cf-rel" ${c.released ? "checked" : ""}> Catch &amp; release</label>
    </div>
    <label class="f">Bete / metod<input id="cf-lure" value="${esc(c.lure)}" placeholder="t.ex. jigg 10 cm, trolling 2,5 kn"></label>
    <label class="f">Anteckning<textarea id="cf-note" rows="2">${esc(c.note)}</textarea></label>
    <div class="card"><h3>Förhållanden vid fångsten</h3>
      ${w ? `<div class="wx-stats">
        <div><b>${w.wind.toFixed(0)}–${w.gust.toFixed(0)}</b><span>Vind m/s ${compass(w.dir)}</span></div>
        <div><b>${Math.round(w.p)}</b><span>Tryck ${w.pTrend == null ? "" : w.pTrend > 0.5 ? "↑ stiger" : w.pTrend < -0.5 ? "↓ faller" : "→ stabilt"}</span></div>
        <div><b>${w.sst != null ? w.sst.toFixed(1) + "°" : "–"}</b><span>Vatten</span></div>
        <div><b>${w.temp.toFixed(0)}°</b><span>Luft</span></div>
        <div><b>${w.moon.icon}</b><span>${w.moon.name}</span></div></div>` : `<div class="muted">Hämtar väder … (sparas automatiskt när nätet finns)</div>`}
    </div>
    ${draft ? `<div class="row"><button class="btn pri" id="cf-save">Spara fångst</button><button class="btn" id="cf-share">Spara och dela</button><button class="btn" id="cf-del">Avbryt</button></div>
      <div class="muted">Fångsten hamnar på kartan och i fångstloggen när du sparar.</div>`
    : `<div class="row"><button class="btn pri" id="cf-save">Spara</button><button class="btn" id="cf-share">Dela fångst</button><button class="btn warn" id="cf-del">Ta bort</button></div>`}`, "catch:" + c.id);
  if (c.photo && $("#sheet").classList.contains("compact")) setSheetState($("#sheet"), 2);   // med foto: visa hela panelen
  const read = () => { catchForm(c); save(); };
  if (c.photo) photoGet(c.id).then(b => { const el = $("#cf-ph"); if (b && el && sheetView === "catch:" + c.id) { el.innerHTML = ""; const im = new Image(); im.src = URL.createObjectURL(b); im.alt = "Foto på fångsten"; el.appendChild(im);
    im.onclick = () => { const o = document.createElement("div"); o.className = "ph-full"; const big = new Image(); big.src = im.src; o.appendChild(big); o.onclick = () => o.remove(); document.body.appendChild(o); }; } });
  $("#cf-file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { read(); await photoPut(c.id, await shrinkPhoto(f)); c.photo = 1; save(); openCatch(c.id); toast("Fotot är sparat", 1500); }
    catch (err) { toast("Fotot kunde inte sparas."); }
  };
  $("#cf-save").onclick = () => { read(); commitDraft(c); save(); refreshCatches(); closeSheet(); toast("Fångsten är sparad"); };
  $("#cf-share").onclick = () => { read(); const was = draft; commitDraft(c); openShare(c.id, was); };
  $("#cf-move").onclick = () => { read(); moveCatch(c); };
  $("#cf-del").onclick = () => {
    if (draft) { closeSheet(); toast("Fångsten sparades inte", 1500); return; }
    S.catches = S.catches.filter(x => x.id !== c.id); photoDel(c.id); save(); refreshCatches(); closeSheet();
  };
}

/* flytta en fångst: kartan centreras på den, man drar kartan så att korset står rätt och sparar */
function moveCatch(c) {
  const from = { lat: c.lat, lng: c.lng };
  map.easeTo({ center: lnglat(c), zoom: Math.max(map.getZoom(), 15), duration: 400 });
  openSheet("Flytta fångsten", `
    <div class="callout">Dra kartan så att <b>korset</b> står exakt där du fick fisken.</div>
    <div class="muted" id="mv-pos">${fmtPosTxt(c)}</div>
    <div class="row"><button class="btn pri" id="mv-ok">Spara platsen</button><button class="btn" id="mv-cancel">Avbryt</button></div>`, "movecatch");
  setSheetState($("#sheet"), 1);
  document.body.classList.add("plan");   // visar korset tydligt
  const upd = () => { const el = $("#mv-pos"); if (el && sheetView === "movecatch") el.textContent = fmtPosTxt(ll(map.getCenter())) + " · " + Math.round(distNm(from, ll(map.getCenter())) * NM) + " m från förut"; };
  map.on("move", upd);
  const done = () => { map.off("move", upd); document.body.classList.remove("plan"); };
  $("#mv-ok").onclick = () => {
    const p = ll(map.getCenter()); c.lat = +p.lat.toFixed(6); c.lng = +p.lng.toFixed(6); c.depth = depthAt(p);
    done(); save(); refreshCatches(); track("catch_moved"); toast("Fångsten är flyttad", 1500); openCatch(c.id);
  };
  $("#mv-cancel").onclick = () => { done(); openCatch(c.id); };
}

/* ---------- foton (IndexedDB, för stora för localStorage) ---------- */
let phDb = null;
function phOpen() {
  if (phDb) return phDb;
  return phDb = new Promise((res, rej) => { const r = indexedDB.open("kummel-photos", 1); r.onupgradeneeded = () => r.result.createObjectStore("p"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function phTx(mode, fn) { const db = await phOpen(); return new Promise((res, rej) => { const t = db.transaction("p", mode), q = fn(t.objectStore("p")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); }
const photoPut = (id, blob) => phTx("readwrite", s => s.put(blob, id));
const photoGet = id => phTx("readonly", s => s.get(id)).catch(() => null);
const photoDel = id => phTx("readwrite", s => s.delete(id)).catch(() => {});
async function shrinkPhoto(file, max = 1600) {
  const url = URL.createObjectURL(file), im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement("canvas");
  cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
  cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
  return new Promise(res => cv.toBlob(res, "image/jpeg", .85));
}

/* ---------- dela fångst som bild ---------- */
const FISH_PATH = "M2 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6zm15-1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2 12 0 8v8z";
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
async function catchCard(c, where) {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), F = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  g.fillStyle = "#0f2a3d"; g.fillRect(0, 0, W, H);
  // räkna ut textens höjd först, så att fotot lämnar plats och inget krockar med foten
  const L = 72, d = new Date(c.t), w = c.wx;
  const size = [c.kg && `${String(c.kg).replace(".", ",")} kg`, c.len && `${String(c.len).replace(".", ",")} cm`].filter(Boolean).join("  ·  ");
  const facts = [`${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} kl ${hm(d)}`];
  if (w) { facts.push(`Vind ${w.wind.toFixed(0)} m/s ${compass(w.dir)}`); if (w.sst != null) facts.push(`Vatten ${w.sst.toFixed(1).replace(".", ",")}°`); if (w.pTrend != null) facts.push(w.pTrend < -0.5 ? "Fallande tryck" : w.pTrend > 0.5 ? "Stigande tryck" : "Stabilt tryck"); facts.push(`${w.moon.icon} ${w.moon.name}`); }
  if (c.lure) facts.push(c.lure);
  g.font = `500 36px ${F}`;
  let lines = 1, lx = L; facts.forEach((t, i) => { const tw = g.measureText((i ? "  ·  " : "") + t).width; if (lx + tw > W - L && lx > L) { lines++; lx = L + g.measureText(t).width; } else lx += tw; });
  const textH = 20 + 150 + (size ? 76 : 30) + (lines - 1) * 52 + (where ? 60 : 0) + 34;   // rubrik, mått, fakta, plats
  const PH = Math.max(520, Math.min(800, H - 150 - textH));
  const blob = c.photo ? await photoGet(c.id) : null;
  if (blob) {
    const im = new Image(), u = URL.createObjectURL(blob);
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = u; });
    const k = Math.max(W / im.naturalWidth, PH / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
    g.save(); g.beginPath(); g.rect(0, 0, W, PH); g.clip();   // fotot bara i bildytan, inte under texten
    g.drawImage(im, (W - iw) / 2, (PH - ih) / 2, iw, ih); g.restore(); URL.revokeObjectURL(u);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, PH); gr.addColorStop(0, "#3d9ed6"); gr.addColorStop(1, "#123a55");
    g.fillStyle = gr; g.fillRect(0, 0, W, PH);
    g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 4;
    for (let y = 120; y < PH; y += 90) { g.beginPath(); for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x / 70 + y) * 10); g.stroke(); }
    g.save(); g.translate(W / 2 - 330, PH / 2 - 330); g.scale(27.5, 27.5); g.fillStyle = "rgba(255,255,255,.88)"; g.fill(new Path2D(FISH_PATH), "evenodd"); g.restore();
  }
  const sh = g.createLinearGradient(0, PH - 260, 0, PH); sh.addColorStop(0, "rgba(15,42,61,0)"); sh.addColorStop(1, "rgba(15,42,61,1)");
  g.fillStyle = sh; g.fillRect(0, PH - 260, W, 260);
  let y = PH + 20;
  g.fillStyle = "#fff"; g.font = `800 96px ${F}`; g.textBaseline = "alphabetic";
  g.fillText(c.species || "Fångst", L, y + 70);
  y += 150;
  if (size) { g.fillStyle = "#f2c14e"; g.font = `800 64px ${F}`; g.fillText(size, L, y); }
  if (c.released) {
    g.font = `700 34px ${F}`; const t = "Catch & release", tw = g.measureText(t).width;
    const bx = W - L - tw - 48, by = (size ? y : y - 30) - 52; rrect(g, bx, by, tw + 48, 64, 32); g.fillStyle = "#2f8f5b"; g.fill();
    g.fillStyle = "#fff"; g.fillText(t, bx + 24, by + 44);
  }
  g.font = `500 36px ${F}`; g.fillStyle = "#c8d6de";
  let fx = L, fy = y + (size ? 76 : 30);
  facts.forEach((t, i) => { const s = (i ? "  ·  " : "") + t, tw = g.measureText(s).width; if (fx + tw > W - L && fx > L) { fx = L; fy += 52; g.fillText(t, fx, fy); fx += g.measureText(t).width; } else { g.fillText(s, fx, fy); fx += tw; } });
  if (where) { fy += 60; g.fillStyle = "#fff"; g.font = `600 36px ${F}`; g.fillText("📍 " + where, L, fy); }
  // fot: logga och adress, avskild med en tunn linje
  const fyB = H - 64;
  g.fillStyle = "rgba(255,255,255,.14)"; g.fillRect(L, H - 140, W - 2 * L, 2);
  // appikonen: mörk ruta, blå kummel med gult band och röd rand
  g.save(); g.translate(L, fyB - 46); g.scale(.54, .54); rrect(g, 0, 0, 100, 100, 22); g.fillStyle = "#0f2a3d"; g.fill(); g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 2; g.stroke();
  g.translate(50, 51); g.scale(.84, .84); g.translate(-50, -51);
  g.fillStyle = "#0053a5"; g.fill(new Path2D("M50 16 L80 84 L20 84 Z")); g.fillStyle = "#ffce00"; g.fillRect(18, 63, 64, 9); g.fillStyle = "#d21034"; g.fillRect(18, 65.6, 64, 3.8); g.restore();
  g.fillStyle = "#fff"; g.font = `800 44px ${F}`; g.fillText("Kummel", L + 66, fyB - 10);
  g.fillStyle = "#93a5ae"; g.font = `500 26px ${F}`; g.fillText("sjökort och fiske i skärgården", L + 66, fyB + 26);
  g.fillStyle = "#f2c14e"; g.font = `800 42px ${F}`; g.fillText(SITE, W - L - g.measureText(SITE).width, fyB + 8);   // adressen syns för den som blir nyfiken
  return cv;
}
async function openShare(id, justSaved) {
  const c = findCatch(id); if (!c) return;
  const sel = S.shareWhere || "aland";
  openSheet("Dela fångst", `
    <div class="share-prev" id="sh-prev"><span class="muted">Skapar bild …</span></div>
    <label class="f">Plats på bilden<select id="sh-where">
      <option value="none" ${sel === "none" ? "selected" : ""}>Visa ingen plats</option>
      <option value="aland" ${sel === "aland" ? "selected" : ""}>Bara "Ålands skärgård"</option>
      <option value="exact" ${sel === "exact" ? "selected" : ""}>Exakt position (avslöjar platsen)</option></select></label>
    <div class="row"><button class="btn pri" id="sh-go">Dela</button><button class="btn" id="sh-save">Spara i Bilder</button><button class="btn" id="sh-back">Tillbaka</button></div>
    <div class="muted">${justSaved ? "Fångsten är sparad i din fångstlogg. " : ""}Bilden skapas i telefonen. Inget laddas upp av Kummel.</div>`, "share");
  let cv = null;
  const where = () => ({ none: "", aland: "Ålands skärgård", exact: fmtPosTxt(c) })[$("#sh-where").value];
  const draw = async () => {
    cv = await catchCard(c, where()); const p = $("#sh-prev"); if (!p) return;
    p.innerHTML = ""; const im = new Image(); im.src = cv.toDataURL("image/jpeg", .8); p.appendChild(im);
  };
  $("#sh-where").onchange = () => { S.shareWhere = $("#sh-where").value; save(); draw(); };
  await draw();
  const blob = () => new Promise(r => cv.toBlob(r, "image/jpeg", .9));
  const name = `kummel-${(c.species || "fangst").toLowerCase()}-${new Date(c.t).toISOString().slice(0, 10)}.jpg`;
  $("#sh-go").onclick = async () => {
    track("catch_shared", { where: $("#sh-where").value });
    const f = new File([await blob()], name, { type: "image/jpeg" });
    const text = `${c.species || "Fångst"}${c.kg ? " " + c.kg + " kg" : ""}${c.len ? " " + c.len + " cm" : ""} 🎣\nLoggad med Kummel: ${SITE}`;
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text }); } catch (e) {} }
    else { saveImg(f, name); toast("Bilden är sparad. Dela den från bilderna i telefonen.", 3500); }
  };
  /* "Spara i Bilder": webbappar får inte skriva direkt till bildbiblioteket, men telefonens delningsmeny har "Spara bild" som lägger den i Bilder */
  $("#sh-save").onclick = async () => {
    const f = new File([await blob()], name, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      toast("Välj \"Spara bild\" i menyn som öppnas", 3500);
      try { await navigator.share({ files: [f] }); } catch (e) {}
    } else saveImg(f, name);
  };
  $("#sh-back").onclick = () => openCatch(c.id);
}
function saveImg(b, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

const MOON_FIX = { "Tilltagande": "Tilltagande måne", "Avtagande": "Avtagande måne", "Första kvarteret": "Halvmåne, tilltagande", "Sista kvarteret": "Halvmåne, avtagande" };
S.catches.forEach(c => { if (c.wx && c.wx.moon && MOON_FIX[c.wx.moon.name]) c.wx.moon.name = MOON_FIX[c.wx.moon.name]; });   // äldre fångster
function moonPhase(d) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((d - ref) / 86400000) % syn + syn) % syn, f = age / syn;
  const names = [["🌑", "Nymåne"], ["🌒", "Tilltagande måne"], ["🌓", "Halvmåne, tilltagande"], ["🌔", "Tilltagande måne"], ["🌕", "Fullmåne"], ["🌖", "Avtagande måne"], ["🌗", "Halvmåne, avtagande"], ["🌘", "Avtagande måne"]];
  const [icon, name] = names[Math.round(f * 8) % 8];
  return { icon, name, age: +age.toFixed(1) };
}
/* ---------- sol (för fiskeindex och statistik) ---------- */
function sunTimes(date, lat, lng) {   // förenklad suncalc: soluppgång och solnedgång
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const toDays = d => (d.valueOf() / dayMs - 0.5 + J1970) - J2000, fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
  const lw = rad * -lng, phi = rad * lat, d = toDays(date), n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n, M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)), L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)), Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cw < -1 || cw > 1) return null;   // midnattssol eller polarnatt
  const w = Math.acos(cw), a = 0.0009 + (w + lw) / (2 * Math.PI) + n, Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJ(Jnoon - (Jset - Jnoon)), set: fromJ(Jset) };
}
/* hinkar som både fiskeindexet och statistiken använder */
const bPress = t => t == null ? null : t <= -3 ? "fallsnabbt" : t <= -0.7 ? "faller" : t < 0.7 ? "stabilt" : t < 2 ? "stiger" : "stigersnabbt";
const bWind = v => v == null ? null : v < 2 ? "stilla" : v < 7 ? "lagom" : v < 11 ? "frisk" : "hård";
function bLight(t, lat, lng) {
  const s = sunTimes(new Date(t), lat, lng); if (!s) return "dag";
  const h = 5400000;
  if (Math.abs(t - s.rise) < h) return "gryning"; if (Math.abs(t - s.set) < h) return "skymning";
  return t > s.rise && t < s.set ? "dag" : "natt";
}
const BUCKET_TXT = { fallsnabbt: "snabbt fallande tryck", faller: "fallande tryck", stabilt: "stabilt tryck", stiger: "stigande tryck", stigersnabbt: "snabbt stigande tryck",
  stilla: "stilla väder", lagom: "lagom vind (2–7 m/s)", frisk: "frisk vind (7–11 m/s)", hård: "hård vind",
  gryning: "gryningen", skymning: "skymningen", dag: "dagtid", natt: "natten" };
/* vad som har fungerat för just dig: vanligaste hinken per faktor, när det finns minst 5 fångster med väder */
function myPatterns() {
  const cs = S.catches.filter(c => c.wx); if (cs.length < 5) return null;
  const top = f => { const n = {}; cs.forEach(c => { const k = f(c); if (k) n[k] = (n[k] || 0) + 1; }); const e = Object.entries(n).sort((x, y) => y[1] - x[1])[0]; return e ? { k: e[0], n: e[1], of: cs.length } : null; };
  return { press: top(c => bPress(c.wx.pTrend)), wind: top(c => bWind(c.wx.wind)), light: top(c => bLight(c.t, c.lat, c.lng)), n: cs.length };
}

/* ---------- fiskeindex ----------
   Tumregler många sportfiskare använder: fallande tryck före ett väderomslag, lagom vind som rör om,
   gryning och skymning, nymåne och fullmåne. Plus en bonus när läget liknar dina egna fångster. */
function fishIndex(w) {
  if (!w || !w.hourly) return null;
  const H = w.hourly, i0 = hourIndex(w), mine = myPatterns(), out = [];
  for (let i = i0; i < Math.min(H.time.length, i0 + 24); i++) {
    const t = new Date(H.time[i]).getTime(), why = [];
    let s = 45;
    const pt = i >= 3 ? H.pressure_msl[i] - H.pressure_msl[i - 3] : null, bp = bPress(pt);
    const pv = { fallsnabbt: -5, faller: 20, stabilt: 10, stiger: 0, stigersnabbt: -10 }[bp] ?? 0; s += pv;
    if (bp === "faller") why.push(["+", "Fallande lufttryck, fisken brukar äta inför ett väderomslag"]);
    else if (bp === "stabilt") why.push(["+", "Stabilt lufttryck"]);
    else if (bp === "stigersnabbt") why.push(["−", "Snabbt stigande tryck, ofta trögt efter en front"]);
    else if (bp === "fallsnabbt") why.push(["−", "Mycket snabbt fallande tryck, ostadigt väder på väg"]);
    const ws = H.wind_speed_10m[i], bw = bWind(ws);
    s += { stilla: 5, lagom: 15, frisk: 0, hård: -20 }[bw];
    if (bw === "lagom") why.push(["+", "Lagom vind som rör om i vattnet"]); else if (bw === "hård") why.push(["−", `Hård vind (${ws.toFixed(0)} m/s)`]); else if (bw === "stilla") why.push(["·", "Nästan stilla"]);
    const bl = bLight(t, w.lat, w.lng);
    s += { gryning: 20, skymning: 20, dag: 0, natt: -5 }[bl];
    if (bl === "gryning" || bl === "skymning") why.push(["+", `${bl === "gryning" ? "Gryning" : "Skymning"}, ofta bästa tiden`]);
    const m = moonPhase(new Date(t)); if (m.age < 2 || m.age > 27.5 || Math.abs(m.age - 14.8) < 2) { s += 5; why.push(["+", `${m.icon} ${m.age < 2 || m.age > 27.5 ? "Nymåne" : "Fullmåne"}`]); }
    let mineHit = 0;
    if (mine) { if (mine.press && mine.press.k === bp) mineHit++; if (mine.wind && mine.wind.k === bw) mineHit++; if (mine.light && mine.light.k === bl) mineHit++; s += mineHit * 4; if (mineHit >= 2) why.push(["+", "Liknar läget när du brukar få fisk"]); }
    out.push({ t, s: Math.max(0, Math.min(100, Math.round(s))), why });
  }
  return out;
}
const idxLabel = s => s >= 70 ? "Mycket bra" : s >= 55 ? "Bra" : s >= 40 ? "Medel" : "Svagt";
const idxColor = s => s >= 70 ? "#2f8f5b" : s >= 55 ? "#7cb342" : s >= 40 ? "#e2a90c" : "#c0563b";
function idxBadge() {
  const b = $("#b-idx .badge"); if (!b) return;
  const ix = S.mode === "fiske" && wx ? fishIndex(wx) : null;
  b.hidden = !ix; if (ix) { b.textContent = ix[0].s; b.style.background = idxColor(ix[0].s); }
}
$("#b-idx").onclick = openFishIndex;
$("#b-spots").onclick = () => feat("hotspots") ? openSpots() : openDrift();   // bara drift påslagen: direkt till driften
async function openFishIndex() {
  if (!wx) { openSheet("Fiskeläge", `<div class="muted">Hämtar väder …</div>`, "fishidx"); await loadWx(true); }
  const ix = fishIndex(wx);
  if (!ix || !ix.length) { openSheet("Fiskeläge", `<div class="muted">Vädret kunde inte hämtas. Fiskeläget behöver nät.</div>`, "fishidx"); return; }
  const now = ix[0], sst = sstInfo(), mine = myPatterns();
  // bästa sammanhängande fönster idag och i morgon
  const wins = []; let cur = null, top = Math.max(...ix.map(h => h.s)), lim = Math.max(60, top - 8);
  ix.forEach(h => { if (h.s >= lim) { if (!cur) cur = { a: h.t, b: h.t, s: h.s }; else { cur.b = h.t; cur.s = Math.max(cur.s, h.s); } } else if (cur) { wins.push(cur); cur = null; } });
  if (cur) wins.push(cur);
  const fmtWin = x => x.b - x.a >= 22 * 3600000 ? "hela dygnet" : `${hm(new Date(x.a))}–${hm(new Date(x.b + 3600000))}`;
  openSheet("Fiskeläge", `
    <div class="idx-now"><div class="idx-ring" style="--c:${idxColor(now.s)};--p:${now.s}"><b>${now.s}</b></div>
      <div><h3 style="margin:0">${idxLabel(now.s)} just nu</h3><div class="muted">${wins.length ? "Bäst närmaste dygnet: " + wins.slice(0, 3).map(fmtWin).join(", ") : "Inget tydligt toppläge närmaste dygnet"}</div></div></div>
    <div class="idx-bars">${ix.map(h => `<i style="height:${Math.max(6, h.s)}%;background:${idxColor(h.s)}" title="${hm(new Date(h.t))}: ${h.s}"></i>`).join("")}</div>
    <div class="idx-axis">${ix.filter((_, k) => k % 6 === 0).map(h => `<span>${hm(new Date(h.t))}</span>`).join("")}</div>
    <div class="card"><h3>Varför</h3>${now.why.map(([k, t]) => `<div class="idx-why"><b class="${k === "+" ? "up" : k === "−" ? "down" : ""}">${k}</b>${esc(t)}</div>`).join("") || `<div class="muted">Inget särskilt talar för eller emot just nu.</div>`}
      ${sst && sst.v != null ? `<div class="idx-why"><b>·</b>Vattnet är ${sst.v.toFixed(1).replace(".", ",")}°</div>` : ""}</div>
    <div class="card"><h3>Dina fångster</h3>${mine ? [mine.press, mine.wind, mine.light].filter(Boolean).map(p => `<div class="idx-why"><b>·</b>${p.n} av ${p.of} vid ${BUCKET_TXT[p.k]}</div>`).join("") + `<div class="muted">Indexet ger extra poäng när läget liknar dina fångster.</div>`
      : `<div class="muted">När du har loggat minst 5 fångster lär sig fiskeläget vad som brukar fungera för dig.</div>`}</div>
    <div class="muted">Fiskeläget bygger på tumregler som många sportfiskare använder, för platsen mitt på kartan. Ingen garanti för napp.</div>`, "fishidx");
}

/* ---------- fångstrekord och statistik ---------- */
const fmt1 = v => String(Math.round(v * 10) / 10).replace(".", ",");
function catchStats() {
  const num = v => parseFloat(String(v || "").replace(",", ".")) || 0, rec = {}, yr = new Date().getFullYear(), season = {};
  S.catches.forEach(c => {
    const sp = c.species || "Okänd art", kg = num(c.kg), len = num(c.len);
    const r = rec[sp] || (rec[sp] = { n: 0, kg: 0, len: 0, kgC: null, lenC: null });
    r.n++; if (kg > r.kg) { r.kg = kg; r.kgC = c; } if (len > r.len) { r.len = len; r.lenC = c; }
    if (new Date(c.t).getFullYear() === yr) season[sp] = (season[sp] || 0) + 1;
  });
  return { rec, season, yr };
}

/* depth band filter: highlights water between two depths (fishing mode) */
let fishOn = false;
function updateFishZone() {
  if (!mapReady) return;
  KummelChart.setFishBand(map, S.mode === "fiske" && fishOn ? S.fishDepth : null);
}
$("#b-depth").onclick = () => {
  fishOn = true; updateFishZone();
  const [a, b] = S.fishDepth;
  openSheet("Djupintervall", `
    <div class="muted">Markerar vatten mellan två djup på sjökortet, t.ex. där abborre eller gös brukar stå.</div>
    <div class="grid2">
      <label class="f">Från (m)<input id="fd-a" type="number" min="0" max="60" step="1" inputmode="numeric" value="${a}"></label>
      <label class="f">Till (m)<input id="fd-b" type="number" min="1" max="80" step="1" inputmode="numeric" value="${b}"></label>
    </div>
    <div class="row"><button class="btn" data-pr="2,6">Grunt 2–6</button><button class="btn" data-pr="4,12">Abborre 4–12</button><button class="btn" data-pr="8,20">Gös 8–20</button><button class="btn warn" id="fd-off">Stäng av</button></div>`, "depth");
  const upd = () => { S.fishDepth = [+$("#fd-a").value || 0, +$("#fd-b").value || 0]; save(); updateFishZone(); };
  $("#fd-a").oninput = upd; $("#fd-b").oninput = upd;
  document.querySelectorAll("[data-pr]").forEach(x => x.onclick = () => { const [p, q] = x.dataset.pr.split(","); $("#fd-a").value = p; $("#fd-b").value = q; upd(); });
  $("#fd-off").onclick = () => { fishOn = false; updateFishZone(); closeSheet(); };
};

/* ---------- route planning ---------- */
let planning = false, wps = [], wpMarkers = [], wpsOff = [], autoInfo = null, routeId = null, routeName = "";
function startPlanning(initial) {
  planning = true; wps = (initial || []).map(ll);
  document.body.classList.add("plan"); $("#b-route").setAttribute("aria-pressed", "true");
  renderRoute();
  if (!initial) toast("Tryck på kartan för att lägga till punkter", 2200);
}
function stopPlanning(keep) {
  closeWpMenu();
  planning = false; document.body.classList.remove("plan"); $("#b-route").setAttribute("aria-pressed", "false");
  if (!keep) { wps = []; wpsOff = []; autoInfo = null; routeId = null; routeName = ""; drawWps(); }
}
let depthPop = null;
map.on("click", e => {
  if (!planning && S.layers.base === "sat" && !e.defaultPrevented) {
    // ett tryck när rutan är öppen stänger den bara
    if (depthPop) { depthPop.remove(); depthPop = null; return; }
    const hits = map.queryRenderedFeatures(e.point, { layers: ["depare-sat"].filter(id => map.getLayer(id)) });
    if (hits.length) {
      const p = hits[0].properties, lo = p.d1 ?? 0, hi = p.d2;
      const txt = lo < 0 ? "Torrfallande" : hi != null ? `${String(lo).replace(".", ",")}–${String(hi).replace(".", ",")} m` : `över ${String(lo).replace(".", ",")} m`;
      const warn = lo < needDepth() ? `<div style="color:#d22b2b;font-weight:600">För grunt för ${esc(boat().name)}</div>` : "";
      const nowTxt = wlM() && Math.abs(wl.cm) >= 3 && lo >= 0 ? `<div style="font-size:12px;color:#14232e">Just nu ca ${String(Math.max(0, lo + wl.cm / 100).toFixed(1)).replace(".", ",")}${hi != null ? "–" + String((hi + wl.cm / 100).toFixed(1)).replace(".", ",") : ""} m (vattenstånd ${fmtCm(wl.cm)})</div>` : "";
      depthPop = new maplibregl.Popup({ closeButton: false, offset: 10, className: "wp-pop" }).setLngLat(e.lngLat).setHTML(`<div style="font:600 15px var(--f-ui);color:#14232e">Djup ${txt}</div>${nowTxt}${warn}<div style="font-size:11px;color:#5d6b73">Enligt sjökortet. Stenar kan finnas.</div>`).addTo(map);
      const pop = depthPop, el = pop.getElement();
      el.style.cursor = "pointer"; el.addEventListener("click", ev => { ev.stopPropagation(); pop.remove(); if (depthPop === pop) depthPop = null; });
      setTimeout(() => { pop.remove(); if (depthPop === pop) depthPop = null; }, 8000);
    }
  }
  if (!planning) return;
  if (e.defaultPrevented) return;
  closeWpMenu();
  // tryck på linjen: ny punkt mitt i sträckan, annars ny punkt sist
  const p = e.point, hit = mapReady && map.getLayer("route") && map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["route"] })[0];
  if (hit && hit.properties.i != null) {
    const i = +hit.properties.i;
    wps.splice(i + 1, 0, ll(e.lngLat)); wpsOff.splice(i + 1, 0, !!wpsOff[i]);
    autoInfo = autoInfo ? { ...autoInfo, edited: true } : null; renderRoute(); return;
  }
  wps.push(ll(e.lngLat)); wpsOff = wpsOff.slice(0, Math.max(0, wps.length - 2)); autoInfo = null; renderRoute();
});
let wpMenu = null;
function closeWpMenu() { if (wpMenu) { wpMenu.remove(); wpMenu = null; } }
function openWpMenu(i) {
  closeWpMenu();
  const box = document.createElement("div"); box.className = "wp-menu";
  box.innerHTML = `<b>Punkt ${i + 1}</b><button class="btn warn" data-a="del">Ta bort</button>${i > 0 && i < wps.length - 1 ? "" : ""}<button class="btn" data-a="close">Stäng</button>`;
  box.querySelector('[data-a="del"]').onclick = () => { wps.splice(i, 1); wpsOff.splice(Math.max(0, i - 1), 1); if (autoInfo) autoInfo = { ...autoInfo, edited: true }; closeWpMenu(); renderRoute(); };
  box.querySelector('[data-a="close"]').onclick = closeWpMenu;
  wpMenu = new maplibregl.Popup({ closeButton: false, offset: 18, className: "wp-pop" }).setLngLat(lnglat(wps[i])).setDOMContent(box).addTo(map);
}
function routeStats(points) {
  const b = boat(); let nm = 0; const legs = [];
  for (let i = 1; i < points.length; i++) { const d = distNm(points[i - 1], points[i]); nm += d; legs.push({ d, brg: bearing(points[i - 1], points[i]) }); }
  const h = b.speed > 0 ? nm / b.speed : 0;
  return { nm, legs, h, fuel: h * (b.fuel || 0) };
}
function drawWps() {
  wpMarkers.forEach(m => m.remove()); wpMarkers = [];
  const st = routeStats(wps);
  const many = wps.length > 12;
  setData("route", { type: "FeatureCollection", features: wps.slice(1).map((p, i) => ({ type: "Feature", properties: { i, off: wpsOff[i] ? 1 : 0, label: many ? "" : `${String(Math.round(st.legs[i].brg)).padStart(3, "0")}° ${st.legs[i].d.toFixed(1)} nm` }, geometry: { type: "LineString", coordinates: [lnglat(wps[i]), lnglat(p)] } })) });
  wps.forEach((p, i) => {
    const el = document.createElement("div"), end = i === 0 || i === wps.length - 1;
    if (many && !end) el.className = "wp-dot"; else { el.className = "wp-icon"; el.textContent = many ? (i === 0 ? "A" : "B") : i + 1; }
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lnglat(p)).addTo(map);
    let dragged = false;
    m.on("dragstart", () => { dragged = true; closeWpMenu(); });
    m.on("drag", () => { wps[i] = ll(m.getLngLat()); setData("route", { type: "FeatureCollection", features: wps.slice(1).map((q, k) => ({ type: "Feature", properties: { i: k, off: wpsOff[k] ? 1 : 0, label: "" }, geometry: { type: "LineString", coordinates: [lnglat(wps[k]), lnglat(q)] } })) }); });
    m.on("dragend", () => { if (autoInfo) autoInfo = { ...autoInfo, edited: true }; renderRoute(); setTimeout(() => dragged = false, 50); });
    el.addEventListener("click", e => { e.stopPropagation(); if (planning && !dragged) openWpMenu(i); });
    wpMarkers.push(m);
  });
}
function routeShallow() {
  if (!mapReady || wps.length < 2) return null;
  const ids = KummelChart.depthAreaIds().filter(id => map.getLayer(id)); if (!ids.length) return null;
  let worst = Infinity, at = null;
  for (let i = 1; i < wps.length; i++) {
    const d = distNm(wps[i - 1], wps[i]), n = Math.max(2, Math.ceil(d / 0.02)), brg = bearing(wps[i - 1], wps[i]);
    for (let k = 0; k <= n; k++) {
      const p = dest(wps[i - 1], brg, d * k / n), px = map.project(lnglat(p));
      const c = map.getCanvas(); if (px.x < 0 || px.y < 0 || px.x > c.clientWidth || px.y > c.clientHeight) continue;
      map.queryRenderedFeatures(px, { layers: ids }).forEach(f => { const v = KummelChart.minDepthOf(f); if (v != null && v < worst) { worst = v; at = p; } });
    }
  }
  return isFinite(worst) ? { depth: worst, at } : null;
}
function renderRoute() {
  drawWps();
  const st = routeStats(wps), b = boat();
  const eta = new Date(Date.now() + st.h * 3600000);
  const dark = sunInfo && st.h ? darkCheck(eta) : "";
  const sh = routeShallow();
  const shTxt = !sh ? "" : sh.depth < needDepth()
    ? `<div class="callout bad">Rutten passerar <b>${sh.depth} m</b> djup. ${esc(b.name)} behöver ${needDepth().toFixed(1)} m. <button class="btn" id="rt-show">Visa</button></div>`
    : `<div class="callout ok">Minsta djup längs synlig del av rutten: ${sh.depth} m.</div>`;
  openSheet(wps.length > 1 ? `Rutt ${st.nm.toFixed(1)} nm · ${fmtDur(st.h)}` : "Planera rutt", `
    <div class="row" style="justify-content:space-between">
      <div><div class="big">${st.nm.toFixed(1)} <small style="font-size:16px">nm</small></div><div class="muted">${wps.length} punkter · ${esc(b.name)} i ${b.speed} kn</div></div>
      <div style="text-align:right"><div class="big">${st.h ? fmtDur(st.h) : "–"}</div><div class="muted">${st.h ? "Framme ca " + hm(eta) : "Tryck på kartan"}</div></div>
    </div>
    ${st.fuel ? `<div class="muted">Beräknad bränsleåtgång: <b class="num">${st.fuel.toFixed(0)} l</b> (${b.fuel} l/h)</div>` : ""}
    ${wps.length >= 2 && !autoInfo ? `<button class="btn pri" id="rt-auto">Föreslå rutt längs farleder</button><div class="muted">Använder första och sista punkten som start och mål.</div>` : ""}
    ${wps.length >= 2 ? `<div class="muted">Dra i en punkt för att flytta den. Tryck på linjen för att lägga till en punkt där, eller på en punkt för att ta bort den.</div>` : ""}
    ${wps.length < 2 ? `<div class="muted">Tryck ut start och mål, och låt appen föreslå vägen längs farlederna. Eller tryck ut hela rutten själv.</div>` : ""}
    ${autoInfo ? `<div class="callout ${autoInfo.offNm > .3 ? "bad" : "ok"}">${autoInfo.edited ? "Justerat ruttförslag. Kontrollera dina ändringar mot sjökortet. " : ""}Ruttförslag längs farleder: <b>${autoInfo.onNm.toFixed(1)} nm i farled</b>${autoInfo.minDraft ? `, minsta farledsdjup ${autoInfo.minDraft.toFixed(1)} m` : ""}${autoInfo.unknownNm > .1 ? `, varav ${autoInfo.unknownNm.toFixed(1)} nm med okänt farledsdjup` : ""}.${autoInfo.offNm > .02 ? ` <b>${autoInfo.offNm.toFixed(2)} nm utanför farled</b> (orange)${autoInfo.unchecked ? ": appen hittade ingen väg i tillräckligt djupt vatten där, rita den själv" : autoInfo.shallow ? ": vägen dit passerar vatten som enligt sjökortet kan vara grundare än din båt behöver, kör försiktigt och kontrollera" : ": vägen går runt land och kända grund men stenar finns inte i datan, kontrollera mot sjökortet"}.` : ""}</div>` : ""}
    ${shTxt}${dark}${routeWindNote()}
    <div>${st.legs.map((l, i) => `<div class="leg"><span class="pill">${i + 1}→${i + 2}</span><span>${compass(l.brg)}</span><span class="num">${String(Math.round(l.brg)).padStart(3, "0")}°</span><span class="num">${l.d.toFixed(2)} nm</span></div>`).join("") || `<div class="muted">Tryck på kartan för att lägga till punkter.</div>`}</div>
    ${wps.length > 1 ? `<div class="card"><h3>Ankomsttid</h3>
      <label class="f">Vill vara framme kl<span class="row" style="flex-wrap:nowrap"><input type="time" id="rt-arr" value="${S.arrTime || ""}" style="flex:1"><button class="btn" id="rt-arr-clr" type="button">Ingen tid</button></span></label>
      <div id="rt-arrout" class="muted"></div>
      <button class="btn pri" id="rt-go">Starta navigering</button></div>` : ""}
    ${wps.length > 1 ? `<label class="f">Namn på rutten<input id="rt-name" value="${esc(routeName)}" placeholder="t.ex. Hem – Kökar"></label>` : ""}
    <div class="row"><button class="btn" id="rt-undo">Ångra</button><button class="btn" id="rt-rev">Vänd</button><button class="btn pri" id="rt-save">Spara rutt</button><button class="btn" id="rt-share">Dela</button><button class="btn warn" id="rt-clear">Rensa</button></div>
    <div class="muted">Kontrollera alltid djup och faror mot sjökortet längs hela rutten.</div>`, "route");
  const arr = $("#rt-arr");
  if (arr) {
    const upd = () => { S.arrTime = arr.value; save(); $("#rt-arrout").innerHTML = arrivalPlan(st.nm, st.h); };
    arr.onchange = upd; arr.oninput = upd; arr.onblur = upd; upd();
    $("#rt-arr-clr").onclick = e => { e.preventDefault(); arr.value = ""; upd(); };
    $("#rt-go").onclick = () => startNav(wps.map(ll));
  }
  $("#rt-undo").onclick = () => { wps.pop(); wpsOff = []; autoInfo = null; renderRoute(); };
  $("#rt-rev").onclick = () => { wps.reverse(); wpsOff.reverse(); renderRoute(); };
  $("#rt-clear").onclick = () => { wps = []; wpsOff = []; autoInfo = null; renderRoute(); };
  const au = $("#rt-auto"); if (au) au.onclick = () => autoRoute(wps[0], wps[wps.length - 1]);
  const show = $("#rt-show"); if (show) show.onclick = () => map.easeTo({ center: lnglat(sh.at), zoom: Math.max(map.getZoom(), 14) });
  const nm = $("#rt-name"); if (nm) nm.oninput = () => { routeName = nm.value; };
  $("#rt-save").textContent = routeId ? "Spara ändringar" : "Spara rutt";
  $("#rt-save").onclick = () => {
    if (wps.length < 2) { toast("Lägg till minst två punkter."); return; }
    track("route_saved", { points: wps.length, auto: autoInfo ? 1 : 0 });
    const name = (routeName || "").trim() || `Rutt ${new Date().getDate()}.${new Date().getMonth() + 1} (${st.nm.toFixed(1)} nm)`;
    const pts = wps.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]), old = routeId && S.routes.find(r => r.id === routeId);
    if (old) { old.name = name; old.pts = pts; old.updated = Date.now(); }
    else { routeId = uid(); S.routes.unshift({ id: routeId, name, pts, created: Date.now() }); }
    routeName = name; save(); toast(`Rutten "${name}" är sparad`); renderRoute();
  };
  $("#rt-share").onclick = () => {
    if (wps.length < 2) { toast("Lägg till minst två punkter."); return; }
    const pts = wps.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]);
    shareRoute({ id: routeId || uid(), name: (routeName || "").trim() || `Rutt (${st.nm.toFixed(1)} nm)`, pts });
  };
}
/* ---------- ruttförslag längs farleder ----------
   Farledsnätet (Väylävirasto) är ramat ner till farledens djup, så det är det enda vatten
   appen föreslår. Sträckan till och från farleden ritas orange och är förarens ansvar. */
let FW = null;
async function loadFairways() {
  if (FW) return FW;
  const j = await (await fetch("data/fairways.json")).json();
  const N = j.nodes.length, adj = Array.from({ length: N }, () => []);
  const pt = n => ({ lat: j.nodes[n][1], lng: j.nodes[n][0] });
  for (const [x, y, d] of j.edges) { const w = distNm(pt(x), pt(y)); adj[x].push(y, w, d); adj[y].push(x, w, d); }
  FW = { nodes: j.nodes, adj, pt };
  return FW;
}
function fwSearch(G, from, to, ok) {
  const N = G.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap = [[0, from]]; dist[from] = 0;
  const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [dd, u] = pop(); if (dd > dist[u]) continue; if (u === to) break;
    const A = G.adj[u];
    for (let k = 0; k < A.length; k += 3) {
      const v = A[k], d = A[k + 2]; if (!ok(d)) continue;
      const nd = dd + A[k + 1] * (d === 0 ? 1.25 : 1);   // okänt djup undviks om det finns alternativ
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const path = []; for (let u = to; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}
function nearestFw(G, p, ok) {
  let best = -1, bd = Infinity;
  for (let n = 0; n < G.nodes.length; n++) {
    const A = G.adj[n]; let usable = false;
    for (let k = 2; k < A.length; k += 3) if (ok(A[k])) { usable = true; break; }
    if (!usable) continue;
    const dy = G.nodes[n][1] - p.lat, dx = (G.nodes[n][0] - p.lng) * Math.cos(rad(p.lat)), d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function simplify(pts, tolM) {   // Ramer–Douglas–Peucker i lokala meter
  if (pts.length < 3) return pts;
  const k = Math.cos(rad(pts[0].lat)), xy = p => [p.lng * 111320 * k, p.lat * 111320];
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(), [ax, ay] = xy(pts[a]), [bx, by] = xy(pts[b]); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy(pts[i]), L = Math.hypot(bx - ax, by - ay) || 1, d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tolM) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/* ---------- vatten ur kartfilen: djupområden avkodade direkt ur vektortiles ----------
   Används för att hitta väg runt öar och grund på sträckan mellan farled och brygga. */
const chartPM = new pmtiles.PMTiles(CHART_URL.replace("pmtiles://", ""));
const depCache = new Map(), depData = new Map(), DZ = 14;
function pbfReader(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let pos = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = u8[pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  return {
    get end() { return pos >= u8.length; }, varint,
    tag() { const t = varint(); return [t >> 3, t & 7]; },
    bytes() { const n = varint(), s = u8.subarray(pos, pos + n); pos += n; return s; },
    str() { return new TextDecoder().decode(this.bytes()); },
    f32() { const v = dv.getFloat32(pos, true); pos += 4; return v; },
    f64() { const v = dv.getFloat64(pos, true); pos += 8; return v; },
    packed() { const end = varint() + pos, out = []; while (pos < end) out.push(varint()); return out; },
    skip(w) { if (w === 0) varint(); else if (w === 1) pos += 8; else if (w === 2) pos += varint(); else if (w === 5) pos += 4; }
  };
}
function decodeDepare(buf, z, x, y) {
  const T = pbfReader(buf), polys = [];
  while (!T.end) {
    const [f, w] = T.tag(); if (f !== 3) { T.skip(w); continue; }
    const L = pbfReader(T.bytes()); let name = "", extent = 4096; const keys = [], vals = [], feats = [];
    while (!L.end) {
      const [lf, lw] = L.tag();
      if (lf === 1) name = L.str(); else if (lf === 2) feats.push(L.bytes()); else if (lf === 3) keys.push(L.str());
      else if (lf === 4) { const V = pbfReader(L.bytes()); let v = null; while (!V.end) { const [vf, vw] = V.tag(); if (vf === 1) v = V.str(); else if (vf === 2) v = V.f32(); else if (vf === 3) v = V.f64(); else if (vf === 4 || vf === 5) v = V.varint(); else if (vf === 6) { const n = V.varint(); v = (n % 2 ? -(n + 1) / 2 : n / 2); } else if (vf === 7) v = !!V.varint(); else V.skip(vw); } vals.push(v); }
      else if (lf === 5) extent = L.varint(); else L.skip(lw);
    }
    if (name !== "depare") continue;
    const n2 = 2 ** z, toLL = (px, py) => { const X = (x + px / extent) / n2, Y = (y + py / extent) / n2; return [X * 360 - 180, deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))))]; };
    for (const fb of feats) {
      const F = pbfReader(fb); let tags = [], geom = [], type = 0;
      while (!F.end) { const [ff, fw] = F.tag(); if (ff === 2) tags = F.packed(); else if (ff === 3) type = F.varint(); else if (ff === 4) geom = F.packed(); else F.skip(fw); }
      if (type !== 3) continue;
      let d1 = null; for (let k = 0; k < tags.length; k += 2) if (keys[tags[k]] === "d1") d1 = vals[tags[k + 1]];
      const rings = []; let ring = null, cx = 0, cy = 0, minX = 999, minY = 999, maxX = -999, maxY = -999;
      for (let k = 0; k < geom.length;) {
        const c = geom[k++], id = c & 7, cnt = c >> 3;
        if (id === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let m = 0; m < cnt; m++) {
          const dx = geom[k++], dy = geom[k++]; cx += dx % 2 ? -(dx + 1) / 2 : dx / 2; cy += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          const p = toLL(cx, cy);
          if (id === 1) { if (ring) rings.push(ring); ring = [p]; } else ring.push(p);
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        }
      }
      if (ring) rings.push(ring);
      polys.push({ d1: d1 ?? 0, rings, bb: [minX, minY, maxX, maxY] });
    }
  }
  return polys;
}
const tileOf = (p, z) => { const n = 2 ** z; return [Math.floor((p.lng + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(rad(p.lat)) + 1 / Math.cos(rad(p.lat))) / Math.PI) / 2 * n)]; };
function depTile(x, y) {
  const k = x + "/" + y;
  if (!depCache.has(k)) depCache.set(k, chartPM.getZxy(DZ, x, y).then(t => ({ polys: t ? decodeDepare(t.data, DZ, x, y) : [] })).catch(() => ({ polys: [] })));
  return depCache.get(k);
}
async function loadDepth(bb) {
  const [x0, y1] = tileOf({ lat: bb[1], lng: bb[0] }, DZ), [x1, y0] = tileOf({ lat: bb[3], lng: bb[2] }, DZ);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return false;
  const jobs = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(depTile(x, y).then(r => depData.set(x + "/" + y, r)));
  await Promise.all(jobs); return true;
}
function waterDepth(p) {   // grundaste djup för punkten enligt djupområdena, null = land/okänt
  const [x, y] = tileOf(p, DZ), t = depData.get(x + "/" + y); if (!t || !t.polys) return null;
  for (const P of t.polys) {
    if (p.lng < P.bb[0] || p.lng > P.bb[2] || p.lat < P.bb[1] || p.lat > P.bb[3]) continue;
    let inside = false;
    for (const r of P.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > p.lat) !== (yj > p.lat) && p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return P.d1;
  }
  return null;
}
async function waterPath(a, b, need, free) {
  const lerp = (p, q, t) => ({ lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t });
  const isFree = p => free.some(f => distNm(f, p) * NM < 120);   // bryggor och hamnar: närmaste biten räknas fri
  // 1 = djupt nog, 2 = vatten men grundare än båten behöver (dyrt, undviks), 0 = land
  const cls = p => { if (isFree(p)) return 1; const d = waterDepth(p); return d == null ? 0 : d >= need ? 1 : 2; };
  const los = (p, q) => { const n = Math.max(2, Math.ceil(distNm(p, q) * NM / 10)); for (let i = 1; i < n; i++) if (cls(lerp(p, q, i / n)) !== 1) return false; return true; };
  const padLat = .006, padLng = .012;
  const bb = [Math.min(a.lng, b.lng) - padLng, Math.min(a.lat, b.lat) - padLat, Math.max(a.lng, b.lng) + padLng, Math.max(a.lat, b.lat) + padLat];
  if (!(await loadDepth(bb))) return { pts: [a, b], ok: false };
  if (los(a, b)) return { pts: [a, b], ok: true, nm: distNm(a, b) };
  const k = Math.cos(rad((a.lat + b.lat) / 2)) * 111320, Wm = (bb[2] - bb[0]) * k, Hm = (bb[3] - bb[1]) * 111320;
  const cell = Math.max(12, Math.hypot(Wm, Hm) / 170), nx = Math.ceil(Wm / cell), ny = Math.ceil(Hm / cell);
  const at = (i, j) => ({ lng: bb[0] + (i + .5) * cell / k, lat: bb[1] + (j + .5) * cell / 111320 });
  const ok = depthGrid([bb[0], bb[1], bb[0] + nx * cell / k, bb[1] + ny * cell / 111320], nx, ny, need);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (isFree(at(i, j))) ok[j * nx + i] = 1;
  const idx = p => [Math.min(nx - 1, Math.max(0, Math.floor((p.lng - bb[0]) * k / cell))), Math.min(ny - 1, Math.max(0, Math.floor((p.lat - bb[1]) * 111320 / cell)))];
  const [si, sj] = idx(a), [ti, tj] = idx(b), S0 = sj * nx + si, T0 = tj * nx + ti; ok[S0] = ok[T0] = 1;
  const g = new Float64Array(nx * ny).fill(Infinity), prev = new Int32Array(nx * ny).fill(-1), open = [[0, S0]]; g[S0] = 0;
  const push = it => { open.push(it); let i = open.length - 1; while (i) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  const closed = new Uint8Array(nx * ny);
  const h = c => { const dx = Math.abs(c % nx - ti), dy = Math.abs(Math.floor(c / nx) - tj); return Math.max(dx, dy) + .414 * Math.min(dx, dy); };
  let found = false, guard = 0;
  while (open.length && guard++ < 200000) {
    const [, c] = pop(); if (closed[c]) continue; closed[c] = 1;
    if (c === T0) { found = true; break; }
    const ci = c % nx, cj = Math.floor(c / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const i2 = ci + di, j2 = cj + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const n = j2 * nx + i2; if (!ok[n]) continue; if (di && dj && (!ok[cj * nx + i2] || !ok[j2 * nx + ci])) continue;
      const ng = g[c] + (di && dj ? 1.414 : 1) * (ok[n] === 2 ? 8 : 1);
      if (ng < g[n]) { g[n] = ng; prev[n] = c; push([ng + h(n), n]); }
    }
  }
  if (!found) return { pts: [a, b], ok: false };
  const cells = []; let shallow = false; for (let c = T0; c !== -1; c = prev[c]) { cells.push(at(c % nx, Math.floor(c / nx))); if (ok[c] === 2) shallow = true; }
  const raw = [a, ...cells.reverse().slice(1, -1), b], out = [a];
  for (let i = 0; i < raw.length - 1;) { let j = raw.length - 1; while (j > i + 1 && !los(raw[i], raw[j])) j--; out.push(raw[j]); i = j; }
  let nm = 0; for (let i = 1; i < out.length; i++) nm += distNm(out[i - 1], out[i]);
  return { pts: out, ok: true, nm, shallow };
}
/* avståndsfält i vatten från en punkt: kortaste väg från varje rutnätscell till punkten */
/* djupområden ritade på ett rutnät (snabbt: canvas) -> 1 djupt nog, 2 grunt, 0 land/okänt */
function depthGrid(bb, nx, ny, need) {
  const cv = document.createElement("canvas"); cv.width = nx; cv.height = ny;
  const g = cv.getContext("2d", { willReadFrequently: true }); g.imageSmoothingEnabled = false;
  const X = lng => (lng - bb[0]) / (bb[2] - bb[0]) * nx, Y = lat => (bb[3] - lat) / (bb[3] - bb[1]) * ny;
  const [x0, y1] = tileOf({ lat: bb[1], lng: bb[0] }, DZ), [x1, y0] = tileOf({ lat: bb[3], lng: bb[2] }, DZ);
  for (const pass of [0, 1]) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const t = depData.get(x + "/" + y); if (!t) continue;
    for (const P of t.polys) {
      if (P.bb[2] < bb[0] || P.bb[0] > bb[2] || P.bb[3] < bb[1] || P.bb[1] > bb[3]) continue;
      const deep = P.d1 >= need; if ((pass === 0) !== deep) continue;   // grunt ritas sist och vinner
      g.fillStyle = deep ? "rgb(255,0,0)" : "rgb(128,0,0)";
      g.beginPath();
      for (const r of P.rings) { r.forEach(([lng, lat], i) => i ? g.lineTo(X(lng), Y(lat)) : g.moveTo(X(lng), Y(lat))); g.closePath(); }
      g.fill("evenodd");
    }
  }
  const px = g.getImageData(0, 0, nx, ny).data, out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const r = px[((ny - 1 - j) * nx + i) * 4]; out[j * nx + i] = r > 200 ? 1 : r > 60 ? 2 : 0; }
  return out;   // rad j = 0 är södra kanten
}
async function waterField(target, radiusM, need) {
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos(rad(target.lat)));
  const bb = [target.lng - dLng, target.lat - dLat, target.lng + dLng, target.lat + dLat];
  if (!(await loadDepth(bb))) return null;
  const k = Math.cos(rad(target.lat)) * 111320, cell = Math.max(15, radiusM / 90);
  const nx = Math.ceil((bb[2] - bb[0]) * k / cell), ny = Math.ceil((bb[3] - bb[1]) * 111320 / cell);
  const at = (i, j) => ({ lng: bb[0] + (i + .5) * cell / k, lat: bb[1] + (j + .5) * cell / 111320 });
  const idx = p => { const i = Math.floor((p.lng - bb[0]) * k / cell), j = Math.floor((p.lat - bb[1]) * 111320 / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const bbg = [bb[0], bb[1], bb[0] + nx * cell / k, bb[1] + ny * cell / 111320];
  const cls = depthGrid(bbg, nx, ny, need);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (distNm(at(i, j), target) * NM < 90) cls[j * nx + i] = 1;
  const T = idx(target); if (T < 0) return null; cls[T] = 1;
  const dist = new Float64Array(nx * ny).fill(Infinity), prev = new Int32Array(nx * ny).fill(-1), heap = [[0, T]]; dist[T] = 0;
  const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d0, c] = pop(); if (d0 > dist[c]) continue;
    const ci = c % nx, cj = (c / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const i2 = ci + di, j2 = cj + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const n = j2 * nx + i2; if (!cls[n]) continue; if (di && dj && (!cls[cj * nx + i2] || !cls[j2 * nx + ci])) continue;
      const nd = d0 + cell * (di && dj ? 1.414 : 1) * (cls[n] === 2 ? 8 : 1);
      if (nd < dist[n]) { dist[n] = nd; prev[n] = c; push([nd, n]); }
    }
  }
  const lerp = (p, q, t) => ({ lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t });
  const free = p => { const c = idx(p); return c >= 0 && cls[c] === 1; };
  const los = (p, q) => { const n = Math.max(2, Math.ceil(distNm(p, q) * NM / 10)); for (let i = 1; i < n; i++) if (!free(lerp(p, q, i / n))) return false; return true; };
  return {
    cost: p => { const c = idx(p); return c < 0 ? Infinity : dist[c]; },
    path: p => {   // från p till målet, förenklad med fri sikt
      let c = idx(p); if (c < 0 || !isFinite(dist[c])) return null;
      const raw = [p]; let shallow = false, guard = 0; while (c !== -1 && c !== T && guard++ < nx * ny) { c = prev[c]; if (c >= 0) { raw.push(at(c % nx, (c / nx) | 0)); if (cls[c] === 2) shallow = true; } }
      raw.push(target);
      const out = [raw[0]]; for (let i = 0; i < raw.length - 1;) { let j = raw.length - 1; while (j > i + 1 && !los(raw[i], raw[j])) j--; out.push(raw[j]); i = j; }
      let nm = 0; for (let i = 1; i < out.length; i++) nm += distNm(out[i - 1], out[i]);
      return { pts: out, nm, shallow };
    }
  };
}
/* bästa avfart: punkten längs farleden som ger kortast total väg (farled + vatten) till målet */
async function bestExit(line, target, need, fromEnd) {
  const Lm = Math.min(5000, Math.max(1200, distNm(target, fromEnd ? line[line.length - 1] : line[0]) * NM * 3));
  const F = await waterField(target, Lm, need); if (!F) return null;
  const P = fromEnd ? line : line.slice().reverse();
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + distNm(P[i - 1], P[i]) * NM);
  let best = null;
  for (let i = 0; i < P.length - 1; i++) {
    const segM = cum[i + 1] - cum[i], n = Math.max(1, Math.ceil(segM / 40));
    for (let s = 0; s <= n; s++) {
      const t = s / n, q = { lat: P[i].lat + (P[i + 1].lat - P[i].lat) * t, lng: P[i].lng + (P[i + 1].lng - P[i].lng) * t };
      const w = F.cost(q); if (!isFinite(w)) continue;
      const total = cum[i] + segM * t + w * 1.25;
      if (!best || total < best.total) best = { total, i, q };
    }
  }
  if (!best) return null;
  const wp = F.path(best.q); if (!wp) return null;
  const kept = [...P.slice(0, best.i + 1), best.q];
  return { line: fromEnd ? kept : kept.reverse(), water: fromEnd ? wp.pts : wp.pts.slice().reverse(), nm: wp.nm, shallow: wp.shallow };
}
function nearestFwList(G, p, ok, n) {
  const list = [];
  for (let m = 0; m < G.nodes.length; m++) {
    const A = G.adj[m]; let usable = false; for (let k = 2; k < A.length; k += 3) if (ok(A[k])) { usable = true; break; } if (!usable) continue;
    const dy = G.nodes[m][1] - p.lat, dx = (G.nodes[m][0] - p.lng) * Math.cos(rad(p.lat)), d = dx * dx + dy * dy;
    if (list.length < n || d < list[list.length - 1][0]) { list.push([d, m]); list.sort((x, y) => x[0] - y[0]); if (list.length > n) list.pop(); }
  }
  return list.map(x => x[1]);
}
/* kandidater för anslutning mellan en punkt och farledsnätet, via vatten som är djupt nog */
async function connectCands(G, p, ok, need) {
  const out = [];
  for (const m of nearestFwList(G, p, ok, 7)) {
    const q = G.pt(m);
    if (distNm(p, q) * NM < 25) { out.push({ node: m, pts: [p, q], ok: true, nm: 0, cost: 0, near: true }); continue; }
    const w = await waterPath(p, q, need, [p]);
    const nm = w.ok ? w.nm : distNm(p, q);
    out.push({ node: m, ...w, nm, cost: w.ok ? nm * (w.shallow ? 3 : 1.6) : nm * 3 + 5 });   // farled föredras framför okontrollerat vatten
  }
  return out;
}
function fwSearchMulti(G, sources, ok, targets) {
  const N = G.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = [];
  const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of sources) if (s.cost < dist[s.node]) { dist[s.node] = s.cost; push([s.cost, s.node]); }
  let left = new Set(targets);
  while (heap.length && left.size) {
    const [dd, u] = pop(); if (dd > dist[u]) continue; left.delete(u);
    const A = G.adj[u];
    for (let k = 0; k < A.length; k += 3) {
      const v = A[k], d = A[k + 2]; if (!ok(d)) continue;
      const nd = dd + A[k + 1] * (d === 0 ? 1.25 : 1);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); }
    }
  }
  return { dist, prev };
}
async function computeAutoRoute(from, to) {
  let G; try { G = await loadFairways(); } catch (e) { return { err: "Farledsnätet kunde inte laddas. Försök igen om en stund." }; }
  const b = boat(), ok = d => d === 0 || d / 10 >= (+b.draft || 0), need = needDepth();
  const S0 = await connectCands(G, from, ok, need), T0 = await connectCands(G, to, ok, need);
  if (!S0.length || !T0.length) return { err: "Hittade ingen farled i närheten." };
  // hela resan räknas: anslutning + farled + anslutning, så rutten inte går förbi målet och tillbaka
  const { dist, prev } = fwSearchMulti(G, S0, ok, T0.map(t => t.node));
  let best = null; for (const t of T0) { const c = dist[t.node] + t.cost; if (isFinite(c) && (!best || c < best.c)) best = { t, c }; }
  if (!best) return { err: `Ingen sammanhängande farled där djupet räcker för ${b.name} (${b.draft} m).` };
  const path = []; for (let u = best.t.node; u !== -1; u = prev[u]) path.push(u); path.reverse();
  let cs = S0.find(s => s.node === path[0]), ct = best.t;
  let mid = simplify(path.map(G.pt), 12);
  // välj var rutten lämnar farleden: punkten som ger kortast total väg i vatten som är djupt nog
  let exitS = null, exitT = null;
  if (mid.length > 1 && !ct.near) exitT = await bestExit(mid, to, need, true);
  if (exitT) { mid = exitT.line; ct = { ...ct, pts: exitT.water.slice().reverse(), nm: exitT.nm, ok: true, shallow: exitT.shallow }; }
  if (mid.length > 1 && !cs.near) exitS = await bestExit(mid, from, need, false);
  if (exitS) { mid = exitS.line; cs = { ...cs, pts: exitS.water, nm: exitS.nm, ok: true, shallow: exitS.shallow }; }
  const out = [ll(from)], off = [];
  if (!cs.near) for (const p of cs.pts.slice(1)) { out.push(ll(p)); off.push(true); }
  for (let i = cs.near ? 0 : 1; i < mid.length; i++) { out.push(mid[i]); off.push(false); }
  if (!ct.near) { for (const p of ct.pts.slice().reverse().slice(1)) { out.push(ll(p)); off.push(true); } }
  else out[out.length - 1] = ll(to);
  if (cs.near && out.length > 2 && distNm(out[0], out[1]) * NM < 1) { out.splice(1, 1); off.splice(0, 1); }
  let onNm = 0, unknownNm = 0, minDraft = Infinity;
  for (let i = 1; i < path.length; i++) {
    const A = G.adj[path[i - 1]]; let d = 0; for (let k = 0; k < A.length; k += 3) if (A[k] === path[i]) { d = A[k + 2]; break; }
    const w = distNm(G.pt(path[i - 1]), G.pt(path[i])); if (d === 0) unknownNm += w; else minDraft = Math.min(minDraft, d / 10);
  }
  for (let i = 1; i < mid.length; i++) onNm += distNm(mid[i - 1], mid[i]);
  const offNm = (cs.near ? 0 : cs.nm) + (ct.near ? 0 : ct.nm);
  return { pts: out, off: off.slice(0, out.length - 1), info: { onNm, offNm, unknownNm, minDraft: isFinite(minDraft) ? minDraft : null, unchecked: (!cs.near && !cs.ok) || (!ct.near && !ct.ok), shallow: !!(cs.shallow || ct.shallow) } };
}
async function autoRoute(from, to) {
  if (!S.autoAck) return autoDisclaimer(() => autoRoute(from, to));
  if (!from || !to) return;
  const r = await computeAutoRoute(from, to);
  if (r.err) { toast(r.err, 4500); return; }
  wps = r.pts; wpsOff = r.off; autoInfo = r.info;
  track("route_suggested", { nm: Math.round((r.info && r.info.nm) || 0) });
  if (!planning) startPlanning(wps); else renderRoute();
  if (r.info.offNm > 3) toast("Långt till närmaste farled. Rita den biten själv.", 4000);
}
function autoDisclaimer(next) {
  openSheet("Ruttförslag", `
    <div>Appen föreslår en väg längs <b>officiella farleder</b> där farledsdjupet räcker för din båt. Sträckan mellan din start eller ditt mål och närmaste farled ritas <b style="color:#e07b00">orange</b>: där finns ingen kontroll alls.</div>
    <div class="callout bad">Förslaget är ett hjälpmedel, inte en garanti. Kartdatan kan sakna stenar, grund, broar och kraftledningar, och farledernas djup kan ha ändrats. Du som förare ansvarar alltid för att kontrollera rutten mot officiella sjökort och för att navigera säkert.</div>
    <button class="btn pri" id="ad-ok">Jag förstår, visa förslaget</button>`, "disclaimer");
  $("#ad-ok").onclick = () => { S.autoAck = Date.now(); save(); next(); };
}

/* önskad ankomsttid: när måste man åka, eller vilken fart krävs */
function arrTarget() {
  if (!S.arrTime) return null;
  const [h, m] = S.arrTime.split(":").map(Number), t = new Date(); t.setHours(h, m, 0, 0);
  if (t < Date.now() - 5 * 60000) t.setDate(t.getDate() + 1);
  return t;
}
function arrivalPlan(nm, h) {
  const t = arrTarget(); if (!t || !nm) return "Ange en tid så räknar appen ut när du behöver åka.";
  const b = boat(), left = (t - Date.now()) / 3600000, need = nm / Math.max(left, .01);
  const dep = new Date(t - h * 3600000), dayTxt = t.toDateString() === new Date().toDateString() ? "" : "i morgon ";
  if (left <= 0) return `<span class="pill bad">Tiden har passerat</span>`;
  if (dep > Date.now()) return `I ${b.speed} kn: <b>åk senast ${dayTxt}${hm(dep)}</b> (om ${fmtDur((dep - Date.now()) / 3600000)}). ${need >= 1 ? `Åker du nu räcker ${need.toFixed(1)} kn.` : ""}`;
  return need > b.speed * 1.3 ? `<span class="pill bad">Hinns inte</span> Det kräver ${need.toFixed(1)} kn från nu, marschfarten är ${b.speed} kn.` : `Åk nu och håll <b>${need.toFixed(1)} kn</b> för att vara framme ${dayTxt}${hm(t)}.`;
}

/* ---------- aktiv navigering längs rutt ---------- */
let nav = null;
function startNav(pts) {
  track("navigation_start");
  if (pts.length < 2) return;
  nav = { pts, i: 1, sog: null, started: Date.now() };
  // börja vid närmaste punkt framför båten om man redan är ute
  if (gps) { let best = 1, bd = Infinity; pts.forEach((p, k) => { if (k) { const d = distNm(gps, p); if (d < bd) { bd = d; best = k; } } }); nav.i = best; }
  stopPlanning(true); closeSheet();
  startGps(); if (!follow) setFollow(true);
  $("#navbar").classList.remove("hidden");
  setData("route", { type: "FeatureCollection", features: pts.slice(1).map((p, k) => ({ type: "Feature", properties: { label: "" }, geometry: { type: "LineString", coordinates: [lnglat(pts[k]), lnglat(p)] } })) });
  updateNav(gps || ll(map.getCenter()));
  toast("Navigering startad", 1500);
}
function stopNav(msg) {
  nav = null; $("#navbar").classList.add("hidden"); setData("navto", EMPTY); setData("route", EMPTY);
  if (msg) toast(msg, 3000);
}
function updateNav(pos) {
  if (!nav) return;
  const P = nav.pts, b = boat();
  let next = P[nav.i], d = distNm(pos, next);
  // passerad punkt: nära, eller förbi den längs sträckan
  const prev = P[nav.i - 1], legBrg = bearing(prev, next), along = distNm(prev, pos) * Math.cos(rad(bearing(prev, pos) - legBrg));
  if (d < .035 || (along > distNm(prev, next) && nav.i < P.length - 1)) {
    if (nav.i === P.length - 1) { stopNav(`Framme! ${hm(new Date())}`); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} return; }
    nav.i++; next = P[nav.i]; d = distNm(pos, next);
    try { navigator.vibrate && navigator.vibrate(150); } catch (e) {}
  }
  let rest = d; for (let k = nav.i + 1; k < P.length; k++) rest += distNm(P[k - 1], P[k]);
  if (gps && gps.sog > 1) nav.sog = nav.sog == null ? gps.sog : nav.sog * .85 + gps.sog * .15;
  const spd = nav.sog && nav.sog > 1 ? nav.sog : b.speed, h = spd > 0 ? rest / spd : 0, eta = new Date(Date.now() + h * 3600000);
  const p0 = P[nav.i - 1], d13 = distNm(p0, pos) / R_NM, xte = Math.asin(Math.sin(d13) * Math.sin(rad(bearing(p0, pos) - bearing(p0, next)))) * R_NM * NM;
  const brg = bearing(pos, next), t = arrTarget();
  let late = "";
  if (t) { const diff = Math.round((eta - t) / 60000); late = Math.abs(diff) <= 2 ? `<span class="pill ok">I tid</span>` : diff > 0 ? `<span class="pill bad">${fmtDur(diff / 60)} sen</span>` : `<span class="pill ok">${fmtDur(-diff / 60)} före</span>`; }
  $("#nav-to").textContent = nav.i === P.length - 1 ? "Till målet" : `Till punkt ${nav.i + 1} av ${P.length}`;
  $("#nav-brg").textContent = String(Math.round(brg)).padStart(3, "0") + "°";
  $("#nav-dtw").textContent = d < .3 ? `${Math.round(d * NM)} m` : `${d.toFixed(2)} nm`;
  $("#nav-eta").textContent = hm(eta);
  $("#nav-rest").innerHTML = `${rest.toFixed(1)} nm kvar · ${fmtDur(h)} i ${spd.toFixed(1)} kn ${late}`;
  $("#nav-xte").textContent = Math.abs(xte) > 25 ? `Ur kurs ${Math.round(Math.abs(xte))} m åt ${xte > 0 ? "styrbord" : "babord"}` : "";
  setData("navto", lineFC([lnglat(pos), lnglat(next)]));
  // fartrådgivare: vilken fart ger ankomst exakt på önskad tid
  let adv = "";
  if (t) {
    const left = (t - Date.now()) / 3600000, need = rest / Math.max(left, .005);
    if (left <= 0) adv = "Önskad ankomsttid har passerat.";
    else if (need > b.speed * 1.3) adv = `Hinns inte: det kräver ${need.toFixed(1)} kn.`;
    else if (need < 2) adv = `Gott om tid: du är framme ${hm(t)} även i låg fart.`;
    else {
      const cur = nav.sog && nav.sog > 1 ? nav.sog : null, diff = cur != null ? need - cur : null;
      adv = `Håll <b>${need.toFixed(1)} kn</b> för att vara framme ${hm(t)}` + (diff == null ? "" : Math.abs(diff) < .5 ? " · du ligger rätt" : diff > 0 ? ` · öka ${diff.toFixed(1)} kn` : ` · du kan sänka ${(-diff).toFixed(1)} kn och spara bränsle`);
    }
  }
  $("#nav-adv").innerHTML = adv;
  // långt från rutten: erbjud omräkning längs farlederna
  let off = Infinity;
  for (let k = nav.i; k < P.length; k++) off = Math.min(off, segDistM(pos, P[k - 1], P[k]));
  if (off > 900 && gps) {
    nav.offSince = nav.offSince || Date.now();
    if (Date.now() - nav.offSince > 30000 && Date.now() > (nav.snooze || 0)) {
      $("#nav-reroute-txt").textContent = `Du är ${(off / NM).toFixed(1)} nm från rutten.`;
      $("#nav-reroute").classList.remove("hidden");
    }
  } else { nav.offSince = null; $("#nav-reroute").classList.add("hidden"); }
}
function segDistM(p, a, b) {   // avstånd i meter från punkt till sträcka
  const k = Math.cos(rad(p.lat)) * 111320, X = q => [(q.lng - p.lng) * k, (q.lat - p.lat) * 111320];
  const [ax, ay] = X(a), [bx, by] = X(b), dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}
async function reroute() {
  if (!nav || !gps) return;
  $("#nav-reroute").classList.add("hidden");
  const r = await computeAutoRoute(ll(gps), nav.pts[nav.pts.length - 1]);
  if (r.err) { toast(r.err, 4000); nav.snooze = Date.now() + 5 * 60000; return; }
  startNav(r.pts); toast("Rutten är omräknad", 1800);
}
function setArrivalSheet() {
  openSheet("Ankomsttid", `
    <label class="f">Vill vara framme kl<input type="time" id="na-t" value="${S.arrTime || ""}"></label>
    <div class="muted">Navigeringsraden visar då vilken fart som ger ankomst på minuten, och om du kan sänka farten för att spara bränsle.</div>
    <div class="row"><button class="btn pri" id="na-ok">Klar</button><button class="btn" id="na-clr">Ingen önskad tid</button></div>`, "arrival");
  $("#na-ok").onclick = () => { S.arrTime = $("#na-t").value; save(); closeSheet(); if (nav) updateNav(gps || ll(map.getCenter())); };
  $("#na-clr").onclick = () => { S.arrTime = ""; save(); closeSheet(); if (nav) updateNav(gps || ll(map.getCenter())); };
}

function routeWindNote() {
  if (!wx || wps.length < 2) return "";
  const st = routeStats(wps); if (!st.h) return "";
  const i0 = hourIndex(wx), i1 = Math.min(wx.hourly.time.length - 1, i0 + Math.ceil(st.h));
  let maxG = 0; for (let i = i0; i <= i1; i++) maxG = Math.max(maxG, wx.hourly.wind_gusts_10m[i]);
  const lim = boat().maxWind || 10;
  return maxG > lim ? `<div class="callout bad">Byvind upp till <b>${maxG.toFixed(0)} m/s</b> under turen, över din gräns på ${lim} m/s.</div>` : `<div class="callout ok">Byvind högst ${maxG.toFixed(0)} m/s under turen.</div>`;
}
function darkCheck(eta) {
  const ss = sunInfo.sunset.find(s => s.toDateString() === eta.toDateString());
  return ss && eta > ss ? `<div class="callout bad">Du är framme ${fmtDur((eta - ss) / 3600000)} efter solnedgången (${hm(ss)}).</div>` : "";
}
$("#b-route").onclick = () => {
  if (planning) { stopPlanning(false); closeWpMenu(); if (sheetView === "route" || sheetView === "disclaimer") closeSheet(); }
  else startPlanning();
};

/* ---------- weather ---------- */
let wx = null, sunInfo = null, wxT = null, wxKey = "";
async function fetchWx(lat, lng) {
  const q = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&timezone=auto&forecast_days=3`;
  const [f, m] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&wind_speed_unit=ms&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,weather_code&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,pressure_msl&daily=sunrise,sunset`).then(r => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&past_days=1&current=wave_height,sea_surface_temperature&hourly=wave_height,sea_surface_temperature`).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  if (f.error) throw new Error(f.reason);
  f.marine = m; f.at = Date.now(); f.lat = lat; f.lng = lng;
  return f;
}
const hourIndex = w => { const now = Date.now(); const i = w.hourly.time.findIndex(t => new Date(t).getTime() > now); return Math.max(0, i - 1); };
function scheduleWx() { clearTimeout(wxT); wxT = setTimeout(loadWx, 700); }
/* var vädret gäller: "me" = där jag är (GPS, annars kartans mitt), "map" = vid korset mitt på kartan */
const wxAtMap = () => S.wxSrc === "map" || !gps;
function wxPos() { const c = wxAtMap() ? ll(map.getCenter()) : gps; return { c, key: S.wxSrc === "map" ? `${c.lat.toFixed(2)},${c.lng.toFixed(2)}` : `${c.lat.toFixed(1)},${c.lng.toFixed(1)}` }; }
async function loadWx(force) {
  const { c, key } = wxPos();
  if (!force && key === wxKey && wx && Date.now() - wx.at < 15 * 60000) return;
  try {
    wx = await fetchWx(c.lat, c.lng); wxKey = key;
    sunInfo = { sunrise: wx.daily.sunrise.map(s => new Date(s)), sunset: wx.daily.sunset.map(s => new Date(s)) };
    renderChip(); idxBadge();
    if (sheetView === "wx") openWx();
    if (sheetView === "fishidx") openFishIndex();
    loadWaterNear(c);
  } catch (e) { $("#wxtxt").textContent = "–"; $("#wxsub").textContent = "inget väder"; }
}
function renderChip() {
  const c = wx.current;
  $("#wxtxt").textContent = `${c.wind_speed_10m.toFixed(0)} (${c.wind_gusts_10m.toFixed(0)}) m/s`;
  const s = sstInfo();
  $("#wxsub").textContent = (S.wxSrc === "map" ? "vid korset · " : "") + (S.mode === "fiske" && s ? `${compass(c.wind_direction_10m)} · vatten ${s.v.toFixed(1)}°` : `${compass(c.wind_direction_10m)} · ${c.temperature_2m.toFixed(0)}°`);
  $("#wxchip .arrow").style.transform = `rotate(${(c.wind_direction_10m + 180) % 360}deg)`;
  $("#wxchip").style.color = c.wind_gusts_10m > (boat().maxWind || 10) ? "var(--port)" : "";
}
/* vattentemperatur: uppmätt vid närmaste station om den finns inom ca 25 km, annars modell */
let waterNear = null;
function sstInfo() {
  if (waterNear && Date.now() - waterNear.at < 3 * 3600000) return { v: waterNear.v, d: modelTrend(), src: `uppmätt vid station ${waterNear.km.toFixed(0)} km bort` };
  const mh = wx?.marine?.hourly; if (!mh?.sea_surface_temperature) { const c = wx?.marine?.current?.sea_surface_temperature; return c != null ? { v: c, d: null, src: "modell" } : null; }
  const i = Math.max(0, mh.time.findIndex(t => new Date(t).getTime() > Date.now()) - 1), v = mh.sea_surface_temperature[i];
  return v == null ? null : { v, d: modelTrend(), src: "modell" };
}
function modelTrend() {
  const mh = wx?.marine?.hourly; if (!mh?.sea_surface_temperature) return null;
  const i = Math.max(0, mh.time.findIndex(t => new Date(t).getTime() > Date.now()) - 1);
  const a = mh.sea_surface_temperature[i], b = i >= 24 ? mh.sea_surface_temperature[i - 24] : null;
  return a != null && b != null ? a - b : null;
}
const trendTxt = d => d == null ? "" : Math.abs(d) < .3 ? "stabilt senaste dygnet" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}° senaste dygnet`;
/* öppen data från Meteorologiska institutet, "simple"-formatet: senaste värdet per station och parameter */
async function fmiSimple(query, params, box, minutes) {
  const start = new Date(Date.now() - minutes * 60000).toISOString().slice(0, 16) + ":00Z";
  const url = `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=${query}&bbox=${box.map(v => v.toFixed(2)).join(",")}&parameters=${params}&starttime=${start}`;
  const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/xml"), st = {};
  for (const el of xml.getElementsByTagNameNS("*", "BsWfsElement")) {
    const pos = el.getElementsByTagNameNS("*", "pos")[0]?.textContent.trim(); if (!pos) continue;
    const name = el.getElementsByTagNameNS("*", "ParameterName")[0]?.textContent, val = parseFloat(el.getElementsByTagNameNS("*", "ParameterValue")[0]?.textContent);
    const t = el.getElementsByTagNameNS("*", "Time")[0]?.textContent;
    if (isNaN(val)) continue;
    const o = st[pos] || (st[pos] = {});
    if (!o[name + "_t"] || t > o[name + "_t"]) { o[name] = val; o[name + "_t"] = t; }
  }
  return Object.entries(st).map(([pos, o]) => { const [lat, lng] = pos.split(/\s+/).map(Number); return { lat, lng, ...o }; });
}
async function waterObs(box) {
  const r = await Promise.all([
    fmiSimple("fmi::observations::mareograph::simple", "TW_PT1H_AVG", box, 180).catch(() => []),
    fmiSimple("fmi::observations::wave::simple", "TWATER", box, 180).catch(() => [])
  ]);
  return r.flat().map(o => ({ lat: o.lat, lng: o.lng, v: o.TW_PT1H_AVG ?? o.TWATER })).filter(o => o.v != null && o.v > -3 && o.v < 35);
}
async function loadWaterNear(c) {
  try {
    const obs = await waterObs([c.lng - .6, c.lat - .3, c.lng + .6, c.lat + .3]);
    const best = obs.map(o => ({ ...o, km: distNm(c, o) * 1.852 })).sort((x, y) => x.km - y.km)[0];
    waterNear = best && best.km < 25 ? { ...best, at: Date.now() } : null;
    if (wx) renderChip();
    if (sheetView === "wx") openWx();
  } catch (e) {}
}
function weatherWindow() {
  const lim = boat().maxWind || 10, h = wx.hourly, i0 = hourIndex(wx);
  const ok = i => h.wind_gusts_10m[i] <= lim, end = Math.min(h.time.length, i0 + 48);
  const fmt = i => { const d = new Date(h.time[i]); return (d.toDateString() === new Date().toDateString() ? "" : DAYS[d.getDay()] + " ") + pad(d.getHours()) + ":00"; };
  if (ok(i0)) {
    let j = i0; while (j < end && ok(j)) j++;
    if (j >= end) return { cls: "ok", txt: `Byvinden håller sig under ${lim} m/s de närmaste två dygnen.` };
    let mx = 0; for (let k = j; k < Math.min(end, j + 6); k++) mx = Math.max(mx, h.wind_gusts_10m[k]);
    return { cls: "ok", txt: `Lugnt nu, till ca <b>${fmt(j)}</b>. Därefter byvind upp mot ${mx.toFixed(0)} m/s.` };
  }
  let j = i0; while (j < end && !ok(j)) j++;
  if (j >= end) return { cls: "bad", txt: `Byvind över ${lim} m/s hela den kommande perioden. Inget bra väderfönster i sikte.` };
  let k = j; while (k < end && ok(k)) k++;
  return { cls: "bad", txt: `Blåsigt nu. Nästa lugna fönster: <b>${fmt(j)}–${k >= end ? "framåt" : fmt(k)}</b> (byar under ${lim} m/s).` };
}
function windChart() {
  const h = wx.hourly, i0 = hourIndex(wx), n = 48, lim = boat().maxWind || 10;
  const W = 720, H = 170, padL = 26, padB = 30, bw = (W - padL) / n;
  let max = lim + 2; for (let i = i0; i < i0 + n && i < h.time.length; i++) max = Math.max(max, h.wind_gusts_10m[i]);
  max = Math.ceil(max / 5) * 5;
  const y = v => (H - padB) - (v / max) * (H - padB - 10);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Vind kommande 48 timmar" style="font:11px var(--f-ui)">`;
  for (let v = 0; v <= max; v += 5) s += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${padL - 4}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)">${v}</text>`;
  s += `<line x1="${padL}" x2="${W}" y1="${y(lim)}" y2="${y(lim)}" stroke="var(--port)" stroke-dasharray="4 4"/>`;
  for (let k = 0; k < n; k++) {
    const i = i0 + k; if (i >= h.time.length) break;
    const x = padL + k * bw, ws = h.wind_speed_10m[i], g = h.wind_gusts_10m[i], d = new Date(h.time[i]);
    const col = g > lim ? "var(--port)" : g > lim * .75 ? "var(--signal)" : "var(--stbd)";
    s += `<rect x="${x + 1}" y="${y(ws)}" width="${bw - 2}" height="${y(0) - y(ws)}" fill="${col}" opacity=".85" rx="2"/>`;
    s += `<line x1="${x + 1}" x2="${x + bw - 1}" y1="${y(g)}" y2="${y(g)}" stroke="var(--fg)" stroke-width="2"/>`;
    if (k % 3 === 0) s += `<g transform="translate(${x + bw / 2},${H - 22}) rotate(${(h.wind_direction_10m[i] + 180) % 360})"><path d="M0 -6 4 5 0 2 -4 5Z" fill="var(--muted)"/></g>`;
    if (d.getHours() % 6 === 0) s += `<text x="${x}" y="${H - 4}" fill="var(--muted)">${d.getHours() === 0 ? DAYS[d.getDay()] : pad(d.getHours())}</text>`;
  }
  return s + `</svg>`;
}
function openWx() {
  if (!wx) { openSheet("Väder", `<div class="muted">Hämtar väder …</div>`, "wx"); loadWx(true); return; }
  const c = wx.current, m = wx.marine?.current, b = boat(), win = weatherWindow();
  const today = new Date().toDateString();
  const sr = sunInfo.sunrise.find(d => d.toDateString() === today), ss = sunInfo.sunset.find(d => d.toDateString() === today);
  const i0 = hourIndex(wx), pTrend = i0 >= 3 ? wx.hourly.pressure_msl[i0] - wx.hourly.pressure_msl[i0 - 3] : 0;
  const moon = moonPhase(new Date()), age = Math.round((Date.now() - wx.at) / 60000), sst = sstInfo();
  const where = S.wxSrc === "map" ? "map" : "me";
  openSheet("Väder", `
    <div class="wxb-modes wx-where" role="group" aria-label="Var vädret gäller"><button data-wsrc="me" aria-pressed="${where === "me"}">Där jag är</button><button data-wsrc="map" aria-pressed="${where === "map"}">Vid korset på kartan</button></div>
    ${where === "map" ? `<div class="muted">Flytta kartan så att korset står där du vill se vädret. Vindrutan uppe till höger visar samma plats.</div>` : !gps ? `<div class="muted">Din position är inte känd än, så vädret gäller kartans mitt tills GPS:en hittar dig.</div>` : ""}
    <div class="wx-now">
      <svg viewBox="0 0 24 24" width="56" height="56" style="transform:rotate(${(c.wind_direction_10m + 180) % 360}deg)"><path d="M12 2 19 21 12 16.5 5 21Z" fill="var(--accent)"/></svg>
      <div><div class="big">${c.wind_speed_10m.toFixed(1)} <small style="font-size:16px">m/s</small></div>
      <div>Byar ${c.wind_gusts_10m.toFixed(1)} m/s från ${compass(c.wind_direction_10m)} (${Math.round(c.wind_direction_10m)}°)</div></div>
    </div>
    <div class="callout ${win.cls}">${win.txt}<div class="muted">Gräns för ${esc(b.name)}: byar ${b.maxWind || 10} m/s</div></div>
    <div class="wx-stats">
      <div><b>${c.temperature_2m.toFixed(0)}°</b><span>Luft</span></div>
      <div><b>${sst ? sst.v.toFixed(1) + "°" : "–"}</b><span>Vatten ${sst?.d == null ? "" : sst.d > .3 ? "↑" : sst.d < -.3 ? "↓" : "→"}</span></div>
      <div><b>${m?.wave_height != null ? m.wave_height.toFixed(1) + " m" : "–"}</b><span>Våghöjd</span></div>
      <div><b>${Math.round(c.pressure_msl)}</b><span>hPa ${pTrend > .5 ? "↑" : pTrend < -.5 ? "↓" : "→"}</span></div>
      <div><b>${sr ? hm(sr) : "–"}</b><span>Sol upp</span></div>
      <div><b>${ss ? hm(ss) : "–"}</b><span>Sol ned</span></div>
    </div>
    <div><div class="muted" style="margin-bottom:4px">Vind kommande 48 h · stapel = medelvind, streck = byar, röd linje = din gräns</div><div class="chart">${windChart()}</div></div>
    ${S.mode === "fiske" ? `<div class="card"><h3>Fiskeförhållanden</h3>${sst ? `<div><b>Vattnet ${sst.v.toFixed(1)}°</b>${sst.d != null ? `, ${trendTxt(sst.d)}` : ""} <span class="muted">(${sst.src})</span></div>` : ""}<div>${moon.icon} ${moon.name} · Tryck ${pTrend > .5 ? "stigande" : pTrend < -.5 ? "fallande" : "stabilt"} (${pTrend >= 0 ? "+" : ""}${pTrend.toFixed(1)} hPa/3 h)</div></div>` : ""}
    <div class="muted">Prognos för ${fmtPosTxt({ lat: wx.lat, lng: wx.lng })} · uppdaterad för ${age} min sedan. Källa: Open-Meteo.</div>
    <button class="btn" id="wx-ref">Uppdatera</button>`, "wx");
  $("#wx-ref").onclick = () => loadWx(true);
  document.querySelectorAll("[data-wsrc]").forEach(b => b.onclick = () => {
    if ((S.wxSrc === "map" ? "map" : "me") === b.dataset.wsrc) return;
    S.wxSrc = b.dataset.wsrc; save(); track("weather_where", { w: S.wxSrc });
    if (S.wxSrc === "map") setSheetState($("#sheet"), 1, true);
    loadWx(true).then(() => { if (sheetView === "wx") openWx(); });
    if (wx) renderChip();
  });
}
$("#wxchip").onclick = () => sheetView === "wx" ? closeSheet() : openWx();
scheduleWx();
setInterval(() => loadWx(true), 15 * 60000);

/* ---------- sjöväder på kartan ---------- */
let wxOn = false, wxGrid = null, wxObs = [], wxWater = [], wxStep = 0, wxGridT = null, wxGridKey = "", wxMode = ["wind", "flow", "water"].includes(S.wxMode) ? S.wxMode : "wind";
function wxPoints() {
  const b = map.getBounds(), c = map.getContainer();
  const cols = c.clientWidth > 700 ? 7 : 4, rows = Math.round(cols * c.clientHeight / c.clientWidth);
  const pts = [];
  const n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast();
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++)
    pts.push({ lat: +(s + (n - s) * (r + .5) / rows).toFixed(3), lng: +(w + (e - w) * (k + .5) / cols).toFixed(3) });
  return pts;
}
async function loadWxGrid() {
  if (!wxOn) return;
  const pts = wxPoints(), key = pts.map(p => p.lat.toFixed(2) + p.lng.toFixed(2)).join();
  if (key === wxGridKey && wxGrid && Date.now() - wxGrid.at < 20 * 60000) return renderWxLayer();
  const la = pts.map(p => p.lat).join(","), lo = pts.map(p => p.lng).join(",");
  try {
    const [f, m] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&forecast_days=3&timezone=auto`).then(r => r.json()),
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&hourly=wave_height,sea_surface_temperature&forecast_days=3&timezone=auto`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    const F = Array.isArray(f) ? f : [f], M = m ? (Array.isArray(m) ? m : [m]) : [];
    if (!F[0] || !F[0].hourly) throw new Error("ingen prognos");
    wxGrid = { at: Date.now(), pts, F, M, t0: hourIndex(F[0]) };
    wxGridKey = key;
    renderWxLayer();
  } catch (e) { toast("Sjövädret kunde inte hämtas just nu."); }
}
function renderWxLayer() {
  if (!wxOn || !wxGrid) return;
  const lim = boat().maxWind || 10, i = wxGrid.t0 + wxStep, H = wxGrid.F[0].hourly;
  if (i >= H.time.length) return;
  const water = wxMode === "water";
  setData("wxgrid", water ? EMPTY : { type: "FeatureCollection", features: wxGrid.pts.map((p, k) => {
    const h = wxGrid.F[k]?.hourly; if (!h) return null;
    const w = h.wind_speed_10m[i], g = h.wind_gusts_10m[i], d = h.wind_direction_10m[i], wave = wxGrid.M[k]?.hourly?.wave_height?.[i];
    return { type: "Feature", properties: { w, g, lim, rot: (d + 180) % 360, lbl: `${Math.round(w)} (${Math.round(g)})${wave != null ? "\n" + wave.toFixed(1) + " m" : ""}` }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } };
  }).filter(Boolean) });
  setData("wxobs", !water && wxStep === 0 ? { type: "FeatureCollection", features: wxObs.map(o => ({ type: "Feature", properties: { w: o.w, g: o.g ?? o.w, lim, rot: (o.d + 180) % 360, lbl: `${Math.round(o.w)}${o.g != null ? ` (${Math.round(o.g)})` : ""}` }, geometry: { type: "Point", coordinates: [o.lng, o.lat] } })) } : EMPTY);
  if (water) {
    const fs = [
      ...wxGrid.pts.map((p, k) => { const v = wxGrid.M[k]?.hourly?.sea_surface_temperature?.[i]; return v == null ? null : { type: "Feature", properties: { v, obs: 0, lbl: v.toFixed(1) + "°" }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } }; }).filter(Boolean),
      ...(wxStep === 0 ? wxWater.map(o => ({ type: "Feature", properties: { v: o.v, obs: 1, lbl: o.v.toFixed(1) + "°" }, geometry: { type: "Point", coordinates: [o.lng, o.lat] } })) : [])
    ];
    // färgskalan sträcks ut mellan kallaste och varmaste värdet i bild (minst 2°), så att skillnader syns även när allt är kallt
    const bb = map.getBounds(), vis = fs.filter(f => bb.contains(f.geometry.coordinates)).map(f => f.properties.v), vs = vis.length ? vis : fs.map(f => f.properties.v);
    let lo = Math.min(...vs), hi = Math.max(...vs); if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
    fs.forEach(f => f.properties.c = Math.max(0, Math.min(1, (f.properties.v - lo) / (hi - lo))));
    setData("wxsst", { type: "FeatureCollection", features: fs });
    if (fs.length) { $("#sst-lo").textContent = lo.toFixed(1) + "°"; $("#sst-hi").textContent = hi.toFixed(1) + "°"; }
  } else setData("wxsst", EMPTY);
  const t = new Date(H.time[i]);
  $("#wxb-time").textContent = wxStep === 0 ? "Nu" : `${t.toDateString() === new Date().toDateString() ? "Idag" : DAYS[t.getDay()]} ${pad(t.getHours())}:00`;
  $("#wxb-sub").textContent = water ? `Vattentemperatur vid ytan${wxStep === 0 ? "" : " · prognos"}` : `Vind m/s (byar) och våghöjd · ${wxObs.length && wxStep === 0 ? "kuststationer uppmätta" : "prognos"}`;
  document.querySelectorAll("[data-wxm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.wxm === wxMode));
  $("#wxb-legend-wind").classList.toggle("hidden", water); $("#wxb-legend-water").classList.toggle("hidden", !water);
  flowStart();
}
/* uppmätt vind från Meteorologiska institutets kuststationer (öppen data) */
async function loadWxObs() {
  const bb = map.getBounds(), dx = (bb.getEast() - bb.getWest()) * .3, dy = (bb.getNorth() - bb.getSouth()) * .3;
  const b = { getWest: () => bb.getWest() - dx, getEast: () => bb.getEast() + dx, getSouth: () => bb.getSouth() - dy, getNorth: () => bb.getNorth() + dy }, start = new Date(Date.now() - 40 * 60000).toISOString().slice(0, 16) + ":00Z";
  const url = `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::simple&bbox=${b.getWest().toFixed(2)},${b.getSouth().toFixed(2)},${b.getEast().toFixed(2)},${b.getNorth().toFixed(2)}&parameters=windspeedms,winddirection,windgust&starttime=${start}&timestep=10`;
  try {
    const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/xml");
    const st = {};
    for (const el of xml.getElementsByTagNameNS("*", "BsWfsElement")) {
      const pos = el.getElementsByTagNameNS("*", "pos")[0]?.textContent.trim(); if (!pos) continue;
      const name = el.getElementsByTagNameNS("*", "ParameterName")[0]?.textContent, val = parseFloat(el.getElementsByTagNameNS("*", "ParameterValue")[0]?.textContent);
      const t = el.getElementsByTagNameNS("*", "Time")[0]?.textContent;
      if (isNaN(val)) continue;
      const o = st[pos] || (st[pos] = { t: "" });
      if (!o[name + "_t"] || t > o[name + "_t"]) { o[name] = val; o[name + "_t"] = t; }
    }
    wxObs = Object.entries(st).filter(([, o]) => o.windspeedms != null && o.winddirection != null).map(([pos, o]) => {
      const [lat, lng] = pos.split(/\s+/).map(Number); return { lat, lng, w: o.windspeedms, g: o.windgust ?? null, d: o.winddirection };
    });
    renderWxLayer();
  } catch (e) { wxObs = []; }
  try { wxWater = await waterObs([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); renderWxLayer(); } catch (e) { wxWater = []; }
}
function setWx(on) {
  if (on) track("weather_layer");
  wxOn = on;
  $("#b-wx").setAttribute("aria-pressed", on);
  $("#wxbar").classList.toggle("hidden", !on);
  if (on) { wxStep = 0; $("#wxb-range").value = 0; loadWxGrid(); loadWxObs(); }
  else { setData("wxgrid", EMPTY); setData("wxobs", EMPTY); setData("wxsst", EMPTY); flowStop(); }
}
$("#b-wx").onclick = () => setWx(!wxOn);
$("#wxb-close").onclick = () => setWx(false);
document.querySelectorAll("[data-wxm]").forEach(b => b.onclick = () => { wxMode = S.wxMode = b.dataset.wxm; save(); track("weather_mode", { m: wxMode }); renderWxLayer(); });
$("#wxb-range").oninput = e => { wxStep = +e.target.value; renderWxLayer(); };
map.on("moveend", () => { if (!wxOn) return; clearTimeout(wxGridT); wxGridT = setTimeout(() => { loadWxGrid(); if (wxStep === 0) loadWxObs(); }, 600); });
setInterval(() => { if (wxOn) { wxGrid = null; loadWxGrid(); loadWxObs(); } }, 10 * 60000);

/* ---------- AIS (Digitraffic, öppen data) ---------- */
const DT = { headers: { "Digitraffic-User": "Kummel/sjokort" } };
let aisT = null, aisMeta = {}, aisMetaAt = 0, aisShips = [];
const SHIPCAT = t => t >= 60 && t < 70 ? "pass" : t >= 70 && t < 80 ? "cargo" : t >= 80 && t < 90 ? "tank" : t === 30 ? "fish" : t === 36 ? "sail" : t === 37 ? "leis" : (t >= 50 && t < 60) || t === 31 || t === 32 || t === 33 ? "serv" : "other";
const CATNAME = { pass: "Passagerarfartyg", cargo: "Lastfartyg", tank: "Tankfartyg", fish: "Fiskebåt", sail: "Segelbåt", leis: "Fritidsbåt", serv: "Lots, bogserare, räddning", other: "Övrigt" };
const NAVSTAT = ["Under gång med motor", "För ankar", "Ej manöverduglig", "Begränsad manöverförmåga", "Begränsad av djupgående", "Förtöjd", "På grund", "Fiskar", "Under segel"];
async function loadAisMeta() {
  if (Date.now() - aisMetaAt < 30 * 60000) return;
  aisMetaAt = Date.now();
  try {
    const list = await (await fetch(`https://meri.digitraffic.fi/api/ais/v1/vessels?from=${Date.now() - 6 * 3600000}`, DT)).json();
    (Array.isArray(list) ? list : []).forEach(v => { aisMeta[v.mmsi] = v; });
    renderAis();
  } catch (e) { aisMetaAt = 0; }
}
async function loadAis() {
  if (!S.layers.ais) return;
  const c = map.getCenter(), b = map.getBounds();
  const r = Math.min(200, Math.max(5, distNm(ll(c), { lat: b.getNorth(), lng: b.getEast() }) * 1.852 * 1.15));
  try {
    const j = await (await fetch(`https://meri.digitraffic.fi/api/ais/v1/locations?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&radius=${Math.round(r)}&from=${Date.now() - 20 * 60000}`, DT)).json();
    aisShips = (j.features || []).map(f => {
      const p = f.properties || {}, [lng, lat] = f.geometry?.coordinates || [];
      return lat == null ? null : { mmsi: p.mmsi ?? f.mmsi, lat, lng, sog: p.sog ?? 0, cog: p.cog ?? 0, hdg: p.heading, nav: p.navStat, t: p.timestampExternal || Date.now() };
    }).filter(Boolean);
    renderAis(); loadAisMeta();
  } catch (e) { if (!aisShips.length) toast("AIS-data kunde inte hämtas just nu."); }
}
function renderAis() {
  if (!S.layers.ais) { setData("ais", EMPTY); setData("aisvec", EMPTY); return; }
  const feats = [], vecs = [];
  for (const s of aisShips) {
    const m = aisMeta[s.mmsi] || {}, moving = s.sog >= .7 ? 1 : 0;
    const rot = s.hdg != null && s.hdg < 360 ? s.hdg : s.cog || 0;
    feats.push({ type: "Feature", properties: { mmsi: s.mmsi, moving, rot, cat: SHIPCAT(m.shipType), name: (m.name || "").trim() }, geometry: { type: "Point", coordinates: [s.lng, s.lat] } });
    if (moving && s.sog > 2) vecs.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[s.lng, s.lat], lnglat(dest(s, s.cog, s.sog * 6 / 60))] } });
  }
  setData("ais", { type: "FeatureCollection", features: feats });
  setData("aisvec", { type: "FeatureCollection", features: vecs });
  if (sheetView && sheetView.startsWith("ais:")) openShip(+sheetView.slice(4), true);
}
/* närmaste passage (CPA) mellan egen båt och fartyget, båda på rak kurs */
function cpa(a, b) {
  const k = Math.cos(rad(a.lat)) * 60, v = (sog, cog) => [sog * Math.sin(rad(cog)), sog * Math.cos(rad(cog))];
  const [ax, ay] = [0, 0], [bx, by] = [(b.lng - a.lng) * k, (b.lat - a.lat) * 60];
  const [avx, avy] = v(a.sog || 0, a.cog || 0), [bvx, bvy] = v(b.sog || 0, b.cog || 0);
  const dvx = bvx - avx, dvy = bvy - avy, dv2 = dvx * dvx + dvy * dvy;
  const t = dv2 < 1e-6 ? 0 : Math.max(0, -((bx - ax) * dvx + (by - ay) * dvy) / dv2);
  return { nm: Math.hypot(bx + dvx * t, by + dvy * t), min: t * 60 };
}
function openShip(mmsi, refresh) {
  const s = aisShips.find(x => x.mmsi === mmsi); if (!s) return;
  const m = aisMeta[mmsi] || {}, age = Math.round((Date.now() - s.t) / 60000);
  let near = "";
  if (gps) {
    const d = distNm(gps, s), c = cpa(gps, s);
    near = `<div class="callout ${c.nm < .3 && c.min < 20 ? "bad" : "ok"}">Avstånd ${d.toFixed(2)} nm, bäring ${String(Math.round(bearing(gps, s))).padStart(3, "0")}°.${s.sog > .5 || gps.sog > .5 ? (c.min < 1 ? " Avståndet ökar." : ` Närmaste passage <b>${c.nm.toFixed(2)} nm</b> om ${Math.round(c.min)} min.`) : ""}</div>`;
  }
  const html = `
    <div class="muted">${CATNAME[SHIPCAT(m.shipType)]}${m.callSign ? " · " + esc(m.callSign) : ""} · MMSI ${mmsi}</div>
    <div class="wx-stats">
      <div><b>${s.sog.toFixed(1)}</b><span>Fart kn</span></div>
      <div><b>${String(Math.round(s.cog)).padStart(3, "0")}°</b><span>Kurs</span></div>
      <div><b>${m.draught ? (m.draught / 10).toFixed(1) + " m" : "–"}</b><span>Djupgående</span></div>
    </div>
    ${near}
    ${s.nav != null && NAVSTAT[s.nav] ? `<div>${NAVSTAT[s.nav]}</div>` : ""}
    ${m.destination ? `<div>Destination: <b>${esc(m.destination)}</b></div>` : ""}
    <div class="muted">Position för ${age < 1 ? "mindre än en minut" : age + " min"} sedan. Källa: Digitraffic (Fintraffic).</div>`;
  if (refresh && sheetView === "ais:" + mmsi) { $("#sh-body").innerHTML = html; return; }
  openSheet((m.name || "Fartyg").trim(), html, "ais:" + mmsi);
}
["ais", "ais-bg"].forEach(l => map.on("click", l, e => { if (e.defaultPrevented) return; e.preventDefault(); openShip(+e.features[0].properties.mmsi); }));
map.on("mouseenter", "ais", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "ais", () => map.getCanvas().style.cursor = "");
function setAis(on) {
  if (on) track("ais_on");
  S.layers.ais = on; save(); clearInterval(aisT);
  if (on) { loadAis(); aisT = setInterval(loadAis, 20000); } else renderAis();
}
map.on("moveend", () => { if (S.layers.ais) { clearTimeout(loadAis.t); loadAis.t = setTimeout(loadAis, 800); } });

/* ---------- boats ---------- */
const BTYPES = { motor: "Motorbåt", segel: "Segelbåt", rib: "RIB", kajak: "Kajak / kanot", ovrig: "Annan" };
const BDEF = { motor: { speed: 20, fuel: 18, maxWind: 10, draft: .6 }, segel: { speed: 5.5, fuel: 1.5, maxWind: 13, draft: 1.6 }, rib: { speed: 28, fuel: 25, maxWind: 9, draft: .5 }, kajak: { speed: 3, fuel: 0, maxWind: 6, draft: .2 }, ovrig: { speed: 6, fuel: 3, maxWind: 8, draft: .8 } };
function boatChanged() { if (mapReady) { KummelChart.setNeed(map, needDepth()); renderSatLegend(S.layers.base === "sat" && (S.layers.groups || {}).satdepth !== false); } if (wx) renderChip(); }
function openBoats() {
  openSheet("Båtar", `
    <div class="list">${S.boats.map(b => `<div class="card ${b.id === S.boatId ? "sel" : ""}">
      <h3>${esc(b.name)}</h3><div class="muted">${BTYPES[b.type]} · ${b.length} m · djupgående ${b.draft} m (+${b.margin} m marginal) · höjd ${b.air} m · ${b.speed} kn</div>
      <div class="row">${b.id === S.boatId ? `<span class="pill ok">Aktiv</span>` : `<button class="btn" data-use="${b.id}">Använd</button>`}<button class="btn" data-edit="${b.id}">Ändra</button></div></div>`).join("")}</div>
    <div class="muted">Sjökortet markerar vatten som är grundare än den aktiva båtens djupgående plus marginal.</div>
    <button class="btn pri" id="bt-new">Lägg till båt</button>`, "boats");
  document.querySelectorAll("[data-use]").forEach(x => x.onclick = () => { S.boatId = x.dataset.use; save(); boatChanged(); openBoats(); toast(`Aktiv båt: ${boat().name}`); });
  document.querySelectorAll("[data-edit]").forEach(x => x.onclick = () => editBoat(x.dataset.edit));
  $("#bt-new").onclick = () => editBoat(null);
}
function editBoat(id) {
  const b = id ? S.boats.find(x => x.id === id) : { name: "", type: "motor", length: 6, beam: 2.3, air: 2, ...BDEF.motor, margin: 0.5 };
  const n = (k, lbl, step = "0.1") => `<label class="f">${lbl}<input type="number" step="${step}" inputmode="decimal" id="bf-${k}" value="${b[k]}"></label>`;
  openSheet(id ? "Ändra båt" : "Ny båt", `
    <label class="f">Namn<input id="bf-name" value="${esc(b.name)}" placeholder="t.ex. Buster"></label>
    <label class="f">Typ<select id="bf-type">${Object.entries(BTYPES).map(([k, v]) => `<option value="${k}" ${k === b.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <div class="grid2">${n("length", "Längd (m)")}${n("beam", "Bredd (m)")}${n("draft", "Djupgående (m)")}${n("air", "Höjd över vattnet (m)")}${n("margin", "Marginal under kölen (m)")}${n("speed", "Marschfart (kn)", "0.5")}${n("fuel", "Förbrukning (l/h)", "0.5")}${n("maxWind", "Gräns för byvind (m/s)", "1")}</div>
    <div class="muted">Djupgående och marginal styr grundvarningarna på sjökortet. Fart och förbrukning används för ankomsttid och bränsle. Vindgränsen styr väderfönster och varningar.</div>
    <div class="row"><button class="btn pri" id="bf-save">Spara</button>${id && S.boats.length > 1 ? `<button class="btn warn" id="bf-del">Ta bort</button>` : ""}<button class="btn" id="bf-back">Tillbaka</button></div>`, "boatedit");
  $("#bf-type").onchange = e => { const d = BDEF[e.target.value]; ["speed", "fuel", "maxWind", "draft"].forEach(k => $("#bf-" + k).value = d[k]); };
  $("#bf-save").onclick = () => {
    b.name = $("#bf-name").value.trim() || BTYPES[$("#bf-type").value]; b.type = $("#bf-type").value;
    ["length", "beam", "draft", "air", "margin", "speed", "fuel", "maxWind"].forEach(k => b[k] = parseFloat(String($("#bf-" + k).value).replace(",", ".")) || 0);
    if (!id) { b.id = uid(); S.boats.push(b); S.boatId = b.id; }
    save(); boatChanged(); openBoats();
  };
  const del = $("#bf-del"); if (del) del.onclick = () => { S.boats = S.boats.filter(x => x.id !== id); if (S.boatId === id) S.boatId = S.boats[0].id; save(); boatChanged(); openBoats(); };
  $("#bf-back").onclick = openBoats;
}

/* ---------- layers ---------- */
/* vilka val som har betydelse för vald karta */
const OPTS = {
  steep: ["chart", "sat"], fairways: ["chart", "sat"], marks: ["chart", "sat"], rocks: ["chart", "sat"], sectors: ["chart", "sat"],
  contours: ["chart", "sat"], satdepth: ["sat"], limits: ["chart", "sat"], land: ["chart"],
  soundings: ["chart", "sat"], detail: ["chart"], props: ["chart", "sat", "osm"], ais: ["chart", "sat", "osm"]
};
const applies = k => (OPTS[k] || []).includes(S.layers.base || "chart");
function openLayers() {
  const r = (k, v) => `<label class="row"><input type="radio" name="base" value="${k}" ${S.layers.base === k ? "checked" : ""}> ${v}</label>`;
  openSheet("Kartlager", `
    <div class="card"><h3>Karta</h3>${r("chart", "Sjökort")}${r("sat", "Flygfoto med farleder och sjömärken")}${r("osm", "Gatukarta")}</div>
    <div class="card"><h3>Båtpilen</h3>
      <label class="row"><input type="checkbox" id="ly-compass" ${S.compassSlow ? "checked" : ""}> Använd telefonens kompass när båten går långsamt</label>
      <div class="muted">Annars pekar pilen åt det håll båten senast rörde sig. Kompassen fungerar bäst om telefonen ligger fast i båten med överkanten mot fören.</div></div>
    <div class="card"><h3>Fastighetsgränser</h3>
      <label class="row"><input type="checkbox" id="ly-prop" ${S.layers.props ? "checked" : ""} ${mmlKey() ? "" : "disabled"}> Visa fastighetsgränser</label>
      <div class="muted">Flygbild och fastighetsgränser kommer från Lantmäteriverket i Finland.</div>
    </div>
    ${applies("detail") ? `<div class="card"><h3>Detaljkort</h3>
      <label class="row"><input type="checkbox" id="ly-det" ${S.layers.detail ? "checked" : ""}> Visa detaljkortet när jag zoomar in</label>
      <label class="f">Visa detaljkortet från<select id="ly-dz">${[[11, "Översikt (ca 2 nm över skärmen)"], [12, "Mellan (ca 1 nm)"], [13, "Nära (ca 0,5 nm), rekommenderas"], [14, "Mycket nära (ca 0,25 nm)"]].map(([z, t]) => `<option value="${z}" ${dz() === z ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="muted">Traficoms inskannade sjökort ovanpå vektorkortet. Längre ut blir det svårläst eftersom kortet förminskas.</div>
    </div>` : ""}
    <div class="card"><h3>Visa på kartan</h3>
      <div class="row" style="gap:8px;margin-bottom:4px"><button class="btn sm" id="ly-all">Välj alla</button><button class="btn sm" id="ly-none">Avmarkera alla</button></div>
      ${[["fairways", "Farleder, ledlinjer och farledsdjup"], ["marks", "Sjömärken och fyrar"], ["rocks", "Stenar och grund"], ["sectors", "Ljussektorer"], ["contours", "Djupkurvor"], ["satdepth", "Djupfärg på flygfotot"], ["limits", "Fartbegränsningar och förbudsområden"], ["land", "Ortnamn, vägar och hus"], ["steep", "Branter (syns i läget Fiske)"]].filter(([g]) => applies(g)).map(([g, t]) => `<label class="row"><input type="checkbox" data-grp="${g}" ${(S.layers.groups || {})[g] !== false ? "checked" : ""}> ${t}</label>`).join("")}
      ${applies("soundings") ? `<label class="row"><input type="checkbox" id="ly-snd" ${S.layers.soundings ? "checked" : ""}> Djupsiffror${S.layers.base === "sat" ? " (bara grundare än din båt)" : ""}</label>` : ""}
      <label class="row"><input type="checkbox" id="ly-ais" ${S.layers.ais ? "checked" : ""}> AIS-fartyg i realtid</label>
    </div>
    ${applies("detail") ? `<div class="muted">På detaljkortet är vatten som är grundare än din båt behöver skuggat i rött.</div>` : ""}
    <div class="disclaimer">Källa: Traficom (CC BY 4.0). Ej för navigering, uppfyller inte kraven för officiella sjökort. Använd alltid uppdaterade officiella sjökort.</div>`, "layers");
  const on = (id, ev, f) => { const el = $(id); if (el) el[ev] = f; };
  on("#ly-snd", "onchange", e => { S.layers.soundings = e.target.checked; save(); applyLayers(); });
  $("#ly-ais").onchange = e => setAis(e.target.checked);
  $("#ly-compass").onchange = async e => { const ok = await setCompass(e.target.checked); S.compassSlow = e.target.checked && ok ? 1 : 0; e.target.checked = !!S.compassSlow; save(); };
  on("#ly-det", "onchange", e => { S.layers.detail = e.target.checked; save(); applyLayers(); });
  $("#ly-prop").onchange = e => { S.layers.props = e.target.checked; save(); applyLayers(); if (e.target.checked && map.getZoom() < 12) toast("Fastighetsgränser visas när du zoomar in närmare", 2200); };
  on("#ly-dz", "onchange", e => { S.layers.detailZoom = +e.target.value; save(); applyLayers(); });
  const setAll = on => { const card = $("#ly-all").closest(".card"); card.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach(x => { if (x.checked !== on) { x.checked = on; x.dispatchEvent(new Event("change")); } }); };
  $("#ly-all").onclick = () => setAll(true); $("#ly-none").onclick = () => setAll(false);
  document.querySelectorAll("[data-grp]").forEach(x => x.onchange = () => { S.layers.groups = { ...(S.layers.groups || {}), [x.dataset.grp]: x.checked }; save(); applyLayers(); });
  document.querySelectorAll("input[name=base]").forEach(x => x.onchange = () => { S.layers.base = x.value; save(); applyLayers(); track("base_map", { base: x.value }); const y = $("#sh-body").scrollTop; openLayers(); $("#sh-body").scrollTop = y; });
}
$("#b-layers").onclick = openLayers;
$("#b-detail").onclick = () => {
  if (S.layers.base !== "chart") { toast("Detaljkortet finns bara i läget Sjökort", 2000); return; }
  S.layers.detail = !S.layers.detail; save(); applyLayers();
  toast(S.layers.detail ? (map.getZoom() < dz() ? "Grynnor visas när du zoomar in närmare" : "Detaljkort med grynnor och stenar") : "Vektorsjökort", 1800);
};

/* ---------- menu ---------- */
function openMenu() {
  const b = boat();
  openSheet("Meny", `
    <div class="card sel"><h3>${esc(b.name)}</h3><div class="muted">${BTYPES[b.type]} · djupgående ${b.draft} m · ${b.speed} kn</div><div class="row"><button class="btn" id="m-boats">Båtar</button></div></div>
    <div class="list">
      <button class="btn" id="m-places">Mina platser (${S.places.length})</button>
      <button class="btn" id="m-routes">Sparade rutter (${S.routes.length})</button>
      <button class="btn" id="m-log">Loggbok (${S.tracks.length} turer)</button>
      <button class="btn" id="m-catch">Fångstlogg (${S.catches.length})</button>
      <button class="btn" id="m-data">Flytta och säkerhetskopiera</button>
      <button class="btn" id="m-anchor">Ankarlarm${S.anchor ? " (på)" : ""}</button>
      <button class="btn" id="m-offline">Offlinekarta${S.offline ? " (nedladdad)" : ""}</button>
      <button class="btn" id="m-legend">Teckenförklaring</button>
      <button class="btn" id="m-welcome">Så fungerar Kummel</button>
      <button class="btn" id="m-about">Om Kummel</button>
    </div>
    <div class="maker">${ALAND_FLAG} Kummel · en produkt från ${MAKER}, ${MAKER_TOWN}</div>`, "menu");
  $("#m-boats").onclick = openBoats; $("#m-places").onclick = openPlaces; $("#m-routes").onclick = openRoutes;
  $("#m-log").onclick = openLog; $("#m-catch").onclick = openCatches; $("#m-data").onclick = openData; $("#m-about").onclick = openAbout; $("#m-welcome").onclick = () => termsOk() ? openTour() : openWelcome(); $("#m-legend").onclick = openLegend; $("#m-anchor").onclick = openAnchor; $("#m-offline").onclick = openOffline;
}
$("#b-menu").onclick = openMenu;
function openPlaces() {
  openSheet("Mina platser", `<div class="list">${S.places.map(p => `<div class="card"><h3>${CATS[p.cat].e} ${esc(p.name)}</h3>${p.note ? `<div>${esc(p.note)}</div>` : ""}<div class="row"><button class="btn" data-go="${p.id}">Visa</button></div></div>`).join("") || `<div class="muted">Inga platser ännu. Tryck på nålknappen eller håll fingret på kartan för att spara en plats.</div>`}</div>`, "places");
  document.querySelectorAll("[data-go]").forEach(x => x.onclick = () => { const p = S.places.find(q => q.id === x.dataset.go); map.easeTo({ center: lnglat(p), zoom: 14 }); openPlace(p.id); });
}
const boundsOf = pts => pts.reduce((b, p) => b.extend([p[1], p[0]]), new maplibregl.LngLatBounds([pts[0][1], pts[0][0]], [pts[0][1], pts[0][0]]));
function openRoutes() {
  openSheet("Sparade rutter", `<div class="list">${S.routes.map(r => `<div class="card"><h3>${esc(r.name)}</h3><div class="muted">${routeStats(r.pts.map(p => ({ lat: p[0], lng: p[1] }))).nm.toFixed(1)} nm · ${r.pts.length} punkter</div><div class="row"><button class="btn pri" data-nav="${r.id}">Navigera</button><button class="btn" data-open="${r.id}">Öppna</button><button class="btn" data-share="${r.id}">Dela</button><button class="btn warn" data-del="${r.id}">Ta bort</button></div></div>`).join("") || `<div class="muted">Inga sparade rutter.</div>`}</div>`, "routes");
  document.querySelectorAll("[data-open]").forEach(x => x.onclick = () => {
    const r = S.routes.find(q => q.id === x.dataset.open);
    map.fitBounds(boundsOf(r.pts), { padding: 60, duration: 0 });
    startPlanning(r.pts.map(p => ({ lat: p[0], lng: p[1] }))); routeId = r.id; routeName = r.name; renderRoute();
  });
  document.querySelectorAll("[data-del]").forEach(x => x.onclick = () => { S.routes = S.routes.filter(q => q.id !== x.dataset.del); save(); openRoutes(); });
  document.querySelectorAll("[data-share]").forEach(x => x.onclick = () => shareRoute(S.routes.find(q => q.id === x.dataset.share)));
  document.querySelectorAll("[data-nav]").forEach(x => x.onclick = () => { const r = S.routes.find(q => q.id === x.dataset.nav); startNav(r.pts.map(p => ({ lat: p[0], lng: p[1] }))); });
}
function openLog() {
  const tot = S.tracks.reduce((s, t) => s + (t.nm || 0), 0);
  openSheet("Loggbok", `
    <div class="row" style="gap:24px"><div><div class="big">${tot.toFixed(1)}</div><div class="muted">nm totalt</div></div><div><div class="big">${S.tracks.length}</div><div class="muted">turer</div></div></div>
    <div class="list">${S.tracks.map(t => { const d = new Date(t.start), h = (t.end - t.start) / 3600000; return `<div class="card"><h3>${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1} kl ${hm(d)}</h3>
      <div class="muted num">${(t.nm || 0).toFixed(1)} nm · ${fmtDur(h)} · snitt ${h ? (t.nm / h).toFixed(1) : 0} kn · max ${t.max.toFixed(1)} kn · ${esc(t.boat || "")}</div>
      <div class="row"><button class="btn" data-show="${t.id}">Visa</button><button class="btn" data-gpx="${t.id}">GPX</button><button class="btn warn" data-del="${t.id}">Ta bort</button></div></div>`; }).join("") || `<div class="muted">Inga turer ännu. Tryck på Spela in när du lämnar bryggan.</div>`}</div>`, "log");
  document.querySelectorAll("[data-show]").forEach(x => x.onclick = () => {
    const t = S.tracks.find(q => q.id === x.dataset.show);
    setData("shown", lineFC(t.pts.map(p => [p[1], p[0]])));
    map.fitBounds(boundsOf(t.pts), { padding: 60 });
  });
  document.querySelectorAll("[data-gpx]").forEach(x => x.onclick = () => downloadGpx(S.tracks.find(q => q.id === x.dataset.gpx)));
  document.querySelectorAll("[data-del]").forEach(x => x.onclick = () => { S.tracks = S.tracks.filter(q => q.id !== x.dataset.del); save(); openLog(); });
}
function downloadBlob(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function downloadGpx(t) {
  const pts = t.pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join("");
  downloadBlob(`kummel-${new Date(t.start).toISOString().slice(0, 10)}.gpx`, `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Kummel" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Tur ${new Date(t.start).toLocaleString("sv")}</name><trkseg>${pts}</trkseg></trk></gpx>`, "application/gpx+xml");
}
function openCatches() {
  const st = catchStats(), recs = Object.entries(st.rec).filter(([, r]) => r.kg || r.len).sort((x, y) => y[1].n - x[1].n);
  const seasonN = Object.values(st.season).reduce((s, v) => s + v, 0), released = S.catches.filter(c => c.released).length;
  openSheet("Fångstlogg", `
    ${S.catches.length ? `<div class="card"><h3>Säsongen ${st.yr}</h3><div class="muted">${seasonN} fångster${released ? ` · ${released} catch &amp; release` : ""}</div>
      <div class="row">${Object.entries(st.season).map(([k, v]) => `<span class="pill">${esc(k)} ${v}</span>`).join("") || `<span class="muted">Inga fångster i år ännu.</span>`}</div></div>` : ""}
    ${recs.length ? `<div class="card"><h3>Dina rekord</h3>${recs.map(([sp, r]) => `<div class="rec-row"><b>${esc(sp)}</b><span>${r.kg ? `${fmt1(r.kg)} kg` : ""}${r.kg && r.len ? " · " : ""}${r.len ? `${fmt1(r.len)} cm` : ""}</span><button class="btn sm" data-c="${(r.kgC || r.lenC).id}">Visa</button></div>`).join("")}</div>` : ""}
    ${S.catches.length >= 3 ? `<label class="row"><input type="checkbox" id="ct-heat" ${S.heat ? "checked" : ""}> Visa var du fått mest fisk (värmekarta)</label>` : ""}
    <div class="list">${S.catches.map(c => { const d = new Date(c.t); return `<div class="card"><h3>${c.photo ? "📷 " : ""}${esc(c.species || "Fångst")} ${c.kg ? `· ${esc(c.kg)} kg` : ""}${c.len ? ` · ${esc(c.len)} cm` : ""}${c.released ? ` <span class="pill">C&amp;R</span>` : ""}</h3>
      <div class="muted">${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1} kl ${hm(d)}${c.depth ? ` · ${esc(c.depth)}` : ""}${c.wx ? ` · ${c.wx.wind.toFixed(0)} m/s ${compass(c.wx.dir)} · ${Math.round(c.wx.p)} hPa · ${c.wx.moon.icon}` : ""}${c.lure ? " · " + esc(c.lure) : ""}</div>
      <div class="row"><button class="btn" data-c="${c.id}">Visa</button><button class="btn" data-share="${c.id}">Dela</button></div></div>`; }).join("") || `<div class="muted">Inga fångster ännu. Välj läget Fiske och tryck på Fisk! när det nappar.</div>`}</div>
    <button class="btn pri" id="ct-past">Lägg till fångst i efterhand</button>
    <div class="muted">Dina fiskeplatser och foton sparas bara på den här enheten och delas aldrig, om du inte själv delar en fångst.</div>`, "catches");
  $("#ct-past").onclick = newPastCatch;
  const heat = $("#ct-heat"); if (heat) heat.onchange = () => { S.heat = heat.checked; save(); if (S.mode !== "fiske") setMode("fiske"); refreshCatches(); };
  document.querySelectorAll("[data-c]").forEach(x => x.onclick = () => { const c = S.catches.find(q => q.id === x.dataset.c); if (S.mode !== "fiske") setMode("fiske"); map.easeTo({ center: lnglat(c), zoom: 14 }); openCatch(c.id); });
  document.querySelectorAll("[data-share]").forEach(x => x.onclick = () => openShare(x.dataset.share));
}
/* ---------- säkerhetskopia: spara, skicka och slå ihop ----------
   Filen innehåller platser, rutter, turer, fångster (med foton) och båtar.
   Inläsning SLÅR IHOP: nya saker läggs till, det som redan finns (samma id) lämnas orört. */
const LISTS = [["catches", "fångst", "fångster"], ["routes", "rutt", "rutter"], ["places", "plats", "platser"], ["tracks", "tur", "turer"], ["boats", "båt", "båtar"]];
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(null); f.readAsDataURL(b); });
async function makeBackup() {
  const data = {}; LISTS.forEach(([k]) => data[k] = S[k] || []);
  data.boatId = S.boatId; data.fishDepth = S.fishDepth;
  const photos = {};
  for (const c of S.catches) if (c.photo) { const b = await photoGet(c.id); if (b) { const d = await blobToData(b); if (d) photos[c.id] = d; } }
  return { kummel: 2, exported: new Date().toISOString(), data, photos };
}
const backupName = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `kummel-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`; };
function backupSummary() {
  const n = LISTS.filter(([k]) => k !== "boats").map(([k, one, many]) => { const c = (S[k] || []).length; return c ? `${c} ${c === 1 ? one : many}` : ""; }).filter(Boolean);
  const ph = S.catches.filter(c => c.photo).length;
  return (n.length ? n.join(", ") : "inget sparat än") + (ph ? ` · ${ph} foto${ph === 1 ? "" : "n"}` : "");
}
async function mergeBackup(o) {
  const src = o && o.kummel ? o.data : o;   // äldre kopior var hela tillståndet
  if (!src || typeof src !== "object" || !LISTS.some(([k]) => Array.isArray(src[k]))) throw new Error("fel format");
  const added = {}; let same = 0, ph = 0;
  for (const [k] of LISTS) {
    const mine = S[k] || (S[k] = []), have = new Set(mine.map(x => x.id));
    for (const it of src[k] || []) {
      if (!it || !it.id) continue;
      if (have.has(it.id)) { if (k !== "boats") same++; continue; }
      if (k === "boats" && mine.length === 1 && mine[0].id === "b1" && mine[0].name === "Min båt") { mine.length = 0; S.boatId = it.id; }   // ersätt standardbåten
      mine.push(it); have.add(it.id); added[k] = (added[k] || 0) + 1;
      if (k === "catches" && it.photo && o.photos && o.photos[it.id]) { try { await photoPut(it.id, await (await fetch(o.photos[it.id])).blob()); ph++; } catch (e) { it.photo = 0; } }
      else if (k === "catches" && it.photo) it.photo = 0;
    }
  }
  S.catches.sort((x, y) => y.t - x.t); S.tracks.sort((x, y) => (y.start || 0) - (x.start || 0)); S.routes.sort((x, y) => (y.created || 0) - (x.created || 0));
  if (!S.boats.some(b => b.id === S.boatId) && S.boats[0]) S.boatId = S.boats[0].id;
  save(); drawPlaces(); refreshCatches(); boatChanged();
  const txt = LISTS.filter(([k]) => added[k]).map(([k, one, many]) => `${added[k]} ${added[k] === 1 ? one : many}`);
  track("backup_import", { added: Object.values(added).reduce((s, v) => s + v, 0) });
  return (txt.length ? "La till " + txt.join(", ") : "Inget nytt att lägga till") + (ph ? ` (${ph} foto${ph === 1 ? "" : "n"})` : "") + (same ? `. ${same} fanns redan.` : ".");
}
async function backupFile() { const j = JSON.stringify(await makeBackup()); return new File([j], backupName(), { type: "application/json" }); }
function openData() {
  openSheet("Flytta data", `
    <div class="muted">Allt du sparar finns bara på den här enheten. Så här flyttar du det, till exempel från datorn till telefonen inför turen, eller fångsterna från telefonen till datorn:</div>
    <div class="card"><h3>1. På enheten du har sakerna på</h3><div class="muted">Just nu: ${backupSummary()}</div>
      <div class="row"><button class="btn pri" id="d-send">Skicka till annan enhet</button><button class="btn" id="d-exp">Spara som fil</button></div>
      <div class="muted">"Skicka" öppnar telefonens delningsmeny: AirDrop, mejl, meddelande eller Filer.</div></div>
    <div class="card"><h3>2. På enheten som ska ta emot</h3>
      <label class="btn pri" style="text-align:center">Läs in kopia<input type="file" id="d-imp" accept=".json,.txt,application/json,text/plain" hidden></label>
      <div class="muted">Det som finns i kopian läggs till. Inget du redan har här tas bort eller skrivs över.</div></div>
    <div class="muted" id="d-msg"></div>`, "data");
  const msg = t => { const el = $("#d-msg"); if (el) el.textContent = t; };
  $("#d-exp").onclick = async () => { msg("Skapar kopia …"); const f = await backupFile(); downloadBlob(f.name, await f.text(), "application/json"); msg(""); track("backup_export", { how: "file" }); };
  $("#d-send").onclick = async () => {
    msg("Skapar kopia …"); let f = await backupFile(); msg("");
    if (navigator.canShare && !navigator.canShare({ files: [f] })) f = new File([await f.text()], f.name, { type: "text/plain" });   // vissa webbläsare delar bara "text"-filer
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: "Kummel-kopia", text: "Öppna Kummel på den andra enheten: Meny → Flytta och säkerhetskopiera → Läs in kopia." }); track("backup_export", { how: "share" }); } catch (e) {}
    } else { downloadBlob(f.name, await f.text(), "application/json"); toast("Filen är sparad. Flytta den till den andra enheten och läs in den där.", 4000); track("backup_export", { how: "file" }); }
  };
  $("#d-imp").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { msg("Läser in …"); const r = await mergeBackup(JSON.parse(await file.text())); msg(r); toast(r, 4000); }
    catch (err) { msg(""); toast("Filen kunde inte läsas. Välj en kopia som är gjord i Kummel."); }
    e.target.value = "";
  };
}
function shareApp() {
  track("share_app");
  const d = { title: "Kummel", text: "Kummel – sjökort, sjöväder och fiske för Ålands skärgård. Gratis i webbläsaren:", url: SITE_URL };
  if (navigator.share) navigator.share(d).catch(() => {});
  else { try { navigator.clipboard.writeText(SITE_URL); toast("Adressen är kopierad: " + SITE, 2500); } catch (e) { toast(SITE, 3000); } }
}
function openAbout() {
  openSheet("Om Kummel", `
    <div class="home-line">${ALAND_FLAG}<div><b>Kummel</b> är sjökortet för Ålands skärgård: djup, sjömärken, grynnor, sjöväder, rutter med ankomsttid och fiske. Byggt av båtfolk för de egna vattnen: hela Åland, från Ålands hav i väster till Brändö, Kökar och skärgården mot Åboland i öster.</div></div>
    <div class="card"><h3>${SITE}</h3><div class="muted">Här finns Kummel alltid. Tipsa gärna båt- och fiskevänner.</div>
      <div class="row"><button class="btn pri" id="ab-share">Dela Kummel</button></div></div>
    <div class="card"><h3>Officiella källor</h3><div class="muted">Djup och sjökort: Traficom. Farleder, sjömärken, fyrar och vattentrafikmärken: Väylävirasto. Stenar, grund och flygbild: Lantmäteriverket. Vattenstånd och vattentemperatur: Meteorologiska institutet. Fartyg (AIS): Digitraffic. Väderprognos: Open-Meteo. Bakgrundskarta: OpenStreetMap. Sjökortet uppdateras varje vecka.</div></div>
    <div class="card"><h3>Integritet</h3><div class="muted">Dina platser, rutter, fångster och foton sparas bara i den här enheten. För att hämta väder, vattenstånd och kartor skickas kartans position till respektive tjänst, men aldrig till oss. ${GA_ID ? "Om du tillåter det räknar Kummel anonymt vilka funktioner som används (Google Analytics), utan positioner eller fångster." : ""}</div>
      ${GA_ID ? `<label class="row"><input type="checkbox" id="ab-stats" ${S.stats === 1 ? "checked" : ""}> Tillåt anonym statistik</label>` : ""}</div>
    <div class="card"><h3>Tips</h3><div class="muted">Håll fingret på kartan för att spara en plats. Vrid kartan med två fingrar. Tryck på positionsknappen två gånger för kurs upp. Ställ in båtens djupgående under Meny → Båtar, så markeras grunt vatten för just din båt. Lägg till Kummel på hemskärmen så öppnas den som en app.</div></div>
    <div class="disclaimer">Kummel är inte ett certifierat navigationshjälpmedel. Ruttförslag och varningar är hjälpmedel: föraren ansvarar alltid för navigeringen. Sjökortsdata från Traficom (CC BY 4.0) är inte avsedd för navigering.</div>
    <div class="maker" style="flex-direction:column;gap:2px"><div>Kummel är en produkt från <b>${MAKER}</b>, ${MAKER_TOWN}</div><div>FO-nummer ${MAKER_ID} · version 0.2</div></div>`, "about");
  $("#ab-share").onclick = shareApp;
  const st = $("#ab-stats"); if (st) st.onchange = () => { setStats(st.checked); toast(st.checked ? "Tack! Statistiken är på." : "Statistiken är avstängd.", 2000); };
}

/* ---------- ankarlarm ----------
   Ankarpunkt + radie. Larmar med ljud, vibration och röd skärm om båten hamnar utanför
   (tre GPS-punkter i rad, med hänsyn till GPS-osäkerheten) eller om GPS:en tystnar i över en minut.
   Webbläsaren kör bara när appen är öppen och skärmen tänd, det sägs tydligt i panelen. */
let anchorOut = 0, anchorMax = 0, anchorDist = null, anchorAlarmOn = false, anchorMuteUntil = 0, actx = null, beepTimer = null;
function anchorDraw() {
  if (!S.anchor) { setData("anchor", EMPTY); return; }
  const out = anchorAlarmOn ? 1 : 0, c = circlePoly(S.anchor, S.anchor.r, 72);
  c.features[0].properties.out = out;
  c.features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lnglat(S.anchor) } });
  setData("anchor", c);
}
function unlockAudio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
}
function beep() {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = "square"; o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.5, t + .02); g.gain.setValueAtTime(.5, t + .4); g.gain.exponentialRampToValueAtTime(.0001, t + .45);
    o.start(t); o.stop(t + .5);
  } catch (e) {}
}
function anchorAlarm(on, why) {
  anchorAlarmOn = on;
  const el = $("#anchoralarm");
  el.classList.toggle("hidden", !on);
  if (on) {
    $("#aa-why").textContent = why;
    if (!beepTimer) beepTimer = setInterval(() => {
      if (Date.now() < anchorMuteUntil) return;
      beep(); try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch (e) {}
    }, 1200);
  } else { clearInterval(beepTimer); beepTimer = null; }
  anchorDraw(); anchorBar();
}
function anchorBar() {
  const el = $("#anchorbar"); if (!el) return;
  el.classList.toggle("hidden", !S.anchor);
  if (!S.anchor) return;
  el.classList.toggle("bad", anchorAlarmOn);
  el.innerHTML = anchorDist == null ? `⚓ Ankarlarm · väntar på GPS` : `⚓ ${Math.round(anchorDist)} m av ${S.anchor.r} m · max ${Math.round(anchorMax)} m`;
  if (sheetView === "anchor") { const d = $("#an-now"); if (d) d.textContent = anchorDist == null ? "–" : Math.round(anchorDist) + " m"; const m = $("#an-max"); if (m) m.textContent = Math.round(anchorMax) + " m"; }
}
function anchorCheck(pos) {
  if (!S.anchor) return;
  anchorDist = distNm(S.anchor, pos) * NM;
  anchorMax = Math.max(anchorMax, anchorDist);
  const slack = Math.min(gps && gps.acc || 10, 30) * .5;   // osäker GPS ska inte ge falsklarm
  if (anchorDist - slack > S.anchor.r) { if (++anchorOut >= 3 && !anchorAlarmOn) anchorAlarm(true, `Båten är ${Math.round(anchorDist)} m från ankaret (gräns ${S.anchor.r} m).`); }
  else { anchorOut = 0; if (anchorAlarmOn && anchorDist < S.anchor.r) anchorAlarm(false); }
  anchorBar();
}
setInterval(() => {   // GPS-vakt
  if (!S.anchor || anchorAlarmOn) return;
  const age = lastFix ? Date.now() - lastFix.t : Infinity;
  if (age > 60000 && watchId !== null) anchorAlarm(true, "Ingen GPS-position på över en minut. Kontrollera båten.");
}, 10000);
function setAnchor(at) {
  track("anchor_set");
  unlockAudio(); startGps(); keepAwake();
  S.anchor = { lat: at.lat, lng: at.lng, r: +($("#an-r") ? $("#an-r").value : 40), t: Date.now() }; save();
  anchorOut = 0; anchorMax = 0; anchorDist = gps ? distNm(S.anchor, gps) * NM : null;
  anchorDraw(); anchorBar(); openAnchor();
  toast("Ankarlarmet är på. Håll appen öppen och skärmen tänd.", 3500);
}
function openAnchor() {
  const r = S.anchor ? S.anchor.r : 40;
  openSheet("Ankarlarm", S.anchor ? `
    <div class="grid2"><div class="card"><div class="muted">Avstånd nu</div><b id="an-now" style="font-size:22px">${anchorDist == null ? "–" : Math.round(anchorDist) + " m"}</b></div>
      <div class="card"><div class="muted">Längst bort</div><b id="an-max" style="font-size:22px">${Math.round(anchorMax)} m</b></div></div>
    <label class="f">Larmgräns: <b id="an-rv">${r} m</b><input type="range" id="an-r" min="15" max="250" step="5" value="${r}"></label>
    <div class="row"><button class="btn" id="an-show">Visa på kartan</button><button class="btn" id="an-test">Testa larmet</button><button class="btn warn" id="an-off">Ta upp ankaret</button></div>
    <div class="callout"><b>Viktigt:</b> larmet fungerar bara när Kummel är öppen och skärmen är tänd. Låser du telefonen eller byter app kan larmet inte gå. Sätt telefonen på laddning och stäng av ljudlöst läge, annars hörs inte larmet.</div>`
  : `
    <div>Sätt ankarpunkten när ankaret ligger på botten. Om båten hamnar utanför cirkeln, eller om GPS:en tystnar, larmar telefonen med ljud och vibration.</div>
    <label class="f">Larmgräns: <b id="an-rv">${r} m</b><input type="range" id="an-r" min="15" max="250" step="5" value="${r}"></label>
    <div class="muted">Tumregel: utsläppt lina eller kätting plus båtens längd, och lite marginal.</div>
    <div class="row"><button class="btn pri" id="an-here">Sätt ankare vid båten</button><button class="btn" id="an-cross">Vid korset</button></div>
    <div class="callout"><b>Viktigt:</b> larmet fungerar bara när Kummel är öppen och skärmen är tänd. Låser du telefonen eller byter app kan larmet inte gå. Sätt telefonen på laddning och stäng av ljudlöst läge, annars hörs inte larmet. Kummel ersätter inte ankarvakt.</div>`, "anchor");
  $("#an-r").oninput = e => {
    $("#an-rv").textContent = e.target.value + " m";
    if (S.anchor) { S.anchor.r = +e.target.value; save(); anchorDraw(); anchorBar(); }
  };
  if (S.anchor) {
    $("#an-show").onclick = () => map.easeTo({ center: lnglat(S.anchor), zoom: Math.max(map.getZoom(), 16) });
    $("#an-test").onclick = () => { unlockAudio(); beep(); setTimeout(beep, 600); try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch (e) {} };
    $("#an-off").onclick = () => { S.anchor = null; save(); anchorAlarm(false); anchorDist = null; anchorDraw(); anchorBar(); closeSheet(); toast("Ankarlarmet är avstängt", 1500); };
  } else {
    $("#an-here").onclick = () => {
      if (gps) return setAnchor(gps);
      startGps(); toast("Väntar på GPS-position …");
      const t0 = Date.now(), iv = setInterval(() => { if (gps) { clearInterval(iv); setAnchor(gps); } else if (Date.now() - t0 > 30000) { clearInterval(iv); toast("Ingen GPS-position. Prova igen eller sätt ankaret vid korset.", 4000); } }, 500);
    };
    $("#an-cross").onclick = () => setAnchor(ll(map.getCenter()));
  }
}
$("#aa-mute").onclick = () => { unlockAudio(); anchorMuteUntil = Date.now() + 60000; toast("Tyst i en minut. Larmet ljuder igen om båten fortfarande är utanför.", 3000); };
$("#aa-off").onclick = () => { anchorAlarm(false); anchorOut = 0; anchorMuteUntil = 0; openAnchor(); };
$("#anchorbar").onclick = openAnchor;

/* ---------- offlinekarta ----------
   Hela sjökortet (djup, sjömärken, stenar) för Åland sparas som filer i webbläsarens cache, plus
   landkartan för området man ser. Service workern läser sjökortsfilen ur cachen med range-anrop. */
const OFFLINE = "kummel-offline-v1";
const OFF_BIG = ["data/chart-aland.pmtiles", "data/rocks-aland.pmtiles", "data/lines-aland.pmtiles"];
const OFF_SMALL = ["data/fairways.json", "data/marks.geojson"].concat(
  ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"].flatMap(f => ["0-255", "256-511", "8192-8447"].map(r => `fonts/${f}/${r}.pbf`)));
const ALAND = { w: 19.0, s: 59.65, e: 21.35, n: 60.65 };
const abs = p => new URL(p, location.href).href;
function tileRange(b, z) {
  const n = 2 ** z, X = lng => Math.floor((lng + 180) / 360 * n);
  const Y = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  return { x0: Math.max(0, X(b.w)), x1: Math.min(n - 1, X(b.e)), y0: Math.max(0, Y(b.n)), y1: Math.min(n - 1, Y(b.s)) };
}
function landTiles(view) {
  const out = [];
  const push = (b, z0, z1) => { for (let z = z0; z <= z1; z++) { const r = tileRange(b, z); for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) out.push([z, x, y]); } };
  push(ALAND, 5, 11);
  push(view, 12, 14);
  const seen = new Set(); return out.filter(t => { const k = t.join("/"); if (seen.has(k)) return false; seen.add(k); return true; });
}
function viewBox() { const b = map.getBounds(); return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }; }
async function ofmTemplate() {
  const s = map.getSource("ofm"); if (s && s.tiles && s.tiles[0]) return s.tiles[0];
  const j = await (await fetch("https://tiles.openfreemap.org/planet")).json(); return j.tiles[0];
}
let offBusy = false;
async function downloadOffline(withChart) {
  if (offBusy) return; offBusy = true;
  const bar = () => $("#off-prog"), say = t => { const el = $("#off-msg"); if (el) el.textContent = t; };
  const prog = f => { const el = bar(); if (el) { el.hidden = false; el.value = f; } };
  try {
    if (!("caches" in window)) throw new Error("Webbläsaren saknar stöd för offlinelagring.");
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    const c = await caches.open(OFFLINE);
    let bytes = (S.offline && S.offline.bytes) || 0, etag = S.offline && S.offline.etag;
    if (withChart) {
      bytes = 0;
      for (let i = 0; i < OFF_BIG.length; i++) {
        const url = abs(OFF_BIG[i]);
        say(["Laddar ner sjökortet …", "Laddar ner stenar och grund …", "Laddar ner djupkurvor och branter …"][i]);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { if (i === 0) throw new Error("Kunde inte hämta sjökortet"); continue; }
        const total = +res.headers.get("Content-Length") || 0, rd = res.body.getReader(), parts = []; let got = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) prog((i + got / total) / (OFF_BIG.length + 1)); }
        const blob = new Blob(parts);
        if (i === 0) etag = res.headers.get("ETag") || "";
        await c.put(url, new Response(blob, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(blob.size), "ETag": res.headers.get("ETag") || "" } }));
        bytes += blob.size;
      }
      for (const p of OFF_SMALL) { try { const r = await fetch(abs(p), { cache: "no-store" }); if (r.ok) { const b = await r.clone().blob(); bytes += b.size; await c.put(abs(p), r); } } catch (e) {} }
    }
    try { const tj = "https://tiles.openfreemap.org/planet", r = await fetch(tj); if (r.ok) await c.put(tj, r); } catch (e) {}
    say("Laddar ner landkartan för området …");
    const tpl = await ofmTemplate(), tiles = landTiles(viewBox());
    let done = 0, i = 0;
    const work = async () => {
      while (i < tiles.length) {
        const [z, x, y] = tiles[i++], url = tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
        try {
          if (!(await c.match(url, { ignoreVary: true }))) { const r = await fetch(url); if (r.ok) { const b = await r.clone().blob(); bytes += b.size; await c.put(url, r); } }
        } catch (e) {}
        done++; prog((withChart ? OFF_BIG.length : 0) / (OFF_BIG.length + 1) + done / tiles.length / (withChart ? OFF_BIG.length + 1 : 1));
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    const areas = (S.offline && !withChart ? S.offline.areas : []) || [];
    areas.push(viewBox());
    S.offline = { date: Date.now(), bytes, etag, areas }; save();
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("offline-changed");
    toast("Offlinekartan är sparad", 2000);
    track("offline_saved", { mb: Math.round(bytes / 1048576), chart: withChart ? 1 : 0 });
  } catch (e) {
    toast("Nedladdningen misslyckades: " + (e.message || e), 4000);
  } finally { offBusy = false; if (sheetView === "offline") openOffline(); }
}
async function deleteOffline() {
  try { await caches.delete(OFFLINE); } catch (e) {}
  S.offline = null; save();
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("offline-changed");
  toast("Offlinekartan är borttagen", 1500); openOffline();
}
async function openOffline() {
  const o = S.offline, mb = n => (n / 1048576).toFixed(0) + " MB";
  const z = map.getZoom(), n = landTiles(viewBox()).length, tooBig = n > 6000;
  let est = "";
  try { const e = await navigator.storage.estimate(); est = `Använt för Kummel: ${mb(e.usage)}.`; } catch (e) {}
  openSheet("Offlinekarta", `
    <div>Spara sjökortet så att kartan fungerar utan täckning ute i skärgården. Sjökortet (djup, sjömärken, stenar och grund) sparas för hela Åland, landkartan i detalj för området du ser nu.</div>
    ${o ? `<div class="card"><h3>Sparad ${new Date(o.date).toLocaleDateString("sv-FI")}</h3><div class="muted">${mb(o.bytes)} · ${o.areas.length} område${o.areas.length === 1 ? "" : "n"} med detaljerad landkarta</div></div>` : ""}
    ${tooBig ? `<div class="callout">Zooma in lite för att spara landkartan för området. Det du ser är för stort (${n} kartbitar).</div>` : ""}
    <progress id="off-prog" max="1" value="0" hidden style="width:100%"></progress>
    <div class="muted" id="off-msg">${offBusy ? "Laddar ner …" : ""}</div>
    <div class="row">
      ${o ? `<button class="btn pri" id="off-add" ${tooBig ? "disabled" : ""}>Spara området du ser</button><button class="btn" id="off-upd">Uppdatera sjökortet</button><button class="btn warn" id="off-del">Ta bort</button>`
          : `<button class="btn pri" id="off-dl" ${tooBig ? "disabled" : ""}>Ladda ner (ca 80–120 MB)</button>`}
    </div>
    <div class="muted">Gör det helst på wifi. Väder, AIS och flygbild kräver fortfarande nät. På iPhone fungerar det bäst när Kummel ligger på hemskärmen, annars kan Safari rensa sparad data om appen inte används på ett tag. ${est}</div>`, "offline");
  if (o) { $("#off-add").onclick = () => downloadOffline(false); $("#off-upd").onclick = () => downloadOffline(true); $("#off-del").onclick = deleteOffline; }
  else $("#off-dl").onclick = () => downloadOffline(true);
}
/* finns ny sjökortsdata än den sparade? (en gång per start, bara med nät) */
if (S.offline && navigator.onLine) fetch(abs(OFF_BIG[0]), { method: "HEAD", cache: "no-store" }).then(r => {
  const et = r.headers.get("ETag"); if (et && S.offline.etag && et !== S.offline.etag) toast("Nytt sjökort finns. Uppdatera offlinekartan under Meny → Offlinekarta.", 5000);
}).catch(() => {});

/* ---------- dela rutt som länk ----------
   Rutten ryms i själva länken (efter #), så inget laddas upp någonstans.
   Punkterna packas som skillnader i 1/100 000 grad (ca 1 m) och kodas som base64url. */
function packRoute(r) {
  const out = []; let pl = 0, pg = 0;
  r.pts.forEach(([la, lo]) => { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); out.push(a - pl, b - pg); pl = a; pg = b; });
  const s = JSON.stringify({ i: r.id, n: r.name, p: out });
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unpackRoute(code) {
  const s = decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))));
  const o = JSON.parse(s), pts = []; let la = 0, lo = 0;
  for (let k = 0; k + 1 < o.p.length; k += 2) { la += o.p[k]; lo += o.p[k + 1]; pts.push([+(la / 1e5).toFixed(5), +(lo / 1e5).toFixed(5)]); }
  if (pts.length < 2) throw new Error("för få punkter");
  return { id: o.i || uid(), name: String(o.n || "Delad rutt").slice(0, 80), pts };
}
async function shareRoute(r) {
  const url = SITE_URL + "#rutt=" + packRoute(r), nm = routeStats(r.pts.map(p => ({ lat: p[0], lng: p[1] }))).nm.toFixed(1);
  const text = `Rutt i Kummel: ${r.name} (${nm} nm). Öppna länken så ser du den på sjökortet:`;
  track("route_shared", { points: r.pts.length });
  if (navigator.share) { try { await navigator.share({ title: r.name, text, url }); } catch (e) {} }
  else { try { await navigator.clipboard.writeText(text + " " + url); toast("Länken är kopierad. Klistra in den i ett meddelande.", 3500); } catch (e) { prompt("Kopiera länken:", url); } }
}
/* öppnas appen med #rutt=… visas rutten, och man kan spara den */
function openSharedRoute() {
  const m = /#rutt=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search);   // länken ska inte ligga kvar i adressfältet
  let r; try { r = unpackRoute(m[1]); } catch (e) { toast("Länken till rutten verkar vara trasig."); return false; }
  const have = S.routes.find(q => q.id === r.id), ll2 = r.pts.map(p => ({ lat: p[0], lng: p[1] })), nm = routeStats(ll2).nm.toFixed(1);
  const show = () => { setData("shown", lineFC(r.pts.map(p => [p[1], p[0]]))); const h = map.getContainer().clientHeight; map.fitBounds(boundsOf(r.pts), { padding: { top: 90, left: 40, right: 80, bottom: Math.round(h * .45) }, duration: 0 }); };
  if (mapReady) show(); else map.once("style.load", show);
  track("route_received");
  openSheet("Delad rutt", `
    <div class="card"><h3>${esc(r.name)}</h3><div class="muted">${nm} nm · ${r.pts.length} punkter</div></div>
    ${have ? `<div class="muted">Du har redan den här rutten sparad.</div>` : `<div class="muted">Någon har delat en rutt med dig. Spara den så finns den under Meny → Sparade rutter.</div>`}
    <div class="row">${have ? "" : `<button class="btn pri" id="sr-save">Spara rutten</button>`}<button class="btn" id="sr-open">Öppna i ruttplaneringen</button><button class="btn" id="sr-close">Stäng</button></div>
    <div class="muted">Kontrollera alltid rutten mot sjökortet och dagens förhållanden innan du kör den.</div>`, "sharedroute");
  const sv = $("#sr-save"); if (sv) sv.onclick = () => { S.routes.unshift({ ...r, created: Date.now(), from: "delad" }); save(); toast(`Rutten "${r.name}" är sparad`); closeSheet(); setData("shown", EMPTY); };
  $("#sr-open").onclick = () => { setData("shown", EMPTY); closeSheet(); startPlanning(ll2); if (S.routes.find(q => q.id === r.id)) routeId = r.id; routeName = r.name; renderRoute(); };
  $("#sr-close").onclick = () => { setData("shown", EMPTY); closeSheet(); };
  return true;
}
window.addEventListener("hashchange", () => { if (/#rutt=/.test(location.hash) && termsOk()) openSharedRoute(); });

/* ---------- vattenstånd (Meteorologiska institutet) ----------
   Mätvärde från närmaste mareograf (cm mot teoretiskt medelvattenstånd, samma nivå som farlederna
   på Åland), plus prognos för platsen. Sjökortets djup visas som vanligt; vattenståndet visas och
   räknas in i grundvarningar och djuprutan. */
const WL_STATIONS = [
  { id: 134252, name: "Degerby, Föglö", lat: 60.0317, lng: 20.3848 },
  { id: 134225, name: "Ruissalo, Åbo", lat: 60.4285, lng: 22.1009 },
  { id: 134253, name: "Hangö", lat: 59.8226, lng: 22.9766 },
  { id: 134224, name: "Raumo", lat: 61.1335, lng: 21.4255 }
];
let wlKey = "";
async function fmiSeries(url) {
  const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/xml"), out = {};
  for (const el of xml.getElementsByTagNameNS("*", "BsWfsElement")) {
    const n = el.getElementsByTagNameNS("*", "ParameterName")[0]?.textContent, v = parseFloat(el.getElementsByTagNameNS("*", "ParameterValue")[0]?.textContent);
    const t = Date.parse(el.getElementsByTagNameNS("*", "Time")[0]?.textContent);
    if (!isNaN(v) && t) (out[n] || (out[n] = [])).push({ t, v });
  }
  Object.values(out).forEach(s => s.sort((x, y) => x.t - y.t));
  return out;
}
async function loadWaterLevel(force) {
  if (!feat("wlevel")) { wl = null; renderWl(); return; }
  const c = gps && follow ? gps : ll(map.getCenter());
  const st = WL_STATIONS.map(s => ({ ...s, km: distNm(c, s) * 1.852 })).sort((x, y) => x.km - y.km)[0];
  const key = st.id + ":" + c.lat.toFixed(1) + c.lng.toFixed(1);
  if (!force && key === wlKey && wl && Date.now() - wl.at < 15 * 60000) return;
  const iso = ms => new Date(ms).toISOString().slice(0, 13) + ":00:00Z", base = "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=";
  try {
    const [o, f] = await Promise.all([
      fmiSeries(`${base}fmi::observations::mareograph::simple&fmisid=${st.id}&parameters=WATLEV&timestep=60&starttime=${iso(Date.now() - 30 * 3600000)}`),
      fmiSeries(`${base}fmi::forecast::sealevel::point::simple&latlon=${c.lat.toFixed(3)},${c.lng.toFixed(3)}&parameters=SeaLevel&timestep=60`).catch(() => ({}))
    ]);
    const obs = (o.WATLEV || []).map(p => ({ t: p.t, v: p.v / 10 }));   // mm -> cm
    const fc = (f.SeaLevel || []).filter(p => p.t > Date.now() - 3600000).slice(0, 48);
    const last = obs[obs.length - 1]; if (!last && !fc.length) throw new Error("inga data");
    const cm = last ? last.v : fc[0].v, prev = obs.find(p => p.t >= (last ? last.t : Date.now()) - 3 * 3600000);
    wl = { cm: Math.round(cm), at: Date.now(), t: last ? last.t : fc[0].t, station: st.name, km: st.km, obs, fc, trend: last && prev ? last.v - prev.v : null };
    wlKey = key;
  } catch (e) { if (!wl) { renderWl(); return; } }
  renderWl(); boatChanged();
  if (sheetView === "wlevel") openWaterLevel();
}
const fmtCm = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(Math.round(v)) + " cm";
function renderWl() {
  const el = $("#wlbar"); if (!el) return;
  el.classList.toggle("hidden", !feat("wlevel") || !wl);
  if (!wl) return;
  const tr = wl.trend == null ? "" : wl.trend > 1.5 ? " ↑" : wl.trend < -1.5 ? " ↓" : " →";
  el.innerHTML = `Vattenstånd <b>${fmtCm(wl.cm)}</b>${tr}`;
  el.classList.toggle("low", wl.cm <= -20); el.classList.toggle("high", wl.cm >= 30);
}
function wlChart() {
  const pts = [...wl.obs.map(p => ({ ...p, f: 0 })), ...wl.fc.filter(p => !wl.obs.length || p.t > wl.obs[wl.obs.length - 1].t).map(p => ({ ...p, f: 1 }))];
  if (pts.length < 2) return "";
  const W = 320, H = 130, t0 = pts[0].t, t1 = pts[pts.length - 1].t, vs = pts.map(p => p.v);
  const lo = Math.min(-20, ...vs) - 5, hi = Math.max(20, ...vs) + 5;
  const X = t => 8 + (t - t0) / (t1 - t0) * (W - 16), Y = v => 8 + (hi - v) / (hi - lo) * (H - 28);
  const path = f => pts.filter((p, i) => p.f === f || (f === 1 && pts[i + 1] && pts[i + 1].f === 1 && p.f === 0)).map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const now = X(Date.now()), ticks = [];
  for (let t = Math.ceil(t0 / 21600000) * 21600000; t < t1; t += 21600000) { const d = new Date(t); ticks.push(`<text x="${X(t)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${d.getHours() === 0 ? DAYS[d.getDay()] : pad(d.getHours())}</text>`); }
  return `<svg viewBox="0 0 ${W} ${H}" class="wl-chart">
    <line x1="8" x2="${W - 8}" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3"/>
    <text x="${W - 8}" y="${Y(0) - 3}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">medel</text>
    <path d="${path(0)}" fill="none" stroke="#1d6fa3" stroke-width="2.5"/>
    <path d="${path(1)}" fill="none" stroke="#1d6fa3" stroke-width="2" stroke-dasharray="4 3"/>
    ${now > 8 && now < W - 8 ? `<line x1="${now}" x2="${now}" y1="4" y2="${H - 18}" stroke="#d64545" stroke-width="1.5"/>` : ""}
    ${ticks.join("")}</svg>`;
}
function openWaterLevel() {
  if (!wl) { openSheet("Vattenstånd", `<div class="muted">Hämtar vattenstånd …</div>`, "wlevel"); loadWaterLevel(true); return; }
  const need = boatNeed(), eff = needDepth(), b = boat();
  const minF = wl.fc.length ? wl.fc.reduce((m, p) => p.v < m.v ? p : m) : null, maxF = wl.fc.length ? wl.fc.reduce((m, p) => p.v > m.v ? p : m) : null;
  const when = t => { const d = new Date(t); return `${d.toDateString() === new Date().toDateString() ? "i dag" : DAYS[d.getDay()]} ${pad(d.getHours())}:00`; };
  openSheet("Vattenstånd", `
    <div class="wl-big"><b>${fmtCm(wl.cm)}</b><span>${wl.cm < -3 ? "under" : wl.cm > 3 ? "över" : "nära"} medelvattenstånd${wl.trend != null ? ` · ${wl.trend > 1.5 ? "stiger" : wl.trend < -1.5 ? "sjunker" : "stabilt"}` : ""}</span></div>
    <div class="muted">Uppmätt i ${esc(wl.station)}${wl.km > 15 ? ` (${Math.round(wl.km)} km bort)` : ""}, kl ${hm(new Date(wl.t))}. Streckad linje är prognos.</div>
    ${wlChart()}
    ${minF ? `<div class="muted">Närmaste dygnen: lägst ${fmtCm(minF.v)} ${when(minF.t)}, högst ${fmtCm(maxF.v)} ${when(maxF.t)}.</div>` : ""}
    <div class="card"><h3>Vad betyder det?</h3><div class="muted">Djupen på sjökortet gäller medelvattenstånd. ${wl.cm < -3 ? `Just nu står vattnet ${Math.abs(wl.cm)} cm lägre, så alla grund är ${Math.abs(wl.cm)} cm grundare än kartan visar.` : wl.cm > 3 ? `Just nu står vattnet ${wl.cm} cm högre, så det är ${wl.cm} cm djupare än kartan visar.` : "Just nu stämmer kartans djup ganska väl."}</div></div>
    <label class="row"><input type="checkbox" id="wl-adj" ${S.wlAdjust !== false ? "checked" : ""}> Räkna med vattenståndet i grundvarningar och röd "för grunt"-färg</label>
    <div class="muted">${esc(b.name)} behöver ${need.toFixed(1).replace(".", ",")} m. ${S.wlAdjust !== false && Math.abs(wl.cm) >= 3 ? `Med dagens vattenstånd markeras allt grundare än <b>${eff.toFixed(1).replace(".", ",")} m på kartan</b>.` : ""}</div>
    <div class="disclaimer">Källa: Meteorologiska institutet. Vattenståndet kan variera lokalt, särskilt i trånga vikar och vid kraftig vind.</div>`, "wlevel");
  $("#wl-adj").onchange = e => { S.wlAdjust = e.target.checked; save(); boatChanged(); openWaterLevel(); };
}
setInterval(() => loadWaterLevel(), 15 * 60000);

/* ---------- strömmande vind (partiklar som flyter med vinden, som på Windy) ---------- */
let flowRAF = null, flowParts = [], flowField = null, flowCv = null;
function windField() {   // vind per skärmruta (px/bildruta), interpolerad mellan prognospunkterna
  if (!wxGrid || !wxGrid.pts.length) return null;
  const i = wxGrid.t0 + wxStep, br = map.getBearing() * Math.PI / 180, P = [];
  wxGrid.pts.forEach((p, k) => { const h = wxGrid.F[k]?.hourly; if (!h || h.wind_speed_10m[i] == null) return;
    const s = map.project([p.lng, p.lat]), w = h.wind_speed_10m[i], th = ((h.wind_direction_10m[i] + 180) % 360) * Math.PI / 180 - br;
    P.push({ x: s.x, y: s.y, u: Math.sin(th) * w, v: -Math.cos(th) * w, w }); });
  if (!P.length) return null;
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight, G = 24, cols = Math.ceil(W / G) + 1, rows = Math.ceil(H / G) + 1, U = new Float32Array(cols * rows), V = new Float32Array(cols * rows), S2 = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    let su = 0, sv = 0, sw = 0, ws = 0; const x = q * G, y = r * G;
    for (const p of P) { const d = (p.x - x) ** 2 + (p.y - y) ** 2 + 400, k = 1 / d; su += p.u * k; sv += p.v * k; ws += p.w * k; sw += k; }
    U[r * cols + q] = su / sw; V[r * cols + q] = sv / sw; S2[r * cols + q] = ws / sw;
  }
  return { W, H, G, cols, rows, U, V, S: S2, at: (x, y) => { const q = Math.max(0, Math.min(cols - 1, Math.round(x / G))), r = Math.max(0, Math.min(rows - 1, Math.round(y / G))), j = r * cols + q; return [U[j], V[j], S2[j]]; } };
}
function flowColor(w) { const lim = boat().maxWind || 10; return w > lim ? "255,110,110" : w > lim * .75 ? "255,214,102" : "255,255,255"; }
function flowStart() {
  flowStop();
  if (!wxOn || wxMode !== "flow" || document.hidden) return;
  flowField = windField(); if (!flowField) return;
  if (!flowCv) { flowCv = document.createElement("canvas"); flowCv.id = "flowcv"; map.getContainer().appendChild(flowCv); }
  const dpr = Math.min(2, window.devicePixelRatio || 1), F = flowField;
  flowCv.width = F.W * dpr; flowCv.height = F.H * dpr; flowCv.style.width = F.W + "px"; flowCv.style.height = F.H + "px"; flowCv.style.display = "block";
  const g = flowCv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = "round";
  const N = Math.round(Math.min(1800, F.W * F.H / 380)), spawn = p => { p.x = Math.random() * F.W; p.y = Math.random() * F.H; p.age = 0; p.life = 40 + Math.random() * 70; return p; };
  flowParts = Array.from({ length: N }, () => spawn({}));
  const k = .22 * Math.pow(2, Math.max(0, 12 - map.getZoom()) * .15);   // px per (m/s) och bildruta
  const step = () => {
    g.globalCompositeOperation = "destination-in"; g.fillStyle = "rgba(0,0,0,.92)"; g.fillRect(0, 0, F.W, F.H);
    g.globalCompositeOperation = "source-over"; g.lineWidth = 1.4;
    for (const p of flowParts) {
      const [u, v, w] = F.at(p.x, p.y), nx = p.x + u * k, ny = p.y + v * k;
      g.strokeStyle = `rgba(${flowColor(w)},${Math.min(.85, .25 + w / 18)})`;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(nx, ny); g.stroke();
      p.x = nx; p.y = ny;
      if (++p.age > p.life || nx < 0 || ny < 0 || nx > F.W || ny > F.H) spawn(p);
    }
    flowRAF = requestAnimationFrame(step);
  };
  flowRAF = requestAnimationFrame(step);
}
function flowStop() { if (flowRAF) cancelAnimationFrame(flowRAF); flowRAF = null; if (flowCv) { flowCv.getContext("2d").clearRect(0, 0, flowCv.width, flowCv.height); flowCv.style.display = "none"; } }
map.on("movestart", flowStop);
map.on("moveend", () => { if (wxOn) { flowStart(); if (wxMode === "water") renderWxLayer(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden) flowStop(); else if (wxOn) flowStart(); });
window.addEventListener("resize", () => { if (wxOn) flowStart(); });


/* ---------- lovande fiskeplatser (per art) ----------
   Kartan i bild provas i ett rutnät. För varje punkt läses djupet, om det finns brant, stenar och land
   i närheten, och om vinden blåser in mot land där. Varje art har sin profil; de bästa punkterna
   (med avstånd emellan) visas med en förklaring. Ingen garanti: tumregler, inte facit. */
const SPOT_SP = {
  "Havsöring": { d: [0.5, 5], best: [1, 4], rocks: 14, shore: 10, onshore: 16, steep: 4, shelter: 0, temp: [3, 13], months: [10, 11, 12, 1, 2, 3, 4, 5], why: "grunda steniga stränder och uddar där vinden blåser in" },
  "Abborre":   { d: [2, 10], best: [3, 8], rocks: 5, shore: 4, onshore: 0, steep: 16, shelter: 6, temp: [8, 22], months: [5, 6, 7, 8, 9, 10], why: "kanter och branter på 3–8 m, gärna lite i lä" },
  "Gädda":     { d: [0.5, 4], best: [1, 3], rocks: 0, shore: 6, onshore: -6, steep: 4, shelter: 14, temp: [6, 18], months: [4, 5, 6, 9, 10, 11], why: "grunda skyddade vikar och flador" },
  "Gös":       { d: [6, 20], best: [8, 15], rocks: 2, shore: 0, onshore: 0, steep: 18, shelter: 0, temp: [12, 22], months: [6, 7, 8, 9], why: "djupare kanter och branter, gärna i skymningen" }
};
let spotMarkers = [];
function clearSpots() { spotMarkers.forEach(m => m.remove()); spotMarkers = []; }
function depthLayer() { return ["q-depare", "depare", "depare-sat"].find(l => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none"); }
function sampleDepth(pt, L) { const h = map.queryRenderedFeatures(pt, { layers: [L] }); if (!h.length) return null; const p = h[0].properties; return { d1: +p.d1, d2: p.d2 != null ? +p.d2 : null }; }
function findSpots(sp) {
  const P = SPOT_SP[sp], L = depthLayer(); if (!L) return { err: "Byt till sjökort eller flygfoto för att hitta platser." };
  if (map.getZoom() < 11) return { err: "Zooma in lite, så att ett område på några kilometer syns." };
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight, step = Math.max(26, Math.round(Math.min(W, H) / 22));
  const mPerPx = 40075016 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
  const near = Math.max(6, Math.round(60 / mPerPx));   // ca 60 m runt punkten
  const windFrom = wx ? wx.current.wind_direction_10m : null, windV = wx ? wx.current.wind_speed_10m : 0;
  const sst = sstInfo(), month = new Date().getMonth() + 1;
  const steepL = map.getLayer("q-steep") ? "q-steep" : "steep", rockL = map.getLayer("q-rocks") ? "q-rocks" : "rocks";
  const steepOn = !!map.getLayer(steepL), rockOn = !!map.getLayer(rockL);
  const mine = S.catches.filter(x => x.species === sp);
  const cands = [];
  for (let y = 140; y < H - 160; y += step) for (let x = 20; x < W - 70; x += step) {
    const dp = sampleDepth([x, y], L); if (!dp || dp.d1 < 0) continue;
    const mid = dp.d2 != null ? (dp.d1 + dp.d2) / 2 : dp.d1 + 2;
    if (mid < P.d[0] - .5 || dp.d1 > P.d[1]) continue;
    let s = 0; const why = [];
    const inBest = mid >= P.best[0] && mid <= P.best[1]; s += inBest ? 30 : 15;
    why.push(`${dp.d1}${dp.d2 != null ? "–" + dp.d2 : "+"} m djup`);
    // land runt om, mätt i verkliga kompassriktningar (fungerar även när kartan är vriden)
    const here = map.unproject([x, y]);
    const landAt = (brg, m) => { const q = map.project(lnglat(dest(here, (brg + 360) % 360, m / NM))); if (q.x < 0 || q.y < 0 || q.x > W || q.y > H) return null; const d = sampleDepth([q.x, q.y], L); return !d || d.d1 < 0; };
    const landDir = (brg, dists, spread) => [-spread, 0, spread].some(o => dists.some(m => landAt(brg + o, m) === true));
    const land = []; for (let k = 0; k < 8; k++) if (landAt(k * 45, 120) === true) land.push(k * 45);
    if (land.length && P.shore) { s += P.shore; }
    if (land.length >= 4 && P.shelter) { s += P.shelter; why.push("skyddat läge"); }
    if (windFrom != null && land.length && land.length < 6 && windV >= 3) {
      const to = (windFrom + 180) % 360;
      // pålandsvind: land strax nedströms OCH öppet vatten uppströms (vinden har fått fart över vattnet)
      const downLand = landDir(to, [60, 120, 200], 25), upLand = landDir(windFrom, [150, 400, 800], 20);
      const onshore = downLand && !upLand, lee = !downLand && landDir(windFrom, [80, 160, 300], 20);
      if (onshore && P.onshore > 0) { s += P.onshore * Math.min(1, windV / 8); why.push("vinden blåser in mot land här"); }
      if (onshore && P.onshore < 0) s += P.onshore;
      if (lee && P.shelter) { s += P.shelter / 2; why.push("i lä för vinden"); }
    }
    if (steepOn && P.steep) { const st = map.queryRenderedFeatures([[x - near, y - near], [x + near, y + near]], { layers: [steepL] }); if (st.length) { s += P.steep; why.push("brant kant"); } }
    if (rockOn && P.rocks) { const rk = map.queryRenderedFeatures([[x - near, y - near], [x + near, y + near]], { layers: [rockL] }).length; if (rk >= 2) { s += Math.min(P.rocks, rk * 3); why.push("stenig botten"); } }
    if (mine.some(m => distNm(m, map.unproject([x, y])) * NM < 400)) { s += 12; why.push(`du har fått ${sp.toLowerCase()} här förut`); }
    cands.push({ x, y, s, why });
  }
  if (!cands.length) return { err: `Inget vatten med rätt djup för ${sp.toLowerCase()} här. Flytta kartan eller zooma ut lite.` };
  cands.sort((p, q) => q.s - p.s);
  const pick = [], minD = Math.min(W, H) / 4.5;
  for (const p of cands) { if (pick.every(q => Math.hypot(q.x - p.x, q.y - p.y) > minD)) pick.push(p); if (pick.length >= 5) break; }
  const notes = [];
  if (!P.months.includes(month)) notes.push(`Det är inte högsäsong för ${sp.toLowerCase()} just nu.`);
  if (sst && sst.v != null && (sst.v < P.temp[0] || sst.v > P.temp[1])) notes.push(`Vattnet (${sst.v.toFixed(1).replace(".", ",")}°) är ${sst.v < P.temp[0] ? "kallare" : "varmare"} än ${sp.toLowerCase()} brukar föredra.`);
  return { spots: pick.map(p => ({ ...map.unproject([p.x, p.y]), s: p.s, why: p.why })), notes };
}
function openSpots() {
  const sp = S.spotSp || "Havsöring";
  openSheet("Lovande platser", `
    <div class="row">${Object.keys(SPOT_SP).map(k => `<button class="btn ${k === sp ? "pri" : ""}" data-sp="${k}">${k}</button>`).join("")}</div>
    <div class="muted">${esc(SPOT_SP[sp].why[0].toUpperCase() + SPOT_SP[sp].why.slice(1))}. Söker i området du ser på kartan.</div>
    <div id="sp-out" class="list"><div class="muted">Letar …</div></div>
    ${feat("drift") ? `<button class="btn" id="sp-drift">Planera drift</button>` : ""}
    <div class="disclaimer">Förslagen bygger på tumregler, djupdata och dagens väder, inte på var det faktiskt finns fisk. Respektera fredningsområden och regler.</div>`, "spots");
  document.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => { S.spotSp = b.dataset.sp; save(); openSpots(); });
  const dr = $("#sp-drift"); if (dr) dr.onclick = () => openDrift();
  setTimeout(() => {
    clearSpots(); const r = findSpots(sp), out = $("#sp-out"); if (!out) return;
    if (r.err) { out.innerHTML = `<div class="muted">${r.err}</div>`; return; }
    track("spots", { sp });
    out.innerHTML = (r.notes.length ? `<div class="callout">${r.notes.join(" ")}</div>` : "") + r.spots.map((p, i) => `<div class="card spot"><h3><span class="spot-n">${i + 1}</span> ${p.why.slice(1).join(", ") || "rätt djup"}</h3><div class="muted">${p.why[0]}</div><div class="row"><button class="btn sm" data-go="${i}">Visa</button><button class="btn sm" data-save="${i}">Spara som plats</button></div></div>`).join("");
    r.spots.forEach((p, i) => { const el = document.createElement("div"); el.className = "spot-pin"; el.textContent = i + 1; el.onclick = ev => { ev.stopPropagation(); map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) }); };
      spotMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map)); });
    document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { const p = r.spots[+b.dataset.go]; map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) }); });
    document.querySelectorAll("[data-save]").forEach(b => b.onclick = () => { const p = r.spots[+b.dataset.save]; S.places.push({ id: uid(), created: Date.now(), lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), cat: "fiske", name: `${sp}: ${p.why.slice(1).join(", ") || "förslag"}`.slice(0, 60), note: p.why.join(", ") }); save(); drawPlaces(); toast("Sparad under Mina platser", 1500); });
  }, 60);
}

/* ---------- driftplanering ----------
   Båten driver ungefär åt det håll vinden blåser, med en fart som är en liten andel av vinden.
   Appen lär sig din båts andel från dina egna drifter (GPS när du ligger och driver). */
const DRIFT_K0 = .035;   // drivfart = 3,5 % av vindfarten, typiskt för en mindre motorbåt
const driftK = () => S.driftK || DRIFT_K0;
let driftFrom = null, driftOn = false;
function driftCalc(from) {
  if (!wx) return null;
  const w = wx.current.wind_speed_10m, dirTo = (wx.current.wind_direction_10m + 180) % 360, kn = w * driftK() * KN;
  const L = depthLayer(), pts = [];
  for (const m of [0, 10, 20, 30]) { const p = dest(from, dirTo, kn * m / 60), dp = L ? sampleDepth(map.project([p.lng, p.lat]), L) : null; pts.push({ m, ...p, dp }); }
  return { w, dirTo, kn, pts };
}
function driftDraw() {
  if (!driftOn) return;
  const from = driftFrom || ll(map.getCenter()), r = driftCalc(from), out = $("#dr-out");
  if (!r) { if (out) out.innerHTML = `<div class="muted">Hämtar vind …</div>`; return; }
  setData("drift", lineFC(r.pts.map(p => [p.lng, p.lat])));
  setData("driftpts", { type: "FeatureCollection", features: r.pts.slice(1).map(p => ({ type: "Feature", properties: { lbl: `${p.m} min${p.dp ? " · " + p.dp.d1 + (p.dp.d2 != null ? "–" + p.dp.d2 : "+") + " m" : ""}` }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) });
  if (!out) return;
  const dist = Math.round(r.kn * .5 * NM), sp = S.spotSp, P = sp && SPOT_SP[sp];
  const inBand = P ? r.pts.filter(p => p.dp && p.dp.d1 <= P.d[1] && (p.dp.d2 ?? p.dp.d1 + 2) >= P.d[0]).length : 0;
  out.innerHTML = `<div>Med <b>${Math.round(r.w)} m/s</b> från ${compass((r.dirTo + 180) % 360)} driver du ca <b>${r.kn.toFixed(1).replace(".", ",")} kn</b> mot ${compass(r.dirTo)}. Om 30 min är du ungefär ${dist} m bort.</div>
    <div class="drift-prof">${r.pts.map(p => `<div><span class="muted">${p.m ? p.m + " min" : "start"}</span><b>${p.dp ? (p.dp.d1 < 0 ? "land" : p.dp.d1 + (p.dp.d2 != null ? "–" + p.dp.d2 : "+") + " m") : "?"}</b></div>`).join("")}</div>
    ${P ? `<div class="muted">${inBand >= 3 ? `Driften håller sig på ${sp.toLowerCase()}djup större delen av tiden.` : `Driften lämnar ${sp.toLowerCase()}djupet (${P.d[0]}–${P.d[1]} m) en bit av vägen.`}</div>` : ""}
    ${r.pts.some(p => p.dp && p.dp.d1 < 0) ? `<div class="callout bad">Driften når land eller torrfallande inom 30 min.</div>` : ""}
    <div class="muted" style="font-size:12px">${S.driftN >= 3 ? `Anpassad efter ${S.driftN} av dina egna drifter.` : "Uppskattning för en mindre båt. Appen lär sig din båt när du driver med GPS:en på."}</div>`;
}
function openDrift() {
  driftOn = true; driftFrom = null; clearSpots();
  openSheet("Drift", `
    <div class="callout">Flytta kartan så att <b>korset</b> står där du vill börja driva. Linjen visar var du är efter 10, 20 och 30 minuter.</div>
    <div id="dr-out"></div>
    <div class="row">${gps ? `<button class="btn" id="dr-gps">Från båten</button>` : ""}<button class="btn" id="dr-close">Klar</button></div>`, "drift");
  setSheetState($("#sheet"), 1);
  document.body.classList.add("plan");
  const g = $("#dr-gps"); if (g) g.onclick = () => { driftFrom = ll(gps); map.easeTo({ center: lnglat(gps) }); driftDraw(); };
  $("#dr-close").onclick = () => closeSheet();
  track("drift_plan");
  if (!wx) loadWx(true).then(driftDraw); else driftDraw();
}
function driftOff() { driftOn = false; driftFrom = null; setData("drift", EMPTY); setData("driftpts", EMPTY); document.body.classList.remove("plan"); }
map.on("move", () => { if (driftOn && !driftFrom) driftDraw(); });
map.on("moveend", () => { if (driftOn) driftDraw(); });
/* lär sig båtens drift: låg fart, rörelse ungefär med vinden, i minst 2 minuter */
let driftObs = null;
function learnDrift(pos, sog, cog) {
  if (!wx || sog < .15 || sog > 1.6 || cog == null) { driftObs = null; return; }
  const w = wx.current.wind_speed_10m, to = (wx.current.wind_direction_10m + 180) % 360;
  if (w < 3 || Math.abs(angDiff(cog, to)) > 45) { driftObs = null; return; }
  if (!driftObs) { driftObs = { t: Date.now(), k: [] }; }
  driftObs.k.push(sog / KN / w);
  if (Date.now() - driftObs.t > 120000 && driftObs.k.length > 20) {
    const k = driftObs.k.sort((x, y) => x - y)[driftObs.k.length >> 1];
    if (k > .005 && k < .12) { S.driftK = S.driftK ? S.driftK * .7 + k * .3 : k; S.driftN = (S.driftN || 0) + 1; save(); }
    driftObs = null;
  }
}
function featChanged(f) {
  if (f === "hotspots" || f === "drift") { const on = S.mode === "fiske" && (feat("hotspots") || feat("drift")); $("#b-spots").classList.toggle("hidden", !on); if (!feat("hotspots")) clearSpots(); if (!feat("drift") && sheetView === "drift") closeSheet(); }
}

/* ---------- teckenförklaring ---------- */
function openLegend() {
  const P = KummelChart.dayColors(), ic = id => `<span class="lg-ic"><img src="${KummelChart.iconURL(id)}" alt=""></span>`;
  const sw = (c, b) => `<span class="lg-ic"><i style="background:${c};${b ? `border:${b}` : ""}"></i></span>`;
  const ln = (c, dash, w = 3) => `<span class="lg-ic"><svg viewBox="0 0 36 12"><line x1="2" y1="6" x2="34" y2="6" stroke="${c}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""} stroke-linecap="round"/></svg></span>`;
  const row = (i, t, d) => `<div class="lg-row">${i}<div><b>${t}</b>${d ? `<div class="muted">${d}</div>` : ""}</div></div>`;
  const need = needDepth().toFixed(1).replace(".", ",");
  openSheet("Teckenförklaring", `
    <div class="card"><h3>Sjömärken</h3>
      ${row(ic("aid-port"), "Babordsmärke (rött)", "Lämnas till vänster (babord) när du följer farledens riktning, som i regel går från havet in mot land eller hamn. Åt andra hållet: till höger.")}
      ${row(ic("aid-stbd"), "Styrbordsmärke (grönt)", "Lämnas till höger (styrbord) i farledens riktning, alltså på väg in mot land.")}
      ${row(ic("aid-n"), "Nordprick", "Säkert vatten norr om märket.")}
      ${row(ic("aid-s"), "Sydprick", "Säkert vatten söder om märket.")}
      ${row(ic("aid-e"), "Ostprick", "Säkert vatten öster om märket.")}
      ${row(ic("aid-w"), "Västprick", "Säkert vatten väster om märket.")}
      ${row(ic("aid-iso"), "Grundmärke", "En enstaka fara precis vid märket. Håll avstånd runt om.")}
      ${row(ic("aid-safe"), "Mittledsmärke", "Säkert vatten runt märket, ofta mitt i en farled.")}
      ${row(ic("aid-spec"), "Specialmärke (gult)", "Till exempel kabel, rörledning, gräns eller område.")}
      ${row(ic("light"), "Fyr eller ljus", "Tryck för att se ljusets karaktär.")}
      ${row(ln(P.yellow, "", 5) + "", "Ljussektorer", "Vit: den säkra sektorn, oftast farleden. Röd eller grön: utanför den säkra sektorn.")}
      ${row(ic("fault"), "Fel på sjömärke", "Ett märke i närheten är ur funktion eller borta enligt Väylävirasto.")}
      ${row(ic("sign"), "Vattentrafikmärke", "Förbud, fartgräns eller anvisning. Tryck på märket för mer.")}
    </div>
    <div class="card"><h3>Stenar och grund</h3>
      ${row(ic("rock-under"), "Sten under vattnet", "Syns inte. Gå inte nära.")}
      ${row(ic("rock-awash"), "Sten i vattenytan", "Syns ibland, beroende på vattenstånd och vågor.")}
      ${row(ic("rock-dry"), "Sten ovanför vattnet", "Kobbe eller sten som syns.")}
      ${row(sw(P.unsafe, "1px dashed #111"), "Område med många stenar", "Inramat med prickad linje.")}
    </div>
    <div class="card"><h3>Djup på sjökortet</h3>
      ${row(sw(P.unsafe), `Grundare än ${need} m`, "Grundare än din båts djupgående plus säkerhetsmarginal.")}
      ${row(sw(P.d0, "1px solid #9cc"), "Grunt, till 3 m")}
      ${row(sw(P.d3, "1px solid #9cc"), "3–6 m")}
      ${row(sw(P.d6, "1px solid #9cc"), "6–10 m")}
      ${row(sw(P.d10, "1px solid #9cc"), "Över 10 m")}
      ${row(sw(P.drying), "Torrfallande", "Under vatten bara vid högt vattenstånd.")}
      ${row(ln(P.contour, "", 2), "Djupkurva", "Siffran visar djupet i meter.")}
      ${row(ln("#ff6a00", "", 4), "Brant (läget Fiske)", "Djupet ökar snabbt. Ofta bra fiskeställen.")}
    </div>
    <div class="card"><h3>Farleder och områden</h3>
      ${row(ln(P.nav, "", 2.5), "Farled", "Siffran (t.ex. 2,4 m) är farledens djupgående.")}
      ${row(ln(P.nav, "6 3", 1.5), "Ensmärkeslinje", "Linjen mellan två ensmärken som visar farledens riktning.")}
      ${row(ln(P.magenta, "2 3", 2), "Fartbegränsning", "Siffran i km/h.")}
      ${row(ln(P.magenta, "6 4", 2), "Förbud eller begränsning", "Till exempel ankringsförbud eller mötesförbud.")}
    </div>
    <div class="card"><h3>Ditt och appens</h3>
      ${row(`<span class="lg-ic"><svg viewBox="0 0 34 34" width="22" height="22"><path d="M17 3 25 29 17 24 9 29Z" fill="#d64545" stroke="#fff" stroke-width="2"/></svg></span>`, "Din båt", "Linjen framför visar vart du är på väg de närmaste 10 minuterna.")}
      ${row(ln("#d64545", "4 3", 3), "Rutt", "Orange del: utanför farlederna.")}
      ${row(`<span class="lg-ic"><i style="background:#f2c14e;border:2px solid #1b1500;border-radius:50% 40% 40% 50%"></i></span>`, "Fångst (läget Fiske)")}
      ${row(`<span class="lg-ic"><i style="background:#fff;border:2px solid #0b1620;border-radius:50%"></i></span>`, "AIS-fartyg", "Färgen visar typ: rosa passagerare, grön last, röd tank, orange fiske, lila segel, gul fritid.")}
    </div>`, "legend");
}

/* ---------- statistik (Google Analytics 4) ----------
   Laddas bara om ett mät-ID finns i config.js OCH användaren har sagt ja (S.stats === 1).
   Inga positioner, namn eller fångstdetaljer skickas, bara vilka funktioner som används. */
const GA_ID = (window.KUMMEL_CONFIG && KUMMEL_CONFIG.gaId) || "";
let gaOn = false;
function statsOn() {
  if (gaOn || !GA_ID || S.stats !== 1) return;
  gaOn = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag("js", new Date());
  gtag("config", GA_ID, {
    allow_google_signals: false, allow_ad_personalization_signals: false,
    app_mode: S.mode, display_mode: matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "hemskarm" : "webblasare",
    theme: S.theme || "day"
  });
  const s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
}
function setStats(on) {
  S.stats = on ? 1 : 0; save();
  if (on) statsOn();
  else if (gaOn) { try { gtag("consent", "update", { analytics_storage: "denied" }); } catch (e) {} document.cookie.split(";").forEach(k => { const n = k.split("=")[0].trim(); if (/^_ga/.test(n)) document.cookie = n + "=; Max-Age=0; path=/; domain=." + location.hostname.replace(/^www\./, ""); }); }
}
/* track("namn", {…}): en händelse i statistiken. Gör ingenting utan samtycke. */
function track(name, params) { if (gaOn && window.gtag) { try { gtag("event", name, params || {}); } catch (e) {} } }
/* fråga en gång (när statistik finns och villkoren är godkända) */
function askStats() {
  if (!GA_ID || S.stats === 0 || S.stats === 1 || !termsOk() || $("#statsask")) return;
  const d = document.createElement("div"); d.id = "statsask";
  d.innerHTML = `<div><b>Får Kummel räkna besök?</b><div class="muted">Anonym statistik över vilka funktioner som används hjälper oss att göra Kummel bättre. Inga positioner eller fångster skickas. Du kan ändra dig under Om Kummel.</div></div>
    <div class="row"><button class="btn pri" id="sa-yes">Ja, gärna</button><button class="btn" id="sa-no">Nej tack</button></div>`;
  document.body.appendChild(d);
  $("#sa-yes").onclick = () => { setStats(true); d.remove(); };
  $("#sa-no").onclick = () => { setStats(false); d.remove(); };
}

/* ---------- välkomstruta första gången ---------- */
const TERMS_V = 1;   // höj när villkoren ändras, så måste alla godkänna på nytt
function termsOk() { return S.termsOk >= TERMS_V; }
/* rundtur: vad knapparna gör (Meny → Så fungerar Kummel, eller länken i välkomstrutan) */
function openTour() {
  const ic = id => `<span class="wl-ic${id === "#b-fish" ? " fish" : ""}">${$(id).querySelector("svg").outerHTML}</span>`;
  const row = (id, txt) => `<div class="wl-row">${ic(id)}<div>${txt}</div></div>`;
  openSheet("Så fungerar Kummel", `
    <div class="home-line">${ALAND_FLAG}<div>Välj <b>Båttur</b> eller <b>Fiske</b> uppe till vänster. Rutan uppe till höger visar vinden, tryck på den för hela vädret.</div></div>
    <div class="wl">
      ${row("#b-locate", "<b>Min position.</b> Ett tryck: kartan följer båten. Två tryck: kurs upp.")}
      ${row("#b-route", "<b>Planera rutt.</b> Välj start och mål, så föreslås en väg längs farlederna med ankomsttid.")}
      ${row("#b-wx", "<b>Sjöväder.</b> Vind, vågor och vattentemperatur över kartan, nu och framåt.")}
      ${row("#b-layers", "<b>Kartlager.</b> Sjökort, flygbild, AIS-fartyg med mera.")}
      ${row("#b-menu", "<b>Meny.</b> Båtar, sparade platser och rutter, loggbok, fångstlogg och offlinekarta.")}
      ${row("#b-night", "<b>Nattläge.</b> Mörk karta eller rött ljus för kvällen.")}
    </div>
    <div class="card"><h3>Fiske</h3><div class="wl">
      ${row("#b-fish", "<b>Fisk!</b> Ett tryck när du får napp sparar plats, tid, väder och vattentemperatur. Lägg till art, storlek och foto när du har tid, och dela fångsten som bild.")}
      ${row("#b-spots", "<b>Lovande platser och drift.</b> Välj art så föreslås platser efter djup, branter, stenar och vind. Se också hur båten driver från en plats.")}
    </div><div class="muted" style="margin-top:6px">Finns i läget <b>Fiske</b>. Där ser du också branta kanter och ett fiskeläge efter väder, tryck och måne.</div></div>
    <div class="muted">Håll fingret på kartan för att spara en plats. Kummel finns alltid på <b>${SITE}</b>. Lägg till den på hemskärmen (Dela → Lägg till på hemskärmen) så öppnas den som en app.</div>
    <div class="row"><button class="btn" id="tr-close">Stäng</button></div>`, "tour");
  setSheetState($("#sheet"), 2);
  $("#tr-close").onclick = closeSheet;
}
/* välkomstruta: villkor, din båt, kom igång. Knappförklaringarna finns i rundturen. */
function openWelcome() {
  const must = !termsOk(), b = boat();
  openSheet("Välkommen till Kummel", `
    <div class="home-line">${ALAND_FLAG}<div>Sjökort, sjöväder och rutter för hela Åland och skärgården mot Åboland, från Eckerö i väster till Brändö och Kökar i öster.</div></div>
    <div class="warnbox"><b>Kummel är inte ett sjökort för navigering.</b> Appen är ett hjälpmedel för planering och överblick, inte certifierad för navigering. Djup, sjömärken, ruttförslag, ankomsttider och väder kan vara felaktiga, ofullständiga eller inaktuella. Använd alltid officiella, uppdaterade sjökort och gott sjömanskap. Du som förare ansvarar själv för navigeringen och för båtens säkerhet. Kummel tillhandahålls av AsterIQ Ab (Mariehamn, FO-nummer 3553529-1) gratis och i befintligt skick, utan garantier.</div>
    <div class="card"><h3>Din båt</h3>
      <div class="muted">Med djupgåendet markeras vatten som är för grunt för just din båt.</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:6px">
        <label class="f" style="flex:1;min-width:130px">Båttyp<select id="wl-btype">${Object.entries(BTYPES).map(([k, v]) => `<option value="${k}" ${b.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="f" style="flex:1;min-width:130px">Djupgående (m)<input id="wl-draft" type="number" inputmode="decimal" min="0" max="5" step="0.1" value="${b.draft}"></label>
      </div>
      <div class="muted" style="margin-top:4px">Mer om båten under Meny → Båtar.</div>
    </div>
    ${must ? `<div class="muted"><b>Genom att trycka på en knapp nedan bekräftar du att du har läst och förstått texten ovan.</b></div>` : ""}
    <div class="row"><button class="btn pri" id="wl-go">${must ? "Jag förstår – visa min position" : "Visa min position"}</button><button class="btn" id="wl-skip">${must ? "Jag förstår – bara kartan" : "Stäng"}</button></div>
    ${must ? "" : `<button class="btn" id="wl-tour" style="align-self:flex-start">Så fungerar knapparna</button>`}`, "welcome");
  setSheetState($("#sheet"), 2);
  $("#sheet").classList.toggle("locked", must); document.body.classList.toggle("terms", must);
  const ok = () => { const first = !termsOk(); S.termsOk = TERMS_V; S.welcomed = 1; save(); if (first) { setTimeout(() => toast("Tips: Meny → Så fungerar Kummel visar vad knapparna gör", 3500), 2500); setTimeout(askStats, 7000); } setTimeout(openSharedRoute, 400); $("#sheet").classList.remove("locked"); document.body.classList.remove("terms"); };
  $("#wl-btype").onchange = e => { boat().type = e.target.value; save(); };
  $("#wl-draft").onchange = e => { const v = parseFloat(String(e.target.value).replace(",", ".")); if (v >= 0 && v <= 5) { boat().draft = v; save(); boatChanged(); } };
  $("#wl-go").onclick = () => { ok(); closeSheet(); $("#b-locate").click(); };
  $("#wl-skip").onclick = () => { ok(); closeSheet(); };
  const t = $("#wl-tour"); if (t) t.onclick = openTour;
}
$("#nonav").onclick = openWelcome;

/* ---------- night mode ---------- */
const THEMES = { day: "Dagläge", dark: "Nattläge: mörk karta", red: "Nattläge: rött ljus" };
function applyTheme(rebuild) {
  const t = S.theme || "day";
  if (t === "day") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = "dark";
  document.body.classList.toggle("night", t === "red");
  $("#b-night").setAttribute("aria-pressed", t !== "day");
  document.querySelector('meta[name="theme-color"]').content = t === "day" ? "#0f2a3d" : "#05101a";
  if (rebuild) { KummelChart.setTheme(t === "day" ? "day" : "dark"); map.setStyle(baseStyle(), { diff: false }); }
}
$("#b-night").onclick = () => {
  S.theme = { day: "dark", dark: "red", red: "day" }[S.theme || "day"]; save();
  applyTheme(true); toast(THEMES[S.theme], 1500);
};
applyTheme(false);

/* ---------- knapparna växlar: tryck igen så stängs panelen ---------- */
["#b-layers", "#b-menu", "#b-place", "#b-idx", "#b-depth", "#b-spots"].forEach(id => {
  const el = $(id), orig = el && el.onclick; if (!el || !orig) return;
  el.onclick = e => { if ($("#sheet").classList.contains("open") && railOwner(sheetView) === id) { closeSheet(); } else orig(e); };
});

/* ---------- init ---------- */
setMode(S.mode);
if (S.layers.ais) setAis(true);
if (S.anchor) { anchorBar(); startGps(); keepAwake(); toast("Ankarlarmet är på", 2000); }
statsOn(); setTimeout(askStats, 4000);
setTimeout(() => loadWaterLevel(), 2500);
$("#wlbar").onclick = openWaterLevel;
if (S.compassSlow) { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") document.addEventListener("click", () => setCompass(true), { once: true }); else setCompass(true); }
if (!termsOk()) openWelcome();
else if (!openSharedRoute() && navigator.geolocation && navigator.permissions && navigator.permissions.query)
  /* har man redan gett platsåtkomst öppnas kartan där båten ligger (ingen ny fråga). En delad rutt går före. */
  navigator.permissions.query({ name: "geolocation" }).then(p => { if (p.state === "granted") { startGps(); setFollow(true, true); } }).catch(() => {});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
window.addEventListener("beforeunload", e => { if (recording) { e.preventDefault(); e.returnValue = ""; } });
