// Collects every translation key: Tr`` templates in app.js, static text in index.html, and a few extras.
const fs = require("fs"), acorn = require("acorn"), walk = require("acorn-walk");
const R = process.argv[2];
const src = fs.readFileSync(R + "/app.js", "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", locations: true });
const keys = new Map();
const add = (k, where) => { if (!k.trim()) return; if (!keys.has(k)) keys.set(k, where); };
walk.full(ast, n => {
  if (n.type === "TaggedTemplateExpression" && n.tag.type === "Identifier" && n.tag.name === "Tr") {
    const q = n.quasi.quasis.map(x => x.value.cooked);
    add(q.reduce((a, x, i) => a + "{" + (i - 1) + "}" + x), "app.js:" + n.loc.start.line);
  }
});
// index.html: text nodes and attributes inside <body>, outside noscript/script/style/svg paths
let html = fs.readFileSync(R + "/index.html", "utf8");
let body = html.slice(html.indexOf("<body>"));
body = body.replace(/<noscript>[\s\S]*?<\/noscript>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
for (const m of body.matchAll(/>([^<>]+)</g)) { const t = m[1].trim(); if (/[A-Za-zÅÄÖåäö]{2}/.test(t)) add(t.replace(/&amp;/g, "&"), "index.html"); }
for (const m of body.matchAll(/\s(?:title|aria-label|placeholder)="([^"]+)"/g)) add(m[1], "index.html attr");
// extras: data shown via Lx and chartstyle, page title
["Gädda", "Abborre", "Gös", "Havsöring", "Lax", "Sik", "Strömming", "Torsk", "Braxen", "Annan", "Fel på sjömärke", "Sjökort: Traficom",
 "Kummel – sjökort för Åland, Åboland och Nyland"].forEach(k => add(k, "extra"));
const out = [...keys].map(([k, w]) => ({ k, w }));
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(out.length, "keys,", out.reduce((a, x) => a + x.k.length, 0), "chars");
