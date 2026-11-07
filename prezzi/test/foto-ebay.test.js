import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManualPhotos } from "../src/foto-ebay.js";

const BASE = "https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati/immagini/sealed/";

test("foto scelte a mano: al posto di eBay, mai di CardTrader, tranne quelle da forzare", () => {
  // Prodotti reali di lorcana-sealed.json (7 novembre 2026).
  const catalogs = [{
    prefix: "lorcana-sealed",
    data: {
      p: [
        // Senza foto: prende quella scelta a mano.
        { id: 775949, n: "Villainous – Introduction to Evil", img: null },
        // Foto eBay del box normale su un box slim: sostituita.
        { id: 846504, n: "The First Chapter Simplified Chinese Slim Booster Box", img: "https://i.ebayimg.com/images/g/b1cAAeSwinpqeRx9/s-l225.jpg" },
        // Foto CardTrader del prodotto: resta, anche se c'è una foto a mano.
        { id: 864938, n: "Fabled: Memories of the Story Special Promotion Pack Vol.1", img: "/uploads/blueprints/image/365506/show_x.jpg" },
        // Foto CardTrader del box inglese su un box cinese: la foto da forzare vince.
        { id: 818322, n: "The First Chapter Simplified Chinese Booster Box", img: "/uploads/blueprints/image/258468/show_the-first-chapter-booster-box-the-first-chapter.jpg" },
        // Già con la stessa foto: non conta.
        { id: 732353, n: "The First Chapter: Super Rare Set", img: `${BASE}lorcana-set/the-first-chapter-super-rare-set.webp` },
      ],
    },
  }];
  const manual = {
    "lorcana-sealed:775949": `${BASE}lorcana/villainous-introduction-to-evil.webp`,
    "lorcana-sealed:846504": `${BASE}lorcana/the-first-chapter-simplified-chinese-slim-booster-box.webp`,
    "lorcana-sealed:864938": `${BASE}lorcana/altra.webp`,
    "lorcana-sealed:732353": `${BASE}lorcana-set/the-first-chapter-super-rare-set.webp`,
  };
  const force = { "lorcana-sealed:818322": `${BASE}lorcana/the-first-chapter-simplified-chinese-booster-box.webp` };
  assert.equal(applyManualPhotos(catalogs, manual, force), 3);
  assert.deepEqual(catalogs[0].data.p.map((p) => p.img.split("/").pop()), [
    "villainous-introduction-to-evil.webp",
    "the-first-chapter-simplified-chinese-slim-booster-box.webp",
    "show_x.jpg",
    "the-first-chapter-simplified-chinese-booster-box.webp",
    "the-first-chapter-super-rare-set.webp",
  ]);
  // Senza "forza" la foto CardTrader del box inglese resterebbe.
  const again = [{ prefix: "lorcana-sealed", data: { p: [{ id: 818322, img: "/uploads/blueprints/image/258468/show.jpg" }] } }];
  assert.equal(applyManualPhotos(again, { "lorcana-sealed:818322": `${BASE}lorcana/x.webp` }), 0);
});
