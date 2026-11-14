import { test } from "node:test";
import assert from "node:assert/strict";
import { JA_GROUPS, cardName, covered, fillEmpty, fillEmptyFromSources, findEmpty, groupName, groupsOf, officialRows, skipped, tcgplayerRows } from "../src/asia-vuoti.js";
import { sameSize } from "../src/asia.js";
import { fixedSet, plainProducts, setPrices } from "../src/tcgplayer-ja.js";

const product = (id, name, number, rarity = "Common", extra = {}) => ({
  productId: id, name, extendedData: [{ name: "Number", value: number }, { name: "Rarity", value: rarity }], ...extra,
});
// Gruppi veri di TCGplayer (categoria 85), come li dà tcgcsv.com.
const GROUPS = [
  { groupId: 23893, name: "BW1: Black Collection", abbreviation: "BW1", publishedOn: "2010-12-17T00:00:00" },
  { groupId: 23894, name: "BW1: White Collection", abbreviation: "BW1", publishedOn: "2010-12-17T00:00:00" },
  { groupId: 23896, name: "BW3: Psycho Drive", abbreviation: "BW3", publishedOn: "2011-09-16T00:00:00" },
  { groupId: 23897, name: "BW3: Hail Blizzard", abbreviation: "BW3", publishedOn: "2011-09-16T00:00:00" },
  { groupId: 30001, name: "M9: Set Futuro", abbreviation: "M9", publishedOn: "2027-03-12T00:00:00" },
  { groupId: 30002, name: "M9: Set Futuro (ristampa)", abbreviation: "m9x", publishedOn: "2028-01-01T00:00:00" },
];

test("set che non contano: TCG Pocket e i finti CS fuori dal cinese", () => {
  assert.ok(skipped("A1", "ja") && skipped("P-A", "ko") && skipped("CS1a", "ja") && skipped("CS4Da", "th"));
  assert.ok(!skipped("CS1aC", "zh-cn") && !skipped("BW1b", "ja") && !skipped("SC1a", "id"));
});

test("gruppi TCGplayer di un set giapponese: tabella a mano, poi sigla e data", () => {
  // Black e White Collection hanno la stessa sigla e la stessa data: decide la tabella.
  assert.deepEqual(groupsOf({ id: "BW1b", releaseDate: "2010-12-17" }, GROUPS).map((g) => g.groupId), [23894]);
  assert.deepEqual(groupsOf({ id: "BW1a" }, GROUPS).map((g) => g.groupId), [23893]);
  // Psycho Drive e Hail Blizzard: fino al 12 novembre 2026 un id solo su TCGdex (BW3a), dal 13 due (BW3a e BW3b).
  assert.deepEqual(groupsOf({ id: "BW3a" }, GROUPS).map((g) => g.groupId), [23896]);
  assert.deepEqual(groupsOf({ id: "BW3b" }, GROUPS).map((g) => g.groupId), [23897]);
  // Un set nuovo: l'unico gruppo con la sigla uguale all'id, uscito lo stesso giorno.
  assert.deepEqual(groupsOf({ id: "M9", releaseDate: "2027-03-12" }, GROUPS).map((g) => g.groupId), [30001]);
  assert.equal(groupsOf({ id: "M9", releaseDate: "2026-01-01" }, GROUPS), null);
  // La sigla "BW1" non basta (due gruppi, e sono già della tabella); un set che TCGplayer non ha: niente.
  assert.equal(groupsOf({ id: "BW1" }, GROUPS), null);
  assert.equal(groupsOf({ id: "XYZ9" }, GROUPS), null);
  assert.equal(groupName("WCS23: 2023 World Championships Yokohama Deck: Pikachu"), "2023 World Championships Yokohama Deck: Pikachu");
  assert.equal(fixedSet(23894), "BW1b");
  assert.equal(fixedSet(30001), null);
  assert.deepEqual(JA_GROUPS.BW8a, [23904]);
  assert.deepEqual(JA_GROUPS.BW8b, [23905]);
  assert.equal(fixedSet(23897), "BW3b");
});

test("righe del catalogo dai prodotti TCGplayer", () => {
  assert.equal(cardName("Zekrom - 055/053"), "Zekrom");
  assert.equal(cardName("Pokemon Enterprise - 099/093 (Mirror Holofoil)"), "Pokemon Enterprise (Mirror Holofoil)");
  assert.equal(cardName("Pikachu"), "Pikachu");
  const rows = tcgplayerRows([
    [
      product(12, "Zekrom - 055/053", "055/053", "Super Rare"),
      product(10, "Snivy", "001/053"),
      product(11, "Servine", "002/053", "None", { imageCount: 0 }),
      { productId: 99, name: "White Collection Booster Box", extendedData: [] },
    ],
    [product(20, "Oshawott", "001/052")],
  ]);
  // In ordine di numero dentro ogni gruppo; busta e box (senza numero) fuori; il numero ripetuto prende una lettera.
  assert.deepEqual(rows.map((r) => r[0]), ["001", "002", "055", "001b"]);
  assert.deepEqual(rows[0], ["001", "Snivy", "tp:10", null, "Common", null, null, null, null, null]);
  // Prodotto senza foto su TCGplayer: nessuna foto (non un indirizzo che dà errore); rarità "None" = non scritta.
  assert.equal(rows[1][2], null);
  assert.equal(rows[1][4], null);
  assert.equal(rows[2][1], "Zekrom");
  // Contano solo i numeri da 1 al totale ufficiale, una volta sola: 001 (due volte) e 002.
  assert.equal(covered(rows, 53), 2 / 53);
  assert.equal(covered([["001"], ["002"], ["003"], ["004"]], 4), 1);
});

test("righe dal sito ufficiale, nomi thailandesi presi dall'indonesiano", () => {
  const id = [["001", "Skiddo", "id/id1.webp", "Saya Tsuruta"], ["002", "Gogoat", "id/id2.webp", "n/a"]];
  const idRows = officialRows(id, "https://x/asia/");
  assert.deepEqual(idRows[0], ["001", "Skiddo", "https://x/asia/id/id1.webp", null, null, null, null, null, null, null, "Saya Tsuruta"]);
  assert.equal(idRows[1][10], null);
  const th = [["001", "เมเคิล", "th/th1.webp", "Saya Tsuruta"], ["002", "โกโกท", "", ""], ["003", "ทวินเอนเนอร์จี้", "th/th3.webp", ""]];
  const thRows = officialRows(th, "https://x/asia/", id);
  // Stesso numero in indonesiano: nome in lettere latine; senza, resta quello thailandese. Foto thailandese.
  assert.deepEqual(thRows.map((r) => r[1]), ["Skiddo", "Gogoat", "ทวินเอนเนอร์จี้"]);
  assert.equal(thRows[0][2], "https://x/asia/th/th1.webp");
  assert.equal(thRows[1][2], null);
});

test("set vuoti riempiti: giapponesi da TCGplayer, indonesiani e thailandesi dal sito ufficiale", async () => {
  const data = {
    sets: { ADV1: "exp", "SV4K": "sv4k", "VECCHIO@ja": "tp-VECCHIO" },
    cards: { exp: [["001", "Koffing", "/i.png", 1, null]], sv4k: [["001", "X", null, 2, null]], "tp-VECCHIO": [["001", "Y", "tp:1"]] },
    setEn: { BW1b: "Black Collection" },
    totals: {},
    names: { ja: { "Black Collection": "BW1b" } },
  };
  const empty = [
    { lang: "ja", id: "ADV1", official: 55 }, // già coperto da CardTrader
    { lang: "ja", id: "BW1b", official: 2 },
    { lang: "ja", id: "M9", official: 3, releaseDate: "2027-03-12" }, // set futuro: sigla e data
    { lang: "ja", id: "M10", official: 80, releaseDate: "2027-06-01" }, // nessuna fonte
    { lang: "th", id: "SV4K", official: 66 }, // già coperto (voce senza lingua)
    { lang: "id", id: "SCA", official: 2 },
    { lang: "th", id: "SCA", official: 2 },
    { lang: "th", id: "SCZ", official: 9 }, // il sito non l'ha
  ];
  const products = async (g) => ({
    23894: [product(1, "Snivy", "001/002"), product(2, "Zekrom - 002/002", "002/002")],
    30001: [product(5, "A", "001/003"), product(6, "B", "002/003"), product(7, "C", "003/003")],
  })[g] ?? [];
  const official = { base: "https://x/", sets: { id: { SCA: [["001", "Skiddo", "id/a.webp", ""], ["002", "Gogoat", "id/b.webp", ""]] }, th: { SCA: [["001", "เมเคิล", "th/a.webp", ""], ["002", "โกโกท", "th/b.webp", ""]] } } };
  const log = await fillEmpty(data, { empty, groups: GROUPS, products, official });
  assert.equal(data.sets["BW1b@ja"], "tp-BW1b");
  assert.deepEqual(data.cards["tp-BW1b"].map((r) => r[1]), ["Snivy", "Zekrom"]);
  // Il nome inglese sbagliato di prima (dal codice CardTrader "bw1b") è corretto.
  assert.equal(data.setEn.BW1b, "White Collection");
  assert.equal(data.names.ja["White Collection"], "BW1b");
  assert.equal(data.names.ja["Black Collection"], undefined);
  assert.deepEqual(data.en.BW1b, { 1: "Snivy", 2: "Zekrom" });
  assert.equal(data.totals["BW1b@ja"], 2);
  assert.equal(data.sets["M9@ja"], "tp-M9");
  assert.equal(data.sets["SCA@id"], "uff-id-SCA");
  assert.deepEqual(data.cards["uff-th-SCA"].map((r) => r[1]), ["Skiddo", "Gogoat"]);
  // Le voci di un giro prima che non servono più spariscono; quelle di CardTrader restano.
  assert.equal(data.sets["VECCHIO@ja"], undefined);
  assert.equal(data.cards["tp-VECCHIO"], undefined);
  assert.equal(data.sets.ADV1, "exp");
  // Quello che resta vuoto è scritto nel catalogo e nel registro.
  assert.deepEqual(data.vuoti, ["M10 (ja)", "SCZ (th)"]);
  assert.ok(log.some((l) => /ANCORA VUOTI.*M10 \(ja\), SCZ \(th\)/.test(l)));
  assert.ok(log.some((l) => /già nel catalogo 2, riempiti da TCGplayer 2, dal sito ufficiale 2/.test(l)));
});

test("foto dal sito ufficiale per i set che TCGdex ha con le carte ma senza immagini", async () => {
  const data = { sets: { SVAL: "sval" }, cards: { sval: [["001", "X", "/ct.png", 1, null]] } };
  const official = { base: "https://x/", sets: { "zh-tw": { SI: [["001", "妙蛙種子", "tw/a.webp", ""]], SVAL: [["001", "Y", "tw/b.webp", ""]] } } };
  // Nessun set vuoto: SI non è tra i vuoti (TCGdex ha le carte), ma il sito ufficiale è stato letto per le foto.
  const log = await fillEmpty(data, { empty: [], official });
  assert.equal(data.sets["SI@zh-tw"], "uff-zh-tw-SI");
  assert.equal(data.cards["uff-zh-tw-SI"][0][2], "https://x/tw/a.webp");
  // Un set che il catalogo ha già da CardTrader resta com'è.
  assert.equal(data.sets["SVAL@zh-tw"], undefined);
  assert.deepEqual(data.vuoti, []);
  assert.ok(log.some((l) => /senza foto su TCGdex.*: 1/.test(l)));
});

test("un gruppo trovato da solo con poche carte non si usa", async () => {
  const data = { sets: {}, cards: {} };
  const products = async () => [product(5, "A", "001/100")];
  const log = await fillEmpty(data, { empty: [{ lang: "ja", id: "M9", official: 100, releaseDate: "2027-03-12" }], groups: GROUPS, products });
  assert.equal(data.sets["M9@ja"], undefined);
  assert.deepEqual(data.vuoti, ["M9 (ja)"]);
  assert.ok(log.some((l) => /non usato/.test(l)));
});

test("set vuoti trovati su TCGdex: senza carte o con meno della metà", async () => {
  const pages = {
    "ja/sets": [
      { id: "BW1b", cardCount: { official: 53 } }, { id: "SV9", cardCount: { official: 100 } }, { id: "WCS23", cardCount: { official: 30 } },
      { id: "CS1a", cardCount: { official: 101 } }, { id: "ROTTO", cardCount: { official: 10 } }, { id: "BW1b", cardCount: { official: 53 } },
    ],
    "ja/sets/BW1b": { releaseDate: "2010-12-17", cards: [] },
    "ja/sets/SV9": { cards: Array(120).fill({}) },
    "ja/sets/WCS23": { cards: [{}] },
  };
  const get = async (u) => {
    const k = decodeURIComponent(u.split("/v2/")[1]);
    if (!(k in pages)) throw new Error("404");
    return pages[k];
  };
  const { empty, full } = await findEmpty({ langs: ["ja", "ko"], get });
  assert.deepEqual(empty.map((e) => e.id), ["BW1b", "WCS23"]);
  assert.equal(empty[0].releaseDate, "2010-12-17");
  // Solo i set letti e con le carte sono "pieni": il set non letto e la lingua non letta non lo sono.
  assert.deepEqual([...full], ["SV9@ja"]);
});

test("una fonte non letta non fa tornare vuoto un set riempito prima", async () => {
  const data = {
    sets: { "BW1b@ja": "tp-BW1b", "SCA@id": "uff-id-SCA", "SV9@ja": "tp-SV9" },
    cards: { "tp-BW1b": [["001", "Snivy", "tp:1"]], "uff-id-SCA": [["001", "Skiddo", "u"]], "tp-SV9": [["001", "Z", "tp:9"]] },
  };
  const find = async () => ({ empty: [{ lang: "ja", id: "BW1b", official: 53 }, { lang: "id", id: "SCA", official: 135 }], full: new Set(["SV9@ja"]) });
  const get = async () => {
    throw new Error("rete");
  };
  const log = await fillEmptyFromSources(data, { find, get });
  assert.equal(data.sets["BW1b@ja"], "tp-BW1b");
  assert.equal(data.sets["SCA@id"], "uff-id-SCA");
  assert.equal(data.cards["uff-id-SCA"].length, 1);
  // SV9 su TCGdex ora ha le carte: la voce del giro prima se ne va.
  assert.equal(data.sets["SV9@ja"], undefined);
  assert.deepEqual(data.vuoti, []);
  assert.ok(log.some((l) => /tenuti dal giro prima.*2/.test(l)));
  assert.ok(log.at(-1).startsWith("Nessun set vuoto"));
});

test("un codice CardTrader indovinato vale solo se l'espansione ha le carte del set", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => [String(i + 1).padStart(3, "0"), "x"]);
  // "ds" su CardTrader è EX Delta Species (114 carte), DS di TCGdex è Dragon Selection (20).
  assert.ok(!sameSize(rows(114), 20));
  assert.ok(sameSize(rows(56), 53));
  assert.ok(sameSize(rows(20), 20));
  assert.ok(!sameSize(rows(10), 53));
  assert.ok(!sameSize([], 53));
});

test("prezzi TCGplayer: tra una carta e la sua versione speciale vale la carta", () => {
  const products = [
    product(1, "Zekrom - 095/093", "095/093"),
    product(2, "Zekrom - 095/093 (Mirror Holofoil)", "095/093"),
    product(3, "Snivy (A)", "001/093"),
    product(4, "Snivy (B)", "001/093"),
    product(5, "Servine", "002/093"),
  ];
  // Due versioni speciali senza la carta semplice: non si sa quale sia, restano tutte e due (e poi il numero si salta).
  assert.deepEqual(plainProducts(products).map((p) => p.productId), [1, 3, 4, 5]);
  const prices = [1, 2, 3, 4, 5].map((id) => ({ productId: id, subTypeName: "Normal", marketPrice: id * 10 }));
  const ids = {};
  const out = setPrices(products, prices, 1, null, ids, true);
  assert.deepEqual(out, { 95: [10, null], 2: [50, null] });
  assert.deepEqual(ids, { 95: 1, 2: 5 });
  // Senza la regola (gli altri set): il numero con due prodotti resta senza prezzo, come prima.
  assert.deepEqual(setPrices(products, prices, 1, null), { 2: [50, null] });
});
