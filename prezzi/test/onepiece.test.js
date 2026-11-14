import test from "node:test";
import assert from "node:assert/strict";
import { buildOnePiece, buildLorcana, buildDragonBall, buildYuGiOh, cardFromBlueprint, dropThinOutliers, isPlaceholderPrice, languageCoefficients } from "../src/onepiece.js";
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
  assert.deepEqual(a.c, { en: { NM: [10.5, 3, 10, 10.5, 11], EX: [7.2, 3, 7, 7.2, 7.5] } });
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
