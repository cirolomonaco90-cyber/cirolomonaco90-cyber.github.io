import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gradedShard, addPoint, gradedPoints, updateGraded } from "../src/storico-gradate.js";

test("il file di un id: stessa formula dell'app, da 0 a 255", () => {
  // Valori controllati con MarketHistory.gradedShard (Kotlin).
  assert.equal(gradedShard("ecard2-149"), 134);
  assert.equal(gradedShard("tp:42382"), 177);
  for (const id of ["op:354316", "ja:SV9-001", "sl:580605", "yg:63873"]) {
    const s = gradedShard(id);
    assert.ok(Number.isInteger(s) && s >= 0 && s < 256);
  }
});

test("punti radi: un giorno letto una volta, mai indietro", () => {
  const s = [];
  assert.equal(addPoint(s, 20770, 100, 2), true);
  assert.equal(addPoint(s, 20770, 120, 3), false); // stesso giorno: sostituito
  assert.equal(addPoint(s, 20769, 90, 1), false); // più vecchio: ignorato
  assert.equal(addPoint(s, 20775, 130, 4), true);
  assert.deepEqual(s, [[20770, 120, 3], [20775, 130, 4]]);
});

test("prezzi per voto da eBay (tutte le lingue) e da PokemonPriceTracker", () => {
  const ebay = { p: {
    "ecard2-149": { d: 20769, b: { "it|n": [109.9, 16], "it|g:PSA 10": [549.95, 2], "en|g:BGS 9.5": [12599, 1] } },
    "op:1": { d: 20770, b: { "en|n": [5, 3] } },
  } };
  const rows = [{ tcgplayer_id: 42382, fetched_at: "2026-11-12T10:00:00Z", data: { grades: { "PSA 10": { eur: 8897.28, sales: 36 }, "PSA 9": { eur: 0 } } } }];
  const pts = gradedPoints(ebay, rows);
  assert.deepEqual(pts, [
    { id: "ecard2-149", key: "it|PSA 10", day: 20769, cents: 54995, count: 2 },
    { id: "ecard2-149", key: "en|BGS 9.5", day: 20769, cents: 1259900, count: 1 },
    { id: "tp:42382", key: "ppt|PSA 10", day: 20769, cents: 889728, count: 36 },
  ]);
});

test("i file pubblicati si allungano, quelli senza punti nuovi non si riscrivono", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gr-"));
  const s = gradedShard("ecard2-149");
  const published = { [`/gr/${s}.json`]: { v: 1, p: { "ecard2-149": { "it|PSA 10": [[20700, 50000, 3]] } } } };
  const fetchJson = async (url) => {
    const k = Object.keys(published).find((x) => url.endsWith(x));
    return k ? structuredClone(published[k]) : null;
  };
  const ebay = { p: { "ecard2-149": { d: 20769, b: { "it|g:PSA 10": [549.95, 2] } } } };
  const log = await updateGraded({ outDir: dir, ebay, fetchJson });
  const out = JSON.parse(await fs.readFile(path.join(dir, "gr", `${s}.json`), "utf8"));
  assert.deepEqual(out.p["ecard2-149"]["it|PSA 10"], [[20700, 50000, 3], [20769, 54995, 2]]);
  assert.match(log[0], /1 punti nuovi, 1 file scritti/);
  // Rilanciato col file aggiornato: niente da scrivere.
  published[`/gr/${s}.json`] = out;
  await fs.rm(path.join(dir, "gr"), { recursive: true });
  const again = await updateGraded({ outDir: dir, ebay, fetchJson });
  assert.match(again[0], /0 punti nuovi, 0 file scritti/);
});
