import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRetry } from "../src/rete.js";

const noSleep = async () => {};
const ok = () => new Response("{}", { status: 200 });

test("rete assente: riprova e poi riesce", async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    if (n < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return ok();
  };
  const waits = [];
  const res = await fetchRetry("https://x/y", {}, { fetchFn, sleepFn: async (ms) => waits.push(ms), log: () => {}, waitMs: 10, maxWaitMs: 15 });
  assert.equal(res.status, 200);
  assert.equal(n, 3);
  assert.deepEqual(waits, [10, 15]); // 10×1, poi 10×2 limitato a 15
});

test("troppi errori: si arrende con l'ultimo errore", async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    throw new Error("rete giù");
  };
  await assert.rejects(fetchRetry("https://x", {}, { fetchFn, sleepFn: noSleep, log: () => {}, attempts: 3 }), /rete giù/);
  assert.equal(n, 3);
});

test("429 e 5xx si riprovano, 404 no", async () => {
  const codes = [429, 503, 200];
  let n = 0;
  const fetchFn = async () => new Response("", { status: codes[n++] });
  const res = await fetchRetry("https://x", {}, { fetchFn, sleepFn: noSleep, log: () => {} });
  assert.equal(res.status, 200);
  assert.equal(n, 3);
  let m = 0;
  const r404 = await fetchRetry("https://x", {}, { fetchFn: async () => (m++, new Response("", { status: 404 })), sleepFn: noSleep });
  assert.equal(r404.status, 404);
  assert.equal(m, 1);
});
