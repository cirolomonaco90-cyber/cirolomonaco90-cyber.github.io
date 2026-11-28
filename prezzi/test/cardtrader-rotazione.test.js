import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CardTrader } from "../src/cardtrader.js";

// Yu-Gi-Oh! (4 novembre 2026): 691 espansioni × 7 lingue non stanno nelle 6 ore di GitHub. Le offerte lette nei giorni
// prima restano buone per reuseDays; dopo la scadenza non si chiede più nulla e si usa l'ultima lettura, o niente.
test("offerte a rotazione: giorni prima, tempo finito", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ct-rot-"));
  await fs.mkdir(path.join(root, "2026-11-03"));
  await fs.mkdir(path.join(root, "2026-10-20"));
  await fs.writeFile(path.join(root, "2026-11-03", "offers-exp-1-en.json"), JSON.stringify([[10, [{ price: 1 }]]]));
  await fs.writeFile(path.join(root, "2026-10-20", "offers-exp-2-en.json"), JSON.stringify([[20, [{ price: 2 }]]]));
  await fs.writeFile(path.join(root, "2026-10-20", "offers-exp-4-en.json"), JSON.stringify([[40, [{ price: 4 }]]]));
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const ct = new CardTrader({ token: "x", fetchFn, marketGapMs: 0, cacheDir: path.join(root, "2026-11-04"), reuseDays: 3 });
  // Letta ieri: non si richiede.
  assert.deepEqual([...(await ct.offersByExpansion(1, "en")).keys()], [10]);
  assert.equal(calls, 0);
  // Letta 15 giorni fa: si richiede.
  await ct.offersByExpansion(2, "en");
  assert.equal(calls, 1);
  assert.equal(ct.reused, 1);

  // Tempo finito: l'ultima lettura anche vecchia (fino a 30 giorni), altrimenti errore (l'espansione resta per la notte dopo).
  const late = new CardTrader({ token: "x", fetchFn, marketGapMs: 0, cacheDir: path.join(root, "2026-11-05"), reuseDays: 3, deadline: Date.now() - 1 });
  assert.deepEqual([...(await late.offersByExpansion(2, "it").catch(() => new Map())).keys()], []);
  await assert.rejects(late.offersByExpansion(3, "en"), /tempo della notte finito/);
  assert.equal(late.skipped, 2);
  // La lettura più recente: quella di ieri (vuota) prima di quella del 20 ottobre.
  assert.deepEqual([...(await late.offersByExpansion(2, "en")).keys()], []);
  // Oggi (2026-11-05) una lettura del 20 ottobre ha 16 giorni: col tempo finito vale.
  assert.deepEqual([...(await late.offersByExpansion(4, "en")).keys()], [40]);
  // Il catalogo (blueprint) si chiede sempre: il tempo vale solo per le offerte.
  await late.blueprints(5);
  assert.equal(calls, 2);
  await fs.rm(root, { recursive: true });
});
