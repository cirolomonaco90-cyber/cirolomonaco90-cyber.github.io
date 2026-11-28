import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CardTrader } from "../src/cardtrader.js";

const offers = { 7: [{ id: 1, blueprint_id: 7, price: { cents: 150, currency: "EUR" }, properties_hash: { condition: "Near Mint", pokemon_language: "en" }, quantity: 1, user: { id: 1, username: "a", can_sell_via_hub: true } }] };

function fakeFetch(counter) {
  return async (url) => {
    counter.n++;
    const u = String(url);
    if (u.includes("blueprints/export")) return new Response(JSON.stringify([{ id: 7, name: "Pikachu" }]), { status: 200 });
    if (u.includes("marketplace/products")) return new Response(JSON.stringify(offers), { status: 200 });
    return new Response("[]", { status: 200 });
  };
}

test("con la cache, la seconda lettura dello stesso giorno non chiama CardTrader", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-cache-"));
  const counter = { n: 0 };
  const opts = { token: "t", fetchFn: fakeFetch(counter), marketGapMs: 0, catalogGapMs: 0, cacheDir: dir };
  const a = new CardTrader(opts);
  const bps = await a.blueprints(5);
  const byBp = await a.offersByExpansion(5, "en");
  const single = await a.offersByBlueprint(7);
  assert.equal(counter.n, 3);
  assert.equal(bps[0].name, "Pikachu");
  assert.ok(byBp instanceof Map);
  assert.equal(byBp.get(7)[0].price, 1.5);

  // Un job ripartito: stesso giorno, stessa cartella -> tutto dai file, nessuna chiamata.
  const b = new CardTrader(opts);
  const bps2 = await b.blueprints(5);
  const byBp2 = await b.offersByExpansion(5, "en");
  const single2 = await b.offersByBlueprint(7);
  assert.equal(counter.n, 3);
  assert.equal(b.cached, 3);
  assert.deepEqual(bps2, bps);
  assert.ok(byBp2 instanceof Map);
  assert.deepEqual([...byBp2], [...byBp]);
  assert.deepEqual(single2, single);
  await fs.rm(dir, { recursive: true, force: true });
});

test("senza cache ogni lettura chiama CardTrader", async () => {
  const counter = { n: 0 };
  const ct = new CardTrader({ token: "t", fetchFn: fakeFetch(counter), marketGapMs: 0, catalogGapMs: 0 });
  await ct.blueprints(5);
  await ct.blueprints(5);
  assert.equal(counter.n, 2);
  assert.equal(ct.cached, 0);
});

test("errore di rete: riprova e continua", async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    if (n === 1) throw new TypeError("fetch failed");
    return new Response("[]", { status: 200 });
  };
  const origErr = console.error;
  console.error = () => {};
  try {
    const ct = new CardTrader({ token: "t", fetchFn, retryWaitMs: 1, catalogGapMs: 0 });
    assert.deepEqual(await ct.expansions(1), []);
  } finally {
    console.error = origErr;
  }
  assert.equal(n, 2);
});
