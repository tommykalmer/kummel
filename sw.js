/* Kummel service worker – app shell offline + cache of chart tiles you have viewed */
const SHELL = "kummel-shell-v31";
const TILES = "kummel-tiles-v1";
const MAX_TILES = 6000;
const SHELL_FILES = ["./", "./index.html", "./app.js", "./chartstyle.js", "./config.js", "./data/marks.geojson", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js",
  "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css",
  "https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js"];
const TILE_HOSTS = ["avoin-karttakuva.maanmittauslaitos.fi", "tiles.openfreemap.org", "julkinen.traficom.fi", "tile.openstreetmap.org", "basemaps.cartocdn.com", "server.arcgisonline.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try {
    const c = await caches.open(TILES); const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // sjökortsfilen läses med range-anrop; webbläsarens egen cache hanterar den
  if (url.pathname.endsWith(".pmtiles") || e.request.headers.has("range")) return;
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h)) && (/\/\d+\/\d+\/\d+/.test(url.pathname) || url.pathname.includes("/fonts/") || url.search.includes("GetTile"))) {
    // cache-first for map tiles (opaque responses are fine for <img>)
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok || res.type === "opaque") { c.put(e.request, res.clone()); trimTiles(); }
        return res;
      } catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  if (url.hostname.endsWith("open-meteo.com")) {
    // network-first for weather, fall back to last known
    e.respondWith(fetch(e.request).then(res => { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); return res; })
      .catch(() => caches.match(e.request)));
    return;
  }
  // app shell: nätet först (nya versioner direkt), cache om man är offline
  if (url.origin === self.location.origin && /\.(html|js|geojson)$|\/$/.test(url.pathname)) {
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); } return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  // övrigt: stale-while-revalidate
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
