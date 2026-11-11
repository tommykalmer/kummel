/* Kummel – webbplatsens sidor: besöksstatistik (GA4) med samma samtycke som appen.
   Samtycket sparas i kummel.v1.stats (1 = ja, 0 = nej) och gäller både sidorna och appen. */
(function () {
  var GA = (window.KUMMEL_CONFIG && window.KUMMEL_CONFIG.gaId) || "", KEY = "kummel.v1";
  function st() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function setStats(v) { try { var s = st(); s.stats = v; localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  var on = false;
  function start() {
    if (on || !GA) return; on = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", GA, { allow_google_signals: false, allow_ad_personalization_signals: false, page_type: "webbsida" });
    var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA);
    document.head.appendChild(s);
  }
  function ev(name, p) { if (on && window.gtag) { try { gtag("event", name, p || {}); } catch (e) {} } }
  // klick på "Öppna kartan" och liknande
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a"); if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h === "/" || h.indexOf("/?") === 0) ev("open_app_click", { from: location.pathname, label: (a.textContent || "").trim().slice(0, 40) });
  });
  var v = st().stats;
  if (v === 1) start();
  else if (v !== 0 && GA) {
    setTimeout(function () {
      var d = document.createElement("div"); d.className = "consent";
      d.innerHTML = '<div><b>Får Kummel räkna besök?</b><span>Anonym statistik över hur sidorna och appen används hjälper oss att göra Kummel bättre. Inga positioner skickas.</span></div><div class="consent-b"><button class="btn" data-c="1">Ja, gärna</button><button class="btn sec" data-c="0">Nej tack</button></div>';
      d.addEventListener("click", function (e) { var b = e.target.closest("[data-c]"); if (!b) return; var y = b.getAttribute("data-c") === "1"; setStats(y ? 1 : 0); d.remove(); if (y) start(); });
      document.body.appendChild(d);
    }, 1500);
  }
})();
