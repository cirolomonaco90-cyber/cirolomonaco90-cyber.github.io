import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductName, cardName, findFixes, otherCard, pricesFor } from "../src/cardmarket.js";
import { compactCard } from "../src/tcgdex-scan.js";

// Dati reali (Cardmarket, TCGdex e CardTrader, ottobre 2026), ridotti.
const products = [
  { idProduct: 289820, name: "Mewtwo [Psy Bolt | Zen Blade]", idExpansion: 1612 },
  { idProduct: 289821, name: "Mewtwo [Psy Bolt | Zen Blade]", idExpansion: 1612 },
  { idProduct: 289557, name: "Mewtwo EX [Shatter Shot | Damage Change]", idExpansion: 1612 },
  { idProduct: 554275, name: "Mew [Clairvoyance | Psychic]", idExpansion: 4159 },
  { idProduct: 289815, name: "Pikachu [Let's Eat Together | Quick Attack]", idExpansion: 1612 },
  { idProduct: 289809, name: "Pikachu EX [Iron Tail | Overspark]", idExpansion: 1612 },
  { idProduct: 289704, name: "Kyogre EX [Tidal Storm | Hydro Pump]", idExpansion: 1612 },
  { idProduct: 289714, name: "Kyogre [Water Gun | Surf]", idExpansion: 1612 },
  { idProduct: 1, name: "Pawmot [Voltage Fist]", idExpansion: 7000 },
  { idProduct: 2, name: "Pawmi [Gnaw]", idExpansion: 7000 },
  { idProduct: 3, name: "Pawmo [Punch]", idExpansion: 7000 },
  { idProduct: 4, name: "Serperior [Regal Command | Solar Coiling]", idExpansion: 7000 },
  { idProduct: 5, name: "Serperior [Regal Command | Solar Coiling]", idExpansion: 7100 },
];
const xyp = (localId, name, cm, attacks) => ({ id: `xyp-${localId}`, set: "xyp", localId, name, attacks, abilities: [], cm, variants: [cm] });
const cards = [
  xyp("XY100", "Mewtwo", 289557, ["Psy Bolt", "Zen Blade"]),
  xyp("XY101", "Mewtwo", 554275, ["Psy Bolt", "Zen Blade"]),
  xyp("XY95", "Pikachu", 289809, ["Let's Eat Together", "Quick Attack"]),
  xyp("XY41", "Kyogre EX", 289704, ["Tidal Storm", "Hydro Pump"]),
  xyp("XY51", "Kyogre", 289704, ["Water Gun", "Surf"]),
  xyp("XY84", "Pikachu EX", 289809, ["Iron Tail", "Overspark"]),
  // Attacco scritto diversamente su TCGdex: niente prodotto migliore, resta com'è.
  { id: "me02-034", set: "me02", localId: "034", name: "Pawmot", attacks: ["Voltaic Fist"], abilities: [], cm: 1, variants: [1] },
  { id: "me02-001", set: "me02", localId: "001", name: "Pawmi", attacks: ["Gnaw"], abilities: [], cm: 2, variants: [2] },
  { id: "me02-002", set: "me02", localId: "002", name: "Pawmo", attacks: ["Punch"], abilities: [], cm: 3, variants: [3] },
  // Variante con timbro in un'altra espansione: va bene.
  { id: "me02-006", set: "me02", localId: "006", name: "Serperior", attacks: ["Regal Command", "Solar Coiling"], abilities: [], cm: 4, variants: [4, 5] },
];
// CardTrader: prodotto -> espansione e numero.
const ct = new Map([
  [289820, { exp: 1558, number: "XY100" }],
  [289821, { exp: 1558, number: "XY101" }],
  [289557, { exp: 1558, number: "XY107" }],
  [289815, { exp: 1558, number: "XY95" }],
  [289809, { exp: 1558, number: "XY84" }],
  [289704, { exp: 1558, number: "XY41" }],
  [289714, { exp: 1558, number: "XY51" }],
  [554275, { exp: 1898, number: "XY-P" }],
]);

test("nomi dei prodotti Cardmarket", () => {
  assert.deepEqual(parseProductName("Mewtwo [Psy Bolt | Zen Blade]"), { name: "mewtwo", moves: ["psybolt", "zenblade"] });
  assert.deepEqual(parseProductName("Unown [G] [Shuffle | Hidden Power]"), { name: "unown", moves: ["shuffle", "hiddenpower"] });
  assert.deepEqual(parseProductName("Kyogre & Groudon LEGEND [Top]"), { name: "kyogreandgroudonlegend", moves: [] });
  assert.deepEqual(parseProductName("Nidoran [M] [Horn Hazard]").name, "nidoran");
  assert.equal(cardName("Gliscor LV.42"), cardName("Gliscor"));
  assert.equal(cardName("Ampharos Delta Species"), cardName("Ampharos δ"));
  assert.equal(cardName("Basic Grass Energy"), cardName("Grass Energy"));
  assert.equal(otherCard("Mewtwo", "Mew [Clairvoyance | Psychic]"), true);
  assert.equal(otherCard("Charmander", "Bulbasaur [Tackle | Vine Whip]"), true);
  assert.equal(otherCard("Prof. Oak's Research", "Professor Oak's Research"), false);
});

test("Mewtwo XY101: dalla promo giapponese di Mew al prodotto giusto", () => {
  const { fix } = findFixes(cards, products, ct);
  assert.deepEqual(fix["xyp-XY101"], { 554275: 289821 });
  assert.deepEqual(fix["xyp-XY100"], { 289557: 289820 });
  assert.deepEqual(fix["xyp-XY95"], { 289809: 289815 });
  assert.deepEqual(fix["xyp-XY51"], { 289704: 289714 });
  // Le carte giuste non si toccano.
  assert.equal(fix["xyp-XY41"], undefined);
  assert.equal(fix["xyp-XY84"], undefined);
});

test("nel dubbio non si corregge", () => {
  const { fix } = findFixes(cards, products, ct);
  assert.equal(fix["me02-034"], undefined); // "Voltaic Fist" / "Voltage Fist"
  assert.equal(fix["me02-006"], undefined); // timbro in un'altra espansione
});

test("prodotto di una carta diversa senza alternativa: niente prezzo", () => {
  const list = [
    { id: "mfb-9", set: "mfb", localId: "9", name: "Charmander", attacks: ["Ember"], abilities: [], cm: 10, variants: [10] },
    { id: "mfb-1", set: "mfb", localId: "1", name: "Bulbasaur", attacks: ["Tackle", "Vine Whip"], abilities: [], cm: 10, variants: [10] },
    { id: "mfb-2", set: "mfb", localId: "2", name: "Squirtle", attacks: ["Bubble"], abilities: [], cm: 11, variants: [11] },
  ];
  const prods = [
    { idProduct: 10, name: "Bulbasaur [Tackle | Vine Whip]", idExpansion: 9 },
    { idProduct: 11, name: "Squirtle [Bubble]", idExpansion: 9 },
  ];
  const { fix } = findFixes(list, prods);
  assert.deepEqual(fix["mfb-9"], { 10: 0 });
  assert.equal(fix["mfb-1"], undefined);
});

test("prezzi del listino per i prodotti giusti", () => {
  const guide = { priceGuides: [
    { idProduct: 289821, idCategory: 51, avg: 21.16, low: 2.93, trend: 19.59, "avg-holo": null, "trend-holo": 10.39 },
    { idProduct: 554275, idCategory: 51, avg: 5799, trend: 5550 },
  ] };
  assert.deepEqual(pricesFor(guide, [289821]), { 289821: { avg: 21.16, low: 2.93, trend: 19.59, "trend-holo": 10.39 } });
});

test("carta compatta da TCGdex", () => {
  const c = compactCard({
    id: "xyp-XY101", localId: "XY101", name: "Mewtwo", set: { id: "xyp" },
    attacks: [{ name: "Psy Bolt" }, { name: "Zen Blade" }],
    pricing: { cardmarket: { idProduct: 554275, trend: 5550 } },
    thirdParty: { cardmarket: 554275 },
    variants_detailed: [{ type: "normal" }, { type: "holo", thirdParty: { cardmarket: 7 } }],
  });
  assert.equal(c.cm, 554275);
  assert.deepEqual(c.attacks, ["Psy Bolt", "Zen Blade"]);
  assert.deepEqual(c.variants, [null, 7]);
});

test("carte senza prodotto su TCGdex: trovate col numero CardTrader o con nome e attacchi", () => {
  // Dati reali: Pikachu 27 delle promo Wizards (TCGdex non la collega a niente) e Victini EX di Plasma Storm.
  const prods = [
    ...products,
    { idProduct: 275420, name: "Pikachu [Growl | Thundershock]", idExpansion: 1607 },
    { idProduct: 275421, name: "Pikachu [Gnaw | Thunder Jolt]", idExpansion: 1607 },
    { idProduct: 280758, name: "Victini EX [Turbo Energize | Intensifying Burn]", idExpansion: 7000 },
    { idProduct: 6, name: "Serperior [Regal Command | Solar Coiling]", idExpansion: 7000 },
  ];
  const list = [
    ...cards,
    { id: "basep-27", set: "basep", localId: "27", name: "Pikachu", attacks: ["Growl", "Thundershock"], abilities: [], cm: null, variants: [] },
    { id: "basep-1", set: "basep", localId: "1", name: "Pikachu", attacks: ["Gnaw", "Thunder Jolt"], abilities: [], cm: null, variants: [] },
    // Set con prodotti "di casa" (me02): per nome e attacchi, senza CardTrader.
    { id: "me02-050", set: "me02", localId: "050", name: "Victini-EX", attacks: ["Turbo Energize", "Intensifying Burn"], abilities: [], cm: null, variants: [] },
    // Due prodotti possibili nella stessa espansione: niente.
    { id: "me02-051", set: "me02", localId: "051", name: "Serperior", attacks: ["Regal Command", "Solar Coiling"], abilities: [], cm: null, variants: [] },
  ];
  const ctMap = new Map([...ct, [275420, { exp: 1474, number: "27" }], [275421, { exp: 1474, number: "1" }]]);
  const { fix, stats } = findFixes(list, prods, ctMap, {
    setNames: { basep: "Wizards Black Star Promos", me02: "Mega Evolution" },
    ctExpNames: new Map([[1474, "Wizards Black Star Promos"], [1558, "XY Promos"]]),
  });
  assert.deepEqual(fix["basep-27"], { 0: 275420 });
  assert.deepEqual(fix["basep-1"], { 0: 275421 });
  assert.deepEqual(fix["me02-050"], { 0: 280758 });
  assert.equal(fix["me02-051"], undefined);
  assert.equal(stats.missing, 4);
  assert.equal(stats.added, 3);
});
