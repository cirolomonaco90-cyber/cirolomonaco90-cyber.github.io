import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, priceClient, doneLine, ctGameOrder } from "../src/build.js";
import { buildCtGameFiles } from "../src/ct-giochi.js";
import { CardTrader } from "../src/cardtrader.js";
import { estimate, coefficients, cardRatio, ratioOffers, pickThreshold, conditionPrices, fakePrices, borrowCoefficients, RATIO_FROM_IT, firstEditionPremiums, premiumSample } from "../src/stats.js";

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

test("prezzi per condizione: almeno due condizioni con 3 offerte", () => {
  const nm = [10, 11, 12, 30].map((p) => offer(p));
  const ex = [7, 8, 9].map((p) => offer(p, { condition: "Slightly Played" }));
  const gd = [5, 6].map((p) => offer(p, { condition: "Moderately Played" })); // troppo poche
  assert.deepEqual(conditionPrices([...nm, ...ex, ...gd], "n"), { NM: [11.5, 4, 10, 11, 12], EX: [8, 3, 7, 8, 9] });
  assert.equal(conditionPrices(nm, "n"), null); // solo Near Mint: niente da confrontare
  assert.equal(conditionPrices([...ex, ...gd], "n"), null); // una condizione sola con abbastanza offerte
  // Senza Near Mint ma con due condizioni: pubblicati (l'app aggancia il valore alle offerte nella condizione, 0.9.177).
  const pl = [3, 4, 5].map((p) => offer(p, { condition: "Played" }));
  assert.deepEqual(conditionPrices([...ex, ...pl], "n"), { EX: [8, 3, 7, 8, 9], PL: [4, 3, 3, 4, 5] });
  // Reverse a parte; le gradate e i lotti non contano.
  const rev = [20, 21, 22].map((p) => offer(p, { reverse: true }));
  assert.equal(conditionPrices([...rev, ...ex], "r"), null);
  assert.deepEqual(conditionPrices([...rev, ...ex.map((o) => ({ ...o, reverse: true })), offer(1, { graded: true, reverse: true })], "r"), { NM: [21, 3, 20, 21, 22], EX: [8, 3, 7, 8, 9] });
});

test("prezzi per condizione: i tre più economici senza i prezzi finti (in misura)", () => {
  // Baron of the Fiend Sword SDY-036 di Yu-Gi-Oh! (CardTrader, 11 novembre 2026): un venditore chiede 200,64 € in ogni
  // condizione; le Near Mint vere sono a 2,30 € e 19,40 €. I primi due numeri (quelli che l'app legge) restano com'erano.
  const sp = (p) => offer(p, { condition: "Slightly Played" });
  const mp = (p) => offer(p, { condition: "Moderately Played" });
  const pl = (p) => offer(p, { condition: "Played" });
  const po = (p) => offer(p, { condition: "Poor" });
  const baron = [
    offer(2.3), offer(19.4), offer(85), offer(200.64),
    sp(0.6), sp(0.76), sp(0.82), sp(0.9), sp(200.64),
    mp(0.62), mp(0.72), mp(0.84), mp(200.64),
    pl(0.2), pl(0.32), pl(0.6), pl(200.64),
    po(0.19), po(0.31), po(0.6),
  ];
  assert.deepEqual([...fakePrices(baron.map((o) => ({ code: o.condition, price: o.price })))], [200.64]);
  const c = conditionPrices(baron, "n");
  assert.deepEqual(c.NM, [85, 4, 2.3, 19.4, 85]); // prima: mediana 85 € dopo aver scartato la più bassa "anomala"
  assert.deepEqual(c.EX, [0.82, 5, 0.6, 0.76, 0.82]);
  assert.deepEqual(c.PL, [0.46, 4, 0.2, 0.32, 0.6]);
  // 0,60 € sta in tre condizioni (Poor, Played, Slightly Played) ma è un prezzo basso: non è finto.
  assert.deepEqual(c.PO, [0.31, 3, 0.19, 0.31, 0.6]);
  // Meno di tre prezzi veri: 0 dove mancano (solo numeri: l'app legge elenchi di numeri).
  const few = [offer(5), offer(900), offer(900), sp(4), sp(900), sp(4.5), mp(900), mp(3), mp(3.5), pl(900), pl(2), pl(2.5)];
  assert.deepEqual(conditionPrices(few, "n").NM, [900, 3, 5, 0, 0]);
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

test("francese, spagnolo, portoghese e tedesco usano il rapporto dell'italiano", () => {
  assert.deepEqual(RATIO_FROM_IT, ["fr", "es", "pt", "de"]);
  const perLang = {
    en: { coef: {} },
    it: { coef: { all: [0.724, 13912], 100: [0.65, 40] } },
    de: { coef: { all: [1.273, 1802] } },
    fr: { coef: { all: [1.455, 313], 7: [1.3, 9] } },
    es: { coef: { all: [1.167, 717] } },
    pt: { coef: {} }, // sotto le 30 carte: senza rapporto
  };
  assert.deepEqual(borrowCoefficients(perLang), ["fr", "es", "pt", "de"]);
  for (const l of ["fr", "es", "pt", "de"]) {
    assert.deepEqual(perLang[l].coef, { all: [0.724, 13912], 100: [0.65, 40] }); // totale e per set
    assert.equal(perLang[l].coefFrom, "it");
  }
  // L'italiano resta il suo; una copia, non lo stesso oggetto.
  assert.equal(perLang.it.coefFrom, undefined);
  perLang.fr.coef.all[0] = 9;
  assert.equal(perLang.it.coef.all[0], 0.724);
  // Senza l'italiano niente da prestare: le lingue restano come sono.
  const senza = { fr: { coef: { all: [1.455, 313] } } };
  assert.deepEqual(borrowCoefficients(senza), []);
  assert.deepEqual(senza.fr.coef.all, [1.455, 313]);
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

test("maggiorazione della 1ª edizione per set", () => {
  // Campione da una voce di prodotto: servono almeno 3 offerte di entrambe.
  assert.deepEqual(premiumSample({ n: [100, 10], f: [250, 4] }), { ratio: 2.5, offers: 4 });
  assert.equal(premiumSample({ n: [100, 10], f: [250, 2] }), null);
  assert.equal(premiumSample({ n: [100, 10] }), null);
  // Comuni da pochi centesimi: fuori (i prezzi a pavimento gonfiano il rapporto).
  assert.equal(premiumSample({ n: [0.07, 30], f: [0.5, 12] }), null);
  const samples = [
    { exp: 1, ratio: 2.0, offers: 5 }, { exp: 1, ratio: 3.0, offers: 4 }, { exp: 1, ratio: 2.5, offers: 9 },
    { exp: 1, ratio: 40.0, offers: 3 }, { exp: 1, ratio: 1.8, offers: 6 },
    { exp: 2, ratio: 1.5, offers: 3 }, { exp: 2, ratio: 0.5, offers: 8 }, // sotto 1 = rumore: vale 1
    { exp: 3, ratio: 9.0, offers: 2 }, // poche offerte: fuori
  ];
  const first = firstEditionPremiums(samples);
  // Set 1: 5 carte, mediana 2,5; set 2: solo 2 carte, niente voce sua; totale 7 carte.
  assert.deepEqual(first[1], [2.5, 5]);
  assert.equal(first[2], undefined);
  assert.equal(first.all[1], 7);
  assert.equal(first.all[0], 2);
  assert.deepEqual(firstEditionPremiums([]), {});
});

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

// Parte "prezzi" del job (9 novembre 2026): 287 minuti su 350, e GitHub annulla la parte oltre il limite senza pubblicare
// nulla. Con CT_SCADENZA dopo quell'ora non si chiedono più offerte: valgono quelle lette nei giorni prima (cartelle
// sorelle di CT_CACHE) e i file della notte si scrivono lo stesso.
test("scadenza della notte: le offerte non lette dai giorni prima, il catalogo si pubblica comunque", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ct-notte-"));
  const now = new Date("2026-11-09T03:00:00Z");
  const fast = { marketGapMs: 0, catalogGapMs: 0 };
  // Ieri: giro normale, tutte le offerte lette e salvate nella cartella del giorno.
  const calls1 = [];
  const ieri = priceClient({ CARDTRADER_TOKEN: "t", CT_CACHE: path.join(root, "2026-11-08") }, { ...fast, fetchFn: fakeFetch(calls1) });
  assert.equal(ieri.deadline, 0);
  assert.equal(ieri.reuseDays, 0);
  const prima = await build({ ct: ieri, langs: ["it"], now });
  assert.equal(calls1.filter((c) => c.includes("marketplace")).length, 3);
  assert.equal(doneLine(ieri, 0, 229 * 60000), "Fatto in 229 minuti, 7 chiamate a CardTrader.");

  // Stanotte il tempo è già finito: nessuna richiesta di offerte, stessi prezzi di ieri; il catalogo (blueprint) si chiede sempre.
  const calls2 = [];
  const oggi = priceClient(
    { CARDTRADER_TOKEN: "t", CT_CACHE: path.join(root, "2026-11-09"), CT_SCADENZA: String(Date.now() - 1) },
    { ...fast, fetchFn: fakeFetch(calls2) },
  );
  assert.ok(oggi.deadline > 0);
  const dopo = await build({ ct: oggi, langs: ["it"], now });
  assert.equal(calls2.filter((c) => c.includes("marketplace")).length, 0);
  assert.equal(calls2.filter((c) => c.includes("blueprints")).length, 2);
  assert.deepEqual(dopo.perLang.it.p, prima.perLang.it.p);
  assert.deepEqual(dopo.catalog.cm, prima.catalog.cm);
  assert.equal(oggi.reused, 3);
  assert.equal(oggi.skipped, 0);
  assert.match(doneLine(oggi, 0, 60000), /tempo della notte finito: 3 letture di offerte prese dai giorni prima\.$/);
  // Le letture dei giorni prima non si copiano nella cartella di oggi: domani si vede ancora di che giorno sono.
  assert.deepEqual((await fs.readdir(path.join(root, "2026-11-09"))).filter((f) => f.startsWith("offers")), []);

  // Senza letture dei giorni prima: le espansioni restano fuori per stanotte, ma i file si scrivono e il registro lo dice.
  const solo = priceClient(
    { CARDTRADER_TOKEN: "t", CT_CACHE: path.join(root, "altrove", "2026-11-09"), CT_SCADENZA: String(Date.now() - 1) },
    { ...fast, fetchFn: fakeFetch([]) },
  );
  const vuoto = await build({ ct: solo, langs: ["it"], now });
  assert.deepEqual(vuoto.perLang.it.p, {});
  assert.deepEqual(vuoto.catalog.cm, prima.catalog.cm);
  assert.ok(vuoto.log.some((l) => /^it: 0 prodotti con offerte.*1 espansioni non lette/.test(l)));
  assert.equal(solo.skipped, 3);
  assert.match(doneLine(solo, 0, 60000), /, 3 rimandate alla prossima notte \(mai lette nei giorni prima\)\.$/);

  // Scadenza non ancora arrivata: tutto come sempre, niente letture vecchie anche se ci sono.
  const calls3 = [];
  const presto = priceClient(
    { CARDTRADER_TOKEN: "t", CT_CACHE: path.join(root, "2026-11-10"), CT_SCADENZA: String(Date.now() + 3_600_000) },
    { ...fast, fetchFn: fakeFetch(calls3) },
  );
  await build({ ct: presto, langs: ["it"], now });
  assert.equal(calls3.filter((c) => c.includes("marketplace")).length, 3);
  assert.equal(presto.reused, 0);
  await fs.rm(root, { recursive: true });
});

test("giochi CardTrader: l'ordine gira ogni giorno, così l'ultimo della fila non è sempre lo stesso", async () => {
  const keys = ["onepiece", "lorcana", "dragonball"];
  assert.deepEqual(ctGameOrder(keys, 0), ["onepiece", "lorcana", "dragonball"]);
  assert.deepEqual(ctGameOrder(keys, 1), ["lorcana", "dragonball", "onepiece"]);
  assert.deepEqual(ctGameOrder(keys, 2), ["dragonball", "onepiece", "lorcana"]);
  assert.deepEqual(ctGameOrder(keys, 3), keys);
  assert.deepEqual(ctGameOrder([], 5), []);
  // In tre notti di fila ognuno è ultimo una volta sola.
  assert.deepEqual(new Set([20766, 20767, 20768].map((d) => ctGameOrder(keys, d).at(-1))).size, 3);
  // buildCtGameFiles li costruisce nell'ordine chiesto (e solo quelli).
  const built = [];
  const games = keys.map((key) => ({ key, label: key, build: async () => { built.push(key); throw new Error("prova"); } }));
  const log = await buildCtGameFiles({ ct: null, dir: os.tmpdir(), only: ["dragonball", "onepiece"], games });
  assert.deepEqual(built, ["dragonball", "onepiece"]);
  assert.equal(log.length, 2);
});
