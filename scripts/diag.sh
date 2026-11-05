#!/usr/bin/env bash
# Diagnostik: Väyläviraston tietokuvaus (xlsx) – koder för vattentrafikmärken (vlmlajityyppi m.fl.)
out=data/diag.md
echo "# Diagnostik $(date -u)" > $out
pip install --quiet --break-system-packages openpyxl 2>/dev/null || pip install --quiet openpyxl
curl -sL -m 120 "https://ava.vaylapilvi.fi/ava/Muut/Paikkatietopalvelut/Tietokuvaus/Vesivayla-_ja_rataverkkoaineistojen_tietokuvaus.xlsx" -o /tmp/t.xlsx
ls -la /tmp/t.xlsx >> $out
python3 - >> $out <<'PY'
import openpyxl
wb = openpyxl.load_workbook('/tmp/t.xlsx', read_only=True, data_only=True)
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
