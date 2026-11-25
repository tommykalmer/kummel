// Lists string/template literals in a JS file that look like user-facing (Swedish) text.
const fs = require("fs"), acorn = require("acorn"), walk = require("acorn-walk");
const file = process.argv[2], src = fs.readFileSync(file, "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", locations: true, sourceType: "script" });
const out = [];
const SKIPCALL = /^(\$|\$\$|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|getLayer|getSource|setLayoutProperty|setPaintProperty|setFilter|removeLayer|removeSource|addSource|track|fetch|setItem|getItem|removeItem|toggle|add|remove|contains|setProperty|getPropertyValue|createElement|matchMedia|on|off|once|setAttribute|getAttribute|hasAttribute|removeAttribute|closest|startsWith|endsWith|includes|split|join|replace|replaceAll|match|test|indexOf|padStart|toFixed|tileUrl|loadImage|hasImage|addImage|postMessage|open)$/;
function looksText(s) {
  if (!s || !/[A-Za-zÅÄÖåäö]/.test(s)) return false;
  if (/^https?:|^data:|^\/|^#[\w-]+$|^\.[\w-]+|^rgba?\(|^#[0-9a-f]{3,8}$/i.test(s.trim())) return false;
  if (/[åäöÅÄÖ]/.test(s)) return true;
  if (/^[A-ZÅÄÖ][a-zåäö]{1,}( [a-zåäö0-9]+)*$/.test(s.trim()) && !/^(Arial|Noto|Open|Metropolis|Roboto|Inter|Barlow|Source|Point|LineString|Polygon|Feature|FeatureCollection|MultiPolygon|MultiLineString|Error|GET|POST|Escape|Enter|Infinity|Math)/.test(s.trim())) return true;
  const t = s.replace(/<[^>]*>/g, " ").replace(/\$\{[^}]*\}/g, " ");
  // two+ words of letters or a capitalised word
  if (/[A-Za-z]{2,}\s+[a-z]{2,}/.test(t) && !/^[\w-]+(\s+[\w-]+)*$/.test(t.trim()) ) return true;
  if (/\b(och|för|med|inte|är|som|på|till|från|nu|av|om|eller|din|ditt|dina|kl|i dag|under|över)\b/.test(t)) return true;
  return false;
}
function ctx(node, anc) {
  const p = anc[anc.length - 2];
  if (!p) return "";
  if (p.type === "Property" && p.key === node) return "KEY";
  if (p.type === "MemberExpression" && p.property === node) return "MEMBER";
  if (p.type === "CallExpression" || p.type === "NewExpression") {
    const c = p.callee, n = c.type === "Identifier" ? c.name : c.type === "MemberExpression" && !c.computed ? c.property.name : "";
    if (SKIPCALL.test(n) && p.arguments[0] === node) return "CALL:" + n;
    return "ARG:" + n;
  }
  if (p.type === "BinaryExpression" && /===|!==|==|!=/.test(p.operator)) return "CMP";
  return p.type;
}
walk.fullAncestor(ast, (node, st, anc) => {
  if (node.type === "Literal" && typeof node.value === "string") {
    if (!looksText(node.value)) return;
    const c = ctx(node, anc); if (/^(KEY|MEMBER|CMP|CALL:)/.test(c)) return;
    if (anc[anc.length - 2]?.type === "TaggedTemplateExpression") return;
    out.push({ s: node.start, e: node.end, line: node.loc.start.line, kind: "str", c, text: node.value });
  } else if (node.type === "TemplateLiteral") {
    const p = anc[anc.length - 2]; if (p?.type === "TaggedTemplateExpression") return;
    const raw = node.quasis.map(q => q.value.cooked).join("${}");
    if (!looksText(raw)) return;
    const c = ctx(node, anc); if (/^(CMP|CALL:)/.test(c)) return;
    out.push({ s: node.start, e: node.end, line: node.loc.start.line, kind: "tpl", c, text: raw });
  }
});
out.sort((a, b) => a.s - b.s);
fs.writeFileSync(process.argv[3] || "cands.json", JSON.stringify(out, null, 1));
console.log(out.length, "candidates");
