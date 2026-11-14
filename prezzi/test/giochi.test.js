import test from "node:test";
import assert from "node:assert/strict";
import {
  BANDS, CHALLENGES, SINGLE_GAMES, buildGames, singleRules, challengeRounds, ctCards, epochDay, pokemonCards, priceOptions, sample, sealedCards, seeded, weekIndex,
} from "../src/giochi.js";

/** 400 carte per gioco, da 1 € a oltre 1.000 €. */
const cards = (prefix, n = 400) => Array.from({ length: n }, (_, i) => [`${prefix}${i}`, `Carta ${i}`, "Set", String(i), "foto", Math.round(100 * 1.018 ** i) + i]);
const pools = () => ({ pokemon: cards("pk"), ct: { op: cards("op:"), lc: cards("lc:"), db: cards("db:"), yg: cards("yg:") }, sealed: cards("sl:") });

test("settimana da lunedì, come nell'app", () => {
  assert.equal(epochDay("2026-11-11"), 20768);
  assert.equal(weekIndex("2026-11-11"), 2967);
  assert.equal(weekIndex("2026-11-15"), 2967); // domenica
  assert.equal(weekIndex("2026-11-16"), 2968); // lunedì
});

test("carte Pokémon: foto, prodotto Cardmarket e tendenza credibile", () => {
  const out = pokemonCards({
    cards: {
      "base1-4": { id: "base1-4", name: "Charizard", set: "base1", localId: "4", cm: 1 },
      "base1-5": { id: "base1-5", name: "Clefairy", set: "base1", localId: "5", cm: 2 }, // senza foto
      "base1-6": { id: "base1-6", name: "Gyarados", set: "base1", localId: "6", cm: 3 }, // tendenza rotta
      "base1-7": { id: "base1-7", name: "Hitmonchan", set: "base1", localId: "7", cm: 4 }, // sotto 1 €
      "base1-8": { id: "base1-8", name: "Machamp", set: "base1", localId: "8", cm: null },
    },
    images: [
      { id: "base1-4", image: "https://assets.tcgdex.net/en/base/base1/4" }, { id: "base1-5" },
      { id: "base1-6", image: "x" }, { id: "base1-7", image: "x" }, { id: "base1-8", image: "x" },
    ],
    sets: [{ id: "base1", name: "Base Set" }],
    guide: [
      { idProduct: 1, trend: 353.78, avg30: 340 }, { idProduct: 2, trend: 5, avg30: 5 },
      { idProduct: 3, trend: 900, avg30: 30 }, { idProduct: 4, trend: 0.4, avg30: 0.4 },
    ],
  });
  assert.deepEqual(out, [["base1-4", "Charizard", "Base Set", "4", "https://assets.tcgdex.net/en/base/base1/4", 35378]]);
});

test("carte degli altri giochi e sigillati", () => {
  const data = {
    sets: [{ id: 9, name: "Romance Dawn" }],
    cards: [
      { id: 1, n: "Luffy", num: "OP01-003", r: "Leader", v: "Alternate Art", s: 9, img: "/uploads/a.jpg", en: [12.5, 8] },
      { id: 2, n: "Zoro", num: "OP01-001", s: 9, img: "/uploads/b.jpg", en: [40, 2] }, // poche offerte
      { id: 3, n: "Nami", num: "OP01-016", s: 9, en: [9, 10] }, // senza foto
      { id: 4, n: "Sanji", num: "OP01-013", s: 9, img: "/uploads/c.jpg", jp: [9, 10] }, // senza prezzo inglese
      { id: 5, n: "Ace", num: "OP13-119", v: 'Pre-Errata Card | "[On Play]..." wrong text', s: 9, img: "/uploads/d.jpg", en: [375, 5] }, // errore di stampa
    ],
  };
  assert.deepEqual(ctCards(data, "op"), [["op:1", "Luffy", "Romance Dawn · Alternate Art", "OP01-003", "ct:/uploads/a.jpg", 1250]]);
  assert.deepEqual(ctCards(null, "op"), []);
  const sealed = sealedCards([{
    p: [
      { id: 1, n: "Booster Box", img: "/uploads/x.jpg", cm: { trend: 120 } },
      { id: 2, n: "ETB", img: "tp:55", cm: { trend: 60 } },
      { id: 3, n: "Foto eBay", img: "https://i.ebayimg.com/x.jpg", cm: { trend: 60 } },
      { id: 4, n: "Medaglia", t: "object", img: "https://x/y.jpg", cm: { trend: 60 } },
      { id: 5, n: "Senza prezzo", img: "/uploads/z.jpg", cm: null },
      { id: 6, n: "Foto di un fratello", img: "/uploads/k.jpg", ia: "case", cm: { trend: 600 } },
    ],
  }, null]);
  assert.deepEqual(sealed, [["sl:1", "Booster Box", "", "", "ct:/uploads/x.jpg", 12000], ["sl:2", "ETB", "", "", "tp:55", 6000]]);
});

test("lo stesso numero di carte per fascia di prezzo", () => {
  const out = sample(cards("pk"), 20, seeded(1));
  const perBand = BANDS.map((b, i) => out.filter((c) => c[5] < b && c[5] >= (BANDS[i - 1] ?? 0)).length);
  // La prima fascia (sotto 1 €) resta vuota: le carte partono da 1 €.
  assert.deepEqual(perBand, [0, 20, 20, 20, 20, 20, 20]);
  // Stesso seme = stesso campione; un altro giorno, un altro.
  assert.deepEqual(sample(cards("pk"), 20, seeded(1)), out);
  assert.notDeepEqual(sample(cards("pk"), 20, seeded(2)), out);
});

test("quattro prezzi, uno giusto, tondi quanto il giusto", () => {
  const rand = seeded(5);
  for (const price of [1, 100, 123, 1999, 15000, 35378, 250000]) {
    for (let i = 0; i < 50; i++) {
      const o = priceOptions(price, rand);
      assert.equal(new Set(o).size, 4, `${price} ${o}`);
      assert.equal(o.filter((x) => x === price).length, 1);
      assert.ok(o.every((x) => x > 0));
      if (price % 100 === 0) assert.ok(o.every((x) => x % 100 === 0), `${price} ${o}`);
    }
  }
  for (let i = 0; i < 50; i++) {
    const o = priceOptions(10000, rand, CHALLENGES.w.step);
    assert.ok(Math.max(...o) <= Math.min(...o) * 1.45 ** 3 * 1.01, String(o));
  }
});

test("domande delle sfide: quelle della settimana sono più difficili", () => {
  const p = pools();
  const all = { pk: p.pokemon, ...p.ct, sl: p.sealed };
  const daily = challengeRounds(all, seeded(1), CHALLENGES.d);
  const weekly = challengeRounds(all, seeded(1), CHALLENGES.w);
  assert.equal(daily.length, 10);
  assert.equal(weekly.length, 15);
  const ratio = (r) => Math.max(r.a[5], r.b[5]) / Math.min(r.a[5], r.b[5]);
  for (const [rounds, rules] of [[daily, CHALLENGES.d], [weekly, CHALLENGES.w]]) {
    const ids = [];
    for (const r of rounds) {
      if (r.t === "hl") {
        assert.ok(ratio(r) >= rules.ratio[0] && ratio(r) <= rules.ratio[1], `${ratio(r)}`);
        assert.equal(r.a[0].split(/\d/)[0], r.b[0].split(/\d/)[0]); // stesso gioco
        ids.push(r.a[0], r.b[0]);
      } else {
        assert.equal(r.o.length, 4);
        assert.ok(r.o.includes(r.c[5]));
        ids.push(r.c[0]);
      }
      for (const c of r.t === "hl" ? [r.a, r.b] : [r.c]) assert.ok(c[5] >= rules.min);
    }
    assert.equal(new Set(ids).size, ids.length); // mai due volte la stessa carta
    assert.ok(rounds.some((r) => r.t === "hl") && rounds.some((r) => r.t === "gp"));
  }
  assert.ok(weekly.some((r) => (r.c ?? r.a)[0].startsWith("sl:"))); // con i sigillati
  assert.ok(!daily.some((r) => (r.c ?? r.a)[0].startsWith("sl:")));
});

test("le sfide già pubblicate restano come sono", () => {
  const p = pools();
  const first = buildGames({ day: "2026-11-11", ...p });
  assert.deepEqual(Object.keys(first.d), ["20767", "20768", "20769"]); // ieri, oggi, domani
  assert.deepEqual(Object.keys(first.w), ["2967"]);
  assert.equal(first.g.pk.length > 0 && first.g.sl.length > 0, true);
  assert.ok(first.g.sl.every((c) => c[5] >= 1000)); // sigillati da 10 € in su
  // Il giorno dopo, con altri prezzi: le sfide di oggi e domani non cambiano, nasce quella di dopodomani.
  const other = { pokemon: cards("pk").map((c) => [...c.slice(0, 5), c[5] * 2]), ct: p.ct, sealed: p.sealed };
  const next = buildGames({ day: "2026-11-12", ...other, previous: first });
  assert.deepEqual(Object.keys(next.d), ["20768", "20769", "20770"]);
  assert.deepEqual(next.d[20768], first.d[20768]);
  assert.deepEqual(next.d[20769], first.d[20769]);
  assert.deepEqual(next.w[2967], first.w[2967]);
  assert.notDeepEqual(next.g.pk, first.g.pk); // il campione delle carte cambia ogni notte
  // Domenica nasce anche la sfida della settimana dopo.
  const sunday = buildGames({ day: "2026-11-15", ...p, previous: next });
  assert.deepEqual(Object.keys(sunday.w), ["2967", "2968"]);
  // Senza il file di prima (primo giro): tutto nuovo, ma lo stesso giorno dà le stesse sfide.
  assert.deepEqual(buildGames({ day: "2026-11-11", ...p }).d, first.d);
});

test("sfide con un gioco solo: stesse regole, tutte le domande di quel gioco", () => {
  const p = pools();
  const first = buildGames({ day: "2026-11-11", ...p });
  assert.deepEqual(Object.keys(first.dg), ["20767", "20768", "20769"]);
  assert.deepEqual(Object.keys(first.wg), ["2967"]);
  for (const game of SINGLE_GAMES) {
    const prefix = game === "pk" ? "pk" : `${game}:`;
    const daily = first.dg[20768][game], weekly = first.wg[2967][game];
    assert.equal(daily.length, 10, game);
    assert.equal(weekly.length, 15, game);
    for (const r of [...daily, ...weekly]) for (const c of r.t === "hl" ? [r.a, r.b] : [r.c]) assert.ok(c[0].startsWith(prefix), `${game} ${c[0]}`);
    assert.notDeepEqual(daily, first.dg[20769][game]); // ogni giorno le sue
  }
  assert.deepEqual(singleRules("d", "yg").games, { yg: 10 });
  assert.deepEqual(singleRules("w", "pk").games, { pk: 15 });
  // Diverse da quella con tutti i giochi, che resta com'era (le app 0.9.175 leggono solo "d" e "w").
  assert.equal(first.d[20768].length, 10);
  assert.notDeepEqual(first.dg[20768].pk, first.d[20768]);
  // Il giorno dopo restano ferme; un gioco senza carte non ha la sua sfida.
  const next = buildGames({ day: "2026-11-12", pokemon: p.pokemon, ct: { op: p.ct.op }, sealed: [], previous: first });
  assert.deepEqual(next.dg[20768], first.dg[20768]);
  assert.deepEqual(next.wg[2967], first.wg[2967]);
  assert.deepEqual(Object.keys(next.dg[20770]), ["pk", "op"]);
  // Un file di prima senza le sfide per gioco (quello della 0.9.175): nascono, e le altre non cambiano.
  const { dg, wg, ...old } = first;
  const upgraded = buildGames({ day: "2026-11-11", ...p, previous: old });
  assert.deepEqual(upgraded.d, first.d);
  assert.deepEqual(upgraded.dg, first.dg);
});
