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
}).listen(8777);
const SHOTS = [
  { name: "sat-dator", dev: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5 }, view: { lat: 60.093, lng: 19.955, z: 13.4 } },
  { name: "sat-mobil", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.098, lng: 19.968, z: 12.5 }, groups: { satdepth: false } },
  { name: "sat-mobil2", dev: { ...devices["iPhone 13"], deviceScaleFactor: 2 }, view: { lat: 60.05, lng: 20.03, z: 12.2 } },
];
(async () => {
  const b = await chromium.launch();
  for (const s of SHOTS) {
    const c = await b.newContext(s.dev);
    await c.route("https://www.googletagmanager.com/**", r => r.abort());
    await c.addInitScript(([v, g]) => localStorage.setItem("kummel.v1", JSON.stringify({ termsOk: 9, welcomed: 1, stats: 0, v2: 1, v3: 1, autoAck: 1, view: v, layers: { base: "sat", detail: false, detailZoom: 13, soundings: true, groups: g || {} } })), [s.view, s.groups]);
    const p = await c.newPage(); p.on("pageerror", e => console.log("ERR", e.message));
    await p.goto("http://localhost:8777/index.html"); await p.waitForTimeout(4000);
    await p.evaluate(v => { try { setFollow(false, true); } catch (e) {} map.jumpTo({ center: [v.lng, v.lat], zoom: v.z, bearing: 0 }); }, s.view);
    await p.waitForTimeout(9000);
    if (s.tapDepth) { const vp = p.viewportSize(); await p.mouse.click(vp.width * .42, vp.height * .45); await p.waitForTimeout(2500); }
    await p.evaluate(() => document.querySelectorAll("#toast,.toast,#consent,.consent,#b-follow").forEach(x => x.style.display = "none"));
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, s.name + ".png") }); console.log("shot", s.name);
    await c.close();
  }
  await b.close(); server.close();
})();
