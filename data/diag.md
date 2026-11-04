# Diagnostik Wed Nov  4 11:19:19 UTC 2026
## AIS locations (radius)
    HTTP/2 200 
    content-type: application/json;charset=UTF-8
    access-control-expose-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
    access-control-allow-origin: *
    access-control-allow-methods: GET, POST, OPTIONS
    access-control-allow-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
    typ: dict keys: ['type', 'dataUpdatedTime', 'features']
    antal: 23
    exempel: {"mmsi": 230940100, "type": "Feature", "geometry": {"type": "Point", "coordinates": [20.274317, 60.207407]}, "properties": {"mmsi": 230940100, "sog": 3.8, "cog": 309.1, "navStat": 3, "rot": 0, "posAcc": true, "raim": false, "heading": 127, "timestamp": 12, "timestampExternal": 1793791153193}}
    exempel: {"mmsi": 230155020, "type": "Feature", "geometry": {"type": "Point", "coordinates": [20.267258, 60.067207]}, "properties": {"mmsi": 230155020, "sog": 0.1, "cog": 23.9, "navStat": 5, "rot": 0, "posAcc": true, "raim": false, "heading": 294, "timestamp": 28, "timestampExternal": 1793791108523}}
## AIS vessels (metadata)
    HTTP/2 200 
    content-type: application/json;charset=UTF-8
    access-control-expose-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
    access-control-allow-origin: *
    access-control-allow-methods: GET, POST, OPTIONS
    access-control-allow-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
    storlek: 198982 typ: list antal: 611
    exempel: {"callSign": "OH6222", "destination": "VALKO", "draught": 42, "eta": 664768, "imo": 6524682, "mmsi": 230091450, "name": "KALKKE", "posType": 1, "referencePointA": 5, "referencePointB": 25, "referencePointC": 4, "referencePointD": 4, "shipType": 52, "timestamp": 1793790262114}
    exempel: {"callSign": "OJQI", "destination": "FITOR", "draught": 36, "eta": 521152, "imo": 8521464, "mmsi": 230644000, "name": "LEONARDO", "posType": 1, "referencePointA": 6, "referencePointB": 23, "referencePointC": 6, "referencePointD": 3, "shipType": 52, "timestamp": 1793790267154}
## Preflight med Digitraffic-User
    HTTP/2 204 
    access-control-max-age: 86400
    access-control-allow-origin: *
    access-control-allow-methods: GET, POST, OPTIONS
    access-control-allow-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
    access-control-expose-headers: DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range,Digitraffic-User
