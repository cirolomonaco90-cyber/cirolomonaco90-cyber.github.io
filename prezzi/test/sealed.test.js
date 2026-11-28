import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSealed, isAsian, asianLang, sealedEstimate, sealedKey, tcgplayerImages } from "../src/sealed.js";

// Dati reali (Cardmarket e CardTrader, ottobre 2026), ridotti.
const products = [
  { idProduct: 719695, name: "151 Booster Bundle", idCategory: 53, categoryName: "Pokémon Display", idExpansion: 5402, dateAdded: "2023-06-21 16:23:49" },
  { idProduct: 719694, name: "151 Booster", idCategory: 52, categoryName: "Pokémon Booster", idExpansion: 5402, dateAdded: "2023-06-21 16:23:05" },
  { idProduct: 719702, name: "151: Dragonite Mini Tin", idCategory: 1014, categoryName: "Pokémon Tins", idExpansion: 5402, dateAdded: "2023-06-21 16:32:57" },
  { idProduct: 1, name: "Forbidden Light JP Booster Box", categoryName: "Pokémon Display", idExpansion: 2000, dateAdded: "2018-05-01" },
  { idProduct: 2, name: "CSV10.5C: Black Bolt S-Ch Booster", categoryName: "Pokémon Booster", idExpansion: 2001, dateAdded: "2025-07-01" },
  { idProduct: 3, name: "MEGA Starter Set: Eevee Coin", categoryName: "Pokémon Coins", idExpansion: 5402, dateAdded: "2025-01-01" },
];
const singles = [{ idProduct: 500, name: "Mew ex", idExpansion: 5402 }];
const guide = { priceGuides: [
  { idProduct: 719695, idCategory: 53, avg: 150.44, low: 84.9, trend: 143.14, avg30: null },
  { idProduct: 719694, idCategory: 52, avg: 25.57, low: 16, trend: 23.35 },
] };
const cmToCtExp = new Map([[719695, 3141], [500, 3141]]);
const ctExpNames = new Map([[3141, "151"]]);
const ctProducts = new Map([[719694, { bp: 258625, img: "/uploads/blueprints/image/258625/show_151-booster-151.jpg" }]]);

test("prodotti asiatici riconosciuti", () => {
  assert.equal(isAsian("Forbidden Light JP Booster Box"), true);
  assert.equal(isAsian("CSV10.5C: Black Bolt S-Ch Booster"), true);
  assert.equal(isAsian("Chinese Happy Set Charizard 8-Pack Blister"), true);
  assert.equal(isAsian("151 Booster Bundle"), false);
  assert.equal(isAsian("Japanese-style"), true); // nel dubbio fuori
  assert.equal(isAsian("Jumbo Booster"), false);
  assert.equal(asianLang("Forbidden Light JP Booster Box"), "ja");
  assert.equal(asianLang("Clay Burst Booster Box", "Clay Burst"), "ja");
  assert.equal(asianLang("CSV10.5C: Black Bolt S-Ch Booster"), "zh-cn");
  assert.equal(asianLang("Blade Awakening Booster Box", "CSV7: Blade Awakening"), "zh-cn");
  assert.equal(asianLang("151C: Collect 151 Gathering Booster Box"), "zh-cn");
  assert.equal(asianLang("Traditional Chinese 5th Anniversary Premium Card Set Box"), "zh-tw");
  assert.equal(asianLang("Black & White ID/TH Booster"), "id");
});

test("le confezioni aperte non contano nel prezzo", () => {
  const o = (price, sealed) => ({ price, currency: "EUR", graded: false, bundle: 1, quantity: 1, sealed, condition: null });
  // Con offerte sigillate, quelle segnate "non sigillata" sono confezioni aperte: fuori dal prezzo.
  assert.deepEqual(sealedEstimate([o(27.4, true), o(30.39, true), o(42.64, true), o(10, false)]), [30.39, 3]);
  // Nessun venditore spunta "sigillato" (Booster Bundle, valigetta The Glory of Team Rocket: 11 offerte
  // giapponesi da 335 a 450 €, tutte "non sigillate"): la casella è solo vuota, le offerte contano tutte.
  assert.deepEqual(sealedEstimate([o(185.63, false), o(298.75, false)]), [242.19, 2]);
  assert.deepEqual(sealedEstimate([o(335.64, false), o(340.64, false), o(375.62, false), o(406.3, false), o(411.28, false), o(418.27, false)]), [375.62, 6]);
  assert.deepEqual(sealedEstimate([o(5000.5, true), o(130, true)]), [130, 1]); // prezzo segnaposto
  // Buste: CardTrader non chiede se sono sigillate.
  assert.deepEqual(sealedEstimate([o(19.27, null)]), [19.27, 1]);
});

test("catalogo dei sigillati", () => {
  const { data } = buildSealed({
    products, singles, guide, cmToCtExp, ctExpNames, ctProducts,
    // Inglese: due offerte a 5.076 € per un prodotto da 143 € su Cardmarket -> scartate.
    ctPrices: { it: new Map([[719694, [20.27, 13]]]), en: new Map([[719695, [5076.58, 2]]]) },
    now: new Date("2026-10-28T00:00:00Z"),
  });
  assert.deepEqual(data.exp, { 5402: "151" });
  // Niente monete; i prodotti asiatici restano, con la loro lingua.
  assert.deepEqual(data.p.map((p) => p.id), [719695, 719694, 719702, 1, 2]);
  assert.equal(data.p.find((p) => p.id === 1).l, "ja");
  assert.equal(data.p.find((p) => p.id === 2).l, "zh-cn");
  assert.equal(data.p.find((p) => p.id === 719694).l, undefined);
  const booster = data.p.find((p) => p.id === 719694);
  assert.deepEqual(booster, {
    id: 719694, n: "151 Booster", t: "booster", e: 5402, d: "2023-06-21",
    img: "/uploads/blueprints/image/258625/show_151-booster-151.jpg", bp: 258625,
    cm: { trend: 23.35, low: 16 }, ct: { it: [20.27, 13] },
  });
  assert.deepEqual(data.p.find((p) => p.id === 719695).ct, {});
  const tin = data.p.find((p) => p.id === 719702);
  assert.equal(tin.cm, null);
  assert.equal(tin.img, null);
  assert.equal(data.p[0].t, "display");
});

test("set giapponesi con nome inglese riconosciuti dalla lingua di CardTrader", () => {
  const prods = [
    { idProduct: 10, name: "Clay Burst Booster Box", categoryName: "Pokémon Display", idExpansion: 6000 },
    { idProduct: 11, name: "Paldea Evolved Booster Box", categoryName: "Pokémon Display", idExpansion: 6001 },
    { idProduct: 12, name: "Black Kyurem ex Box", categoryName: "Pokémon Box Set", idExpansion: 6002 },
    { idProduct: 13, name: "Islands Await You Booster", categoryName: "Pokémon Booster", idExpansion: 6003 },
    { idProduct: 14, name: "WCD 2016: Ninja Blitz", categoryName: "Pokémon Theme Decks", idExpansion: 6004 },
    { idProduct: 15, name: "Eevee Heroes VMAX Special Set", categoryName: "Pokémon Box Set", idExpansion: 6005 },
    { idProduct: 16, name: "Korean Terastal Festival ex Binder Set", categoryName: "Pokémon Box Set", idExpansion: 6006 },
  ];
  const { data } = buildSealed({
    products: prods,
    guide: { priceGuides: [] },
    // Lingue CardTrader reali (ottobre 2026): Clay Burst, Islands Await You, Eevee Heroes VMAX Special Set
    // e Terastal Festival ex solo giapponesi; World Championship Decks 2016 in inglese. Islands Await
    // You Booster non è collegato a nessun blueprint.
    cmToCtExp: new Map([[10, 100], [11, 101], [12, 102], [902, 103], [14, 104], [15, 105], [16, 106]]),
    ctExpNames: new Map([[100, "Clay Burst"], [101, "Paldea Evolved"], [102, "Scarlet & Violet Products"], [103, "Islands Await You"],
      [104, "World Championship Decks 2016"], [105, "Eevee Heroes VMAX Special Set"], [106, "Terastal Festival ex"]]),
    ctProducts: new Map([[10, { bp: 1, lang: "jp" }], [11, { bp: 2, lang: "en" }], [12, { bp: 3, lang: "en" }], [14, { bp: 4, lang: "en" }],
      [15, { bp: 5, lang: "jp" }], [16, { bp: 6, lang: "jp" }]]),
    ctExpLangs: new Map([[100, "jp"], [101, "en"], [102, "en"], [103, "jp"], [104, "en"], [105, "jp"], [106, "jp"]]),
  });
  assert.deepEqual(data.p.map((p) => [p.n, p.l]), [
    ["Clay Burst Booster Box", "ja"],
    ["Paldea Evolved Booster Box", undefined],
    ["Black Kyurem ex Box", undefined],
    ["Islands Await You Booster", "ja"],
    ["WCD 2016: Ninja Blitz", undefined],
    ["Eevee Heroes VMAX Special Set", "ja"],
    ["Korean Terastal Festival ex Binder Set", "ko"], // il nome vince sulla lingua di CardTrader
  ]);
});

test("prodotti cinesi 151C e resto di un'espansione asiatica", () => {
  // Nomi reali di Cardmarket (espansione 6099 "Collect 151", ottobre 2026): CardTrader non dà la lingua.
  const names = ["151C: Collect 151 Journey Booster Box", "151C: Collect 151 Journey Jumbo Booster Box",
    "151C: Collect 151 Hope Booster Box", "151C: Collect 151 Surprises Booster Box",
    "Collect 151: First Partner Premium Gift Box Bulbasaur"];
  const { data } = buildSealed({
    products: [
      ...names.map((name, i) => ({ idProduct: 20 + i, name, categoryName: "Pokémon Display", idExpansion: 6099 })),
      // Espansione inglese con un solo prodotto asiatico: gli altri restano senza lingua.
      { idProduct: 30, name: "CSV1C: Eternal Birth Booster Box", categoryName: "Pokémon Display", idExpansion: 5402 },
      { idProduct: 31, name: "151 Booster Bundle", categoryName: "Pokémon Display", idExpansion: 5402 },
    ],
    guide: { priceGuides: [] },
    cmToCtExp: new Map(), ctExpNames: new Map(), ctProducts: new Map(), ctExpLangs: new Map(),
  });
  assert.deepEqual(data.p.map((p) => p.l), ["zh-cn", "zh-cn", "zh-cn", "zh-cn", "zh-cn", "zh-cn", undefined]);
});

test("Sealed One Piece: categorie di Cardmarket One Piece, lotti esclusi", async () => {
  const { ONE_PIECE_SEALED_TYPES } = await import("../src/sealed.js");
  const { data } = buildSealed({
    products: [
      { idProduct: 691245, name: "Romance Dawn Booster Box", categoryName: "One Piece Booster Boxes", idExpansion: 5229, dateAdded: "2022-12-02" },
      { idProduct: 691243, name: "Romance Dawn Booster", categoryName: "One Piece Booster", idExpansion: 5229, dateAdded: "2022-12-02" },
      { idProduct: 695312, name: "Film Red Uta Promo Pack", categoryName: "One Piece Promo Products", idExpansion: 5300, dateAdded: "2022-08-06" },
      { idProduct: 1, name: "Full Set - Romance Dawn (OP01)", categoryName: "One Piece Lots", idExpansion: 5229, dateAdded: "2022-12-02" },
      // Nomi reali: la lingua scritta nel nome vince su quella di CardTrader.
      { idProduct: 2, name: "Romance Dawn Booster Box Case (12x Booster Box) (Non-English)", categoryName: "One Piece Booster Boxes", idExpansion: 5229, dateAdded: "2022-07-08" },
      { idProduct: 3, name: "2nd Japanese Anniversary Set (English Version)", categoryName: "One Piece Promo Products", idExpansion: 5300, dateAdded: "2024-07-01" },
    ],
    guide: { priceGuides: [{ idProduct: 691245, trend: 310.5 }] },
    cmToCtExp: new Map([[691245, 3332], [695312, 3324], [2, 3332], [3, 3324]]),
    ctExpNames: new Map([[3332, "OP-01: Romance Dawn"], [3324, "Promo"]]),
    ctProducts: new Map([[691245, { bp: 244177, img: null, lang: "en" }], [695312, { bp: 250000, img: null, lang: "jp" }]]),
    ctExpLangs: new Map([[3332, "en"], [3324, "jp"]]),
    ctPrices: { ja: new Map([[691245, [400, 1]]]) },
    types: ONE_PIECE_SEALED_TYPES,
    westernLang: "en",
  });
  // Su Cardmarket ogni prodotto One Piece ha una lingua: senza "(Non-English)" è inglese.
  assert.deepEqual(data.p.map((p) => [p.n, p.t, p.l]), [
    ["Romance Dawn Booster Box", "display", "en"],
    ["Romance Dawn Booster", "booster", "en"],
    ["Film Red Uta Promo Pack", "box", "ja"],
    ["Romance Dawn Booster Box Case (12x Booster Box) (Non-English)", "display", "ja"],
    ["2nd Japanese Anniversary Set (English Version)", "box", "en"],
  ]);
  assert.deepEqual(data.p[0].ct, { ja: [400, 1] });
});

test("tipo dei prodotti solo su CardTrader", async () => {
  const { guessType } = await import("../src/sealed.js");
  assert.equal(guessType("The Glory of Team Rocket Attaché Case"), "box");
  assert.equal(guessType("ETB Mew Construction of Advanced Fusion"), "etb");
  assert.equal(guessType("Heat Wave Arena Booster Box"), "display");
  assert.equal(guessType("Lugia V Tin"), "tin");
});

test("doppioni dei sigillati e foto TCGplayer", () => {
  // Nomi reali (ottobre 2026): due "Alolan Raichu Box" su Cardmarket, "Empty Level Ball Tin" anche solo su
  // CardTrader, "Battle Partners Booster Box" senza foto CardTrader ma su TCGplayer ("SV9: Battle Partners").
  assert.equal(sealedKey("SV9: Battle Partners Booster Box"), "battle partners booster box");
  assert.equal(sealedKey("V Battle Deck: Venusaur V"), sealedKey("V Battle Deck [Venusaur V]"));
  assert.equal(sealedKey("Ultra Prism Booster Box (18 Boosters)"), "ultra prism booster box");
  const { data, log } = buildSealed({
    products: [
      { idProduct: 300361, name: "Alolan Raichu Box", categoryName: "Pokémon Box Set", idExpansion: 1645 },
      { idProduct: 311973, name: "Alolan Raichu Box", categoryName: "Pokémon Box Set", idExpansion: 1645 },
      { idProduct: 565214, name: "Empty Level Ball Tin", categoryName: "Pokémon Tins", idExpansion: 1645 },
      { idProduct: 804827, name: "Battle Partners Booster Box", categoryName: "Pokémon Display", idExpansion: 6000 },
      { idProduct: 613900, name: "Sword & Shield Ultra-Premium Collection - Charizard", categoryName: "Pokémon Box Set", idExpansion: 6001 },
    ],
    guide: { priceGuides: [{ idProduct: 300361, trend: 131.24 }, { idProduct: 565214, trend: 1.95 }] },
    cmToCtExp: new Map([[804827, 100]]), ctExpNames: new Map([[100, "Battle Partners"], [200, "Sword & Shield Merchandise"], [300, "Sword & Shield: Ultra-Premium Collection | Charizard"]]),
    ctExpLangs: new Map([[100, "jp"]]),
    ctProducts: new Map([
      [804827, { bp: 1, img: null, lang: "jp", name: "Battle Partners Booster Box", ctExp: 100 }],
      [580945, { bp: 2, img: "/x.jpg", lang: "en", name: "Empty Level Ball Tin", ctExp: 200 }],
      [818103, { bp: 3, img: "/y.jpg", lang: "en", name: "The Glory of Team Rocket Attaché Case", ctExp: 200 }],
      // Senza lingua predefinita: quella dell'espansione CardTrader (100 = giapponese).
      [818096, { bp: 5, img: null, lang: null, name: "Team Rocket Damage Counter Case", ctExp: 100 }],
      // Parte del nome nell'espansione CardTrader: doppione del prodotto Cardmarket 613900.
      [700000, { bp: 4, img: "/z.jpg", lang: "en", name: "Ultra-Premium Collection | Charizard", ctExp: 300 }],
    ]),
    // SV9 Battle Partners è un set giapponese (categoria 85 di TCGplayer): lingua "ja", come il prodotto Cardmarket.
    tpProducts: [{ id: 614707, name: "Booster Box", group: "SV9: Battle Partners", eur: 120.5, lang: "ja" }, { id: 1, name: "Alolan Raichu Box", group: "Promos", eur: 99 }],
  });
  assert.deepEqual(data.p.map((p) => [p.id, p.img]), [
    [300361, "tp:1"], // il doppione 311973, senza prezzo né foto, è sparito
    [565214, null], // il "solo CardTrader" 580945 con lo stesso nome non si aggiunge
    [804827, "tp:614707"],
    [613900, null],
    [818103, "/y.jpg"], // 700000 non c'è: doppione
    [818096, null],
  ]);
  assert.equal(data.p.find((p) => p.id === 818096).l, "ja");
  assert.equal(data.p.find((p) => p.id === 818103).l, undefined);
  // Prezzo TCGplayer solo a chi non ha né Cardmarket né CardTrader.
  assert.deepEqual(data.p.find((p) => p.id === 804827).cm, { tcgplayer: 120.5 });
  assert.deepEqual(data.p.find((p) => p.id === 300361).cm, { trend: 131.24 });
  assert.ok(log.some((l) => l.includes("2 doppioni")));
  assert.deepEqual([...tcgplayerImages([{ id: 5, name: "Elite Trainer Box", group: "ME01: Mega Evolution" }]).keys()], ["en|elite trainer box", "en|mega evolution elite trainer box"]);
});

test("prodotto TCGplayer senza foto: nessuna foto tp:, ma andamento e prezzo sì", () => {
  // Dragon Ball reale (7 novembre 2026): "Unison Warrior Series Tournament Pack Vol. 6" ha imageCount 0 su TCGplayer, e il
  // "tp:283577" lasciava il prodotto senza foto nell'app e chiudeva la strada alle foto a mano e a eBay.
  const { data, log } = buildSealed({
    products: [{ idProduct: 696769, name: "Unison Warrior Series Tournament Pack Vol.6", categoryName: "Pokémon Booster", idExpansion: 1 }],
    guide: { priceGuides: [] },
    cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(),
    tpProducts: [{ id: 283577, name: "Unison Warrior Series Tournament Pack Vol. 6", group: "Dragon Ball Super Promotion Cards", groupId: 1963, eur: 4.5, noImg: true }],
  });
  const p = data.p.find((x) => x.id === 696769);
  assert.equal(p.img ?? null, null);
  assert.deepEqual(p.tp, [283577, 1963]);
  assert.deepEqual(p.cm, { tcgplayer: 4.5 });
  assert.ok(log.some((l) => l.includes("senza foto, lasciati alle altre fonti: 1")));
});

test("rapporto lingua/inglese dei sigillati, con riserva dalle carte", async () => {
  const { sealedCoefficients } = await import("../src/sealed.js");
  // 25 prodotti con offerte in italiano e inglese (italiano al 70%), 2 in francese, nessuno in portoghese.
  const out = [];
  for (let i = 0; i < 25; i++) out.push({ id: i, e: 1, ct: { it: [70, 2], en: [100, 3] } });
  out.push({ id: 100, e: 1, ct: { fr: [150, 1], en: [100, 3] } }, { id: 101, e: 1, ct: { fr: [160, 1], en: [100, 3] } });
  out.push({ id: 200, e: 1, l: "ja", ct: { ja: [50, 4], en: [100, 3] } }); // asiatico: non conta
  const coef = sealedCoefficients(out, { it: 0.72, fr: 1.58, pt: 2.2 });
  assert.deepEqual(coef.it, [0.7, 25]); // dai sigillati (almeno 20 prodotti)
  // Francese e portoghese (e tedesco, spagnolo): sempre il rapporto dell'italiano, segnato, come per le carte.
  assert.deepEqual(coef.fr, [0.7, 25, "it"]);
  assert.deepEqual(coef.pt, [0.7, 25, "it"]);
  assert.deepEqual(coef.de, [0.7, 25, "it"]);
  // Senza rapporto dell'italiano restano i loro (qui dalle carte).
  const noIt = sealedCoefficients(out.slice(25), { fr: 1.58 });
  assert.deepEqual(noIt.fr, [1.58, 0]);
  assert.equal(coef.en, undefined);
  assert.equal(coef.ja, undefined);
  // Senza riserva dalle carte e senza sigillati: nessun rapporto.
  assert.deepEqual(sealedCoefficients(out.slice(25)), {});
});

test("foto TCGplayer per somiglianza del nome, solo dello stesso tipo e senza dubbi", async () => {
  const { fuzzyIndex, fuzzyMatch, productKind } = await import("../src/sealed.js");
  const tp = [
    { id: 1, name: "Prismatic Evolutions Elite Trainer Box", group: "SV: Prismatic Evolutions" },
    { id: 2, name: "Prismatic Evolutions Booster Bundle", group: "SV: Prismatic Evolutions" },
    { id: 3, name: "Prismatic Evolutions Booster Pack", group: "SV: Prismatic Evolutions" },
    { id: 4, name: "Romance Dawn Booster Box", group: "Romance Dawn" },
    { id: 5, name: "Paramount War Booster Box", group: "Paramount War" },
  ];
  const idx = fuzzyIndex(tp);
  assert.equal(productKind("Prismatic Evolutions Elite Trainer Box"), "etb");
  assert.equal(productKind("Memorial Collection (12x Booster Box) (Non-English)"), "box");
  assert.equal(productKind("Memorial Collection - Booster Pack"), "booster");
  assert.equal(productKind("Collection Moon Booster"), "booster");
  // Stesso prodotto scritto in un altro modo: trovato.
  // Il nome Cardmarket senza il set ("Elite Trainer Box" nell'espansione Prismatic Evolutions): conta il set.
  assert.equal(fuzzyMatch("Prismatic Evolutions Elite Trainer Box", "Elite Trainer Box", idx)?.id, 1);
  assert.equal(fuzzyMatch("Romance Dawn Booster Box Display", "Romance Dawn Booster Box Display", idx)?.id, 4);
  // Tipo diverso: mai (il bundle non è la busta).
  assert.equal(fuzzyMatch("Prismatic Evolutions Booster", "Prismatic Evolutions Booster", idx)?.id, 3);
  assert.equal(fuzzyMatch("Gem Pack Vol. 1 Booster", "Gem Pack Vol. 1 Booster", idx), null);
  // Lo stesso tin in due gruppi TCGplayer e "1-Pack" = "Single Pack": trovati.
  const idx2 = fuzzyIndex([
    { id: 7, name: "V Powers Tin [Pikachu V]", group: "Miscellaneous Cards & Products" },
    { id: 8, name: "V Powers Tin [Pikachu V]", group: "SWSH: Promos" },
    { id: 9, name: "V Powers Tin [Eevee V]", group: "Miscellaneous Cards & Products" },
    { id: 10, name: "Darkness Ablaze Single Pack Blister [Hatenna]", group: "SWSH03: Darkness Ablaze" },
    { id: 11, name: "Code Card - Darkness Ablaze Single Pack Blister [Hatenna]", group: "SWSH03: Darkness Ablaze" },
  ]);
  assert.equal(fuzzyMatch("Pokémon Products V Powers Tins: Pikachu V Tin", "V Powers Tins: Pikachu V Tin", idx2)?.id, 7);
  assert.equal(fuzzyMatch("Darkness Ablaze Darkness Ablaze: Hatenna 1-Pack Blister", "Darkness Ablaze: Hatenna 1-Pack Blister", idx2)?.id, 10);
  // Numeri, anni e "pack" non obbligatori; il set di Cardmarket non deve essere nel gruppo TCGplayer.
  const idx3 = fuzzyIndex([
    { id: 20, name: "Lost Origin Booster Box Case", group: "SWSH11: Lost Origin" },
    { id: 21, name: "Stellar Crown Booster Pack", group: "SV07: Stellar Crown" },
    { id: 22, name: "Stellar Crown Sleeved Booster Pack", group: "SV07: Stellar Crown" },
    { id: 23, name: "Team Rocket Tin [Team Rocket's Nidoking ex]", group: "Miscellaneous Cards & Products" },
    { id: 24, name: "Team Rocket Tin [Team Rocket's Nidoking ex] (International Version)", group: "Miscellaneous Cards & Products" },
    { id: 25, name: "Pokemon Stacking Tins: Fighting-Fire-Darkness Display", group: "SWSH11: Lost Origin" },
  ]);
  assert.equal(fuzzyMatch("Lost Origin Lost Origin 6 Booster Box Case", "Lost Origin 6 Booster Box Case", idx3)?.id, 20);
  assert.equal(fuzzyMatch("Stellar Crown Stellar Crown Booster (6 Cards)", "Stellar Crown Booster (6 Cards)", idx3)?.id, 21);
  assert.equal(fuzzyMatch("Destined Rivals Team Rocket Tins: Team Rocket's Nidoking ex Tin (US Version)", "Team Rocket Tins: Team Rocket's Nidoking ex Tin (US Version)", idx3)?.id, 23);
  assert.equal(fuzzyMatch("Pokémon Products 2022 Fire, Fighting & Darkness Stacking Tin Display", "2022 Fire, Fighting & Darkness Stacking Tin Display", idx3)?.id, 25);
  // Parentesi che dicono il prodotto; set giapponese senza lingua su Cardmarket; ma un prodotto generico no.
  const idx4 = fuzzyIndex([
    { id: 30, name: "First Partner Pack (Johto)", group: "First Partner Pack" },
    { id: 31, name: "First Partner Pack (Kanto)", group: "First Partner Pack" },
    { id: 32, name: "Advent of Arceus Booster Pack", group: "DPt4: Advent of Arceus", lang: "ja" },
    { id: 33, name: "Thunderstorm Theme Deck", group: "Japanese Theme Decks", lang: "ja" },
  ]);
  assert.equal(fuzzyMatch("Pokémon Products First Partner Pack US Version (Johto)", "First Partner Pack US Version (Johto)", idx4)?.id, 30);
  assert.equal(fuzzyMatch("Advent of Arceus Advent of Arceus Booster", "Advent of Arceus Booster", idx4)?.id, 32);
  assert.equal(fuzzyMatch("Pokémon Products Thunderstorm Theme Deck", "Thunderstorm Theme Deck", idx4), null);
  // Prodotto giapponese: niente foto del prodotto inglese.
  assert.equal(fuzzyMatch("Romance Dawn Booster Box Display", "Romance Dawn Booster Box Display", idx, "ja"), null);
});

test("foto TCGplayer per la sola foto: regole più larghe, ma mai un altro prodotto", async () => {
  const { fuzzyIndex, fuzzyMatch } = await import("../src/sealed.js");
  const idx = fuzzyIndex([
    { id: 1, name: "Premium Gold: Return of the Bling Mini-Booster Pack", group: "Premium Gold: Return of the Bling" },
    { id: 2, name: "The Dark Side of Dimensions Movie Pack: Gold Edition Box", group: "The Dark Side of Dimensions Movie Pack: Gold Edition" },
    { id: 3, name: "The Dark Side of Dimensions Movie Pack: Secret Edition Pack", group: "The Dark Side of Dimensions Movie Pack: Secret Edition" },
    { id: 4, name: "Absolute Powerforce - Booster Pack [Unlimited Edition]", group: "Absolute Powerforce" },
  ]);
  const photo = (full, name, genericSet = true) => fuzzyMatch(full, name, idx, "en", false, { photo: true, genericSet })?.id ?? null;
  // Il numero è il prodotto: "Premium Pack 2022" non è "Premium Gold".
  assert.equal(photo("Premium Pack 2022 Booster", "Premium Pack 2022 Booster"), null);
  assert.equal(photo("Gold Pack 2016 Booster", "Gold Pack 2016 Booster"), null);
  // Una busta non ha la foto del box.
  assert.equal(photo("The Dark Side of Dimensions Movie Pack Gold Booster", "The Dark Side of Dimensions Movie Pack Gold Booster"), null);
  assert.equal(photo("The Dark Side of Dimensions Movie Pack Secret Edition Booster", "The Dark Side of Dimensions Movie Pack Secret Edition Booster"), 3);
  // La 1ª edizione ha la foto della unlimited.
  assert.equal(photo("Absolute Powerforce 2-Pack Set", "Absolute Powerforce 2-Pack Set", false), 4);
});

test("prodotto TCGplayer per l'andamento: contenuto senza scatola, campionati, volumi e casse", async () => {
  const { fuzzyIndex, fuzzyMatch } = await import("../src/sealed.js");
  const idx = fuzzyIndex([
    { id: 1, name: "Starter Deck 15: RED Edward.Newgate", group: "ST-15: Starter Deck 15 RED Edward.Newgate" },
    { id: 2, name: "Championship 2024 Top Player Pack", group: "One Piece Promotion Cards" },
    { id: 3, name: "CS 25-26 Top Player Pack", group: "One Piece Promotion Cards" },
    { id: 4, name: "DON!! Card (CS 2023 Celebration Pack)", group: "One Piece Promotion Cards" },
    { id: 5, name: "DON!! Card Pack Vol. 1", group: "One Piece Promotion Cards" },
    { id: 6, name: "Hidden Arsenal - Booster Box [Unlimited Edition]", group: "Hidden Arsenal" },
    { id: 7, name: "Hidden Arsenal 2 - Booster Box [1st Edition]", group: "Hidden Arsenal 2" },
    { id: 8, name: "Celebrations Elite Trainer Box Case", group: "Celebrations" },
    { id: 9, name: "Lost Origin Sleeved Booster Pack Case", group: "SWSH11: Lost Origin" },
    { id: 10, name: "McDonald's Japan Promo Booster (2025)", group: "M-P Promotional Cards", lang: "ja" },
    { id: 11, name: "Learn Together Deck Set", group: "One Piece Products" },
  ]);
  const tp = (full, name, lang = "en") => fuzzyMatch(full, name, idx, lang)?.id ?? null;
  // Il mazzo senza scatola non segue il prezzo del mazzo in scatola.
  assert.equal(tp("ST-15: Starter Deck Edward.Newgate Starter Deck: Edward.Newgate Deck Pack", "Starter Deck: Edward.Newgate Deck Pack"), null);
  // "CS 2024" = "Championship 2024"; il 2023 non è la busta del 2025-26.
  assert.equal(tp("One Piece Products CS 2024 Top Player Pack", "CS 2024 Top Player Pack"), 2);
  assert.equal(tp("One Piece Products CS 2023 Top Players Pack", "CS 2023 Top Players Pack"), null);
  // Le carte DON!! col nome della busta sono carte, non la busta; i DON!! Card Pack sì.
  assert.equal(tp("One Piece Products CS 2023 Celebration Pack", "CS 2023 Celebration Pack"), null);
  assert.equal(tp("One Piece Products DON!! Card Pack Vol.1", "DON!! Card Pack Vol.1"), 5);
  // Il volume conta: il prodotto senza numero è il primo della serie ("Deck Set 01" sì, "Hidden Arsenal 5" no).
  assert.equal(tp("Hidden Arsenal 2 Hidden Arsenal 2 Booster Box", "Hidden Arsenal 2 Booster Box"), 7);
  assert.equal(tp("Hidden Arsenal 5 Hidden Arsenal 5 Booster Box", "Hidden Arsenal 5 Booster Box"), null);
  assert.equal(tp("One Piece Products Learn Together Deck Set 01", "Learn Together Deck Set 01"), 11);
  // Quante confezioni ha una cassa non lo scrive TCGplayer; "Promo Pack" = "Promo Booster".
  assert.equal(tp("Celebrations Celebrations 10 Elite Trainer Box Case", "Celebrations 10 Elite Trainer Box Case"), 8);
  assert.equal(tp("Lost Origin Lost Origin 24 Sleeved Booster Case", "Lost Origin 24 Sleeved Booster Case"), 9);
  assert.equal(tp("M-P Promos McDonald's 2025 Japan Promo Pack", "McDonald's 2025 Japan Promo Pack", "ja"), 10);
});

test("foto dai sigillati CardTrader non collegati a Cardmarket, prima di TCGplayer", async () => {
  const { data, log } = buildSealed({
    products: [
      { idProduct: 900001, name: "CBB7C: Gem Pack Vol. 7 Booster Box (Simplified Chinese)", categoryName: "Pokémon Display", idExpansion: 7000 },
      { idProduct: 900002, name: "Romance Dawn Booster Box", categoryName: "Pokémon Display", idExpansion: 7001 },
    ],
    guide: { priceGuides: [] },
    cmToCtExp: new Map(), ctExpNames: new Map([[50, "Gem Pack Vol. 7"], [51, "Romance Dawn"]]), ctExpLangs: new Map([[50, "zh-CN"]]),
    ctProducts: new Map(),
    ctUnlinked: [
      { bp: 1, name: "Gem Pack Vol. 7 Booster Box", img: "/gem.jpg", lang: "zh-CN", ctExp: 50 },
      { bp: 2, name: "Booster Box", img: "/rd.jpg", lang: "en", ctExp: 51 },
    ],
    tpProducts: [{ id: 9, name: "Romance Dawn Booster Box", group: "Romance Dawn", lang: "en" }],
  });
  const img = Object.fromEntries(data.p.map((p) => [p.id, p.img]));
  assert.equal(img[900001], "/gem.jpg");
  assert.equal(img[900002], "/rd.jpg"); // CardTrader prima di TCGplayer
  assert.ok(log.some((l) => l.includes("Foto CardTrader per nome")));
});

test("prodotto TCGplayer di ogni sigillato, per l'andamento della collezione (tp = [prodotto, gruppo])", async () => {
  const { addSealedTcgplayer } = await import("../src/sealed.js");
  // Prodotti reali del catalogo TCGplayer (gruppo 23237 = SV: Scarlet & Violet 151; 23286 = SV08.5 Prismatic).
  const tp = [
    { id: "503313", name: "151 Elite Trainer Box", group: "SV: Scarlet & Violet 151", groupId: 23237, lang: "en" },
    { id: "501999", name: "151 Pokemon Center Elite Trainer Box (Exclusive)", group: "SV: Scarlet & Violet 151", groupId: 23237, lang: "en" },
    { id: "593355", name: "Prismatic Evolutions Elite Trainer Box", group: "SV: Prismatic Evolutions", groupId: 23821, lang: "en" },
    { id: "9", name: "Pokemon Card 151 Booster Box", group: "SV2a: Pokemon Card 151", groupId: 23599, lang: "ja" },
    // Senza gruppo: non si usa.
    { id: "10", name: "Paldea Evolved Elite Trainer Box", group: "SV02", lang: "en" },
  ];
  const exp = { 5402: "151", 6000: "Prismatic Evolutions", 7000: "Paldea Evolved", 7001: "Pokemon Card 151" };
  const out = [
    { id: 1, n: "151 Elite Trainer Box", e: 5402 },
    { id: 2, n: "Elite Trainer Box", e: 6000 },
    { id: 3, n: "Paldea Evolved Elite Trainer Box", e: 7000 },
    { id: 4, n: "Pokemon Card 151 Booster Box", e: 7001, l: "ja" },
    // Il box giapponese non è il prodotto inglese.
    { id: 5, n: "Prismatic Evolutions Elite Trainer Box", e: 6000, l: "ja" },
  ];
  assert.equal(addSealedTcgplayer(out, tp, exp), 3);
  assert.deepEqual(out.map((p) => p.tp ?? null), [[503313, 23237], [593355, 23821], null, [9, 23599], null]);
});

test("prodotto TCGplayer dei sigillati: stessa confezione e un prodotto a un solo sigillato (riverifica del 19 novembre 2026)", async () => {
  const { addSealedTcgplayer, linkMarks, uniqueSealedLinks } = await import("../src/sealed.js");
  // Nomi veri dei cataloghi del 19 novembre 2026 (Cardmarket) e di TCGplayer (tcgcsv).
  assert.equal(linkMarks("Celestial Storm: Empty Elite Trainer Box"), "empty");
  assert.equal(linkMarks("Team Up Booster Box (18 Boosters)"), "half");
  assert.equal(linkMarks("Chaos Impact Booster Box (18 Booster)"), "half");
  assert.equal(linkMarks("Unleashed Booster (5 Cards)"), "cards:5");
  assert.equal(linkMarks("Wild Survivors (12 Booster Boxes)"), "case");
  assert.equal(linkMarks("Romance Dawn Booster Box Case (12x Booster Box)"), "case");
  assert.equal(linkMarks("Detective Pikachu: Charizard GX Special Case File"), "case");
  assert.equal(linkMarks("Unleashed Booster"), "");
  const tp = [
    { id: "451613", name: "Celestial Storm Elite Trainer Box", group: "SM Celestial Storm", groupId: 2278, lang: "en" },
    { id: "181434", name: "Team Up Booster Box", group: "SM Team Up", groupId: 2377, lang: "en" },
    { id: "83419", name: "Unleashed Booster Pack", group: "HGSS Unleashed", groupId: 1399, lang: "en" },
    { id: "810410", name: "Azure Legends Tins: Dialga ex Tin", group: "Miscellaneous Cards & Products", groupId: 1527, lang: "en" },
  ];
  const exp = { 1: "Celestial Storm", 2: "Team Up", 3: "Unleashed", 8: "Azure Legends" };
  const out = [
    { id: 451624, n: "Celestial Storm: Empty Elite Trainer Box", e: 1 },
    { id: 451613, n: "Celestial Storm Elite Trainer Box", e: 1 },
    { id: 562367, n: "Team Up Booster Box (18 Boosters)", e: 2 },
    { id: 271852, n: "Unleashed Booster", e: 3 },
    { id: 562441, n: "Unleashed Booster (5 Cards)", e: 3 },
    // Stesso nome fuori dalle parentesi: tutti e due tengono il collegamento, come prima.
    { id: 810410, n: "Azure Legends Tins: Dialga ex Tin", e: 8 },
    { id: 810411, n: "Azure Legends Tins: Dialga ex Tin (US Version)", e: 8 },
  ];
  const log = [];
  assert.equal(addSealedTcgplayer(out, tp, exp, null, log), 4);
  assert.deepEqual(Object.fromEntries(out.map((p) => [p.id, p.tp?.[0] ?? null])), {
    451624: null, 451613: 451613, // la confezione vuota non segue l'ETB pieno
    562367: null, // il mezzo box non è il box intero
    271852: 83419, 562441: null, // la busta da 5 carte non è la busta normale
    810410: 810410, 810411: 810410,
  });
  assert.ok(log.some((l) => l.includes("3 tolti perché la confezione è diversa")), log.join("\n"));

  // Più sigillati collegati allo stesso prodotto (collegamenti dei cataloghi pubblicati il 19 novembre 2026).
  const names = new Map([
    ["84000", { name: "FireRed & LeafGreen Theme Deck - \"LeafGreen\" [Ivysaur]" }],
    ["547546", { name: "First Partner Pack (Galar)" }],
    ["90001", { name: "Double Crisis: Team Magma Blister" }],
    ["763463", { name: "Holon Phantoms Booster Box" }],
  ]);
  const shared = [
    { id: 286523, n: "EX FireRed & LeafGreen: LeafGreen Theme Deck", e: 4, tp: [84000, 1] },
    { id: 286522, n: "EX FireRed & LeafGreen: FireRed Theme Deck", e: 4, tp: [84000, 1] },
    { id: 547551, n: "First Partner Pack US Version (Galar)", e: 5, tp: [547546, 1] },
    { id: 547552, n: "First Partner Pack EU Version (Galar)", e: 5, tp: [547546, 1] },
    { id: 586000, n: "Double Crisis: Team Magma 3-Pack Blister", e: 6, tp: [90001, 1] },
    { id: 586001, n: "Double Crisis: Team Magma 4-Pack Blister", e: 6, tp: [90001, 1] },
    { id: 271915, n: "EX Holon Phantoms Booster Box", e: 7, tp: [763463, 1] },
    { id: 763463, n: "Holon Phantom Booster Box", e: 9000, tp: [763463, 1] },
  ];
  const sharedExp = { 4: "EX FireRed & LeafGreen", 5: "Pokémon Products", 6: "Double Crisis", 7: "EX Holon Phantoms" };
  assert.equal(uniqueSealedLinks(shared, names, sharedExp), 5);
  assert.deepEqual(shared.filter((p) => p.tp).map((p) => p.id), [
    286523, // il mazzo LeafGreen, non quello FireRed
    547551, // TCGplayer è il mercato americano: la versione US
    // 3 o 4 buste? Non si sa: nessuno dei due blister Double Crisis
    271915, // il prodotto senza espansione nel catalogo cede a quello col set
  ]);
});

test("Lorcana: i pacchetti promo «Memories of the Story» sono giapponesi anche senza la lingua nel nome", async () => {
  const { LORCANA_SEALED_TYPES } = await import("../src/sealed.js");
  // Nomi e id reali di Cardmarket; CardTrader collega il Vol.1 a un blueprint con lingua inglese.
  const { data } = buildSealed({
    products: [
      { idProduct: 864938, name: "Fabled: Memories of the Story Special Promotion Pack Vol.1", categoryName: "Lorcana Booster", idExpansion: 6170, dateAdded: "2026-01-06" },
      { idProduct: 874545, name: "Fabled: Memories of the Story Special Promotion Pack Vol.2", categoryName: "Lorcana Booster", idExpansion: 6170, dateAdded: "2026-02-27" },
      { idProduct: 868429, name: "Fabled Participation Booster", categoryName: "Lorcana Booster", idExpansion: 6170, dateAdded: "2026-01-26" },
    ],
    guide: { priceGuides: [] },
    cmToCtExp: new Map([[864938, 4197], [868429, 4197]]),
    ctExpNames: new Map([[4197, "Fabled"]]),
    ctProducts: new Map([[864938, { bp: 365506, img: null, lang: "en" }], [868429, { bp: 372427, img: null, lang: "en" }]]),
    ctExpLangs: new Map([[4197, "en"]]),
    ctPrices: {},
    types: LORCANA_SEALED_TYPES,
    westernLang: "en",
  });
  assert.deepEqual(data.p.map((p) => [p.id, p.l]), [[864938, "ja"], [874545, "ja"], [868429, "en"]]);
});

// ---------------------------------------------------------------- errori sicuri della verifica del 17 novembre 2026

test("tendenza Cardmarket segnaposto o sotto 1 € col minimo dieci volte più su: non è una tendenza", async () => {
  const { saneTrend, YUGIOH_SEALED_TYPES } = await import("../src/sealed.js");
  assert.equal(saneTrend(0.02, 40000), null); // Mega Charizard X Poncho-wearing Pikachu Special Box
  assert.equal(saneTrend(0.02, undefined), null); // EX Team Rocket Returns Booster Box
  assert.equal(saneTrend(0.64, 14), null); // Legendary Dragons of Atlantis Deck Card Pack
  assert.equal(saneTrend(0.08, 0.8), null); // Dragon Ball «Event Pack 12»
  assert.equal(saneTrend(0.28, 1.1), 0.28); // tin vuoto: costa davvero centesimi
  assert.equal(saneTrend(0.34, 0.02), 0.34); // puzzle di Lorcana
  assert.equal(saneTrend(2239.24, 100000), 2239.24); // sopra 1 € il minimo (anche di un venditore solo) non decide
  assert.equal(saneTrend(undefined, 10), null);
  // Nel catalogo: senza la tendenza resta il minimo; con le offerte CardTrader il prodotto ha comunque un prezzo.
  const { data, log } = buildSealed({
    products: [
      { idProduct: 254476, name: "Magician's Force Booster Box", categoryName: "Yugioh Display", idExpansion: 1042, dateAdded: "2007-01-01" },
      { idProduct: 254486, name: "Shadow of Infinity Booster Box", categoryName: "Yugioh Display", idExpansion: 1052, dateAdded: "2007-01-01" },
      { idProduct: 254469, name: "Metal Raiders Booster Box", categoryName: "Yugioh Display", idExpansion: 1035, dateAdded: "2007-01-01" },
    ],
    guide: { priceGuides: [
      { idProduct: 254476, trend: 0.02, low: 12000 },
      { idProduct: 254486, trend: 0.02, low: 2990 },
      { idProduct: 254469, trend: 499.29, low: 465 },
    ] },
    cmToCtExp: new Map(), ctExpNames: new Map(), ctProducts: new Map(),
    ctPrices: { en: new Map([[254486, [3100.64, 2]]]) },
    types: YUGIOH_SEALED_TYPES, westernLang: "en",
  });
  assert.deepEqual(data.p.map((p) => p.cm), [{ low: 12000 }, { low: 2990 }, { trend: 499.29, low: 465 }]);
  // Senza tendenza le offerte non passano dal filtro "oltre il triplo della tendenza": restano.
  assert.deepEqual(data.p[1].ct, { en: [3100.64, 2] });
  assert.ok(log.some((l) => l.startsWith("Tendenze Cardmarket non credibili") && l.endsWith(": 2")));
});

test("Yu-Gi-Oh! (OCG) è giapponese", async () => {
  const { YUGIOH_SEALED_TYPES } = await import("../src/sealed.js");
  const { data } = buildSealed({
    products: [
      { idProduct: 608385, name: "Strike of Neos (OCG) Booster", categoryName: "Yugioh Booster", idExpansion: 4834, dateAdded: "2022-02-07" },
      { idProduct: 607064, name: "Ignition Assault (OCG) Booster", categoryName: "Yugioh Booster", idExpansion: 4570, dateAdded: "2022-01-28" },
      { idProduct: 803859, name: "Legacy of Darkness (Korean) Booster", categoryName: "Yugioh Booster", idExpansion: 1, dateAdded: "2025-01-01" },
      { idProduct: 254469, name: "Metal Raiders Booster Box", categoryName: "Yugioh Display", idExpansion: 1035, dateAdded: "2007-01-01" },
    ],
    guide: { priceGuides: [] },
    cmToCtExp: new Map(), ctExpNames: new Map(), ctProducts: new Map(),
    types: YUGIOH_SEALED_TYPES, westernLang: "en",
  });
  assert.deepEqual(data.p.map((p) => p.l), ["ja", "ja", "ko", "en"]);
});

test("prodotti giapponesi che CardTrader dà per occidentali: lingua dalle offerte (solo Pokémon)", async () => {
  const { fixLangsFromOffers } = await import("../src/sealed.js");
  // Cataloghi veri del 17 novembre 2026.
  const out = [
    { id: 576800, n: "VMAX Climax Booster Box", e: 4390, ct: { ja: [199.64, 9] } },
    { id: 576801, n: "VMAX Climax Booster", e: 4390, ct: { ja: [16.1, 2] } },
    { id: 800344, n: "VMAX Climax Booster Box Case", e: 4390, l: "ja", ct: {} },
    { id: 579346, n: "25th Anniversary Collection Booster Box", e: 4345, ct: { ja: [300.64, 8] } },
    // Una sola offerta giapponese, ma nell'espansione di un prodotto giapponese e senza offerte occidentali.
    { id: 580608, n: "25th Anniversary Collection Special Set", e: 4345, ct: { ja: [299.64, 1] } },
    // Senza offerte: resta com'è (non si sa).
    { id: 586051, n: "25th Anniversary Collection Special Set Bundle Box", e: 4345, ct: {} },
    { id: 564169, n: "Gengar VMAX High-Class Deck", e: 4241, ct: { ja: [240.14, 2] } },
    // Una sola offerta giapponese e nessun altro prodotto asiatico nell'espansione: troppo poco per cambiare lingua.
    { id: 606330, n: "Mystery of the Fossils Booster", e: 4464, ct: { ja: [735.63, 1] } },
    // "Pokémon Products": espansione generica con offerte occidentali, l'offerta giapponese sola non basta.
    { id: 650460, n: "Yu Nagaba × Pokémon Card Game Special Box", e: 1645, ct: { ja: [499.99, 1] } },
    { id: 733803, n: "YU NAGABA x Pokemon Card Game Eevee's Special Box", e: 1645, l: "ja", ct: { ja: [950.64, 2] } },
    { id: 271439, n: "Phantom Forces Booster", e: 1645, ct: { it: [260.64, 2] } },
    // Occidentale con offerte in più lingue, anche giapponesi: resta occidentale.
    { id: 730464, n: "151 Booster Bundle", e: 5402, ct: { en: [15.63, 5], ja: [4.6, 3] } },
    // "JP" è il nome del mazzo: 16 offerte occidentali e nessuna giapponese.
    { id: 867799, n: 'WCD 2025: Yuya Okita "JP Raging Bolt"', e: 6454, l: "ja", ct: { en: [19.26, 8], it: [23.37, 8] } },
    // Giapponese vero con offerte giapponesi; e uno col nome esplicito e offerte scritte in inglese: restano.
    { id: 564175, n: "Eevee Heroes Booster Box", e: 4300, l: "ja", ct: { ja: [419.89, 12], en: [430.2, 3] } },
    { id: 823792, n: "Black Bolt JP Booster Box", e: 6200, l: "ja", ct: { ja: [116.63, 10] } },
    { id: 1, n: "Clay Burst Booster Box (Japanese)", e: 5400, l: "ja", ct: { en: [80, 4] } },
  ];
  assert.deepEqual(fixLangsFromOffers(out, null), { toJa: 5, toWestern: 1 });
  assert.deepEqual(out.map((p) => p.l), ["ja", "ja", "ja", "ja", "ja", undefined, "ja", undefined, undefined, "ja", undefined, undefined, undefined, "ja", "ja", "ja"]);
  // One Piece (un prodotto per lingua su Cardmarket): le offerte giapponesi su un prodotto inglese non lo cambiano; un
  // prodotto dato per giapponese da CardTrader con sole offerte inglesi (20) torna inglese; con offerte in tutte e due resta.
  const op = [
    { id: 901327, n: "Round1 Promotion Pack", e: 5244, l: "en", ct: { ja: [35.52, 9] } },
    { id: 894158, n: "Mini-tin Pack Set Vol.3 (Monkey.D.Luffy V2)", e: 5244, l: "ja", ct: { en: [25.3, 20] } },
    { id: 894159, n: "Mini-tin Pack Set Vol.3 (Shanks V1)", e: 5244, l: "ja", ct: { en: [32.51, 18], ja: [125.64, 4] } },
    { id: 2, n: "Romance Dawn Booster Box (Non-English)", e: 5229, l: "ja", ct: { en: [240.64, 5] } },
  ];
  assert.deepEqual(fixLangsFromOffers(op, "en"), { toJa: 0, toWestern: 1 });
  assert.deepEqual(op.map((p) => p.l), ["en", "en", "ja", "ja"]);
});

test("prodotti solo su CardTrader con la tendenza del listino Cardmarket (riverifica del 19 novembre 2026)", async () => {
  const { buildSealed } = await import("../src/sealed.js");
  // Casi veri: carte giganti e il set di carte d'oro di Crown Zenith, che CardTrader collega a prodotti Cardmarket fuori
  // dall'elenco dei sigillati. Il listino del 19 novembre 2026 aveva la tendenza; prima il catalogo li scriveva con cm: null.
  const { data, log } = buildSealed({
    products: [],
    guide: { priceGuides: [
      { idProduct: 703215, trend: 1034.02 },
      { idProduct: 572025, trend: 849.99 },
      { idProduct: 362871, trend: 647.8, low: 600 },
      // Segnaposto: la tendenza resta fuori anche qui.
      { idProduct: 575126, trend: 0.02, low: 40000 },
      // Offerte lontanissime dalla tendenza: fuori come per i prodotti Cardmarket.
      { idProduct: 288724, trend: 25 },
    ] },
    cmToCtExp: new Map(), ctExpLangs: new Map(),
    ctExpNames: new Map([[3171, "Crown Zenith"], [2101, "BW Promos"], [1487, "Legendary Collection"], [1469, "Pokémon Products"]]),
    ctProducts: new Map([
      [703215, { bp: 241639, img: null, lang: "en", name: "Crown Zenith: Gold Dialga, Palkia, Giratina & Arceus", ctExp: 3171 }],
      [572025, { bp: 244325, img: null, lang: "jp", name: "Mewtwo EX", ctExp: 2101 }],
      [362871, { bp: 228446, img: null, lang: "en", name: "Charizard", ctExp: 1487 }],
      [575126, { bp: 5, img: null, lang: "en", name: "Mega Charizard X Poncho-wearing Pikachu Special Box", ctExp: 1469 }],
      [288724, { bp: 6, img: null, lang: "en", name: "Ho-Oh Coin (Neo Summer Road)", ctExp: 1469 }],
    ]),
    ctPrices: { it: new Map([[703215, [1700.64, 1]]]), en: new Map([[288724, [250, 3]]]) },
  });
  const by = Object.fromEntries(data.p.map((p) => [p.id, p]));
  assert.deepEqual(by[703215].cm, { trend: 1034.02 });
  assert.deepEqual(by[703215].ct, { it: [1700.64, 1] }); // sotto il triplo della tendenza: resta
  assert.deepEqual(by[572025].cm, { trend: 849.99 });
  assert.equal(by[572025].l, "ja"); // la lingua del prodotto resta quella di CardTrader
  assert.deepEqual(by[362871].cm, { trend: 647.8, low: 600 });
  assert.deepEqual(by[575126].cm, { low: 40000 }); // tendenza segnaposto tolta
  assert.deepEqual(by[288724].cm, { trend: 25 });
  assert.deepEqual(by[288724].ct, {}); // 250 € contro una tendenza di 25 €: fuori mercato
  assert.ok(log.some((l) => l.includes("Sigillati solo su CardTrader: 5") && l.includes("4 con la tendenza del listino")), log.join("\n"));
  assert.ok(log.some((l) => l.includes("scartate: 1")), log.join("\n"));
});

test("un box non vale meno di una sua busta: la tendenza smentita dal suo minimo non si usa (riverifica del 19 novembre 2026)", async () => {
  const { boxBelowBooster } = await import("../src/sealed.js");
  // Listino Cardmarket del 19 novembre 2026.
  const out = [
    { id: 271911, n: "EX Dragon Frontiers Booster Box", t: "display", cm: { trend: 40 } },
    { id: 271843, n: "EX Dragon Frontiers Booster", t: "booster", cm: { trend: 1697.26, low: 1979.99 } },
    { id: 858380, n: "MEGA Dream ex Booster Box", t: "display", l: "ja", cm: { trend: 79.03, low: 67.5 } },
    { id: 858381, n: "MEGA Dream ex Booster", t: "booster", l: "ja", cm: { trend: 80.7, low: 4.99 } },
    // Nessuna delle due vicina al suo minimo: nessuna delle due tendenze (EX Deoxys).
    { id: 271909, n: "EX Deoxys Booster Box", t: "display", cm: { trend: 1468.22 } },
    { id: 271841, n: "EX Deoxys Booster", t: "booster", cm: { trend: 1473.32, low: 499.95 } },
    // Busta sotto il box: niente da fare. Mezzo box tra parentesi: non è la coppia.
    { id: 271910, n: "Team Up Booster Box", t: "display", cm: { trend: 500, low: 480 } },
    { id: 271842, n: "Team Up Booster", t: "booster", cm: { trend: 20, low: 15 } },
    { id: 562367, n: "Team Up Booster Box (18 Boosters)", t: "display", cm: { trend: 10 } },
    // Stesso nome in un'altra lingua: un'altra coppia.
    { id: 900001, n: "MEGA Dream ex Booster Box", t: "display", cm: { trend: 50, low: 45 } },
  ];
  const dropped = boxBelowBooster(out).map((d) => d.id).sort();
  assert.deepEqual(dropped, [271841, 271909, 271911, 858381]);
  const trend = Object.fromEntries(out.map((p) => [p.id, p.cm.trend ?? null]));
  assert.equal(trend[271843], 1697.26);
  assert.equal(trend[858380], 79.03);
  assert.equal(trend[562367], 10);
  assert.equal(trend[900001], 50);
});
