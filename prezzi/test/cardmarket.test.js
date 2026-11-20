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

test("numeri con lo zero dopo le lettere: H08 di TCGdex = H8 di CardTrader", async () => {
  const { cardNumber } = await import("../src/cardmarket.js");
  assert.equal(cardNumber("H08"), "h8");
  assert.equal(cardNumber("H8"), "h8");
  assert.equal(cardNumber("H14"), "h14");
  assert.equal(cardNumber("TG02"), "tg2");
  assert.equal(cardNumber("007"), "7");
  assert.equal(cardNumber("10/147"), "10");
  assert.equal(cardNumber("SV49"), "sv49");
});

test("holo «H» di Aquapolis: scambiata con la gemella non holo, il numero di CardTrader le rimette a posto", () => {
  // Dati reali del 17 novembre 2026 (Cardmarket e TCGdex): per TCGdex Entei H8 ha il prodotto 275082 (tendenza 49,15 €,
  // quello dell'Entei non holo 10/147) e l'Entei 10/147 il 275065 (474,01 €, quello della holo). La 10/147 si correggeva
  // già; la H8 no, perché TCGdex scrive "H08" e CardTrader "H8": restava a 25 € con TCGplayer a 580 €.
  const prods = [
    { idProduct: 275065, name: "Entei [Pure Body | Burning Fang]", idExpansion: 1537 },
    { idProduct: 275082, name: "Entei [Pure Body | Burning Fang]", idExpansion: 1537 },
  ];
  const entei = (id, localId, cm) => ({ id, set: "ecard2", localId, name: "Entei", attacks: ["Burning Fang"], abilities: ["Pure Body"], cm, variants: [cm] });
  const list = [entei("ecard2-H08", "H08", 275082), entei("ecard2-10", "10", 275065)];
  const ctMap = new Map([[275065, { exp: 1480, number: "H8" }], [275082, { exp: 1480, number: "10" }]]);
  const { fix } = findFixes(list, prods, ctMap);
  assert.deepEqual(fix["ecard2-10"], { 275065: 275082 });
  assert.deepEqual(fix["ecard2-H08"], { 275082: 275065 });
});

test("variante col prodotto principale di un'altra carta del set: vale il prodotto della carta", () => {
  // Dati reali del 17 novembre 2026: per TCGdex la 1ª edizione dello Snorlax non holo di Jungle (27/64, prodotto 273824,
  // tendenza 14,57 €) ha il prodotto dello Snorlax holo (11/64, 273808, 43,76 €): stesso nome e stessi attacchi.
  const prods = [
    { idProduct: 273808, name: "Snorlax [Thick Skinned | Body Slam]", idExpansion: 1525 },
    { idProduct: 273824, name: "Snorlax [Thick Skinned | Body Slam]", idExpansion: 1525 },
    { idProduct: 278689, name: "Milotic Lv.52 [Aqua Mirage | Dwindling Wave]", idExpansion: 1564 },
    { idProduct: 882910, name: "Milotic Lv.49 [Cleansing Ring | Scale Blow]", idExpansion: 1564 },
  ];
  const snorlax = (id, localId, cm, variants) => ({ id, set: "base2", localId, name: "Snorlax", attacks: ["Body Slam"], abilities: ["Thick Skinned"], cm, variants });
  const milotic = (id, localId, cm, variants, attacks) => ({ id, set: "pl3", localId, name: "Milotic", attacks, abilities: [], cm, variants });
  const list = [
    snorlax("base2-11", "11", 273808, [273808, 273808]),
    snorlax("base2-27", "27", 273824, [273824, 273808]),
    // Supreme Victors: la reverse del Milotic 70/147 col prodotto del Milotic 31/147.
    milotic("pl3-31", "31", 278689, [278689], ["Aqua Mirage", "Dwindling Wave"]),
    milotic("pl3-70", "70", 882910, [882910, 278689], ["Cleansing Ring", "Scale Blow"]),
  ];
  const { fix, log } = findFixes(list, prods, new Map());
  assert.deepEqual(fix["base2-27"], { 273808: 273824 });
  assert.equal(fix["base2-11"], undefined);
  assert.deepEqual(fix["pl3-70"], { 278689: 882910 });
  assert.equal(fix["pl3-31"], undefined);
  assert.ok(log.some((l) => l.includes("prodotto principale di base2-11")));
});

test("prodotto usato da 3 o più carte del set: è della carta col suo nome, le altre prendono il loro", () => {
  // Dati reali del 19 novembre 2026 (TCGdex e catalogo Cardmarket): per TCGdex la 1ª edizione di «Erika's Bellsprout»,
  // «Erika's Exeggcute»... di Gym Heroes ha il prodotto della carta allenatore «Erika» (274152: 65,50 € con TCGplayer a
  // 2-4 €), e Gym Challenge quello di «Giovanni» (274286: «Giovanni's Meowth» 135,82 €, TCGplayer 7,86 €). TCGdex non dà a
  // queste carte un prodotto principale. «Erika» sta dentro «Erika's Bellsprout»: il controllo dei nomi non lo vedeva.
  const prods = [
    { idProduct: 274152, name: "Erika", idExpansion: 1529, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 274236, name: "Erika", idExpansion: 1529, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 274212, name: "Erika's Bellsprout [Careless Tackle]", idExpansion: 1529, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 274213, name: "Erika's Exeggcute [Eggsplosion | Psychic]", idExpansion: 1529, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 274214, name: "Erika's Oddish [Blot | Sporadic Sponging]", idExpansion: 1529, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 274286, name: "Giovanni", idExpansion: 1530, dateAdded: "0000-00-00 00:00:00" },
  ];
  const card = (id, set, localId, name, attacks, product, type = "normal") => ({
    id, set, localId, name, attacks, abilities: [], cm: null, variants: [null, product],
    vd: [`${type}:`, `${type}:${product}|stamp:1st-edition`],
  });
  const list = [
    card("gym1-16", "gym1", "16", "Erika", [], 274152, "holo"),
    card("gym1-100", "gym1", "100", "Erika", [], 274152),
    card("gym1-76", "gym1", "76", "Erika's Bellsprout", ["Careless Tackle"], 274152),
    card("gym1-77", "gym1", "77", "Erika's Exeggcute", ["Eggsplosion", "Psychic"], 274152),
    card("gym1-78", "gym1", "78", "Erika's Oddish", ["Blot", "Sporadic Sponging"], 274152),
    card("gym2-18", "gym2", "18", "Giovanni", [], 274286, "holo"),
    card("gym2-104", "gym2", "104", "Giovanni", [], 274286),
    card("gym2-74", "gym2", "74", "Giovanni's Meowth", ["Cat Fleas", "Cat Kick"], 274286),
  ];
  const { fix, log } = findFixes(list, prods, new Map());
  // Il prodotto giusto della carta, cercato per nome e attacchi nell'espansione del set.
  assert.deepEqual(fix["gym1-76"], { 274152: 274212 });
  assert.deepEqual(fix["gym1-77"], { 274152: 274213 });
  assert.deepEqual(fix["gym1-78"], { 274152: 274214 });
  // Nel catalogo ridotto «Giovanni's Meowth» non c'è: niente prodotto (vale TCGplayer) invece di quello di «Giovanni».
  assert.deepEqual(fix["gym2-74"], { 274286: 0 });
  // Le carte col nome del prodotto lo tengono.
  for (const id of ["gym1-16", "gym1-100", "gym2-18", "gym2-104"]) assert.equal(fix[id], undefined);
  assert.ok(log.some((l) => l.includes("gym1-76") && l.includes("usato da 5 carte del set")));
  // Con meno di 3 carte non si tocca (Gym Challenge senza Giovanni 104).
  const two = findFixes(list.filter((c) => c.id !== "gym2-104"), prods, new Map());
  assert.equal(two.fix["gym2-74"], undefined);
});

test("prodotto di una versione speciale aggiunto anni dopo: la carta torna al suo, la versione speciale tiene quello", () => {
  // Dati reali del 19 novembre 2026. Cardmarket ha aggiunto il 10 aprile 2026 prodotti con lo stesso nome di carte del 2009
  // e del 2010 per le loro versioni prerelease, e nel 2020 per le League; TCGdex li ha dati alla carta: Milotic 70/147 di
  // Supreme Victors 97,25 € (TCGplayer 4,38 €; il prodotto di sempre 1,21 €), Leafeon 17/90 di Undaunted 145,85 €
  // (TCGplayer 16,49 €, reverse 849 € col solo «low»), Garchomp C 60/147 98,84 € (TCGplayer 9,74 €).
  const prods = [
    { idProduct: 278761, name: "Milotic Lv.49 [Cleansing Ring | Scale Blow]", idExpansion: 1564, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 882910, name: "Milotic Lv.49 [Cleansing Ring | Scale Blow]", idExpansion: 1564, dateAdded: "2026-04-10 14:43:43" },
    { idProduct: 278689, name: "Milotic Lv.52 [Aqua Mirage | Dwindling Wave]", idExpansion: 1564, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 279270, name: "Leafeon [Miasma Wind | Soothing Scent]", idExpansion: 1568, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 882914, name: "Leafeon [Miasma Wind | Soothing Scent]", idExpansion: 1568, dateAdded: "2026-04-10 15:12:17" },
    { idProduct: 278751, name: "Garchomp [C] Lv.62 [Claw Swipe | Earthquake]", idExpansion: 1564, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 449563, name: "Garchomp [C] Lv.62 [Claw Swipe | Earthquake]", idExpansion: 1564, dateAdded: "2020-03-31 11:19:23" },
    { idProduct: 275896, name: "Salamence [Intimidating Fang | Dragon Flame]", idExpansion: 1541, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 280584, name: "Salamence [Intimidating Fang | Dragon Flame]", idExpansion: 1541, dateAdded: "0000-00-00 00:00:00" },
  ];
  const list = [
    { id: "pl3-31", set: "pl3", localId: "31", name: "Milotic", attacks: ["Aqua Mirage", "Dwindling Wave"], abilities: [], cm: 278689, variants: [278689], vd: ["normal:278689"] },
    {
      id: "pl3-70", set: "pl3", localId: "70", name: "Milotic", attacks: ["Cleansing Ring", "Scale Blow"], abilities: [], cm: 882910,
      variants: [882910, 278689, 882910, null], vd: ["normal:882910", "reverse:278689", "normal:882910|stamp:pre-release", "normal:|stamp:pre-release|stamp:staff"],
    },
    {
      id: "pl3-60", set: "pl3", localId: "60", name: "Garchomp C", attacks: ["Claw Swipe", "Earthquake"], abilities: [], cm: 449563,
      variants: [449563, 449563, 449563, null], vd: ["normal:449563", "reverse:449563", "normal:449563|foil:league", "normal:|stamp:staff|foil:league"],
    },
    {
      id: "hgss3-17", set: "hgss3", localId: "17", name: "Leafeon", attacks: ["Miasma Wind", "Soothing Scent"], abilities: [], cm: 882914,
      variants: [882914, 882914, 882914, null], vd: ["normal:882914", "reverse:882914", "normal:882914|stamp:pre-release", "normal:|stamp:pre-release|stamp:staff"],
    },
    {
      // Due prodotti di sempre con lo stesso nome: senza CardTrader non si sa quale sia, e non si tocca.
      id: "ex3-19", set: "ex3", localId: "19", name: "Salamence", attacks: ["Dragon Flame"], abilities: ["Intimidating Fang"], cm: 280584,
      variants: [280584, 280584, 280584, 280584], vd: ["normal:280584", "reverse:280584", "holo:280584|foil:cosmos", "holo:280584|stamp:winner|foil:cosmos"],
    },
  ];
  const { fix, own, log } = findFixes(list, prods, new Map());
  // Solo per la carta: il prodotto nuovo resta alla prerelease e alla League (cm-prezzi.js applica "own" alle righe).
  assert.deepEqual(own["pl3-70"], { 882910: 278761 });
  assert.deepEqual(own["pl3-60"], { 449563: 278751 });
  assert.deepEqual(own["hgss3-17"], { 882914: 279270 });
  assert.equal(own["ex3-19"], undefined);
  // La reverse di Milotic col prodotto del Milotic 31: prima andava sul prodotto della prerelease, ora su quello della carta.
  assert.deepEqual(fix["pl3-70"], { 278689: 278761 });
  for (const id of ["pl3-60", "hgss3-17", "ex3-19", "pl3-31"]) assert.equal(fix[id], undefined);
  assert.ok(log.some((l) => l.includes("pl3-70") && l.includes("2026-04-10")));
  // Se CardTrader collega il prodotto nuovo al numero della carta, è giusto così.
  const ct = new Map([[882910, { exp: 77, number: "070/147" }], [278689, { exp: 77, number: "031/147" }]]);
  assert.equal(findFixes(list, prods, ct).own["pl3-70"], undefined);
});

test("variante col prodotto di un'altra carta: mai sul prodotto che CardTrader dà a un'espansione fuori dal set", () => {
  const prods = [
    { idProduct: 10, name: "Pikachu [Thunder Shock]", idExpansion: 1, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 11, name: "Pikachu [Thunder Shock]", idExpansion: 1, dateAdded: "0000-00-00 00:00:00" },
    { idProduct: 12, name: "Raichu [Thunder]", idExpansion: 1, dateAdded: "0000-00-00 00:00:00" },
  ];
  const pika = (id, localId, cm, variants) => ({ id, set: "s", localId, name: "Pikachu", attacks: ["Thunder Shock"], abilities: [], cm, variants });
  // Altre 10 carte del set, che CardTrader mette nella sua espansione 5.
  const others = Array.from({ length: 10 }, (_, i) => {
    prods.push({ idProduct: 100 + i, name: `Card${i} [Move${i}]`, idExpansion: 1, dateAdded: "0000-00-00 00:00:00" });
    return { id: `s-${10 + i}`, set: "s", localId: String(10 + i), name: `Card${i}`, attacks: [`Move${i}`], abilities: [], cm: 100 + i, variants: [100 + i] };
  });
  const list = [pika("s-1", "1", 10, [10]), pika("s-2", "2", 11, [11, 10]), { id: "s-3", set: "s", localId: "3", name: "Raichu", attacks: ["Thunder"], abilities: [], cm: 12, variants: [12] }, ...others];
  // CardTrader: 10 e 12 nel set (espansione 5), 11 in un'espansione di promo (9): il prodotto 11 non è della carta s-2.
  const ct = new Map([[10, { exp: 5, number: "1" }], [12, { exp: 5, number: "3" }], [11, { exp: 9, number: "2" }], ...others.map((c) => [c.cm, { exp: 5, number: c.localId }])]);
  assert.deepEqual(findFixes(list, prods, ct).fix["s-2"], { 10: 0 });
  // Senza CardTrader resta come prima: la variante prende il prodotto della carta.
  assert.deepEqual(findFixes(list, prods, new Map()).fix["s-2"], { 10: 11 });
});
