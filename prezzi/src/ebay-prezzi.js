// Prezzi chiesti su eBay per ogni prodotto, divisi per lingua, variante e voto, per correggere il prezzo dell'app
// (richiesto dall'utente, 4 novembre 2026: "non limitiamoci alle carte in collezione, troviamo una tattica per tutti i
// prodotti"). Con la Browse API ufficiale (5.000 chiamate al giorno per l'app, gratuite; le altre restano al servizio
// delle foto delle varianti e agli oggetti da collezione).
//
// Tattica:
//  - una sola ricerca per prodotto (fino a 200 inserzioni): dai titoli si separano lingua, variante (reverse,
//    1ª edizione, shadowless, staff, prerelease) e voto (PSA 10, BGS 9.5...), senza una chiamata per combinazione;
//  - tutti i prodotti, con una frequenza che scende col valore (richiesto dall'utente: i prodotti molto cari spesso,
//    quelli di valore trascurabile molto di rado): `intervalFor`, da 2 giorni (da 1.000 €) a 180 (sotto 1 €), la metà
//    per le carte che ha in collezione qualcuno;
//  - ogni notte al massimo EBAY_BUDGET ricerche (3.000), scelte per ritardo = giorni dall'ultimo aggiornamento /
//    intervallo; i prodotti mai cercati valgono come in ritardo doppio e passano dai più cari. Se la domanda supera la
//    quota restano indietro i prodotti meno cari (il loro ritardo cresce più piano).
//
// Il file prezzi/v1/ebay.json si accumula: ogni notte si scarica quello di ieri, si aggiornano i prodotti scelti e si
// ricarica. Formato: { v, updated, p: { idApp: { d: giorno (dal 1970), b: { "en|n": [prezzo, inserzioni], ... } } } }
// con le chiavi delle copie dell'app ("base1-4", "op:244442", "sl:730469").
//
//   node prezzi/src/ebay-prezzi.js <universo.json> <ebay.json> [budget]
// L'universo (elenco dei prodotti con query e valore) lo prepara `buildUniverse` (vedi job-notte.sh).

import fs from "node:fs/promises";
import { Ebay, isBundle } from "./ebay.js";
import { estimate } from "./stats.js";
import { compact, norm, VARIANT_WORDS } from "../../supabase/functions/variant-photo/rules.js";

export const DAY_MS = 86_400_000;
export const BUDGET = 3000;
/** Giorni tra due aggiornamenti per fascia di valore (euro): dai prodotti più cari ai trascurabili. */
export const TIERS = [[1000, 2], [200, 4], [50, 7], [20, 14], [5, 30], [1, 90], [0, 180]];

/** Intervallo di aggiornamento di un prodotto: per valore, la metà se qualcuno lo ha in collezione (almeno 2 giorni). */
export function intervalFor(value, owned) {
  const days = TIERS.find(([min]) => value >= min)?.[1] ?? 180;
  return owned ? Math.max(2, days / 2) : days;
}

/** Ricerche al giorno che servirebbero per tenere tutti i prodotti al loro ritmo (per il registro). */
export function dailyDemand(universe, owned) {
  return Math.round(universe.reduce((sum, p) => sum + 1 / intervalFor(p.value, owned.has(p.id)), 0));
}

/** Lingua dichiarata nel titolo; senza indicazioni l'inglese (lo è la gran parte delle inserzioni). */
const LANGS = [
  ["it", /\b(ita|italian[oa]?|italiano|ital)\b/],
  ["ja", /\b(jp|jap|japan|japanese|giappon\w*|jpn)\b/],
  ["de", /\b(deutsch|german|ger|tedesc\w)\b/],
  ["fr", /\b(fr|french|francese|francais|fra)\b/],
  ["es", /\b(esp|spanish|spagnol\w|espanol)\b/],
  ["pt", /\b(portugues\w*|portoghese|pt-?br)\b/],
  ["ko", /\b(korean|coreano|kor)\b/],
  ["zh", /\b(chinese|cinese|chn|s-?chinese|t-?chinese)\b/],
];

/** Voto di una carta gradata nel titolo: "PSA 10", "BGS 9.5", "CGC 9"... */
const GRADE = /\b(psa|bgs|cgc|sgc|ace|tag)\s*-?\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4|3|2|1)\b/;

/** Inserzioni da scartare sempre: lotti, falsi, oggetti diversi dalla carta. */
const EXCLUDE = /\b(lot|lotto|lots|bundle|proxy|custom|orica|replica|fake|falsa|playset|x[2-9]|[2-9]x|digital|online|code|codice|sticker|adesivo|poster|jumbo|oversized|gigante|empty|vuota|binder|raccoglitore|choose|scegli|pick your|you pick|metal|metallo|gold card)\b/;

/** Ristampe che portano nome e numero della carta originale (Shining Charizard 107/105 di Celebrations). */
const REPRINT = /\b(celebrations?|classic collection|25th|anniversary|reprint|ristampa|rpr|cel25|trading card game classic)\b/;

/** Copie dichiarate rovinate: fuori dai prezzi delle non gradate (la stima vale per una carta in buone condizioni). */
const WORN = /\b(played|lp|mp|hp|light play|heavy play|damaged|dmg|poor|giocata|rovinat\w|danneggiat\w|crease|creased|piega|bent|scratch\w*|graffi\w*|worn|usurat\w)\b/;

/**
 * Il secchio di un'inserzione: "lingua|variante" (n = normale/holo, r = reverse, 1 = 1ª edizione, s = shadowless,
 * st = staff, pr = prerelease) o "lingua|g:PSA 10" per le gradate; null se l'inserzione va scartata.
 */
export function bucketOf(title, { reprintOk = false } = {}) {
  const t = norm(title);
  if (EXCLUDE.test(t)) return null;
  if (!reprintOk && REPRINT.test(t)) return null;
  const lang = LANGS.find(([, re]) => re.test(t))?.[0] ?? "en";
  const g = t.match(GRADE);
  if (g) return `${lang}|g:${g[1].toUpperCase()} ${g[2]}`;
  if (/\b(graded|gradata|gradate|slab)\b/.test(t)) return null; // gradata senza voto leggibile
  if (WORN.test(t)) return null;
  const c = compact(title);
  if (/\bstaff\b/.test(t)) return `${lang}|st`;
  if (/\bpre-?release\b/.test(t)) return `${lang}|pr`;
  if (VARIANT_WORDS.firstEdition.some((w) => c.includes(compact(w)))) return `${lang}|1`;
  if (/\bshadowless\b/.test(t)) return `${lang}|s`;
  if (VARIANT_WORDS.reverse.some((w) => c.includes(compact(w)))) return `${lang}|r`;
  return `${lang}|n`;
}

/** Il titolo parla di questo prodotto: per le carte nome e numero, per i sigillati tutte le parole importanti. */
export function matches(title, p) {
  const ct = compact(title);
  if (p.kind === "sealed") return p.must.every((w) => ct.includes(w));
  if (!p.name || !ct.includes(compact(p.name))) return false;
  const n = String(p.number ?? "").trim().toLowerCase().replace(/^0+(?=\d)/, "");
  if (!n) return false;
  const t = norm(title);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (p.total) return new RegExp(`(^|[^0-9])0*${esc}\\s*/\\s*0*${p.total}([^0-9]|$)`).test(t);
  return new RegExp(`(^|[^0-9a-z])0*${esc}([^0-9a-z]|$)`).test(t);
}

/** Prezzi per secchio dalle inserzioni del prodotto: { "en|n": [prezzo, inserzioni], ... } (mediana delle più economiche). */
export function bucketPrices(items, p) {
  const by = new Map();
  for (const i of items) {
    if (!(i.price > 0) || i.currency !== "EUR" || !matches(i.title, p)) continue;
    if (isBundle(i.title, p.name)) continue; // più cose in vendita nella stessa inserzione
    // Le carte che sono esse stesse ristampe (Celebrations, Classic Collection) accettano le parole delle ristampe.
    const b = bucketOf(i.title, { reprintOk: p.reprint === true });
    if (!b) continue;
    if (!by.has(b)) by.set(b, []);
    by.get(b).push({ price: i.price, currency: "EUR", graded: false, bundle: 1, quantity: 1, condition: null });
  }
  const out = {};
  for (const [b, offers] of by) {
    const est = estimate(offers, "n");
    if (est) out[b] = est;
  }
  return out;
}

/**
 * I prodotti da cercare stanotte: al massimo [budget], per priorità. [universe]: [{id, value, ...}], [state]: le voci di
 * ieri ({id: {d}}), [owned]: id che ha in collezione qualcuno, [today]: giorno (dal 1970).
 */
export function plan(universe, state, owned, today, budget = BUDGET) {
  const scored = [];
  for (const p of universe) {
    const last = state[p.id]?.d;
    // Ritardo: 1 = è il suo giorno; i mai cercati valgono 2 (a parità, dai più cari).
    const score = last == null ? 2 : (today - last) / intervalFor(p.value, owned.has(p.id));
    if (score >= 1) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || b.p.value - a.p.value);
  return scored.slice(0, budget).map((s) => s.p);
}

/** Testo della ricerca eBay del prodotto. */
export function query(p) {
  if (p.kind === "sealed") return p.name;
  const n = p.total ? `${p.number}/${p.total}` : p.number;
  return [p.name, n, p.extra].filter(Boolean).join(" ");
}

/** Le parole importanti del nome di un sigillato (per riconoscerlo nei titoli). */
export function sealedWords(name) {
  const stop = new Set(["pokemon", "the", "and", "of", "di", "e", "tcg", "card", "game", "english", "japanese"]);
  return norm(name).replace(/[()[\],:]/g, " ").split(" ").map(compact).filter((w) => w.length >= 2 && !stop.has(w));
}

/**
 * Universo dei prodotti dai file del job: carte TCGdex inglesi ([cards]: cache di tcgdex-scan, con [sets] TCGdex per
 * totale e nome), carte giapponesi ([cardsJa], nomi inglesi da asia.json [asiaEn]), giochi CardTrader ([ct]: {prefix,
 * label, data}) e sigillati ([sealed]); valori in euro dal listino Cardmarket ([guide]: idProduct -> euro).
 */
export function buildUniverse({ cards = {}, cardsJa = {}, sets = {}, asiaEn = {}, guide = {}, ct = [], sealed = null }) {
  const out = [];
  const cardValue = (c) => Math.max(0, ...(c.variants ?? [c.cm]).filter(Boolean).map((id) => guide[id] ?? 0));
  for (const c of Object.values(cards)) {
    const v = cardValue(c);
    if (!c.name) continue;
    const s = sets[c.set];
    const reprint = /celebrations|classic collection/i.test(s?.name ?? "") || /^cel25/.test(c.set);
    out.push({ id: c.id, kind: "card", name: c.name, number: decodeURIComponent(c.localId), total: s?.official ?? null, value: v, cm: guide[c.cm] ?? null, ...(reprint ? { reprint } : {}) });
  }
  for (const c of Object.values(cardsJa)) {
    const v = cardValue(c);
    const name = asiaEn[c.set]?.[String(c.localId).replace(/^0+(?=\d)/, "")];
    if (!name) continue;
    out.push({ id: `ja:${c.id}`, kind: "card", name, number: decodeURIComponent(c.localId), total: null, extra: "japanese", value: v });
  }
  for (const g of ct) {
    const setName = new Map((g.data.sets ?? []).map((s) => [s.id, s]));
    for (const c of g.data.cards ?? []) {
      const v = Math.max(0, ...["en", "jp", "it", "fr", "de", "es"].map((l) => c[l]?.[0] ?? 0));
      const total = g.prefix === "lc:" ? setName.get(c.s)?.n ?? null : null;
      out.push({ id: `${g.prefix}${c.id}`, kind: "card", name: c.n, number: c.num, total, extra: g.label, value: v });
    }
  }
  for (const p of sealed?.p ?? []) {
    const v = p.cm?.trend ?? 0;
    if (p.t === "object" || !p.n) continue;
    out.push({ id: `sl:${p.id}`, kind: "sealed", name: p.n, must: sealedWords(p.n), value: v });
  }
  return out;
}

/** Ricerche della notte: aggiorna [state] (in posto) e restituisce le righe del registro. */
export async function run({ ebay, universe, state, owned, today, budget = BUDGET, pauseMs = 120, deadline = Infinity, log = [] }) {
  const todo = plan(universe, state, owned, today, budget);
  let done = 0;
  let withPrices = 0;
  for (const p of todo) {
    if (Date.now() > deadline) { log.push(`tempo finito dopo ${done} ricerche`); break; }
    let items;
    try {
      items = await ebay.search(query(p), 200);
    } catch (err) {
      if (/429/.test(err.message)) { log.push(`quota eBay finita dopo ${done} ricerche`); break; }
      log.push(`! ${p.id}: ${err.message}`);
      continue;
    }
    const b = bucketPrices(items, p);
    state[p.id] = { d: today, b };
    if (Object.keys(b).length) withPrices++;
    done++;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  log.push(`eBay: ${universe.length} prodotti, ${dailyDemand(universe, owned)} ricerche al giorno per tenerli al loro ritmo, ${todo.length} dovuti stanotte, ${done} cercati, ${withPrices} con prezzi`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [universeFile, stateFile, budgetArg] = process.argv.slice(2);
  if (!universeFile || !stateFile) {
    console.log("uso: node prezzi/src/ebay-prezzi.js <universo.json> <ebay.json> [budget]");
    process.exit(1);
  }
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
    console.log("EBAY_APP_ID/EBAY_CERT_ID non impostati: prezzi eBay non aggiornati");
    process.exit(0);
  }
  const { universe, owned } = JSON.parse(await fs.readFile(universeFile, "utf8"));
  const old = await fs.readFile(stateFile, "utf8").then(JSON.parse).catch(() => ({ p: {} }));
  const state = old.p ?? {};
  const ebay = new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID, marketplace: "EBAY_IT" });
  const today = Math.floor(Date.now() / DAY_MS);
  const budget = Number(budgetArg ?? process.env.EBAY_BUDGET ?? BUDGET);
  const log = await run({ ebay, universe, state, owned: new Set(owned ?? []), today, budget, deadline: Date.now() + 50 * 60_000 });
  // Si tengono solo i prodotti ancora nell'universo (quelli scesi sotto la soglia escono).
  const ids = new Set(universe.map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(state).filter(([id]) => ids.has(id)));
  await fs.writeFile(stateFile, JSON.stringify({ v: 1, updated: new Date().toISOString(), p: kept }));
  console.log(log.join("\n"));
}
