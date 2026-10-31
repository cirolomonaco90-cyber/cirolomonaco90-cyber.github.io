import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/build.js";
import { CardTrader } from "../src/cardtrader.js";
import { estimate, coefficients, cardRatio, ratioOffers, pickThreshold, conditionPrices } from "../src/stats.js";

const offer = (price, extra = {}) => ({
  price, currency: "EUR", condition: "Near Mint", reverse: null, firstEdition: null, graded: false, bundle: 1, quantity: 1, ...extra,
});

test("stima: mediana delle 5 più economiche riportate a NM", () => {
  assert.deepEqual(estimate([10, 12, 11, 30, 13, 14, 50].map((p) => offer(p)), "n"), [12, 7]);
  assert.deepEqual(estimate([offer(7, { condition: "Played" })], "n"), [17.5, 1]);
  // anomalo scartato, graded e lotti esclusi
  assert.deepEqual(estimate([offer(1), offer(10), offer(11), offer(12), offer(2, { graded: true }), offer(3, { bundle: 4 })], "n"), [11, 4]);
  // varianti
  const mix = [offer(5), offer(20, { reverse: true }), offer(200, { firstEdition: true })];
  assert.deepEqual(estimate(mix, "r"), [20, 1]);
  assert.deepEqual(estimate(mix, "f"), [200, 1]);
  assert.deepEqual(estimate(mix, "n"), [5, 1]);
  assert.equal(estimate([offer(5, { currency: "USD" })], "n"), null);
});

test("prezzi per condizione: solo con Near Mint e almeno 3 offerte", () => {
  const nm = [10, 11, 12, 30].map((p) => offer(p));
  const ex = [7, 8, 9].map((p) => offer(p, { condition: "Slightly Played" }));
  const gd = [5, 6].map((p) => offer(p, { condition: "Moderately Played" })); // troppo poche
  assert.deepEqual(conditionPrices([...nm, ...ex, ...gd], "n"), { NM: [11.5, 4], EX: [8, 3] });
  assert.equal(conditionPrices(nm, "n"), null); // solo Near Mint: niente da confrontare
  assert.equal(conditionPrices([...ex, ...gd], "n"), null); // senza Near Mint
  // Reverse a parte; le gradate e i lotti non contano.
  const rev = [20, 21, 22].map((p) => offer(p, { reverse: true }));
  assert.equal(conditionPrices([...rev, ...ex], "r"), null);
  assert.deepEqual(conditionPrices([...rev, ...ex.map((o) => ({ ...o, reverse: true })), offer(1, { graded: true, reverse: true })], "r"), { NM: [21, 3], EX: [8, 3] });
});

test("rapporto lingua/inglese sulla stessa carta", () => {
  assert.equal(cardRatio({ n: [72, 15] }, { n: [102, 20] }), 72 / 102);
  assert.equal(cardRatio({ n: [72, 3] }, { n: [102, 20] }), 72 / 102); // 3 offerte bastano per il campione
  assert.equal(cardRatio({ n: [72, 2] }, { n: [102, 20] }), null); // troppe poche offerte
  assert.equal(cardRatio({ n: [72, 14] }, { n: [102, 20] }, "n", 15), null); // soglia più alta a richiesta
  assert.equal(cardRatio({ n: [72, 15] }, undefined), null);
  assert.equal(cardRatio({ r: [10, 15] }, { r: [20, 15] }, "r"), 0.5);
  assert.equal(ratioOffers({ n: [72, 3] }, { n: [102, 20] }), 3);
});

test("coefficienti: lingua affidabile solo con abbastanza carte", () => {
  // 210 carte ben coperte: 200 nel set 1 (rapporto 0.7) e 10 nel set 2 (1.2)
  const s = Array.from({ length: 200 }, () => ({ exp: 1, ratio: 0.7, offers: 15 }));
  for (let i = 0; i < 10; i++) s.push({ exp: 2, ratio: 1.2, offers: 15 });
  assert.equal(pickThreshold(s), 15);
  const c = coefficients(s);
  assert.deepEqual(c.all, [0.7, 210]);
  assert.deepEqual(c[1], [0.7, 200]);
  assert.deepEqual(c[2], [1.2, 10]);
  // 150 carte: sotto le 200 a ogni soglia, ma più di 30 -> rapporto con la soglia più bassa (meno preciso)
  assert.equal(pickThreshold(s.slice(0, 150)), 3);
  assert.deepEqual(coefficients(s.slice(0, 150)).all, [0.7, 150]);
  // meno di 30 carte: niente rapporto, nemmeno per set
  assert.deepEqual(coefficients(s.slice(0, 20)), {});
});

test("coefficienti: soglia adattiva per lingua, la più alta con abbastanza carte", () => {
  // Come il tedesco: poche carte con 15 offerte, molte con 5 (rapporto gonfiato)
  const s = Array.from({ length: 50 }, () => ({ exp: 1, ratio: 1.2, offers: 15 }));
  for (let i = 0; i < 300; i++) s.push({ exp: 1, ratio: 1.6, offers: 5 });
  for (let i = 0; i < 400; i++) s.push({ exp: 2, ratio: 2.0, offers: 3 });
  assert.equal(pickThreshold(s), 5);
  const c = coefficients(s);
  assert.equal(c.all[1], 350); // solo le carte con almeno 5 offerte
  assert.equal(c.all[0], 1.6);
  assert.equal(c[2], undefined); // il set 2 ha solo carte sotto soglia
  // Come il portoghese: solo carte con poche offerte, ma più di 30
  const pt = Array.from({ length: 42 }, () => ({ exp: 1, ratio: 2.2, offers: 3 }));
  assert.deepEqual(coefficients(pt).all, [2.2, 42]);
});

/** Finto CardTrader con due espansioni e prezzi diversi per lingua. */
function fakeFetch(calls) {
  return async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const p = u.pathname;
    if (p.endsWith("/games")) return json([{ id: 6, name: "Pokemon" }]);
    if (p.endsWith("/expansions")) return json([
      { id: 100, game_id: 6, name: "Aquapolis" },
      { id: 101, game_id: 6, name: "Senza Cardmarket" },
      { id: 200, game_id: 1, name: "Magic" },
    ]);
    if (p.endsWith("/blueprints/export")) {
      const exp = u.searchParams.get("expansion_id");
      if (exp === "100") return json([
        { id: 1, name: "Lugia", category_id: 73, card_market_ids: [9001] },
        { id: 2, name: "Kingdra", category_id: 73, card_market_ids: [9002, 9003] },
        { id: 4, name: "Booster Box", category_id: 80, card_market_ids: [9100] }, // sigillato: non nei prezzi delle carte
      ]);
      return json([{ id: 3, name: "Promo", card_market_ids: [] }]);
    }
    if (p.endsWith("/marketplace/products")) {
      assert.equal(u.searchParams.get("expansion_id"), "100"); // solo espansioni utili
      const it = u.searchParams.get("language") === "it";
      const mk = (bp, cents, props = {}) => ({ blueprint_id: bp, price: { cents, currency: "EUR" }, quantity: 1, properties_hash: { condition: "Near Mint", ...props } });
      return json({
        "1": [mk(1, it ? 7000 : 10000), mk(1, it ? 7200 : 10200), mk(1, it ? 7400 : 10400), mk(1, 30000, { pokemon_reverse: true })],
        "2": [mk(2, it ? 300 : 500)],
      });
    }
    return json({}, 404);
  };
}

test("job completo con CardTrader simulato", async () => {
  const calls = [];
  const ct = new CardTrader({ token: "t", fetchFn: fakeFetch(calls), marketGapMs: 0, catalogGapMs: 0 });
  const { catalog, perLang } = await build({ ct, langs: ["it"], now: new Date("2026-10-18T00:00:00Z") });

  assert.deepEqual(catalog.exp, { 100: "Aquapolis" });
  assert.deepEqual(catalog.cm, { 9001: 100, 9002: 100, 9003: 100 });
  assert.deepEqual(catalog.bp, { 9001: 1, 9002: 2, 9003: 2 });

  const it = perLang.it;
  assert.deepEqual(it.p[9001].n, [72, 3]);
  assert.deepEqual(it.p[9001].r, [300, 1]);
  assert.deepEqual(it.p[9003].n, [3, 1]); // stessi dati per tutti gli id Cardmarket del blueprint
  // L'inglese è calcolato comunque come riferimento, ma non pubblicato se non richiesto.
  assert.equal(perLang.en, undefined);
  // Solo Lugia ha >= 3 offerte in entrambe le lingue: 1 campione, sotto il minimo per un coefficiente.
  assert.deepEqual(it.coef, {});
  // 2 lingue (en di riferimento + it) x 1 espansione utile = 2 richieste di offerte, più una in
  // giapponese per i sigillati dell'espansione (il Booster Box).
  assert.equal(calls.filter((c) => c.includes("marketplace")).length, 3);
  assert.equal(calls.filter((c) => c.includes("language=jp")).length, 1);
});

test("un token sbagliato ferma il job", async () => {
  const ct = new CardTrader({ token: "x", fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(build({ ct }), /Token/);
});
