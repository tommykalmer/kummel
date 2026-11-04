#!/usr/bin/env bash
# Diagnostik: Maanmittauslaitos terrängdatabas (OGC API Features), samlingar för stenar och grund
key=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
base="https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
curl -s -m 60 "$base/collections?api-key=$key&f=json" -o /tmp/c.json
python3 - >> $out <<'PY'
import json
d=json.load(open('/tmp/c.json'))
cs=d.get('collections',[])
print("antal samlingar:",len(cs))
for c in cs:
  t=(c.get('id','')+' '+c.get('title','')).lower()
  if any(k in t for k in ('kivi','kari','luoto','sten','rock','vesi','syvyys','matal')):
    print("-",c.get('id'),"|",c.get('title'))
open('/tmp/ids','w').write("\n".join(c['id'] for c in cs if any(k in (c.get('id','')+c.get('title','')).lower() for k in ('kivi','kari'))))
PY
for id in $(cat /tmp/ids); do
  echo "## $id" >> $out
  curl -s -m 60 "$base/collections/$id/items?api-key=$key&f=json&bbox=19.85,60.0,20.05,60.12&limit=5" -o /tmp/i.json
  python3 -c "
import json; d=json.load(open('/tmp/i.json')); f=d.get('features',[]); print('  träffar:',d.get('numberMatched'),'returnerade',len(f))
for x in f[:3]: print('  ',json.dumps(x)[:400])" >> $out
done
cat $out
