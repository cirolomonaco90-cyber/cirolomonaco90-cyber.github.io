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
