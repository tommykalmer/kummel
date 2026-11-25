// Merges index-based translations (tr*.js, against keys.json at the time) and key-based ones (dict-*.json)
// into lang/fi.js and lang/en.js, and checks placeholders and HTML markup.
const fs = require("fs"), path = require("path");
const D = __dirname, R = process.argv[2];
const keys = JSON.parse(fs.readFileSync(D + "/keys.json", "utf8")).map(x => x.k);
const dict = { fi: {}, en: {} };
// stored key-based dictionaries (survive re-extraction)
for (const l of ["fi", "en"]) if (fs.existsSync(`${D}/dict-${l}.json`)) Object.assign(dict[l], JSON.parse(fs.readFileSync(`${D}/dict-${l}.json`, "utf8")));
if (process.argv[3] === "--from-index") {
  for (const f of fs.readdirSync(D).filter(f => /^tr\d+\.js$/.test(f))) {
    const m = require(D + "/" + f);
    for (const [i, [fi, en]] of Object.entries(m)) { const k = keys[+i]; dict.fi[k] = fi; dict.en[k] = en; }
  }
  for (const l of ["fi", "en"]) fs.writeFileSync(`${D}/dict-${l}.json`, JSON.stringify(dict[l], null, 1));
}
const tags = s => (s.match(/<[^>]+>/g) || []).map(t => t.replace(/\s(title|aria-label|placeholder|alt|href)="[^"]*"/g, ""));
const ph = s => (s.match(/\{\d+\}/g) || []).sort().join();
let bad = 0, missing = [];
for (const k of keys) for (const l of ["fi", "en"]) {
  const t = dict[l][k];
  if (t == null) { if (l === "fi") missing.push(k); continue; }
  if (ph(t) !== ph(k)) { bad++; console.log(`PH ${l}:`, JSON.stringify(k).slice(0, 90)); }
  if (tags(t).join("") !== tags(k).join("")) { bad++; console.log(`TAG ${l}:`, JSON.stringify(k).slice(0, 90)); const a = tags(k), b = tags(t); for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { console.log("   ", a[i], "|", b[i]); break; } }
}
console.log("missing", missing.length); missing.slice(0, 40).forEach(k => console.log("  -", JSON.stringify(k).slice(0, 120)));
console.log("problems", bad);
if (R) {
  fs.mkdirSync(R + "/lang", { recursive: true });
  for (const l of ["fi", "en"]) {
    const used = {}; for (const k of keys) if (dict[l][k] != null) used[k] = dict[l][k];
    fs.writeFileSync(`${R}/lang/${l}.js`, `/* Kummel – ${l === "fi" ? "suomi" : "English"}. Nyckel = svensk text, {0} = värde. Genereras från scripts/i18n. */\nwindow.KUMMEL_I18N = ${JSON.stringify(used)};\n`);
  }
}
