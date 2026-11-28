import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsFromBlueprints, printedNumber, versionLabel, ASIA_SETS, setNames, ctCode, cleanExpansionName, withPrices, linkByName, cmCardName, dexMap, extraNumber, EXTRA_JA_SETS, englishNames, shortNumber } from "../src/asia.js";

test("numero stampato prima della barra", () => {
  assert.equal(printedNumber("042/048"), "042");
  assert.equal(printedNumber("01-15/15"), "01-15");
  assert.equal(printedNumber(undefined), "");
});

test("carte in ordine di numero, stesse stampe con una lettera", () => {
  const bp = (id, num, name, version) => ({ id, name, version, fixed_properties: { collector_number: num }, image: { show: { url: `/i/${id}.jpg` } } });
  const rows = cardsFromBlueprints([
    bp(3, "010/100", "Pikachu"),
    bp(1, "002/100", "Bulbasaur"),
    bp(4, "010/100", "Pikachu", "Master Ball"),
    { id: 9, name: "Booster Box", fixed_properties: {} },
  ]);
  assert.deepEqual(rows.map((r) => r[0]), ["002", "010", "010b"]);
  assert.equal(rows[2][4], "Master Ball");
  assert.equal(rows[0][2], "/i/1.jpg");
});

test("abbinamenti senza i finti CS degli altri paesi", () => {
  assert.equal(ASIA_SETS["S4a"], "s4a");
  assert.equal(ASIA_SETS["SM1+"], "sm1plus");
  assert.equal(ASIA_SETS["CS3aC"], "cs3a");
  assert.equal(ASIA_SETS["CS3a"], undefined);
  // promo: solo quelle giapponesi, con la lingua nell'id
  assert.equal(ASIA_SETS["SV-P@ja"], "promosv");
  assert.equal(ASIA_SETS["SV-P"], undefined);
  assert.equal(ASIA_SETS["S-P"], undefined);
});

test("versione senza il numero", () => {
  assert.equal(versionLabel("001/190"), null);
  assert.equal(versionLabel("Shiny Rare | 191/190"), "Shiny Rare");
  assert.equal(versionLabel("Master Ball"), "Master Ball");
  assert.equal(versionLabel(null), null);
});

test("nomi inglesi dei set asiatici per Collectr", () => {
  assert.equal(ctCode("SM1+", "ja"), "sm1plus");
  assert.equal(ctCode("CS3.5C", "zh-cn"), "cs35");
  assert.equal(cleanExpansionName("Black Bolt | sv11B"), "Black Bolt");
  assert.equal(cleanExpansionName("Forbidden Light JP"), "Forbidden Light");
  const expansions = [
    { code: "sv9", name: "Battle Partners" },
    { code: "sm1p", name: "Strength Expansion Pack Sun & Moon" },
    { code: "sm1plus", name: "Strength Expansion Pack Sun & Moon" },
    { code: "cs3a", name: "CS3a: Primordial Martial Arts - Overgrowth" },
    { code: "x1", name: "Doppio" },
    { code: "x2", name: "Doppio" },
  ];
  const { names, totals } = setNames({
    ja: [{ id: "SV9", cardCount: { official: 100 } }, { id: "SM1+" }, { id: "SM1p" }, { id: "CS3a" }, { id: "X1" }, { id: "X2" }],
    "zh-cn": [{ id: "CS3aC", cardCount: { official: 101 } }],
  }, expansions, {});
  assert.equal(names.ja["Battle Partners"], "SV9");
  assert.equal(names.ja["Strength Expansion Pack Sun & Moon"], "SM1+");
  assert.equal(names.ja["CS3a: Primordial Martial Arts - Overgrowth"], undefined); // CS solo in cinese
  assert.equal(names.ja["Doppio"], undefined); // ambiguo
  assert.equal(names["zh-cn"]["CS3a: Primordial Martial Arts - Overgrowth"], "CS3aC");
  assert.equal(totals["SV9@ja"], 100);
});

test("prezzi delle carte giapponesi: Cardmarket e offerte CardTrader", () => {
  const guide = new Map([[11, { trend: 0, avg30: 0 }], [12, { trend: 23.5, avg30: 20 }]]);
  const offer = (price) => ({ price, currency: "EUR", condition: "Near Mint", reverse: null, firstEdition: null, graded: false, bundle: 1, quantity: 1 });
  const offers = new Map([[7, [offer(10), offer(12), offer(11), offer(10000)]]]);
  const rows = withPrices([["001", "Pidgeot", null, 7, null, [11, 12]], ["002", "Fearow", null, 8, null, []]], guide, offers);
  assert.deepEqual(rows[0].slice(5), [12, 23.5, 20, 11, 3]);
  assert.deepEqual(rows[1].slice(5), [null, null, null, null, null]);
});

test("prodotti Cardmarket mancanti cercati per nome nella stessa espansione", () => {
  assert.equal(cmCardName("Karen's Umbreon [Paralyzing Glare | Gouge]"), "karen s umbreon");
  const singles = new Map([
    [1, { name: "Falkner's Pidgeot [Whirlwind]", idExpansion: 4168 }],
    [2, { name: "Karen's Umbreon [Paralyzing Glare | Gouge]", idExpansion: 4168 }],
    [3, { name: "Switch", idExpansion: 4168 }],
    [4, { name: "Switch", idExpansion: 4168 }],
    [5, { name: "Karen's Houndoom [Bite]", idExpansion: 999 }],
  ]);
  const rows = linkByName([
    ["001", "Falkner's Pidgeot", null, 10, null, [1]],
    ["091", "Karen's Umbreon", null, 11, null, []],
    ["134", "Switch", null, 12, null, []],
    ["092", "Karen's Houndoom", null, 13, null, []],
  ], singles);
  assert.deepEqual(rows[1][5], [2]); // unico con quel nome nell'espansione giapponese
  assert.deepEqual(rows[2][5], []); // due prodotti "Switch": non si indovina
  assert.deepEqual(rows[3][5], []); // solo in un'altra espansione
});

test("set giapponesi vecchi: numero del Pokédex -> carta, solo se unica", () => {
  const m = dexMap([
    { id: "PMCG4-006", dexId: [6] },
    { id: "PMCG4-020", dexId: [129] },
    { id: "PMCG4-021", dexId: [129] },
    { id: "PMCG4-064", dexId: undefined },
  ]);
  assert.deepEqual(m, { 6: "PMCG4-006" });
});

test("set giapponesi che TCGdex non ha: numeri delle carte", () => {
  assert.equal(extraNumber({ id: 1, fixed_properties: { collector_number: "209/S-P" } }), "209");
  assert.equal(extraNumber({ id: 2, fixed_properties: {}, version: "Glossy | No.016" }), "016");
  assert.equal(extraNumber({ id: 247253, fixed_properties: {} }), "bp247253");
  assert.equal(EXTRA_JA_SETS["ct-sp"].code, "s-p");
});

test("nomi inglesi delle carte asiatiche", () => {
  assert.equal(shortNumber("042"), "42");
  const m = englishNames([["104", "Iono's Kilowattrel"], ["104b", "Iono's Kilowattrel"], ["001", "Pikachu"], ["SV-P", "x"]]);
  assert.deepEqual(m, { 104: "Iono's Kilowattrel", 1: "Pikachu", "sv-p": "x" });
});
