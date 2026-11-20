import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCmPrices, cardLine, lineParts, variantProduct, tcgBlock, hasTcgPrices, FIELDS, applyOwnProducts } from "../src/cm-prezzi.js";
import { compactCard, compactVariant, compactTcgplayer, cardFlags, scan, needsFetch, FORMAT, RECHECK_DAYS, TCGPLAYER_DAYS } from "../src/tcgdex-scan.js";

// Charizard del Set Base e di Vivid Voltage, risposte reali di TCGdex (novembre 2026), ridotte.
const charizardBase = compactCard({
  id: "base1-4", localId: "4", name: "Charizard", set: { id: "base1" },
  thirdParty: { cardmarket: 273699 },
  pricing: { cardmarket: { idProduct: 273699, avg: 458.1, low: 99, trend: 441.22, avg1: 134.5, avg7: 390.77, avg30: 457.47, "trend-holo": 123.63 }, tcgplayer: null },
  variants_detailed: [
    { type: "holo", subtype: "unlimited", size: "standard", thirdParty: { cardmarket: 273699 }, pricing: { cardmarket: { idProduct: 273699, trend: 441.22 } } },
    { type: "holo", subtype: "shadowless", size: "standard", stamp: ["1st-edition"], thirdParty: { cardmarket: 660224 }, pricing: { cardmarket: { idProduct: 660224, trend: 3843.13 } } },
    { type: "holo", subtype: "1999-2000-copyright", size: "standard" },
  ],
});
const charizardVivid = compactCard({
  id: "swsh4-25", localId: "25", name: "Charizard", set: { id: "swsh4" },
  thirdParty: { cardmarket: 511545 },
  pricing: { cardmarket: { idProduct: 511545, trend: 5.18 } },
  variants_detailed: [
    { type: "normal", size: "standard", thirdParty: { cardmarket: 511545 }, pricing: { cardmarket: { idProduct: 511545, trend: 5.18 } } },
    { type: "holo", size: "standard", foil: "cracked-ice", thirdParty: { cardmarket: 547881 }, pricing: { cardmarket: { idProduct: 547881, trend: 15.1 } } },
    // Prodotto collegato ma senza prezzi su TCGdex.
    { type: "reverse", size: "jumbo", thirdParty: { cardmarket: 999 } },
  ],
});
const guide = {
  createdAt: "2026-11-02T02:49:43+0100",
  priceGuides: [
    { idProduct: 273699, idCategory: 51, avg: 458.1, low: 99, trend: 441.22, avg1: 134.5, avg7: 390.77, avg30: 457.47, "avg-holo": null, "low-holo": null, "trend-holo": 123.63, "avg1-holo": 207.4, "avg7-holo": 129.55, "avg30-holo": 202.71 },
    { idProduct: 660224, idCategory: 51, avg: 3400, low: 979, trend: 3843.13, avg1: 3800, avg7: 2725.38, avg30: 2456.05, "avg-holo": null, "low-holo": null, "trend-holo": 0, "avg1-holo": null, "avg7-holo": null, "avg30-holo": null },
    { idProduct: 511545, idCategory: 51, avg: 2.54, low: 1, trend: 5.18, avg1: 1.5, avg7: 7.26, avg30: 3.79, "avg-holo": 3.01, "low-holo": 1.99, "trend-holo": 2.86, "avg1-holo": 2.22, "avg7-holo": 3, "avg30-holo": 3.09 },
    { idProduct: 547881, idCategory: 51, avg: 15.15, low: 3.5, trend: 15.1, avg1: 14.3, avg7: 19.49, avg30: 14.81, "avg-holo": null, "low-holo": null, "trend-holo": 0, "avg1-holo": null, "avg7-holo": null, "avg30-holo": null },
    // Nel listino ma senza nessun prezzo: come su TCGdex, che non dà il blocco dei prezzi.
    { idProduct: 999, idCategory: 51, avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: null, "avg-holo": null, "low-holo": null, "trend-holo": null, "avg1-holo": null, "avg7-holo": null, "avg30-holo": null },
    { idProduct: 123, idCategory: 51, avg: 1, low: 1, trend: 1 }, // non usato da nessuna carta
    { idProduct: 787561, idCategory: 51, avg: 0.03, trend: 0.03 },
  ],
};

test("varianti compatte: tipo, prodotto e dettagli come li legge l'app", () => {
  assert.deepEqual(charizardBase.vd, [
    "holo:273699|subtype:unlimited",
    "holo:660224|subtype:shadowless|stamp:1st-edition",
    "holo:|subtype:1999-2000-copyright",
  ]);
  assert.deepEqual(charizardVivid.vd, ["normal:511545", "holo:547881|foil:cracked-ice", "reverse:999!|size:jumbo"]);
  assert.equal(compactVariant({ type: "holo", size: "standard", stamp: ["staff", "pre-release"], foil: "cosmos" }), "holo:|stamp:staff|stamp:pre-release|foil:cosmos");
  assert.equal(variantProduct("reverse:999!|size:jumbo"), 999);
  assert.equal(variantProduct("holo:|subtype:x"), null);
  assert.equal(charizardBase.tp, false);
  assert.equal(charizardBase.pr, true);
});

test("riga della carta: prodotto principale e varianti", () => {
  assert.equal(cardLine(charizardBase), "273699;holo:273699|subtype:unlimited;holo:660224|subtype:shadowless|stamp:1st-edition;holo:|subtype:1999-2000-copyright");
  assert.equal(cardLine(charizardBase, { variants: false }), "273699");
  // Carta senza prodotto e senza varianti; carta salvata da uno script vecchio (senza vd); carta con prezzi TCGplayer.
  assert.equal(cardLine({ id: "x", cm: null, vd: [] }), "");
  assert.equal(cardLine({ id: "x", cm: 5 }), null);
  assert.equal(cardLine({ id: "x", cm: 5, vd: [], tp: true }), null);
  assert.equal(compactCard({ id: "y", pricing: { cardmarket: { idProduct: 1 }, tcgplayer: { normal: { marketPrice: 2 } } } }).tp, true);
});

test("file dei prezzi: carte, prodotti usati e listino con gli zeri di TCGdex", () => {
  const ja = compactCard({ id: "SV7a-001", localId: "001", pricing: { cardmarket: { idProduct: 787561, avg: 0.03, trend: 0.03 } }, variants_detailed: [{ type: "normal" }] });
  // Stesso id in giapponese e in inglese (Neo Destiny): prodotto giapponese e varianti inglesi; senza prodotto giapponese, quello inglese.
  const jaSame = compactCard({ id: "swsh4-25", localId: "25", pricing: { cardmarket: { idProduct: 555 } }, variants_detailed: [{ type: "holo", thirdParty: { cardmarket: 556 } }] });
  const jaEmpty = compactCard({ id: "base1-4", localId: "4", variants_detailed: [] });
  const { out, stats } = buildCmPrices([charizardBase, charizardVivid], guide, [ja, jaSame, jaEmpty]);
  assert.equal(out.v, 1);
  assert.equal(out.guide, "2026-11-02T02:49:43+0100");
  assert.equal(Object.keys(out.c).length, 2);
  assert.deepEqual(out.j, {
    "SV7a-001": "787561",
    "swsh4-25": "555;normal:511545;holo:547881|foil:cracked-ice;reverse:999!|size:jumbo",
    "base1-4": out.c["base1-4"],
  });
  assert.deepEqual(out.p[273699], [458.1, 99, 441.22, 134.5, 390.77, 457.47, 0, 0, 123.63, 207.4, 129.55, 202.71]);
  assert.deepEqual(out.p[660224], [3400, 979, 3843.13, 3800, 2725.38, 2456.05]); // gli zeri finali si tolgono
  assert.equal(out.p[999], undefined); // nel listino senza nessun prezzo: come se non ci fosse
  assert.deepEqual(out.p[787561], [0.03, 0, 0.03]);
  assert.equal(out.p[123], undefined);
  assert.equal(FIELDS.length, 12);
  assert.deepEqual(stats, { noSource: 1, cards: 2, ja: 3, tcg: 0, jaTcg: 0, blocks: 0, filled: 0, worlds: 0, finishes: 0, skipped: 0, products: 7, priced: 5 });
  // Senza prezzi TCGplayer il file è quello di prima, con le tabelle nuove vuote.
  assert.deepEqual([out.ct, out.jt, out.t], [{}, {}, []]);
  // Prodotto con solo zeri nel listino: resta, vuoto (TCGdex dà il blocco dei prezzi, tutto a zero).
  const zero = buildCmPrices([compactCard({ id: "z", pricing: { cardmarket: { idProduct: 7, trend: 0 } } })], { priceGuides: [{ idProduct: 7, trend: 0, avg: null }] });
  assert.deepEqual(zero.out.p[7], []);
});

test("scansione TCGdex: le carte lette senza prodotto Cardmarket si ricontrollano ogni notte", () => {
  const today = 20766;
  // Lugia della Collezione Classica del 30°, letta il 2 novembre quando TCGdex non la collegava ancora a Cardmarket.
  const senza = { id: "30th-c-029", f: FORMAT, vd: ["normal:"], cm: null, tp: false, ck: today - RECHECK_DAYS };
  assert.equal(needsFetch(senza, today), true);
  assert.equal(needsFetch({ ...senza, ck: today }, today), false);
  // Letta da una versione che non scriveva il giorno: si ricontrolla subito.
  assert.equal(needsFetch({ ...senza, ck: undefined }, today), true);
  // Col prodotto resta in cache fino al lunedì.
  assert.equal(needsFetch({ ...senza, cm: 907945, ck: 0 }, today), false);
  // Con i prezzi TCGplayer si rilegge ogni notte (cambiano ogni giorno e il file dei prezzi li riporta), con o senza prodotto.
  assert.equal(TCGPLAYER_DAYS, 1);
  assert.equal(needsFetch({ ...senza, tp: true, ck: today - 1 }, today), true);
  assert.equal(needsFetch({ ...senza, cm: 907945, tp: true, ck: today - 1 }, today), true);
  assert.equal(needsFetch({ ...senza, cm: 907945, tp: true, ck: today }, today), false);
  assert.equal(RECHECK_DAYS, 1);
  // Mai letta o in un formato vecchio: si scarica.
  assert.equal(needsFetch(undefined, today), true);
  assert.equal(needsFetch({ ...senza, cm: 1, f: FORMAT - 1 }, today), true);
});

// Charizard di Vivid Voltage e del Set Base con i prezzi TCGplayer, risposte reali di TCGdex del 9 novembre 2026 (ridotte):
// la carta e le varianti dello stesso prodotto TCGplayer hanno lo stesso blocco; la cracked ice e le shadowless nessuno.
const TP_VIVID = {
  unit: "USD", updated: "2026-11-08T23:49:47.143Z",
  "reverse-holofoil": { productId: 226395, lowPrice: 1.2, midPrice: 4.69, highPrice: 29.99, marketPrice: 4.51, directLowPrice: 4.75 },
  normal: { productId: 226395, lowPrice: 1.5, midPrice: 3.91, highPrice: 82.32, marketPrice: 3.74, directLowPrice: 4.68 },
};
const vividTcg = {
  id: "swsh4-25", localId: "25", name: "Charizard", set: { id: "swsh4" },
  thirdParty: { cardmarket: 511545 },
  pricing: { cardmarket: { idProduct: 511545, trend: 6.19 }, tcgplayer: TP_VIVID },
  variants_detailed: [
    { type: "normal", size: "standard", thirdParty: { cardmarket: 511545, tcgplayer: 226395 }, pricing: { cardmarket: { idProduct: 511545, trend: 6.19 }, tcgplayer: TP_VIVID } },
    { type: "holo", size: "standard", foil: "cracked-ice", thirdParty: { cardmarket: 547881 }, pricing: { cardmarket: { idProduct: 547881, trend: 15.1 }, tcgplayer: null } },
    { type: "reverse", size: "standard", thirdParty: { cardmarket: 511545, tcgplayer: 226395 }, pricing: { cardmarket: { idProduct: 511545, trend: 6.19 }, tcgplayer: TP_VIVID } },
  ],
};
const TP_BASE = { unit: "USD", updated: "2026-11-08T23:50:19.666Z", holofoil: { productId: 42382, lowPrice: 475, midPrice: 652.04, highPrice: 3499.1, marketPrice: 987.13, directLowPrice: 1499.09 } };
const baseTcg = {
  id: "base1-4", localId: "4", name: "Charizard", set: { id: "base1" },
  pricing: { cardmarket: { idProduct: 273699, trend: 353.78 }, tcgplayer: TP_BASE },
  variants_detailed: [
    { type: "holo", subtype: "unlimited", size: "standard", thirdParty: { cardmarket: 273699, tcgplayer: 42382 }, pricing: { cardmarket: { idProduct: 273699, trend: 353.78 }, tcgplayer: TP_BASE } },
    { type: "holo", subtype: "shadowless", size: "standard", stamp: ["1st-edition"], thirdParty: { tcgplayer: 106999, cardmarket: 660224 }, pricing: { cardmarket: { idProduct: 660224, trend: 3843.13 }, tcgplayer: null } },
    { type: "holo", subtype: "1999-2000-copyright", size: "standard" },
  ],
};

test("prezzi TCGplayer di TCGdex in breve: mercato e medio per versione, in dollari", () => {
  assert.deepEqual(compactTcgplayer(vividTcg.pricing), { "reverse-holofoil": [4.51, 4.69], normal: [3.74, 3.91] });
  assert.equal(compactTcgplayer({ cardmarket: { idProduct: 1 }, tcgplayer: null }), null);
  assert.equal(compactTcgplayer({ tcgplayer: { unit: "USD", updated: "2026-11-08" } }), null);
  // Un campo che manca resta "manca", non zero: l'app passa dal prezzo di mercato al medio solo se il primo non c'è.
  assert.deepEqual(compactTcgplayer({ tcgplayer: { holofoil: { marketPrice: null, midPrice: 12.5 }, normal: { marketPrice: 0, midPrice: 1 }, "1st-edition": {} } }), {
    holofoil: [null, 12.5], normal: [0, 1], "1st-edition": [null, null],
  });
  const c = compactCard(vividTcg);
  assert.equal(c.f, FORMAT);
  assert.equal(c.tp, true);
  assert.deepEqual(c.tpp, { "reverse-holofoil": [4.51, 4.69], normal: [3.74, 3.91] });
  // Una voce per variante dettagliata, nello stesso ordine di "vd".
  assert.deepEqual(c.vt, [c.tpp, null, c.tpp]);
  assert.deepEqual(c.vd, ["normal:511545|tp:226395", "holo:547881|foil:cracked-ice", "reverse:511545|tp:226395"]);
  // Carta senza prezzi TCGplayer: niente campi in più.
  assert.equal("tpp" in charizardBase || "vt" in charizardBase, false);
  assert.equal(tcgBlock(c.tpp), "reverse-holofoil=4.51/4.69,normal=3.74/3.91");
  assert.equal(tcgBlock({ holofoil: [null, 12.5], normal: [3.74, null], "1st-edition": [null, null], zero: [0, 0] }), "holofoil=/12.5,normal=3.74,1st-edition=,zero=0/0");
});

test("file dei prezzi: le carte con prezzi TCGplayer in tabelle a parte, che le app vecchie non leggono", () => {
  const vivid = compactCard(vividTcg);
  const base = compactCard(baseTcg);
  assert.equal(hasTcgPrices(vivid), true);
  assert.equal(hasTcgPrices(charizardBase), false);
  // Senza la tabella dei blocchi (o letta da uno script vecchio, senza i prezzi) la carta resta fuori, come prima.
  assert.equal(cardLine(vivid), null);
  assert.equal(cardLine({ ...vivid, tpp: undefined, vt: undefined }, { ref: () => 0 }), null);
  const plain = compactCard({ id: "xy1-1", pricing: { cardmarket: { idProduct: 273699, trend: 1 } }, variants_detailed: [{ type: "normal", thirdParty: { cardmarket: 273699, tcgplayer: 5 }, pricing: { cardmarket: { idProduct: 273699, trend: 1 } } }] });
  // Giapponesi: solo il blocco della carta; una con lo stesso id di una inglese prende le sue varianti (e i loro prezzi).
  const ja = compactCard({ id: "SV7a-001", localId: "001", pricing: { cardmarket: { idProduct: 787561, trend: 0.03 }, tcgplayer: { normal: { productId: 9, marketPrice: 0.11, midPrice: 0.2 } } } });
  const jaPlain = compactCard({ id: "SV7a-002", localId: "002", pricing: { cardmarket: { idProduct: 787561, trend: 0.03 } } });
  const jaSame = compactCard({ id: "base1-4", localId: "4", variants_detailed: [] });
  const { out, stats } = buildCmPrices([vivid, base, plain], guide, [ja, jaPlain, jaSame]);
  // Le app fino alla 0.9.172 leggono solo c, j e p: lì restano le carte senza prezzi TCGplayer.
  assert.deepEqual(out.c, { "xy1-1": "273699;normal:273699|tp:5" });
  assert.deepEqual(out.j, { "SV7a-002": "787561" });
  assert.deepEqual(out.t, ["reverse-holofoil=4.51/4.69,normal=3.74/3.91", "holofoil=987.13/652.04", "normal=0.11/0.2"]);
  assert.deepEqual(out.ct, {
    "swsh4-25": "511545|t:0;normal:511545|tp:226395|t:0;holo:547881|foil:cracked-ice;reverse:511545|tp:226395|t:0",
    "base1-4": "273699|t:1;holo:273699|subtype:unlimited|tp:42382|t:1;holo:660224|subtype:shadowless|stamp:1st-edition|tp:106999;holo:|subtype:1999-2000-copyright",
  });
  assert.deepEqual(out.jt, { "SV7a-001": "787561|t:2", "base1-4": out.ct["base1-4"] });
  // I prodotti Cardmarket delle carte con prezzi TCGplayer entrano nel listino del file.
  assert.deepEqual(Object.keys(out.p).map(Number).sort((a, b) => a - b), [273699, 511545, 547881, 660224, 787561]);
  assert.deepEqual(stats, { noSource: 1, cards: 3, ja: 3, tcg: 2, jaTcg: 2, blocks: 3, filled: 0, worlds: 0, finishes: 0, skipped: 0, products: 5, priced: 5 });
  // Posizioni in base 36.
  const many = Array.from({ length: 40 }, (_, i) => compactCard({ id: `m-${i}`, pricing: { tcgplayer: { normal: { marketPrice: i + 1 } } } }));
  assert.equal(buildCmPrices(many, { priceGuides: [] }).out.ct["m-37"], "|t:11");
});

test("scansione TCGdex: scadenza e giro completo tengono i dati di prima per le carte non lette", async () => {
  const today = 20766;
  const now = today * 86_400_000;
  const old = (id, extra = {}) => ({ ...compactCard({ id, pricing: { cardmarket: { idProduct: 1 } } }), ck: today - 1, ...extra });
  const cache = { a: old("a", { tp: true, tpp: { normal: [1, 1] } }), b: old("b"), gone: old("gone") };
  const getList = async () => [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const asked = [];
  const getCard = async (lang, id) => {
    asked.push(id);
    if (id === "d") throw new Error("503");
    return { id, pricing: { cardmarket: { idProduct: 2 }, tcgplayer: { normal: { marketPrice: 2, midPrice: 3 } } } };
  };
  const log = [];
  // Giro normale: le carte nuove prima, poi quella con prezzi TCGplayer; "b" (col prodotto) resta com'è.
  const out = await scan(cache, { now, concurrency: 1, getList, getCard, log: (s) => log.push(s) });
  assert.deepEqual(asked, ["c", "d", "a"]);
  assert.deepEqual(out.a.tpp, { normal: [2, 3] });
  assert.equal(out.a.ck, today);
  assert.equal(out.b.ck, today - 1);
  assert.equal(out.d, undefined);
  assert.equal(out.gone, undefined); // tolta da TCGdex
  assert.match(log[0], /4 carte, da scaricare 3 \(di cui 1 per i prezzi TCGplayer di oggi e 0 senza prodotto/);
  assert.ok(log.some((l) => /1 carte non lette/.test(l)));
  // Tempo finito dopo la prima carta: le altre tengono i dati di prima e il registro lo dice.
  asked.length = 0;
  let t = 0;
  const late = await scan(cache, { now, concurrency: 1, getList, getCard, deadline: 5, clock: () => (t += 3), log: (s) => log.push(s) });
  assert.deepEqual(asked, ["c"]);
  assert.deepEqual(late.a.tpp, { normal: [1, 1] });
  assert.ok(log.some((l) => /tempo finito: 2 carte rimandate/.test(l)));
  // Giro della settimana: si rileggono tutte, anche "b".
  asked.length = 0;
  await scan(cache, { now, concurrency: 1, getList, getCard, all: true });
  assert.deepEqual(asked, ["c", "d", "a", "b"]);
  // Elenco vuoto da TCGdex: errore, la cache non si svuota (e il file dei prezzi non esce senza carte).
  await assert.rejects(scan(cache, { now, getList: async () => null, getCard }), /elenco delle carte vuoto/);
});

test("lettere della carta: versioni dichiarate, rarità holo o no, nomi senza reverse", () => {
  assert.equal(cardFlags({ variants: { normal: true, reverse: true, holo: false, firstEdition: false, wPromo: false }, rarity: "Rare", name: "Gengar" }), "nrR");
  assert.equal(cardFlags({ variants: { firstEdition: true, holo: true }, rarity: "Rare Holo", name: "Charizard" }), "h1H");
  assert.equal(cardFlags({ rarity: null, name: "Snivy" }), "");
  assert.equal(cardFlags({}), "");
  // Stessa regola di Variants.NO_REVERSE_NAME nell'app: " ex" e " EX" in fondo, la stella, "Star" in fondo.
  for (const name of ["Regirock ex", "Mewtwo EX", "Mew ☆", "Mew Star", "Rayquaza ☆ δ"]) assert.equal(cardFlags({ name }), "x", name);
  for (const name of ["Charizard-EX", "Exeggcute", "Starmie", "Charizard ex δ", "Staryu"]) assert.equal(cardFlags({ name }), "", name);
  // In fondo alla riga, come una variante senza tipo: le app vecchie la saltano.
  const regirock = compactCard({
    id: "ex5-98", name: "Regirock ex", rarity: "Rare Holo ex", variants: { holo: true, normal: false, reverse: false, firstEdition: false },
    pricing: { cardmarket: { idProduct: 277000, trend: 20 } }, variants_detailed: [{ type: "holo", thirdParty: { cardmarket: 277000 }, pricing: { cardmarket: { idProduct: 277000 } } }],
  });
  assert.equal(regirock.fl, "hHx");
  assert.equal(cardLine(regirock), "277000;holo:277000;:hHx");
  assert.equal(cardLine(regirock, { variants: false }), "277000;:hHx");
  assert.deepEqual(lineParts("277000|t:3;holo:277000|tp:5|t:3;reverse:;:hHx"), { root: "277000|t:3", vd: ["holo:277000|tp:5|t:3", "reverse:"], flags: ":hHx" });
  assert.deepEqual(lineParts(""), { root: "", vd: [], flags: null });
  // Stesso id in giapponese e in inglese: prodotto e lettere della carta giapponese, varianti di quella inglese.
  const ja = compactCard({ id: "ex5-98", name: "レジロックex", rarity: "Rare", variants: { normal: true }, pricing: { cardmarket: { idProduct: 555 } } });
  const { out } = buildCmPrices([regirock], { priceGuides: [] }, [ja]);
  assert.deepEqual(out.j, { "ex5-98": "555;holo:277000;:nR" });
  assert.deepEqual(out.c, { "ex5-98": "277000;holo:277000;:hHx" });
});

test("file dei prezzi: dice da che giorno sono lette le carte senza nessuna fonte di prezzo", () => {
  const today = 20767;
  const card = (id, extra = {}) => ({ ...compactCard({ id, variants_detailed: [{ type: "normal" }] }), ...extra });
  const conProdotto = { ...compactCard({ id: "a-1", pricing: { cardmarket: { idProduct: 5 } } }), ck: today - 30 };
  const conVariante = { ...compactCard({ id: "a-2", variants_detailed: [{ type: "holo", thirdParty: { cardmarket: 6 } }] }), ck: today - 30 };
  const conTcg = { ...compactCard({ id: "a-3", pricing: { tcgplayer: { normal: { marketPrice: 1 } } } }), ck: today - 30 };
  // Tutte lette stanotte: ck di oggi. Quelle con una fonte non contano, per quanto vecchie.
  const fresh = buildCmPrices([conProdotto, conVariante, conTcg, card("b-1", { ck: today })], { priceGuides: [] }, [card("J-1", { ck: today })], { today });
  assert.equal(fresh.out.ck, today);
  assert.equal(fresh.stats.noSource, 2);
  // Una carta senza fonte non riletta da tre giorni (scansione ferma o tempo finito): ck è il suo giorno, e l'app la richiede a TCGdex.
  assert.equal(buildCmPrices([card("b-1", { ck: today })], { priceGuides: [] }, [card("J-1", { ck: today - 3 })], { today }).out.ck, today - 3);
  // Senza il giorno della lettura (cache di uno script vecchio): zero, cioè "non si sa".
  assert.equal(buildCmPrices([card("b-1")], { priceGuides: [] }, [], { today }).out.ck, 0);
  // Nessuna carta senza fonte: oggi.
  assert.equal(buildCmPrices([conProdotto], { priceGuides: [] }, [], { today }).out.ck, today);
});

// Come leggevano una riga le app fino alla 0.9.172 (CmPrices.card di allora): prodotti = i numeri della prima voce, varianti
// = le altre voci con un tipo prima dei due punti. Le righe di c e j devono dare a loro le stesse cose di prima.
function oldAppCard(line) {
  const parts = line.split(";");
  const roots = parts[0].split(",").filter((x) => /^[+-]?\d+$/.test(x)).map(Number);
  const variants = parts.slice(1).map((v) => {
    const fields = v.split("|");
    const head = fields[0];
    const type = head.includes(":") ? head.slice(0, head.indexOf(":")) : head;
    if (type.trim() === "") return null;
    const productText = head.includes(":") ? head.slice(head.indexOf(":") + 1) : "";
    const product = /^\d+$/.test(productText.replace(/!+$/, "")) ? Number(productText.replace(/!+$/, "")) : null;
    return { type, product, priced: product !== null && !productText.endsWith("!"), details: fields.slice(1) };
  }).filter(Boolean);
  return { roots, variants };
}

test("app già installate: le righe che leggono (c, j) danno le stesse carte di prima, la voce delle lettere si salta", () => {
  // Gligar δ di Dragon Frontiers (senza prezzi TCGplayer: resta in c) con le lettere in fondo.
  const gligar = compactCard({
    id: "ex15-16", name: "Gligar δ", rarity: "Rare", variants: { normal: true, holo: false, reverse: false, firstEdition: false },
    thirdParty: { cardmarket: 277221 }, pricing: { cardmarket: { idProduct: 277221, trend: 1.88 } },
    variants_detailed: [{ type: "normal", size: "standard" }, { type: "normal", size: "standard", stamp: ["set-logo"] }],
  });
  const ja = compactCard({ id: "SV7a-001", name: "ピカチュウ", rarity: "Common", variants: { normal: true }, pricing: { cardmarket: { idProduct: 787561 } } });
  const { out } = buildCmPrices([gligar, compactCard(vividTcg)], guide, [ja]);
  assert.equal(out.c["ex15-16"], "277221;normal:;normal:|stamp:set-logo;:nR");
  assert.deepEqual(oldAppCard(out.c["ex15-16"]), oldAppCard("277221;normal:;normal:|stamp:set-logo"));
  assert.deepEqual(oldAppCard(out.c["ex15-16"]).variants.map((v) => v.type), ["normal", "normal"]);
  assert.equal(out.j["SV7a-001"], "787561;:nR");
  assert.deepEqual(oldAppCard(out.j["SV7a-001"]), { roots: [787561], variants: [] });
  // La carta con prezzi TCGplayer non è tra quelle che le app vecchie vedono: la chiedono a TCGdex, come prima.
  assert.equal(out.c["swsh4-25"], undefined);
  assert.equal(out.j["swsh4-25"], undefined);
  assert.ok(out.ct["swsh4-25"].includes("|t:"));
});

test("carte senza fonte di prezzo: dal catalogo TCGplayer, solo con numero e nome uguali e nel gruppo del set", async () => {
  const { tcgplayerFill, buildCmPrices: build } = await import("../src/cm-prezzi.js");
  // Dati reali del 17 novembre 2026: Volta Cromatica di Destino Sfuggente (sma), che TCGdex lascia senza nessun prodotto,
  // e le prime promo Bianco e Nero, che nel catalogo TCGplayer ci sono due volte (la promo e la ristampa gigante del
  // «First Partner Pack», stesso numero e stesso nome).
  const catalog = {
    usdEur: 1.1014,
    g: { 2594: ["Hidden Fates: Shiny Vault", 3], 1407: ["Black and White Promos", 3], 2776: ["First Partner Pack", 3], 23876: ["S-P: Sword & Shield Promos", 85] },
    p: {
      197738: ["Scyther", 2594, "SV1/SV94", 8.9], 197764: ["Quagsire", 2594, "SV10/SV94", 16.07], 197765: ["Froakie", 2594, "SV11/SV94", 8.78],
      197766: ["Frogadier", 2594, "SV12/SV94", 6.16], 197767: ["Voltorb", 2594, "SV13/SV94", 4.56], 197768: ["Xurkitree", 2594, "SV14/SV94", 4.92],
      197769: ["Seviper", 2594, "SV15/SV94", 2.2], 197771: ["Shuppet", 2594, "SV16/SV94", 6.14], 197772: ["Inkay", 2594, "SV17/SV94", 2.43],
      197780: ["Charizard GX", 2594, "SV49/SV94", 707.53], 197848: ["Tapu Lele GX", 2594, "SV94/SV94", null],
      89377: ["Snivy - BW01", 1407, "BW01", 2.81], 231467: ["Snivy", 2776, "BW01", 1.71],
    },
  };
  const sma = (n, name, fl = "nR") => ({ id: `sma-SV${n}`, set: "sma", localId: `SV${n}`, name, cm: null, vd: ["normal:"], fl });
  const cards = [
    sma(1, "Scyther"), sma(10, "Quagsire"), sma(11, "Froakie"), sma(12, "Frogadier"), sma(13, "Voltorb"), sma(14, "Xurkitree"), sma(15, "Seviper"),
    sma(16, "Shuppet"), sma(17, "Inkay"), sma(49, "Charizard-GX"), sma(94, "Tapu Lele-GX"),
    // Nome diverso da quello del prodotto con lo stesso numero: niente.
    sma(18, "Scyther"),
    { id: "bwp-BW01", set: "bwp", localId: "BW01", name: "Snivy", cm: null, vd: ["normal:"], fl: "nR" },
    // Ha già un prodotto Cardmarket: non si tocca.
    { id: "sm9-1", set: "sm9", localId: "1", name: "Scyther", cm: 123, vd: ["normal:123"], fl: "nR" },
  ];
  const fill = tcgplayerFill(cards, catalog);
  // Charizard GX: 707,53 € nel catalogo = 779,27 $ col cambio del giorno, scritto come un prezzo di mercato di TCGdex.
  assert.deepEqual(fill.get("sma-SV49"), { block: { normal: [779.27] }, product: 197780, group: 2594 });
  assert.deepEqual(fill.get("sma-SV1").block, { normal: [9.8] });
  assert.equal(fill.size, 10);
  assert.equal(fill.has("sma-SV94"), false); // nel catalogo senza prezzo
  assert.equal(fill.has("sma-SV18"), false);
  assert.equal(fill.has("bwp-BW01"), false); // due gruppi con lo stesso numero e lo stesso nome
  assert.equal(fill.has("sm9-1"), false);
  // Una carta che dichiara sia la normale sia la holo: il catalogo ha un prezzo solo, non si sa di quale.
  assert.equal(tcgplayerFill(cards.map((c) => ({ ...c, fl: "nhR" })), catalog).size, 0);
  // Meno di dieci carte trovate in un set senza nessun collegamento: non basta per dire qual è il suo gruppo.
  assert.equal(tcgplayerFill(cards.slice(0, 5), catalog).size, 0);
  // Nel file: la carta passa tra quelle coi prezzi TCGplayer ("ct"), col blocco come quelli di TCGdex.
  const { out, stats } = build(cards, { priceGuides: [] }, [], { tcgplayer: catalog });
  assert.equal(stats.filled, 10);
  assert.equal(out.c["sma-SV49"], undefined);
  assert.equal(out.t[parseInt(out.ct["sma-SV49"].split(";")[0].split("|t:")[1], 36)], "normal=779.27");
  assert.equal(out.c["sma-SV94"], ";normal:;:nR");
});

test("prodotti della sola carta (own di cardmarket.js): cambiano carta e varianti semplici, non le versioni speciali", () => {
  const cards = [{
    id: "pl3-70", set: "pl3", cm: 882910, variants: [882910, 278689, 882910, null],
    vd: ["normal:882910", "reverse:278761", "normal:882910|stamp:pre-release", "normal:|stamp:pre-release|stamp:staff"],
  }, { id: "pl3-31", set: "pl3", cm: 278689, vd: ["normal:278689"] }];
  // Con prezzi TCGplayer suoi la Staff resta senza prodotto (vale il suo prezzo TCGplayer, come prima).
  const staffTcg = applyOwnProducts([{ ...cards[0], vt: [null, null, null, { normal: [215.21, 230] }] }], { "pl3-70": { 882910: 278761 } })[0];
  assert.equal(staffTcg.vd[3], "normal:|stamp:pre-release|stamp:staff");
  const [milotic, other] = applyOwnProducts(cards, { "pl3-70": { 882910: 278761 } });
  assert.equal(milotic.cm, 278761);
  // La Staff, senza un prodotto suo, prendeva quello della carta: tiene quello della prerelease.
  assert.deepEqual(milotic.vd, ["normal:278761", "reverse:278761", "normal:882910|stamp:pre-release", "normal:882910|stamp:pre-release|stamp:staff"]);
  assert.equal(other, cards[1]);
  assert.equal(applyOwnProducts(cards, null), cards);
  // Nel file: riga della carta col prodotto giusto, e il prezzo di entrambi i prodotti nel listino.
  const guide = { priceGuides: [{ idProduct: 278761, trend: 1.21 }, { idProduct: 882910, trend: 97.25 }, { idProduct: 278689, trend: 59.09 }] };
  const { out } = buildCmPrices([{ ...cards[0], vd: cards[0].vd }], guide, [], { own: { "pl3-70": { 882910: 278761 } } });
  assert.ok(out.c["pl3-70"].startsWith("278761;normal:278761;"));
  assert.ok(out.c["pl3-70"].includes("normal:882910|stamp:pre-release"));
  assert.deepEqual(Object.keys(out.p).map(Number).sort(), [278761, 882910]);
});

test("nomi TCGplayer come quelli di TCGdex: parentesi, quadre e simboli", async () => {
  const { fillName } = await import("../src/cm-prezzi.js");
  const same = (tp, tcgdex, number = "") => assert.equal(fillName(tp, number).key, fillName(tcgdex, number).key, `${tp} = ${tcgdex}`);
  // Nomi veri del catalogo TCGplayer e di TCGdex (19 novembre 2026).
  same("Unown [H]", "Unown H");
  same("Unown (J)", "Unown J");
  same("Unown (!)", "Unown !");
  same("Nidoran F", "Nidoran♀");
  same("Nidoran M (Delta Species)", "Nidoran♂ δ");
  same("Mew Star (Delta Species)", "Mew ☆ δ");
  same("Delta Rainbow Energy", "δ Rainbow Energy");
  same("Unit Energy FDY (Secret)", "Unit Energy FightingDarknessFairy", "146/131");
  same("Fairy Charm L", "Fairy Charm Lightning");
  same("Lycanroc GX (SV66)", "Lycanroc-GX", "SV66/SV94");
  same("Professor's Research [Professor Magnolia] (Full Art)", "Professor's Research (Professor Magnolia)", "201/202");
  same("Deoxys EX (Team Plasma)", "Deoxys-EX", "53/116");
  same("Exeggutor", "ナッシー[Exeggutor]");
  same("Professor Elm's Lecture", "Professor Elm’s Lecture");
  // Le parentesi di un'altra stampa restano un'altra stampa; la finitura si legge.
  assert.equal(fillName("Metagross - BW75 (Team Plasma) (Prerelease)", "BW75").other, true);
  assert.equal(fillName("Trainers' Mail (Non-Holo)", "092a/108").finish, "n");
  assert.equal(fillName("Trainers' Mail (Holo)", "092a/108").finish, "h");
  // Fairy Charm Dragon: TCGplayer la chiama «Fairy Charm O», nessuna regola (resta senza).
  assert.notEqual(fillName("Fairy Charm O").key, fillName("Fairy Charm Dragon").key);
});

test("carte senza fonte: Unown di Diamante e Perla, alternate art «a», Nidoran, mazzi dei Mondiali, finitura di TCGdex", async () => {
  const { tcgplayerFill, worldsFill, sameFinish } = await import("../src/cm-prezzi.js");
  // Prodotti veri del catalogo TCGplayer (19 novembre 2026). Great Encounters (dp4) e Phantom Forces (xy4): TCGdex non
  // collega nessuna carta a TCGplayer, il gruppo del set si ricava dalle sue carte (qui 10 carte per set).
  const p = {
    90212: ["Unown [H]", 1405, "29/106", 14.87], 131696: ["M Manectric EX - 24a/119", 1938, "024a/119", 11.4],
    183832: ["Nidoran F", 2377, "54/181", 0.36], 480120: ["Unown [Q] - 2010 (Mychael Bryan)", 2282, "49/100", 18.23],
    480121: ["Unown [Q] - 2010 (Yuka Furusawa)", 2282, "49/100", 18.23],
    // La gigante con lo stesso numero dell'alternate art non conta.
    999001: ["M Manectric EX - 24a/119", 1997, "024a/119", null],
  };
  const g = { 1405: ["Great Encounters", 3], 1938: ["Alternate Art Promos", 3], 2377: ["SM - Team Up", 3], 2282: ["World Championship Decks", 3], 1997: ["Jumbo Cards", 3], 1401: ["XY - Phantom Forces", 3] };
  const cards = [];
  for (let i = 1; i <= 10; i++) {
    p[800 + i] = [`Filler${i}`, 1405, `${i}/106`, 1];
    p[900 + i] = [`Phantom${i}`, 1401, `${i}/119`, 1];
    cards.push({ id: `dp4-${i}`, set: "dp4", localId: String(i), name: `Filler${i}`, cm: 5000 + i, vd: [`normal:${5000 + i}`], fl: "nR" });
    cards.push({ id: `xy4-${i}`, set: "xy4", localId: String(i), name: `Phantom${i}`, cm: 6000 + i, vd: [`normal:${6000 + i}`], fl: "nR" });
  }
  cards.push(
    { id: "dp4-29", set: "dp4", localId: "29", name: "Unown H", cm: null, vd: ["normal:", "reverse:"], fl: "nrR" },
    { id: "xy4-24a", set: "xy4", localId: "24a", name: "M Manectric EX", cm: null, vd: ["normal:"], fl: "nRx" },
    { id: "sm9-54", set: "sm9", localId: "54", name: "Nidoran♀", cm: null, vd: ["normal:|tp:183832"], fl: "nR" },
    { id: "dp5-49", set: "dp5", localId: "49", name: "Unown Q", cm: 7000, vd: ["normal:7000", "normal:|stamp:mychael-bryan", "normal:|stamp:jason-klaczynski"], fl: "nrR" },
  );
  const catalog = { usdEur: 1.0968, g, p };
  const fill = tcgplayerFill(cards, catalog);
  assert.deepEqual(fill.get("dp4-29"), { block: { normal: [16.31] }, product: 90212, group: 1405 });
  assert.deepEqual(fill.get("xy4-24a"), { block: { normal: [12.5] }, product: 131696, group: 1938 });
  assert.deepEqual(fill.get("sm9-54"), { block: { normal: [0.39] }, product: 183832, group: 2377 });
  // Mazzi dei Mondiali: il prodotto del giocatore; senza (Jason Klaczynski non ha giocato Unown Q nel 2010) niente.
  const w = worldsFill(cards, catalog);
  assert.deepEqual([...w.get("dp5-49")], [[1, { normal: [19.99] }]]);
  // Pikachu Libre 30 del Trainer Kit XY: TCGdex la dice normale, TCGplayer ha solo la holo (72,05 $).
  const libre = { id: "tk-xy-p-30", fl: "nR", cm: null, vd: ["normal:"], tpp: { holofoil: [72.05, 67.38] } };
  assert.deepEqual(sameFinish(libre).tpp, { normal: [72.05, 67.38] });
  // Con un prodotto Cardmarket non serve, e con due finiture non si sa quale.
  assert.deepEqual(sameFinish({ ...libre, cm: 1 }).tpp, { holofoil: [72.05, 67.38] });
  assert.deepEqual(sameFinish({ ...libre, fl: "nhR" }).tpp, { holofoil: [72.05, 67.38] });
});
