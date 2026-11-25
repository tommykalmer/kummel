# Bygger landningssidorna (om, sjokort-aland, fiske-aland, vattenstand-aland): python3 scripts/build-site.py
import json, os
R=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '')
SITE='https://www.kummel.app'
LOGO='<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#0f2a3d"/><g transform="translate(50 51) scale(.84) translate(-50 -51)"><path d="M50 16 L80 84 L20 84 Z" fill="#0053a5"/><rect x="18" y="63" width="64" height="9" fill="#ffce00"/><rect x="18" y="65.6" width="64" height="3.8" fill="#d21034"/></g></svg>'
FLAG='<svg viewBox="0 0 26 17" aria-label="Ålands flagga"><rect width="26" height="17" fill="#0053a5"/><rect x="7" width="5" height="17" fill="#ffce00"/><rect y="6" width="26" height="5" fill="#ffce00"/><rect x="8.5" width="2" height="17" fill="#d21034"/><rect y="7.5" width="26" height="2" fill="#d21034"/></svg>'
FAV="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230f2a3d'/%3E%3Cg transform='translate(50 51) scale(.84) translate(-50 -51)'%3E%3Cpath d='M50 16 L80 84 L20 84 Z' fill='%230053a5'/%3E%3Crect x='18' y='63' width='64' height='9' fill='%23ffce00'/%3E%3Crect x='18' y='65.6' width='64' height='3.8' fill='%23d21034'/%3E%3C/g%3E%3C/svg%3E"
NAV=[('/om/','Om Kummel'),('/sjokort-aland/','Sjökort'),('/fiske-aland/','Fiske'),('/vattenstand-aland/','Vattenstånd och väder')]
ICONS={
 'chart':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
 'route':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 19h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6"/></svg>',
 'wind':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/></svg>',
 'fish':'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 12c3-4 7-6 11-6 4 0 7 3 8 6-1 3-4 6-8 6-4 0-8-2-11-6zm0 0l-1-4v8z"/><circle cx="16" cy="11" r="1.2" fill="#0f2a3d"/></svg>',
 'wave':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/></svg>',
 'off':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>',
 'anchor':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13a7 7 0 0 0 14 0M9 10h6"/></svg>',
 'lock':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
 'plotter':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 13l3-4 3 2 4-5M9 21h6M12 17v4"/></svg>',
 'log':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/></svg>',
 'share':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
 'cloud':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/></svg>',
 'search':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
 'ship':'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l5 8-1 12H8L7 10z"/></svg>',
}
def card(ic,t,p): return f'<div class="card"><div class="ic">{ICONS[ic]}</div><h3>{t}</h3><p>{p}</p></div>'
def feature(kicker,h,body,items,img,cap,flip=False,alt=''):
    li=''.join(f'<li>{i}</li>' for i in items)
    return f'''<div class="feature{' flip' if flip else ''}"><div><div class="kicker">{kicker}</div><h2>{h}</h2><p>{body}</p><ul>{li}</ul></div>
<figure class="shot"><img src="/om/img/{img}.webp" width="585" height="996" loading="lazy" alt="{alt or cap}"><figcaption>{cap}</figcaption></figure></div>'''
def faq(qs): return ''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in qs)
def faqld(qs): return {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in qs]}
APPLD={"@context":"https://schema.org","@type":"WebApplication","name":"Kummel","url":SITE+"/","applicationCategory":"TravelApplication","operatingSystem":"Webbläsare (iPhone, Android, iPad, dator)","inLanguage":"sv","description":"Gratis sjökort, sjöväder, vattenstånd, ruttplanering och fiske för Åland, Åbolands skärgård och Nylands kust i webbläsaren.","offers":{"@type":"Offer","price":"0","priceCurrency":"EUR"},"publisher":{"@type":"Organization","name":"AsterIQ Ab","email":"kontakt@kummel.app","address":{"@type":"PostalAddress","addressLocality":"Mariehamn","addressCountry":"FI"}}}
DISC='<div class="disclaimer"><b>Kummel är inte ett sjökort för navigering.</b> Appen är ett hjälpmedel för planering och överblick och är inte certifierad för navigering. Djup, sjömärken, ruttförslag, ankomsttider och väder kan vara felaktiga eller inaktuella. Använd alltid officiella, uppdaterade sjökort och gott sjömanskap.</div>'
def band(h='Öppna kartan',p='Kummel är gratis och fungerar direkt i webbläsaren. Ingen nedladdning och inget konto. Lägg den på hemskärmen så öppnas den som en app.'):
    return f'<section class="band"><div class="wrap"><h2>{h}</h2><p>{p}</p><a class="btn" href="/">Öppna Kummel</a></div></section>'
def page(path,title,desc,body,lds=()):
    nav=''.join(f'<a href="{u}"{" aria-current=\"page\"" if u==path else ""}>{t}</a>' for u,t in NAV)
    ld=''.join(f'<script type="application/ld+json">{json.dumps(x,ensure_ascii=False)}</script>' for x in lds)
    html=f'''<!doctype html>
<html lang="sv-AX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}{path}">
<meta property="og:site_name" content="Kummel">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{SITE}/om/img/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:locale" content="sv_FI">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f2a3d">
<link rel="icon" href="{FAV}">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap">
<link rel="stylesheet" href="/om/site.css?v=6">
<script src="/config.js" defer></script>
<script src="/om/site.js?v=1" defer></script>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{{"token": "a2d2b8a2b7594062bd448afc0260661d"}}'></script>
{ld}
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/om/">{LOGO}Kummel</a><nav class="nav">{nav}<a class="btn" href="/">Öppna kartan</a></nav></div></header>
<main>
{body}
</main>
<footer><div class="wrap">
<div><a class="brand" href="/om/" style="margin-bottom:10px">{LOGO}Kummel</a><div>Sjökort, sjöväder och fiske för Åland, Åboland och Nyland.</div><div style="margin-top:10px">Kummel är en produkt från <b style="color:#fff">AsterIQ Ab</b>, Mariehamn<br>FO-nummer 3553529-1</div><div style="margin-top:10px">Kontakt: <a href="mailto:kontakt@kummel.app">kontakt@kummel.app</a></div></div>
<nav><b style="color:#fff">Sidor</b>{''.join(f'<a href="{u}">{t}</a>' for u,t in NAV)}<a href="/">Öppna kartan</a></nav>
<nav><b style="color:#fff">Källor</b><span>Sjökort: Traficom (CC BY 4.0)</span><span>Farleder och sjömärken: Väylävirasto</span><span>Flygbild och stenar: Lantmäteriverket</span><span>Vattenstånd: Meteorologiska institutet</span><span>Väder: Open-Meteo · AIS: Digitraffic</span></nav>
</div></footer>
</body>
</html>
'''
    os.makedirs(R+path.strip('/'),exist_ok=True)
    open(R+path.strip('/')+'/index.html','w').write(html)

# ---------------- /om/ ----------------
qs=[("Kostar Kummel något?","Nej. Kummel är gratis och kräver inget konto. Du öppnar den på www.kummel.app i webbläsaren på mobil, iPad eller dator."),
("Behöver jag ladda ner en app?","Nej. Kummel fungerar direkt i webbläsaren. På iPhone kan du välja Dela och sedan Lägg till på hemskärmen, så öppnas Kummel i helskärm som en vanlig app."),
("Vilket område täcker sjökortet?","Åland, Åbolands skärgård och Nylands kust: från Ålands hav och Eckerö i väster, genom Åboland med Åbo, Nådendal, Pargas och Kimito, längs kusten förbi Hangö, Ekenäs, Ingå, Esbo och Helsingfors till Pellinge utanför Borgå i öster."),
("Kan jag föra över rutter till plottern i båten?","Ja. Under Meny → Kartplotter (GPX) sparar du rutter, platser och turer som en GPX-fil, som Garmin, Raymarine, Simrad, B&G, Lowrance, Furuno och Navionics kan läsa. Lägg filen på plotterns minneskort eller dela den till tillverkarens app. Det går också åt andra hållet: rutter, waypoints och spår från plottern kan läsas in i Kummel."),
("Fungerar Kummel utan täckning?","Ja, om du laddar ner offlinekartan i förväg under Meny → Offlinekarta. Då fungerar sjökortet, positionen och dina sparade platser och rutter även ute i skärgården där täckningen är dålig. Väder och vattenstånd kräver nät."),
("Var sparas mina platser och fångster?","Bara i din egen telefon eller dator. Ingenting skickas till oss. Du kan flytta allt mellan mobil och dator med en säkerhetskopia."),
("Hur länge sparas mina rutter och fångster?","Tills du själv tar bort dem. Lägg Kummel på hemskärmen, så räknas den som en egen app och webbläsaren rensar inte bort något. Under Meny → Flytta och säkerhetskopiera sparar du en kopia av allt som en fil, och Kummel påminner dig försiktigt när det har samlats mycket nytt sedan förra gången."),
("Kan ruttförslaget gå över land eller grund?","Ruttförslaget håller sig till farlederna och till vatten som är tillräckligt djupt för din båt enligt sjökortet. Där sjökortet visar för grunt vatten ritar Kummel ingen väg alls, utan säger hur långt det är kvar och att du får navigera själv. Små holmar och stenar kan saknas i datan, så håll alltid utkik."),
("Kan jag få bort knapparna från kartan?","Ja. Tryck på den lilla pilen under menyknappen så döljs nästan alla knappar och kartan får hela skärmen. Fart, kurs, position och vattenstånd syns hela tiden. Ett tryck till så kommer knapparna tillbaka."),
("Hittade du ett fel i kartan, eller har du en idé?","Mejla <a href=\"mailto:kontakt@kummel.app\">kontakt@kummel.app</a>. Skriv gärna var felet finns. Vi läser allt och rapporterar fel i sjökortet vidare till rätt myndighet."),
("Kan jag navigera efter Kummel?","Nej. Kummel är ett hjälpmedel för planering och överblick, inte ett certifierat navigationssystem. Använd alltid officiella sjökort och gott sjömanskap.")]
body=f'''<section class="hero"><div class="wrap">
<div><div class="flagline">{FLAG}Sjökortet från Åland till Borgå</div>
<h1>Hela skärgården <em>i fickan.</em></h1>
<p class="lead">Kummel är ett gratis sjökort i mobilen för Åland, Åbolands skärgård och Nylands kust. Djup, sjömärken och grynnor, ruttförslag som håller sig borta från grunden, sjöväder med sju dygns prognos, vattenstånd, fartyg i realtid och ett eget fiskeläge. Öppna i webbläsaren och åk.</p>
<div class="cta"><a class="btn" href="/">Öppna kartan</a><a class="btn sec" href="#funktioner">Se funktionerna</a></div>
<div class="facts"><span>Gratis</span><span>Inget konto</span><span>Mobil, iPad och dator</span><span>Fungerar offline</span><span>Prognos sju dygn</span><span>GPX till plottern</span></div></div>
<div class="hero-shot"><img class="desk" src="/om/img/dator.webp" width="1600" height="955" alt="Kummel på datorn: sjökort över hamnarna i Mariehamn med farleder, sjömärken och djup" fetchpriority="high"><img class="phone" src="/om/img/karta.webp" width="585" height="996" alt="Kummel i mobilen med båtens position på sjökortet"></div>
</div></section>

<section id="funktioner"><div class="wrap">
<div class="kicker">Funktioner</div><h2>Allt du behöver innan och under turen</h2>
<p class="intro">Kummel samlar sjökort och väder från officiella källor i en enda karta, gjord för de vatten vi själva åker i.</p>
<div class="grid3">
{card('chart','Sjökort eller flygbild','Traficoms sjökort med djupkurvor, djupsiffror, grynnor, stenar, farleder, sjömärken och fyrsektorer. Eller flygbild med farleder, djup och fastighetsgränser.')}
{card('route','Ruttförslag som undviker grunden','Välj start och mål så föreslås en väg längs farlederna, runt land och vatten som är för grunt för din båt. Med distans, ankomsttid och bränsleåtgång. Dela rutten med en länk.')}
{card('wind','Sjöväder på kartan','Vind, byar, regn, våghöjd och vattentemperatur över hela skärgården, nu och tre dygn framåt. Vind och regn kan visas som färgfält som rör sig med vädret.')}
{card('cloud','Prognos för sju dygn','Tryck på väderknappen för hela prognosen: vind, lufttryck, temperatur, regn och vattenstånd timme för timme, och en översikt för veckan.')}
{card('wave','Vattenstånd','Aktuellt vattenstånd från närmaste mareograf med prognos. Grundvarningarna räknar med dagens vattenstånd.')}
{card('fish','Fiskeläge','Fisk!-knapp som sparar plats, väder och vattentemperatur. Branta kanter, fiskeläge efter väder och måne, och fångstlogg med foto.')}
{card('off','Offlinekarta','Ladda ner sjökortet i förväg, så fungerar kartan och positionen även där täckningen tar slut.')}
{card('anchor','Ankarlarm','Sätt ankarpunkt och radie. Kummel larmar med ljud och vibration om båten driver iväg.')}
{card('plotter','Till och från kartplottern','Rita rutter och spara platser hemma, och för över dem till plottern i båten som GPX. Rutter, waypoints och spår från plottern kan läsas in i Kummel.')}
{card('ship','Fartyg i realtid','Färjor och andra fartyg med namn, fart, kurs och destination, och ett foto på fartyget. Sök på namnet så visar kartan var fartyget är just nu.')}
{card('log','Loggbok','Tryck på Spela in så sparas turen med distans, tid och fart. Se den på kartan efteråt eller spara den som GPX.')}
{card('lock','Dina fiskeplatser är dina','Platser, rutter, loggbok och fångster sparas bara i din telefon. Ingen databas, inga konton. Ingen annan kan se dem, inte heller vi.')}
</div></div></section>

<section class="satsec"><div class="wrap">
<div class="kicker">Flygbild</div><h2>Sjökort eller flygbild, du väljer</h2>
<p class="intro">Byt till Lantmäteriverkets flygbilder under Kartlager. Farleder, sjömärken och djupområden ligger kvar ovanpå, och det som är för grunt för din båt färgas rött. Så ser du både hur stranden ser ut och var det går att åka.</p>
<figure class="satwide"><img src="/om/img/sat-dator.webp" width="1600" height="956" loading="lazy" alt="Flygbild över Mariehamns östra hamn med farleder, sjömärken och djupområden i Kummel"><figcaption>Flygbild med djupområden och farleder, Mariehamn</figcaption></figure>
<div class="satpair">
<figure class="shot"><img src="/om/img/sat-mobil.webp" width="585" height="996" loading="lazy" alt="Ren flygbild med farleder och sjömärken"><figcaption>Bara flygbild, farleder och sjömärken</figcaption></figure>
<figure class="shot"><img src="/om/img/sat-mobil2.webp" width="585" height="996" loading="lazy" alt="Flygbild där grunt vatten är färgat rött"><figcaption>Rött = för grunt för din båt</figcaption></figure>
</div>
<div class="satsplit">
<div><div class="kicker">Fastighetsgränser</div><h2>Var går gränsen?</h2>
<p class="intro">Slå på fastighetsgränser under Kartlager så ritas Lantmäteriverkets gränser ut på kartan när du zoomar in. Bra när du undrar var grannens tomt slutar, eller hur holmen du passerar är uppdelad.</p></div>
<figure class="shot"><img src="/om/img/sat-prop.webp" width="585" height="996" loading="lazy" alt="Fastighetsgränser i rött på flygbild i mobilen"><figcaption>Fastighetsgränser i mobilen</figcaption></figure>
</div>
<figure class="satwide"><img src="/om/img/sat-prop-dator.webp" width="1600" height="956" loading="lazy" alt="Fastighetsgränser ritade på flygbild över skärgården söder om Mariehamn"><figcaption>Fastighetsgränser på flygbild, skärgården söder om Mariehamn</figcaption></figure>
</div></section>
<section class="alt"><div class="wrap">
{feature('Båttur','Planera turen på några sekunder','Tryck på start och mål. Kummel föreslår en väg längs farlederna, och där farleden tar slut går förslaget runt land och vatten som är för grunt för din båt. Är resten för grunt enligt sjökortet ritas ingen väg alls, så att kartan aldrig lockar dig över ett grund. Sparade platser har en knapp för Rutt hit från där du är.',['Ruttförslag längs farlederna och runt grunden','Ankomsttid och bränsleåtgång efter din båt','Varning om byvind över din gräns under turen','Dela rutter med en länk eller för över dem till plottern som GPX'],'rutt','Ruttförslag från Mariehamn genom skärgården')}
{feature('Prognos','Hela vädret med ett tryck','Väderknappen uppe till höger visar vädret och vinden just nu. Tryck på den så öppnas prognosen för platsen där du är, eller där korset står på kartan. Byt mellan vind, lufttryck, temperatur, regn och vattenstånd för de kommande 48 timmarna, och se hela veckan i en översikt.',['Vind och byar mot din båts gräns','Lufttryck med tolkning: faller det, kommer ofta vinden','Temperatur, regn och vattenstånd timme för timme','Sju dygn i en överblick, med varning för hårda byar'],'prognos','Prognosen för lufttryck i väderpanelen',True)}
{feature('Sjöväder','Se vinden där du ska åka','Vindpilar med byar och våghöjd över hela skärgården, färgade efter din båts vindgräns. Dra i tidsreglaget för att se hur vädret ändras de kommande dygnen.',['Vind och byar, nu och framåt','Regn, våghöjd och vattentemperatur','Vindflöde i färg med rörliga linjer','Exakt vind och regn där du sätter korset'],'flode-mobil','Vindflöde över skärgården')}
{feature('Fartyg','Var är färjan?','Slå på fartyg under Kartlager så syns färjor, fraktfartyg och arbetsbåtar i realtid, med fart, kurs och destination. Undrar du var ett visst fartyg är? Sök på namnet i menyn, så flyger kartan dit och visar fartyget med foto.',['AIS-fartyg i realtid från Fintraffic','Sök på namn, MMSI eller IMO','Foto, fart, kurs och destination','Hur nära fartyget kommer dig'],'aissok','Sök fartyg i Kummel',True)}
{feature('Fiske','Läs kartan som en fiskare','I fiskeläget lyfter Kummel fram det som spelar roll för fisket: branta kanter där djupet ändras snabbt, stenar och grund, vattentemperatur och ett fiskeläge som väger ihop väder, lufttryck och måne. Fisk!-knappen sparar platsen med väder och vattentemperatur på ett tryck.',['Branta kanter markerade på sjökortet','Fiskeläge timme för timme, tryck på en timme för att se varför','Vattentemperatur över hela skärgården','Fångstlogg med foto som kan delas som bild'],'fiskekarta','Fiskeläget med branta kanter markerade')}
</div></section>

<section class="gpxsec"><div class="wrap">
<div class="feature"><div><div class="kicker">Kartplotter</div><h2>Rita hemma, kör med plottern</h2>
<p>Planera turen i lugn och ro vid datorn eller i soffan. När du är klar sparar du rutter och platser som en GPX-fil och för över dem till plottern i båten. Det fungerar åt andra hållet också: rutter, waypoints och inspelade spår från plottern kan läsas in i Kummel.</p>
<ol class="steps">
<li><b>Rita i Kummel.</b> Rutter längs farlederna, egna platser och naturhamnar.</li>
<li><b>Spara som GPX.</b> Meny → Kartplotter (GPX). I mobilen skickar du filen direkt till plotterns app, AirDrop eller Filer.</li>
<li><b>Läs in i plottern.</b> Via minneskortet eller tillverkarens app. Klart att köra.</li>
</ol>
<div class="brands"><span>Garmin</span><span>Raymarine</span><span>Simrad</span><span>B&amp;G</span><span>Lowrance</span><span>Furuno</span><span>Navionics</span></div>
<p class="muted-s">GPX är standardformatet för rutter och waypoints. Rutter förenklas vid behov till högst 100 punkter, så att även äldre plottrar klarar dem.</p></div>
<figure class="shot"><img src="/om/img/gpx.webp" width="585" height="996" loading="lazy" alt="Kartplotter (GPX) i Kummel: exportera rutter och platser eller läs in en GPX-fil"><figcaption>Meny → Kartplotter (GPX)</figcaption></figure></div>
</div></section>
<section><div class="wrap">
<div class="kicker">Fler bilder</div><h2>Så ser det ut</h2>
<div class="shots">
<figure class="shot"><img src="/om/img/vattenstand.webp" width="585" height="996" loading="lazy" alt="Vattenstånd med diagram och prognos"><figcaption>Vattenstånd med prognos</figcaption></figure>
<figure class="shot"><img src="/om/img/vattentemp.webp" width="585" height="996" loading="lazy" alt="Vattentemperatur i färgade punkter"><figcaption>Vattentemperatur över skärgården</figcaption></figure>
<figure class="shot"><img src="/om/img/prognos7.webp" width="585" height="996" loading="lazy" alt="Väderprognos för sju dygn"><figcaption>Prognos för veckan</figcaption></figure>
</div></div></section>

<section class="alt"><div class="wrap">
<div class="kicker">Varifrån kommer datan?</div><h2>Officiella källor</h2>
<p class="intro sources"><b>Djup och sjökort:</b> Traficom. <b>Farleder, sjömärken och fyrar:</b> Väylävirasto. <b>Stenar, grund och flygbild:</b> Lantmäteriverket. <b>Vattenstånd och vattentemperatur:</b> Meteorologiska institutet. <b>Fartyg (AIS):</b> Digitraffic. <b>Väderprognos:</b> Open-Meteo. <b>Bakgrundskarta:</b> OpenStreetMap.</p>
{DISC}
</div></section>

<section><div class="wrap" style="max-width:820px">
<div class="kicker">Vanliga frågor</div><h2>Frågor och svar</h2>
{faq(qs)}
</div></section>
{band()}'''
page('/om/','Kummel – gratis sjökort för Åland, Åboland och Nyland i mobilen','Gratis sjökort för Åland, Åbolands skärgård och Nylands kust i mobilen: djup, sjömärken, sjöväder, vattenstånd, rutter med ankomsttid och fiske. Fungerar i webbläsaren och offline. www.kummel.app',body,[APPLD,faqld(qs)])

# ---------------- /sjokort-aland/ ----------------
qs=[("Är Kummel ett officiellt sjökort?","Nej. Kummel visar Traficoms öppna sjökortsdata men är inte ett certifierat navigationshjälpmedel. Använd alltid officiella, uppdaterade sjökort."),
("Kan jag föra över rutter till plottern i båten?","Ja. Under Meny → Kartplotter (GPX) sparar du rutter, platser och turer som en GPX-fil, som Garmin, Raymarine, Simrad, B&G, Lowrance, Furuno och Navionics kan läsa. Lägg filen på plotterns minneskort eller dela den till tillverkarens app. Det går också åt andra hållet: rutter, waypoints och spår från plottern kan läsas in i Kummel."),
("Hur ofta uppdateras sjökortet?","Sjökortsdatan från Traficom hämtas varje vecka."),
("Kan jag se flygbild?","Ja. Under Kartlager kan du välja flygfoto från Lantmäteriverket med farleder, sjömärken och djupområden ovanpå."),
("Kan ruttförslaget gå över grund?","Nej, inte enligt sjökortet. Förslaget går i farlederna och runt vatten som är för grunt för din båt. Om målet ligger i ett område som är för grunt ritas ingen väg den sista biten, och Kummel säger hur långt det är kvar. Små holmar och stenar kan saknas i datan, så håll alltid utkik."),
("Hur vet Kummel om det är för grunt för min båt?","Du anger båtens djupgående och en marginal under kölen. Kummel markerar då vatten som är för grunt för just din båt och räknar med dagens vattenstånd.")]
body=f'''<section class="hero"><div class="wrap">
<div><div class="flagline">{FLAG}Sjökort Åland</div>
<h1>Sjökort för Åland <em>i mobilen</em>, gratis.</h1>
<p class="lead">Djup, grynnor, farleder, sjömärken och fyrsektorer för Åland, Åbolands skärgård och Nylands kust, direkt i webbläsaren. Med din position, rutter och grundvarning anpassad efter din båt.</p>
<div class="cta"><a class="btn" href="/">Öppna sjökortet</a><a class="btn sec" href="/om/">Alla funktioner</a></div>
<div class="facts"><span>Traficoms sjökort</span><span>Uppdateras varje vecka</span><span>Offline</span><span>GPX till plottern</span></div></div>
<div class="hero-shot"><img class="desk" src="/om/img/dator.webp" width="1600" height="955" alt="Sjökort över Mariehamn i Kummel" fetchpriority="high"></div>
</div></section>
<section><div class="wrap">
{feature('Sjökortet','Allt som finns på sjökortet, och lite till','Kummel bygger på Traficoms sjökortsdata för Åland, Åbolands skärgård och Nylands kust, från Ålands hav i väster till Pellinge utanför Borgå i öster. Zooma in så visas detaljerna: djupsiffror, enskilda stenar, ledlinjer och fartbegränsningar.',['Djupområden, djupkurvor och djupsiffror','Grynnor, stenar och undervattensstenar','Farleder med farledsdjup och namn','Sjömärken, fyrar och fyrsektorer','Fartbegränsningar och andra vattentrafikmärken','Valfritt: Traficoms inskannade detaljkort när du zoomar in'],'karta','Sjökortet i mobilen med båtens position')}
{feature('Din båt','Grundvarning för just din båt','Ange djupgående och marginal under kölen. Vatten som är för grunt markeras, och djupet räknas om med dagens vattenstånd från Meteorologiska institutet. Ruttförslagen går runt det som är för grunt, och där det inte går ritas ingen väg.',['Flera båtar, välj vilken du kör','Ruttförslag som undviker land och grund','Rutter med ankomsttid efter båtens fart','Rutter och platser till och från kartplottern (GPX)','Loggbok som spelar in dina turer'],'rutt','Ruttplanering längs farlederna',True)}
{feature('Flygbild','Se stranden som den ser ut','Byt till Lantmäteriverkets flygbilder under Kartlager. Farleder, sjömärken och djupområden ligger kvar ovanpå, och vatten som är för grunt för din båt färgas rött. Tryck på vattnet så ser du djupet där, med dagens vattenstånd.',['Flygbilder från Lantmäteriverket','Djupområden och farleder ovanpå','Rött för grunt vatten för din båt','Djup och vattenstånd med ett tryck'],'sat-mobil2','Flygbild med djupområden')}
{feature('Fastighetsgränser','Var går gränsen?','Slå på fastighetsgränser under Kartlager så ritas Lantmäteriverkets gränser ut när du zoomar in, både på sjökortet och på flygbilden.',['Fastighetsgränser från Lantmäteriverket','Syns från nära zoom','Fungerar med sjökort och flygbild'],'sat-prop','Fastighetsgränser på flygbild',True)}
{feature('Kartplotter','Från Kummel till plottern i båten','Rita rutterna i Kummel hemma och för över dem till plottern som GPX, via minneskortet eller tillverkarens app. Rutter, waypoints och spår från plottern kan också läsas in i Kummel, så har du allt på ett ställe.',['Rutter, platser och turer som GPX','Garmin, Raymarine, Simrad, B&G, Lowrance, Furuno och Navionics','Rutter förenklas vid behov för äldre plottrar','Läs in rutter, waypoints och spår från plottern'],'gpx','Meny → Kartplotter (GPX)')}
{DISC}
</div></section>
<section class="alt"><div class="wrap" style="max-width:820px"><h2>Frågor om sjökortet</h2>{faq(qs)}</div></section>
{band('Öppna sjökortet')}'''
page('/sjokort-aland/','Sjökort Åland – gratis i mobilen | Kummel','Gratis sjökort för Åland, Åbolands skärgård och Nylands kust i mobilen och på datorn: djup, grynnor, farleder, sjömärken och fyrsektorer från Traficom, med grundvarning för din båt.',body,[APPLD,faqld(qs)])

# ---------------- /fiske-aland/ ----------------
qs=[("Vad är fiskeläget?","En poäng från 0 till 100 som väger ihop vind, lufttryckets förändring, månfas, tid på dygnet och vattentemperatur, timme för timme det närmaste dygnet. När du har loggat minst fem fångster lär sig fiskeläget vad som brukar fungera för dig. Det bygger på tumregler som många sportfiskare använder, och är ingen garanti för napp."),
("Vad betyder de orange linjerna?","Branta kanter: ställen där djupet ändras snabbt över en kort sträcka. Där står ofta fisken, och linjerna är därför framhävda i fiskeläget."),
("Vad sparas när jag trycker på Fisk!?","Plats, tid, vind, lufttryck och vattentemperatur. Art, längd, vikt, bete och foto kan du lägga till när du har tid. Du kan också flytta fångsten om du tryckte lite fel."),
("Kan någon annan se mina fiskeplatser?","Nej, inte ens vi som gör Kummel. Kummel har ingen databas och inga konton. Platser, fångster och foton sparas bara i din egen telefon och skickas aldrig till oss. Det enda som lämnar telefonen är det du själv väljer att dela, och när du delar en fångst som bild bestämmer du om platsen ska synas.")]
body=f'''<section class="hero"><div class="wrap">
<div><div class="flagline">{FLAG}Fiske på Åland</div>
<h1>Ett tryck när <em>det nappar.</em></h1>
<p class="lead">Kummels fiskeläge visar branta kanter, stenar och vattentemperatur på sjökortet, ger ett fiskeläge efter väder och måne, och sparar fångsten med plats och väder på ett tryck. Gratis, i mobilen.</p>
<div class="cta"><a class="btn" href="/">Öppna Kummel</a><a class="btn sec" href="/om/">Alla funktioner</a></div>
<div class="facts"><span>Branta kanter</span><span>Fiskeläge</span><span>Fångstlogg med foto</span><span>Dina platser stannar i din telefon</span></div></div>
<div class="hero-shot" style="padding-bottom:48px"><img src="/om/img/fangst.webp" width="540" height="675" style="max-width:360px;border-radius:18px;box-shadow:0 30px 60px rgba(0,0,0,.4)" alt="Delad fångstbild från Kummel: havsöring 2,1 kg, 58 cm, med väder och vattentemperatur" fetchpriority="high"></div>
</div></section>
<section><div class="wrap">
{feature('Sjökortet','Se var djupet ändras','I fiskeläget markeras branta kanter, alltså ställen där djupet ändras snabbt, med orange linjer. Tillsammans med stenar, grund och djupkurvor ser du direkt var det är värt att lägga ett kast eller en dragrutt.',['Branta kanter framhävda','Stenar, grund och djupsiffror','Flygfoto med djupområden ovanpå','Spara egna platser med ett långt tryck'],'fiskekarta','Branta kanter i fiskeläget')}
{feature('Fiskeläge','När är det värt att åka?','Fiskeläget väger ihop vind, lufttryckets förändring, månfas, tid på dygnet och vattentemperatur till en poäng timme för timme. De bästa timmarna markeras med en prick, och trycker du på en stapel ser du poängen för just den timmen och vad som talar för och emot.',['Poäng 0–100 med förklaring','Tryck på en timme för att se varför','Bästa tiden det närmaste dygnet','Lär sig av dina egna fångster'],'fiskelage','Fiskeläge timme för timme',True)}
{feature('Fisk!','Fångstloggen som fyller i sig själv','Fisk!-knappen sparar plats, tid, väder, lufttryck och vattentemperatur. Art, längd, vikt och foto lägger du till när du har tid. Fångsten kan delas som en snygg bild, och du väljer själv om platsen ska synas.',['Fångstlogg med foto','Catch and release','Dela fångsten som bild','Vattentemperatur över hela skärgården'],'vattentemp','Vattentemperatur som färgade punkter')}
</div></section>
<section class="alt"><div class="wrap" style="max-width:820px"><h2>Frågor om fiskeläget</h2>{faq(qs)}</div></section>
{band('Prova fiskeläget','Öppna Kummel och välj Fiske uppe till vänster. Gratis, utan konto.')}'''
page('/fiske-aland/','Fiske på Åland – branta kanter, fiskeläge och fångstlogg | Kummel','Fiske på Åland i mobilen: branta kanter och stenar på sjökortet, fiskeläge efter väder och måne, vattentemperatur och fångstlogg med foto. Gratis.',body,[APPLD,faqld(qs)])

# ---------------- /vattenstand-aland/ ----------------
qs=[("Varifrån kommer vattenståndet?","Från Meteorologiska institutets mareografer. Kummel använder den närmaste av Degerby (Föglö), Ruissalo (Åbo), Hangö, Helsingfors, Borgå och Raumo, och visar dessutom prognosen för de kommande dygnen."),
("Vad betyder +12 cm?","Att vattnet står 12 cm över medelvattenståndet. Djupen på sjökortet gäller medelvattenstånd, så det är då ungefär 12 cm djupare än kartan visar. Vid minus är det grundare."),
("Räknar Kummel med vattenståndet?","Ja. Grundvarningarna och djuprutan räknar med dagens vattenstånd. Det går att stänga av i vattenståndspanelen om man hellre vill räkna med kortets djup."),
("Hur långt fram visar sjövädret?","På kartan visas vind, byar, regn, våghöjd och vattentemperatur nu och tre dygn framåt. Dra i tidsreglaget för att se hur det ändras. Väderknappen uppe till höger öppnar prognosen för en plats: 48 timmar timme för timme och sju dygn i en översikt."),
("Visar Kummel lufttrycket?","Ja. I väderprognosen finns lufttrycket för de kommande 48 timmarna, med en tolkning av hur det ändras. Ett tryck som faller tydligt betyder ofta mer vind och sämre väder på väg.")]
body=f'''<section class="hero"><div class="wrap">
<div><div class="flagline">{FLAG}Vattenstånd och sjöväder</div>
<h1>Vattenstånd och sjöväder <em>för Åland.</em></h1>
<p class="lead">Aktuellt vattenstånd med prognos, vind och byar, regn, våghöjd och vattentemperatur över hela skärgården, och en prognos för sju dygn med lufttryck och temperatur. Allt på samma karta som sjökortet.</p>
<div class="cta"><a class="btn" href="/">Öppna Kummel</a><a class="btn sec" href="/om/">Alla funktioner</a></div>
<div class="facts"><span>Meteorologiska institutet</span><span>Prognos sju dygn</span><span>Lufttryck</span><span>Gratis</span></div></div>
<div class="hero-shot"><img class="desk" src="/om/img/vattenstand.webp" width="585" height="996" style="max-width:330px;border-radius:26px 26px 0 0" alt="Vattenstånd i Kummel" fetchpriority="high"></div>
</div></section>
<section><div class="wrap">
{feature('Vattenstånd','Hur mycket vatten är det just nu?','Kummel visar vattenståndet från närmaste mareograf, hur det har ändrats det senaste dygnet och prognosen framåt. Sjökortets djup gäller medelvattenstånd, och Kummel räknar om grundvarningarna efter dagens nivå.',['Uppmätt vattenstånd och trend','Prognos med lägsta och högsta nivå','Grundvarningar som räknar med vattenståndet','"Just nu ca X m" när du trycker på vattnet'],'vattenstand','Vattenstånd med diagram och prognos')}
{feature('Sjöväder','Vind, regn och vågor över hela skärgården','Vindpilarna visar medelvind och byar, färgade efter din båts vindgräns. Välj Flöde för att se vinden som ett färgfält med rörliga linjer, eller Regn för att se var och när det regnar. Vatten° visar vattentemperaturen.',['Vind och byar i m/s','Regn i mm per timme','Våghöjd och vattentemperatur','Exakta värden där du sätter korset'],'flode-mobil','Vindflöde i mobilen',True)}
{feature('Prognos','Vädret där du ska åka','Tryck på väderknappen uppe till höger. Prognosen gäller där du är, eller där korset står på kartan. Byt mellan vind, lufttryck, temperatur, regn och vattenstånd, och se hela veckan i en översikt där dagar med hårda byar för din båt syns i rött.',['Vind och byar 48 timmar framåt','Lufttryck med tolkning','Temperatur och regn timme för timme','Vattenstånd med prognos','Sju dygn i en översikt'],'prognos','Prognos med lufttryck')}
<figure class="satwide" style="margin-top:56px"><img src="/om/img/flode-dator.webp" width="1600" height="956" loading="lazy" alt="Vindflöde över skärgården på datorn" style="border-color:#0f2a3d"><figcaption style="font-size:14px;color:var(--muted);text-align:center;margin-top:10px">Vindflöde över skärgården. Färgen visar vindstyrkan och linjerna rör sig med vinden.</figcaption></figure>
</div></section>
<section class="alt"><div class="wrap" style="max-width:820px"><h2>Frågor om vattenstånd och väder</h2>{faq(qs)}</div></section>
{band()}'''
page('/vattenstand-aland/','Vattenstånd Åland och sjöväder – Kummel','Aktuellt vattenstånd på Åland, i Åboland och Nyland med prognos från Meteorologiska institutet, och sjöväder med vind, byar, regn, våghöjd och vattentemperatur över skärgården.',body,[APPLD,faqld(qs)])
print('ok')
