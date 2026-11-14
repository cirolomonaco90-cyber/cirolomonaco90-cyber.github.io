import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDay as addDayFull, emptyShard, marketCents, guideCents, subtypeKey, wantedDays, isMonday, epochDay, dayString, dailyChanges, updateTcgplayer, updateCardmarket, extraCents, bucketOf, DAILY_DAYS, withLocalCopy, BASE } from "../src/storico.js";

test("giorni: lunedì e conversioni", () => {
  assert.equal(dayString(epochDay("2026-11-02")), "2026-11-02");
  assert.equal(isMonday(epochDay("2026-11-02")), true); // il 2 novembre 2026 è lunedì
  assert.equal(isMonday(epochDay("2026-11-03")), false);
  assert.equal(isMonday(epochDay("2024-02-12")), true);
  // Da leggere: tutti i lunedì fino a ieri, più gli ultimi giorni (qui due: ieri e l'altro ieri).
  const days = wantedDays("2024-02-29", "2024-02-12", 2).map(dayString);
  assert.deepEqual(days, ["2024-02-12", "2024-02-19", "2024-02-26", "2024-02-27", "2024-02-28"]);
  // Se ieri è lunedì non si ripete.
  assert.deepEqual(wantedDays("2024-02-20", "2024-02-12", 2).map(dayString), ["2024-02-12", "2024-02-18", "2024-02-19"]);
  // Di solito: gli ultimi due mesi giorno per giorno (per un grafico con un punto al giorno), prima solo i lunedì.
  const all = wantedDays("2026-11-10").map(dayString);
  assert.equal(all.at(-1), "2026-11-09");
  assert.equal(all.filter((x) => x >= "2026-09-11").length, DAILY_DAYS);
  assert.ok(all.includes("2026-09-11") && !all.includes("2026-09-10") && all.includes("2026-09-07")); // il 7 è lunedì
  assert.ok(all.filter((x) => x < "2026-09-11").every((x) => isMonday(epochDay(x))));
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
  // Senza giorni recenti da tenere (quarto argomento 0: il file "0" di Cardmarket per le app vecchie).
  const addDay = (shard, day, values) => addDayFull(shard, day, values, 0);
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

test("giorni tenuti: gli ultimi due mesi uno per uno, prima solo i lunedì", () => {
  // 10 novembre 2026, dall'utente: "alcune carte hanno pochissimi punti in passato". Restavano i lunedì e gli ultimi due
  // giorni: un prodotto con il solo storico Cardmarket aveva 2 punti. Ora un punto al giorno per 60 giorni.
  const first = epochDay("2026-08-03"); // lunedì
  let s = emptyShard();
  for (let d = first; d <= epochDay("2026-11-10"); d++) s = addDayFull(s, d, { 1: { t: d } });
  const days = s.d.map(dayString);
  assert.equal(days.at(-1), "2026-11-10");
  // Dall'11 settembre (60 giorni prima dell'ultimo) tutti i giorni.
  assert.equal(days.filter((x) => x >= "2026-09-11").length, DAILY_DAYS + 1);
  // Prima solo i lunedì: 3, 10, 17, 24, 31 agosto e 7 settembre.
  assert.deepEqual(days.filter((x) => x < "2026-09-11"), ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
  assert.equal(s.p[1].t.length, s.d.length);
  // Un giorno passato che manca (recupero dall'archivio) entra al suo posto se è tra gli ultimi 60 o un lunedì.
  let h = addDayFull(addDayFull(emptyShard(), epochDay("2026-11-09"), { 1: { t: 9 } }), epochDay("2026-11-10"), { 1: { t: 10 } });
  h = addDayFull(h, epochDay("2026-10-15"), { 1: { t: 5 } });
  h = addDayFull(h, epochDay("2026-07-15"), { 1: { t: 1 } }); // mercoledì di luglio: troppo vecchio, non resta
  h = addDayFull(h, epochDay("2026-07-13"), { 1: { t: 2 } }); // lunedì: resta
  assert.deepEqual(h.d.map(dayString), ["2026-07-13", "2026-10-15", "2026-11-09", "2026-11-10"]);
  assert.deepEqual(h.p[1].t, [2, 5, 9, 10]);
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
  // Un sigillato (senza espansione nel catalogo) va nel file "0" (app fino alla 0.9.173) e nel file del suo id.
  const zero = JSON.parse(await fs.readFile(path.join(dir, "cm", "0.json"), "utf8"));
  assert.deepEqual(zero.p, { 859327: { t: [2500] } });
  assert.equal(bucketOf(859327), "b171");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "cm", "b171.json"), "utf8")).p, { 859327: { t: [2500] } });
  assert.match(log.at(-1), /2 prodotti in 2 espansioni e 1 file per id/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "cm", "_giorni.json"), "utf8")).d.map(dayString), ["2026-11-03"]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "variazioni-cm.json"), "utf8")).p, {});
  await fs.rm(dir, { recursive: true, force: true });
});

test("storico Cardmarket: sigillati degli altri giochi e oggetti, nei file per id, con la variazione delle 24 ore", async () => {
  // 10 novembre 2026, dall'utente: "lo storico deve essere presente per tutti i prodotti". Il listino letto era solo quello
  // dei Pokémon: i sigillati di One Piece, Lorcana, Dragon Ball e Yu-Gi-Oh! (3.750) e gli oggetti non avevano né storico né
  // variazione. Ora la tendenza del listino del loro gioco (solo i prodotti dei nostri cataloghi) e il prezzo eBay degli oggetti.
  const files = {
    "onepiece-sealed.json": { p: [{ id: 690001, n: "OP-01 Booster Box" }, { id: 690002, n: "Senza tendenza" }] },
    "lorcana-sealed.json": { p: [{ id: 761836, n: "Ursula's Return Illumineer's Trove" }] },
    "dragonball-sealed.json": { p: [] },
    "price_guide_18.json": { priceGuides: [{ idProduct: 690001, trend: 99.9 }, { idProduct: 690002, trend: 0 }, { idProduct: 555, trend: 3 }] }, // 555: una carta singola, non nostra
    "price_guide_19.json": { priceGuides: [{ idProduct: 761836, trend: 45.5 }] },
    "price_guide_13.json": { priceGuides: [{ idProduct: 1, trend: 5 }] },
    // yugioh-sealed.json e il suo listino non rispondono: si salta, il resto si fa.
    "sealed.json": { p: [{ id: 271439, cm: { trend: 222.26 } }, { id: 2000000002, cm: { listino: 500, mercato: 2812.88, inserzioni: 8 } }, { id: 2000000009, cm: { listino: 12 } }] },
  };
  const fetchJson = async (url) => {
    const name = url.split("/").pop();
    if (name.includes("yugioh") || name === "price_guide_3.json") throw new Error("HTTP 500");
    return files[name] ?? null;
  };
  const log = [];
  const extra = await extraCents({ fetchJson, log });
  assert.deepEqual(extra, { 690001: { t: 9990 }, 761836: { t: 4550 }, 2000000002: { t: 281288 } });
  assert.ok(log.some((l) => l.includes("onepiece: 1 sigillati con la tendenza su 2")));
  assert.ok(log.some((l) => l.includes("yugioh-sealed.json: non letto")));
  assert.ok(log.some((l) => l.includes("oggetti da collezione: 1")));

  const d = epochDay("2026-11-11");
  const published = { "b138.json": { v: 1, d: [d - 1], p: { 690001: { t: [9000] } } } };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-cm-extra-"));
  await updateCardmarket({
    outDir: dir, today: new Date("2026-11-11T02:40:00Z"), fetchJson: async (url) => published[url.split("/cm/")[1]] ?? null,
    guide: { priceGuides: [{ idProduct: 271439, trend: 222.26 }] }, catalog: { cm: {} }, extra, log,
  });
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
  assert.deepEqual((await read("cm/b138.json")).p, { 690001: { t: [9000, 9990] } });
  assert.deepEqual((await read("cm/b152.json")).p, { 761836: { t: [4550] } });
  assert.deepEqual((await read(`cm/${bucketOf(2000000002)}.json`)).p, { 2000000002: { t: [281288] } });
  // Il file "0" delle app vecchie resta coi soli prodotti Pokémon.
  assert.deepEqual(Object.keys((await read("cm/0.json")).p), ["271439"]);
  assert.deepEqual((await read("variazioni-cm.json")).p, { 690001: { t: 11 } });
  await fs.rm(dir, { recursive: true, force: true });
});

test("storico Cardmarket: i giorni passati dalle copie del listino nell'archivio di Internet", async () => {
  // Nessun archivio pubblico dei prezzi Cardmarket, ma web.archive.org tiene il file ufficiale del listino quasi ogni
  // giorno dal settembre 2026: due mesi di tendenze giorno per giorno per ogni prodotto Pokémon, sigillati compresi.
  const d = epochDay("2026-11-10");
  const guideOf = (createdAt, trend) => ({ createdAt, priceGuides: [{ idProduct: 273703, trend }, { idProduct: 859327, trend: trend * 10 }] });
  const copies = {
    20241230185748: guideOf("2024-12-30T02:50:00+0100", 1), // troppo vecchia: un punto isolato, non si legge
    20261006170000: guideOf("2026-10-06T02:41:00+0200", 14),
    20261007003000: guideOf("2026-10-06T02:41:00+0200", 14), // presa prima dell'uscita del listino del 7: è quello del 6
    20261008170000: guideOf("2026-10-08T02:41:00+0200", 16),
    20261008190000: guideOf("2026-10-08T02:41:00+0200", 16), // due copie lo stesso giorno: una sola
    20261109183341: guideOf("2026-11-09T02:50:26+0100", 18), // giorno già nostro: non si tocca
    20261110120000: guideOf("2026-11-09T02:50:26+0100", 18), // oggi: lo fa il listino vero
  };
  const published = {
    "1472.json": { v: 1, d: [d - 1], p: { 273703: { t: [1800] } } },
    "0.json": { v: 1, d: [d - 1], p: { 859327: { t: [18000] } } },
  };
  const asked = [];
  const archive = { max: 2, list: async () => Object.keys(copies), read: async (ts) => { asked.push(ts); return copies[ts]; } };
  const run = async (dir, max) => updateCardmarket({
    outDir: dir, today: new Date("2026-11-10T02:40:00Z"), fetchJson: async (url) => published[url.split("/cm/")[1]] ?? null,
    guide: guideOf("2026-11-09T02:50:26+0100", 18), catalog: { cm: { 273703: 1472 } }, archive: { ...archive, max },
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-cm-archivio-"));
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
  // Due per volta, i più recenti prima: l'8 ottobre e il 7 (che dentro ha il listino del 6).
  let log = await run(dir, 2);
  assert.deepEqual(asked, ["20261008190000", "20261007003000"]);
  assert.deepEqual((await read("cm/1472.json")).d.map(dayString), ["2026-10-06", "2026-10-08", "2026-11-09", "2026-11-10"]);
  assert.deepEqual((await read("cm/1472.json")).p[273703].t, [1400, 1600, 1800, 1800]);
  assert.match(log.at(-1), /2 giorni recuperati dall'archivio di Internet \(1 ancora da recuperare\)/);
  // Il sigillato: nel file del suo id tutti i giorni (anche quello che il file "0" aveva già: il file per id nasce ora),
  // nel file "0" delle app vecchie solo i lunedì e gli ultimi due.
  assert.deepEqual((await read("cm/b171.json")).d.map(dayString), ["2026-10-06", "2026-10-08", "2026-11-09", "2026-11-10"]);
  assert.deepEqual((await read("cm/b171.json")).p[859327].t, [14000, 16000, 18000, 18000]);
  assert.deepEqual((await read("cm/0.json")).d.map(dayString), ["2026-11-09", "2026-11-10"]);
  assert.deepEqual((await read("cm/_giorni.json")).d.map(dayString), ["2026-10-06", "2026-10-07", "2026-10-08", "2026-11-09", "2026-11-10"]);
  // La volta dopo (coi file pubblicati): il 6 ottobre c'è già, era dentro la copia del 7: non si scarica nemmeno.
  for (const name of ["1472.json", "0.json", "b171.json", "_giorni.json"]) published[name] = await read(`cm/${name}`);
  asked.length = 0;
  log = await run(dir, 5);
  assert.deepEqual(asked, []);
  assert.deepEqual((await read("cm/1472.json")).p[273703].t, [1400, 1600, 1800, 1800]);
  assert.match(log.at(-1), /0 giorni recuperati dall'archivio di Internet, variazioni/);
  // L'archivio che non risponde non ferma il giorno di oggi.
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "storico-cm-archivio-"));
  log = await updateCardmarket({
    outDir: dir2, today: new Date("2026-11-10T02:40:00Z"), fetchJson: async () => null, guide: guideOf("x", 18), catalog: { cm: { 273703: 1472 } },
    archive: { max: 5, list: async () => { throw new Error("HTTP 503"); }, read: async () => null },
  });
  assert.ok(log.some((l) => l.includes("archivio di Internet interrotto (HTTP 503)")));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir2, "cm", "1472.json"), "utf8")).p[273703].t, [1800]);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(dir2, { recursive: true, force: true });
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

test("storico CardTrader: ogni parte del job tocca solo i suoi giochi e tiene le variazioni pubblicate degli altri", async () => {
  const { updateCt } = await import("../src/storico.js");
  // 10 novembre 2026: la parte "prezzi" calcolava anche le variazioni di Yu-Gi-Oh!, col catalogo che trovava pubblicato.
  // Quella notte la parte "yugioh" ha pubblicato il catalogo nuovo 7 minuti dopo: il catalogo di ieri è stato confrontato
  // con se stesso e tutte le 46.413 carte sono uscite a 0%. Ora ogni parte scrive lo storico dei suoi giochi, col
  // catalogo che ha appena costruito, e nel file delle variazioni lascia stare le voci degli altri.
  const d = epochDay("2026-11-10");
  const onepiece = { cards: [{ id: 244442, num: "OP01-064", s: 3332, en: [0.13, 2] }] };
  const yugioh = { cards: [{ id: 87066, num: "LOB-001", s: 900, en: [1.1, 9], it: [0.5, 6] }] };
  const published = {
    "ct/op-3332.json": { v: 1, d: [d - 1], p: { 244442: { en: [12] } } },
    "ct/yg-900.json": { v: 1, d: [d - 2, d - 1], p: { 87066: { en: [100, 100], it: [50, 50] } } },
    // Le variazioni di ieri: Yu-Gi-Oh! fermo, One Piece in calo.
    "variazioni-ct.json": { v: 1, day: "2026-11-09", days: { op: "2026-11-09", yg: "2026-11-09" }, p: { "op:244442": { en: -4 }, "yg:87066": { en: 0, it: 0 } } },
  };
  const asked = [];
  const fetchJson = async (url) => {
    asked.push(url);
    return published[url.split("/storico/v1/")[1].split("?")[0]] ?? null;
  };
  const read = async (dir, name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));

  // Parte "prezzi", 06:50: solo One Piece. Yu-Gi-Oh! resta com'era pubblicato (ieri), il suo storico non si tocca.
  const prezzi = await fs.mkdtemp(path.join(os.tmpdir(), "storico-ct-prezzi-"));
  await updateCt({ outDir: prezzi, today: new Date("2026-11-10T06:50:00Z"), fetchJson, catalogs: [{ prefix: "op", data: onepiece }] });
  assert.deepEqual(await fs.readdir(path.join(prezzi, "ct")), ["op-3332.json"]);
  let ch = await read(prezzi, "variazioni-ct.json");
  assert.deepEqual(ch.p, { "op:244442": { en: 8.3 }, "yg:87066": { en: 0, it: 0 } });
  assert.deepEqual(ch.days, { op: "2026-11-10", yg: "2026-11-09" });
  assert.equal(ch.day, "2026-11-10");
  // Il file pubblicato si chiede senza passare dalla copia del server (che può avere qualche minuto).
  assert.ok(asked.some((u) => /variazioni-ct\.json\?t=\d+$/.test(u)));
  published["variazioni-ct.json"] = ch;

  // Parte "yugioh", 06:57: il catalogo appena costruito contro quello di ieri; One Piece resta com'è.
  const yg = await fs.mkdtemp(path.join(os.tmpdir(), "storico-ct-yugioh-"));
  const log = await updateCt({ outDir: yg, today: new Date("2026-11-10T06:57:00Z"), fetchJson, catalogs: [{ prefix: "yg", data: yugioh }] });
  assert.deepEqual(await fs.readdir(path.join(yg, "ct")), ["yg-900.json"]);
  assert.deepEqual((await read(yg, "ct/yg-900.json")).p[87066], { en: [100, 100, 110], it: [50, 50, 50] });
  ch = await read(yg, "variazioni-ct.json");
  assert.deepEqual(ch.p, { "yg:87066": { en: 10, it: 0 }, "op:244442": { en: 8.3 } });
  assert.deepEqual(ch.days, { yg: "2026-11-10", op: "2026-11-10" });
  assert.ok(log.some((l) => l.includes("variazioni 24h di 2 carte") && l.includes("1 di altri giochi")));
  await fs.rm(prezzi, { recursive: true, force: true });
  await fs.rm(yg, { recursive: true, force: true });
});

test("storico CardTrader: variazioni degli altri giochi troppo vecchie tolte, file di prima senza i giorni per gioco", async () => {
  const { updateCt } = await import("../src/storico.js");
  const d = epochDay("2026-11-12");
  const onepiece = { cards: [{ id: 244442, num: "OP01-064", s: 3332, en: [0.13, 2] }] };
  const run = async (variazioni) => {
    const published = { "ct/op-3332.json": { v: 1, d: [d - 1], p: { 244442: { en: [13] } } }, "variazioni-ct.json": variazioni };
    const fetchJson = async (url) => published[url.split("/storico/v1/")[1].split("?")[0]] ?? null;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-ct-vecchie-"));
    const log = await updateCt({ outDir: dir, today: new Date("2026-11-12T06:50:00Z"), fetchJson, catalogs: [{ prefix: "op", data: onepiece }] });
    const ch = JSON.parse(await fs.readFile(path.join(dir, "variazioni-ct.json"), "utf8"));
    await fs.rm(dir, { recursive: true, force: true });
    return { ch, log };
  };
  // La parte "yugioh" non gira da due notti: le sue variazioni non sono più "delle 24 ore", via (meglio nessuna che una vecchia).
  let r = await run({ v: 1, day: "2026-11-11", days: { op: "2026-11-11", yg: "2026-11-10", lc: "2026-11-11" }, p: { "yg:87066": { en: 10 }, "lc:1": { en: 2 }, "op:244442": { en: 5 } } });
  assert.deepEqual(r.ch.p, { "op:244442": { en: 0 }, "lc:1": { en: 2 } });
  assert.deepEqual(r.ch.days, { op: "2026-11-12", lc: "2026-11-11" });
  assert.ok(r.log.some((l) => l.includes("yg") && l.includes("2026-11-10")));
  // File scritto dal codice di prima (un giorno solo per tutti): vale quello.
  r = await run({ v: 1, day: "2026-11-11", p: { "yg:87066": { en: 10 } } });
  assert.deepEqual(r.ch.p, { "op:244442": { en: 0 }, "yg:87066": { en: 10 } });
  assert.deepEqual(r.ch.days, { op: "2026-11-12", yg: "2026-11-11" });
  r = await run({ v: 1, day: "2026-11-09", p: { "yg:87066": { en: 10 } } });
  assert.deepEqual(r.ch.p, { "op:244442": { en: 0 } });
  // Il file pubblicato non si legge (rete): restano le variazioni dei propri giochi, il giro non si ferma.
  const fetchJson = async (url) => {
    if (url.includes("variazioni-ct.json")) throw new Error("rete");
    return null;
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-ct-rete-"));
  const log = await updateCt({ outDir: dir, today: new Date("2026-11-12T06:50:00Z"), fetchJson, catalogs: [{ prefix: "op", data: onepiece }] });
  assert.ok(log.some((l) => l.includes("non lette")));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "variazioni-ct.json"), "utf8")).p, {});
  await fs.rm(dir, { recursive: true, force: true });
});

test("storico CardTrader: cataloghi dalla riga di comando, in ordine o col prefisso del gioco", async () => {
  const { ctArgs } = await import("../src/storico.js");
  // Parte "prezzi": i tre cataloghi in ordine, senza Yu-Gi-Oh!.
  assert.deepEqual(ctArgs(["a/onepiece.json", "a/lorcana.json", "a/dragonball.json"]), [
    { prefix: "op", file: "a/onepiece.json" }, { prefix: "lc", file: "a/lorcana.json" }, { prefix: "db", file: "a/dragonball.json" },
  ]);
  // Parte "yugioh": solo il suo.
  assert.deepEqual(ctArgs(["yg=/tmp/x/yugioh.json"]), [{ prefix: "yg", file: "/tmp/x/yugioh.json" }]);
  assert.deepEqual(ctArgs(["", "a/lorcana.json", "zz=boh.json"]), [{ prefix: "lc", file: "a/lorcana.json" }]);
});

test("file dello storico dalla copia locale quando è identica a quella pubblicata", async () => {
  const crypto = await import("node:crypto");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storico-copia-"));
  await fs.mkdir(path.join(dir, "tp"), { recursive: true });
  const same = JSON.stringify({ v: 1, d: [20000], p: { 1: { n: [100] } } });
  const old = JSON.stringify({ v: 1, d: [19999], p: {} });
  await fs.writeFile(path.join(dir, "tp", "604.json"), same);
  await fs.writeFile(path.join(dir, "tp", "605.json"), old);
  await fs.writeFile(path.join(dir, "tp", "606.json"), same);
  await fs.writeFile(path.join(dir, "tp", "607.json"), same);
  await fs.writeFile(path.join(dir, "tp", "608.json"), "{rovinato");
  const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");
  const published = { 604: same, 605: JSON.stringify({ v: 1, d: [20000], p: { 2: { n: [5] } } }), 607: same, 608: same, 609: same };
  const downloaded = [];
  const heads = [];
  const fetchJson = async (url) => {
    downloaded.push(url.startsWith(BASE) ? url.slice(BASE.length + 1) : url);
    const id = url.match(/(\d+)\.json/)?.[1];
    return published[id] ? JSON.parse(published[id]) : null;
  };
  const etag = async (url) => {
    heads.push(url.slice(BASE.length + 1));
    const id = url.match(/(\d+)\.json/)[1];
    if (id === "607") throw new Error("rete");
    if (id === "608") return md5("{rovinato"); // copia rovinata ma con lo stesso md5: si scarica comunque
    return published[id] ? md5(published[id]) : null;
  };
  const stats = {};
  const get = withLocalCopy(fetchJson, dir, { etag, stats });
  // Identica: dalla copia, senza scaricare.
  assert.deepEqual(await get(`${BASE}/tp/604.json`), JSON.parse(same));
  assert.deepEqual(downloaded, []);
  // Diversa da quella pubblicata (un caricamento non riuscito, un'altra parte del job): si scarica quella pubblicata.
  assert.deepEqual((await get(`${BASE}/tp/605.json`)).p, { 2: { n: [5] } });
  // Sul server non c'è più: niente, anche se la copia c'è.
  assert.equal(await get(`${BASE}/tp/606.json`), null);
  // Etag non letto o copia illeggibile: si scarica.
  assert.deepEqual(await get(`${BASE}/tp/607.json`), JSON.parse(same));
  assert.deepEqual(await get(`${BASE}/tp/608.json`), JSON.parse(same));
  // Mai copiato: si scarica senza chiedere l'etag.
  assert.deepEqual(await get(`${BASE}/tp/609.json`), JSON.parse(same));
  assert.ok(!heads.includes("tp/609.json"));
  // Le letture fresche (con "?") e gli indirizzi fuori dallo storico passano sempre dalla rete.
  await get(`${BASE}/variazioni-ct.json?t=1`);
  await get("https://example.org/altro.json");
  assert.deepEqual(downloaded, ["tp/605.json", "tp/607.json", "tp/608.json", "tp/609.json", "variazioni-ct.json?t=1", "https://example.org/altro.json"]);
  assert.deepEqual(stats, { local: 1, remote: 4 });
  // Senza cartella: tutto come prima.
  assert.equal(withLocalCopy(fetchJson, undefined), fetchJson);
  await fs.rm(dir, { recursive: true, force: true });
});
