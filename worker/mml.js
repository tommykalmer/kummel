/* Kummel – mellanhand för Lantmäteriverkets (MML) öppna karttjänst på mml.kummel.app
   - API-nyckeln ligger som hemlighet i Cloudflare (MML_KEY) och syns aldrig i appen
   - varje bildruta sparas hos Cloudflare i 30 dagar, så MML får bara en förfrågan per ruta
   - bara www.kummel.app (och lokal testning) får använda den */
const LAYERS = /^\/(ortokuva|kiinteistojaotus|taustakartta|maastokartta)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(jpg|png)$/;
const ORIGIN_OK = o => /^https:\/\/(www\.)?kummel\.app$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
const TTL = 60 * 60 * 24 * 30;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ORIGIN_OK(origin) ? origin : "https://www.kummel.app", "Vary": "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET, HEAD", "Access-Control-Max-Age": "86400" } });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("", { status: 405 });
    if (url.pathname === "/") return new Response("Kummel – kartrutor från Maanmittauslaitos", { headers: cors });
    const m = url.pathname.match(LAYERS);
    if (!m) return new Response("", { status: 404, headers: cors });
    // stoppa andra webbplatser som försöker använda rutorna
    const ref = req.headers.get("Referer") || "";
    if ((origin && !ORIGIN_OK(origin)) || (ref && !/^(https:\/\/(www\.)?kummel\.app|http:\/\/localhost)/.test(ref))) return new Response("", { status: 403 });

    const cache = caches.default, key = new Request(url.origin + url.pathname);
    let res = await cache.match(key);
    if (!res) {
      const [, layer, z, y, x, ext] = m;
      const up = await fetch(`https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/${z}/${y}/${x}.${ext}?api-key=${env.MML_KEY}`);
      if (!up.ok) return new Response("", { status: up.status === 404 ? 404 : 502, headers: { ...cors, "Cache-Control": up.status === 404 ? "public, max-age=86400" : "no-store" } });
      res = new Response(up.body, { headers: { "Content-Type": up.headers.get("Content-Type") || (ext === "png" ? "image/png" : "image/jpeg"), "Cache-Control": `public, max-age=${TTL}` } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
};
