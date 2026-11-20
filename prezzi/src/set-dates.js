// Data di uscita di ogni set, per ordinare i set della collezione dal più recente:
// - set TCGdex: data della scheda del set, in ogni lingua (i set asiatici escono in date diverse:
//   "SV9" giapponese 2025-01-24, taiwanese 2025-02-07). Le date non cambiano: si chiedono solo i set nuovi;
// - set giapponesi extra di CardTrader (EXTRA_JA_SETS in asia.js): data scritta a mano;
// - gruppi TCGplayer: data di pubblicazione (tcgcsv.com), tranne quella dei gruppi misti (vedi tcgplayerDates);
// - espansioni dei sigillati (Cardmarket): set TCGdex inglese con lo stesso nome, altrimenti la data
//   mediana dei prodotti (senza il 2007-01-01 che Cardmarket dà ai prodotti caricati all'inizio);
// - set di One Piece, Lorcana, Dragon Ball e Yu-Gi-Oh! (CardTrader non ha date): la data del gruppo TCGplayer
//   della maggior parte delle sue carte (`tp` del catalogo, da tcgplayer-ct.js), e le espansioni dei loro sigillati
//   come quelle Pokémon (parità tra i giochi, richiesta dall'utente il 4 novembre 2026).
//
//   node prezzi/src/set-dates.js <cache.json> <sealed.json|-> <uscita.json> [onepiece.json lorcana-sealed.json …]
//
// Uscita (carte/v1/date-set.json): { v, updated, d: { chiave: "AAAA-MM-GG" } }, con chiave
//   "<set>" (TCGdex occidentale, CardTrader "ct-…"), "<set>@<lingua>" (TCGdex asiatico),
//   "tp-g<gruppo>" (TCGplayer), "sl:<espansione>" (sigillati), "<prefisso>:<set>" (giochi CardTrader: "yg:1234"),
//   "sp:<prodotto>" (uscita di ogni prodotto sigillato di tutti i giochi, vedi productDates; dalla versione 2 del file).
import fs from "node:fs/promises";
import path from "node:path";
import { EXTRA_JA_SETS } from "./asia.js";
import { CATEGORIES, CT_CATALOGS } from "./storico.js";
import { fetchRetry } from "./rete.js";

const TCGDEX = "https://api.tcgdex.net/v2";
const TCGCSV = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };
export const WESTERN = ["en", "it", "fr", "de", "es", "pt"];
export const ASIAN = ["ja", "ko", "zh-tw", "zh-cn", "id", "th"];

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? "")) ? String(s).slice(0, 10) : null);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chiave di un set TCGdex: l'id per le lingue occidentali (stessi set), "id@lingua" per quelle asiatiche. */
export function tcgdexKey(id, lang) {
  return ASIAN.includes(lang) ? `${id}@${lang}` : id;
}

/**
 * Data di un'espansione dei sigillati: quella del set TCGdex inglese con lo stesso nome, altrimenti la
 * mediana delle date dei suoi prodotti.
 */
export function sealedDates(sealed, enSets) {
  const byName = new Map(enSets.filter((s) => s.date).map((s) => [norm(s.name), s.date]));
  const dates = new Map();
  for (const p of sealed?.p ?? []) {
    const d = day(p.d);
    if (!d || d <= "2007-01-01") continue;
    if (!dates.has(p.e)) dates.set(p.e, []);
    dates.get(p.e).push(d);
  }
  const out = {};
  for (const [e, name] of Object.entries(sealed?.exp ?? {})) {
    const list = (dates.get(Number(e)) ?? dates.get(e) ?? []).sort();
    const d = byName.get(norm(name)) ?? list[Math.floor(list.length / 2)];
    if (d) out[`sl:${e}`] = d;
  }
  return out;
}

/**
 * Gruppi TCGplayer che non sono un set (promo, prodotti vari, esclusive dei blister, premi): la loro data non è l'uscita di
 * un prodotto. Usato per la data di uscita dei sigillati (curiosità della scheda, 0.9.205).
 */
const MIXED_GROUP = /miscellaneous|products|promo|blister|exclusive|prize pack|league|championship|jumbo|trainer kit|unnumbered|box topper|deck exclusives|bonus/i;

export function isMixedGroup(name) {
  return MIXED_GROUP.test(String(name ?? ""));
}

/** Espansioni dei sigillati che raccolgono prodotti di anni diversi: nessuna data comune. */
const MIXED_EXPANSION = /products|promos?\b|miscellaneous|collector'?s? tins?|accessor|bundles?\b/i;

/**
 * Data di uscita di ogni prodotto sigillato (0.9.205, richiesto dall'utente: "le curiosità su tutti i prodotti, almeno la
 * modalità di distribuzione e quando è uscito"), chiave "sp:<id>". La data `d` del catalogo è quella in cui Cardmarket ha
 * messo il prodotto a catalogo (2007-01-01 per tutti quelli vecchi; Force of the Breaker di Yu-Gi-Oh! "2023"), quindi non
 * vale. In ordine: (1) il gruppo TCGplayer del prodotto (`tp`), se è un set e non un gruppo misto; (2) la data della sua
 * espansione da una fonte sicura: set TCGdex inglese con lo stesso nome (solo Pokémon, [enSets]: "Legendary Collection"
 * esiste anche in Yu-Gi-Oh!), gruppo TCGplayer più frequente tra i prodotti dell'espansione, gruppo TCGplayer della
 * categoria del gioco con lo stesso nome ([groupsByName]), set del catalogo CardTrader del gioco con lo stesso nome
 * ([ctByName]). Le espansioni miste ("Pokémon Products") prendono solo la data del gruppo del prodotto. Nessuna data se
 * nessuna fonte è sicura (meglio niente che la data sbagliata).
 */
export function productDates(sealed, { groups = new Map(), enSets = [], groupsByName = new Map(), ctByName = new Map() } = {}) {
  const enByName = new Map(enSets.filter((s) => s.date).map((s) => [norm(s.name), s.date]));
  const groupDate = (g) => {
    const x = groups.get(Number(g));
    return x && !isMixedGroup(x.name) ? x.date : null;
  };
  const byExp = new Map();
  for (const p of sealed?.p ?? []) {
    const g = p.tp?.[1];
    if (!g || !groupDate(g)) continue;
    if (!byExp.has(p.e)) byExp.set(p.e, new Map());
    const m = byExp.get(p.e);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  const expDate = new Map();
  for (const [e, name] of Object.entries(sealed?.exp ?? {})) {
    if (MIXED_EXPANSION.test(name)) continue;
    const key = norm(name);
    const m = byExp.get(Number(e)) ?? byExp.get(e);
    const best = m && [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const d = enByName.get(key) ?? (best ? groupDate(best) : null) ?? groupsByName.get(key) ?? ctByName.get(key);
    if (d) expDate.set(String(e), d);
  }
  const out = {};
  for (const p of sealed?.p ?? []) {
    const d = groupDate(p.tp?.[1]) ?? expDate.get(String(p.e));
    if (d) out[`sp:${p.id}`] = d;
  }
  return out;
}

/**
 * Date dei gruppi TCGplayer. I gruppi misti ("Miscellaneous Cards & Products", "Blister Exclusives",
 * "Nintendo Promos") hanno come data quella dell'ultimo aggiornamento, cioè quasi oggi: niente data.
 */
export function tcgplayerDates(groups, now) {
  const recent = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const out = {};
  for (const g of groups) {
    const date = day(g.publishedOn);
    if (date && date < recent) out[`tp-g${g.groupId}`] = date;
  }
  return out;
}

/**
 * Date dei set di un catalogo CardTrader ([prefix] "yg"): per ogni set il gruppo TCGplayer più frequente tra le sue
 * carte (`tp: [prodotto, gruppo]`) con una data in [dates] ("tp-g<gruppo>"). Set senza carte su TCGplayer: niente data.
 */
export function ctSetDates(catalog, prefix, dates) {
  const groups = new Map();
  for (const c of catalog?.cards ?? []) {
    const g = c.tp?.[1];
    if (!g || !dates[`tp-g${g}`]) continue;
    if (!groups.has(c.s)) groups.set(c.s, new Map());
    const m = groups.get(c.s);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  const out = {};
  for (const [set, m] of groups) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    out[`${prefix}:${set}`] = dates[`tp-g${best}`];
  }
  return out;
}

/** Sigillati dei giochi CardTrader: categorie TCGplayer e prefisso del catalogo delle carte, dal nome del file. */
const SEALED_GAMES = {
  "onepiece-sealed.json": { cats: [68], prefix: "op" },
  "lorcana-sealed.json": { cats: [71], prefix: "lc" },
  "dragonball-sealed.json": { cats: [27, 80], prefix: "db" },
  "yugioh-sealed.json": { cats: [2], prefix: "yg" },
};

export async function buildSetDates({ cache = {}, sealed = null, ctCatalogs = [], ctSealed = [], now = new Date() } = {}) {
  const log = [];
  const d = { ...cache };
  let asked = 0;
  let failed = 0;
  const enSets = [];
  for (const lang of [...WESTERN, ...ASIAN]) {
    let sets;
    try {
      sets = await json(`${TCGDEX}/${lang}/sets`);
    } catch (err) {
      log.push(`! ${lang}: ${err.message}`);
      continue;
    }
    const todo = sets.filter((s) => !d[tcgdexKey(s.id, lang)] && (lang === "en" || ASIAN.includes(lang) || !d[s.id]));
    await pool(todo, 8, async (s) => {
      asked++;
      try {
        const date = day((await json(`${TCGDEX}/${lang}/sets/${encodeURIComponent(s.id)}`)).releaseDate);
        if (date) d[tcgdexKey(s.id, lang)] = date;
      } catch {
        failed++;
      }
    });
    if (lang === "en") for (const s of sets) enSets.push({ name: s.name, date: d[s.id] });
  }
  for (const [id, x] of Object.entries(EXTRA_JA_SETS)) if (x.date) d[id] = x.date;
  const groups = new Map();
  const groupsByCat = new Map();
  for (const cat of CATEGORIES) {
    try {
      const list = (await json(`${TCGCSV}/${cat}/groups`)).results ?? [];
      Object.assign(d, tcgplayerDates(list, now));
      const recent = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const byName = new Map();
      for (const g of list) {
        const date = day(g.publishedOn);
        if (!date || date >= recent) continue;
        groups.set(g.groupId, { name: g.name, date });
        if (!isMixedGroup(g.name) && !byName.has(norm(g.name))) byName.set(norm(g.name), date);
      }
      groupsByCat.set(cat, byName);
    } catch (err) {
      log.push(`! TCGplayer ${cat}: ${err.message}`);
    }
  }
  Object.assign(d, sealedDates(sealed, enSets));
  for (const s of ctSealed) Object.assign(d, sealedDates(s.data ?? s, enSets));
  const ctNames = new Map();
  for (const { prefix, data } of ctCatalogs) {
    const dates = ctSetDates(data, prefix, d);
    Object.assign(d, dates);
    log.push(`Date dei set ${prefix}: ${Object.keys(dates).length} su ${data?.sets?.length ?? 0}`);
    const byName = new Map();
    for (const s of data?.sets ?? []) if (dates[`${prefix}:${s.id}`]) byName.set(norm(s.name), dates[`${prefix}:${s.id}`]);
    ctNames.set(prefix, byName);
  }
  // Data di uscita di ogni prodotto sigillato (curiosità della scheda): vedi productDates.
  const namesOf = (cats) => new Map(cats.flatMap((c) => [...(groupsByCat.get(c) ?? new Map())]));
  const pd = productDates(sealed, { groups, enSets, groupsByName: namesOf([3, 85]) });
  let withDate = Object.keys(pd).length;
  let total = sealed?.p?.length ?? 0;
  Object.assign(d, pd);
  for (const s of ctSealed) {
    const game = SEALED_GAMES[s.name] ?? {};
    const x = productDates(s.data ?? s, { groups, groupsByName: namesOf(game.cats ?? []), ctByName: ctNames.get(game.prefix) ?? new Map() });
    withDate += Object.keys(x).length;
    total += (s.data ?? s)?.p?.length ?? 0;
    Object.assign(d, x);
  }
  log.push(`Data di uscita dei sigillati: ${withDate} su ${total}`);
  log.push(`Date dei set: ${Object.keys(d).length} (${asked} schede TCGdex chieste${failed ? `, ${failed} non lette` : ""})`);
  // v 2: con le date di uscita dei sigillati ("sp:<id>", 0.9.205): l'app le mostra solo da questa versione del file.
  return { data: { v: 2, updated: now.toISOString(), d }, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cachePath, sealedPath, out, ...others] = process.argv.slice(2);
  if (!out) {
    console.log("uso: node prezzi/src/set-dates.js <cache.json> <sealed.json|-> <uscita.json>");
    process.exit(1);
  }
  const read = async (p) => (p && p !== "-" ? JSON.parse(await fs.readFile(p, "utf8").catch(() => "null")) : null);
  // In cache solo le date TCGdex (le altre si ricalcolano ogni volta).
  const cached = (await read(cachePath))?.d ?? {};
  const cache = Object.fromEntries(Object.entries(cached).filter(([k]) => !/^(tp-g|sl:|sp:|ct-|[a-z]{2}:)/.test(k)));
  // Cataloghi dei giochi CardTrader (dal nome del file) e loro sigillati ("…-sealed.json").
  const ctCatalogs = [];
  const ctSealed = [];
  for (const f of others) {
    const data = await read(f);
    if (!data) continue;
    const name = path.basename(f);
    if (name.endsWith("-sealed.json")) ctSealed.push({ name, data });
    else {
      const c = CT_CATALOGS.find((x) => x.file === name);
      if (c) ctCatalogs.push({ prefix: c.prefix, data });
    }
  }
  const { data, log } = await buildSetDates({ cache, sealed: await read(sealedPath), ctCatalogs, ctSealed });
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
  await fs.writeFile(cachePath, JSON.stringify(data));
}
