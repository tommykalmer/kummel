#!/usr/bin/env bash
# Diagnostik: ENC-lagret i Traficoms Oskari
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
curl -s -m 60 "https://julkinen.traficom.fi/oskari/action?action_route=GetHierarchicalMapLayerGroups&lang=fi" -o /tmp/o.json
python3 - >> $out <<'PY'
import json
d=json.load(open('/tmp/o.json'))
hits=[]
def walk(x):
  if isinstance(x,dict):
    s=json.dumps(x,ensure_ascii=False)
    if any(k in s for k in ("ENC","Kaikki kartat","Veneilykartat")) and len(s)<3000 and ("id" in x): hits.append(x)
    for v in x.values(): walk(v)
  elif isinstance(x,list):
    for v in x: walk(v)
walk(d)
seen=set()
for h in hits:
  k=json.dumps(h,ensure_ascii=False)
  if k in seen: continue
  seen.add(k); print("  RAW", k[:600])
ids=set()
def ids_of(x):
  if isinstance(x,dict):
    if "ENC" in json.dumps(x.get("name",""))+json.dumps(x.get("title","")) and isinstance(x.get("id"),(int,str)): ids.add(str(x["id"]))
    for v in x.values(): ids_of(v)
  elif isinstance(x,list):
    for v in x: ids_of(v)
ids_of(d)
open('/tmp/ids','w').write("\n".join(sorted(ids)))
print("  ids", sorted(ids))
PY
for id in $(cat /tmp/ids | head -8); do
  echo "## DescribeLayer $id" >> $out
  curl -s -m 30 "https://julkinen.traficom.fi/oskari/action?action_route=DescribeLayer&id=$id&lang=fi&srs=EPSG:3857" | head -c 1500 >> $out; echo >> $out
done
cat $out
