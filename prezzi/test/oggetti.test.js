import { test } from "node:test";
import assert from "node:assert/strict";
import { addObjects, seriesPrices, OBJECT_OFFSET, OBJECT_EXP } from "../src/oggetti.js";
import { Ebay, relevant, marketEstimate, marketPrices } from "../src/ebay.js";

test("oggetti da collezione aggiunti al catalogo dei sigillati", () => {
  const sealed = { v: 1, exp: { 5402: "151" }, p: [{ id: 719694, n: "151 Booster", t: "booster", e: 5402, cm: { trend: 23 }, ct: {} }, { id: OBJECT_OFFSET + 1, n: "vecchio", t: "object", e: OBJECT_EXP, cm: null, ct: {} }] };
  const objects = { exp: "Poste Italiane · Zecca dello Stato", oggetti: [{ id: 1, n: "Poké Ball argento", d: "2025-10-08", img: "https://x/a.jpg", listino: 200, note: "Medaglia", ebay: { q: "pokeball medaglia argento pikachu" } }] };
  const out = addObjects(sealed, objects, { 1: [249.9, 7] });
  assert.deepEqual(out.exp, { 5402: "151", [OBJECT_EXP]: "Poste Italiane · Zecca dello Stato" });
  assert.deepEqual(out.p.map((p) => p.id), [719694, OBJECT_OFFSET + 1]); // il vecchio oggetto 1 è sostituito
  assert.deepEqual(out.p[1], { id: OBJECT_OFFSET + 1, n: "Poké Ball argento", t: "object", e: OBJECT_EXP, d: "2025-10-08", img: "https://x/a.jpg", bp: null, cm: { listino: 200, mercato: 249.9, inserzioni: 7 }, ct: {}, note: "Medaglia", q: "pokeball medaglia argento pikachu" });
});

test("prezzo di mercato dalle inserzioni eBay", async () => {
  // Inserzioni reali di eBay.it (ottobre 2026), ridotte: anche un'inserzione dell'oro e una non pertinente.
  const items = [
    { title: "Pokeball medaglia argento Pikachu Poste Italiane IPZS 2025 sigillata", price: 249.9 },
    { title: "Poké Ball Pikachu medaglia d'argento Poste Italiane", price: 279 },
    { title: "PREORDINE MEDAGLIA PIKACHU Pokemon Pokeball 2025 Poste Italiane argento", price: 399.99 },
    { title: "Pokeball medaglia ORO Pikachu Poste Italiane", price: 2990 },
    { title: "Carta Pikachu Poste Italiane folder", price: 15 },
    { title: "Pokeball argento Pikachu Poste", price: 5000 }, // segnaposto
  ];
  const q = { must: ["pokeball|poké ball|poke ball", "argento", "pikachu"], no: ["oro"] };
  assert.deepEqual(relevant(items, q).map((i) => i.price), [249.9, 279, 399.99, 5000]);
  assert.deepEqual(marketEstimate(relevant(items, q)), [279, 3]);
  // Il job: token con le chiavi, poi una ricerca per oggetto.
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.includes("oauth2/token")) {
      assert.equal(opts.headers.Authorization, `Basic ${Buffer.from("app:cert").toString("base64")}`);
      return { ok: true, json: async () => ({ access_token: "tok" }) };
    }
    assert.equal(opts.headers.Authorization, "Bearer tok");
    assert.equal(opts.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_IT");
    return { ok: true, json: async () => ({ itemSummaries: items.map((i) => ({ title: i.title, price: { value: String(i.price), currency: "EUR" }, itemWebUrl: "u" })) }) };
  };
  const log = [];
  const m = await marketPrices(new Ebay({ appId: "app", certId: "cert", fetchFn }), [{ id: 1, ebay: { q: "pokeball argento pikachu poste", ...q } }, { id: 2 }], log);
  assert.deepEqual(m, { 1: [279, 3] });
  assert.equal(calls.length, 2);
  assert.ok(log[0].includes("stima 279"));
});

test("oggetti senza inserzioni: prezzo dagli altri della stessa serie, non il listino", () => {
  // Folder delle città 2021: Roma e Napoli senza inserzioni singole (solo lotti), Firenze 56,25 € e Milano 73,5 €.
  const objects = [
    { id: 3, serie: "folder-citta-2021", listino: 12 },
    { id: 4, serie: "folder-citta-2021", listino: 12 },
    { id: 5, serie: "folder-citta-2021", listino: 12 },
    { id: 6, serie: "folder-citta-2021", listino: 12 },
    { id: 11, listino: 120 },
  ];
  const market = seriesPrices(objects, { 4: [56.25, 2], 6: [73.5, 3] });
  assert.deepEqual(market[3], [64.88, 0, 2]);
  assert.deepEqual(market[5], [64.88, 0, 2]);
  assert.deepEqual(market[4], [56.25, 2]); // chi ha inserzioni tiene le sue
  assert.equal(market[11], undefined); // senza serie: resta il listino
  const out = addObjects({ v: 1, exp: {}, p: [] }, { exp: "Poste", oggetti: [{ id: 3, n: "Roma", listino: 12 }] }, market);
  assert.deepEqual(out.p[0].cm, { listino: 12, mercato: 64.88, inserzioni: 0, serie: 2 });
});

test("inserzioni con più cose in vendita: fuori dalla stima", () => {
  const items = [
    { title: "MEDAGLIA ORO POKEMON POSTE PIKACHU LIMITED EDITION 857/1025 SEALED GOLD MEDAL", price: 4086 },
    { title: "MEDAGLIA ORO POKEMON POSTE ITALIAN PIKACHU. LIMITED EDITION 1000 PEZZI . IN HAND", price: 3576 },
    { title: "Pokemon-Pikachu - Ltd Ed Moneta Oro+Argento Poste Italiane Italy e Ipzs 2025", price: 4045 },
    { title: "Medaglie Pikachu oro e argento insieme Poste Italiane", price: 5200 },
    { title: "Coppia medaglia oro Pikachu Poste", price: 6800 },
    { title: "Lotto 2 medaglia oro Pikachu Poste", price: 6900 },
  ];
  const q = { q: "medaglia oro pikachu", must: ["pikachu", "oro"], no: [] };
  assert.deepEqual(relevant(items, q).map((i) => i.price), [4086, 3576]);
});

test("foto eBay dei sigillati: solo inserzioni del prodotto stesso", async () => {
  const { pickPhoto, photoQuery } = await import("../src/foto-ebay.js");
  const items = [
    { title: "2005 P.M. JPN. Gold Star Mewtwo-Holo #002 Gift Box Mew PSA 3", image: "psa.jpg" },
    { title: "Pokemon Gift Box Mew Lucario Japanese sealed 2005", image: "box.jpg" },
  ];
  assert.equal(pickPhoto(items, "Gift Box Mew • Lucario", null, "ja"), "box.jpg");
  // Una carta singola con il nome del prodotto nel titolo, o un oggetto che non c'entra col gioco: no.
  assert.equal(pickPhoto([{ title: "Aron Holo Gift Box Mew Lucario 2005 Japanese", image: "aron" }], "Gift Box Mew • Lucario"), null);
  assert.equal(pickPhoto([{ title: "Silver deck kit brackets screws", image: "ferro" }], "Silver Deck Kit", /\bpokemon\b/i), null);
  const pack = [
    { title: "Pokemon McDonald's Happy Meal promo pack Wind from the Sea", image: "mcd.jpg" },
    { title: "Pokemon Wind from the Sea booster pack Japanese 1st edition sealed", image: "ok.jpg" },
    { title: "Wind from the Sea booster box", image: "box.jpg" },
  ];
  assert.equal(pickPhoto(pack, "Wind from the Sea Booster", null, "ja"), "ok.jpg");
  // Lingua: il box coreano non è quello giapponese; un gioco per Game Boy non è un prodotto di carte.
  assert.equal(pickPhoto([{ title: "Pokemon Card XY BREAK Awakening Psychic King Booster Box Korean", image: "ko" }], "Awakening Psychic King Booster Box", null, "ja"), null);
  assert.equal(pickPhoto([{ title: "Pokemon Pinball Game Boy Color Rumble boxed", image: "gb" }], "Pokémon Rumble: Game Box"), null);
  // Tipo diverso o lotto: no.
  assert.equal(pickPhoto([{ title: "Gem Pack Vol. 1 booster box sealed", image: "x" }, { title: "lotto 3 Gem Pack Vol 1 booster", image: "y" }], "Gem Pack Vol. 1 Booster"), null);
  assert.equal(photoQuery("Elite Trainer Box", "Prismatic Evolutions"), "Prismatic Evolutions Elite Trainer Box");
  assert.equal(photoQuery("CBB7C: Gem Pack Vol. 7 Booster (Simplified Chinese)", "Simplified Chinese Products"), "CBB7C Gem Pack Vol. 7 Booster");
});

test("foto eBay: nomi scritti in modo diverso, lingua, gioco nella ricerca (0.9.160)", async () => {
  const { pickPhoto, photoQuery, shortQuery, GAME_WORDS } = await import("../src/foto-ebay.js");
  // Accenti, plurali e genitivo, "JP" = "Japanese", "Pre-Release" = "PreRelease".
  assert.equal(pickPhoto([{ title: "2016 Pokemon Japanese PokeKyun Collection Booster Box CP3 Factory Sealed", image: "a" }], "PokéKyun Collection Booster Box", null, "ja"), "a");
  assert.equal(pickPhoto([{ title: "Yugioh 2003 Blue Eyes White Dragon Collectors Tin Factory Sealed Yu-Gi-Oh!TCG", image: "b" }], "Collector's Tins 2003: Blue-Eyes white Dragon", GAME_WORDS["yugioh-sealed"], "en"), "b");
  assert.equal(pickPhoto([{ title: "POKEMON 30TH CELEBRATION JAPANESE BOOSTER BOX CASE OF 12 SEALED", image: "c" }], "30th Celebration JP Booster Box Case", null, "ja"), "c");
  assert.equal(pickPhoto([{ title: "One Piece TCG Super Pre-Release Starter Deck Set ST01-ST04 Sealed", image: "d" }], "Super PreRelease Starter Deck: ST01-ST04: Deck Set", GAME_WORDS["onepiece-sealed"], "en"), "d");
  // "Booster Box Case" = "Booster Case".
  assert.equal(pickPhoto([{ title: "DRAGON BALL SUPER MASTERS Impact Beyond Dimensions Booster Case", image: "e" }], "Impact Beyond Dimension Booster Box Case", GAME_WORDS["dragonball-sealed"], "en"), "e");
  // Prodotto giapponese: niente foto di un'inserzione inglese.
  assert.equal(pickPhoto([{ title: "Bandai Case Dragon Ball Super Fusion World Raging Roar FB03 Booster Box English", image: "en" }], "Raging Roar Booster Box Case", GAME_WORDS["dragonball-sealed"], "ja"), null);
  // Il gioco e la lingua nella ricerca; la seconda ricerca senza il set.
  assert.equal(photoQuery("Special Anniversary Pack", "Masters Promo", "dragonball-sealed"), "Dragon Ball Special Anniversary Pack");
  assert.equal(photoQuery("Magma Gang VS Aqua Gang: Double Crisis Booster Box", "", "sealed", "ja"), "Pokemon Magma Gang VS Aqua Gang Double Crisis Booster Box Japanese");
  assert.equal(shortQuery("Neo Starter Deck", "sealed"), "Pokemon Neo Starter Deck");
});

test("foto eBay: niente nomi generici, lingua scritta per i prodotti asiatici, niente accessori (0.9.160)", async () => {
  const { pickPhoto, GAME_WORDS } = await import("../src/foto-ebay.js");
  const yg = GAME_WORDS["yugioh-sealed"];
  assert.equal(pickPhoto([{ title: "Konami Yu-Gi-Oh! Dark Revelation Vol 1 English Booster Box 2004", image: "x" }], "Vol. 1 Booster Box", yg, "en"), null);
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh Soul of the Duelist Sealed Booster Box 1st Edition", image: "en" }], "Soul of the Duelist (Japanese) Booster Box", yg, "ja"), null);
  assert.equal(pickPhoto([{ title: "Yugioh Soul of the Duelist Japanese Booster Box Sealed", image: "ja" }], "Soul of the Duelist (Japanese) Booster Box", yg, "ja"), "ja");
  assert.equal(pickPhoto([{ title: "GEM MINT Pokémon: Lt. Surge's Pikachu No.025 Gym Booster 1 Leaders' Stadium 1998", image: "c" }], "Leaders' Stadium Booster", null, "ja"), null);
  assert.equal(pickPhoto([{ title: "Mega Gyarados Pokemon Card Sleeves from TCG and Premium Collections", image: "s" }], "Mega Gyarados Collection"), null);
  assert.equal(pickPhoto([{ title: "Pokemon TCG Scarlet & Violet Triplet Beat Booster Box - INCLUDES ACRYLIC CASE", image: "a" }], "Triplet Beat Booster Box Case", null, "ja"), null);
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh! Fire Kings Structure Deck In Opened Pack Of Cards", image: "o" }], "Structure Deck: Fire Kings Card Pack", yg, "en"), null);
});

test("foto eBay: parentesi che dicono il prodotto, codici del set, gradate PSA9 (0.9.160)", async () => {
  const { pickPhoto, GAME_WORDS } = await import("../src/foto-ebay.js");
  const yg = GAME_WORDS["yugioh-sealed"];
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh OCG Duel Monsters 20th anniversary Set", image: "x" }], "20th Anniversary Duel Set (Obelisk the Tormentor)", yg, "en"), null);
  assert.equal(pickPhoto([{ title: "Metal Raiders 1st Edition Booster Pack - Factory Sealed YuGiOh", image: "x" }], "Metal Raiders (Legendary Collection: 25th Anniversary Edition) Booster", yg, "en"), null);
  assert.equal(pickPhoto([{ title: "Bandai One Piece Card Game 3rd Anniversary Set English", image: "x" }], "1st Anniversary Set (English Version)", GAME_WORDS["onepiece-sealed"], "en"), null);
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh! Maximum Gold El Dorado Box - Brand NEW", image: "x" }], "The Gold Box", yg, "en"), null);
  assert.equal(pickPhoto([{ title: "2026 Pokemon Simplified Chinese Happy Combo CSVH6C Factory Sealed", image: "x" }], "CSVH1C: Simplified Chinese Happy Card Set", null, "zh-cn"), null);
  assert.equal(pickPhoto([{ title: "PSA9 Lucario C LV.60 Garchomp Half Deck 2009 Pokemon Card Japanese", image: "x" }], "Garchomp Half Deck", null, "ja"), null);
  // Le parentesi della lingua e dei conteggi non contano.
  assert.equal(pickPhoto([{ title: "ENGLISH Yugioh Dimension Force 12-Box Booster box case", image: "ok" }], "Dimension Force Case (12 Booster Boxes)", yg, "en"), "ok");
});

test("foto eBay: anno diverso, 1ª edizione sui giapponesi e solo contenuto senza scatola", async () => {
  const { pickPhoto } = await import("../src/foto-ebay.js");
  const yg = /\b(yu-?gi-?oh|ygo|konami)\b/i;
  // "Gold Series (Japanese)" del 2008 prendeva la foto della Gold Series 2014.
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh! GOLD SERIES 2014 Booster Pack Japanese sealed", image: "2014" }], "Gold Series (Japanese) Booster", yg, "ja", { date: "2008-03-15" }), null);
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh! Gold Series 2008 Booster Pack Japanese sealed", image: "2008" }], "Gold Series (Japanese) Booster", yg, "ja", { date: "2008-03-15" }), "2008");
  // Un anno nel nome vuole quell'anno.
  assert.equal(pickPhoto([{ title: "Pokemon Collector Chest 2022 Spring sealed", image: "x" }], "Spring 2021 Collector Chest", /pokemon/i), null);
  // Le confezioni OCG non hanno la 1ª edizione: è il box inglese.
  assert.equal(pickPhoto([{ title: "Yu-Gi-Oh Magic Ruler Booster Box 1st Edition Japanese sealed", image: "en" }], "Magic Ruler (Japanese) Booster Box", yg, "ja", { noFirstEdition: true }), null);
  // Solo il mazzo senza scatola: l'inserzione deve dirlo.
  const op = /\bone\s?piece\b/i;
  assert.equal(pickPhoto([{ title: "One Piece Card Game Starter Deck Smoker ST-19 sealed", image: "box" }], "Starter Deck: Smoker Deck Pack", op), null);
  assert.equal(pickPhoto([{ title: "One Piece Card Game Starter Deck Smoker ST-19 deck only no box sealed", image: "deck" }], "Starter Deck: Smoker Deck Pack", op), "deck");
});

test("foto eBay: una busta non prende la foto di un'inserzione che parla di box", async () => {
  const { pickPhoto } = await import("../src/foto-ebay.js");
  // Inserzione vera (7 novembre 2026): la busta CBB7C aveva la foto del box.
  const items = [{ title: "On Hand] Pokémon Chinese CBB7C Gem Pack Vol.7 Booster Sealed Box [Ready to Ship]", image: "box" }];
  assert.equal(pickPhoto(items, "CBB7C: Gem Pack Vol. 7 Booster", /pokemon|pokémon/i, "zh-cn"), null);
  // Il box sì, se il resto torna.
  assert.equal(pickPhoto([{ title: "Pokemon Evolving Skies Booster Pack sealed English", image: "pack" }], "Evolving Skies Booster", /pokemon/i), "pack");
});

test("foto eBay: le foto scelte senza il titolo dell'inserzione si ricontrollano", async () => {
  const { findPhotos } = await import("../src/foto-ebay.js");
  const now = new Date("2026-11-07T12:00:00Z");
  const asked = [];
  const ebay = { search: async (q) => (asked.push(q), [{ title: "Pokemon Evolving Skies Booster Pack sealed English", image: "nuova" }]) };
  const cache = { p: {
    "sealed:1": ["vecchia", "2026-11-04"], // scelta con le regole di prima: si ricontrolla
    "sealed:2": ["tenuta", "2026-11-05", "Pokemon Evolving Skies Booster Pack"], // col titolo: resta fino a 180 giorni
  } };
  const products = [1, 2].map((id) => ({ key: `sealed:${id}`, name: "Evolving Skies Booster", expansion: "", game: "sealed", lang: "en" }));
  await findPhotos(ebay, products, cache, { now });
  assert.equal(asked.length, 1);
  assert.deepEqual(cache.p["sealed:1"], ["nuova", "2026-11-07", "Pokemon Evolving Skies Booster Pack sealed English"]);
  assert.equal(cache.p["sealed:2"][0], "tenuta");
});
