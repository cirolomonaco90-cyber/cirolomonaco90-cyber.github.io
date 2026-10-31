import { test } from "node:test";
import assert from "node:assert/strict";
import { addObjects, OBJECT_OFFSET, OBJECT_EXP } from "../src/oggetti.js";
import { Ebay, relevant, marketEstimate, marketPrices } from "../src/ebay.js";

test("oggetti da collezione aggiunti al catalogo dei sigillati", () => {
  const sealed = { v: 1, exp: { 5402: "151" }, p: [{ id: 719694, n: "151 Booster", t: "booster", e: 5402, cm: { trend: 23 }, ct: {} }, { id: OBJECT_OFFSET + 1, n: "vecchio", t: "object", e: OBJECT_EXP, cm: null, ct: {} }] };
  const objects = { exp: "Poste Italiane · Zecca dello Stato", oggetti: [{ id: 1, n: "Poké Ball argento", d: "2025-10-08", img: "https://x/a.jpg", listino: 200, note: "Medaglia" }] };
  const out = addObjects(sealed, objects, { 1: [249.9, 7] });
  assert.deepEqual(out.exp, { 5402: "151", [OBJECT_EXP]: "Poste Italiane · Zecca dello Stato" });
  assert.deepEqual(out.p.map((p) => p.id), [719694, OBJECT_OFFSET + 1]); // il vecchio oggetto 1 è sostituito
  assert.deepEqual(out.p[1], { id: OBJECT_OFFSET + 1, n: "Poké Ball argento", t: "object", e: OBJECT_EXP, d: "2025-10-08", img: "https://x/a.jpg", bp: null, cm: { listino: 200, mercato: 249.9, inserzioni: 7 }, ct: {}, note: "Medaglia" });
});

test("prezzo di mercato dalle inserzioni eBay", async () => {
  // Inserzioni reali di eBay.it (ottobre 2026), ridotte: anche un'inserzione dell'oro e una non pertinente.
  const items = [
    { title: "Pokeball medaglia argento Pikachu Poste Italiane IPZS 2025 sigillata", price: 249.9 },
    { title: "Poké Ball Pikachu medaglia d'argento Poste Italiane", price: 279 },
    { title: "PREORDINE MEDAGLIA PIKACHU Pokemon Pokeball 2025 Poste Italiane argento", price: 399.99 },
    { title: "Pokeball medaglia ORO Pikachu Poste Italiane", price: 2990 },
    { title: "Carta Pikachu Poste Italiane folder", price: 15 },
    { title: "Pokeball argento Pikachu Poste", price: 5000 }, // segnaposto
  ];
  const q = { must: ["pokeball|poké ball|poke ball", "argento", "pikachu"], no: ["oro"] };
  assert.deepEqual(relevant(items, q).map((i) => i.price), [249.9, 279, 399.99, 5000]);
  assert.deepEqual(marketEstimate(relevant(items, q)), [279, 3]);
  // Il job: token con le chiavi, poi una ricerca per oggetto.
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.includes("oauth2/token")) {
      assert.equal(opts.headers.Authorization, `Basic ${Buffer.from("app:cert").toString("base64")}`);
      return { ok: true, json: async () => ({ access_token: "tok" }) };
    }
    assert.equal(opts.headers.Authorization, "Bearer tok");
    assert.equal(opts.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_IT");
    return { ok: true, json: async () => ({ itemSummaries: items.map((i) => ({ title: i.title, price: { value: String(i.price), currency: "EUR" }, itemWebUrl: "u" })) }) };
  };
  const log = [];
  const m = await marketPrices(new Ebay({ appId: "app", certId: "cert", fetchFn }), [{ id: 1, ebay: { q: "pokeball argento pikachu poste", ...q } }, { id: 2 }], log);
  assert.deepEqual(m, { 1: [279, 3] });
  assert.equal(calls.length, 2);
  assert.ok(log[0].includes("stima 279"));
});
