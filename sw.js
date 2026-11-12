/* Kummel service worker – app shell offline + cache of chart tiles you have viewed */
const SHELL = "kummel-shell-v96";
const TILES = "kummel-tiles-v1";
const OFFLINE = "kummel-offline-v1";   // nedladdad offlinekarta, rensas aldrig automatiskt
const MAX_TILES = 6000;
const SHELL_FILES = ["./", "./index.html", "./app.js", "./chartstyle.js", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png",
  "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js",
  "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css",
  "https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js"];
const TILE_HOSTS = ["avoin-karttakuva.maanmittauslaitos.fi", "tiles.openfreemap.org", "julkinen.traficom.fi", "tile.openstreetmap.org", "basemaps.cartocdn.com", "server.arcgisonline.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES && k !== OFFLINE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try {
    const c = await caches.open(TILES); const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

/* sjökortsfilen ur offlinecachen: svara på range-anrop med en bit av den sparade filen */
const pmBlobs = {};
self.addEventListener("message", e => { if (e.data === "offline-changed") for (const k in pmBlobs) delete pmBlobs[k]; });
async function offlineRange(req, url) {
  const key = url.origin + url.pathname;
  let ent = pmBlobs[key];
  if (!ent) {
    const hit = await (await caches.open(OFFLINE)).match(key);
    if (!hit) return null;
    ent = pmBlobs[key] = { blob: await hit.blob(), etag: hit.headers.get("ETag") || "" };
  }
  const size = ent.blob.size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return null;
  const s = +m[1], end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  return new Response(ent.blob.slice(s, end + 1), { status: 206, headers: {
    "Content-Range": `bytes ${s}-${end}/${size}`, "Content-Length": String(end - s + 1), "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "ETag": ent.etag } });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // sjökortsfilen läses med range-anrop: ur offlinecachen om den är nedladdad, annars nätet
  if (url.pathname.endsWith(".pmtiles")) {
    if (!e.request.headers.has("range")) return;
    e.respondWith(offlineRange(e.request, url).then(r => r || fetch(e.request)).catch(() => fetch(e.request)));
    return;
  }
  if (e.request.headers.has("range")) return;
  // övriga kartfiler i Cloudflare R2 (sjömärken, farleder): nätet först, offlinekopian om man saknar täckning
  if (url.hostname === "kartor.kummel.app") {
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); } return res; }).catch(() => caches.match(e.request, { ignoreVary: true })));
    return;
  }
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h)) && (/\/\d+\/\d+\/\d+/.test(url.pathname) || url.pathname.includes("/fonts/") || url.search.includes("GetTile"))) {
    // cache-first for map tiles (opaque responses are fine for <img>)
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await caches.match(e.request, { ignoreVary: true });   // offlinekartan eller tidigare visade bitar
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
    // cache: "no-cache" = fråga alltid servern om filen ändrats (GitHub Pages låter annars webbläsaren använda en gammal kopia i upp till 10 min)
    e.respondWith(fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then(res => { if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); } return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  // övrigt: stale-while-revalidate
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
