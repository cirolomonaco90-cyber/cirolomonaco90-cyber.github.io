import { test } from "node:test";
import assert from "node:assert/strict";
import { ctSetDates, sealedDates, tcgdexKey, tcgplayerDates } from "../src/set-dates.js";

test("chiavi dei set TCGdex: asiatici con la lingua", () => {
  assert.equal(tcgdexKey("base4", "en"), "base4");
  assert.equal(tcgdexKey("SV9", "ja"), "SV9@ja");
  assert.equal(tcgdexKey("SV9", "zh-tw"), "SV9@zh-tw");
});

test("date delle espansioni dei sigillati", () => {
  // Dati reali ridotti (sealed.json, ottobre 2026).
  const sealed = {
    exp: { 5402: "151", 6099: "Collect 151", 1521: "Phantom Forces" },
    p: [
      { e: 5402, d: "2023-06-21" },
      { e: 6099, d: "2025-01-03" }, { e: 6099, d: "2025-03-07" }, { e: 6099, d: "2025-06-11" },
      { e: 1521, d: "2007-01-01" }, // data di caricamento iniziale di Cardmarket: non conta
    ],
  };
  const en = [{ name: "151", date: "2023-09-22" }, { name: "Phantom Forces", date: "2014-11-05" }];
  assert.deepEqual(sealedDates(sealed, en), { "sl:5402": "2023-09-22", "sl:6099": "2025-03-07", "sl:1521": "2014-11-05" });
});

test("gruppi TCGplayer misti senza data", () => {
  // Gruppi reali (tcgcsv.com, 30 ottobre 2026): i gruppi misti hanno la data dell'ultimo aggiornamento.
  const groups = [
    { groupId: 1451, name: "XY Promos", publishedOn: "2013-12-16T00:00:00" },
    { groupId: 2374, name: "Miscellaneous Cards & Products", publishedOn: "2026-10-29T00:00:00" },
    { groupId: 2289, name: "Blister Exclusives", publishedOn: "2026-10-29T00:00:00" },
  ];
  assert.deepEqual(tcgplayerDates(groups, new Date("2026-10-30T01:00:00Z")), { "tp-g1451": "2013-12-16" });
});

test("date dei set dei giochi CardTrader dal gruppo TCGplayer delle carte", () => {
  // Dati reali ridotti (lorcana.json e gruppi TCGplayer della categoria 71, 4 novembre 2026): The First Chapter ha le
  // carte nel gruppo 22937 (2023-08-18) e una ristampa in un gruppo promo; il set senza carte su TCGplayer resta senza data.
  const catalog = {
    sets: [{ id: 3469, name: "The First Chapter" }, { id: 9999, name: "Senza TCGplayer" }],
    cards: [
      { id: 1, s: 3469, tp: [510154, 22937] },
      { id: 2, s: 3469, tp: [510155, 22937] },
      { id: 3, s: 3469, tp: [520000, 23000] },
      { id: 4, s: 9999 },
    ],
  };
  const dates = { "tp-g22937": "2023-08-18", "tp-g23000": "2023-07-01" };
  assert.deepEqual(ctSetDates(catalog, "lc", dates), { "lc:3469": "2023-08-18" });
});

test("data di uscita di ogni prodotto sigillato", async () => {
  const { productDates, isMixedGroup } = await import("../src/set-dates.js");
  // Dati reali ridotti (yugioh-sealed.json, sealed.json e gruppi tcgcsv, 14 novembre 2026). La data `d` del catalogo è quella
  // di Cardmarket (2023 per Dark Revelation 2, uscito nel 2005) e non conta.
  const groups = new Map([
    [173, { name: "Dark Revelation Volume 2", date: "2005-10-20" }],
    [2374, { name: "Miscellaneous Cards & Products", date: "2026-10-29" }],
    [23237, { name: "SV: Scarlet & Violet 151", date: "2023-09-22" }],
  ]);
  const yg = {
    exp: { 1013: "Dark Revelation 2", 1011: "Force of the Breaker", 5000: "Senza fonte" },
    p: [
      { id: 230007, e: 1013, d: "2023-06-20", tp: [216732, 173] },
      { id: 230006, e: 1011, d: "2023-06-20" }, // nessun prodotto TCGplayer: il gruppo con lo stesso nome dell'espansione
      { id: 230099, e: 1013, d: "2023-06-20" }, // stessa espansione, senza tp: la data dell'espansione
      { id: 230100, e: 5000, d: "2024-01-01" }, // nessuna fonte sicura: nessuna data
    ],
  };
  assert.deepEqual(
    productDates(yg, { groups, groupsByName: new Map([["force of the breaker", "2007-05-01"]]) }),
    { "sp:230007": "2005-10-20", "sp:230006": "2007-05-01", "sp:230099": "2005-10-20" },
  );
  // Pokémon: set TCGdex col nome uguale; i gruppi misti e le espansioni miste non danno una data.
  const pk = {
    exp: { 5402: "151", 5798: "Pokémon Products" },
    p: [
      { id: 719695, e: 5402 },
      { id: 670732, e: 5798, tp: [1, 2374] },
      { id: 670733, e: 5798, tp: [2, 23237] },
    ],
  };
  assert.deepEqual(
    productDates(pk, { groups, enSets: [{ name: "151", date: "2023-09-22" }] }),
    { "sp:719695": "2023-09-22", "sp:670733": "2023-09-22" },
  );
  // "Legendary Collection" esiste anche in Yu-Gi-Oh!: il set TCGdex vale solo se lo si passa (solo per i Pokémon).
  assert.deepEqual(productDates({ exp: { 1217: "Legendary Collection" }, p: [{ id: 1, e: 1217 }] }, { groups }), {});
  assert.ok(isMixedGroup("Blister Exclusives") && isMixedGroup("XY Promos") && !isMixedGroup("Crown Zenith"));
});
