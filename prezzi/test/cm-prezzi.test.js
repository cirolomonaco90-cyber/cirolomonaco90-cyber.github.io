import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCmPrices, cardLine, variantProduct, FIELDS } from "../src/cm-prezzi.js";
import { compactCard, compactVariant } from "../src/tcgdex-scan.js";

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
  assert.deepEqual(stats, { cards: 2, ja: 3, skipped: 0, products: 7, priced: 5 });
  // Prodotto con solo zeri nel listino: resta, vuoto (TCGdex dà il blocco dei prezzi, tutto a zero).
  const zero = buildCmPrices([compactCard({ id: "z", pricing: { cardmarket: { idProduct: 7, trend: 0 } } })], { priceGuides: [{ idProduct: 7, trend: 0, avg: null }] });
  assert.deepEqual(zero.out.p[7], []);
});
