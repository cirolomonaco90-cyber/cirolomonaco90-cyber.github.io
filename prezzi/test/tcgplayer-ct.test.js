import test from "node:test";
import assert from "node:assert/strict";
import { numberKey, tpExtra, ctExtra, tpIndex, matchTp, addTcgplayerIds } from "../src/tcgplayer-ct.js";

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
    throw new Error(`url inattesa ${url}`);
  };
  const data = { sets: [{ id: 3332, name: "OP-01: Romance Dawn" }], cards: [{ id: 1, n: "Trafalgar Law", num: "OP01-002", s: 3332 }, { id: 2, n: "Nami", num: "OP01-016", s: 3332, tp: [9, 9] }] };
  const log = [];
  assert.equal(await addTcgplayerIds("onepiece", data, { fetchJson, log }), 1);
  assert.deepEqual(data.cards[0].tp, [453505, 3188]);
  assert.equal(data.cards[1].tp, undefined); // un abbinamento vecchio che non regge più sparisce
  assert.ok(log[0].includes("1 carte su 2"));
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
