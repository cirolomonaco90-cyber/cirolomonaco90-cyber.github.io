import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKonamiList, matchKonami, konamiImages, findKonamiPhotos, applyKonamiPhotos } from "../src/foto-konami.js";

// Righe reali della pagina https://www.yugioh-card.com/japan/products/ (7 novembre 2026).
const HTML = `p[1]={"id":"cg1721","status":"","class-name":"コンセプトパック","class-key":"concept","title":"PREMIUM PACK 2021","thumbnail":"package/cg1721-box.png","limited":'jumpfesta',"url":"","detail":"none"}
p[2]={"id":"cg1766","status":"","class-name":"スペシャルパック","class-key":"special","title":"SECRET SHINY BOX","thumbnail":"package/cg1766.png","limited":'none',"url":"","detail":"none"}
p[3]={"id":"cg2163","status":"","class-name":"基本パック","class-key":"basic","title":"PRIDE AND SOUL","thumbnail":"package/nowprinting.png","limited":'none',"url":"","detail":"none"}
p[4]={"id":"cg2151","status":"","class-name":"構築済みデッキ","class-key":"structure","title":"THE CHRONICLES DECK DX マギストス","thumbnail":"package/cg2151.png","limited":'none',"url":"ch03","detail":"page"}`;

test("Konami: elenco dei prodotti, titolo uguale al nome Cardmarket e foto per tipo", () => {
  const list = parseKonamiList(HTML);
  assert.equal(list.length, 4);
  assert.equal(matchKonami("Premium Pack 2021 Booster", list)?.id, "cg1721");
  assert.equal(matchKonami("Secret Shiny Box Booster", list)?.id, "cg1766");
  assert.equal(matchKonami("Pride and Soul (Japanese) Booster Box", list)?.id, "cg2163");
  // Nomi diversi o titoli giapponesi: no.
  assert.equal(matchKonami("Premium Pack 2022 Booster", list), null);
  assert.equal(matchKonami("The Chronicles Deck DX Magistus", list), null);
  // Box: prima il box da solo; busta: solo la busta (la foto del prodotto è il box); mazzi: la foto del prodotto.
  assert.deepEqual(konamiImages(list[0], "Premium Pack 2021 Booster Box").map((u) => u.split("/").pop()), ["cg1721-box.png", "cg1721.png"]);
  assert.deepEqual(konamiImages(list[2], "Pride and Soul (Japanese) Booster").map((u) => u.split("/").pop()), ["cg2163-pack.png"]);
  assert.deepEqual(konamiImages(list[3], "Structure Deck: The Chronicles Deck DX").map((u) => u.split("/").pop()), ["cg2151.png"]);
});

test("Konami: foto copiate nel nostro spazio, ricordate nella cache e messe al posto di nessuna foto o di eBay", async () => {
  const data = { p: [
    { id: 606951, n: "Premium Pack 2021 Booster", l: "en" },
    { id: 851667, n: "Secret Shiny Box Booster", l: "en", img: "https://i.ebayimg.com/images/g/x/s-l225.jpg" },
    { id: 1, n: "Force of the Breaker Booster", l: "en", img: "/uploads/blueprints/x.jpg" },
  ] };
  const uploaded = [];
  const cache = { p: {} };
  const found = await findKonamiPhotos(data, cache, {
    isJapanese: () => true,
    fetchText: async () => HTML,
    // La busta della Premium Pack 2021 non c'è (404): niente foto, la foto del prodotto è il box.
    fetchImage: async (url) => (url.endsWith("cg1721-pack.png") ? null : Buffer.from("png")),
    upload: async (path) => {
      uploaded.push(path);
      return `https://dati/${path}`;
    },
    now: new Date("2026-11-07"),
  });
  assert.equal(found, 1);
  assert.deepEqual(uploaded, ["immagini/sealed/yugioh/konami-auto-cg1766-pack.png"]);
  assert.deepEqual(cache.konami["yugioh-sealed:606951"], [null, "2026-11-07"]);
  assert.equal(applyKonamiPhotos(data, cache), 1);
  assert.equal(data.p[1].img, "https://dati/immagini/sealed/yugioh/konami-auto-cg1766-pack.png");
  assert.equal(data.p[2].img, "/uploads/blueprints/x.jpg");
  // Già cercati (anche quelli senza foto, per 30 giorni): la notte dopo non si rifà nulla.
  assert.equal(await findKonamiPhotos(data, cache, { isJapanese: () => true, fetchText: async () => { throw new Error("no"); } }), 0);
});
