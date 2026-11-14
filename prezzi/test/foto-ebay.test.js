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

test("forza a null: nessuna foto, nemmeno da eBay", async () => {
  const { noPhoto } = await import("../src/foto-ebay.js");
  // Prodotti reali di onepiece-sealed.json (7 novembre 2026): buste bonus con la foto eBay del mazzo o di una carta.
  const catalogs = [{
    prefix: "onepiece-sealed",
    data: {
      p: [
        { id: 766535, n: "Ultra Deck \"The Three Brothers\" Bonus Pack", img: "https://i.ebayimg.com/images/g/x/s-l225.jpg" },
        { id: 876894, n: "Heroines Battle Winner Pack" },
        { id: 850406, n: "Starter Deck: \"Ace & Newgate\" Bonus Pack", img: "https://i.ebayimg.com/images/g/y/s-l225.jpg" },
      ],
    },
  }];
  const force = { "onepiece-sealed:766535": null, "onepiece-sealed:876894": null };
  assert.equal(applyManualPhotos(catalogs, {}, force), 1);
  assert.deepEqual(catalogs[0].data.p.map((p) => p.img ?? null), [null, null, "https://i.ebayimg.com/images/g/y/s-l225.jpg"]);
  assert.equal(noPhoto(force, "onepiece-sealed:876894"), true);
  assert.equal(noPhoto(force, "onepiece-sealed:850406"), false);
});

test("Yu-Gi-Oh! senza set su CardTrader: cercati su eBay come giapponesi, tranne le stampe europee", async () => {
  const { ebayLang } = await import("../src/foto-ebay.js");
  // Prodotti reali di yugioh-sealed.json (7 novembre 2026).
  assert.equal(ebayLang("yugioh-sealed", { n: "Vol. 1 Booster Box", l: "en" }, ""), "ja");
  assert.equal(ebayLang("yugioh-sealed", { n: "Duelist Legacy Volume 2 Booster Box", l: "en" }, undefined), "ja");
  assert.equal(ebayLang("yugioh-sealed", { n: "Galactic Overlord (OCG) Booster Box", l: "en" }, "Galactic Overlord"), "ja");
  assert.equal(ebayLang("yugioh-sealed", { n: "Legend of Blue Eyes White Dragon (LDD) Booster", l: "en" }, ""), "en");
  assert.equal(ebayLang("yugioh-sealed", { n: "Force of the Breaker Booster", l: "en" }, "Force of the Breaker"), "en");
  assert.equal(ebayLang("yugioh-sealed", { n: "Pharaoh's Servant (Korean) Booster Box", l: "ko" }, ""), "ko");
  // Gli altri giochi non cambiano.
  assert.equal(ebayLang("onepiece-sealed", { n: "Premium Card Collection", l: "en" }, ""), "en");
  assert.equal(ebayLang("sealed", { n: "Tapu Lele Collection" }, ""), null);
});

test("foto di un prodotto fratello: casse, solo contenuto e ristampe senza foto", async () => {
  const { similarOf, applySimilarPhotos } = await import("../src/foto-ebay.js");
  // Prodotti reali dei cataloghi del 7 novembre 2026.
  const set = (e, ...ps) => ps.map(([id, n, img]) => ({ id, n, e, img }));
  const yg = [
    ...set(1, [1, "Rage of the Abyss: Special 3-Pack Tuckbox Case (12x Tuckbox)"], [2, "Rage of the Abyss: Special 3-Pack Tuckbox", "/t.jpg"],
      [3, "Rage of the Abyss Case (12 Booster Boxes)", "/c.jpg"], [4, "Rage of the Abyss Booster Box", "/b.jpg"]),
    ...set(2, [10, "Light of Destruction (2024 Reprint) Case (12 Booster Boxes)"], [11, "Light of Destruction Booster Box", "/old.jpg"],
      [12, "Light of Destruction (2024 Reprint) Booster Box", "/new.jpg"]),
    ...set(3, [20, "Speed Duel: Battle City Box Decks Only (4 Card Packs)"], [21, "Speed Duel: Battle City Box", "/sd.jpg"]),
    ...set(4, [30, "Structure Deck: Fire Kings Card Pack"], [31, "Structure Deck: Fire Kings Display (8 Structure Decks)", "/disp.jpg"],
      [32, "Structure Deck: Fire Kings", "/deck.jpg"]),
    ...set(5, [40, "Legendary Decks II: Joey Deck Card Pack (2024 Reprint)"], [41, "Legendary Decks II: Joey Deck Card Pack", "/joey.jpg"]),
    ...set(6, [50, "Sword & Shield 24 Sleeved Booster Case"], [51, "Sword & Shield Booster Box", "/box.jpg"], [52, "Sword & Shield Booster", "/pack.jpg"]),
    ...set(7, [60, "Shiny Star V Booster Box Case"], [61, "Shiny Star V Booster Box", "/ssv.jpg"]),
    ...set(8, [70, "Starter Deck: EX Luffy & Ace God Deck Pack"], [71, "Starter Deck: EX Luffy & Ace", "/st30.jpg"]),
  ];
  const data = { p: yg };
  assert.equal(applySimilarPhotos(data, "yugioh-sealed", { "yugioh-sealed:60": null }), 6);
  const by = (id) => data.p.find((p) => p.id === id);
  assert.deepEqual([by(1).img, by(1).ia, by(1).ian], ["/t.jpg", "case", 12]);
  // La cassa della ristampa prende il box della ristampa, non quello del 2008.
  assert.deepEqual([by(10).img, by(10).ia, by(10).ian], ["/new.jpg", "case", 12]);
  assert.deepEqual([by(20).img, by(20).ia], ["/sd.jpg", "content"]);
  // Il mazzo, non il display da 8 mazzi.
  assert.deepEqual([by(30).img, by(30).ia], ["/deck.jpg", "content"]);
  assert.deepEqual([by(40).img, by(40).ia], ["/joey.jpg", "reprint"]);
  // "24 Sleeved Booster Case": senza la busta sleeved, la busta normale.
  assert.deepEqual([by(50).img, by(50).ia, by(50).ian], ["/pack.jpg", "case", 24]);
  // "forza" a null resta senza; il God Deck è un altro mazzo.
  assert.equal(by(60).img, undefined);
  assert.equal(by(70).img, undefined);
  // Un set diverso o un'altra lingua non vanno bene.
  assert.equal(similarOf({ n: "Aura Seeker Booster Box Case", e: 9, l: "ja" }, [{ n: "Aura Seeker Booster Box", e: 9, l: "ja", img: "/a.jpg" }])?.img, "/a.jpg");
});

test("foto della lingua più vicina per i sigillati senza foto", async () => {
  const { applySimilarPhotos, applyOtherLangPhotos, productLang, langDistance } = await import("../src/foto-ebay.js");
  // Nomi reali dei cataloghi del 7 novembre 2026.
  assert.deepEqual(productLang({ n: "Shadow Specters (Japanese) Booster Box" }), { lang: "ja", base: "Shadow Specters Booster Box" });
  assert.deepEqual(productLang({ n: "Starter Deck: Yugi (DDY)", l: "en" }), { lang: "eu", base: "Starter Deck: Yugi" });
  assert.deepEqual(productLang({ n: "Cross Force Booster Box [Fusion World] (Asia Region Legal)", l: "en" }), { lang: "asia", base: "Cross Force Booster Box [Fusion World]" });
  assert.deepEqual(productLang({ n: "Simplified Chinese Scarlet & Violet Battle Academy", l: "zh-cn" }), { lang: "zh-cn", base: "Scarlet & Violet Battle Academy" });
  assert.equal(productLang({ n: "Assault of the Saiyans Booster (Version Française)", l: "en" }).lang, "fr");
  assert.equal(productLang({ n: "Evolving Skies Booster Box" }).lang, "en");
  // Il coreano è più vicino al giapponese dell'inglese; i due cinesi tra loro.
  assert.ok(langDistance("ja", "ko") < langDistance("ja", "en"));
  assert.ok(langDistance("zh-cn", "zh-tw") < langDistance("zh-cn", "ja"));
  assert.ok(langDistance("eu", "en") < langDistance("eu", "ja"));

  const data = { p: [
    { id: 1, n: "Labyrinth of Nightmare (Japanese) Booster Box", t: "display", l: "ja" },
    { id: 2, n: "Labyrinth of Nightmare (Korean) Booster Box", t: "display", l: "ko", img: "/ko.webp" },
    { id: 3, n: "Labyrinth of Nightmare Booster Box", t: "display", l: "en", img: "/en.jpg" },
    { id: 4, n: "Starter Deck: Yugi (MIY)", t: "deck", l: "en" },
    { id: 5, n: "Starter Deck: Yugi", t: "deck", l: "en", img: "/sdy.jpg" },
    // Stesso nome ma un altro tipo di prodotto: no.
    { id: 6, n: "Labyrinth of Nightmare (Japanese) Booster", t: "booster", l: "ja" },
    // "forza" a null resta senza.
    { id: 7, n: "Magic Ruler (Japanese) Booster Box", t: "display", l: "ja" },
    { id: 8, n: "Magic Ruler Booster Box", t: "display", l: "en", img: "/mr.jpg" },
    // Cassa senza la parola "Case", e il box nello stesso set.
    { id: 9, n: "Memorial Collection (12x Booster Box) (Non-English)", t: "display", l: "ja", e: 1 },
    { id: 10, n: "Memorial Collection Booster Box (Non-English)", t: "display", l: "ja", e: 1, img: "/eb01.webp" },
    // La cassa in un altro set del box (promo di Fusion World).
    { id: 11, n: "Manga Booster 02 Booster Box Case [Fusion World]", t: "display", l: "en", e: 2 },
    { id: 12, n: "Manga Booster 02 Booster Box [Fusion World]", t: "display", l: "en", e: 3, img: "/sb02.webp" },
  ] };
  const by = (id) => data.p.find((p) => p.id === id);
  assert.equal(applySimilarPhotos(data, "x"), 2);
  assert.deepEqual([by(9).img, by(9).ia, by(9).ian], ["/eb01.webp", "case", 12]);
  assert.deepEqual([by(11).img, by(11).ia], ["/sb02.webp", "case"]);
  assert.equal(applyOtherLangPhotos(data, "x", { "x:7": null }), 2);
  assert.deepEqual([by(1).img, by(1).ia, by(1).ial], ["/ko.webp", "lang", "ko"]);
  assert.deepEqual([by(4).img, by(4).ia, by(4).ial], ["/sdy.jpg", "lang", "en"]);
  assert.equal(by(6).img, undefined);
  assert.equal(by(7).img, undefined);
});
