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
  layers: { base: "chart", detail: false, detailZoom: 13, seamarks: false, soundings: true, groups: {} },
  theme: "day",
  fishDepth: [4, 12],
  boats: [{ id: "b1", name: "Min båt", type: "motor", length: 6.5, beam: 2.4, draft: 0.6, air: 2.0, speed: 20, fuel: 18, margin: 0.5, maxWind: 10 }],
  boatId: "b1",
  places: [], routes: [], tracks: [], catches: [], v2: 1, v3: 1
};
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
const needDepth = () => { const b = boat(); return (+b.draft || 0) + (+b.margin || 0); };

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
const mmlKey = () => S.mmlKey || (window.KUMMEL_CONFIG && window.KUMMEL_CONFIG.mmlKey) || "";
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
      seamarks: { type: "raster", tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18, attribution: "© OpenSeaMap" },
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "OpenFreeMap © OpenStreetMap" },
      chart: { type: "vector", url: CHART_URL, attribution: "Källa: Traficom (CC BY 4.0). Ej för navigering." }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": KummelChart.colors().land } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 }, layout: { visibility: "none" } },
      { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
      ...(mmlKey() ? [{ id: "mml-orto", type: "raster", source: "mml-orto", layout: { visibility: "none" } }] : []),
      ...KummelChart.layers({ need: needDepth(), fish: null, soundings: S.layers.soundings }),
      ...(mmlKey() ? [{ id: "mml-prop", type: "raster", source: "mml-prop", minzoom: 12, layout: { visibility: "none" }, paint: { "raster-opacity": .9 } }] : []),
      { id: "seamarks", type: "raster", source: "seamarks", layout: { visibility: "none" } }
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
  KummelChart.image(map, e.id);
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 110 }), "bottom-left");
map.touchZoomRotate.enableRotation();
let mapReady = false;

/* overlay sources (route, track, boat …) */
const SRC = ["route", "track", "live", "shown", "heading", "acc", "catches", "fishzone", "mob", "wxgrid", "wxobs", "wxsst", "navto", "ais", "aisvec"];
function addOverlays() {
  SRC.forEach(id => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY }); });
  const add = l => { if (!map.getLayer(l.id)) map.addLayer(l); };
  const wxColor = ["case", [">", ["get", "g"], ["get", "lim"]], "#d64545", [">", ["get", "g"], ["*", .75, ["get", "lim"]]], "#e2a90c", "#2f8f5b"];
  add({ id: "wx-grid", type: "symbol", source: "wxgrid", layout: { "icon-image": "wind", "icon-size": ["interpolate", ["linear"], ["get", "w"], 0, .8, 15, 1.5], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["get", "lbl"], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, 1.7], "text-allow-overlap": true }, paint: { "icon-color": wxColor, "icon-halo-color": "rgba(255,255,255,.85)", "icon-halo-width": 1.2, "text-color": "#14232e", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.6 } });
  add({ id: "wx-obs", type: "symbol", source: "wxobs", layout: { "icon-image": "wind", "icon-size": 1.6, "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["get", "lbl"], "text-font": ["Noto Sans Medium"], "text-size": 13, "text-offset": [0, 1.9], "text-allow-overlap": true }, paint: { "icon-color": wxColor, "icon-halo-color": "#0f2a3d", "icon-halo-width": 2, "text-color": "#0f2a3d", "text-halo-color": "#fff", "text-halo-width": 2 } });
  const sstColor = ["interpolate", ["linear"], ["get", "v"], 0, "#3b4cc0", 4, "#5b8ff9", 8, "#3fb6c7", 12, "#4cc38a", 16, "#e8c547", 20, "#f08a3c", 24, "#d63e3e"];
  add({ id: "wx-sst", type: "circle", source: "wxsst", paint: { "circle-radius": ["case", ["==", ["get", "obs"], 1], 17, 14], "circle-color": sstColor, "circle-opacity": .9, "circle-stroke-color": ["case", ["==", ["get", "obs"], 1], "#0f2a3d", "#ffffff"], "circle-stroke-width": ["case", ["==", ["get", "obs"], 1], 2.5, 1.5] } });
  add({ id: "wx-sst-lbl", type: "symbol", source: "wxsst", layout: { "text-field": ["get", "lbl"], "text-font": ["case", ["==", ["get", "obs"], 1], ["literal", ["Noto Sans Medium"]], ["literal", ["Noto Sans Regular"]]], "text-size": ["case", ["==", ["get", "obs"], 1], 12, 10.5], "text-allow-overlap": true }, paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,.45)", "text-halo-width": 1 } });
  add({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#1d6fa3", "fill-opacity": .08 } });
  add({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#1d6fa3", "line-width": 1 } });
  add({ id: "shown", type: "line", source: "shown", paint: { "line-color": "#1d6fa3", "line-width": 4, "line-opacity": .85 } });
  add({ id: "track", type: "line", source: "live", paint: { "line-color": "#d64545", "line-width": 4, "line-opacity": .85 } });
  add({ id: "route", type: "line", source: "route", paint: { "line-color": ["case", ["==", ["get", "off"], 1], "#e07b00", "#d64545"], "line-width": ["case", ["==", ["get", "off"], 1], 3, 3.5], "line-dasharray": [2, 1.5] } });
  add({ id: "route-lbl", type: "symbol", source: "route", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-allow-overlap": false }, paint: { "text-color": "#d64545", "text-halo-color": "#fff", "text-halo-width": 2 } });
  const aisColor = ["match", ["get", "cat"], "pass", "#2b6cd6", "cargo", "#2f8f5b", "tank", "#c0392b", "fish", "#e07b00", "sail", "#7a4fb0", "leis", "#c2185b", "serv", "#0097a7", "#6b7780"];
  add({ id: "ais-vec", type: "line", source: "aisvec", paint: { "line-color": "#14232e", "line-width": 1.4, "line-dasharray": [2, 1.5], "line-opacity": .7 } });
  add({ id: "ais", type: "symbol", source: "ais", layout: { "icon-image": ["case", ["==", ["get", "moving"], 1], "ship", "ship-still"], "icon-size": ["interpolate", ["linear"], ["zoom"], 7, .55, 12, .9, 16, 1.2], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "text-field": ["step", ["zoom"], "", 11.5, ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true }, paint: { "icon-color": aisColor, "icon-halo-color": "#ffffff", "icon-halo-width": 1.2, "text-color": "#14232e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
  add({ id: "navto", type: "line", source: "navto", paint: { "line-color": "#2f8f5b", "line-width": 3, "line-dasharray": [1, 1.2] } });
  add({ id: "heading", type: "line", source: "heading", paint: { "line-color": "#d64545", "line-width": 2, "line-dasharray": [3, 3] } });
  add({ id: "catches", type: "circle", source: "catches", paint: { "circle-radius": 7, "circle-color": "#f2c14e", "circle-stroke-color": "#1b1500", "circle-stroke-width": 2 } });
  add({ id: "mob", type: "circle", source: "mob", paint: { "circle-radius": 12, "circle-color": "#d64545", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
}
map.on("style.load", () => { // inte "load": den väntar på alla källor, och en nere OSM-källa får inte stoppa appen
  mapReady = true; addOverlays(); applyLayers(); drawPlaces(); refreshCatches(); updateFishZone(); updateCross();
  if (curTrack) setLive();
  if (wps.length) drawWps();
  if (mob) setData("mob", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lnglat(mob) } }] });
  if (gps) setData("acc", circlePoly(gps, gps.acc || 1));
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
function applyLayers() {
  if (!mapReady) return;
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  const base = chartMissing && S.layers.base === "chart" ? "osm" : S.layers.base;
  vis("osm", base === "osm");
  vis("sat", base === "sat" && !mmlKey());
  vis("mml-orto", base === "sat" && !!mmlKey());
  vis("mml-prop", !!S.layers.props);
  KummelChart.layerIds().forEach(id => vis(id, base === "chart" || (base === "sat" && KummelChart.isOverlay(id))));
  KummelChart.soundingIds().forEach(id => vis(id, (base === "chart" || (base === "sat" && id === "soundg-shallow")) && S.layers.soundings));
  $("#b-detail").setAttribute("aria-pressed", !!S.layers.detail);
  KummelChart.detailIds().forEach(id => { vis(id, base === "chart" && !!S.layers.detail); if (map.getLayer(id)) map.setLayerZoomRange(id, id === "detail-harbour" ? Math.max(14, dz()) : dz(), 24); });
  const G = KummelChart.groups(), on = g => (S.layers.groups || {})[g] !== false;
  Object.entries(G).forEach(([g, ids]) => { if (!on(g)) ids.forEach(id => vis(id, false)); });
  vis("seamarks", S.layers.seamarks);
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
  setData("catches", { type: "FeatureCollection", features: S.mode === "fiske" ? S.catches.map(c => ({ type: "Feature", properties: { id: c.id }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } })) : [] });
}
map.on("click", "catches", e => { const id = e.features[0].properties.id; e.preventDefault(); openCatch(id); });
map.on("mouseenter", "catches", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "catches", () => map.getCanvas().style.cursor = "");

/* ---------- modes ---------- */
const MODES = { tur: "Utflykt", fiske: "Fiske", segling: "Segling", paddling: "Paddling" };
function setMode(m) {
  S.mode = m; save();
  document.querySelectorAll(".modes button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
  $("#b-fish").classList.toggle("hidden", m !== "fiske");
  $("#b-depth").classList.toggle("hidden", m !== "fiske");
  refreshCatches(); updateFishZone();
  if (wx) renderChip();
}
document.querySelectorAll(".modes button").forEach(b => b.onclick = () => { setMode(b.dataset.mode); toast(`Läge: ${MODES[b.dataset.mode]}`, 1400); });

/* ---------- sheet ---------- */
let sheetView = null;
function openSheet(title, html, view) {
  $("#sh-title").textContent = title;
  $("#sh-body").innerHTML = html;
  $("#sheet").classList.add("open");
  if (sheetView !== (view || title)) $("#sheet").classList.remove("full");
  if (!$("#sheet").classList.contains("full")) $("#sheet").classList.toggle("compact", view === "route" || view === "depth");
  document.body.classList.add("sheet-open");
  sheetView = view || title;
}
function closeSheet() {
  $("#sheet").classList.remove("open", "full"); document.body.classList.remove("sheet-open");
  if (sheetView === "route") stopPlanning(false);
  sheetView = null;
}
$("#sh-close").onclick = closeSheet;
/* dra i panelens överkant: upp = helskärm, ner = mindre / stäng */
let dragY = null;
[".grab", ".sh-head"].forEach(sel => {
  const el = $(sel);
  el.addEventListener("touchstart", e => { if (e.target.closest(".x")) return; dragY = e.touches[0].clientY; $("#sheet").style.transition = "none"; }, { passive: true });
  el.addEventListener("touchmove", e => { if (dragY === null) return; const dy = e.touches[0].clientY - dragY; if (dy > 0) $("#sheet").style.transform = `translateY(${dy}px)`; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (dragY === null) return; const dy = e.changedTouches[0].clientY - dragY; dragY = null;
    const sh = $("#sheet"); sh.style.transition = ""; sh.style.transform = "";
    if (dy < -40) { sh.classList.add("full"); sh.classList.remove("compact"); }
    else if (dy > 60) { if (sh.classList.contains("full")) sh.classList.remove("full"); else closeSheet(); }
  });
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
  const moving = gps.sog > 2 && gps.cog != null;
  const opts = { center: lnglat(gps), duration: jump ? 600 : 900, easing: t => t };
  if (courseUp && moving) { opts.bearing = gps.cog; opts.offset = [0, k]; }
  else if (moving) { const r = rad(gps.cog - map.getBearing()); opts.offset = [-Math.sin(r) * k, Math.cos(r) * k]; }
  map.easeTo(opts);
}
map.on("dragstart", e => { lastTouch = Date.now(); if (follow && e.originalEvent) setFollow(false, true); });
map.on("rotatestart", e => { if (e.originalEvent) { lastTouch = Date.now(); if (courseUp) { courseUp = false; $("#b-locate").classList.remove("course"); } } });
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

function startGps() {
  if (!("geolocation" in navigator)) { toast("Den här enheten saknar platstjänster."); return; }
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, err => {
    toast(err.code === 1 ? "Platsåtkomst nekad. Tillåt plats för sidan i webbläsarens inställningar." : "Ingen GPS-position ännu.", 4000);
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  keepAwake();
  $("#b-mob").classList.remove("hidden");
}
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watchId !== null) keepAwake(); });

function onFix(p) {
  const pos = { lat: p.coords.latitude, lng: p.coords.longitude }, t = p.timestamp;
  let sog = p.coords.speed != null ? p.coords.speed * KN : null;
  let cog = p.coords.heading != null && !isNaN(p.coords.heading) ? p.coords.heading : null;
  if (lastFix) {
    const dt = (t - lastFix.t) / 3600000, d = distNm(lastFix, pos);
    if (sog == null && dt > 0) sog = d / dt;
    if (cog == null && d > 0.005) cog = bearing(lastFix, pos);
  }
  if (cog == null && gps) cog = gps.cog;
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
  if (!follow && followWanted && gps.sog > 1.5 && Date.now() - lastTouch > 20000) { setFollow(true); toast("Följer båten igen", 1500); }
  if (follow) { followBoat(false); $("#g-pos").innerHTML = fmtPos(pos); $("#g-poslbl").textContent = "GPS"; }
  $("#b-follow").classList.toggle("hidden", follow || !followWanted);
  if (recording) addTrackPoint(pos, t, gps.sog);
  if (nav) updateNav(pos);
  if (mob && sheetView === "mob") updateMob();
  if (gps.sog > 0.5) depthAlarm(pos);
}
$("#b-locate").onclick = () => {
  startGps();
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
    toast(`Grunt framåt: ${min.toFixed(1)} m inom 3 min. ${boat().name} behöver ${needDepth().toFixed(1)} m.`, 6000);
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
$("#b-fish").onclick = async () => {
  const pos = gps ? ll(gps) : ll(map.getCenter());
  const c = { id: uid(), t: Date.now(), ...pos, depth: depthAt(pos), species: "", kg: "", lure: "", note: "", wx: null };
  S.catches.unshift(c); save(); refreshCatches();
  toast("Fångst markerad! Fyll i detaljer när du har tid.");
  openCatch(c.id);
  try {
    const w = await fetchWx(pos.lat, pos.lng), h = hourIndex(w);
    c.wx = {
      wind: w.current.wind_speed_10m, gust: w.current.wind_gusts_10m, dir: w.current.wind_direction_10m,
      temp: w.current.temperature_2m, p: w.current.pressure_msl,
      pTrend: h >= 3 ? +(w.hourly.pressure_msl[h] - w.hourly.pressure_msl[h - 3]).toFixed(1) : null,
      sst: (waterNear && distNm(pos, waterNear) * 1.852 < 25 ? waterNear.v : w.marine?.current?.sea_surface_temperature) ?? null, moon: moonPhase(new Date())
    };
    save(); if (sheetView === "catch:" + c.id) openCatch(c.id);
  } catch (e) {}
};
function openCatch(id) {
  const c = S.catches.find(x => x.id === id); if (!c) return;
  const d = new Date(c.t), w = c.wx;
  openSheet("Fångst", `
    <div class="muted">${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1} kl ${hm(d)} · ${fmtPosTxt(c)}${c.depth ? ` · djup ${c.depth}` : ""}</div>
    <div class="grid2">
      <label class="f">Art<select id="cf-sp"><option value="">Välj</option>${SPECIES.map(s => `<option ${s === c.species ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label class="f">Vikt (kg)<input id="cf-kg" inputmode="decimal" value="${esc(c.kg)}"></label>
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
    <div class="row"><button class="btn pri" id="cf-save">Spara</button><button class="btn warn" id="cf-del">Ta bort</button></div>`, "catch:" + c.id);
  $("#cf-save").onclick = () => { c.species = $("#cf-sp").value; c.kg = $("#cf-kg").value; c.lure = $("#cf-lure").value; c.note = $("#cf-note").value; save(); closeSheet(); toast("Fångsten sparad"); };
  $("#cf-del").onclick = () => { S.catches = S.catches.filter(x => x.id !== c.id); save(); refreshCatches(); closeSheet(); };
}
function moonPhase(d) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((d - ref) / 86400000) % syn + syn) % syn, f = age / syn;
  const names = [["🌑", "Nymåne"], ["🌒", "Tilltagande"], ["🌓", "Första kvarteret"], ["🌔", "Tilltagande"], ["🌕", "Fullmåne"], ["🌖", "Avtagande"], ["🌗", "Sista kvarteret"], ["🌘", "Avtagande"]];
  const [icon, name] = names[Math.round(f * 8) % 8];
  return { icon, name, age: +age.toFixed(1) };
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
let planning = false, wps = [], wpMarkers = [], wpsOff = [], autoInfo = null;
function startPlanning(initial) {
  planning = true; wps = (initial || []).map(ll);
  document.body.classList.add("plan"); $("#b-route").setAttribute("aria-pressed", "true");
  renderRoute();
  if (!initial) toast("Tryck på kartan för att lägga till punkter", 2200);
}
function stopPlanning(keep) {
  closeWpMenu();
  planning = false; document.body.classList.remove("plan"); $("#b-route").setAttribute("aria-pressed", "false");
  if (!keep) { wps = []; wpsOff = []; autoInfo = null; drawWps(); }
}
map.on("click", e => {
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
  openSheet("Planera rutt", `
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
      <label class="f">Vill vara framme kl<input type="time" id="rt-arr" value="${S.arrTime || ""}"></label>
      <div id="rt-arrout" class="muted"></div>
      <button class="btn pri" id="rt-go">Starta navigering</button></div>` : ""}
    <div class="row"><button class="btn" id="rt-undo">Ångra</button><button class="btn" id="rt-rev">Vänd</button><button class="btn pri" id="rt-save">Spara rutt</button><button class="btn warn" id="rt-clear">Rensa</button></div>
    <div class="muted">Kontrollera alltid djup och faror mot sjökortet längs hela rutten.</div>`, "route");
  const arr = $("#rt-arr");
  if (arr) {
    const upd = () => { S.arrTime = arr.value; save(); $("#rt-arrout").innerHTML = arrivalPlan(st.nm, st.h); };
    arr.onchange = upd; arr.oninput = upd; upd();
    $("#rt-go").onclick = () => startNav(wps.map(ll));
  }
  $("#rt-undo").onclick = () => { wps.pop(); wpsOff = []; autoInfo = null; renderRoute(); };
  $("#rt-rev").onclick = () => { wps.reverse(); wpsOff.reverse(); renderRoute(); };
  $("#rt-clear").onclick = () => { wps = []; wpsOff = []; autoInfo = null; renderRoute(); };
  const au = $("#rt-auto"); if (au) au.onclick = () => autoRoute(wps[0], wps[wps.length - 1]);
  const show = $("#rt-show"); if (show) show.onclick = () => map.easeTo({ center: lnglat(sh.at), zoom: Math.max(map.getZoom(), 14) });
  $("#rt-save").onclick = () => {
    if (wps.length < 2) { toast("Lägg till minst två punkter."); return; }
    const name = `Rutt ${new Date().getDate()}.${new Date().getMonth() + 1} (${st.nm.toFixed(1)} nm)`;
    S.routes.unshift({ id: uid(), name, pts: wps.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]), created: Date.now() });
    save(); toast("Rutten sparad");
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
  const ok = new Uint8Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) ok[j * nx + i] = cls(at(i, j));
  const idx = p => [Math.min(nx - 1, Math.max(0, Math.floor((p.lng - bb[0]) * k / cell))), Math.min(ny - 1, Math.max(0, Math.floor((p.lat - bb[1]) * 111320 / cell)))];
  const [si, sj] = idx(a), [ti, tj] = idx(b), S0 = sj * nx + si, T0 = tj * nx + ti; ok[S0] = ok[T0] = 1;
  const g = new Float32Array(nx * ny).fill(Infinity), prev = new Int32Array(nx * ny).fill(-1), open = [[0, S0]]; g[S0] = 0;
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
  const cs = S0.find(s => s.node === path[0]), ct = best.t;
  const mid = simplify(path.map(G.pt), 12);
  const out = [ll(from)], off = [];
  if (!cs.near) for (const p of cs.pts.slice(1)) { out.push(ll(p)); off.push(true); }
  for (let i = cs.near ? 0 : 1; i < mid.length; i++) { out.push(mid[i]); off.push(false); }
  if (!ct.near) { for (const p of ct.pts.slice().reverse().slice(1)) { out.push(ll(p)); off.push(true); } }
  else out[out.length - 1] = ll(to);
  if (cs.near && out.length > 2 && distNm(out[0], out[1]) * NM < 1) { out.splice(1, 1); off.splice(0, 1); }
  let onNm = 0, unknownNm = 0, minDraft = Infinity;
  for (let i = 1; i < path.length; i++) {
    const A = G.adj[path[i - 1]]; let d = 0; for (let k = 0; k < A.length; k += 3) if (A[k] === path[i]) { d = A[k + 2]; break; }
    const w = distNm(G.pt(path[i - 1]), G.pt(path[i])); onNm += w; if (d === 0) unknownNm += w; else minDraft = Math.min(minDraft, d / 10);
  }
  const offNm = (cs.near ? 0 : cs.nm) + (ct.near ? 0 : ct.nm);
  return { pts: out, off: off.slice(0, out.length - 1), info: { onNm, offNm, unknownNm, minDraft: isFinite(minDraft) ? minDraft : null, unchecked: (!cs.near && !cs.ok) || (!ct.near && !ct.ok), shallow: !!(cs.shallow || ct.shallow) } };
}
async function autoRoute(from, to) {
  if (!S.autoAck) return autoDisclaimer(() => autoRoute(from, to));
  if (!from || !to) return;
  const r = await computeAutoRoute(from, to);
  if (r.err) { toast(r.err, 4500); return; }
  wps = r.pts; wpsOff = r.off; autoInfo = r.info;
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
async function loadWx(force) {
  const c = gps && follow ? gps : ll(map.getCenter());
  const key = `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`;
  if (!force && key === wxKey && wx && Date.now() - wx.at < 15 * 60000) return;
  try {
    wx = await fetchWx(c.lat, c.lng); wxKey = key;
    sunInfo = { sunrise: wx.daily.sunrise.map(s => new Date(s)), sunset: wx.daily.sunset.map(s => new Date(s)) };
    renderChip();
    if (sheetView === "wx") openWx();
    loadWaterNear(c);
  } catch (e) { $("#wxtxt").textContent = "–"; $("#wxsub").textContent = "inget väder"; }
}
function renderChip() {
  const c = wx.current;
  $("#wxtxt").textContent = `${c.wind_speed_10m.toFixed(0)} (${c.wind_gusts_10m.toFixed(0)}) m/s`;
  const s = sstInfo();
  $("#wxsub").textContent = S.mode === "fiske" && s ? `${compass(c.wind_direction_10m)} · vatten ${s.v.toFixed(1)}°` : `${compass(c.wind_direction_10m)} · ${c.temperature_2m.toFixed(0)}°`;
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
  openSheet("Väder", `
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
}
$("#wxchip").onclick = () => sheetView === "wx" ? closeSheet() : openWx();
scheduleWx();
setInterval(() => loadWx(true), 15 * 60000);

/* ---------- sjöväder på kartan ---------- */
let wxOn = false, wxGrid = null, wxObs = [], wxWater = [], wxStep = 0, wxGridT = null, wxGridKey = "", wxMode = S.wxMode || "wind";
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
  setData("wxsst", water ? { type: "FeatureCollection", features: [
    ...wxGrid.pts.map((p, k) => { const v = wxGrid.M[k]?.hourly?.sea_surface_temperature?.[i]; return v == null ? null : { type: "Feature", properties: { v, obs: 0, lbl: v.toFixed(1) + "°" }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } }; }).filter(Boolean),
    ...(wxStep === 0 ? wxWater.map(o => ({ type: "Feature", properties: { v: o.v, obs: 1, lbl: o.v.toFixed(1) + "°" }, geometry: { type: "Point", coordinates: [o.lng, o.lat] } })) : [])
  ] } : EMPTY);
  const t = new Date(H.time[i]);
  $("#wxb-time").textContent = wxStep === 0 ? "Nu" : `${t.toDateString() === new Date().toDateString() ? "Idag" : DAYS[t.getDay()]} ${pad(t.getHours())}:00`;
  $("#wxb-sub").textContent = water ? `Vattentemperatur vid ytan${wxStep === 0 ? "" : " · prognos"}` : `Vind m/s (byar) och våghöjd · ${wxObs.length && wxStep === 0 ? "kuststationer uppmätta" : "prognos"}`;
  document.querySelectorAll("[data-wxm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.wxm === wxMode));
  $("#wxb-legend-wind").classList.toggle("hidden", water); $("#wxb-legend-water").classList.toggle("hidden", !water);
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
  wxOn = on;
  $("#b-wx").setAttribute("aria-pressed", on);
  $("#wxbar").classList.toggle("hidden", !on);
  if (on) { wxStep = 0; $("#wxb-range").value = 0; loadWxGrid(); loadWxObs(); }
  else { setData("wxgrid", EMPTY); setData("wxobs", EMPTY); setData("wxsst", EMPTY); }
}
$("#b-wx").onclick = () => setWx(!wxOn);
$("#wxb-close").onclick = () => setWx(false);
document.querySelectorAll("[data-wxm]").forEach(b => b.onclick = () => { wxMode = S.wxMode = b.dataset.wxm; save(); renderWxLayer(); });
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
map.on("click", "ais", e => { e.preventDefault(); openShip(+e.features[0].properties.mmsi); });
map.on("mouseenter", "ais", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "ais", () => map.getCanvas().style.cursor = "");
function setAis(on) {
  S.layers.ais = on; save(); clearInterval(aisT);
  if (on) { loadAis(); aisT = setInterval(loadAis, 20000); } else renderAis();
}
map.on("moveend", () => { if (S.layers.ais) { clearTimeout(loadAis.t); loadAis.t = setTimeout(loadAis, 800); } });

/* ---------- boats ---------- */
const BTYPES = { motor: "Motorbåt", segel: "Segelbåt", rib: "RIB", kajak: "Kajak / kanot", ovrig: "Annan" };
const BDEF = { motor: { speed: 20, fuel: 18, maxWind: 10, draft: .6 }, segel: { speed: 5.5, fuel: 1.5, maxWind: 13, draft: 1.6 }, rib: { speed: 28, fuel: 25, maxWind: 9, draft: .5 }, kajak: { speed: 3, fuel: 0, maxWind: 6, draft: .2 }, ovrig: { speed: 6, fuel: 3, maxWind: 8, draft: .8 } };
function boatChanged() { if (mapReady) KummelChart.setNeed(map, needDepth()); if (wx) renderChip(); }
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
function openLayers() {
  const r = (k, v) => `<label class="row"><input type="radio" name="base" value="${k}" ${S.layers.base === k ? "checked" : ""}> ${v}</label>`;
  openSheet("Kartlager", `
    <div class="card"><h3>Karta</h3>${r("chart", "Sjökort")}${r("sat", "Flygfoto med farleder och sjömärken")}${r("osm", "Gatukarta")}</div>
    <div class="card"><h3>Flygbild och fastighetsgränser</h3>
      <label class="row"><input type="checkbox" id="ly-prop" ${S.layers.props ? "checked" : ""} ${mmlKey() ? "" : "disabled"}> Fastighetsgränser (vid inzoomning)</label>
      <label class="f">${window.KUMMEL_CONFIG?.mmlKey ? "Egen API-nyckel (valfritt, appen har en inbyggd)" : "API-nyckel från Maanmittauslaitos"}<input id="ly-mml" value="${esc(S.mmlKey || "")}" placeholder="Klistra in nyckeln här" autocomplete="off" spellcheck="false"></label>
      <div class="muted">${mmlKey() ? "Flygfotot använder Lantmäteriverkets bilder i Finland och på Åland." : "Med en gratis nyckel från Lantmäteriverket i Finland blir flygfotot skarpare och fastighetsgränser kan visas. Skapa den på omatili.maanmittauslaitos.fi. Nyckeln sparas bara på den här enheten."}</div>
      <button class="btn" id="ly-mml-save">Spara nyckel</button>
    </div>
    <div class="card"><h3>Grynnor och stenar</h3>
      <label class="row"><input type="checkbox" id="ly-det" ${S.layers.detail ? "checked" : ""}> Visa detaljkortet när jag zoomar in</label>
      <label class="f">Visa detaljkortet från<select id="ly-dz">${[[11, "Översikt (ca 2 nm över skärmen)"], [12, "Mellan (ca 1 nm)"], [13, "Nära (ca 0,5 nm), rekommenderas"], [14, "Mycket nära (ca 0,25 nm)"]].map(([z, t]) => `<option value="${z}" ${dz() === z ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="muted">Grynnor och stenar finns bara i Traficoms detaljkort. Längre ut blir det svårläst eftersom kortet förminskas.</div>
    </div>
    <div class="card"><h3>Visa på kartan</h3>
      ${[["fairways", "Farleder, ledlinjer och farledsdjup"], ["marks", "Sjömärken och fyrar"], ["sectors", "Ljussektorer"], ["contours", "Djupkurvor"], ["limits", "Fartbegränsningar och förbudsområden"], ["land", "Ortnamn, vägar och hus"]].map(([g, t]) => `<label class="row"><input type="checkbox" data-grp="${g}" ${(S.layers.groups || {})[g] !== false ? "checked" : ""}> ${t}</label>`).join("")}
      <label class="row"><input type="checkbox" id="ly-snd" ${S.layers.soundings ? "checked" : ""}> Djupsiffror</label>
      <label class="row"><input type="checkbox" id="ly-ais" ${S.layers.ais ? "checked" : ""}> AIS-fartyg i realtid</label>
      <label class="row"><input type="checkbox" id="ly-sea" ${S.layers.seamarks ? "checked" : ""}> OpenSeaMap sjömärken</label>
    </div>
    <div class="muted">På detaljkortet är vatten som är grundare än din båt behöver skuggat i rött.</div>
    <div class="disclaimer">Källa: Traficom (CC BY 4.0). Ej för navigering, uppfyller inte kraven för officiella sjökort. Använd alltid uppdaterade officiella sjökort.</div>`, "layers");
  $("#ly-snd").onchange = e => { S.layers.soundings = e.target.checked; save(); applyLayers(); };
  $("#ly-ais").onchange = e => setAis(e.target.checked);
  $("#ly-det").onchange = e => { S.layers.detail = e.target.checked; save(); applyLayers(); };
  $("#ly-prop").onchange = e => { S.layers.props = e.target.checked; save(); applyLayers(); if (e.target.checked && map.getZoom() < 12) toast("Fastighetsgränser visas när du zoomar in närmare", 2200); };
  $("#ly-mml-save").onclick = () => {
    S.mmlKey = $("#ly-mml").value.trim(); save();
    map.setStyle(baseStyle(), { diff: false });
    toast(S.mmlKey ? "Nyckeln är sparad" : "Nyckeln är borttagen", 1600); setTimeout(openLayers, 300);
  };
  $("#ly-dz").onchange = e => { S.layers.detailZoom = +e.target.value; save(); applyLayers(); };
  document.querySelectorAll("[data-grp]").forEach(x => x.onchange = () => { S.layers.groups = { ...(S.layers.groups || {}), [x.dataset.grp]: x.checked }; save(); applyLayers(); });
  $("#ly-sea").onchange = e => { S.layers.seamarks = e.target.checked; save(); applyLayers(); };
  document.querySelectorAll("input[name=base]").forEach(x => x.onchange = () => { S.layers.base = x.value; save(); applyLayers(); });
}
$("#b-layers").onclick = openLayers;
$("#b-detail").onclick = () => {
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
      <button class="btn" id="m-data">Säkerhetskopia</button>
      <button class="btn" id="m-about">Om Kummel</button>
    </div>`, "menu");
  $("#m-boats").onclick = openBoats; $("#m-places").onclick = openPlaces; $("#m-routes").onclick = openRoutes;
  $("#m-log").onclick = openLog; $("#m-catch").onclick = openCatches; $("#m-data").onclick = openData; $("#m-about").onclick = openAbout;
}
$("#b-menu").onclick = openMenu;
function openPlaces() {
  openSheet("Mina platser", `<div class="list">${S.places.map(p => `<div class="card"><h3>${CATS[p.cat].e} ${esc(p.name)}</h3>${p.note ? `<div>${esc(p.note)}</div>` : ""}<div class="row"><button class="btn" data-go="${p.id}">Visa</button></div></div>`).join("") || `<div class="muted">Inga platser ännu. Tryck på nålknappen eller håll fingret på kartan för att spara en plats.</div>`}</div>`, "places");
  document.querySelectorAll("[data-go]").forEach(x => x.onclick = () => { const p = S.places.find(q => q.id === x.dataset.go); map.easeTo({ center: lnglat(p), zoom: 14 }); openPlace(p.id); });
}
const boundsOf = pts => pts.reduce((b, p) => b.extend([p[1], p[0]]), new maplibregl.LngLatBounds([pts[0][1], pts[0][0]], [pts[0][1], pts[0][0]]));
function openRoutes() {
  openSheet("Sparade rutter", `<div class="list">${S.routes.map(r => `<div class="card"><h3>${esc(r.name)}</h3><div class="row"><button class="btn pri" data-nav="${r.id}">Navigera</button><button class="btn" data-open="${r.id}">Öppna</button><button class="btn warn" data-del="${r.id}">Ta bort</button></div></div>`).join("") || `<div class="muted">Inga sparade rutter.</div>`}</div>`, "routes");
  document.querySelectorAll("[data-open]").forEach(x => x.onclick = () => {
    const r = S.routes.find(q => q.id === x.dataset.open);
    map.fitBounds(boundsOf(r.pts), { padding: 60, duration: 0 });
    startPlanning(r.pts.map(p => ({ lat: p[0], lng: p[1] })));
  });
  document.querySelectorAll("[data-del]").forEach(x => x.onclick = () => { S.routes = S.routes.filter(q => q.id !== x.dataset.del); save(); openRoutes(); });
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
  const by = {}; S.catches.forEach(c => { const k = c.species || "Okänd art"; by[k] = (by[k] || 0) + 1; });
  openSheet("Fångstlogg", `
    <div class="row">${Object.entries(by).map(([k, v]) => `<span class="pill">${esc(k)} ${v}</span>`).join("")}</div>
    <div class="list">${S.catches.map(c => { const d = new Date(c.t); return `<div class="card"><h3>${esc(c.species || "Fångst")} ${c.kg ? `· ${esc(c.kg)} kg` : ""}</h3>
      <div class="muted">${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1} kl ${hm(d)}${c.depth ? ` · ${esc(c.depth)}` : ""}${c.wx ? ` · ${c.wx.wind.toFixed(0)} m/s ${compass(c.wx.dir)} · ${Math.round(c.wx.p)} hPa · ${c.wx.moon.icon}` : ""}${c.lure ? " · " + esc(c.lure) : ""}</div>
      <div class="row"><button class="btn" data-c="${c.id}">Visa</button></div></div>`; }).join("") || `<div class="muted">Inga fångster ännu. Välj läget Fiske och tryck på Fisk! när det nappar.</div>`}</div>
    <div class="muted">Dina fiskeplatser sparas bara på den här enheten och delas aldrig.</div>`, "catches");
  document.querySelectorAll("[data-c]").forEach(x => x.onclick = () => { const c = S.catches.find(q => q.id === x.dataset.c); if (S.mode !== "fiske") setMode("fiske"); map.easeTo({ center: lnglat(c), zoom: 14 }); openCatch(c.id); });
}
function openData() {
  openSheet("Säkerhetskopia", `
    <div class="muted">All data sparas lokalt i webbläsaren på den här enheten. Spara en kopia för att flytta den till en annan enhet.</div>
    <div class="row"><button class="btn pri" id="d-exp">Spara kopia</button><label class="btn">Läs in kopia<input type="file" id="d-imp" accept=".json,application/json" hidden></label></div>`, "data");
  $("#d-exp").onclick = () => downloadBlob(`kummel-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S), "application/json");
  $("#d-imp").onchange = async e => {
    try { const o = JSON.parse(await e.target.files[0].text()); S = Object.assign(structuredClone(DEFAULT_STATE), o); save(); drawPlaces(); refreshCatches(); boatChanged(); toast("Kopian är inläst"); closeSheet(); }
    catch (err) { toast("Filen kunde inte läsas. Välj en säkerhetskopia från Kummel."); }
  };
}
function openAbout() {
  openSheet("Om Kummel", `
    <div><b>Kummel v0.2</b>: vektorsjökort, väder och båtliv i webbläsaren. Fungerar på mobil, iPad och dator. Lägg till på hemskärmen för att använda som app.</div>
    <div class="card"><h3>Tips</h3><div class="muted">Håll fingret på kartan för att spara en plats. Vrid kartan med två fingrar. Tryck på positionsknappen två gånger för kurs upp. Ställ in båtens djupgående under Meny → Båtar, så markeras grunt vatten för just din båt.</div></div>
    <div class="disclaimer">Kummel är inte ett certifierat navigationshjälpmedel. Ruttförslag och varningar är hjälpmedel: föraren ansvarar alltid för navigeringen. Sjökortsdata: Traficom, CC BY 4.0, ej för navigering. Bakgrund: OpenStreetMap. Väder: Open-Meteo.</div>`, "about");
}

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

/* ---------- init ---------- */
setMode(S.mode);
if (S.layers.ais) setAis(true);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("beforeunload", e => { if (recording) { e.preventDefault(); e.returnValue = ""; } });
