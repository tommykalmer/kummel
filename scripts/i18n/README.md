# Översättning av appen (svenska → finska, engelska)

Källspråket är svenska. Texter i `app.js` märks med `` Tr`...` `` och slås upp i `lang/fi.js` och `lang/en.js`,
med den svenska texten som nyckel. `${...}` i texten blir `{0}`, `{1}` … i nyckeln och översättningen.
Fasta texter i `index.html` (knappar, title, aria-label) översätts när appen startar.
Data som sparas (t.ex. fiskarter) sparas på svenska och visas med `Lx(text)`.

Efter ändringar i texter:

1. `npm install` här (en gång).
2. Ny text: skriv den som `` Tr`Svensk text ${x}` `` i app.js (eller kör `node wrap.js ../../app.js`, som märker omärkta texter automatiskt – granska resultatet).
3. `node keys.js ../.. keys.json` listar alla nycklar.
4. Lägg till översättningar i `dict-fi.json` och `dict-en.json` (nyckel → text), eller i en fil som `add.js`
   (`module.exports = { "svensk nyckel": ["suomeksi", "in English"] }`) och kör `node addmerge.js add.js`.
5. `node build.js ../..` kontrollerar att platshållare och HTML stämmer, listar saknade och skriver `lang/fi.js` och `lang/en.js`.

Saknas en översättning visas den svenska texten.
