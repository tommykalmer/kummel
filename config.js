/* Kummel – inställningar som gäller för alla användare.
   mmlProxy: vår mellanhand för Lantmäteriverkets flygbild och fastighetsgränser (Cloudflare Worker, se worker/).
             API-nyckeln ligger som hemlighet hos Cloudflare och i GitHub, aldrig här.
   gaId: Google Analytics 4 (mät-ID, börjar med G-). Tomt = ingen statistik.
   Statistiken laddas bara för användare som har sagt ja till den. */
window.KUMMEL_CONFIG = {
  mmlProxy: "https://mml.kummel.app",
  gaId: "G-BHQM5TPKPQ",
  tilesBase: "https://kartor.kummel.app/"   // kartfilerna i Cloudflare R2
};
