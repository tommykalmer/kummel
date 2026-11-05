#!/usr/bin/env bash
# Diagnostik: Väyläviraston tietokuvaus (xlsx) – koder för vattentrafikmärken (vlmlajityyppi m.fl.)
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
pip install --quiet --break-system-packages openpyxl 2>/dev/null || pip install --quiet openpyxl
curl -sSL -A "Mozilla/5.0 kummel-diag" -w "http %{http_code} %{url_effective}\n" -m 120 "https://ava.vaylapilvi.fi/ava/Muut/Paikkatietopalvelut/Tietokuvaus/Vesivayla-_ja_rataverkkoaineistojen_tietokuvaus.xlsx" -o /tmp/t.xlsx >> $out 2>&1
file /tmp/t.xlsx >> $out 2>&1
curl -sS -m 60 "https://avoinapi.vaylapilvi.fi/vaylatiedot/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=vesivaylatiedot:vesiliikennemerkit_uusi" | head -c 4000 >> $out
echo >> $out
ls -la /tmp/t.xlsx >> $out
python3 - >> $out <<'PY'
import openpyxl
import sys
try:
  wb = openpyxl.load_workbook('/tmp/t.xlsx', read_only=True, data_only=True)
except Exception as e:
  print('xlsx fel', e); sys.exit()
print("blad:", wb.sheetnames)
keys = ("vlm", "liikennemerk", "pata", "pako", "kaapeli", "ankkur")
for ws in wb.worksheets:
    hit = 0
    for row in ws.iter_rows(values_only=True):
        s = " | ".join("" if v is None else str(v) for v in row)
        if any(k in s.lower() for k in keys):
            print(f"[{ws.title}] {s[:400]}"); hit += 1
            if hit > 400: break
PY
cat $out | head -50
