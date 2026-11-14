import test from "node:test";
import assert from "node:assert/strict";
import { bucketOf, titleLang, matches, bucketPrices, plan, buildUniverse, query, sealedWords, sealedBucket, run, intervalFor, dailyDemand, searchKey, CRITERIO } from "../src/ebay-prezzi.js";
import { baseNumber, printRules, printOk } from "../src/ebay-stampe.js";

test("secchio dal titolo: lingua, variante e voto", () => {
  // Chi non dice la lingua sta nel secchio "xx": su eBay.it sono quasi tutte carte italiane, non inglesi.
  assert.equal(bucketOf("Gengar 11/110 Legendary Collection Reverse Holo NM"), "xx|r");
  assert.equal(bucketOf("Gengar 11/110 Legendary Collection Reverse Holo NM English"), "en|r");
  assert.equal(bucketOf("Charizard 4/102 Set Base 1a Edizione ITA"), "it|1");
  assert.equal(bucketOf("Charizard 4/102 Base Set Shadowless Holo ENG"), "en|s");
  assert.equal(bucketOf("Charizard 4/102 PSA 10 Gem Mint"), "xx|g:PSA 10");
  assert.equal(bucketOf("Pikachu 25/102 BGS 9.5 japanese"), "ja|g:BGS 9.5");
  assert.equal(bucketOf("Articuno di Galar SWSH123 Staff promo"), "xx|st");
  assert.equal(bucketOf("Lugia 9/111 Prerelease stamp italiano"), "it|pr");
  assert.equal(bucketOf("Lugia 9/111 Holo Rare Deutsch"), "de|n");
  // Lotti, falsi, gradate senza voto: scartate.
  assert.equal(bucketOf("Lotto 50 carte Pokemon Charizard 4/102"), null);
  assert.equal(bucketOf("Charizard 4/102 proxy custom"), null);
  assert.equal(bucketOf("Charizard 4/102 graded slab"), null);
  // Ristampe (Celebrations) e copie rovinate fuori; una carta di Celebrations accetta le sue parole.
  assert.equal(bucketOf("Shining Charizard 107/105 Celebrations Classic Collection"), null);
  assert.equal(bucketOf("Shining Charizard 107/105 Celebrations", { reprintOk: true }), "xx|n");
  assert.equal(bucketOf("Charizard 4/102 Base Set Heavily Played HP"), null);
  assert.equal(bucketOf("Charizard 4/102 PSA 9"), "xx|g:PSA 9"); // le gradate restano (il voto dice la condizione)
});

test("lingua: inglese solo se il titolo lo dice (titoli veri di eBay.it, 10 novembre 2026)", () => {
  assert.equal(titleLang("Dragonite 4/62 Fossil Holo Unlimited"), null);
  assert.equal(titleLang("Pokemon Dragonite EX 106/108 XY Evolutions Full Art Ultra Rare ENGLISH"), "en");
  assert.equal(titleLang("Carta Pokemon Dragonite 4/62 Fossil holo inglese near mint"), "en");
  // "EN" in maiuscolo come sigla della lingua; "en" in un titolo spagnolo o in un titolo tutto maiuscolo no.
  assert.equal(titleLang("Wizards of the Coast Dragonite Fossil Holo Rara Illimitata 4/62 EN 1999 100HP"), "en");
  assert.equal(titleLang("Umbreon VMAX - 215/203 - Pokémon Cielos en Evolución Arte Alternativo Ultra Raro"), null);
  assert.equal(titleLang("UMBREON VMAX 215/203 CIELOS EN EVOLUCION"), null);
  // Le altre lingue vincono su un "EN" messo per altro.
  assert.equal(titleLang("One Piece Usopp Op10-042 (Playmat - Edizione Limitata Vol. 3 Promo) JP NM"), "ja");
  assert.equal(titleLang("Charizard 4/102 Set Base ITA EN disponibili"), "it");
  // Prodotti che in italiano non esistono (One Piece): chi non dice la lingua vende la carta inglese.
  assert.equal(bucketOf("Enel OP15-060 Super Rare Adventure on Kami's Island One Piece Foil Near Mint", { plain: "en" }), "en|n");
  assert.equal(bucketOf("Enel OP15-060 SR JAP NM - One Piece Card", { plain: "en" }), "ja|n");
});

test("il titolo parla del prodotto: nome e numero col totale, o le parole del sigillato", () => {
  const p = { kind: "card", name: "Gengar", number: "11", total: 110 };
  assert.ok(matches("Gengar 11/110 Legendary Collection Reverse", p));
  assert.ok(matches("GENGAR 011/110 LC", p));
  assert.ok(!matches("Gengar 5/110 Legendary Collection", p));
  assert.ok(!matches("Haunter 11/110", p));
  assert.ok(matches("Monkey D. Luffy OP05-119 Parallel", { kind: "card", name: "Monkey.D.Luffy", number: "OP05-119" }));
  const box = { kind: "sealed", must: sealedWords("Evolving Skies Booster Box") };
  assert.ok(matches("Pokemon Evolving Skies Booster Box sealed", box));
  assert.ok(!matches("Evolving Skies Booster Pack", box));
});

test("prezzi per secchio: solo euro, solo inserzioni del prodotto, mediana delle più economiche", () => {
  const p = { kind: "card", name: "Gengar", number: "11", total: 110 };
  const items = [
    { title: "Gengar 11/110 Reverse Holo", price: 100, currency: "EUR" },
    { title: "Gengar 11/110 Reverse Holo NM", price: 120, currency: "EUR" },
    { title: "Gengar 11/110 Reverse Holo LP", price: 20, currency: "EUR" }, // giocata: fuori
    { title: "Gengar 11/110 Reverse Holo ITA", price: 90, currency: "EUR" },
    { title: "Gengar 11/110 Holo", price: 40, currency: "EUR" },
    { title: "Gengar 11/110 PSA 9", price: 300, currency: "EUR" },
    { title: "Gengar 11/110 Holo", price: 35, currency: "USD" }, // non euro
    { title: "Haunter 11/110", price: 5, currency: "EUR" }, // altra carta
  ];
  assert.deepEqual(bucketPrices(items, p), { "xx|r": [110, 2], "it|r": [90, 1], "xx|n": [40, 1], "xx|g:PSA 9": [300, 1] });
});

test("frequenza per valore: i cari spesso, i trascurabili di rado, la metà se in collezione", () => {
  assert.equal(intervalFor(4600, false), 2);
  assert.equal(intervalFor(300, false), 4);
  assert.equal(intervalFor(60, false), 7);
  assert.equal(intervalFor(25, false), 14);
  assert.equal(intervalFor(8, false), 30);
  assert.equal(intervalFor(2, false), 90);
  assert.equal(intervalFor(0.1, false), 180);
  assert.equal(intervalFor(60, true), 3.5);
  assert.equal(intervalFor(4600, true), 2); // mai sotto 2 giorni
  assert.equal(dailyDemand([{ id: "a", value: 4600 }, { id: "b", value: 0.1 }], new Set()), 1); // 0,5 + 0,006
});

test("rotazione: dovuti per ritardo, mai cercati come ritardo doppio, entro la quota", () => {
  const u = [
    { id: "cara", value: 1500 }, { id: "media", value: 30 }, { id: "poco", value: 0.5 }, { id: "nuova", value: 10 }, { id: "nuovaPoco", value: 0.2 },
  ];
  // Oggi 200. cara: 6 giorni fa, intervallo 2 → ritardo 3; media: 20 giorni fa, 14 → 1,43; poco: 100 giorni fa, 180 → non ancora.
  const state = { cara: { d: 194 }, media: { d: 180 }, poco: { d: 100 } };
  assert.deepEqual(plan(u, state, new Set(), 200, 10).map((p) => p.id), ["cara", "nuova", "nuovaPoco", "media"]);
  assert.deepEqual(plan(u, state, new Set(), 200, 2).map((p) => p.id), ["cara", "nuova"]);
  // In collezione la poco cara ha intervallo 90: 100 giorni fa → dovuta.
  assert.ok(plan(u, state, new Set(["poco"]), 200, 10).some((p) => p.id === "poco"));
});

test("universo: carte con numero e totale, giapponesi coi nomi inglesi, giochi CardTrader, sigillati", () => {
  const u = buildUniverse({
    cards: {
      "lc-11": { id: "lc-11", set: "lc", localId: "11", name: "Gengar", cm: 1, variants: [1, 2] },
      "lc-99": { id: "lc-99", set: "lc", localId: "99", name: "Caterpie", cm: 3 },
    },
    cardsJa: { "PMCG5-45": { id: "PMCG5-45", set: "PMCG5", localId: "45", name: "エリカ", cm: 4 } },
    sets: { lc: { official: 110 } },
    asiaEn: { PMCG5: { 45: "Erika's Vileplume Lv.34" } },
    guide: { 1: 12, 2: 300, 3: 0.5, 4: 25 },
    ct: [{ prefix: "op:", label: "one piece", data: { sets: [], cards: [{ id: 7, n: "Luffy", num: "OP01-001", s: 1, en: [40, 3] }, { id: 8, n: "Zoro", num: "OP01-002", s: 1, en: [1, 3] }] } }],
    sealed: { p: [{ id: 9, n: "Evolving Skies Booster Box", cm: { trend: 300 } }, { id: 10, n: "Pack", cm: { trend: 5 } }, { id: 11, n: "Medaglia", t: "object", cm: { trend: 300 } }] },
  });
  // Tutti i prodotti, anche quelli da pochi centesimi (si aggiornano di rado); non gli oggetti da collezione.
  assert.deepEqual(u.map((p) => p.id), ["lc-11", "lc-99", "ja:PMCG5-45", "op:7", "op:8", "sl:9", "sl:10"]);
  assert.equal(u[0].value, 300); // il valore più alto tra i prodotti delle varianti
  assert.equal(u[0].cm, 12); // quello del prodotto della carta base
  assert.equal(query(u[0]), "Gengar 11/110");
  assert.equal(query(u[2]), "Erika's Vileplume Lv.34 45 japanese");
  assert.equal(query(u[3]), "Luffy OP01-001 one piece");
  // Giochi CardTrader: senza carte italiane nel catalogo, chi non dice la lingua vende l'inglese.
  assert.equal(u[3].ct, 1);
  assert.equal(u[3].plain, "en");
  assert.equal(u[0].plain, undefined);
});

test("notte: ricerche entro la quota, si ferma alla quota eBay finita", async () => {
  let calls = 0;
  const ebay = { async search(q) { calls++; if (calls === 3) throw new Error("eBay search: HTTP 429"); return [{ title: `${q} Holo`, price: 10, currency: "EUR" }]; } };
  const universe = [1, 2, 3, 4].map((i) => ({ id: `c${i}`, kind: "card", name: "Gengar", number: String(i), total: 110, value: 10 * i }));
  const state = {};
  const log = await run({ ebay, universe, state, owned: new Set(), today: 200, budget: 10, pauseMs: 0 });
  assert.deepEqual(Object.keys(state).sort(), ["c3", "c4"]); // i due più cari, poi la quota è finita
  assert.deepEqual(state.c4, { d: 200, c: CRITERIO, b: { "xx|n": [10, 1] } }); // il criterio dice all'app come leggere i secchi
  assert.ok(log.some((l) => /quota eBay finita dopo 2/.test(l)));
});

test("carte: inserzioni con più carte fuori, le parole del nome del prodotto restano", async () => {
  const { isBundle } = await import("../src/ebay.js");
  assert.equal(isBundle("Charizard 4/102 + Blastoise 2/102 Base Set"), true);
  assert.equal(isBundle("Charizard 4/102 Blastoise 2/102 Venusaur 15/102"), true);
  assert.equal(isBundle("Charizard 4/102 Base Set Holo x2"), true);
  assert.equal(isBundle("Charizard 4/102 Base Set Holo"), false);
  assert.equal(isBundle("Booster Bundle Scarlatto e Violetto 151", "151 Booster Bundle"), false);
  assert.equal(isBundle("Build & Battle Kit Destined Rivals", "Destined Rivals Build & Battle Kit"), false);
});

test("carte solo TCGplayer in collezione: nell'universo, e le giganti solo con le inserzioni delle giganti", async () => {
  const { tpCard, buildUniverse, bucketPrices, query } = await import("../src/ebay-prezzi.js");
  // Righe vere del catalogo TCGplayer (8 novembre 2026).
  assert.deepEqual(tpCard("Ho-oh - 11/12 (Box Topper)", "011/012", "Jumbo Cards"), { name: "Ho-oh", number: "11", total: 12, extra: "box topper", jumbo: true });
  assert.deepEqual(tpCard("Pikachu - 012 (10th Anniversary)", "012", "Miscellaneous Cards & Products"), { name: "Pikachu", number: "12", total: null, extra: "10th anniversary" });
  assert.equal(tpCard("Sabrina's Gaze", "", "Challenge from the Darkness"), null);
  const tcgplayer = { g: { 1528: ["Jumbo Cards", 3] }, p: { 210853: ["Ho-oh - 11/12 (Box Topper)", 1528, "011/012", null] } };
  const u = buildUniverse({ tcgplayer, owned: ["tp-210853", "base1-4", "tp-999"] });
  assert.equal(u.length, 1);
  assert.equal(u[0].id, "tp-210853");
  assert.equal(u[0].value, 20);
  assert.equal(query(u[0]), "Ho-oh 11/12 box topper");
  const items = [
    { title: "Pokemon Ho-Oh 11/12 Jumbo Box Topper HGSS Holo", price: 700, currency: "EUR" },
    { title: "Ho-oh 11/12 box topper oversized card", price: 800, currency: "EUR" },
    { title: "Ho-Oh 11/12 holo carta normale", price: 5, currency: "EUR" },
  ];
  // La carta normale con lo stesso numero non conta per la gigante; per una carta normale le giganti non contano.
  assert.deepEqual(Object.keys(bucketPrices(items, u[0])), ["xx|n"]);
  assert.equal(bucketPrices(items, u[0])["xx|n"][1], 2);
  assert.equal(bucketPrices(items, { ...u[0], jumbo: undefined })["xx|n"][1], 1);
});

test("voto con la virgola delle inserzioni italiane", () => {
  assert.equal(bucketOf("Pokemon HO-OH Skyridge Box Topper Jumbo 11/12 Crystal Italiano Ita BGS 9,5", { jumbo: true }), "it|g:BGS 9.5");
  assert.equal(bucketOf("Charizard 4/102 PSA 9 ENG"), "en|g:PSA 9");
});

test("sigillati: solo il prodotto intero (Japan Post Stamp Box, inserzioni vere di eBay.it dell'8 novembre 2026)", () => {
  const [p] = buildUniverse({ sealed: { p: [{ id: 580605, n: "Japan Post Stamp Box", t: "box", l: "ja", cm: { trend: 2402.14 } }] } });
  assert.equal(p.lang, "ja");
  const eur = (title, price) => ({ title, price, currency: "EUR" });
  const items = [
    // Pezzi del box, carte singole, gradate, custodie, scatole vuote: fuori.
    eur("Pokemon TCG Japan Post Stamp Box IMBALLO ORIGINALE VUOTO solo scatola", 15),
    eur("Pokemon Japan Post Stamp Box Japanese Promo - No Cards No Stamps", 77.5),
    eur("JAPAN POST Pokemon Stamp Box Foglio Solo 2021 Pikachu Cramorant Inutilizzato", 137.46),
    eur("Pokemon Japan Post Stamp Box Promo Japanese - No Stamps", 2658.7),
    eur("Pikachu 227/S-P & Cramorant 226/S-P Japan Post Stamp Box Promo Sigillato", 2549.09),
    eur("PSA 10 Pikachu 227/S-P Cramorant 226/S-P Japan Post Stamp Box Promo Set JP", 4253.33),
    eur("Acrylic Case FOR Japanese Pokemon Stamp Box Japan Post 6-Magnet Lid", 26.95),
    eur("Pikachu / Charizard / Eevee - Japan Post Stamp Box (Pokemon) Post Card Set", 9.68),
    // Il box completo: anche "Set Completo" (la confezione con tutto, non una serie di prodotti) e "mai aperto".
    eur("Pokemon Stamp Box Card Game Japan Post Limited Beauty Back Moon gun mai aperto", 2640.22),
    eur("Set Completo Pokemon Stamp Box Japan Post Limited Beauty Back Moon gun Raro", 2674.32),
    eur("Pokemon Japan Post Stamp Box Promo Japanese set Complete", 3575.68),
    eur("Pokémon Japan Post Stamp Box Sealed", 4286.7),
    eur("Pokemon Stamp Box - Japan Post Beauty Back Moon Mikaeri Bijin - Sealed Complete", 4585.7),
  ];
  assert.deepEqual(bucketPrices(items, p), { "ja|n": [3575.68, 5] });
  // Sotto il 40% della tendenza Cardmarket: un pezzo o un'altra cosa.
  assert.equal(sealedBucket("Pokemon Japan Post Stamp Box", 900, p), null);
  // La lingua scritta nel titolo vince su quella del prodotto.
  assert.equal(sealedBucket("Pokemon Japan Post Stamp Box Korean", 2600, p), "ko|n");
  // Le parole del nome del prodotto non escludono ("Empty", "Bundle"), e Celebrations/25th non sono ristampe per un sigillato.
  const [c] = buildUniverse({ sealed: { p: [{ id: 570907, n: "Celebrations Ultra-Premium Collection", cm: { trend: 928 } }] } });
  assert.equal(sealedBucket("Pokemon Celebrations Ultra-Premium Collection sealed", 900, c), "xx|n");
  assert.equal(sealedBucket("Pokemon Celebrations Ultra-Premium Collection sealed ENG", 900, c), "en|n");
  const [b] = buildUniverse({ sealed: { p: [{ id: 719695, n: "151 Booster Bundle", cm: { trend: 136 } }] } });
  assert.deepEqual(bucketPrices([eur("Pokemon 151 Booster Bundle sigillato ITA", 130)], b), { "it|n": [130, 1] });
});

test("sigillati degli altri giochi: col nome del gioco nella ricerca", () => {
  const u = buildUniverse({
    sealedGames: [
      { label: "lorcana", data: { p: [{ id: 761836, n: "Ursula's Return Illumineer's Trove", cm: { trend: 39.01 } }] } },
      { label: "one piece", data: { p: [{ id: 700001, n: "Romance Dawn Booster Box", l: "ja", cm: { trend: 300 } }] } },
    ],
  });
  assert.deepEqual(u.map((p) => p.id), ["sl:761836", "sl:700001"]);
  assert.equal(query(u[0]), "lorcana Ursula's Return Illumineer's Trove");
  assert.equal(u[1].lang, "ja");
  assert.deepEqual(bucketPrices([{ title: "Disney Lorcana Ursula's Return Illumineer's Trove Sealed", price: 54.25, currency: "EUR" }], u[0]), { "xx|n": [54.25, 1] });
  // I sigillati di un gioco senza carte in italiano: senza lingua nel titolo sono inglesi.
  const [box] = buildUniverse({
    ct: [{ prefix: "op:", label: "one piece", data: { sets: [], cards: [{ id: 7, n: "Luffy", num: "OP01-001", s: 1, en: [40, 3], jp: [20, 3] }] } }],
    sealedGames: [{ label: "one piece", data: { p: [{ id: 700002, n: "Romance Dawn Booster Box", cm: { trend: 300 } }] } }],
  }).filter((p) => p.kind === "sealed");
  assert.equal(box.plain, "en");
  assert.deepEqual(bucketPrices([{ title: "One Piece Romance Dawn Booster Box OP-01 sealed", price: 320, currency: "EUR" }], box), { "en|n": [320, 1] });
});

// Righe vere dei cataloghi del 9 novembre 2026 e titoli veri di eBay.it del 10.
const SHANKS = [
  { id: 244666, n: "Shanks", num: "OP01-120", v: "Secret Rare", r: "Secret Rare", s: 3332, en: [7.13, 23], jp: [1.2, 27] },
  { id: 244667, n: "Shanks", num: "OP01-120a", v: "Alternate Art", r: "Alternate Art", s: 3332, en: [80.62, 15], jp: [35.51, 13] },
  { id: 244668, n: "Shanks", num: "OP01-120m", v: "Manga Panel Alternate Art | Secret Rare", r: "Alternate Art", s: 3332, en: [3599.63, 5], jp: [1142.26, 4] },
  { id: 306600, n: "Shanks", num: "OP01-120m", v: "Manga Panel Alternate Art | Reprint", r: "Alternate Art", s: 3847, en: [1700.64, 3] },
  { id: 310650, n: "Shanks", num: "OP01-120", v: "Reprint | missing pen symbol next to the artist name", r: "Secret Rare", s: 3847, en: [2.6, 37], jp: [1.89, 28] },
  { id: 282240, n: "Shanks", num: "OP01-120", v: "Limited Serial Numbered", r: "Promo", s: 3945, en: [15899.64, 2] },
  { id: 375960, n: "Enel", num: "OP15-060", v: null, r: "Super Rare", s: 4400, en: [0.19, 137], jp: [0.29, 25] },
  { id: 375961, n: "Enel", num: "OP15-060a", v: "Alternate Art", r: "Alternate Art", s: 4400, en: [5.19, 33], jp: [6.05, 10] },
  { id: 375649, n: "Enel", num: "OP15-060", v: "Treasure Cup 2026", r: "Promo", s: 4401, en: [2400.62, 3] },
  { id: 999001, n: "Koby", num: "OP15-061", v: null, r: "Common", s: 4400, en: [0.11, 90] },
];
const OP_SETS = [
  { id: 3332, name: "OP-01: Romance Dawn" }, { id: 3847, name: "PRB-01: The Best - Premium Booster" }, { id: 3945, name: "Championships Promo" },
  { id: 4400, name: "OP-15: Adventure on Kami's Island" }, { id: 4401, name: "Treasure Cup" },
];
const opUniverse = () => buildUniverse({ ct: [{ prefix: "op:", label: "one piece", data: { sets: OP_SETS, cards: SHANKS } }] });
const eur = (title, price) => ({ title, price, currency: "EUR" });

test("stampe: il numero come lo scrive chi vende, senza le lettere di CardTrader", () => {
  assert.equal(baseNumber("OP01-120a"), "OP01-120");
  assert.equal(baseNumber("OP01-120m"), "OP01-120");
  assert.equal(baseNumber("RP01-096sec"), "RP01-096");
  assert.equal(baseNumber("E-128g"), "E-128");
  assert.equal(baseNumber("P-037-foil"), "P-037");
  assert.equal(baseNumber("BT17-135l2"), "BT17-135");
  assert.equal(baseNumber("OP05-119"), "OP05-119");
  assert.equal(baseNumber("206"), "206");
  const u = opUniverse();
  const manga = u.find((p) => p.id === "op:244668");
  assert.equal(manga.number, "OP01-120");
  assert.equal(query(manga), "Shanks OP01-120 one piece"); // con "OP01-120m" eBay non trovava nulla
});

test("stampe: la speciale solo coi titoli che la dicono, la base senza (Shanks OP01-120, Enel OP15-060)", () => {
  const u = opUniverse();
  const p = (id) => u.find((x) => x.id === `op:${id}`);
  const items = [
    eur("Shanks OP01-120 SEC ONE PIECE gioco di carte PRB-01", 2.99),
    eur("One Piece TCG: Shanks SEC OP01-120 Romance Dawn | Near Mint", 4.82),
    eur("one piece Shanks OP01-120", 5.24),
    eur("Shanks OP01-120 Secret Rare ROMANCE DAWN One Piece Japanese Near Mint", 3.27),
    eur("Shanks OP01-120 Alt Art Parallel Romance Dawn One Piece ENG", 85),
    eur("Carta One Piece Shanks OP01-120 SEC Parallela Arte Alternativa", 79),
    eur("Manga Shanks OP01-120  Alt ART - One Piece Card Tcg ENG OP01 Near Mint", 3500),
    eur("OP Shanks (OP01-120) (V.3) Romance Dawn (OP01) 120 Eng NM", 3913.08),
    eur("PSA 10 Shanks OP01-120 SEC Serialized Top Prize Asia Japanese One Piece Card", 5157.95),
    eur("Shanks OP01-120 Serializzato Flagship Battle One Piece Card", 9000),
  ];
  // La Serial Numbered (15.899 € su CardTrader) prima aveva "en|n" 7,99 € su 37 inserzioni: quelle della carta base. Ora solo
  // i titoli che dicono "serial"; quello col premio Flagship è un'altra stampa, che il catalogo non ha.
  assert.deepEqual(bucketPrices(items, p(282240)), { "ja|g:PSA 10": [5157.95, 1] });
  // La carta originale ha una ristampa (PRB-01) che i titoli non distinguono: i titoli senza contrassegni vanno alla ristampa
  // (le più economiche sono le sue) e l'originale resta senza prezzo eBay.
  assert.deepEqual(bucketPrices(items, p(244666)), {});
  assert.deepEqual(bucketPrices(items, p(310650)), { "en|n": [4.82, 3], "ja|n": [3.27, 1] });
  // Alternate Art: "Alt Art", "Parallel" e le traduzioni di eBay; non il Manga né la "V.3" (non si sa quale stampa è).
  assert.deepEqual(bucketPrices(items, p(244667)), { "en|n": [82, 2] });
  // Manga: l'originale e la ristampa non si distinguono, i titoli vanno alla ristampa.
  assert.deepEqual(bucketPrices(items, p(244668)), {});
  assert.deepEqual(bucketPrices(items, p(306600)), { "en|n": [3500, 1] });

  const enel = [
    eur("Enel OP15-060 Super Rare Adventure on Kami's Island One Piece Foil Near Mint", 1.55),
    eur("Enel - OP15-060  - SR One Piece English - NM", 1.9),
    eur("Enel OP15-060 SR JAP NM - One Piece Card", 5.45),
    eur("One Piece Gioco di Carte Enel OP15-060 SR Parallelo Alt Art Avventura sull'Isola di Dio", 256.21),
    eur("Enel SR* OP15-060 One Piece Japanese", 12),
    eur("2026 One Piece Promo Treasure Cup May Top 8 Enel English Promo OP15-060", 3714.55),
    eur("One Piece Enel OP15-060 Premio Evento Usato", 448.98),
  ];
  // La base: né parallele (anche "SR*"), né premi ("Premio Evento": una promo che il catalogo non ha).
  assert.deepEqual(bucketPrices(enel, p(375960)), { "en|n": [1.73, 2], "ja|n": [5.45, 1] });
  assert.deepEqual(bucketPrices(enel, p(375961)), { "en|n": [256.21, 1], "ja|n": [12, 1] });
  assert.deepEqual(bucketPrices(enel, p(375649)), { "en|n": [3714.55, 1] });
  // Una carta con una stampa sola non ha regole: valgono tutti i titoli.
  assert.equal(p(999001).pr, undefined);
  assert.ok(printOk("Koby OP15-061 Alt Art", p(999001)));
});

test("stampe: una versione che non si sa leggere non prende titoli, i numeri distinguono gli eventi", () => {
  const rules = printRules([
    { id: 1, n: "Tashigi", num: "OP14-029", v: null, r: "Rare", s: 1 },
    { id: 2, n: "Tashigi", num: "OP14-029", v: "Dash Pack", r: "Promo", s: 1 },
    { id: 3, n: "Tashigi", num: "OP14-029", v: "Special Rare", r: "Special Rare", s: 2 },
    { id: 4, n: "Tashigi", num: "OP14-029", v: "Championship 2023", r: "Promo", s: 3 },
    { id: 5, n: "Tashigi", num: "OP14-029", v: "Championship 25-26", r: "Promo", s: 3 },
    { id: 6, n: "Tashigi", num: "OP14-029", v: "Pre-Release Stamp", r: "Rare", s: 4 },
    { id: 7, n: "Tashigi", num: "OP14-029", v: "Super Pre-Release Stamp", r: "Rare", s: 4 },
  ], [{ id: 1, name: "OP-14: The Azure Sea's Seven" }]);
  const card = (id) => ({ name: "Tashigi", number: "OP14-029", pr: rules.get(id) });
  assert.deepEqual(rules.get(2), { u: 1 }); // "Dash Pack": nessuna parola che i titoli dicano di sicuro
  assert.ok(!printOk("Tashigi OP14-029 Dash Pack Promo", card(2)));
  assert.ok(printOk("Tashigi OP14-029 R The Azure Sea's Seven NM", card(1)));
  assert.ok(!printOk("Tashigi OP14-029 SP The Azure Sea's Seven", card(1)));
  assert.ok(printOk("Tashigi OP14-029 SP One Piece", card(3)));
  assert.ok(printOk("Tashigi OP14-029 Championship 2023 Promo", card(4)));
  assert.ok(!printOk("Tashigi OP14-029 Championship 2023 Promo", card(5)));
  assert.ok(printOk("Tashigi OP14-029 Campionato 25-26 Promo", card(5)));
  assert.ok(printOk("Tashigi OP14-029 Pre-Release", card(6)));
  assert.ok(!printOk("Tashigi OP14-029 Super Pre-Release", card(6)));
  assert.ok(printOk("Tashigi OP14-029 Super Pre-Release", card(7)));
  // Le parole del nome della carta non sono contrassegni: "Judge" è un personaggio.
  const judge = printRules([
    { id: 1, n: "Vinsmoke Judge", num: "OP06-062", v: null, r: "Leader", s: 1 },
    { id: 2, n: "Vinsmoke Judge", num: "OP06-062a", v: "Alternate Art", r: "Alternate Art", s: 1 },
  ]);
  assert.ok(printOk("Vinsmoke Judge OP06-062 Leader", { name: "Vinsmoke Judge", number: "OP06-062", pr: judge.get(1) }));
});

test("stampe Yu-Gi-Oh!: la rarità scritta nel titolo, e tra l'originale e la ristampa i titoli vanno alla ristampa", () => {
  const cards = [
    { id: 265704, n: "Ash Blossom & Joyous Spring", num: "RA01-008qsec", v: "Quarter Century Secret Rare", r: "Quarter Century Secret Rare", s: 3482, en: [62.52, 1], it: [236.05, 1] },
    { id: 265710, n: "Ash Blossom & Joyous Spring", num: "RA01-008sec", v: "Secret Rare", r: "Secret Rare", s: 3482, en: [5.08, 11], it: [6.14, 1] },
    { id: 265720, n: "Ash Blossom & Joyous Spring", num: "RA01-008u", v: "Ultra Rare", r: "Ultra Rare", s: 3482, en: [4.21, 5], it: [9.88, 2] },
    { id: 265721, n: "Ash Blossom & Joyous Spring", num: "RA01-008", v: "Super Rare", r: "Super Rare", s: 3482, en: [4.27, 2], it: [2.1, 3] },
    { id: 265879, n: "Ash Blossom & Joyous Spring", num: "RA01-008ul", v: "Prismatic Ultimate Rare", r: "Ultimate Rare", s: 3482, en: [13.9, 4], it: [7.14, 1] },
    { id: 74242, n: "Sangan", num: "RP01-036", v: "©1996", r: "Super Rare", s: 1167, en: [106.65, 4], it: [14.41, 26] },
    { id: 298497, n: "Sangan", num: "RP01-036", v: "©2020", r: "Super Rare", s: 3872, en: [10.45, 2] },
  ];
  const sets = [{ id: 3482, name: "25th Anniversary Rarity Collection" }, { id: 1167, name: "Retro Pack" }, { id: 3872, name: "Retro Pack (2024 Reprint)" }];
  const u = buildUniverse({ ct: [{ prefix: "yg:", label: "yu-gi-oh", rarity: true, data: { sets, cards } }] });
  const p = (id) => u.find((x) => x.id === `yg:${id}`);
  // Il catalogo ha carte in italiano: chi non dice la lingua resta in "xx". Una ricerca sola per le cinque rarità.
  assert.equal(p(265704).plain, undefined);
  assert.equal(p(265704).number, "RA01-008");
  assert.equal(new Set([265704, 265710, 265720, 265721, 265879].map((id) => searchKey(p(id)))).size, 1);
  const items = [
    eur("Ash Blossom & Joyous Spring RA01-008 Quarter Century Secret Rare 25th Anniversary Rarity Collection ENG", 70),
    eur("Ash Blossom & Joyous Spring RA01-008 QCSR 1st Edition", 75),
    eur("Ash Blossom & Joyous Spring RA01-008 Rara Segreta ITA", 6),
    eur("Ash Blossom & Joyous Spring RA01-008 Ultra Rare 25th Anniversary Rarity Collection", 5),
    eur("Ash Blossom & Joyous Spring RA01-008 Prismatic Ultimate Rare", 14),
    eur("Ash Blossom & Joyous Spring RA01-008 25th Anniversary Rarity Collection", 3),
  ];
  assert.deepEqual(bucketPrices(items, p(265704)), { "en|n": [70, 1], "xx|1": [75, 1] });
  assert.deepEqual(bucketPrices(items, p(265710)), { "it|n": [6, 1] });
  assert.deepEqual(bucketPrices(items, p(265720)), { "xx|n": [5, 1] });
  assert.deepEqual(bucketPrices(items, p(265879)), { "xx|n": [14, 1] });
  // Senza la rarità nel titolo non si sa quale delle cinque è: di nessuna.
  assert.deepEqual(bucketPrices(items, p(265721)), {});
  // Sangan del 2008 (106 €) e la ristampa del 2024 (10 €): il titolo non dice quale, va alla ristampa.
  const sangan = [eur("Yu-Gi-Oh Sangan RP01-036 Super Rara NM - ITA", 37.1)];
  assert.deepEqual(bucketPrices(sangan, p(74242)), {});
  assert.deepEqual(bucketPrices(sangan, p(298497)), { "it|n": [37.1, 1] });
});

test("Lorcana: ricerca senza il totale del set (col totale del catalogo, 41/217, eBay non trovava nulla)", () => {
  const u = buildUniverse({ ct: [{ prefix: "lc:", label: "lorcana", data: { sets: [{ id: 3469, name: "The First Chapter", n: 217 }], cards: [{ id: 1, n: "Elsa - Snow Queen", num: "41", s: 3469, en: [2.5, 30], it: [2, 12] }] } }] });
  assert.equal(query(u[0]), "Elsa - Snow Queen 41 lorcana");
  assert.ok(matches("Elsa - Snow Queen 41/204 Uncommon The First Chapter Lorcana Near Mint", u[0]));
  assert.ok(!matches("Elsa - Snow Queen 141/204 Lorcana", u[0]));
  assert.deepEqual(bucketPrices([eur("Elsa - Snow Queen 41/204 Uncommon The First Chapter Lorcana Near Mint", 2.56)], u[0]), { "xx|n": [2.56, 1] });
});

test("notte: una ricerca sola per le stampe dello stesso numero, e le voci vecchie dei giochi CardTrader si rifanno", async () => {
  const u = opUniverse();
  const queries = [];
  const ebay = { async search(q) { queries.push(q); return [eur(`${q.replace(" one piece", "")} Alt Art ENG`, 80), eur(`${q.replace(" one piece", "")} SEC`, 5)]; } };
  // La Serial è la più cara: la sua ricerca aggiorna anche le altre cinque stampe di Shanks, che non ne spendono un'altra.
  const state = { "op:999001": { d: 199, b: { "en|n": [1, 40] } } };
  const log = await run({ ebay, universe: u, state, owned: new Set(), today: 200, budget: 2, pauseMs: 0 });
  assert.deepEqual(queries, ["Shanks OP01-120 one piece", "Enel OP15-060 one piece"]);
  assert.equal(Object.keys(state).length, 10);
  assert.deepEqual(state["op:244667"], { d: 200, c: CRITERIO, b: { "en|n": [80, 1] } });
  assert.deepEqual(state["op:282240"], { d: 200, c: CRITERIO, b: {} });
  assert.ok(log.some((l) => /2 ricerche, 9 prodotti aggiornati/.test(l)));
  // Koby ha una voce di ieri col criterio vecchio: per i giochi CardTrader conta come mai cercata (resta dovuta), per le
  // carte Pokémon no (l'app sa leggerla).
  assert.deepEqual(plan(u, state, new Set(), 200).map((p) => p.id), ["op:999001"]);
  assert.deepEqual(plan([{ id: "base1-4", kind: "card", value: 300 }], { "base1-4": { d: 199, b: {} } }, new Set(), 200), []);
  // Le ricerche al giorno contano una volta le stampe che dividono la ricerca.
  assert.equal(dailyDemand(u, new Set()), Math.round(1 / 2 + 1 / 2 + 1 / 180));
});
