import test from "node:test";
import assert from "node:assert/strict";
import { buildOnePiece, buildLorcana, buildDragonBall, buildYuGiOh, cardFromBlueprint, dropThinOutliers, foilCoefficient, FOIL_SET_MIN, hasFoilChoice, isFoilSetCard, isPlaceholderPrice, languageCoefficients, repeatedPrices } from "../src/onepiece.js";
import { estimate } from "../src/stats.js";
import { CardTrader } from "../src/cardtrader.js";

// Blueprint come arrivano da CardTrader (ottobre 2026, accorciati).
const alvida = {
  id: 244442, name: "Alvida", version: null, category_id: 192, expansion_id: 3332,
  fixed_properties: { collector_number: "OP01-064", onepiece_rarity: "Common" },
  image: { url: "/uploads/blueprints/image/244442/alvida.jpg", show: { url: "/uploads/blueprints/image/244442/show_alvida.jpg" } },
};
const alvidaAlt = {
  ...alvida, id: 244449, version: "Alternate Art | Fixed Reprint",
  fixed_properties: { collector_number: "OP01-064b", onepiece_rarity: "Alternate Art" },
};
const box = { id: 244177, name: "Romance Dawn Booster Box", version: "", category_id: 193, expansion_id: 3332, fixed_properties: {} };

test("stampa da blueprint: numero, rarità, versione; i prodotti sigillati no", () => {
  assert.deepEqual(cardFromBlueprint(alvida), {
    id: 244442, n: "Alvida", num: "OP01-064", r: "Common", v: null, s: 3332,
    img: "/uploads/blueprints/image/244442/show_alvida.jpg",
  });
  assert.equal(cardFromBlueprint(alvidaAlt).v, "Alternate Art | Fixed Reprint");
  assert.equal(cardFromBlueprint(alvidaAlt).num, "OP01-064b");
  assert.equal(cardFromBlueprint(box), null);
});

test("catalogo e prezzi per lingua (inglese e giapponese)", async () => {
  const offer = (bp, cents, lang, condition = "Near Mint") => ({
    blueprint_id: bp, price: { cents, currency: "EUR" }, quantity: 1,
    properties_hash: { condition, onepiece_language: lang },
  });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/games")) return json([{ id: 5, name: "Pokémon" }, { id: 15, name: "One Piece", display_name: "One Piece" }, { id: 18, name: "Lorcana", display_name: "Disney Lorcana" }]);
    if (u.pathname.endsWith("/expansions")) return json([
      { id: 3332, game_id: 15, code: "op01", name: "OP-01: Romance Dawn" },
      { id: 3324, game_id: 15, code: "promo", name: "Solo sigillati" },
      { id: 1, game_id: 5, code: "x", name: "Pokémon" },
    ]);
    if (u.pathname.endsWith("/blueprints/export")) {
      return json(u.searchParams.get("expansion_id") === "3332" ? [alvida, alvidaAlt, box] : [box]);
    }
    if (u.pathname.endsWith("/marketplace/products") && u.searchParams.get("blueprint_id")) {
      // Offerte di una carta: le gradate dell'Alternate Art (78 €, quindi "di valore").
      const g = (cents, lang, description) => ({
        blueprint_id: 244449, price: { cents, currency: "EUR" }, quantity: 1, graded: true, description,
        properties_hash: { condition: "Near Mint", onepiece_language: lang },
      });
      return json({ 244449: [
        g(30000, "en", "PSA 10"), g(32000, "en", "[PSA 10]"), g(15000, "en", "BGS 9.5"),
        g(25000, "jp", "PSA 10 Gem Mint"), g(1000064, "en", "PSA 10"), // segnaposto: scartato
        g(9000, "en", "graduato 9"), // senza ente: scartato
        offer(244449, 7800, "en"), // non gradata
      ] });
    }
    if (u.pathname.endsWith("/marketplace/products")) {
      const lang = u.searchParams.get("language");
      if (lang === "en") return json({ 244442: [offer(244442, 11, "en"), offer(244442, 15, "en")], 244449: [offer(244449, 7800, "en")] });
      return json({ 244449: [offer(244449, 7000, "jp", "Slightly Played")] });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const ct = new CardTrader({ token: "t", fetchFn, marketGapMs: 0, catalogGapMs: 0 });
  const { data, log } = await buildOnePiece({ ct, now: new Date("2026-10-26T02:00:00Z") });
  assert.deepEqual(data.sets, [{ id: 3332, code: "op01", name: "OP-01: Romance Dawn", n: 2 }]);
  const [a, alt] = data.cards;
  // Due offerte (0,11 e 0,15 €): la più bassa (prima la media, 0,13 €).
  assert.deepEqual(a.en, [0.11, 2]);
  assert.equal(a.jp, undefined);
  assert.deepEqual(alt.en, [78, 1]);
  // Slightly Played riportata a Near Mint: 70 / 0,85.
  assert.deepEqual(alt.jp, [82.35, 1]);
  assert.ok(log.some((l) => l.includes("2 carte")));
  // Gradate: solo l'Alternate Art vale almeno 10 €; prezzi per ente, voto e lingua.
  assert.equal(a.g, undefined);
  assert.deepEqual(alt.g, { en: { "PSA 10": [310, 2], "BGS 9.5": [150, 1] }, jp: { "PSA 10": [250, 1] } });
  // Condizione misurata: servono almeno 3 offerte Near Mint e 3 di un'altra condizione (qui no).
  assert.equal(a.c, undefined);
});

test("condizione misurata sul mercato per lingua (campo c), come per i Pokémon", async () => {
  const offer = (bp, cents, lang, condition = "Near Mint") => ({
    blueprint_id: bp, price: { cents, currency: "EUR" }, quantity: 1,
    properties_hash: { condition, onepiece_language: lang },
  });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/games")) return json([{ id: 15, name: "One Piece", display_name: "One Piece" }]);
    if (u.pathname.endsWith("/expansions")) return json([{ id: 3332, game_id: 15, code: "op01", name: "OP-01: Romance Dawn" }]);
    if (u.pathname.endsWith("/blueprints/export")) return json([alvida]);
    if (u.pathname.endsWith("/marketplace/products") && u.searchParams.get("blueprint_id")) return json({});
    if (u.pathname.endsWith("/marketplace/products")) {
      if (u.searchParams.get("language") !== "en") return json({});
      return json({ 244442: [
        offer(244442, 1000, "en"), offer(244442, 1050, "en"), offer(244442, 1100, "en"),
        offer(244442, 700, "en", "Slightly Played"), offer(244442, 720, "en", "Slightly Played"), offer(244442, 750, "en", "Slightly Played"),
      ] });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const ct = new CardTrader({ token: "t", fetchFn, marketGapMs: 0, catalogGapMs: 0 });
  const { data } = await buildOnePiece({ ct, now: new Date("2026-11-04T02:00:00Z") });
  const [a] = data.cards;
  // Le Slightly Played riportate a NM (/ 0,85) stanno tra le 5 più economiche: mediana 8,82.
  assert.deepEqual(a.en, [8.82, 6]);
  // Dopo prezzo e offerte, i tre prezzi più economici (in misura: l'app legge solo i primi due numeri).
  assert.deepEqual(a.c, { en: { NM: [10.5, 3, 10, 10.5, 11, 10.5, 10.5], EX: [7.2, 3, 7, 7.2, 7.5, 7.2, 7.23] } });
});

test("prezzi segnaposto (5.000, 10.000 € e simili) scartati", () => {
  // Anche con la commissione di CardTrader sopra (10.000 € = 10.122,14 €) e i prezzi da milioni (9 novembre 2026).
  for (const p of [5000.43, 10000.64, 15001, 1000, 10122.14, 10122.16, 5061, 24711831.88]) assert.equal(isPlaceholderPrice(p), true, String(p));
  for (const p of [999.99, 1532.8, 4675.46, 11765.46, 0.11, 1300, 15899.5]) assert.equal(isPlaceholderPrice(p), false, String(p));
});

test("con una o due offerte vale la più bassa, e le stime fuori dal mondo si tolgono", () => {
  const offer = (price) => ({ price, currency: "EUR", quantity: 1, bundle: 1, graded: false, condition: "Near Mint" });
  // Due offerte: la più bassa (prima la media: 601,50 €); da tre in su la mediana delle più economiche, come sempre.
  assert.deepEqual(estimate([offer(1200), offer(3)], "n", "EUR", { thinLowest: true }), [3, 2]);
  assert.deepEqual(estimate([offer(1200), offer(3)], "n"), [601.5, 2]);
  assert.deepEqual(estimate([offer(5), offer(3), offer(4)], "n", "EUR", { thinLowest: true }), [4, 3]);

  const common = (id, en) => ({ id, s: 1, r: "Common", v: null, en });
  const cards = [
    // "Son Goku FB05-053": carta normale a 1.200 € con una offerta, le compagne del set a 2 €.
    common(1, [1200.64, 1]),
    ...[2, 3, 4, 5, 6].map((id) => common(id, [2, 8])),
    // Altra lingua con abbastanza offerte: 900 € in inglese (2 offerte) contro 12 € in giapponese (9) = tolta.
    { id: 7, s: 1, r: "Rare", v: null, en: [900, 2], jp: [12, 9], c: { en: { NM: [900, 3] }, jp: { NM: [12, 3] } } },
    // Stampa speciale senza compagne (Manga): resta, anche se vale cento volte le comuni.
    { id: 8, s: 1, r: "Common", v: "Manga", en: [2500, 1] },
    // Sotto i 50 € non si tocca; con tre offerte nemmeno.
    common(9, [45, 1]),
    common(10, [800, 3]),
    // 1ª edizione Yu-Gi-Oh!: stessa regola sul campo "en1".
    { id: 11, s: 2, r: "Common", v: null, en: [1, 9], en1: [26522414.31, 1], it1: [1.5, 6] },
  ];
  assert.equal(dropThinOutliers(cards, ["en", "jp", "it"]), 3);
  assert.equal(cards[0].en, undefined);
  assert.equal(cards[6].en, undefined);
  assert.deepEqual(cards[6].c, { jp: { NM: [12, 3] } });
  assert.deepEqual(cards[6].jp, [12, 9]);
  assert.deepEqual(cards[7].en, [2500, 1]);
  assert.deepEqual(cards[8].en, [45, 1]);
  assert.deepEqual(cards[9].en, [800, 3]);
  assert.equal(cards[10].en1, undefined);
  assert.deepEqual(cards[10].en, [1, 9]);
});

test("Sealed One Piece: blueprint senza numero collegati a Cardmarket, offerte per lingua", async () => {
  const sealedBox = { ...box, card_market_ids: [691245], image: { show: { url: "/uploads/blueprints/image/244177/show_box.jpg" } },
    editable_properties: [{ name: "onepiece_language", default_value: "en" }] };
  const uta = { id: 250000, name: "Film Red Uta Promo Pack", category_id: 194, expansion_id: 3324, fixed_properties: {},
    card_market_ids: [695312], editable_properties: [{ name: "onepiece_language", default_value: "jp" }] };
  const mk = (bp, cents, lang, sealed = true) => ({
    blueprint_id: bp, price: { cents, currency: "EUR" }, quantity: 1, properties_hash: { onepiece_language: lang, sealed },
  });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/games")) return json([{ id: 15, name: "One Piece" }]);
    if (u.pathname.endsWith("/expansions")) return json([
      { id: 3332, game_id: 15, code: "op01", name: "OP-01: Romance Dawn" },
      { id: 3324, game_id: 15, code: "promo", name: "Promo" },
    ]);
    if (u.pathname.endsWith("/blueprints/export")) {
      return json(u.searchParams.get("expansion_id") === "3332" ? [alvida, sealedBox] : [uta]);
    }
    if (u.pathname.endsWith("/marketplace/products")) {
      const lang = u.searchParams.get("language");
      if (u.searchParams.get("expansion_id") === "3324") return json(lang === "jp" ? { 250000: [mk(250000, 2500, "jp")] } : {});
      if (lang === "en") return json({ 244177: [mk(244177, 30000, "en"), mk(244177, 31000, "en"), mk(244177, 9000, "en", false)] });
      return json({ 244177: [mk(244177, 40000, "jp")] });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const ct = new CardTrader({ token: "t", fetchFn, marketGapMs: 0, catalogGapMs: 0 });
  const { sealed } = await buildOnePiece({ ct });
  assert.deepEqual(sealed.ctProducts.get(691245), { bp: 244177, img: "/uploads/blueprints/image/244177/show_box.jpg", lang: "en" });
  assert.equal(sealed.ctProducts.get(695312).lang, "jp");
  // La confezione aperta (90 €) non conta; il giapponese è "ja" come nell'app.
  assert.deepEqual(sealed.ctPrices.en.get(691245), [305, 2]);
  assert.deepEqual(sealed.ctPrices.ja.get(691245), [400, 1]);
  // Espansione con soli prodotti Sealed: letta lo stesso.
  assert.deepEqual(sealed.ctPrices.ja.get(695312), [25, 1]);
  assert.equal(sealed.ctExpLangs.get(3324), "jp");
});

test("Lorcana: stesso catalogo da CardTrader, rarità lorcana_rarity", async () => {
  const elsa = { id: 9001, name: "Elsa - Snow Queen", version: "Enchanted", expansion_id: 3469, fixed_properties: { collector_number: "207", lorcana_rarity: "Enchanted" }, card_market_ids: [729400], image: { show: { url: "/uploads/elsa.jpg" } } };
  assert.deepEqual(cardFromBlueprint(elsa, "lorcana_rarity"), { id: 9001, n: "Elsa - Snow Queen", num: "207", r: "Enchanted", v: "Enchanted", s: 3469, img: "/uploads/elsa.jpg" });
  // Il campo della rarità di One Piece non c'è: null.
  assert.equal(cardFromBlueprint(elsa).r, null);
  const calls = [];
  const ct = {
    async get(path) { calls.push(path); return [{ id: 15, name: "One Piece" }, { id: 18, name: "Lorcana", display_name: "Disney Lorcana" }]; },
    async expansions(gameId) { assert.equal(gameId, 18); return [{ id: 3469, code: "ch1", name: "The First Chapter" }]; },
    async blueprints() { return [elsa]; },
    async offersByExpansion(id, lang) {
      const price = { en: 50, fr: 40, de: 45, it: 30, es: 35, jp: 60 }[lang];
      return new Map([[9001, [{ price, currency: "EUR", condition: "Near Mint", graded: false, bundle: 1, quantity: 1 }, { price: price + 2, currency: "EUR", condition: "Near Mint", graded: false, bundle: 1, quantity: 1 }, { price: price + 4, currency: "EUR", condition: "Near Mint", graded: false, bundle: 1, quantity: 1 }]]]);
    },
    async offersByBlueprint() { return []; },
  };
  const { data, log } = await buildLorcana({ ct });
  assert.equal(data.sets.length, 1);
  assert.equal(data.cards[0].r, "Enchanted");
  // Sei lingue, ognuna col suo prezzo.
  assert.deepEqual(data.cards[0].it, [32, 3]);
  assert.deepEqual(data.cards[0].jp, [62, 3]);
  assert.ok(log.some((l) => /^Lorcana: 1 espansioni/.test(l)));
});

test("Dragon Ball: gioco 'Dragon Ball Super' (anche Fusion World), rarità dragonball_rarity, foil delle comuni escluse dalla stima", async () => {
  const goku = {
    id: 180695, name: "Self-Restraint SS Son Goku", version: null, category_id: 138, expansion_id: 2629,
    fixed_properties: { collector_number: "BT14-096", dragonball_rarity: "Uncommon" },
    // Le comuni e non comuni esistono normali e foil: il venditore sceglie "dragonball_foil" sull'offerta.
    editable_properties: [{ name: "condition" }, { name: "signed" }, { name: "altered" }, { name: "dragonball_language" }, { name: "dragonball_foil" }],
    image: { url: "/uploads/blueprints/image/180695/goku.jpg", show: { url: "/uploads/blueprints/image/180695/show_goku.jpg" } },
  };
  const offer = (cents, foil) => ({
    blueprint_id: 180695, price: { cents, currency: "EUR" }, quantity: 1,
    properties_hash: { condition: "Near Mint", dragonball_language: "en", dragonball_foil: foil },
  });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/games")) return json([{ id: 9, name: "Dragon Ball Super", display_name: "Dragon Ball Super" }, { id: 15, name: "One Piece" }]);
    if (u.pathname.endsWith("/expansions")) return json([{ id: 2629, game_id: 9, code: "bt14", name: "Cross Spirits" }, { id: 3602, game_id: 9, code: "fb01", name: "Fusion World: Awakened Pulse" }]);
    if (u.pathname.endsWith("/blueprints/export")) return json(u.searchParams.get("expansion_id") === "2629" ? [goku] : []);
    if (u.pathname.endsWith("/marketplace/products") && u.searchParams.get("blueprint_id")) return json({});
    if (u.pathname.endsWith("/marketplace/products")) {
      if (u.searchParams.get("language") !== "en") return json({});
      return json({ 180695: [offer(20, false), offer(25, false), offer(300, true), offer(350, true)] });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const ct = new CardTrader({ token: "t", fetchFn, marketGapMs: 0, catalogGapMs: 0 });
  const { data, log } = await buildDragonBall({ ct, now: new Date("2026-11-04T02:00:00Z") });
  assert.deepEqual(data.sets, [{ id: 2629, code: "bt14", name: "Cross Spirits", n: 1 }]);
  const [c] = data.cards;
  assert.equal(c.num, "BT14-096");
  assert.equal(c.r, "Uncommon");
  // Le due offerte foil (3 e 3,50 €) non entrano nella stima della carta normale.
  assert.deepEqual(c.en, [0.2, 2]);
  assert.ok(log.some((l) => l.startsWith("Dragon Ball")));
});

test("Dragon Ball: le carte che esistono solo foil hanno un prezzo, nelle comuni la foil resta fuori", async () => {
  // Blueprint e offerte veri (workflow "Esplora CardTrader", 18 novembre 2026). La non comune BT14-113 ha "dragonball_foil"
  // tra le proprietà da scegliere; la Rare BT14-112 e la Super Rare EB1-62 no, e le loro offerte hanno tutte
  // "dragonball_foil: true" (il 3 novembre le stesse tre offerte della EB1-62 avevano "false"): scartate, 4.788 carte
  // delle rarità solo foil restavano senza prezzo (catalogo del 17 novembre).
  const props = (...more) => ["condition", "signed", "altered", "dragonball_language", ...more].map((name) => ({ name }));
  const uncommon = { id: 180692, name: "Super 17, Hellish Amalgamation", version: null, category_id: 138, expansion_id: 2629, fixed_properties: { collector_number: "BT14-113", dragonball_rarity: "Uncommon" }, editable_properties: props("dragonball_foil") };
  const rare = { id: 180694, name: "Super 17, Powers Combined", version: null, category_id: 138, expansion_id: 2629, fixed_properties: { collector_number: "BT14-112", dragonball_rarity: "Rare" }, editable_properties: props() };
  const superRare = { id: 181982, name: "Android 17 & Android 18, Siblings Revived", version: null, category_id: 138, expansion_id: 2631, fixed_properties: { collector_number: "EB1-62", dragonball_rarity: "Super Rare" }, editable_properties: props() };
  assert.equal(hasFoilChoice(uncommon), true);
  assert.equal(hasFoilChoice(rare), false);
  assert.equal(hasFoilChoice(superRare), false);
  // Proprietà scritte come semplici nomi, o assenti: nessuna scelta.
  assert.equal(hasFoilChoice({ editable_properties: ["condition", "dragonball_foil"] }), true);
  assert.equal(hasFoilChoice({}), false);
  const offer = (bp, cents, foil, rarity, num) => ({
    blueprint_id: bp, price: { cents, currency: "EUR" }, quantity: 1, graded: false,
    properties_hash: { condition: "Near Mint", signed: false, altered: false, collector_number: num, tournament_legal: true, dragonball_language: "en", dragonball_rarity: rarity, dragonball_foil: foil },
  });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith("/games")) return json([{ id: 9, name: "Dragon Ball Super", display_name: "Dragon Ball Super" }]);
    if (u.pathname.endsWith("/expansions")) return json([{ id: 2629, game_id: 9, code: "bt14", name: "Cross Spirits" }, { id: 2631, game_id: 9, code: "eb1", name: "Battle Evolution Booster" }]);
    if (u.pathname.endsWith("/blueprints/export")) return json(u.searchParams.get("expansion_id") === "2629" ? [uncommon, rare] : [superRare]);
    if (u.pathname.endsWith("/marketplace/products") && u.searchParams.get("blueprint_id")) return json({});
    if (u.pathname.endsWith("/marketplace/products")) {
      if (u.searchParams.get("language") !== "en") return json({});
      if (u.searchParams.get("expansion_id") === "2629") {
        return json({
          // Non comune: tre offerte normali (0,11 / 0,11 / 0,12 €) e due foil (1,50 e 2 €), che restano fuori.
          180692: [offer(180692, 11, false, "Uncommon", "BT14-113"), offer(180692, 11, false, "Uncommon", "BT14-113"), offer(180692, 12, false, "Uncommon", "BT14-113"), offer(180692, 150, true, "Uncommon", "BT14-113"), offer(180692, 200, true, "Uncommon", "BT14-113")],
          180694: [offer(180694, 25, true, "Rare", "BT14-112"), offer(180694, 30, true, "Rare", "BT14-112"), offer(180694, 45, true, "Rare", "BT14-112")],
        });
      }
      // Le tre offerte vere della Super Rare, tutte segnate foil.
      return json({ 181982: [offer(181982, 71, true, "Super Rare", "EB1-62"), offer(181982, 128, true, "Super Rare", "EB1-62"), offer(181982, 532, true, "Super Rare", "EB1-62")] });
    }
    return { ok: false, status: 404, json: async () => null };
  };
  const ct = new CardTrader({ token: "t", fetchFn, marketGapMs: 0, catalogGapMs: 0 });
  const { data, log } = await buildDragonBall({ ct, now: new Date("2026-11-18T02:00:00Z") });
  const byNum = Object.fromEntries(data.cards.map((c) => [c.num, c]));
  assert.deepEqual(byNum["BT14-113"].en, [0.11, 3]); // solo le normali
  // La foil della non comune a parte (splitFoil, 19 novembre 2026): due offerte, la più economica.
  assert.deepEqual(byNum["BT14-113"].en1, [1.5, 2]);
  assert.equal(byNum["BT14-113"].fb, 1);
  assert.equal(byNum["BT14-112"].fb, undefined);
  // Con due sole offerte foil la carta non conta nel rapporto foil/normale: nessun rapporto.
  assert.equal(data.foil, undefined);
  assert.deepEqual(byNum["BT14-112"].en, [0.3, 3]); // Rare: solo foil, contano tutte
  assert.equal(byNum["BT14-112"].en1, undefined); // e niente seconda stima: esiste solo foil
  assert.deepEqual(byNum["EB1-62"].en, [1.28, 3]); // Super Rare: prima senza prezzo
  assert.ok(log.includes("Dragon Ball: 1 carte normali e foil (stima della foil a parte), 2 in una sola finitura (tutte le offerte)"));
  assert.ok(!log.some((l) => l.startsWith("! Dragon Ball: nessun blueprint")));
});

test("lo stesso prezzo alto su carte diverse è un prezzo per non vendere", async () => {
  // Cataloghi del 17 novembre 2026. Yu-Gi-Oh!: 10.225,00 € su sei carte di sei set (qui quattro). One Piece: 2.500,64 € su
  // tre premi di torneo diversi e 1.200,64 € su cinque Manga sono prezzi veri (sotto i 5.000 € le cifre tonde si ripetono).
  // Yu-Gi-Oh!: le Grand Master Rare dello stesso set a 7.500,64 e 7.500,63 € sono carte sorelle.
  const cards = new Map([
    [83258, { s: 1202, r: "Ultra Rare" }], [171348, { s: 2616, r: "Common" }], [247896, { s: 3366, r: "Rare" }], [70533, { s: 1088, r: "Common" }],
    [282211, { s: 3333, r: "Promo" }], [345986, { s: 3945, r: "Promo" }], [330450, { s: 4123, r: "Special Rare" }],
    [422708, { s: 4800, r: "Grand Master Rare" }], [422728, { s: 4800, r: "Grand Master Rare" }], [422736, { s: 4800, r: "Grand Master Rare" }],
    [357623, { s: 3879, r: "Uncommon" }], [357642, { s: 3879, r: "Common" }], [360701, { s: 4411, r: "Uncommon" }],
  ]);
  const seen = new Map([
    [10225, new Set([83258, 171348, 247896, 70533])],
    [2501, new Set([282211, 345986, 330450])], // sotto la soglia
    [7501, new Set([422708, 422728, 422736])], // tre carte sorelle: stesso set, stessa rarità
    [10260, new Set([357623, 357642, 360701])], // Dragon Ball: due set
    [38805, new Set([422708])], // una carta sola
    [14996, new Set([83258, 171348])], // due carte: non bastano
  ]);
  assert.deepEqual([...repeatedPrices(seen, (id) => cards.get(id))].sort((a, b) => a - b), [10225, 10260]);

  // Dentro la costruzione del catalogo: le stime si rifanno senza quelle offerte.
  const bp = (id, name, num, rarity, exp) => ({ id, name, version: rarity, fixed_properties: { collector_number: num, yugioh_rarity: rarity }, expansion_id: exp });
  const o = (price, firstEdition, condition = "Near Mint") => ({ price, currency: "EUR", condition, firstEdition, graded: false, bundle: 1, quantity: 1 });
  const ct = {
    get: async (p) => (p === "games" ? [{ id: 4, name: "Yu-Gi-Oh!", display_name: "Yu-Gi-Oh!" }] : []),
    expansions: async () => [{ id: 1202, code: "dt01", name: "Duel Terminal 1" }, { id: 2616, code: "dem6", name: "Speed Duel: Demo Deck 2020" }, { id: 1088, code: "db2", name: "Dark Beginning 2" }, { id: 1221, code: "stbl", name: "Starstrike Blast" }, { id: 4800, code: "mams", name: "Magnificent Maestros" }],
    blueprints: async (exp) => ({
      1202: [bp(83258, "Mist Wurm", "032", "Ultra Rare", 1202)],
      2616: [bp(171348, "Copycat", "014", "Common", 2616)],
      1088: [bp(70533, "Twin-Headed Behemoth", "174", "Common", 1088)],
      1221: [bp(68020, "Supreme Arcanite Magician", "038ul", "Ultimate Rare", 1221)],
      4800: [bp(422708, "Galaxy-Eyes Photon Change Dragon", "011m", "Grand Master Rare", 4800), bp(422728, "Borreload Liberator Dragon", "016m", "Grand Master Rare", 4800), bp(422736, "Triple Borrel Launch", "018m", "Grand Master Rare", 4800)],
    })[exp],
    async offersByExpansion(exp, lang) {
      if (lang !== "en") return new Map();
      return new Map(Object.entries({
        1202: { 83258: [o(10225, true)] }, // la sola offerta
        2616: { 171348: [o(1.2, false), o(1.29, false), o(1.29, false), o(1.4, false), o(10225, true)] },
        1088: { 70533: [o(0.45, false), o(0.48, false), o(0.5, false), o(10225, true, "Slightly Played")] }, // 12.029,41 € a Near Mint
        1221: { 68020: [o(10225, false, "Slightly Played"), o(50, true), o(52.18, true), o(55, true)] },
        // Carte sorelle con lo stesso prezzo vero: restano.
        4800: { 422708: [o(7500.64, false)], 422728: [o(7500.63, false)], 422736: [o(7500.64, false)] },
      }[exp] ?? {}).map(([k, v]) => [Number(k), v]));
    },
    offersByBlueprint: async () => [],
  };
  const { data, log } = await buildYuGiOh({ ct });
  const byNum = Object.fromEntries(data.cards.map((c) => [c.num, c]));
  assert.equal(byNum["DT01-032"].en, undefined);
  assert.equal(byNum["DT01-032"].en1, undefined);
  assert.deepEqual(byNum["DEM6-014"].en, [1.29, 4]);
  assert.equal(byNum["DEM6-014"].en1, undefined);
  assert.deepEqual(byNum["DB2-174"].en, [0.48, 3]);
  assert.equal(byNum["DB2-174"].en1, undefined);
  // Senza l'offerta finta delle unlimited il prezzo base torna quello delle 1ª edizione (solo quelle hanno offerte).
  assert.deepEqual(byNum["STBL-038ul"].en, [52.18, 3]);
  assert.deepEqual(byNum["STBL-038ul"].en1, [52.18, 3]);
  assert.deepEqual(byNum["MAMS-011m"].en, [7500.64, 1]);
  assert.deepEqual(byNum["MAMS-016m"].en, [7500.63, 1]);
  assert.ok(log.some((l) => l.includes('1 prezzi "per non vendere" ripetuti su carte diverse (10225 €), 4 stime rifatte senza')));
});

test("stime con tre o più offerte fuori dal mondo rispetto alle altre lingue", () => {
  // Valori veri del catalogo Yu-Gi-Oh! del 17 novembre 2026.
  const cards = [
    // Solemn Judgment MAGO-051: 615,87 € su 5 offerte (solo 1ª edizione: il base è la stessa stima), 5,86 € in italiano.
    { id: 150798, s: 2079, r: "Gold Rare", v: "Premium Gold Rare", en: [615.87, 5], en1: [615.87, 5], it: [5.86, 3], it1: [6.64, 1], de: [3.3, 1], de1: [3.3, 1], es: [4.01, 1], es1: [4.01, 1] },
    // Smashing Ground DR2-094, comune: 401,86 € su 3 offerte, 1,64 € in italiano su 12.
    { id: 67345, s: 1097, r: "Common", v: "Common", en: [401.86, 3], it: [1.64, 12], c: { it: { NM: [1.62, 4, 1.54, 1.6, 1.64], PO: [2.6, 5, 2.03, 2.54, 2.6] } }, de: [1.41, 1] },
    // Dark Magician SDY-006: la 1ª edizione inglese vale davvero 20 volte l'italiana (TCGplayer 234 €): resta.
    { id: 79757, s: 1032, r: "Ultra Rare", v: "Ultra Rare", en: [0.27, 99], en1: [406.14, 6], it: [4.32, 36], it1: [20.44, 18], de: [35.76, 1], de1: [35.76, 1], es: [10.4, 4], es1: [10.4, 4] },
    // Raigeki LOB-053 1ª edizione: 233,36 € contro 20,40 € (TCGplayer 199 €): resta.
    { id: 80749, s: 1030, r: "Super Rare", v: "©1996", en: [5.19, 33], en1: [233.36, 4], it: [10, 19], it1: [20.4, 11] },
    // Sotto i 50 € non si tocca, anche a cento volte.
    { id: 1, s: 1, r: "Common", v: null, en: [45, 4], it: [0.2, 9] },
    // Altra lingua con una o due offerte: non fa da riferimento.
    { id: 2, s: 1, r: "Common", v: null, en: [300, 4], it: [1, 2] },
  ];
  assert.equal(dropThinOutliers(cards, ["en", "it", "fr", "de", "es", "pt", "jp"]), 3);
  assert.equal(cards[0].en, undefined);
  assert.equal(cards[0].en1, undefined); // la stessa stima: via insieme
  assert.deepEqual(cards[0].it, [5.86, 3]);
  assert.equal(cards[1].en, undefined);
  assert.deepEqual(cards[1].c, { it: { NM: [1.62, 4, 1.54, 1.6, 1.64], PO: [2.6, 5, 2.03, 2.54, 2.6] } });
  assert.deepEqual(cards[2].en1, [406.14, 6]);
  assert.deepEqual(cards[3].en1, [233.36, 4]);
  assert.deepEqual(cards[4].en, [45, 4]);
  assert.deepEqual(cards[5].en, [300, 4]);
});

test("rapporto lingua/inglese del gioco (campo coef): totale, per set, e italiano prestato a fr/es", () => {
  // 40 carte con offerte inglesi e italiane (3 offerte ciascuna): italiano al 70% dell'inglese, nel set 2 al 50%.
  const cards = [];
  for (let i = 0; i < 40; i++) {
    const set = i < 30 ? 1 : 2;
    cards.push({ id: i, s: set, en: [10, 3], it: [set === 1 ? 7 : 5, 3] });
  }
  // Tedesco: una carta sola, troppo poche per un rapporto. Giapponese: nessuna offerta.
  cards[0].de = [9, 3];
  // Comuni a prezzo minimo (sotto 2 € in inglese): non contano, anche se in italiano costano il triplo.
  for (let i = 100; i < 150; i++) cards.push({ id: i, s: 1, en: [0.11, 3], it: [0.33, 3] });
  const log = [];
  const coef = languageCoefficients(cards, ["en", "fr", "de", "it", "es", "jp"], log, "Lorcana");
  assert.deepEqual(coef.it.all, [0.7, 40]); // mediana
  assert.deepEqual(coef.it[1], [0.7, 30]);
  assert.deepEqual(coef.it[2], [0.5, 10]);
  assert.equal(coef.jp, undefined);
  // Francese, spagnolo e tedesco: sempre il rapporto dell'italiano, segnato (anche il tedesco che ne avrebbe uno suo).
  assert.deepEqual(coef.fr, { ...coef.it, from: "it" });
  assert.equal(coef.es.from, "it");
  assert.deepEqual(coef.de, { ...coef.it, from: "it" });
  assert.equal(coef.it.from, undefined);
  assert.ok(log.some((l) => l === "Lorcana rapporto it/en: 70% su 40 carte"));
  // Senza inglese non c'è nessun rapporto.
  assert.deepEqual(languageCoefficients([{ id: 1, s: 1, it: [5, 3] }], ["en", "it"]), {});
});

test("Yu-Gi-Oh!: 1ª edizione a parte (en1), numero col codice dell'espansione, carte con sole 1ª edizione", async () => {
  const ct = {
    get: async (p) => (p === "games" ? [{ id: 4, name: "Yu-Gi-Oh!", display_name: "Yu-Gi-Oh!" }] : []),
    expansions: async () => [{ id: 1030, code: "lob", name: "Legend of Blue Eyes White Dragon" }],
    blueprints: async () => [
      { id: 1, name: "Blue-Eyes White Dragon", version: "Ultra Rare", fixed_properties: { collector_number: "001", yugioh_rarity: "Ultra Rare" }, expansion_id: 1030 },
      { id: 2, name: "Dark Magician", version: "Ultra Rare", fixed_properties: { collector_number: "005", yugioh_rarity: "Ultra Rare" }, expansion_id: 1030 },
    ],
    async offersByExpansion(id, lang) {
      if (lang !== "en") return new Map();
      const o = (price, firstEdition) => ({ price, currency: "EUR", condition: "Near Mint", firstEdition, graded: false, bundle: 1, quantity: 1 });
      return new Map([
        [1, [o(100, false), o(110, false), o(900, true), o(950, true)]],
        [2, [o(60, true), o(65, true)]], // solo 1ª edizione
      ]);
    },
    offersByBlueprint: async () => [],
  };
  const { data } = await buildYuGiOh({ ct });
  const [bewd, dm] = data.cards;
  assert.equal(bewd.num, "LOB-001");
  assert.deepEqual(bewd.en, [100, 2]); // unlimited (con due offerte la più bassa)
  assert.deepEqual(bewd.en1, [900, 2]); // 1ª edizione
  assert.deepEqual(dm.en, [60, 2]); // solo 1ª edizione: il base è quello
  assert.deepEqual(dm.en1, [60, 2]);
});

test("carte senza foto con quella della stessa carta in un'altra stampa", async () => {
  const { sharedPhotos } = await import("../src/onepiece.js");
  const cards = [
    { id: 1, n: "Yamcha, Merciless Barrage", num: "BT10-008", img: "/holo.jpg" },
    { id: 2, n: "Yamcha, Merciless Barrage", num: "BT10-008" },
    { id: 3, n: "Towa, Dark Demon Realm Madness", num: "P-540", img: "/towa.jpg" },
    { id: 4, n: "Towa, Dark Demon Realm Madness", num: "P-540c" },
    { id: 5, n: "Android 17", num: "BT17-135", img: "/a17.jpg" },
    { id: 6, n: "Android 17", num: "BT17-135l2" },
    { id: 7, n: "Monkey.D.Luffy", num: "OP01-024", img: "/luffy1.jpg" },
    { id: 8, n: "Monkey.D.Luffy", num: "OP05-119" },
  ];
  assert.equal(sharedPhotos(cards), 3);
  assert.equal(cards[1].img, "/holo.jpg");
  assert.equal(cards[3].img, "/towa.jpg");
  assert.equal(cards[5].img, "/a17.jpg");
  // Stesso nome, altra carta (One Piece): niente foto senza byName.
  assert.equal(cards[7].img, undefined);
  const yg = [{ id: 1, n: "Black Thunder", num: "SDBT-020", img: "/bt.jpg" }, { id: 2, n: "Black Thunder", num: "OP20-035" }];
  assert.equal(sharedPhotos(yg, { byName: true }), 1);
  assert.equal(yg[1].img, "/bt.jpg");
});

test("foto di un'altra stampa solo se è la stessa carta (stesso nome)", async () => {
  const { sharedPhotos } = await import("../src/onepiece.js");
  const cards = [
    { id: 1, n: "The Queen - Wicked and Vain", num: "056", img: "/regina.jpg" },
    { id: 2, n: "Buzz Lightyear - On the Way", num: "056" },
    { id: 3, n: "Krillin, Tournament Entry", num: "BT25-030", img: "/krillin.jpg" },
    { id: 4, n: "Krillian, Tournament Entry", num: "BT25-030" },
    { id: 5, n: "SS Trunks, Tournament Battle to the Death // Trunks", num: "BT25-070", img: "/trunks.jpg" },
    { id: 6, n: "Trunks // SS Trunks, Tournament Battle to the Death", num: "BT25-070" },
  ];
  assert.equal(sharedPhotos(cards), 2);
  assert.equal(cards[1].img, undefined);
  assert.equal(cards[3].img, "/krillin.jpg");
  assert.equal(cards[5].img, "/trunks.jpg");
});

test("rapporto foil/normale dei giochi con la finitura da scegliere", () => {
  const cards = [
    { s: 1, fb: 1, en: [0.1, 10], en1: [1.0, 4] }, // 10 volte
    { s: 1, fb: 1, en: [0.5, 6], en1: [1.5, 3] }, // 3 volte
    { s: 1, fb: 1, en: [2, 5], en1: [8, 5] }, // 4 volte
    { s: 2, fb: 1, en: [1, 5], en1: [100, 5] }, // oltre 50: 50
    { s: 2, fb: 1, en: [1, 5], en1: [5, 2] }, // due sole offerte foil: fuori
    { s: 2, en: [1, 5], en1: [5, 5] }, // senza la scelta (solo foil): fuori
  ];
  const log = [];
  const k = foilCoefficient(cards, log, "Dragon Ball");
  assert.deepEqual(k.all, [7, 4]); // mediana di 3, 4, 10, 50
  assert.equal(k[1], undefined); // meno di FOIL_SET_MIN carte nel set
  assert.ok(log.includes("Dragon Ball rapporto foil/normale: 7 su 4 carte"));
  assert.equal(foilCoefficient([{ s: 1, en: [1, 5] }]), null);
});

test("A4: il rapporto foil/normale solo dalle carte di set, e per un set solo da 10 carte", () => {
  // Dati veri del catalogo del 19 novembre 2026: Lorcana "Errata Cards" (set 3581) dava 50 volte su 6 carte.
  assert.ok(!isFoilSetCard({ r: "Common", v: 'Errata Card | "Pasha"' }, "Errata Cards"));
  assert.ok(!isFoilSetCard({ r: "Promo", v: "1/P1" }, "Promos Year 1"));
  assert.ok(!isFoilSetCard({ r: "Common", v: "Pre-Release Stamped" }, "Series 7"));
  assert.ok(!isFoilSetCard({ r: "Common", v: "Gold Stamped" }, "History of Z"));
  assert.ok(isFoilSetCard({ r: "Uncommon", v: null }, "Cross Spirits"));
  // "World Martial Arts Tournament" è un set di buste: il nome del set non basta a escluderlo.
  assert.ok(isFoilSetCard({ r: "Common", v: null }, "World Martial Arts Tournament"));
  const card = (s, r, v = null) => ({ s, r, v, fb: 1, en: [0.1, 5], en1: [5, 5] });
  const cards = [];
  for (let i = 0; i < FOIL_SET_MIN; i++) cards.push({ ...card(1, "Common"), en1: [0.3, 5] }); // set 1: 3 volte, 10 carte
  for (let i = 0; i < 6; i++) cards.push(card(2, "Common", "Errata Card")); // le carte errata: fuori dal rapporto
  for (let i = 0; i < 6; i++) cards.push(card(3, "Common")); // set 3: 6 carte, niente rapporto suo
  const k = foilCoefficient(cards, [], "Lorcana", new Map([[1, "The First Chapter"], [2, "Errata Cards"], [3, "Rise of the Floodborn"]]));
  assert.deepEqual(k[1], [3, FOIL_SET_MIN]);
  assert.equal(k[2], undefined);
  assert.equal(k[3], undefined);
  assert.equal(k.all[1], FOIL_SET_MIN + 6);
});

test("tendenza Cardmarket di ogni carta dai prodotti che CardTrader collega (punto 4 della riverifica)", async () => {
  const { addCmTrends } = await import("../src/onepiece.js");
  const data = { cards: [{ id: 1 }, { id: 2 }, { id: 3, cmt: [5, 0] }] };
  const cmIds = new Map([[1, [10, 11]], [2, [20]]]);
  const guide = { priceGuides: [{ idProduct: 10, trend: 0, "trend-foil": 0 }, { idProduct: 11, trend: 9.654, "trend-foil": 12 }, { idProduct: 20, trend: null }] };
  assert.equal(addCmTrends(data, cmIds, guide), 1);
  // Il primo prodotto con una tendenza; senza nessuna, nessun campo (anche quello vecchio va via).
  assert.deepEqual(data.cards[0].cmt, [9.65, 12]);
  assert.equal(data.cards[1].cmt, undefined);
  assert.equal(data.cards[2].cmt, undefined);
});
