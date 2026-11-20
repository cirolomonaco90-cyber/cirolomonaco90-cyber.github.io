import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QUOTA_RESERVE, addCalls, dailyBudget, quotaWindow, remainingQuota, usedInWindow } from "../src/ebay-quota.js";
import { Ebay, marketPrices } from "../src/ebay.js";
import { CRITERIO, MAX_ERRORS_IN_A_ROW, keptEntries, run } from "../src/ebay-prezzi.js";
import { findPhotos } from "../src/foto-ebay.js";
import { updateGraded } from "../src/storico-gradate.js";

test("giorno di eBay: riparte a mezzanotte del Pacifico, non a mezzanotte da noi", () => {
  // I tre giri del 18-19 novembre 2026 stavano nello stesso giorno di eBay (dalle 08:00 UTC del 18 alle 08:00 UTC del 19).
  assert.equal(quotaWindow(new Date("2026-11-18T09:15:51Z")), "2026-11-18"); // giro della notte partito tardi
  assert.equal(quotaWindow(new Date("2026-11-18T14:21:22Z")), "2026-11-18"); // giro rilanciato a mano
  assert.equal(quotaWindow(new Date("2026-11-19T04:00:09Z")), "2026-11-18"); // giro della notte del 19: ancora il 18 per eBay
  assert.equal(quotaWindow(new Date("2026-11-19T08:00:01Z")), "2026-11-19"); // ripartita (risposta vera di eBay: reset 08:00Z)
  // D'estate (ora legale del Pacifico) riparte alle 07:00 UTC.
  assert.equal(quotaWindow(new Date("2026-07-01T06:59:00Z")), "2026-06-30");
  assert.equal(quotaWindow(new Date("2026-07-01T07:01:00Z")), "2026-07-01");
});

test("tetto per giorno di eBay: il caso del 18 novembre 2026 non si ripete", () => {
  const cap = 3000;
  const reserve = QUOTA_RESERVE.prezzi;
  // Giro delle 09:15 UTC: quota piena.
  let counter;
  let w = quotaWindow(new Date("2026-11-18T09:15:51Z"));
  const b = dailyBudget({ cap, used: usedInWindow(counter, w), remaining: 5000, reserve });
  assert.equal(b, 3000);
  counter = addCalls(counter, w, b);
  assert.deepEqual(counter, { w: "2026-11-18", n: 3000 });
  // Giro rilanciato a mano alle 14:21 UTC: prima ne faceva altre 1.937, fino alla quota finita. Ora nessuna.
  w = quotaWindow(new Date("2026-11-18T14:21:22Z"));
  assert.equal(dailyBudget({ cap, used: usedInWindow(counter, w), remaining: 1990, reserve }), 0);
  // Anche senza il contatore (file non aggiornato, giro interrotto) eBay dice quante restano: si lascia il margine.
  assert.equal(dailyBudget({ cap, used: 0, remaining: 1990, reserve }), 490);
  assert.equal(dailyBudget({ cap, used: 0, remaining: 1200, reserve }), 0);
  // Giro della notte del 19 alle 04:00 UTC: stesso giorno di eBay, il tetto è già usato.
  w = quotaWindow(new Date("2026-11-19T04:00:09Z"));
  assert.equal(dailyBudget({ cap, used: usedInWindow(counter, w), remaining: 2000, reserve }), 0);
  // Dopo le 08:00 UTC il giorno di eBay è nuovo: il contatore di ieri non conta più.
  w = quotaWindow(new Date("2026-11-19T09:00:00Z"));
  assert.equal(usedInWindow(counter, w), 0);
  assert.equal(dailyBudget({ cap, used: usedInWindow(counter, w), remaining: 4980, reserve }), 3000);
  // Senza la risposta di eBay vale solo il tetto del giorno.
  assert.equal(dailyBudget({ cap, used: 1200, remaining: null, reserve }), 1800);
  // I margini lasciano sempre spazio a chi viene dopo nella notte: foto (300), oggetti (22) e variant-photo.
  assert.ok(QUOTA_RESERVE.prezzi >= 300 + 22 + QUOTA_RESERVE.oggetti);
  assert.ok(QUOTA_RESERVE.foto >= 22 + QUOTA_RESERVE.oggetti);
});

test("quota rimasta: letta dall'API di eBay (risposta vera del 19 novembre 2026), senza consumare ricerche", async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t" }));
    return new Response(JSON.stringify({ rateLimits: [{ apiContext: "buy", apiName: "Browse", apiVersion: "v1", resources: [
      { name: "buy.browse", rates: [{ count: 20, limit: 5000, remaining: 4980, reset: "2026-11-20T08:00:00.000Z", timeWindow: 86400 }] },
      { name: "buy.browse.item.bulk", rates: [{ count: 0, limit: 5000, remaining: 5000, reset: "2026-11-20T08:00:00.000Z", timeWindow: 86400 }] },
    ] }] }));
  };
  const q = await remainingQuota(new Ebay({ appId: "a", certId: "c", fetchFn }));
  assert.deepEqual(q, { limit: 5000, remaining: 4980, count: 20, reset: "2026-11-20T08:00:00.000Z" });
  assert.ok(urls.some((u) => u.includes("/developer/analytics/v1_beta/rate_limit/")));
  assert.ok(!urls.some((u) => u.includes("item_summary/search")));
  // eBay che non risponde: null e una riga nel registro, il lavoro va avanti col solo tetto del giorno.
  const log = [];
  const downFetch = async (u) => (u.includes("oauth2") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("", { status: 500 }));
  assert.equal(await remainingQuota(new Ebay({ appId: "a", certId: "c", fetchFn: downFetch }), log), null);
  assert.match(log[0], /quota eBay: non letta \(eBay rate_limit: HTTP 500\)/);
});

test("prezzi eBay: con la quota finita nessuna voce cambia, le chiamate si contano e c'è la riga nello stato", async () => {
  const universe = [1, 2, 3].map((i) => ({ id: `c${i}`, kind: "card", name: "Gengar", number: String(i), total: 110, value: 10 * i }));
  const before = { c1: { d: 150, c: CRITERIO, b: { "it|n": [5, 4] } } };
  const state = structuredClone(before);
  const stats = {};
  const ebay = { async search() { throw new Error('eBay search "x": HTTP 429'); } };
  const log = await run({ ebay, universe, state, owned: new Set(), today: 200, budget: 3000, pauseMs: 0, stats });
  assert.deepEqual(state, before);
  assert.equal(stats.quotaOut, true);
  assert.equal(stats.calls, 1);
  assert.ok(log.some((l) => /^! quota eBay finita dopo 0 ricerche/.test(l)));
  // eBay che non risponde (token rifiutato): ci si ferma dopo MAX_ERRORS_IN_A_ROW errori, non dopo tutto il tetto.
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}`, kind: "card", name: "Gengar", number: String(i), total: 110, value: i }));
  const s2 = {};
  const broken = { async search() { throw new Error("eBay token: HTTP 401"); } };
  const log2 = await run({ ebay: broken, universe: many, state: {}, owned: new Set(), today: 200, budget: 3000, pauseMs: 0, stats: s2 });
  assert.equal(s2.calls, MAX_ERRORS_IN_A_ROW);
  assert.ok(log2.some((l) => /^! eBay non risponde: 20 errori di fila/.test(l)));
  // Il tetto vale per le chiamate, anche quelle andate in errore.
  let n = 0;
  const s3 = {};
  const flaky = { async search(q) { n++; if (n === 1) throw new Error("rete"); return [{ title: `${q} Holo`, price: 10, currency: "EUR" }]; } };
  await run({ ebay: flaky, universe, state: {}, owned: new Set(), today: 200, budget: 2, pauseMs: 0, stats: s3 });
  assert.equal(s3.calls, 2);
});

test("prezzi eBay: un catalogo non scaricato stanotte non cancella i prezzi dei suoi prodotti", () => {
  const state = { "op:1": { d: 195, b: { "en|n": [3, 4] } }, "op:2": { d: 10, b: {} }, c1: { d: 199, b: {} } };
  // Stanotte onepiece.json non si è scaricato: le carte "op:" mancano dall'universo.
  const kept = keptEntries(state, [{ id: "c1" }], 200);
  assert.deepEqual(Object.keys(kept).sort(), ["c1", "op:1"]); // op:2 (190 giorni) esce come prima
});

test("oggetti: alla prima risposta 'quota finita' ci si ferma, e il tetto della notte si rispetta", async () => {
  const objects = [1, 2, 3].map((id) => ({ id, ebay: { q: `folder ${id}` } }));
  let calls = 0;
  const log = [];
  const stats = {};
  const out = await marketPrices({ async search() { calls++; throw new Error("eBay search: HTTP 429"); } }, objects, log, { stats });
  assert.deepEqual(out, {});
  assert.equal(calls, 1); // prima 22 chiamate, tutte 429
  assert.equal(stats.calls, 1);
  assert.match(log.at(-1), /^! quota eBay finita dopo 0 oggetti cercati/);
  const log2 = [];
  await marketPrices({ async search() { return []; } }, objects, log2, { budget: 2 });
  assert.match(log2.at(-1), /^! quota eBay: oggetti cercati 2, gli altri stanotte no/);
});

test("foto eBay: con la quota finita la cache resta com'era e le chiamate si contano", async () => {
  const cache = { v: 1, p: { "sealed:1": [null, "2026-10-01"] } };
  const products = [
    { key: "sealed:1", name: "Evolving Skies Booster Pack", game: "sealed" },
    { key: "sealed:2", name: "Fusion Strike Booster Pack", game: "sealed" },
  ];
  const log = [];
  const stats = {};
  await findPhotos({ async search() { throw new Error("eBay search: HTTP 429"); } }, products, cache, { now: new Date("2026-11-19T03:00:00Z"), log, stats });
  assert.deepEqual(cache.p, { "sealed:1": [null, "2026-10-01"] }); // nessun "tentativo a vuoto" scritto
  assert.equal(stats.used, 1);
  assert.ok(log.some((l) => /^! quota eBay finita dopo 0 ricerche delle foto/.test(l)));
});

test("storico dei gradati: con quasi tutti i file pubblicati 'non trovati' non si riscrive il passato", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gr-"));
  // 300 prodotti con un prezzo PSA 10 da eBay: finiscono in più di 20 file diversi.
  const p = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`base1-${i}`, { d: 20410, b: { "en|g:PSA 10": [100 + i, 4] } }]));
  const ebay = { p };
  await assert.rejects(updateGraded({ outDir: dir, ebay, fetchJson: async () => null, env: {} }), /storico gr: \d+ file su \d+ non trovati/);
  assert.deepEqual(await fs.readdir(path.join(dir, "gr")), []); // niente scritto
  // Per uno storico nuovo si può forzare.
  const log = await updateGraded({ outDir: dir, ebay, fetchJson: async () => null, env: { STORICO_NUOVI: "1" } });
  assert.match(log.at(-1), /punti nuovi/);
  await fs.rm(dir, { recursive: true, force: true });
});
