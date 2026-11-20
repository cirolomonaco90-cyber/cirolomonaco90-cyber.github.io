import test from "node:test";
import assert from "node:assert/strict";
import { buildSection, cleanName, nameKey, lorcanaSection, lorcanaSetCode, isPocketSet } from "../src/illustratori.js";

test("nomi di TCGdex scritti in più modi: uno solo", () => {
  assert.equal(cleanName('"Big Mama" Tagawa"'), '"Big Mama" Tagawa');
  assert.equal(cleanName('"Big Mama" Tagawa"Big Mama" Tagawa'), '"Big Mama" Tagawa');
  assert.equal(cleanName("  Ken   Sugimori "), "Ken Sugimori");
  assert.equal(nameKey("Saino Misaki"), nameKey("saino misaki"));
  assert.equal(nameKey('"Big Mama" Tagawa"'), nameKey('"Big Mama" Tagawa'));
  assert.notEqual(nameKey("Ken Sugimori"), nameKey("Sugimori"));
});

test("illustratori da chi ha più carte, carte dal set più recente, copertina la carta che vale di più", () => {
  const img = (p) => `https://assets.tcgdex.net/en/${p}`;
  const s = buildSection([
    { raw: "Mitsuhiro Arita", cards: [{ id: "base1-4", image: img("base/base1/4") }, { id: "sv1-10", image: img("sv/sv1/10") }, { id: "base1-58" }] },
    { raw: "saino misaki", cards: [{ id: "sv1-1", image: img("sv/sv1/1") }] },
    { raw: "Saino Misaki", cards: [{ id: "sv1-1", image: img("sv/sv1/1") }, { id: "sv1-2", image: img("sv/sv1/2") }, { id: "sv1-11", image: img("sv/sv1/11") }, { id: "base1-9" }] },
    { raw: "Solo Pocket", cards: [{ id: "A1-001", image: img("tcgp/A1/001") }, { id: "P-A-005" }] },
    { raw: "Vuoto", cards: [] },
  ], { order: new Map([["base1", 0], ["sv1", 10]]), price: new Map([["base1-4", 350], ["sv1-10", 2]]) });
  assert.deepEqual(s.n, ["Saino Misaki", "Mitsuhiro Arita"]);
  // Set più recente prima, e dentro il set i numeri in ordine (2 prima di 11).
  assert.deepEqual(s.c, ["sv1-1 sv1-2 sv1-11 base1-9", "sv1-10 base1-4 base1-58"]);
  // Arita: la carta col prezzo più alto; Misaki: nessun prezzo, la più recente con la foto.
  assert.deepEqual(s.f, ["en/sv/sv1/1", "en/base/base1/4"]);
  // TCGdex non distingue maiuscole e minuscole: "Saino Misaki" e "saino misaki" sono una richiesta sola, niente in q.
  assert.deepEqual(s.q, {});
});

test("due scritture davvero diverse restano tutte e due da chiedere", () => {
  const s = buildSection([
    { raw: '"Big Mama" Tagawa', cards: [{ id: "basep-40" }, { id: "basep-41" }] },
    { raw: '"Big Mama" Tagawa"', cards: [{ id: "ex4-72" }] },
  ]);
  assert.deepEqual(s.n, ['"Big Mama" Tagawa']);
  assert.equal(s.c[0].split(" ").length, 3);
  assert.deepEqual(s.q[0].sort(), ['"big mama" tagawa', '"big mama" tagawa"']);
  assert.deepEqual(s.f, [""]);
});

test("set di TCG Pocket riconosciuti come nell'app", () => {
  for (const id of ["A1", "A2b", "B2", "P-A"]) assert.ok(isPocketSet(id), id);
  for (const id of ["base1", "sv03.5", "S4a", "SV2a", "XY2", "PMCG1"]) assert.ok(!isPocketSet(id), id);
});

test("Lorcana: set e numero con lo stesso nome, promo dal loro gruppo, il resto solo se il disegno è uno", () => {
  assert.equal(lorcanaSetCode("ch1"), "1");
  assert.equal(lorcanaSetCode("lor12"), "12");
  assert.equal(lorcanaSetCode("quest2"), "Q2");
  assert.equal(lorcanaSetCode("promos"), null);
  const all = { cards: [
    { setCode: "1", number: 41, fullName: "Elsa - Snow Queen", artists: ["Nicholas Kole"] },
    { setCode: "1", number: 207, fullName: "Elsa - Spirit of Winter", artists: ["Matthew Robert Davies"] },
    { setCode: "1", number: 42, fullName: "Elsa - Spirit of Winter", artists: ["Brian Weisz"] },
    { setCode: "2", number: 6, fullName: "HeiHei - Peckish Pal", artistsText: "Veronica Di Lorenzo / Livio Cacciatore" },
    { setCode: "1", number: 23, fullName: "Stitch - Rock Star", artists: ["Simangaliso Sibaya"] },
    { setCode: "1", number: 23, promoGrouping: "P1", fullName: "Stitch - Rock Star", artists: ["Altro Disegno"] },
    { setCode: "3", number: 5, fullName: "Pluto - Friendly Pooch", artists: ["Grace Tran"] },
  ] };
  const catalog = {
    sets: [{ id: 1, code: "ch1" }, { id: 2, code: "lor2" }, { id: 3, code: "promos" }, { id: 4, code: "lcp" }, { id: 5, code: "lor3" }],
    cards: [
      { id: 100, n: "Elsa - Snow Queen", num: "041", s: 1 },
      { id: 101, n: "Elsa - Spirit of Winter", num: "207", s: 1 },
      { id: 102, n: "HeiHei - Peckish Pal", num: "6", s: 2 },
      { id: 103, n: "Stitch - Rock Star", num: "23", s: 3 },
      // Promo che LorcanaJSON non ha in quel gruppo, con due disegni diversi nei suoi dati: nessun illustratore.
      { id: 104, n: "Stitch - Rock Star", num: "9", s: 4 },
      // Nessun abbinamento per numero, ma il nome ha un disegno solo: quello.
      { id: 105, n: "Pluto - Friendly Pooch", num: "77", s: 4 },
      // Stesso numero di un'altra carta: il nome diverso scarta l'abbinamento.
      { id: 106, n: "Mickey Mouse - Detective", num: "41", s: 1 },
    ],
  };
  const s = lorcanaSection(catalog, all);
  const of = (name) => s.c[s.n.indexOf(name)];
  assert.equal(of("Nicholas Kole"), "100");
  assert.equal(of("Matthew Robert Davies"), "101");
  assert.equal(of("Veronica Di Lorenzo"), "102");
  assert.equal(of("Livio Cacciatore"), "102");
  assert.equal(of("Altro Disegno"), "103");
  assert.equal(of("Grace Tran"), "105");
  assert.equal(s.matched, 5);
  assert.equal(s.total, 7);
  assert.ok(!s.c.join(" ").split(" ").includes("104"));
  assert.ok(!s.c.join(" ").split(" ").includes("106"));
});
