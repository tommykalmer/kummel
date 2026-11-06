# Diagnostik Fri Nov  6 08:33:54 UTC 2026
## DNS
### kummel.app
185.199.110.153
185.199.111.153
185.199.108.153
185.199.109.153
2606:50c0:8003::153
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
### www.kummel.app
tommykalmer.github.io.
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
tommykalmer.github.io.
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
tommykalmer.github.io.
## Pages
{
  "url": "https://api.github.com/repos/tommykalmer/kummel/pages",
  "status": "built",
  "cname": "www.kummel.app",
  "custom_404": false,
  "html_url": "http://www.kummel.app/",
  "build_type": "legacy",
  "source": {
    "branch": "main",
    "path": "/"
  },
  "public": true,
  "protected_domain_state": null,
  "pending_domain_unverified_at": null,
  "https_enforced": false
}

## HTTP
### https://tommykalmer.github.io/kummel/
301 -> http://www.kummel.app/ ssl=0
### http://kummel.app/
301 -> http://www.kummel.app/ ssl=0
### http://www.kummel.app/
200 ->  ssl=0
### https://www.kummel.app/
curl: (60) SSL: no alternative certificate subject name matches target host name 'www.kummel.app'
More details here: https://curl.se/docs/sslcerts.html

curl failed to verify the legitimacy of the server and therefore could not
establish a secure connection to it. To learn more about this situation and
how to fix it, please visit the web page mentioned above.
000 ->  ssl=1
### https://kummel.app/
curl: (60) SSL: no alternative certificate subject name matches target host name 'kummel.app'
More details here: https://curl.se/docs/sslcerts.html

curl failed to verify the legitimacy of the server and therefore could not
establish a secure connection to it. To learn more about this situation and
how to fix it, please visit the web page mentioned above.
000 ->  ssl=1
