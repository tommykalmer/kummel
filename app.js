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
  layers: { base: "chart", detail: true, seamarks: false, soundings: true },
  fishDepth: [4, 12],
  boats: [{ id: "b1", name: "Min båt", type: "motor", length: 6.5, beam: 2.4, draft: 0.6, air: 2.0, speed: 20, fuel: 18, margin: 0.5, maxWind: 10 }],
  boatId: "b1",
  places: [], routes: [], tracks: [], catches: [], v2: 1
};
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      const st = Object.assign(structuredClone(DEFAULT_STATE), s);
      if (!s.v2) { st.layers = structuredClone(DEFAULT_STATE.layers); st.v2 = 1; } // v0.1 hade gatukarta som standard
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
function baseStyle() {
  return {
    version: 8,
    glyphs: location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + "fonts/{fontstack}/{range}.pbf", // egna typsnitt: fungerar offline
    sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap" },
      sat: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Bild © Esri" },
      ...KummelChart.rasterSources(),
      seamarks: { type: "raster", tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18, attribution: "© OpenSeaMap" },
      ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "OpenFreeMap © OpenStreetMap" },
      chart: { type: "vector", url: CHART_URL, attribution: "Källa: Traficom (CC BY 4.0). Ej för navigering." }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": KummelChart.colors().land } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 1 }, layout: { visibility: "none" } },
      { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
      ...KummelChart.layers({ need: needDepth(), fish: null, soundings: S.layers.soundings }),
      { id: "seamarks", type: "raster", source: "seamarks", layout: { visibility: "none" } }
    ]
  };
}

const map = new maplibregl.Map({
  container: "map", style: baseStyle(), center: [S.view.lng, S.view.lat], zoom: S.view.z, bearing: S.view.bearing || 0,
  maxZoom: 18.5, minZoom: 4, attributionControl: false, dragRotate: true, pitchWithRotate: false, touchPitch: false, hash: false
});
map.on("styleimagemissing", e => KummelChart.image(map, e.id));
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 110 }), "bottom-left");
map.touchZoomRotate.enableRotation();
let mapReady = false;

/* overlay sources (route, track, boat …) */
const SRC = ["route", "track", "live", "shown", "heading", "acc", "catches", "fishzone", "mob"];
function addOverlays() {
  SRC.forEach(id => { if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY }); });
  const add = l => { if (!map.getLayer(l.id)) map.addLayer(l); };
  add({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#1d6fa3", "fill-opacity": .08 } });
  add({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#1d6fa3", "line-width": 1 } });
  add({ id: "shown", type: "line", source: "shown", paint: { "line-color": "#1d6fa3", "line-width": 4, "line-opacity": .85 } });
  add({ id: "track", type: "line", source: "live", paint: { "line-color": "#d64545", "line-width": 4, "line-opacity": .85 } });
  add({ id: "route", type: "line", source: "route", paint: { "line-color": "#d64545", "line-width": 3, "line-dasharray": [2, 1.5] } });
  add({ id: "route-lbl", type: "symbol", source: "route", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Medium"], "text-size": 12, "text-allow-overlap": false }, paint: { "text-color": "#d64545", "text-halo-color": "#fff", "text-halo-width": 2 } });
  add({ id: "heading", type: "line", source: "heading", paint: { "line-color": "#d64545", "line-width": 2, "line-dasharray": [3, 3] } });
  add({ id: "catches", type: "circle", source: "catches", paint: { "circle-radius": 7, "circle-color": "#f2c14e", "circle-stroke-color": "#1b1500", "circle-stroke-width": 2 } });
  add({ id: "mob", type: "circle", source: "mob", paint: { "circle-radius": 12, "circle-color": "#d64545", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
}
map.on("style.load", () => { // inte "load": den väntar på alla källor, och en nere OSM-källa får inte stoppa appen
  mapReady = true; addOverlays(); applyLayers(); drawPlaces(); refreshCatches(); updateFishZone(); updateCross();
  if (curTrack) setLive();
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

function applyLayers() {
  if (!mapReady) return;
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  const base = chartMissing && S.layers.base === "chart" ? "osm" : S.layers.base;
  vis("osm", base === "osm");
  vis("sat", base === "sat");
  KummelChart.layerIds().forEach(id => vis(id, base === "chart" || (base === "sat" && KummelChart.isOverlay(id))));
  KummelChart.soundingIds().forEach(id => vis(id, (base === "chart" || (base === "sat" && id === "soundg-shallow")) && S.layers.soundings));
  KummelChart.detailIds().forEach(id => vis(id, base === "chart" && S.layers.detail !== false));
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
  $("#sheet").classList.toggle("compact", view === "route" || view === "depth");
  document.body.classList.add("sheet-open");
  sheetView = view || title;
}
function closeSheet() {
  $("#sheet").classList.remove("open"); document.body.classList.remove("sheet-open");
  if (sheetView === "route") stopPlanning(false);
  sheetView = null;
}
$("#sh-close").onclick = closeSheet;
let dragY = null;
$(".grab").addEventListener("touchstart", e => dragY = e.touches[0].clientY, { passive: true });
$(".grab").addEventListener("touchend", e => { if (dragY !== null && e.changedTouches[0].clientY - dragY > 60) closeSheet(); dragY = null; });

/* ---------- crosshair readout, north arrow ---------- */
function updateCross() {
  if (gps && follow) return;
  $("#g-pos").innerHTML = fmtPos(map.getCenter());
  $("#g-poslbl").textContent = "Kors";
}
map.on("move", () => { updateCross(); $("#north").style.transform = `rotate(${-map.getBearing()}deg)`; $("#b-north").classList.toggle("hidden", Math.abs(map.getBearing()) < 1 && !courseUp); });
map.on("moveend", () => { const c = map.getCenter(); S.view = { lat: c.lat, lng: c.lng, z: map.getZoom(), bearing: map.getBearing() }; save(); scheduleWx(); });
map.on("dragstart", () => { if (follow) { follow = false; $("#b-locate").setAttribute("aria-pressed", "false"); } });
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
  if (follow) {
    const opts = { center: lnglat(pos), duration: 800 };
    if (first) opts.zoom = Math.max(map.getZoom(), 13);
    if (courseUp && cog != null && gps.sog > 1) opts.bearing = cog;
    map.easeTo(opts);
    $("#g-pos").innerHTML = fmtPos(pos); $("#g-poslbl").textContent = "GPS";
  }
  if (recording) addTrackPoint(pos, t, gps.sog);
  if (mob && sheetView === "mob") updateMob();
  if (gps.sog > 0.5) depthAlarm(pos);
}
$("#b-locate").onclick = () => {
  startGps();
  if (!follow) {
    follow = true;
    if (gps) map.easeTo({ center: lnglat(gps), zoom: Math.max(map.getZoom(), 13) });
    else toast("Söker GPS-position …");
  } else if (!courseUp) { courseUp = true; toast("Kurs upp: kartan vrids efter båtens kurs", 2000); }
  else { follow = false; courseUp = false; map.easeTo({ bearing: 0 }); }
  $("#b-locate").setAttribute("aria-pressed", follow);
  $("#b-locate").classList.toggle("course", courseUp);
};

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
  const nav = $("#pf-nav"); if (nav) nav.onclick = () => startPlanning([gps ? ll(gps) : ll(map.getCenter()), ll(p)]);
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
      sst: w.marine?.current?.sea_surface_temperature ?? null, moon: moonPhase(new Date())
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
let planning = false, wps = [], wpMarkers = [];
function startPlanning(initial) {
  planning = true; wps = (initial || []).map(ll);
  document.body.classList.add("plan"); $("#b-route").setAttribute("aria-pressed", "true");
  renderRoute();
  if (!initial) toast("Tryck på kartan för att lägga till punkter", 2200);
}
function stopPlanning(keep) {
  planning = false; document.body.classList.remove("plan"); $("#b-route").setAttribute("aria-pressed", "false");
  if (!keep) { wps = []; drawWps(); }
}
map.on("click", e => {
  if (!planning) return;
  if (e.defaultPrevented) return;
  wps.push(ll(e.lngLat)); renderRoute();
});
function routeStats(points) {
  const b = boat(); let nm = 0; const legs = [];
  for (let i = 1; i < points.length; i++) { const d = distNm(points[i - 1], points[i]); nm += d; legs.push({ d, brg: bearing(points[i - 1], points[i]) }); }
  const h = b.speed > 0 ? nm / b.speed : 0;
  return { nm, legs, h, fuel: h * (b.fuel || 0) };
}
function drawWps() {
  wpMarkers.forEach(m => m.remove()); wpMarkers = [];
  const st = routeStats(wps);
  setData("route", { type: "FeatureCollection", features: wps.slice(1).map((p, i) => ({ type: "Feature", properties: { label: `${String(Math.round(st.legs[i].brg)).padStart(3, "0")}° ${st.legs[i].d.toFixed(1)} nm` }, geometry: { type: "LineString", coordinates: [lnglat(wps[i]), lnglat(p)] } })) });
  wps.forEach((p, i) => {
    const el = document.createElement("div"); el.className = "wp-icon"; el.textContent = i + 1;
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(lnglat(p)).addTo(map);
    m.on("drag", () => { wps[i] = ll(m.getLngLat()); const s2 = routeStats(wps); setData("route", lineFC(wps.map(lnglat))); });
    m.on("dragend", renderRoute);
    el.addEventListener("click", e => { e.stopPropagation(); if (planning) { wps.splice(i, 1); renderRoute(); } });
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
    ${shTxt}${dark}${routeWindNote()}
    <div>${st.legs.map((l, i) => `<div class="leg"><span class="pill">${i + 1}→${i + 2}</span><span>${compass(l.brg)}</span><span class="num">${String(Math.round(l.brg)).padStart(3, "0")}°</span><span class="num">${l.d.toFixed(2)} nm</span></div>`).join("") || `<div class="muted">Tryck på en punkt för att ta bort den. Dra för att flytta.</div>`}</div>
    <div class="row"><button class="btn" id="rt-undo">Ångra</button><button class="btn" id="rt-rev">Vänd</button><button class="btn pri" id="rt-save">Spara rutt</button><button class="btn warn" id="rt-clear">Rensa</button></div>
    <div class="muted">Kontrollera alltid djup och faror mot sjökortet längs hela rutten.</div>`, "route");
  $("#rt-undo").onclick = () => { wps.pop(); renderRoute(); };
  $("#rt-rev").onclick = () => { wps.reverse(); renderRoute(); };
  $("#rt-clear").onclick = () => { wps = []; renderRoute(); };
  const show = $("#rt-show"); if (show) show.onclick = () => map.easeTo({ center: lnglat(sh.at), zoom: Math.max(map.getZoom(), 14) });
  $("#rt-save").onclick = () => {
    if (wps.length < 2) { toast("Lägg till minst två punkter."); return; }
    const name = `Rutt ${new Date().getDate()}.${new Date().getMonth() + 1} (${st.nm.toFixed(1)} nm)`;
    S.routes.unshift({ id: uid(), name, pts: wps.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]), created: Date.now() });
    save(); toast("Rutten sparad");
  };
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
$("#b-route").onclick = () => planning ? closeSheet() : startPlanning();

/* ---------- weather ---------- */
let wx = null, sunInfo = null, wxT = null, wxKey = "";
async function fetchWx(lat, lng) {
  const q = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&timezone=auto&forecast_days=3`;
  const [f, m] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&wind_speed_unit=ms&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,weather_code&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,pressure_msl&daily=sunrise,sunset`).then(r => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,sea_surface_temperature&hourly=wave_height`).then(r => r.ok ? r.json() : null).catch(() => null)
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
  } catch (e) { $("#wxtxt").textContent = "–"; $("#wxsub").textContent = "inget väder"; }
}
function renderChip() {
  const c = wx.current;
  $("#wxtxt").textContent = `${c.wind_speed_10m.toFixed(0)} (${c.wind_gusts_10m.toFixed(0)}) m/s`;
  $("#wxsub").textContent = `${compass(c.wind_direction_10m)} · ${c.temperature_2m.toFixed(0)}°`;
  $("#wxchip .arrow").style.transform = `rotate(${(c.wind_direction_10m + 180) % 360}deg)`;
  $("#wxchip").style.color = c.wind_gusts_10m > (boat().maxWind || 10) ? "var(--port)" : "";
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
  const moon = moonPhase(new Date()), age = Math.round((Date.now() - wx.at) / 60000);
  openSheet("Väder", `
    <div class="wx-now">
      <svg viewBox="0 0 24 24" width="56" height="56" style="transform:rotate(${(c.wind_direction_10m + 180) % 360}deg)"><path d="M12 2 19 21 12 16.5 5 21Z" fill="var(--accent)"/></svg>
      <div><div class="big">${c.wind_speed_10m.toFixed(1)} <small style="font-size:16px">m/s</small></div>
      <div>Byar ${c.wind_gusts_10m.toFixed(1)} m/s från ${compass(c.wind_direction_10m)} (${Math.round(c.wind_direction_10m)}°)</div></div>
    </div>
    <div class="callout ${win.cls}">${win.txt}<div class="muted">Gräns för ${esc(b.name)}: byar ${b.maxWind || 10} m/s</div></div>
    <div class="wx-stats">
      <div><b>${c.temperature_2m.toFixed(0)}°</b><span>Luft</span></div>
      <div><b>${m?.sea_surface_temperature != null ? m.sea_surface_temperature.toFixed(1) + "°" : "–"}</b><span>Vatten</span></div>
      <div><b>${m?.wave_height != null ? m.wave_height.toFixed(1) + " m" : "–"}</b><span>Våghöjd</span></div>
      <div><b>${Math.round(c.pressure_msl)}</b><span>hPa ${pTrend > .5 ? "↑" : pTrend < -.5 ? "↓" : "→"}</span></div>
      <div><b>${sr ? hm(sr) : "–"}</b><span>Sol upp</span></div>
      <div><b>${ss ? hm(ss) : "–"}</b><span>Sol ned</span></div>
    </div>
    <div><div class="muted" style="margin-bottom:4px">Vind kommande 48 h · stapel = medelvind, streck = byar, röd linje = din gräns</div><div class="chart">${windChart()}</div></div>
    ${S.mode === "fiske" ? `<div class="card"><h3>Fiskeförhållanden</h3><div>${moon.icon} ${moon.name} · Tryck ${pTrend > .5 ? "stigande" : pTrend < -.5 ? "fallande" : "stabilt"} (${pTrend >= 0 ? "+" : ""}${pTrend.toFixed(1)} hPa/3 h)</div></div>` : ""}
    <div class="muted">Prognos för ${fmtPosTxt({ lat: wx.lat, lng: wx.lng })} · uppdaterad för ${age} min sedan. Källa: Open-Meteo.</div>
    <button class="btn" id="wx-ref">Uppdatera</button>`, "wx");
  $("#wx-ref").onclick = () => loadWx(true);
}
$("#wxchip").onclick = () => sheetView === "wx" ? closeSheet() : openWx();
scheduleWx();
setInterval(() => loadWx(true), 15 * 60000);

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
    <div class="card"><h3>Visa</h3>
      <label class="row"><input type="checkbox" id="ly-snd" ${S.layers.soundings ? "checked" : ""}> Djupsiffror</label>
      <label class="row"><input type="checkbox" id="ly-det" ${S.layers.detail !== false ? "checked" : ""}> Detaljkort med grynnor och stenar vid inzoomning</label>
      <label class="row"><input type="checkbox" id="ly-sea" ${S.layers.seamarks ? "checked" : ""}> OpenSeaMap sjömärken</label>
    </div>
    <div class="muted">På detaljkortet är vatten som är grundare än din båt behöver skuggat i rött.</div>
    <div class="disclaimer">Källa: Traficom (CC BY 4.0). Ej för navigering, uppfyller inte kraven för officiella sjökort. Använd alltid uppdaterade officiella sjökort.</div>`, "layers");
  $("#ly-snd").onchange = e => { S.layers.soundings = e.target.checked; save(); applyLayers(); };
  $("#ly-det").onchange = e => { S.layers.detail = e.target.checked; save(); applyLayers(); };
  $("#ly-sea").onchange = e => { S.layers.seamarks = e.target.checked; save(); applyLayers(); };
  document.querySelectorAll("input[name=base]").forEach(x => x.onchange = () => { S.layers.base = x.value; save(); applyLayers(); });
}
$("#b-layers").onclick = openLayers;

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
  openSheet("Sparade rutter", `<div class="list">${S.routes.map(r => `<div class="card"><h3>${esc(r.name)}</h3><div class="row"><button class="btn" data-open="${r.id}">Öppna</button><button class="btn warn" data-del="${r.id}">Ta bort</button></div></div>`).join("") || `<div class="muted">Inga sparade rutter.</div>`}</div>`, "routes");
  document.querySelectorAll("[data-open]").forEach(x => x.onclick = () => {
    const r = S.routes.find(q => q.id === x.dataset.open);
    map.fitBounds(boundsOf(r.pts), { padding: 60, duration: 0 });
    startPlanning(r.pts.map(p => ({ lat: p[0], lng: p[1] })));
  });
  document.querySelectorAll("[data-del]").forEach(x => x.onclick = () => { S.routes = S.routes.filter(q => q.id !== x.dataset.del); save(); openRoutes(); });
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
    <div class="disclaimer">Kummel är inte ett certifierat navigationshjälpmedel. Sjökortsdata: Traficom, CC BY 4.0, ej för navigering. Bakgrund: OpenStreetMap. Väder: Open-Meteo.</div>`, "about");
}

/* ---------- night mode ---------- */
$("#b-night").onclick = () => {
  const on = !document.body.classList.contains("night");
  document.body.classList.toggle("night", on); $("#b-night").setAttribute("aria-pressed", on);
};

/* ---------- init ---------- */
setMode(S.mode);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("beforeunload", e => { if (recording) { e.preventDefault(); e.returnValue = ""; } });
