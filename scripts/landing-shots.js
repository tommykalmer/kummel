// Tar skärmbilder till landningssidan (körs i GitHub Actions, där flygbilderna från MML går att nå).
// node scripts/landing-shots.js <utmapp>
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.resolve(process.argv[2] || "shots");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0])); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ""), type = TYPES[path.extname(f)] || "application/octet-stream";
  if (m) { const a = +m[1], b = Math.min(m[2] ? +m[2] : size - 1, size - 1); res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${size}`, "Content-Length": b - a + 1, "Accept-Ranges": "bytes" }); fs.createReadStream(f, { start: a, end: b }).pipe(res); }
  else { res.writeHead(200, { "Content-Type": type, "Content-Length": size }); fs.createReadStream(f).pipe(res); }
}).listen(8766);
const ONLY = (process.argv[3] || "").split(",").filter(Boolean);
const SHOTS = [
  { name: "sat-dator", dev: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 }, view: { lat: 60.093, lng: 19.955, z: 13.4 } },
  { name: "sat-mobil", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.098, lng: 19.968, z: 12.5 }, groups: { satdepth: false } },
  { name: "sat-mobil2", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.05, lng: 20.03, z: 12.2 } },
  { name: "sat-prop", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.0225, lng: 19.985, z: 13.6 }, groups: { satdepth: false }, props: true },
  { name: "sat-prop-dator", dev: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 }, view: { lat: 60.024, lng: 19.99, z: 14.3 }, groups: { satdepth: false }, props: true },
  { name: "flode-mobil", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.15, lng: 20.0, z: 8.6 }, base: "chart", wx: "flow" },
  // panelerna: run körs i sidan efter att kartan laddat (async, sleep finns)
  { name: "prognos", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.09, lng: 19.94, z: 11 }, base: "chart",
    run: `openWx(); await sleep(5000); setSheetState($("#sheet"), 2, true); await sleep(600); document.querySelector('[data-fct="p"]').click(); await sleep(400); const b = $("#sh-body"); const t = document.querySelector(".fc-tabs"); if (b && t) b.scrollTop = t.offsetTop - 70;` },
  { name: "prognos7", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.09, lng: 19.94, z: 11 }, base: "chart",
    run: `openWx(); await sleep(5000); setSheetState($("#sheet"), 2, true); await sleep(600); const d = document.querySelector(".fc-days"); d && d.closest(".card").scrollIntoView({ block: "end" });` },
  { name: "aissok", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.09, lng: 19.94, z: 11 }, base: "chart",
    run: `openShipSearch(); await sleep(6000); const q = $("#ss-q"); q.value = "viking"; q.dispatchEvent(new Event("input")); q.blur(); await sleep(800); setSheetState($("#sheet"), 2, true); await sleep(600);` },
  { name: "fiskelage", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.09, lng: 19.94, z: 12 }, base: "chart", mode: "fiske",
    run: `openFishIndex(); await sleep(5000); setSheetState($("#sheet"), 2, true); await sleep(500); const b = document.querySelector(".idx-bars button.best:not([data-k='0'])"); b && b.click(); await sleep(400);` },
  { name: "rutt", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.07, lng: 20.15, z: 10 }, base: "chart",
    run: `await autoRoute({ lat: 60.0985, lng: 19.9265 }, { lat: 60.0338, lng: 20.3862 }); await sleep(3000); const h = map.getContainer().clientHeight; map.fitBounds(boundsOf(wps.map(ll)), { padding: { top: 120, left: 40, right: 90, bottom: Math.round(h * .45) }, duration: 0 }); await sleep(4000);` },
  { name: "flode-dator", dev: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 }, view: { lat: 60.05, lng: 21.9, z: 7.4 }, base: "chart", wx: "flow" },
].filter(s => !ONLY.length || ONLY.includes(s.name));
(async () => {
  const b = await chromium.launch();
  for (const s of SHOTS) {
    const c = await b.newContext(s.dev);
    await c.route("https://www.googletagmanager.com/**", r => r.abort());
    await c.addInitScript(([v, g, base, props, wxm, mode]) => localStorage.setItem("kummel.v1", JSON.stringify({ termsOk: 9, welcomed: 1, stats: 0, v2: 1, v3: 1, autoAck: 1, layersSeen: 1, a2hsTip: 1, bkOff: 1, mode: mode || "tur", view: v, wxMode: wxm || "wind", layers: { base, props, detail: false, detailZoom: 13, soundings: true, groups: g || {} } })), [s.view, s.groups, s.base || "sat", !!s.props, s.wx, s.mode]);
    const p = await c.newPage(); p.on("pageerror", e => console.log("ERR", e.message));
    await p.goto("http://localhost:8766/index.html"); await p.waitForTimeout(4000);
    await p.evaluate(v => { try { setFollow(false, true); } catch (e) {} map.jumpTo({ center: [v.lng, v.lat], zoom: v.z, bearing: 0 }); }, s.view);
    await p.waitForTimeout(9000);
    if (s.wx) { await p.click("#b-wx"); await p.waitForTimeout(8000); }
    if (s.run) { try { await p.evaluate(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); ${s.run} })()`); } catch (e) { console.log("ERR run", s.name, e.message); } }
    if (s.tapDepth) { const vp = p.viewportSize(); await p.mouse.click(vp.width * .42, vp.height * .45); await p.waitForTimeout(2500); }
    await p.evaluate(() => document.querySelectorAll("#toast,.toast,#consent,.consent,#b-follow").forEach(x => x.style.display = "none"));
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, s.name + ".png") }); console.log("shot", s.name);
    await c.close();
  }
  await b.close(); server.close(); process.exit(0);
})();
