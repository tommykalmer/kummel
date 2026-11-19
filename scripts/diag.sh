#!/usr/bin/env bash
# Diagnostik: tål MML och mml.kummel.app många rutor på en gång? (som när man zoomar in i appen)
out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
burst() { # $1 = namn, $2 = url-mall med X och Y, $3 = startx, $4 = starty
  for i in $(seq 0 47); do
    x=$(( $3 + i % 8 )); y=$(( $4 + i / 8 )); u=${2//XX/$x}; u=${u//YY/$y}
    curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://www.kummel.app" -H "Referer: https://www.kummel.app/" "$u" &
  done > /tmp/r; wait
  echo "- $1: $(sort /tmp/r | uniq -c | tr '\n' ' ')" >> $out
}
# rutor som ingen har tittat på (öster om Mariehamn, z18)
burst "MML direkt, 48 rutor samtidigt" "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/18/YY/XX.jpg?api-key=$MML_KEY" 145700 76000
burst "via mml.kummel.app, nya rutor" "https://mml.kummel.app/ortokuva/18/YY/XX.jpg" 145720 76010
burst "via mml.kummel.app, samma rutor igen" "https://mml.kummel.app/ortokuva/18/YY/XX.jpg" 145720 76010
cat $out
