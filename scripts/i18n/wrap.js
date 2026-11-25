// Wraps user-facing string/template literals in app.js with the Tr`` tag.
const fs = require("fs"), { execSync } = require("child_process");
const file = process.argv[2];
execSync(`node ${__dirname}/scan.js ${file} ${__dirname}/cands2.json`);
let src = fs.readFileSync(file, "utf8");
const cands = require(__dirname + "/cands2.json");
const lines = src.split("\n");
const SKIPTXT = new Set(["hård", "stilla", "lagom", "frisk", "Time", "Marina", "Anchor", "Fuel", "rock-under", "Kummel"]);
const SKIPLINE = /const (SPECIES|DAYS|MONTHS|COMPASS)\b|^\s*(fi|en): \[/;
let n = 0;
const keep = cands.filter(c => {
  if (SKIPTXT.has(c.text)) return false;
  if (c.c === "ARG:sw" || c.c === "ARG:ic" || c.c === "ARG:Error" || c.c === "ARG:getElementsByTagNameNS") return false;
  if (SKIPLINE.test(lines[c.line - 1])) return false;
  if (/^\s*(function Tr|const key = )/.test(lines[c.line - 1])) return false;
  return true;
});
// replace from the end so offsets stay valid
keep.sort((a, b) => b.s - a.s);
for (const c of keep) {
  if (c.kind === "tpl") src = src.slice(0, c.s) + "Tr" + src.slice(c.s);
  else src = src.slice(0, c.s) + "Tr`" + c.text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`" + src.slice(c.e);
  n++;
}
fs.writeFileSync(file, src);
console.log("wrapped", n, "of", cands.length);
