#!/usr/bin/env bash
# Diagnostik: vattenstånd på Åland (FMI mareografer), parametrar och prognos
out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
B="19.0,59.7,21.4,60.7"; S=$(date -u -d '-6 hours' +%Y-%m-%dT%H:%M:00Z)
for p in WATLEV WLEVN2K_PT1S_AVG WATLEV_PT1H_AVG; do
  echo "## obs $p" >> $out
  curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::mareograph::simple&bbox=$B&parameters=$p&starttime=$S" | python3 -c "
import sys,re; x=sys.stdin.read()
import xml.etree.ElementTree as E
r=E.fromstring(x) if x.strip().startswith('<') else None
if r is None: print(x[:300]); sys.exit()
for el in r.iter():
  if el.tag.endswith('BsWfsElement'):
    pos=[e.text for e in el.iter() if e.tag.endswith('pos')][0]; t=[e.text for e in el.iter() if e.tag.endswith('Time')][0]; v=[e.text for e in el.iter() if e.tag.endswith('ParameterValue')][0]
    print(' ',pos.strip(),t,v)
print(x[:400] if 'Exception' in x else '')" | tail -8 >> $out
done
echo "## stationer" >> $out
curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::mareograph::timevaluepair&bbox=$B&parameters=WATLEV&starttime=$S" | grep -o '<gml:name codeSpace="http://xml.fmi.fi/namespace/locationcode/name">[^<]*\|<gml:identifier codeSpace="http://xml.fmi.fi/namespace/stationcode/fmisid">[^<]*' | sed 's/.*>//' | sort -u >> $out
echo "## prognos" >> $out
for q in "fmi::forecast::sealevel::point::simple" ; do for par in SeaLevel SeaLevelN2000; do
 echo "### $q $par" >> $out
 curl -s -m 60 "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=$q&latlon=60.04,20.38&parameters=$par&timestep=60" | grep -o "<BsWfs:Time>[^<]*</BsWfs:Time>\|<BsWfs:ParameterValue>[^<]*\|ExceptionText>[^<]*" | head -8 >> $out
done; done
cat $out
