# Kummel

Sjökort, väder och båtliv i skärgården – som webbapp för mobil, iPad och dator.

## v0.1 innehåller
- Traficoms sjökort (Finland + Åland) ovanpå OpenStreetMap, OpenSeaMap-sjömärken, flygfoto
- GPS-position med fart (kn), kurs, kurslinje 10 min framåt och följ-läge
- Båtprofiler: typ, mått, djupgående, höjd, marschfart, förbrukning, vindgräns
- Ruttplanering med distans, kurs per sträcka, ETA, bränsle, vind längs rutten och mörkervarning
- Väder: vind/byar nu, 48 h vinddiagram, väderfönster mot båtens gräns, vatten- och lufttemp, våghöjd, tryck, sol upp/ned
- Lägen: Utflykt, Fiske, Segling, Paddling
- Fiske: Fisk!-knapp som sparar position + vind, tryck och trend, vattentemp och månfas; fångstlogg
- Egna platser (hamn, ankring, bad, fiske, service, varning) med anteckningar
- Spårinspelning, loggbok, GPX-export, MOB-knapp, nattläge (rött), säkerhetskopia
- PWA: installerbar, offline-cache av kartrutor du har tittat på

## Hosting
Helt statisk. Lägg filerna i ett GitHub-repo och slå på GitHub Pages (Settings → Pages → Deploy from branch → main / root). HTTPS krävs för GPS och offline.

## Datakällor och licens
- Sjökort: Traficom, CC BY 4.0. "Källa: Traficom. Ej för navigering. Uppfyller inte kraven för officiella sjökort."
- Sjömärken: OpenSeaMap · Bakgrund: OpenStreetMap, CARTO, Esri
- Väder: Open-Meteo (fri för icke-kommersiellt bruk; byt till FMI:s öppna data vid kommersiell lansering)

Kummel är inte ett certifierat navigationshjälpmedel.
