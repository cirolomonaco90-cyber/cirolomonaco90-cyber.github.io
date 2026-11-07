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
