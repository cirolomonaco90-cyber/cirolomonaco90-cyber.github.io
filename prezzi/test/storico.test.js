import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDay, emptyShard, marketCents, guideCents, subtypeKey, wantedDays, isMonday, epochDay, dayString, dailyChanges, updateTcgplayer, updateCardmarket } from "../src/storico.js";

test("giorni: lunedì e conversioni", () => {
  assert.equal(dayString(epochDay("2026-11-02")), "2026-11-02");
  assert.equal(isMonday(epochDay("2026-11-02")), true); // il 2 novembre 2026 è lunedì
  assert.equal(isMonday(epochDay("2026-11-03")), false);
  assert.equal(isMonday(epochDay("2024-02-12")), true);
  // Da leggere: tutti i lunedì fino a ieri, più ieri e l'altro ieri.
  const days = wantedDays("2024-02-29", "2024-02-12").map(dayString);
  assert.deepEqual(days, ["2024-02-12", "2024-02-19", "2024-02-26", "2024-02-27", "2024-02-28"]);
  // Se ieri è lunedì non si ripete.
  assert.deepEqual(wantedDays("2024-02-20", "2024-02-12").map(dayString), ["2024-02-12", "2024-02-18", "2024-02-19"]);
});

test("prezzi di un archivio tcgcsv: per prodotto e versione, in centesimi", () => {
  const results = [
    { productId: 42346, marketPrice: 75.55, subTypeName: "Holofoil" },
    { productId: 42348, marketPrice: 0.52, subTypeName: "Normal" },
    { productId: 42348, marketPrice: 1.5, subTypeName: "Reverse Holofoil" },
    { productId: 42349, marketPrice: null, subTypeName: "Normal" }, // senza prezzo: fuori
    { productId: 100, marketPrice: 3, subTypeName: "1st Edition Holofoil" },
    { productId: 101, marketPrice: 2, subTypeName: "Shadowless Holofoil" },
  ];
  assert.deepEqual(marketCents(results), {
    42346: { h: 7555 },
    42348: { n: 52, r: 150 },
    100: { fh: 300 },
    101: { "shadowless-holofoil": 200 },
  });
  assert.equal(subtypeKey("Unlimited Holofoil"), "uh");
  assert.equal(subtypeKey(undefined), "n");
});

test("tendenze del listino Cardmarket per espansione", () => {
  const rows = [
    { idProduct: 1, trend: 10.5, "trend-holo": 30 },
    { idProduct: 2, trend: 0, "trend-holo": 0 }, // niente prezzi: fuori
    { idProduct: 3, trend: 2 },
    { idProduct: 4, trend: 1 }, // espansione ignota: fuori
  ];
  const exp = { 1: 1472, 2: 1472, 3: 1473 };
  assert.deepEqual(guideCents(rows, (id) => exp[id]), { 1472: { 1: { t: 1050, th: 3000 } }, 1473: { 3: { t: 200 } } });
});

test("un giorno in più nel file: serie allineate, restano i lunedì e l'ultimo giorno", () => {
  const mon1 = epochDay("2026-10-26");
  const mon2 = epochDay("2026-11-02");
  const tue = epochDay("2026-11-03");
  const wed = epochDay("2026-11-04");
  let s = addDay(emptyShard(), mon1, { 1: { n: 100 } });
  assert.deepEqual(s, { v: 1, d: [mon1], p: { 1: { n: [100] } } });
  // Prodotto nuovo: null nei giorni di prima.
  s = addDay(s, mon2, { 1: { n: 110 }, 2: { h: 500 } });
  assert.deepEqual(s.d, [mon1, mon2]);
  assert.deepEqual(s.p, { 1: { n: [100, 110] }, 2: { h: [null, 500] } });
  // Martedì: resta (è l'ultimo).
  s = addDay(s, tue, { 1: { n: 111 } });
  assert.deepEqual(s.d, [mon1, mon2, tue]);
  assert.deepEqual(s.p[2].h, [null, 500, null]);
  // Mercoledì: restano i lunedì e gli ultimi due giorni (martedì e mercoledì).
  s = addDay(s, wed, { 1: { n: 112 }, 2: { h: 510 } });
  assert.deepEqual(s.d, [mon1, mon2, tue, wed]);
  assert.deepEqual(s.p, { 1: { n: [100, 110, 111, 112] }, 2: { h: [null, 500, null, 510] } });
  // Giovedì: il martedì sparisce.
  const thu = epochDay("2026-11-05");
  s = addDay(s, thu, { 1: { n: 115 }, 2: { h: 520 } });
  assert.deepEqual(s.d, [mon1, mon2, wed, thu]);
  // Lo stesso giorno due volte: sostituisce.
  s = addDay(s, thu, { 1: { n: 113 } });
  assert.deepEqual(s.p[1].n, [100, 110, 112, 113]);
  // Un giorno vecchio aggiunto dopo (riempimento del passato) va al suo posto.
  const mon0 = epochDay("2026-10-19");
  s = addDay(s, mon0, { 1: { n: 90 } });
  assert.deepEqual(s.d, [mon0, mon1, mon2, wed, thu]);
  assert.deepEqual(s.p[1].n, [90, 100, 110, 112, 113]);
  assert.deepEqual(s.p[2].h, [null, null, 500, 510, 520]);
  // Variazione delle 24 ore: giovedì contro mercoledì (giorni di fila), un decimale.
  const ch = dailyChanges([s]);
  assert.equal(ch.day, "2026-11-05");
  assert.deepEqual(ch.p, { 1: { n: 0.9 }, 2: { h: 2.0 } });
  // Senza due giorni di fila (solo lunedì): niente.
  assert.deepEqual(dailyChanges([addDay(addDay(emptyShard(), mon1, { 1: { n: 1 } }), mon2, { 1: { n: 2 } })]).p, {});
  // Il file di partenza non cambia.
  assert.equal(Object.keys(emptyShard().p).length, 0);
});

test("storico TCGplayer: legge gli archivi che mancano, i più recenti prima, e scrive i gruppi", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-test-"));
  const published = { "_giorni.json": { v: 1, d: [epochDay("2026-10-19")] } };
  const archives = {
    "2026-11-02": { 604: [{ productId: 1, marketPrice: 2, subTypeName: "Normal" }] },
    "2026-11-01": { 604: [{ productId: 1, marketPrice: 1.8, subTypeName: "Normal" }] },
    "2026-10-26": { 604: [{ productId: 1, marketPrice: 1.5, subTypeName: "Normal" }], 605: [{ productId: 9, marketPrice: 9, subTypeName: "Holofoil" }] },
  };
  const asked = [];
  const log = await updateTcgplayer({
    outDir: dir,
    max: 2,
    today: new Date("2026-11-03T03:00:00Z"),
    fetchJson: async (url) => published[url.split("/").pop()] ?? null,
    archive: async (day) => {
      asked.push(day);
      return archives[day] ?? null;
    },
  });
  // Ieri (2 novembre, lunedì) e l'altro ieri; con max 2 il lunedì prima aspetta.
  assert.deepEqual(asked, ["2026-11-02", "2026-11-01"]);
  const g604 = JSON.parse(await fs.readFile(path.join(dir, "tp", "604.json"), "utf8"));
  assert.deepEqual(g604.d.map(dayString), ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(g604.p[1].n, [180, 200]);
  const giorni = JSON.parse(await fs.readFile(path.join(dir, "tp", "_giorni.json"), "utf8"));
  assert.deepEqual(giorni.d.map(dayString), ["2026-10-19", "2026-11-01", "2026-11-02"]);
  const ch = JSON.parse(await fs.readFile(path.join(dir, "variazioni-tp.json"), "utf8"));
  assert.deepEqual(ch, { v: 1, day: "2026-11-02", p: { 1: { n: 11.1 } } });
  assert.match(log.at(-1), /2 archivi letti, 1 gruppi aggiornati, 3 giorni in tutto/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("storico Cardmarket: oggi dal listino, un file per espansione", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-test-"));
  const log = await updateCardmarket({
    outDir: dir,
    today: new Date("2026-11-03T03:00:00Z"),
    fetchJson: async () => null,
    guide: { priceGuides: [{ idProduct: 273703, trend: 18.25, "trend-holo": 0 }, { idProduct: 1, trend: 0 }, { idProduct: 859327, trend: 25 }] },
    catalog: { cm: { 273703: 1472, 1: 1472 } },
  });
  const s = JSON.parse(await fs.readFile(path.join(dir, "cm", "1472.json"), "utf8"));
  assert.deepEqual(s.d.map(dayString), ["2026-11-03"]);
  assert.deepEqual(s.p, { 273703: { t: [1825] } });
  // Un sigillato (senza espansione nel catalogo) va nel file "0".
  const zero = JSON.parse(await fs.readFile(path.join(dir, "cm", "0.json"), "utf8"));
  assert.deepEqual(zero.p, { 859327: { t: [2500] } });
  assert.match(log.at(-1), /2 prodotti in 2 espansioni/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "variazioni-cm.json"), "utf8")).p, {});
  await fs.rm(dir, { recursive: true, force: true });
});

test("storico CardTrader: stime per lingua dei cataloghi One Piece e Lorcana, un file per set, variazioni con le chiavi dell'app", async () => {
  const { ctCents, updateCt } = await import("../src/storico.js");
  const onepiece = { cards: [
    { id: 244442, n: "Alvida", num: "OP01-064", s: 3332, en: [0.13, 2], jp: [0.2, 1], g: { en: { "PSA 10": [310, 2] } }, c: { en: { NM: [0.13, 2] } } },
    { id: 244449, n: "Alvida", num: "OP01-064b", s: 3332, en: [78, 1] },
    { id: 1, n: "Senza prezzo", num: "OP01-001", s: 3332 },
  ] };
  const lorcana = { cards: [{ id: 258453, n: "Mickey Mouse - Wayward Sorcerer", num: "208", s: 3469, en: [490.54, 6], it: [280, 4] }] };
  assert.deepEqual(ctCents(onepiece, "op"), { "op-3332": { 244442: { en: 13, jp: 20 }, 244449: { en: 7800 } } });
  // Ieri: file già pubblicato per il set OP-01 (Alvida a 12 centesimi).
  const published = { "op-3332": { v: 1, d: [20760], p: { 244442: { en: [12], jp: [20] } } } };
  const fetchJson = async (url) => published[url.split("/ct/")[1]?.replace(".json", "")] ?? null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-ct-"));
  const log = await updateCt({ outDir: dir, today: new Date("2026-11-04T02:00:00Z"), fetchJson, catalogs: [{ prefix: "op", data: onepiece }, { prefix: "lc", data: lorcana }] });
  const op = JSON.parse(await fs.readFile(path.join(dir, "ct", "op-3332.json"), "utf8"));
  assert.deepEqual(op.d, [20760, 20761]);
  assert.deepEqual(op.p[244442], { en: [12, 13], jp: [20, 20] });
  assert.deepEqual(op.p[244449], { en: [null, 7800] });
  const lc = JSON.parse(await fs.readFile(path.join(dir, "ct", "lc-3469.json"), "utf8"));
  assert.deepEqual(lc.p[258453], { en: [49054], it: [28000] });
  // Variazioni: solo chi ha due giorni di fila, con la chiave della copia nell'app ("op:<blueprint>").
  const changes = JSON.parse(await fs.readFile(path.join(dir, "variazioni-ct.json"), "utf8"));
  assert.equal(changes.day, "2026-11-04");
  assert.deepEqual(changes.p, { "op:244442": { en: 8.3, jp: 0 } });
  assert.ok(log.some((l) => l.includes("op: 2 carte in 1 set")));
  await fs.rm(dir, { recursive: true, force: true });
});
