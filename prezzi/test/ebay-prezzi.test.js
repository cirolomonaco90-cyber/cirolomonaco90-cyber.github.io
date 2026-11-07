import test from "node:test";
import assert from "node:assert/strict";
import { bucketOf, matches, bucketPrices, plan, buildUniverse, query, sealedWords, run, intervalFor, dailyDemand } from "../src/ebay-prezzi.js";

test("secchio dal titolo: lingua, variante e voto", () => {
  assert.equal(bucketOf("Gengar 11/110 Legendary Collection Reverse Holo NM"), "en|r");
  assert.equal(bucketOf("Charizard 4/102 Set Base 1a Edizione ITA"), "it|1");
  assert.equal(bucketOf("Charizard 4/102 Base Set Shadowless Holo"), "en|s");
  assert.equal(bucketOf("Charizard 4/102 PSA 10 Gem Mint"), "en|g:PSA 10");
  assert.equal(bucketOf("Pikachu 25/102 BGS 9.5 japanese"), "ja|g:BGS 9.5");
  assert.equal(bucketOf("Articuno di Galar SWSH123 Staff promo"), "en|st");
  assert.equal(bucketOf("Lugia 9/111 Prerelease stamp italiano"), "it|pr");
  assert.equal(bucketOf("Lugia 9/111 Holo Rare Deutsch"), "de|n");
  // Lotti, falsi, gradate senza voto: scartate.
  assert.equal(bucketOf("Lotto 50 carte Pokemon Charizard 4/102"), null);
  assert.equal(bucketOf("Charizard 4/102 proxy custom"), null);
  assert.equal(bucketOf("Charizard 4/102 graded slab"), null);
  // Ristampe (Celebrations) e copie rovinate fuori; una carta di Celebrations accetta le sue parole.
  assert.equal(bucketOf("Shining Charizard 107/105 Celebrations Classic Collection"), null);
  assert.equal(bucketOf("Shining Charizard 107/105 Celebrations", { reprintOk: true }), "en|n");
  assert.equal(bucketOf("Charizard 4/102 Base Set Heavily Played HP"), null);
  assert.equal(bucketOf("Charizard 4/102 PSA 9"), "en|g:PSA 9"); // le gradate restano (il voto dice la condizione)
});

test("il titolo parla del prodotto: nome e numero col totale, o le parole del sigillato", () => {
  const p = { kind: "card", name: "Gengar", number: "11", total: 110 };
  assert.ok(matches("Gengar 11/110 Legendary Collection Reverse", p));
  assert.ok(matches("GENGAR 011/110 LC", p));
  assert.ok(!matches("Gengar 5/110 Legendary Collection", p));
  assert.ok(!matches("Haunter 11/110", p));
  assert.ok(matches("Monkey D. Luffy OP05-119 Parallel", { kind: "card", name: "Monkey.D.Luffy", number: "OP05-119" }));
  const box = { kind: "sealed", must: sealedWords("Evolving Skies Booster Box") };
  assert.ok(matches("Pokemon Evolving Skies Booster Box sealed", box));
  assert.ok(!matches("Evolving Skies Booster Pack", box));
});

test("prezzi per secchio: solo euro, solo inserzioni del prodotto, mediana delle più economiche", () => {
  const p = { kind: "card", name: "Gengar", number: "11", total: 110 };
  const items = [
    { title: "Gengar 11/110 Reverse Holo", price: 100, currency: "EUR" },
    { title: "Gengar 11/110 Reverse Holo NM", price: 120, currency: "EUR" },
    { title: "Gengar 11/110 Reverse Holo LP", price: 20, currency: "EUR" }, // giocata: fuori
    { title: "Gengar 11/110 Reverse Holo ITA", price: 90, currency: "EUR" },
    { title: "Gengar 11/110 Holo", price: 40, currency: "EUR" },
    { title: "Gengar 11/110 PSA 9", price: 300, currency: "EUR" },
    { title: "Gengar 11/110 Holo", price: 35, currency: "USD" }, // non euro
    { title: "Haunter 11/110", price: 5, currency: "EUR" }, // altra carta
  ];
  assert.deepEqual(bucketPrices(items, p), { "en|r": [110, 2], "it|r": [90, 1], "en|n": [40, 1], "en|g:PSA 9": [300, 1] });
});

test("frequenza per valore: i cari spesso, i trascurabili di rado, la metà se in collezione", () => {
  assert.equal(intervalFor(4600, false), 2);
  assert.equal(intervalFor(300, false), 4);
  assert.equal(intervalFor(60, false), 7);
  assert.equal(intervalFor(25, false), 14);
  assert.equal(intervalFor(8, false), 30);
  assert.equal(intervalFor(2, false), 90);
  assert.equal(intervalFor(0.1, false), 180);
  assert.equal(intervalFor(60, true), 3.5);
  assert.equal(intervalFor(4600, true), 2); // mai sotto 2 giorni
  assert.equal(dailyDemand([{ id: "a", value: 4600 }, { id: "b", value: 0.1 }], new Set()), 1); // 0,5 + 0,006
});

test("rotazione: dovuti per ritardo, mai cercati come ritardo doppio, entro la quota", () => {
  const u = [
    { id: "cara", value: 1500 }, { id: "media", value: 30 }, { id: "poco", value: 0.5 }, { id: "nuova", value: 10 }, { id: "nuovaPoco", value: 0.2 },
  ];
  // Oggi 200. cara: 6 giorni fa, intervallo 2 → ritardo 3; media: 20 giorni fa, 14 → 1,43; poco: 100 giorni fa, 180 → non ancora.
  const state = { cara: { d: 194 }, media: { d: 180 }, poco: { d: 100 } };
  assert.deepEqual(plan(u, state, new Set(), 200, 10).map((p) => p.id), ["cara", "nuova", "nuovaPoco", "media"]);
  assert.deepEqual(plan(u, state, new Set(), 200, 2).map((p) => p.id), ["cara", "nuova"]);
  // In collezione la poco cara ha intervallo 90: 100 giorni fa → dovuta.
  assert.ok(plan(u, state, new Set(["poco"]), 200, 10).some((p) => p.id === "poco"));
});

test("universo: carte con numero e totale, giapponesi coi nomi inglesi, giochi CardTrader, sigillati", () => {
  const u = buildUniverse({
    cards: {
      "lc-11": { id: "lc-11", set: "lc", localId: "11", name: "Gengar", cm: 1, variants: [1, 2] },
      "lc-99": { id: "lc-99", set: "lc", localId: "99", name: "Caterpie", cm: 3 },
    },
    cardsJa: { "PMCG5-45": { id: "PMCG5-45", set: "PMCG5", localId: "45", name: "エリカ", cm: 4 } },
    sets: { lc: { official: 110 } },
    asiaEn: { PMCG5: { 45: "Erika's Vileplume Lv.34" } },
    guide: { 1: 12, 2: 300, 3: 0.5, 4: 25 },
    ct: [{ prefix: "op:", label: "one piece", data: { sets: [], cards: [{ id: 7, n: "Luffy", num: "OP01-001", s: 1, en: [40, 3] }, { id: 8, n: "Zoro", num: "OP01-002", s: 1, en: [1, 3] }] } }],
    sealed: { p: [{ id: 9, n: "Evolving Skies Booster Box", cm: { trend: 300 } }, { id: 10, n: "Pack", cm: { trend: 5 } }, { id: 11, n: "Medaglia", t: "object", cm: { trend: 300 } }] },
  });
  // Tutti i prodotti, anche quelli da pochi centesimi (si aggiornano di rado); non gli oggetti da collezione.
  assert.deepEqual(u.map((p) => p.id), ["lc-11", "lc-99", "ja:PMCG5-45", "op:7", "op:8", "sl:9", "sl:10"]);
  assert.equal(u[0].value, 300); // il valore più alto tra i prodotti delle varianti
  assert.equal(u[0].cm, 12); // quello del prodotto della carta base
  assert.equal(query(u[0]), "Gengar 11/110");
  assert.equal(query(u[2]), "Erika's Vileplume Lv.34 45 japanese");
  assert.equal(query(u[3]), "Luffy OP01-001 one piece");
});

test("notte: ricerche entro la quota, si ferma alla quota eBay finita", async () => {
  let calls = 0;
  const ebay = { async search(q) { calls++; if (calls === 3) throw new Error("eBay search: HTTP 429"); return [{ title: `${q} Holo`, price: 10, currency: "EUR" }]; } };
  const universe = [1, 2, 3, 4].map((i) => ({ id: `c${i}`, kind: "card", name: "Gengar", number: String(i), total: 110, value: 10 * i }));
  const state = {};
  const log = await run({ ebay, universe, state, owned: new Set(), today: 200, budget: 10, pauseMs: 0 });
  assert.deepEqual(Object.keys(state).sort(), ["c3", "c4"]); // i due più cari, poi la quota è finita
  assert.deepEqual(state.c4, { d: 200, b: { "en|n": [10, 1] } });
  assert.ok(log.some((l) => /quota eBay finita dopo 2/.test(l)));
});

test("carte: inserzioni con più carte fuori, le parole del nome del prodotto restano", async () => {
  const { isBundle } = await import("../src/ebay.js");
  assert.equal(isBundle("Charizard 4/102 + Blastoise 2/102 Base Set"), true);
  assert.equal(isBundle("Charizard 4/102 Blastoise 2/102 Venusaur 15/102"), true);
  assert.equal(isBundle("Charizard 4/102 Base Set Holo x2"), true);
  assert.equal(isBundle("Charizard 4/102 Base Set Holo"), false);
  assert.equal(isBundle("Booster Bundle Scarlatto e Violetto 151", "151 Booster Bundle"), false);
  assert.equal(isBundle("Build & Battle Kit Destined Rivals", "Destined Rivals Build & Battle Kit"), false);
});
