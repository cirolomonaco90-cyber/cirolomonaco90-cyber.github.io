import test from "node:test";
import assert from "node:assert/strict";
import { buildOnePiece, cardFromBlueprint, isPlaceholderPrice } from "../src/onepiece.js";
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
    if (u.pathname.endsWith("/games")) return json([{ id: 5, name: "Pokémon" }, { id: 15, name: "One Piece", display_name: "One Piece" }]);
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
  assert.deepEqual(a.en, [0.13, 2]);
  assert.equal(a.jp, undefined);
  assert.deepEqual(alt.en, [78, 1]);
  // Slightly Played riportata a Near Mint: 70 / 0,85.
  assert.deepEqual(alt.jp, [82.35, 1]);
  assert.ok(log.some((l) => l.includes("2 carte")));
  // Gradate: solo l'Alternate Art vale almeno 10 €; prezzi per ente, voto e lingua.
  assert.equal(a.g, undefined);
  assert.deepEqual(alt.g, { en: { "PSA 10": [310, 2], "BGS 9.5": [150, 1] }, jp: { "PSA 10": [250, 1] } });
});

test("prezzi segnaposto (5.000, 10.000 € e simili) scartati", () => {
  for (const p of [5000.43, 10000.64, 15001, 1000]) assert.equal(isPlaceholderPrice(p), true, String(p));
  for (const p of [999.99, 1532.8, 4675.46, 11765.46, 0.11]) assert.equal(isPlaceholderPrice(p), false, String(p));
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
