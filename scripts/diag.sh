#!/usr/bin/env bash
# Diagnostik: egen domän (DNS, GitHub Pages, HTTPS)
out=data/diag.md
{
echo "# Diagnostik $(date -u)"
echo "## DNS"; for n in kummel.app www.kummel.app; do echo "### $n"; dig +short A $n; dig +short AAAA $n; dig +short CNAME $n; done
echo "## Pages"; curl -s -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/$GITHUB_REPOSITORY/pages | head -c 1500; echo
echo "## HTTP"
for u in https://tommykalmer.github.io/kummel/ http://kummel.app/ http://www.kummel.app/ https://www.kummel.app/ https://kummel.app/; do echo "### $u"; curl -sS -o /dev/null -m 20 -w "%{http_code} -> %{redirect_url} ssl=%{ssl_verify_result}\n" "$u" 2>&1; done
} > $out
cat $out
