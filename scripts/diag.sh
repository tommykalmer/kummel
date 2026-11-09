#!/usr/bin/env bash
out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
S=$(date -u -d '-30 hours' +%Y-%m-%dT%H:00:00Z)
echo "## stationer (namn, fmisid, pos)" >> $out
curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::mareograph::timevaluepair&parameters=WATLEV&starttime=$(date -u -d '-2 hours' +%Y-%m-%dT%H:00:00Z)" > /tmp/m.xml
python3 - >> $out <<'PY'
import re
x=open('/tmp/m.xml').read()
for blk in re.findall(r'<target:Location.*?</target:Location>', x, re.S):
  i=re.search(r'fmisid">(\d+)',blk); n=re.search(r'locationcode/name">([^<]+)',blk); p=re.search(r'<gml:pos>([^<]+)',x[x.find(blk):])
  print('-', n and n.group(1), i and i.group(1))
PY
for id in 134252 134253 100669; do
 echo "## Degerby? fmisid $id WATLEV + N2000" >> $out
 curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::mareograph::simple&fmisid=$id&parameters=WATLEV,WLEVN2K&starttime=$(date -u -d '-3 hours' +%Y-%m-%dT%H:00:00Z)" | grep -o "<BsWfs:pos>[^<]*\|<BsWfs:Time>[^<]*\|<BsWfs:ParameterName>[^<]*\|<BsWfs:ParameterValue>[^<]*\|ExceptionText>[^<]*" | sed 's/<[^>]*>//' | paste -sd' ' | head -c 900 >> $out; echo >> $out
done
echo "## prognos Degerby (namn per parameter)" >> $out
curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::forecast::sealevel::point::simple&latlon=60.03,20.38&timestep=60" | grep -o "<BsWfs:Time>[^<]*\|<BsWfs:ParameterName>[^<]*\|<BsWfs:ParameterValue>[^<]*" | sed 's/<[^>]*>//' | paste -sd' ' | head -c 900 >> $out; echo >> $out
curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=describeStoredQueries&storedquery_id=fmi::forecast::sealevel::point::simple" | grep -io "<Abstract>[^<]*\|parameters[^<]\{0,200\}" | head -5 >> $out
cat $out
