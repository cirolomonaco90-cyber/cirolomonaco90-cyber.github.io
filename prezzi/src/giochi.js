// Carte per i giochi sui prezzi dell'app ("Più o meno", "Indovina il prezzo") e sfida della settimana uguale per tutti.
//
//   node prezzi/src/giochi.js <tcgdex-carte.json> <cartella con i cataloghi del job> <giochi.json>
// Nella cartella: onepiece.json, lorcana.json, dragonball.json, yugioh.json, sealed.json e i sigillati degli altri giochi
// (mancanti = saltati). File pubblicato in giochi/v1/giochi.json:
//   { v, day, g: { pk|op|lc|db|yg|sl: [[id, nome, set, numero, foto, centesimi], ...] },
//     d: { giorno dal 1970: [domande] }, w: { settimana: [domande] },
//     dg: { giorno: { pk|op|lc|db|yg: [domande] } }, wg: { settimana: { gioco: [domande] } } }
// - g: per ogni gioco un campione di carte con un prezzo affidabile, lo stesso numero per fascia di prezzo (da 1 € a oltre
//   300 €), che cambia ogni notte. Pokémon: tendenza del listino ufficiale Cardmarket; altri giochi: stima Near Mint delle
//   offerte CardTrader in inglese (almeno 3 offerte); sigillati: tendenza Cardmarket.
// - d, w: le domande della sfida del giorno e di quella della settimana (più difficile) con tutti i giochi ("modalità
//   estrema"); dg, wg: le stesse sfide con un gioco solo, a scelta di chi gioca. Si scelgono una volta sola e poi
//   restano ferme con i prezzi di quel giorno: tutti giocano le stesse domande con le stesse risposte.
//     { t: "hl", a: carta, b: carta }  "b vale di più o di meno di a?"
//     { t: "gp", c: carta, o: [quattro prezzi in centesimi] }  "quanto vale c?" (uno dei quattro è il suo)

import fs from "node:fs/promises";
import path from "node:path";
import { fetchRetry } from "./rete.js";
import { DATI } from "./dati.js";

const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const TCGDEX_CARDS = "https://api.tcgdex.net/v2/en/cards";
const TCGDEX_SETS = "https://api.tcgdex.net/v2/en/sets";
export const PUBLISHED = `${DATI}/giochi/v1/giochi.json`;

/** Fasce di prezzo in centesimi: da ogni fascia lo stesso numero di carte, così non escono solo carte da 1 €. */
export const BANDS = [100, 300, 1000, 3000, 10000, 30000, Infinity];

/** Carte per fascia in ogni gioco, e da che prezzo (centesimi) una carta entra. */
export const GAMES = {
  pk: { perBand: 150, min: 100 },
  op: { perBand: 70, min: 100 },
  lc: { perBand: 70, min: 100 },
  db: { perBand: 70, min: 100 },
  yg: { perBand: 70, min: 100 },
  sl: { perBand: 60, min: 1000 },
};

/**
 * Le due sfide uguali per tutti. Del giorno: 10 domande, coppie dove il più caro vale da 1,3 a 4 volte l'altro e prezzi
 * tra cui scegliere lontani da 1,6 a 2,2 volte. Della settimana, più difficile: 15 domande con anche i sigillati, coppie
 * vicine (da 1,1 a 1,5 volte) e prezzi vicini (da 1,25 a 1,45 volte). [games]: domande per gioco; [min]: da che prezzo
 * (centesimi) una carta entra, così sono carte che si riconoscono.
 */
export const CHALLENGES = {
  d: { games: { pk: 4, yg: 2, op: 2, lc: 1, db: 1 }, min: 500, ratio: [1.3, 4], step: [1.6, 2.2] },
  w: { games: { pk: 5, yg: 3, op: 2, lc: 2, db: 2, sl: 1 }, min: 1000, ratio: [1.1, 1.5], step: [1.25, 1.45] },
};

/**
 * Le stesse sfide con un gioco solo (0.9.176, richiesto dall'utente: "scegliere se giocare con un solo tcg ... oppure la
 * modalità estrema (tutti i tcg)"): chi sceglie un gioco ha le sue domande, tutte di quel gioco, con le stesse regole di
 * difficoltà e lo stesso numero di domande; nell'app valgono meno punti di quelle con tutti i giochi.
 */
export const SINGLE_GAMES = ["pk", "op", "lc", "db", "yg"];
export const singleRules = (kind, game) => {
  const rules = CHALLENGES[kind];
  return { ...rules, games: { [game]: Object.values(rules.games).reduce((a, b) => a + b, 0) } };
};

/** Numeri a caso ripetibili dal seme (mulberry32): stesso giorno = stesso campione. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const epochDay = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);

/** Settimana da lunedì, come Gamification.weekIndex nell'app (il 1/1/1970 era giovedì). */
export const weekIndex = (day) => Math.floor((epochDay(day) + 3) / 7);

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const bandOf = (cents) => BANDS.findIndex((b) => cents < b);

/** Lo stesso numero di carte per fascia di prezzo ([perBand]), a caso; le fasce povere danno quelle che hanno. */
export function sample(cards, perBand, rand) {
  const bands = BANDS.map(() => []);
  for (const c of cards) bands[bandOf(c[5])].push(c);
  return bands.flatMap((b) => shuffle(b, rand).slice(0, perBand));
}

const cents = (eur) => Math.round(eur * 100);

/**
 * Carte Pokémon: quelle di TCGdex con la foto, un prodotto Cardmarket e una tendenza credibile (non lontana più di 2,5
 * volte dalla media a 30 giorni: le tendenze rotte da una vendita darebbero una risposta "giusta" assurda).
 */
export function pokemonCards({ cards = {}, images = [], sets = [], guide = [] }) {
  const img = new Map(images.filter((c) => c.image).map((c) => [c.id, c.image]));
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  const price = new Map();
  for (const g of guide) {
    const t = g.trend, a = g.avg30;
    if (!(t >= 1) || !(a > 0) || t > a * 2.5 || t < a / 2.5) continue;
    price.set(g.idProduct, t);
  }
  const out = [];
  for (const c of Object.values(cards)) {
    const p = price.get(c.cm), i = img.get(c.id);
    if (!p || !i || !c.name) continue;
    out.push([c.id, c.name, setName.get(c.set) ?? "", decodeURIComponent(String(c.localId ?? "")), i, cents(p)]);
  }
  return out;
}

const ODD = /errata|misprint|wrong text|sample|error card/i;

/** Carte di un gioco CardTrader: stima Near Mint in inglese con almeno 3 offerte, con la foto. */
export function ctCards(data, prefix) {
  const setName = new Map((data?.sets ?? []).map((s) => [s.id, s.name]));
  const out = [];
  for (const c of data?.cards ?? []) {
    const [p, n] = c.en ?? [];
    if (!(p >= 1) || !(n >= 3) || p > 20000 || !c.img || !c.n) continue;
    const set = [setName.get(c.s), c.v && c.v !== c.r ? c.v : null].filter(Boolean).join(" · ");
    // Carte con errori di stampa e campioni (CardTrader: "Pre-Errata Cards", "wrong text", foto con "SAMPLE"): fuori, non si riconoscono.
    if (ODD.test(set)) continue;
    out.push([`${prefix}:${c.id}`, c.n, set, c.num ?? "", `ct:${c.img}`, cents(p)]);
  }
  return out;
}

/** Sigillati (di tutti i giochi) con la tendenza Cardmarket e una foto che non sia di un'inserzione. */
export function sealedCards(catalogs) {
  const out = [];
  for (const data of catalogs) {
    for (const p of data?.p ?? []) {
      const t = p.cm?.trend;
      if (!(t >= 10) || !p.img || !p.n || p.t === "object" || p.ia || p.img.includes("ebayimg")) continue;
      const img = p.img.startsWith("tp:") || p.img.startsWith("http") ? p.img : `ct:${p.img}`;
      out.push([`sl:${p.id}`, p.n, "", "", img, cents(t)]);
    }
  }
  return out;
}

/**
 * I quattro prezzi tra cui scegliere per una carta da [price] centesimi: il suo e tre sbagliati, ognuno il precedente per
 * un fattore tra [lo] e [hi], col giusto in una posizione a caso. Gli sbagliati sono tondi quanto il giusto (se il giusto è
 * "150,00 €" e gli altri "71,43 €" si capisce subito). Stessa regola in PriceGames.kt.
 */
export function priceOptions(price, rand, [lo, hi] = CHALLENGES.d.step) {
  const k = Math.floor(rand() * 4);
  const f = lo + rand() * (hi - lo);
  const step = price % 100 === 0 ? 100 : price % 10 === 0 ? 10 : 1;
  const out = [];
  for (let i = 0; i < 4; i++) {
    if (i === k) { out.push(price); continue; }
    let v = Math.max(step, Math.round((price * f ** (i - k)) / step) * step);
    while (out.includes(v) || v === price) v += step;
    out.push(v);
  }
  return out;
}

/**
 * Le domande di una sfida ([rules] = una voce di [CHALLENGES]): per ogni gioco metà "più o meno" e metà "indovina il
 * prezzo", mescolate.
 */
export function challengeRounds(pool, rand, rules) {
  const rounds = [];
  let kind = 0;
  const [lo, hi] = rules.ratio;
  for (const [game, n] of Object.entries(rules.games)) {
    const cards = shuffle((pool[game] ?? []).filter((c) => c[5] >= rules.min), rand);
    const used = new Set();
    const take = (ok = () => true) => {
      const c = cards.find((x) => !used.has(x[0]) && ok(x));
      if (c) used.add(c[0]);
      return c;
    };
    for (let i = 0; i < n; i++) {
      if (kind++ % 2 === 0) {
        const a = take();
        const b = a && take((x) => { const r = Math.max(x[5], a[5]) / Math.min(x[5], a[5]); return r >= lo && r <= hi; });
        if (a && b) rounds.push({ t: "hl", a, b });
      } else {
        const c = take();
        if (c) rounds.push({ t: "gp", c, o: priceOptions(c[5], rand, rules.step) });
      }
    }
  }
  return shuffle(rounds, rand);
}

/**
 * Il file dei giochi del giorno [day]. Le sfide di ieri, oggi e domani ("d": giorno dal 1970 -> domande) e delle loro
 * settimane ("w": settimana -> domande): chi è in un altro fuso o apre l'app prima del giro della notte trova comunque la
 * sua. Una sfida già nel file pubblicato ([previous]) resta com'è, con i prezzi del giorno in cui è nata.
 */
export function buildGames({ day, pokemon = [], ct = {}, sealed = [], previous = null }) {
  const today = epochDay(day);
  const all = { pk: pokemon, ...ct, sl: sealed };
  const g = {};
  const rand = seeded(today);
  for (const [game, { perBand, min }] of Object.entries(GAMES)) {
    const cards = (all[game] ?? []).filter((c) => c[5] >= min);
    if (cards.length) g[game] = sample(cards, perBand, rand);
  }
  const d = {}, w = {}, dg = {}, wg = {};
  // Le sfide di un gioco solo: quelle già pubblicate restano, le altre nascono ora (un gioco senza carte resta fuori).
  const single = (kind, period, before) => {
    const out = {};
    SINGLE_GAMES.forEach((game, i) => {
      const rounds = before?.[game]?.length
        ? before[game]
        : challengeRounds(all, seeded(period * 15485863 + (i + 1) * 1009 + (kind === "d" ? 3 : 4)), singleRules(kind, game));
      if (rounds.length) out[game] = rounds;
    });
    return out;
  };
  for (const n of [today - 1, today, today + 1]) {
    d[n] = previous?.d?.[n]?.length ? previous.d[n] : challengeRounds(all, seeded(n * 7919 + 1), CHALLENGES.d);
    dg[n] = single("d", n, previous?.dg?.[n]);
    const k = Math.floor((n + 3) / 7);
    w[k] ??= previous?.w?.[k]?.length ? previous.w[k] : challengeRounds(all, seeded(k * 104729 + 2), CHALLENGES.w);
    wg[k] ??= single("w", k, previous?.wg?.[k]);
  }
  return { v: 1, day, g, d, w, dg, wg };
}

const readJson = (f) => fs.readFile(f, "utf8").then(JSON.parse).catch(() => null);
async function getJson(url) {
  const r = await fetchRetry(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** Il file pubblicato: null se non c'è ancora (404); un errore se non si riesce a sapere (la sfida non va rifatta a metà settimana). */
async function published() {
  const r = await fetchRetry(`${PUBLISHED}?t=${Date.now()}`);
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`giochi.json pubblicato: HTTP ${r.status}`);
  return r.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cardsFile, dir, out] = process.argv.slice(2);
  const day = process.env.GIOCHI_GIORNO || new Date().toISOString().slice(0, 10);
  const [images, sets, guide, previous] = await Promise.all([
    getJson(TCGDEX_CARDS), getJson(TCGDEX_SETS), getJson(GUIDE).then((g) => g.priceGuides ?? []), published(),
  ]);
  const pokemon = pokemonCards({ cards: (await readJson(cardsFile)) ?? {}, images, sets, guide });
  const ct = {};
  for (const [file, prefix] of [["onepiece.json", "op"], ["lorcana.json", "lc"], ["dragonball.json", "db"], ["yugioh.json", "yg"]]) {
    ct[prefix] = ctCards(await readJson(path.join(dir, file)), prefix);
  }
  const sealed = sealedCards(await Promise.all(
    ["sealed.json", "onepiece-sealed.json", "lorcana-sealed.json", "dragonball-sealed.json", "yugioh-sealed.json"].map((f) => readJson(path.join(dir, f))),
  ));
  const games = buildGames({ day, pokemon, ct, sealed, previous });
  if (!games.g.pk?.length) throw new Error("nessuna carta Pokémon: file non scritto");
  await fs.writeFile(out, JSON.stringify(games));
  const fresh = (now, before) => Object.keys(now).filter((k) => !before?.[k]?.length).length;
  console.log(`Giochi: ${Object.entries(games.g).map(([k, v]) => `${k} ${v.length}`).join(", ")} (candidate: pk ${pokemon.length}, ${Object.entries(ct).map(([k, v]) => `${k} ${v.length}`).join(", ")}, sl ${sealed.length}); sfide del giorno nuove ${fresh(games.d, previous?.d)}, della settimana nuove ${fresh(games.w, previous?.w)}; per gioco: ${Object.entries(games.dg).map(([k, v]) => `${k} ${Object.keys(v).join("/")}`).join(", ")}`);
}
