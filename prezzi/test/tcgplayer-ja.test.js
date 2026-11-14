import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSet, splitNumber, setPrices, ecbUsd, normName, dexPrices } from "../src/tcgplayer-ja.js";

test("set TCGplayer -> set giapponese di TCGdex", () => {
  const ids = ["SV9", "SM1+", "XY11a", "VS1", "SV-P"];
  const names = new Map([[normName("Fever-Burst Fighter"), "XY11a"], [normName("Pokémon VS"), "VS1"]]);
  assert.equal(groupSet({ abbreviation: "SV9", name: "SV9: Battle Partners" }, ids, names), "SV9");
  assert.equal(groupSet({ abbreviation: "sm1+", name: "sm1+: Enhanced Expansion Pack Sun & Moon" }, ids, names), "SM1+");
  assert.equal(groupSet({ abbreviation: "XY11-Bb", name: "XY11-Bb: Fever-Burst Fighter" }, ids, names), "XY11a");
  assert.equal(groupSet({ abbreviation: "", name: "Pokemon VS" }, ids, names), "VS1");
  assert.equal(groupSet({ abbreviation: "SV-P", name: "SV-P Promotional Cards" }, ids, names), "SV-P");
  assert.equal(groupSet({ abbreviation: "", name: "Japanese CD Promo" }, ids, names), null);
});

test("numeri", () => {
  assert.deepEqual(splitNumber("007/141"), ["7", "141"]);
  assert.deepEqual(splitNumber("001/SV-P"), ["1", "SV-P"]);
  assert.deepEqual(splitNumber("130"), ["130", null]);
  assert.equal(splitNumber(""), null);
  assert.equal(splitNumber("SWSH001"), null);
});

test("prezzi di un set in euro, con il controllo del totale", () => {
  const prod = (id, number) => ({ productId: id, extendedData: [{ name: "Number", value: number }] });
  const products = [prod(1, "025/141"), prod(2, "130/141"), prod(3, "005/999"), prod(4, "007/141"), prod(5, "007/141"), prod(6, "009/141")];
  const prices = [
    { productId: 1, subTypeName: "Holofoil", marketPrice: 110 },
    { productId: 2, subTypeName: "Normal", marketPrice: 2.99 },
    { productId: 2, subTypeName: "Reverse Holofoil", marketPrice: 5.5 },
    { productId: 3, subTypeName: "Normal", marketPrice: 9 },
    { productId: 4, subTypeName: "Normal", marketPrice: 1 },
    { productId: 5, subTypeName: "Normal", marketPrice: 2 },
    { productId: 6, subTypeName: "Holofoil", marketPrice: null, lowPrice: 600 },
  ];
  const ids = {};
  const p = setPrices(products, prices, 1.1, 141, ids);
  assert.deepEqual(ids, { 25: 1, 130: 2, 9: 6 }); // prodotti delle carte (foto TCGplayer), anche senza prezzo; non i numeri doppi
  assert.deepEqual(p["25"], [100, null]);
  assert.deepEqual(p["130"], [2.72, 5]);
  assert.equal(p["5"], undefined); // totale diverso: altro set
  assert.equal(p["7"], undefined); // due prodotti con lo stesso numero
  assert.equal(p["9"], undefined); // solo offerte, nessuna vendita
});

test("cambio della BCE", () => {
  assert.equal(ecbUsd("<Cube currency='JPY' rate='160.1'/><Cube currency='USD' rate='1.0812'/>"), 1.0812);
  assert.equal(ecbUsd("<Cube/>"), null);
});

test("set vecchi: carta dal Pokémon, solo se il prodotto è unico", () => {
  const species = [];
  species[5] = "charizard"; species[121] = "mr-mime"; species[111] = "rhydon"; species[36] = "vulpix";
  const products = [
    { productId: 1, name: "Dark Charizard" },
    { productId: 2, name: "Mr. Mime" },
    { productId: 3, name: "Brock's Rhydon" },
    { productId: 4, name: "Brock's Vulpix (Lv.10)" },
    { productId: 5, name: "Brock's Vulpix (Lv.16)" },
  ];
  const prices = [1, 2, 3, 4, 5].map((id) => ({ productId: id, subTypeName: id === 1 ? "Holofoil" : "Normal", marketPrice: id * 11 }));
  const dex = { 6: "PMCG4-017", 122: "PMCG4-040", 112: "PMCG5-055", 37: "PMCG5-010" };
  const p = dexPrices(products, prices, dex, species, 1.1);
  assert.deepEqual(p["17"], [10, null]);
  assert.deepEqual(p["40"], [20, null]);
  assert.deepEqual(p["55"], [30, null]);
  assert.equal(p["10"], undefined); // due Vulpix: non si indovina
});

test("catalogo TCGplayer completo: righe e prezzo in euro", async () => {
  const { groupRows, marketEur } = await import("../src/tcgplayer-all.js");
  assert.equal(marketEur([{ subTypeName: "Reverse Holofoil", marketPrice: 5 }, { subTypeName: "Holofoil", marketPrice: 11 }], 1.1), 10);
  assert.equal(marketEur([{ subTypeName: "Normal", marketPrice: null }], 1.1), null);
  assert.equal(marketEur([{ subTypeName: "Normal", marketPrice: null, midPrice: 22, lowPrice: 20, highPrice: 25 }], 1.1), 20); // senza vendite: offerte
  assert.equal(marketEur([{ subTypeName: "Normal", marketPrice: null, midPrice: 850, lowPrice: 850, highPrice: 850 }], 1.1), null); // una sola offerta
  const rows = groupRows(1528, [{ productId: 210853, name: "Ho-oh - 11/12 (Box Topper)", extendedData: [{ name: "Number", value: "011/012" }] }],
    [{ productId: 210853, subTypeName: "Holofoil", marketPrice: 22 }], 1.1);
  assert.deepEqual(rows[210853], ["Ho-oh - 11/12 (Box Topper)", 1528, "011/012", 20]);
});
