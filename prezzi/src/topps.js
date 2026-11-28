// Catalogo «Topps» (22 novembre 2026, richiesto dall'utente: "Voglio inserire anche le Topps nell'app ... tutte nella categoria
// Topps"). Per ora le Topps Pokémon 1999-2004: l'elenco delle carte è prezzi/dati/topps-pokemon.json (scripts/topps-elenco.py,
// dalla guida di Elite Fourum), i prezzi e le foto vengono dalle inserzioni eBay (Browse API ufficiale): nessun mercato delle
// carte che usiamo (CardTrader, Cardmarket, TCGplayer) ha le Topps.
//
// Ogni notte (parte "cardmarket" del job, dopo i prezzi eBay degli altri prodotti) si cercano a rotazione al massimo
// TOPPS_EBAY_MAX carte: una ricerca per carta (set + numero) su eBay USA, che dice i prezzi delle carte inglesi, e per i set
// usciti anche in Europa (TV Animation 1-3) una su eBay.it per italiano, tedesco, francese e spagnolo. I titoli si dividono per
// versione (normale, foil argento, foil arcobaleno; nei Chrome Standard, Spectra, Sparkle, Tekno), lingua e voto delle gradate.
// Le risposte restano nello stato pubblicato (prezzi/v1/topps-ebay.json) fino alla ricerca dopo, come per i prezzi eBay.
// Il catalogo esce nello stesso formato dei giochi CardTrader (onepiece.js): l'app lo legge con lo stesso codice.
//
//   EBAY_APP_ID=... EBAY_CERT_ID=... node prezzi/src/topps.js <topps-pokemon.json> <topps-ebay.json> <topps.json> [ricerche]
import fs from "node:fs/promises";
import { Ebay, isBundle } from "./ebay.js";
import { round2 } from "./stats.js";
import { nameLike } from "./somiglianza.js";
import { gradeOf, priceOf, NOT_A_CARD, WORN, OUTLIER_TIMES } from "./topps-regole.js";
import { quotaWindow, usedInWindow, addCalls, dailyBudget, remainingQuota, quotaLine, isQuotaError } from "./ebay-quota.js";

export { gradeOf, priceOf, NOT_A_CARD, WORN, OUTLIER_TIMES };

const DAY_MS = 86_400_000;
/** Ricerche a notte (ognuna è una carta su un mercato): ~1.240 carte e ~300 dei set europei, un giro intero in 5 notti. */
const MAX_SEARCHES = 300;
/** Chiamate lasciate libere agli altri lavori della quota eBay (ebay-quota.js): girano dopo i prezzi eBay della notte. */
const TOPPS_RESERVE = 1200;
/** Ogni carta si ricerca dopo questi giorni (le Topps cambiano prezzo piano; quelle senza inserzioni più di rado). */
export const REFRESH_DAYS = 14;
const EMPTY_REFRESH_DAYS = 30;
/**
 * Dollari per un euro (cambio BCE, campo "usdEur" del catalogo TCGplayer, come Valuation.usdPerEur nell'app): un prezzo in
 * dollari vale prezzo / questo in euro. Di riserva quando il catalogo non si legge.
 */
const USD_PER_EUR_FALLBACK = 1.1;

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2019']/g, "");

// ---------------------------------------------------------------------------------------------------------------------
// Set e sezioni nel titolo

/** Parole delle sezioni delle carte speciali: una carta base non le ha, una speciale le ha. */
const SECTION_WORDS = {
  "Die-Cut": /\bdie\s?-?\s?cut|\bdiecut|\bevolution\b|\bevo\s?\d/,
  Sticker: /\bstickers?\b|\bstick-?ons?\b|\badesiv/,
  "Pop-Up": /\bpop\s?-?\s?ups?\b/,
  Clear: /\bclear\b|\bacetate\b|\btrasparent/,
  Foilgram: /\bfoil\s?-?\s?grams?\b/,
  "Tin Topper": /\btin\b|\btopper\b|\bjumbo\b/,
  Oversized: /\boversized?\b|\bjumbo\b|\bbig\b/,
  "First Appearance": /\bfirst appearance\b/,
  Puzzle: /\bpuzzle\b/,
};
/** Codici delle carte delle altre sezioni ("TV2", "HV6", "PC3", "E6/12", "EV1"...): con uno di questi non è una carta base. */
const OTHER_CODES = /\b(tv|hv|ep|or|pc|ev|evo|snap|e)\s?-?\s?\d{1,2}\b|\bstage\s?[23]\b/;




const LANGS = [
  ["it", /\b(ita|italian\w*|italiano|italiana)\b/],
  ["de", /\b(ger|german|deutsch|tedesc\w)\b/],
  ["fr", /\b(fra|french|francais|frances\w)\b/],
  ["es", /\b(esp|spanish|espanol|spagnol\w)\b/],
  ["en", /\b(eng|english|inglese|englisch)\b/],
];

/** Lingua scritta nel titolo, null se non la dice. */
function titleLang(title) {
  const t = norm(title);
  return LANGS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** Il set nel titolo: per ogni set le parole che servono e quelle che dicono un altro set. */
export function setOk(title, code) {
  const t = norm(title).replace(/\bt\.\s?v\./g, "tv");
  if (!/\btopps\b/.test(t)) return false;
  const chrome = /\bchrome\b/.test(t);
  const movie = /\bmovie\b|\bfilm\b|\bmewtwo strikes back\b/.test(t);
  const johto = /\bjohto\b/.test(t);
  const adv = /\badvanced?\b/.test(t);
  const challenge = /\bchallenge\b/.test(t);
  const s3 = /\bseries\s?(3|three|iii)\b/.test(t);
  switch (code) {
    case "TV1": case "TV2": case "TV3":
      return !chrome && !movie && !johto && !adv;
    // Le carte "E1 of 12"... "Stage 3" esistono solo nel primo film: spesso in vendita senza la parola "movie".
    case "MOV1": return (movie || /\be\s?\d{1,2}\s?(\/|of)\s?12\b/.test(t)) && !chrome && !/\b2000\b/.test(t);
    case "MOV2": return movie && !chrome && /\b2000\b/.test(t);
    case "CHR1": case "CHR2": return chrome && !movie && !johto;
    case "JOH1": case "JOH2": return johto && !s3;
    case "JOH3": return johto && s3;
    case "ADV": return adv && !challenge;
    case "ADVC": return adv && challenge;
    default: return false;
  }
}

/** Il numero della carta nel titolo, scritto in uno dei modi dei venditori ("#6", "#06", "TV2", "TV 2", "E6/12", "PC3"). */
function numberOk(title, card, sameNameInSection) {
  const t = norm(title).replace(/\bt\.\s?v\./g, "tv");
  const m = String(card.num).match(/^([A-Za-z]*)(\d+)(W?)$/);
  if (!m) return false;
  const [, prefix, digits] = m;
  const n = String(Number(digits));
  const p = prefix.toLowerCase();
  if (card.r === "Base") {
    if (OTHER_CODES.test(t)) return false;
    return new RegExp(`(^|[\\s#(\\[])0*${n}(?![0-9]|\\s?/|\\s?of\\b)`).test(t);
  }
  if (["tv", "hv", "ep", "or", "pc", "ev", "evo", "snap", "e"].includes(p)) {
    return new RegExp(`\\b${p}\\s?-?\\s?#?0*${n}\\b`).test(t);
  }
  // Puzzle "P01 of 6" e le carte speciali senza codice: "1 of 10", "1/10", oppure basta il nome se è l'unico della sezione.
  if (new RegExp(`(^|[^0-9])0*${n}\\s?(of|/)\\s?\\d`).test(t)) return true;
  return !sameNameInSection;
}

/** Il nome nel titolo: per somiglianza (somiglianza.js); per i titoli lunghi delle scene dei film, tre parole su cinque. */
function nameOk(title, card) {
  const first = String(card.n).split(/\s*(?:&|,)\s*/)[0].replace(/\(.*?\)/g, "").trim();
  const words = norm(first).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["the", "and", "pokemon"].includes(w));
  if (!words.length) return true;
  if (words.length <= 2) return nameLike(title, first);
  const t = norm(title);
  const hit = words.filter((w) => t.includes(w)).length;
  return hit / words.length >= 0.6;
}

/** La sezione della carta nel titolo: le carte speciali con le loro parole, le carte base e TV/HV/EP/OR/snap senza. */
function sectionOk(title, card) {
  const t = norm(title);
  const own = SECTION_WORDS[card.r];
  if (own) return own.test(t);
  if (card.r === "Evolution") return /\bstage\b|\be\s?\d{1,2}\s?(of|\/)|\be\s?\d{1,2}\b|\bevolution\b/.test(t) && !SECTION_WORDS["Die-Cut"].test(t.replace(/\bevolution\b/g, ""));
  return !Object.entries(SECTION_WORDS).some(([k, re]) => k !== "Puzzle" && re.test(t));
}

/** La versione nel titolo: null = normale (o Chrome Standard), "Silver Foil", "Rainbow Foil", "Spectra", "Sparkle", "Tekno". */
export function finishOf(title, kind) {
  const t = norm(title);
  if (kind === "chrome") {
    if (/\btekno\b/.test(t)) return "Tekno";
    if (/\bsparkle\b/.test(t)) return "Sparkle";
    if (/\bspectr[ae]\b/.test(t)) return "Spectra";
    return null;
  }
  const nonFoil = /\bnon\s?-?\s?(foil|holo)\b|\bnot (foil|holo)\b/.test(t);
  if (nonFoil) return null;
  if (kind === "foil3" && /\brainbow\b|\barcobaleno\b|\bchromatic\b/.test(t)) return "Rainbow Foil";
  if (/\bfoil\b|\bholo\w*\b|\bholographic\b|\bsilver\b|\bolograf\w*\b|\bbrillant\w*\b|\bshiny\b/.test(t)) return "Silver Foil";
  return null;
}


// ---------------------------------------------------------------------------------------------------------------------
// Ricerche

/** Le carte da cercare: una per set + numero + sezione, con le sue versioni (stampe). */
export function groups(data) {
  const sets = new Map(data.sets.map((s) => [s.id, s]));
  const by = new Map();
  for (const c of data.cards) {
    const key = `${c.s}|${c.r}|${c.num}`;
    if (!by.has(key)) by.set(key, { key, set: sets.get(c.s), num: c.num, r: c.r, n: c.n, dex: c.dex ?? null, prints: [] });
    by.get(key).prints.push(c);
  }
  const list = [...by.values()];
  // Nomi ripetuti nella stessa sezione (adesivi del primo film "Pikachu" due volte): lì serve anche il numero "N of M".
  const names = new Map();
  for (const g of list) {
    const k = `${g.set.id}|${g.r}|${norm(g.n)}`;
    names.set(k, (names.get(k) ?? 0) + 1);
  }
  for (const g of list) g.sameName = names.get(`${g.set.id}|${g.r}|${norm(g.n)}`) > 1;
  return list;
}

/** Versioni delle carte del set ([FINISHES] di topps-elenco.py). */
function kindOf(set) {
  if (set.code.startsWith("CHR")) return "chrome";
  return ["TV1", "TV2", "TV3", "MOV1", "MOV2"].includes(set.code) ? "foil3" : "foil2";
}

/** Le parole della ricerca: "topps pokemon chrome charizard 6", "topps pokemon tv animation pikachu TV2". */
export function queryOf(g) {
  const s = g.set.code;
  const setWords = { TV1: "tv animation", TV2: "tv animation", TV3: "tv animation", MOV1: "movie", MOV2: "movie 2000", CHR1: "chrome", CHR2: "chrome",
    JOH1: "johto", JOH2: "johto league champions", JOH3: "johto series 3", ADV: "advanced", ADVC: "advanced challenge" }[s];
  const section = { "Die-Cut": "die cut", Sticker: "sticker", "Pop-Up": "pop up", Clear: "clear", Foilgram: "foilgram", "Tin Topper": "tin", Oversized: "oversized", "First Appearance": "first appearance", Puzzle: "puzzle" }[g.r] ?? "";
  const name = String(g.n).split(/\s*(?:&|,)\s*/)[0].replace(/[()"!?.:]/g, " ").replace(/\s+/g, " ").trim();
  const coded = /^(TV|HV|EP|OR|PC|EV|EVO|SNAP|E)\d/.test(g.num);
  const num = coded ? g.num : g.r === "Base" ? `${Number(g.num)}` : "";
  // Le scene dei film hanno titoli lunghi: bastano le prime parole.
  const short = g.r === "Base" && s.startsWith("MOV") ? name.split(" ").slice(0, 4).join(" ") : name;
  return `topps pokemon ${setWords} ${section} ${short} ${num}`.replace(/\s+/g, " ").trim();
}

/**
 * Le inserzioni di una carta divise per stampa e secchio: { cardId: { "en": [prezzi], "en|g:PSA 9": [...], img } }. [usdPerEur]
 * (dollari per un euro) per i prezzi in dollari; [market] "US" (inglese se il titolo non dice la lingua) o "IT" (solo le lingue europee scritte nel titolo).
 */
export function split(items, g, { market, usdPerEur }) {
  const kind = kindOf(g.set);
  const byFinish = new Map(g.prints.map((p) => [p.v ?? null, p]));
  const out = {};
  for (const i of items) {
    const title = i.title ?? "";
    const t = norm(title);
    if (NOT_A_CARD.test(t) || isBundle(title, g.n)) continue;
    if (!setOk(title, g.set.code) || !sectionOk(title, g) || !numberOk(title, g, g.sameName) || !nameOk(title, g)) continue;
    const eur = i.currency === "EUR" ? i.price : i.currency === "USD" ? i.price / usdPerEur : null;
    if (!(eur > 0)) continue;
    const finish = byFinish.size > 1 ? finishOf(title, kind) : null;
    const card = byFinish.get(finish) ?? (byFinish.size === 1 ? g.prints[0] : null);
    if (!card) continue;
    const said = titleLang(title);
    const lang = market === "US" ? (said ?? "en") : said;
    if (!lang || (market === "IT" && lang === "en") || !g.set.l.includes(lang)) continue;
    const grade = gradeOf(title);
    if (grade === "?") continue;
    if (!grade && WORN.test(t)) continue;
    const bucket = grade ? `${lang}|g:${grade}` : lang;
    const o = (out[card.id] ??= {});
    (o[bucket] ??= []).push(round2(eur));
    // Foto: un'inserzione non gradata della stampa (quella col titolo più corto: di solito la carta da sola).
    if (!grade && i.image && (!o.img || title.length < o.imgLen)) {
      o.img = i.image;
      o.imgLen = title.length;
    }
  }
  return out;
}


/** Le ricerche di stanotte: le carte mai cercate, poi quelle cercate da più tempo, per mercato. */
export function plan(list, state, today, budget) {
  const due = [];
  for (const g of list) {
    for (const market of g.set.l.length > 1 ? ["US", "IT"] : ["US"]) {
      const s = state.g?.[`${market}|${g.key}`];
      const every = s?.empty ? EMPTY_REFRESH_DAYS : REFRESH_DAYS;
      if (s && today - s.d < every) continue;
      due.push({ g, market, last: s?.d ?? -1 });
    }
  }
  due.sort((a, b) => a.last - b.last);
  return due.slice(0, budget);
}

/** Fa le ricerche e aggiorna lo stato: { v, q: contatore della quota, g: { "US|<carta>": {d, empty, r: split} } }. */
async function run({ ebays, list, state, today, budget, usdPerEur, pauseMs = 150, log = [] }) {
  const todo = plan(list, state, today, budget);
  let done = 0, found = 0, errors = 0;
  for (const { g, market } of todo) {
    let items;
    try {
      items = await ebays[market].search(queryOf(g), 100, { anyCurrency: true });
    } catch (err) {
      if (isQuotaError(err)) { log.push("! quota eBay finita: il resto delle carte Topps alla prossima notte"); break; }
      errors++;
      if (errors >= 20) { log.push(`! troppe ricerche eBay non riuscite di fila: mi fermo (${err.message})`); break; }
      continue;
    }
    errors = 0;
    done++;
    const r = split(items, g, { market, usdPerEur });
    for (const o of Object.values(r)) delete o.imgLen;
    const n = Object.keys(r).length;
    if (n) found++;
    (state.g ??= {})[`${market}|${g.key}`] = n ? { d: today, r } : { d: today, empty: 1 };
    if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
  }
  log.push(`Topps: ${done} ricerche eBay su ${todo.length} previste (${found} con inserzioni della carta)`);
  return done;
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalogo

/** Lingue del catalogo (campi delle righe come in onepiece.js). */
const LANGS_OF_FILE = ["en", "it", "de", "fr", "es"];

/** Il catalogo nel formato dei giochi CardTrader (onepiece.js): sets, cards con prezzi per lingua, gradate in "g", foto in "img". */
export function buildCatalog(data, state, { updated = new Date().toISOString().slice(0, 10), photos = {} } = {}) {
  const results = new Map();
  for (const [k, s] of Object.entries(state.g ?? {})) {
    for (const [id, r] of Object.entries(s.r ?? {})) {
      const into = results.get(id) ?? {};
      for (const [b, v] of Object.entries(r)) {
        if (b === "img") { if (!into.img || k.startsWith("US|")) into.img = v; continue; }
        if (!Array.isArray(v)) continue;
        into[b] = [...(into[b] ?? []), ...v];
      }
      results.set(id, into);
    }
  }
  const cards = data.cards.map((c) => {
    const r = results.get(String(c.id)) ?? {};
    const row = { id: c.id, n: c.n, num: c.num, r: c.r, s: c.s };
    if (c.v) row.v = c.v;
    // Prima la scansione di Bulbapedia (prezzi/dati/foto-topps.json, copiata su Cloudflare R2), poi la foto di un'inserzione eBay.
    const scan = photos[String(c.id)];
    if (scan) row.img = scan;
    else if (r.img) row.img = r.img;
    const g = {};
    for (const [b, prices] of Object.entries(r)) {
      if (b === "img") continue;
      const est = priceOf(prices);
      if (!est) continue;
      const [lang, grade] = b.split("|g:");
      if (!LANGS_OF_FILE.includes(lang)) continue;
      if (grade) (g[lang] ??= {})[grade] = est;
      else row[lang] = est;
    }
    if (Object.keys(g).length) row.g = g;
    return row;
  });
  // Una carta normale (o Chrome Standard) non vale più delle sue versioni foil nella stessa lingua: se succede, nella sua
  // ricerca c'erano foil vendute senza dirlo, e vale il prezzo della foil più economica.
  const byCard = new Map();
  for (const row of cards) {
    const k = `${row.s}|${row.r}|${row.num}`;
    if (!byCard.has(k)) byCard.set(k, []);
    byCard.get(k).push(row);
  }
  for (const prints of byCard.values()) {
    // Una versione senza foto prende quella di un'altra versione della stessa carta (stessa illustrazione), come sharedPhotos
    // dei giochi CardTrader: prima la normale, poi le altre.
    const photo = (prints.find((p) => !p.v && p.img) ?? prints.find((p) => p.img))?.img;
    if (photo) for (const p of prints) if (!p.img) p.img = photo;
    const plain = prints.find((p) => !p.v);
    if (!plain || prints.length < 2) continue;
    for (const lang of LANGS_OF_FILE) {
      if (!plain[lang]) continue;
      const foil = Math.min(...prints.filter((p) => p.v && p[lang]).map((p) => p[lang][0]));
      if (Number.isFinite(foil) && plain[lang][0] > foil) plain[lang] = [foil, plain[lang][1]];
    }
  }
  const sets = data.sets.map((s) => ({ id: s.id, code: s.code, name: s.name, n: s.n, y: s.year, l: s.l }));
  return { updated, source: "ebay", sets, cards };
}

// ---------------------------------------------------------------------------------------------------------------------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const [dataFile, stateFile, outFile, maxArg] = process.argv.slice(2);
  const data = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const state = await readJson(stateFile, { v: 1, g: {} });
  const log = [];
  const today = Math.floor(Date.now() / DAY_MS);
  const cap = Number(maxArg ?? process.env.TOPPS_EBAY_MAX ?? MAX_SEARCHES);
  let usdPerEur = Number(process.env.TOPPS_USD_PER_EUR) || null;
  if (!usdPerEur && process.env.TCGPLAYER_JSON) usdPerEur = (await readJson(process.env.TCGPLAYER_JSON, {}))?.usdEur ?? null;
  if (!usdPerEur) { usdPerEur = USD_PER_EUR_FALLBACK; log.push(`! cambio dollaro/euro non letto: uso ${USD_PER_EUR_FALLBACK} dollari per un euro`); }
  if (cap > 0 && process.env.EBAY_APP_ID) {
    const make = (marketplace) => new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID, marketplace });
    const ebays = { US: make("EBAY_US"), IT: make("EBAY_IT") };
    const window = quotaWindow();
    const used = usedInWindow(state.q, window);
    const quota = await remainingQuota(ebays.US, log);
    const budget = dailyBudget({ cap, used, remaining: quota?.remaining ?? null, reserve: TOPPS_RESERVE });
    log.push(quotaLine("Topps", { window, cap, used, quota, reserve: TOPPS_RESERVE, budget }));
    const done = await run({ ebays, list: groups(data), state, today, budget, usdPerEur, log });
    state.q = addCalls(state.q, window, done);
  } else {
    log.push("Topps: nessuna ricerca eBay stanotte (chiavi mancanti o tetto 0): catalogo dalle ricerche dei giorni prima");
  }
  // Scansioni di Bulbapedia delle carte (22 novembre 2026, lette dal Chrome dell'utente): accanto all'elenco delle carte.
  const scans = await readJson(dataFile.replace(/topps-pokemon\.json$/, "foto-topps.json"), {});
  const catalog = buildCatalog(data, state, { photos: scans.p ?? {} });
  const priced = catalog.cards.filter((c) => LANGS_OF_FILE.some((l) => c[l])).length;
  const photos = catalog.cards.filter((c) => c.img).length;
  await fs.writeFile(stateFile, JSON.stringify(state));
  await fs.writeFile(outFile, JSON.stringify(catalog));
  log.push(`Topps: ${catalog.cards.length} stampe in ${catalog.sets.length} set, ${priced} con un prezzo, ${photos} con la foto (1 € = ${usdPerEur} $)`);
  console.log(log.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
