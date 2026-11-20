import test from "node:test";
import assert from "node:assert/strict";
import { numberKey, tpExtra, ctExtra, tpIndex, matchTp, addTcgplayerIds, rarityKey, addMarketPrices, marketOf, saysPrint, uniqueLinks, sameCardName, onePieceExtraOk, extraSaid, yugiohExtraOk } from "../src/tcgplayer-ct.js";

const prod = (id, name, number) => ({ productId: id, name, extendedData: [{ name: "Number", value: number }, { name: "Rarity", value: "L" }] });

test("chiavi dei numeri e parole della stampa", () => {
  assert.equal(numberKey("onepiece", "OP01-003b"), "op01-003");
  assert.equal(numberKey("dragonball", "FB01-066"), "fb01-066");
  assert.equal(numberKey("dragonball", "SD1-01"), "sd1-01");
  assert.equal(numberKey("lorcana", "1/204"), "001");
  assert.equal(numberKey("lorcana", "207"), "207");
  assert.equal(numberKey("onepiece", ""), null);
  assert.deepEqual([...tpExtra("Monkey.D.Luffy (003) (Parallel)")], ["parallel"]);
  assert.deepEqual([...tpExtra("Trunks : Future - FB01-049 (Dragon Ball Z Dokkan Battle Alternate Art)")], ["dragon", "ball", "z", "dokkan", "battle", "alternate", "art"]);
  assert.deepEqual([...ctExtra({ num: "OP01-003b", v: null })], ["parallel"]);
  assert.deepEqual([...ctExtra({ num: "OP01-003", v: "Alternate Art | Fixed Reprint" })], ["alternate", "art", "fixed", "reprint"]);
});

test("One Piece e Dragon Ball: stesso numero, stampa base o alternate art", () => {
  const groups = [{ groupId: 3188, name: "Romance Dawn" }, { groupId: 23401, name: "Awakened Pulse" }, { groupId: 23505, name: "Awakened Pulse Alternate Art Reprints" }];
  const products = {
    3188: [prod(453506, "Monkey.D.Luffy (003) (Parallel)", "OP01-003"), prod(453600, "Monkey.D.Luffy (003)", "OP01-003"), prod(453505, "Trafalgar Law (002)", "OP01-002"), prod(453507, "Cavendish (Box Topper)", "OP01-008")],
    23401: [prod(547000, "Final Hope Slash", "FB01-066"), prod(547001, "Trunks : Future - FB01-049", "FB01-049")],
    23505: [prod(547749, "Final Hope Slash (Alternate Art)", "FB01-066"), prod(562371, "Trunks : Future - FB01-049 (Alternate Art)", "FB01-049"), prod(562399, "Trunks : Future - FB01-049 (Dragon Ball Z Dokkan Battle Alternate Art)", "FB01-049")],
  };
  const op = tpIndex("onepiece", groups.slice(0, 1), (g) => products[g]);
  assert.deepEqual(matchTp("onepiece", { n: "Monkey.D.Luffy", num: "OP01-003", v: null }, op), [453600, 3188]);
  assert.deepEqual(matchTp("onepiece", { n: "Monkey.D.Luffy", num: "OP01-003b", v: "Alternate Art" }, op), [453506, 3188]);
  assert.deepEqual(matchTp("onepiece", { n: "Trafalgar Law", num: "OP01-002", v: null }, op), [453505, 3188]);
  // La carta base del Box Topper non c'è su TCGplayer (solo la stampa speciale): niente.
  assert.equal(matchTp("onepiece", { n: "Cavendish", num: "OP01-008", v: null }, op), null);
  assert.equal(matchTp("onepiece", { n: "Nami", num: "OP01-999", v: null }, op), null);
  // Ristampa dello stesso numero in un altro gruppo TCGplayer: decide il set CardTrader ("OP-01: Romance Dawn" ~ "Romance Dawn").
  const reprints = [{ groupId: 3188, name: "Romance Dawn" }, { groupId: 9999, name: "Premium Card Collection - Best Selection" }];
  const op2 = tpIndex("onepiece", reprints, (g) => (g === 3188 ? products[3188] : [prod(900000, "Trafalgar Law (002)", "OP01-002")]));
  assert.deepEqual(matchTp("onepiece", { n: "Trafalgar Law", num: "OP01-002", v: null }, op2, "OP-01: Romance Dawn"), [453505, 3188]);
  assert.deepEqual(matchTp("onepiece", { n: "Trafalgar Law", num: "OP01-002", v: null }, op2, "Premium Card Collection"), [900000, 9999]);
  assert.equal(matchTp("onepiece", { n: "Trafalgar Law", num: "OP01-002", v: null }, op2, "Altro"), null);
  // "Super Rare" su CardTrader è la rarità, non una stampa speciale: carta base.
  assert.deepEqual(matchTp("onepiece", { n: "Trafalgar Law", num: "OP01-002", v: "Super Rare" }, op), [453505, 3188]);
  const db = tpIndex("dragonball", groups.slice(1), (g) => products[g]);
  assert.deepEqual(matchTp("dragonball", { n: "Final Hope Slash", num: "FB01-066", v: null }, db), [547000, 23401]);
  assert.deepEqual(matchTp("dragonball", { n: "Final Hope Slash", num: "FB01-066", v: "Alternate Art" }, db), [547749, 23505]);
  // Due alternate art diverse: quella con più parole in comune ("Dokkan Battle"); senza, niente.
  assert.deepEqual(matchTp("dragonball", { n: "Trunks : Future", num: "FB01-049", v: "Dragon Ball Z Dokkan Battle Alternate Art" }, db), [562399, 23505]);
  assert.deepEqual(matchTp("dragonball", { n: "Trunks : Future", num: "FB01-049", v: "Alternate Art" }, db), [562371, 23505]);
});

test("Lorcana: numero + nome, e il set quando la carta è ristampata", () => {
  const groups = [{ groupId: 22968, name: "The First Chapter" }, { groupId: 24740, name: "Hyperia City" }];
  const products = {
    22968: [prod(100, "Elsa - Snow Queen", "41/204"), prod(101, "Mickey Mouse - Wayward Sorcerer", "208/204")],
    24740: [prod(200, "Fru Fru - VIP Guest", "1/204"), prod(201, "Elsa - Snow Queen", "41/204")],
  };
  const lc = tpIndex("lorcana", groups, (g) => products[g]);
  assert.deepEqual(matchTp("lorcana", { n: "Mickey Mouse - Wayward Sorcerer", num: "208", v: "Enchanted" }, lc), [101, 22968]);
  assert.deepEqual(matchTp("lorcana", { n: "Fru Fru - VIP Guest", num: "001", v: null }, lc), [200, 24740]);
  // Elsa 41 in due set: decide il set CardTrader.
  assert.deepEqual(matchTp("lorcana", { n: "Elsa - Snow Queen", num: "041", v: null }, lc, "The First Chapter"), [100, 22968]);
  assert.equal(matchTp("lorcana", { n: "Elsa - Snow Queen", num: "041", v: null }, lc, "Promos Year 1"), null);
  assert.equal(matchTp("lorcana", { n: "Elsa - Spirit of Winter", num: "041", v: null }, lc), null);
});

test("addTcgplayerIds scrive tp nelle carte del catalogo", async () => {
  const fetchJson = async (url) => {
    if (url.endsWith("/68/groups")) return { results: [{ groupId: 3188, name: "Romance Dawn" }] };
    if (url.endsWith("/68/3188/products")) return { results: [prod(453505, "Trafalgar Law (002)", "OP01-002")] };
    // Il prezzo di mercato anche per One Piece (punto 4 della riverifica, 19 novembre 2026: prima solo Yu-Gi-Oh!).
    if (url.endsWith("/68/3188/prices")) return { results: [{ productId: 453505, subTypeName: "Normal", marketPrice: 0.25, lowPrice: 0.1 }] };
    throw new Error(`url inattesa ${url}`);
  };
  const data = { sets: [{ id: 3332, name: "OP-01: Romance Dawn" }], cards: [{ id: 1, n: "Trafalgar Law", num: "OP01-002", s: 3332 }, { id: 2, n: "Nami", num: "OP01-016", s: 3332, tp: [9, 9] }] };
  const log = [];
  assert.equal(await addTcgplayerIds("onepiece", data, { fetchJson, log }), 1);
  assert.deepEqual(data.cards[0].tp, [453505, 3188]);
  assert.deepEqual(data.cards[0].tm, [0.25, 0]);
  assert.equal(data.cards[1].tp, undefined); // un abbinamento vecchio che non regge più sparisce
  assert.ok(log.some((l) => l.includes("1 carte su 2")));
});

test("Yu-Gi-Oh!: numeri con la regione e senza, codice del set dal catalogo", async () => {
  const { yugiohKey } = await import("../src/onepiece.js");
  assert.equal(yugiohKey("MP16-EN198"), "mp16-198");
  assert.equal(yugiohKey("LOB-EN001"), "lob-001");
  assert.equal(yugiohKey("AST-009"), "ast-009");
  assert.equal(yugiohKey("CIBR-ENSE4"), "cibr-se4");
  assert.equal(yugiohKey("LOB-DE001"), "lob-001");
  assert.equal(yugiohKey("SDD-E003"), "sdd-003"); // prime stampe europee: regione di una lettera
  assert.equal(yugiohKey("MRD-143sec"), "mrd-143"); // stampa di CardTrader dopo il numero
  assert.equal(yugiohKey("001", "lob"), "lob-001"); // blueprint CardTrader: solo il numero, il set dall'espansione
  assert.equal(yugiohKey("001", "cibr-jp"), "cibr-001"); // OCG: stesso codice del set TCG
  assert.equal(yugiohKey("001"), null);
  assert.equal(numberKey("yugioh", "LOB-EN001"), "lob-001");
});

test("Yu-Gi-Oh!: il gruppo col nome più vicino al set, la rarità, il nome del set quando il codice è un altro", async () => {
  // 10 novembre 2026: 17.306 carte Yu-Gi-Oh! su 46.947 senza prodotto TCGplayer (senza storico dal 2024), tra cui tutti i set
  // più famosi. Dati veri di tcgcsv: lo stesso numero sta in più gruppi (originale, "Worldwide English", "25th Anniversary
  // Edition") e ogni rarità della stessa carta è un prodotto a sé. Con le regole nuove: 41.893 collegate, 375 tolte (300
  // erano un'altra carta con lo stesso numero).
  const yg = (id, name, number, rarity) => ({ productId: id, name, extendedData: [{ name: "Number", value: number }, { name: "Rarity", value: rarity }] });
  const groups = [
    { groupId: 330, name: "The Legend of Blue Eyes White Dragon" },
    { groupId: 22881, name: "Legend of Blue Eyes White Dragon (Worldwide English)" },
    { groupId: 23050, name: "Legend of Blue Eyes White Dragon (25th Anniversary Edition)" },
    { groupId: 23891, name: "Quarter Century Stampede" },
    { groupId: 575, name: "Battle Pack: Epic Dawn" },
    { groupId: 2700, name: "Speed Duel: Battle City Box" },
    { groupId: 255, name: "Spell Ruler" },
    { groupId: 256, name: "Labyrinth of Nightmare" },
    { groupId: 257, name: "Rise of Destiny" },
  ];
  const products = {
    330: [yg(1, "Blue-Eyes White Dragon", "LOB-001", "Ultra Rare")],
    22881: [yg(2, "Blue-Eyes White Dragon", "LOB-EN001", "Ultra Rare")],
    23050: [yg(3, "Blue-Eyes White Dragon", "LOB-EN001", "Ultra Rare")],
    23891: [
      yg(10, "Mystic Piper", "RA04-EN005", "Super Rare"), yg(11, "Mystic Piper (UR)", "RA04-EN005", "Ultra Rare"),
      yg(12, "Mystic Piper (Secret Rare)", "RA04-EN005", "Secret Rare"), yg(13, "Mystic Piper (Quarter Century Secret Rare)", "RA04-EN005", "Quarter Century Secret Rare"),
      yg(14, "Mystic Piper (PCR)", "RA04-EN005", "Prismatic Collector's Rare"), yg(15, "Mystic Piper (PUR)", "RA04-EN005", "Prismatic Ultimate Rare"),
    ],
    575: [yg(20, "Witch of the Black Forest", "BP01-EN001", "Rare"), yg(21, "Witch of the Black Forest (Starfoil)", "BP01-EN001", "Starfoil Rare")],
    2700: [yg(30, "Dark Magician", "SBCB-EN001", "Common"), yg(31, "Dark Magician (Secret)", "SBCB-EN001", "Secret Rare"), yg(32, "Fury of Thunder", "SBCB-EN101", "Common")],
    255: [yg(40, "Serpent Night Dragon", "SRL-103", "Secret Rare")],
    256: [yg(41, "Marie the Fallen One", "LON-046", "Rare")],
    257: [yg(42, "Bokoichi the Freightening Car", "RDS-EN003", "Common")],
  };
  const index = tpIndex("yugioh", groups, (id) => products[id]);
  const m = (card, set) => matchTp("yugioh", card, index, set);
  // Lo stesso numero in tre gruppi: l'originale per il set originale, la ristampa per la ristampa (che su CardTrader ha
  // un codice suo, "LOB25": si trova dal nome del set).
  assert.deepEqual(m({ n: "Blue-Eyes White Dragon", num: "LOB-001", r: "Ultra Rare", v: "©1996" }, "Legend of Blue Eyes White Dragon"), [1, 330]);
  assert.deepEqual(m({ n: "Blue-Eyes White Dragon", num: "LOB25-001", r: "Ultra Rare", v: "©2020" }, "Legend of Blue Eyes White Dragon (25th Anniversary Edition)"), [3, 23050]);
  // Una rarità per prodotto: Rarity Collection (TCGplayer scrive "Prismatic…" dove CardTrader no) e Battle Pack.
  const piper = (num, r) => m({ n: "Mystic Piper", num, r, v: r }, "Quarter Century Stampede");
  assert.deepEqual(piper("RA04-005", "Super Rare"), [10, 23891]);
  assert.deepEqual(piper("RA04-005u", "Ultra Rare"), [11, 23891]);
  assert.deepEqual(piper("RA04-005qsec", "Quarter Century Secret Rare"), [13, 23891]);
  assert.deepEqual(piper("RA04-005cr", "Collector's Rare Rare"), [14, 23891]);
  assert.deepEqual(piper("RA04-005ul", "Ultimate Rare"), [15, 23891]);
  assert.equal(rarityKey("Prismatic Collector's Rare"), rarityKey("Collector's Rare Rare"));
  assert.equal(rarityKey("Common / Short Print"), "common");
  assert.deepEqual(m({ n: "Witch of the Black Forest", num: "BP01-001", r: "Rare" }, "Battle Pack: Epic Dawn"), [20, 575]);
  assert.deepEqual(m({ n: "Witch of the Black Forest", num: "BP01-001st", r: "Starfoil Rare" }, "Battle Pack: Epic Dawn"), [21, 575]);
  // Il codice del set di CardTrader ("SBBC") non è quello stampato ("SBCB"): stesso gruppo per nome, stesse cifre, stesso nome.
  assert.deepEqual(m({ n: "Dark Magician", num: "SBBC-001", r: "Common" }, "Speed Duel: Battle City Box"), [30, 2700]);
  assert.deepEqual(m({ n: "Dark Magician", num: "SBBC-001sec", r: "Secret Rare" }, "Speed Duel: Battle City Box"), [31, 2700]);
  assert.equal(m({ n: "Fury of Thunder", num: "SBBC-001", r: "Common" }, "Speed Duel: Battle City Box"), null); // altre cifre
  // Un'altra carta con lo stesso numero non è la carta: nome e rarità diversi, niente (prima si collegavano: RDS-ENSE3
  // "Judgment of Anubis" prendeva lo storico di RDS-EN003 "Bokoichi").
  assert.equal(m({ n: "Beaver Warrior", num: "SRL-103", r: "Common" }, "Spell Ruler"), null);
  assert.equal(m({ n: "Judgment of Anubis", num: "RDS-003", r: "Ultra Rare" }, "Rise of Destiny"), null);
  // Una carta rinominata sì: stesso numero e stessa rarità.
  assert.deepEqual(m({ n: "Darklord Marie", num: "LON-046", r: "Rare" }, "Labyrinth of Nightmare"), [41, 256]);
});

test("Dragon Ball: tra il gruppo del set e quello delle sue promo, il set", () => {
  // "Vermilion Bloodline" e "Vermilion Bloodline: Pre-Release Promos" hanno gli stessi numeri: la regola del nome contenuto
  // li accettava tutti e due e il set intero restava senza prodotto (10 novembre 2026: 1.691 carte, sui dati veri di tcgcsv).
  const groups = [{ groupId: 2630, name: "Vermilion Bloodline" }, { groupId: 2631, name: "Vermilion Bloodline: Pre-Release Promos" }];
  const products = {
    2630: [prod(1, "Goliamite, Beast of the Planet Vampa", "BT11-020")],
    2631: [prod(2, "Goliamite, Beast of the Planet Vampa", "BT11-020")],
  };
  const index = tpIndex("dragonball", groups, (id) => products[id]);
  assert.deepEqual(matchTp("dragonball", { n: "Goliamite, Beast of the Planet Vampa", num: "BT11-020", v: null }, index, "Vermilion Bloodline"), [1, 2630]);
  assert.deepEqual(matchTp("dragonball", { n: "Goliamite, Beast of the Planet Vampa", num: "BT11-020", v: null }, index, "Vermilion Bloodline: Pre-Release Promos"), [2, 2631]);
  // Un set che non ha un gruppo con lo stesso nome resta com'era: nel dubbio niente.
  assert.equal(matchTp("dragonball", { n: "Goliamite, Beast of the Planet Vampa", num: "BT11-020", v: null }, index, "Vermilion"), null);
});

test("Yu-Gi-Oh!: prezzo di mercato TCGplayer unlimited e 1ª edizione (campo tm)", () => {
  const prices = addMarketPrices(new Map(), [
    { productId: 1, subTypeName: "1st Edition", marketPrice: 12.345 },
    { productId: 1, subTypeName: "Unlimited", marketPrice: 3.1 },
    { productId: 2, subTypeName: "Limited", marketPrice: 5 },
    { productId: 3, subTypeName: "1st Edition", marketPrice: null, midPrice: 50 },
    { productId: 4, subTypeName: "Unlimited", marketPrice: 0 },
  ]);
  assert.deepEqual(marketOf(prices.get(1)), [3.1, 12.35]);
  assert.deepEqual(marketOf(prices.get(2)), [5, 0]); // "Limited" al posto dell'unlimited
  assert.equal(marketOf(prices.get(3)), null); // senza vendite (solo il prezzo medio) nessun prezzo
  assert.equal(marketOf(prices.get(4)), null);
});

test("stampe speciali solo col loro nome, un prodotto per una carta sola (A14)", () => {
  const groups = [{ groupId: 1, name: "Romance Dawn" }, { groupId: 2, name: "Premium Booster" }];
  const products = {
    1: [prod(10, "Portgas.D.Ace (118)", "OP02-118"), prod(11, "Portgas.D.Ace (118) (Manga)", "OP02-118"), prod(20, "Sabo (SP)", "OP05-007")],
    2: [prod(30, "Shanks", "ST01-001")],
  };
  const op = tpIndex("onepiece", groups, (g) => products[g]);
  // Special Rare: senza "SP" o "Special" nel nome del prodotto niente collegamento (prima prendeva la carta base).
  assert.equal(matchTp("onepiece", { n: "Portgas.D.Ace", num: "OP02-118", r: "Special Rare", v: "Special Rare" }, op), null);
  assert.ok(saysPrint({ r: "Special Rare", v: "Special Rare" }, { name: "Sabo (SP)" }));
  // Manga Panel: solo col prodotto che dice "Manga".
  assert.deepEqual(matchTp("onepiece", { n: "Portgas.D.Ace", num: "OP02-118b", r: "Alternate Art", v: "Manga Panel Alternate Art" }, op), [11, 1]);
  assert.ok(!saysPrint({ v: "Alternate Art | Pre-Errata Card" }, { name: "Shanks (Alternate Art)" }));
  // Due carte con lo stesso prodotto: lo tiene quella con le stesse parole di stampa, a parità quella del set del gruppo.
  const base = { id: 1, n: "Portgas.D.Ace", num: "OP02-118", s: 100 };
  const stamp = { id: 2, n: "Portgas.D.Ace", num: "OP02-118", v: "Pre-Release Stamp", s: 100 };
  const links = new Map([[base, [10, 1]], [stamp, [10, 1]]]);
  const kept = uniqueLinks(links, op, new Map([[100, "Romance Dawn"]]));
  assert.deepEqual(kept.get(base), [10, 1]);
  assert.equal(kept.get(stamp), null);
  // Due segnalini uguali (Gold e Silver con lo stesso prodotto, nessuno lo dice): nessuno dei due.
  const gold = { id: 3, n: "Shanks", num: "ST01-001", v: "Gold", s: 200 };
  const silver = { id: 4, n: "Shanks", num: "ST01-001", v: "Silver", s: 200 };
  const k2 = uniqueLinks(new Map([[gold, [30, 2]], [silver, [30, 2]]]), op, new Map([[200, "Premium Booster"]]));
  assert.equal(k2.get(gold), null);
  assert.equal(k2.get(silver), null);
});


test("A2: prezzo di mercato sotto un terzo dell'inserzione più economica = nessun prezzo di mercato (Winged Kuriboh TLM-005)", () => {
  // Prezzi tcgcsv veri del 19 novembre 2026: Winged Kuriboh (UTR) TLM-EN005, prodotto 58737; Pot of Avarice (UTR) EEN-EN037, 58619.
  const prices = addMarketPrices(new Map(), [
    { productId: 58737, subTypeName: "Unlimited", marketPrice: 0.49, lowPrice: 89.93 },
    { productId: 58737, subTypeName: "1st Edition", marketPrice: 145.69, lowPrice: 95.0 },
    { productId: 58619, subTypeName: "Unlimited", marketPrice: 1.9, lowPrice: 107.66 },
    { productId: 58619, subTypeName: "1st Edition", marketPrice: 181.56, lowPrice: 101.61 },
    // Carta da centesimi: la più economica a 0,25 $ per il prezzo minimo dei venditori, il mercato vale.
    { productId: 1, subTypeName: "Unlimited", marketPrice: 0.1, lowPrice: 0.25 },
  ]);
  assert.deepEqual(marketOf(prices.get(58737)), [0, 145.69]);
  assert.deepEqual(marketOf(prices.get(58619)), [0, 181.56]);
  assert.deepEqual(marketOf(prices.get(1)), [0.1, 0]);
  assert.equal(prices.skipped, 2);
});

test("A7: il prodotto TCGplayer deve avere il nome della carta (stesso numero, set numerati diversamente)", () => {
  const groups = [
    { groupId: 2645, name: "Universal Onslaught" }, { groupId: 3, name: "Two Legends" }, { groupId: 4, name: "Energy Markers" },
    { groupId: 5, name: "Romance Dawn" },
  ];
  const products = {
    // Dragon Ball BT15: TCGplayer numera BT15-039 "Cabba, Saiyan Pride" (sul catalogo CardTrader è la BT15-040).
    2645: [prod(1, "Cabba, Saiyan Pride", "BT15-039"), prod(2, "Sorbe // Frieza, Resurrected Emperor", "BT5-080")],
    // One Piece OP09: "Bonk Punch (Reprint)" ha il numero OP09-010 come l'alternate art di Buggy.
    3: [prod(10, "Bonk Punch (Reprint)", "OP09-010")],
    4: [prod(20, "Energy Marker (E-31)", "E-31")],
    5: [prod(30, "Shanks (Parallel) (Manga) (Alternate Art)", "OP01-120"), prod(31, "Shanks (Parallel)", "OP01-120"), prod(32, "Gloriosa (Grandma Nyon)", "OP07-041")],
  };
  const db = tpIndex("dragonball", groups, (g) => products[g]);
  const op = tpIndex("onepiece", groups, (g) => products[g]);
  assert.equal(matchTp("dragonball", { n: "SS Cabba, Universe 6 Combination", num: "BT15-039", v: null }, db), null);
  // Lo stesso nome scritto un po' diverso vale ancora.
  assert.deepEqual(matchTp("dragonball", { n: "Sorbet // Frieza, Resurrected Emperor", num: "BT5-080", v: null }, db), [2, 2645]);
  assert.deepEqual(matchTp("dragonball", { n: "\"Gogeta\" Energy Marker", num: "E-31", v: "E-31" }, db), [20, 4]);
  assert.equal(matchTp("onepiece", { n: "Buggy", num: "OP09-010a", r: "Alternate Art", v: "Alternate Art" }, op), null);
  // L'alternate art di Shanks: il prodotto "Parallel", non quello "Manga" (prima 80,52 € collegata a un prodotto da 3.645 $).
  assert.deepEqual(matchTp("onepiece", { n: "Shanks", num: "OP01-120a", r: "Alternate Art", v: "Alternate Art" }, op), [31, 5]);
  assert.ok(!onePieceExtraOk({ n: "Roronoa Zoro", num: "OP07-034", r: "Uncommon", v: "Pre-Release Stamp" }, { name: "Roronoa Zoro (Reprint)" }));
  assert.ok(sameCardName({ n: "Gloriosa (Grandma Nyon)" }, { name: "Gloriosa (Grandma Nyon)" }));
  assert.ok(sameCardName({ n: "Cooler, Calculated Warrior" }, { name: "Cooler, Calculating Warrior" }));
  assert.ok(!sameCardName({ n: "Frieza, Army Reborn" }, { name: "Wish to Porunga" }));
});

test("A7: Yu-Gi-Oh!, un prodotto col nome di un'altra carta dello stesso set non va a questa (LART-064 / LART-065)", async () => {
  const data = {
    sets: [{ id: 1, name: "The Lost Art Promotion" }],
    cards: [
      { id: 1, n: "Macro Cosmos", num: "LART-064", r: "Ultra Rare", s: 1 },
      { id: 2, n: "Masked Ninja Ebisu", num: "LART-065", r: "Ultra Rare", s: 1 },
      { id: 3, n: "Darklord Marie", num: "LON-046", r: "Rare", s: 2 },
    ],
  };
  const rp = (id, name, number, rarity) => ({ productId: id, name, extendedData: [{ name: "Number", value: number }, { name: "Rarity", value: rarity }] });
  const files = {
    "2/groups": { results: [{ groupId: 7, name: "The Lost Art Promotion" }, { groupId: 8, name: "Labyrinth of Nightmare" }] },
    "2/7/products": { results: [rp(64, "Masked Ninja Ebisu", "LART-EN064", "Ultra Rare"), rp(65, "Macro Cosmos", "LART-EN065", "Ultra Rare")] },
    "2/8/products": { results: [rp(46, "Marie the Fallen One", "LON-046", "Rare")] },
    "2/7/prices": { results: [] },
    "2/8/prices": { results: [] },
  };
  const fetchJson = async (url) => files[url.replace(/^.*tcgplayer\//, "")];
  data.sets.push({ id: 2, name: "Labyrinth of Nightmare" });
  await addTcgplayerIds("yugioh", data, { fetchJson });
  assert.equal(data.cards[0].tp, undefined);
  assert.equal(data.cards[1].tp, undefined);
  // Una carta rinominata (stessa rarità, nome di nessun'altra carta del set) resta collegata.
  assert.deepEqual(data.cards[2].tp, [46, 8]);
});

test("controllo finale: stampe speciali e prodotti di edizioni speciali (casi veri del 19 novembre 2026)", () => {
  const p = (name, groupName = "") => ({ name, groupName });
  // Carta del set senza versione: niente prodotto di un'edizione speciale con lo stesso numero.
  assert.ok(!extraSaid({ n: "Who's.Who", num: "ST04-010", r: "Common" }, p("Who's.Who (CS 2023 Celebration Pack)")));
  assert.ok(!extraSaid({ n: "Boa Hancock", num: "ST03-013", r: "Common" }, p("Boa Hancock (Premium Card Collection -Best Selection Vol. 2-)")));
  // ...ma la carta di quell'edizione sì, e le parentesi del nome della carta non contano come edizione.
  assert.ok(extraSaid({ n: "Who's.Who", num: "ST04-010", r: "Common", v: "Championship 2023 | Celebration Pack" }, p("Who's.Who (CS 2023 Celebration Pack)")));
  assert.ok(extraSaid({ n: "Mr.1(Daz.Bonez)", num: "OP01-083", r: "Rare" }, p("Mr.1 (Daz.Bonez)")));
  // Dragon Ball: "(SPR)" è la Special Rare, non la Super Rare con lo stesso numero; i colori non sono un'edizione.
  assert.ok(!extraSaid({ n: "Cell Explosive Terror", num: "BT26-111", r: "Super Rare" }, p("Cell, Explosive Terror (SPR)")));
  assert.ok(extraSaid({ n: "Cell, Explosive Terror", num: "BT26-111sp", r: "Special Rare", v: "Special Rare" }, p("Cell, Explosive Terror (SPR)")));
  assert.ok(extraSaid({ n: "Son Gohan", num: "BT11-076", r: "Common" }, p("Son Gohan (Green)")));
  // Una Treasure Rare non è la "(Reprint)"; un'alternate art prende il prodotto della sua serie di alternate art.
  assert.ok(!extraSaid({ n: "Lucky.Roux", num: "OP09-015tr", r: "Treasure Rare", v: "Treasure Rare" }, p("Lucky.Roux (Reprint)")));
  assert.ok(extraSaid({ n: "Kingdew", num: "OP17-006a", r: "Alternate Art", v: "Alternate Art" }, p("Kingdew (Pandaman Art)")));
  // One Piece: "(SP)" è la Special, non la «Super Pre-Release Stamp»; la SP che CardTrader chiama "Alternate Art" sì.
  assert.ok(!onePieceExtraOk({ n: "Jewelry Bonney", num: "ST02-007p", r: "Common", v: "Super Pre-Release Stamp" }, p("Jewelry Bonney (SP)")));
  assert.ok(onePieceExtraOk({ n: "Sakazuki", num: "OP02-099", r: "Alternate Art", v: "Alternate Art" }, p("Sakazuki (SP)")));
  // Premi: il prodotto (o il suo gruppo) deve dirlo.
  assert.ok(!saysPrint({ r: "Promo", v: "Winner" }, p("Monkey.D.Luffy (P-061)", "Promotion Cards")));
  assert.ok(!saysPrint({ r: "Promo", v: "Championship 25-26" }, p("Lim", "Promotion Cards")));
  assert.ok(saysPrint({ r: "Promo", v: "Limited Serial Numbered" }, p("Monkey.D.Luffy - ST01-001 [Serial Number]")));
  // Yu-Gi-Oh!: la ristampa ©2020 di RP01 non prende il prodotto dell'originale ©1996 dello stesso set; LOB25 sì (set suo).
  const originals = new Set(["1291|RP01-003"]);
  assert.ok(!yugiohExtraOk({ s: 1291, num: "RP01-003", v: "©2020" }, p("Dark Magician"), originals));
  assert.ok(yugiohExtraOk({ s: 4100, num: "LOB25-001", v: "©2020" }, p("Blue-Eyes White Dragon"), originals));
  // "Artwork" solo se nel set ci sono due stampe con lo stesso numero (MFC-105 / MFC-105a).
  assert.ok(!yugiohExtraOk({ s: 250, num: "MFC-105", r: "Ultra Rare" }, p("Dark Paladin (1st Edition Artwork)"), null, new Set(["250|MFC-105"])));
  assert.ok(yugiohExtraOk({ s: 7, num: "KC01-013", r: "Ultra Rare" }, p("X-Head Cannon (Japanese Artwork)"), null, new Set()));
});
