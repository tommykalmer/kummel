const fs=require("fs"); const f=process.argv[2]; const m=require(require("path").resolve(f));
for (const l of [0,1]) { const p=__dirname+"/dict-"+["fi","en"][l]+".json"; const d=JSON.parse(fs.readFileSync(p,"utf8")); for (const [k,v] of Object.entries(m)) d[k]=v[l]; fs.writeFileSync(p, JSON.stringify(d,null,1)); }
console.log("merged", Object.keys(m).length);
