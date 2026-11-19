#!/usr/bin/env bash
# Diagnostik: svarar mml.kummel.app (Cloudflare Worker) rätt?
out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
t() { echo "- $1 $(curl -s -o /dev/null -w '%{http_code} %{size_download} B %{content_type} cf=' -D /tmp/h -H "Origin: https://www.kummel.app" -H "Referer: https://www.kummel.app/" ${2:-} "https://mml.kummel.app/$1")$(grep -i '^cf-cache-status' /tmp/h | tr -d '\r' | cut -d' ' -f2) acao=$(grep -i '^access-control-allow-origin' /tmp/h | tr -d '\r' | cut -d' ' -f2)" >> $out; }
t ortokuva/16/37128/72830.jpg
t ortokuva/16/37128/72830.jpg
t ortokuva/18/148511/291322.jpg
t kiinteistojaotus/16/37128/72830.png
echo "- främmande sida: $(curl -s -o /dev/null -w '%{http_code}' -H 'Referer: https://evil.example/' https://mml.kummel.app/ortokuva/16/37128/72830.jpg)" >> $out
cat $out
