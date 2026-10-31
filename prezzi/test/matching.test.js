import test from "node:test";
import assert from "node:assert/strict";
import { norm, normNumber, matchExpansion, findBlueprint, parseOffers, ctLanguage, items } from "../src/matching.js";

const exps = [
  { id: 1, name: "Aquapolis" },
  { id: 2, name: "Base Set" },
  { id: 3, name: "Paldea Evolved" },
  { id: 4, name: "Pokémon Rumble" },
  { id: 5, name: "Scarlet & Violet" },
  { id: 6, name: "Expedition" },
];

test("nomi dei set", () => {
  assert.equal(matchExpansion(exps, "Aquapolis").id, 1);
  assert.equal(matchExpansion(exps, "Base").id, 2);
  assert.equal(matchExpansion(exps, "Pokemon Rumble").id, 4);
  assert.equal(matchExpansion(exps, "Scarlet and Violet").id, 5);
  assert.equal(matchExpansion(exps, "Expedition Base Set").id, 6);
  assert.equal(matchExpansion(exps, "Un set che non esiste davvero da nessuna parte"), null);
  assert.equal(matchExpansion(exps, ""), null);
  assert.equal(norm("Pokémon Rumble"), "rumble");
});

test("numeri delle carte", () => {
  assert.equal(normNumber("007"), "7");
  assert.equal(normNumber("149/147"), "149");
  assert.equal(normNumber("H14"), "h14");
  assert.equal(normNumber("000"), "0");
  assert.equal(normNumber(null), "");
});

test("blueprint: prima l'id Cardmarket, poi numero, poi nome", () => {
  const bps = [
    { id: 10, name: "Lugia", card_market_ids: [111], fixed_properties: { collector_number: "149/147" } },
    { id: 11, name: "Lugia", card_market_ids: [222], fixed_properties: { collector_number: "H14/H32" } },
    { id: 12, name: "Kingdra", card_market_ids: [333], fixed_properties: { collector_number: "009" } },
  ];
  assert.equal(findBlueprint(bps, { cardmarketIds: [222] }).id, 11);
  assert.equal(findBlueprint(bps, { number: "149" }).id, 10);
  assert.equal(findBlueprint(bps, { number: "9" }).id, 12);
  assert.equal(findBlueprint(bps, { name: "Kingdra" }).id, 12);
  assert.equal(findBlueprint(bps, { name: "Lugia" }), null); // ambiguo
});

test("lettura delle offerte", () => {
  const json = {
    "10": [
      { price: { cents: 1250, currency: "EUR" }, quantity: 1, graded: false, description: "pack fresh", properties_hash: { condition: "Near Mint", pokemon_reverse: true, pokemon_language: "it" } },
      { price: { cents: 900, currency: "EUR" }, quantity: 2, on_vacation: true, properties_hash: {} },
      { price: { cents: 500, currency: "EUR" }, bundle_size: 3, properties_hash: { condition: "Played", first_edition: true } },
    ],
  };
  const offers = parseOffers(json);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0], {
    price: 12.5, currency: "EUR", condition: "Near Mint", reverse: true, firstEdition: null, graded: false, sealed: null, bundle: 1, quantity: 1,
    language: "it", description: "pack fresh",
  });
  assert.equal(offers[1].firstEdition, true);
  assert.equal(offers[1].bundle, 3);
});

test("lingue e formati di risposta", () => {
  assert.equal(ctLanguage("pt-br"), "pt");
  assert.equal(ctLanguage("it"), "it");
  assert.deepEqual(items([1, 2]), [1, 2]);
  assert.deepEqual(items({ array: [3] }), [3]);
  assert.deepEqual(items({ data: [4] }), [4]);
});
