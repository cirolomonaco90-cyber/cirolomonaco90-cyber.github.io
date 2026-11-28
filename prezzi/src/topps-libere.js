// Prezzi delle «carte libere» Topps (26 novembre 2026, scelto dall'utente: "Carta libera + email"). Un catalogo di tutte le
// Topps (calcio, Formula 1, baseball, wrestling, Star Wars...) non esiste gratis e nessun sito dà il permesso di copiare il suo:
// l'utente aggiunge la carta scrivendo set, numero, nome e versione (app: data/ToppsFree.kt, copie con id "tt:-<numero>") e il
// prezzo si cerca qui nelle inserzioni eBay, come per le Topps Pokémon (topps.js).
//
// Le carte da cercare si leggono dalle collezioni con la chiave segreta del job: solo le copie con id "tt:-…" e solo set,
// numero, nome e versione, che servono per la ricerca. Nel file pubblicato (prezzi/v1/topps-libere.json) ci sono solo gli id e i
// prezzi, mai i testi scritti dagli utenti. Due ricerche per carta, eBay Regno Unito e Stati Uniti (i titoli sono in inglese
// e non tradotti come su eBay.it; calcio soprattutto nel Regno Unito, Formula 1 e baseball negli Stati Uniti), prezzi in euro
// col cambio della BCE. Al massimo TOPPS_LIBERE_MAX ricerche a giro, le carte mai cercate per prime.
//
//   EBAY_APP_ID=... EBAY_CERT_ID=... SUPABASE_SECRET_KEY=... node prezzi/src/topps-libere.js <topps-libere.json> [ricerche]
import fs from "node:fs/promises";
import { Ebay } from "./ebay.js";
import { fetchRetry } from "./rete.js";
import { quotaWindow, usedInWindow, addCalls, dailyBudget, remainingQuota, quotaLine, isQuotaError } from "./ebay-quota.js";
import { MARKETS, RATES_FALLBACK, MAX_TEXT, clip, split, priced, queryOf, ecbRates } from "./topps-libere-regole.js";

// Le regole (quando un titolo è la carta, che prezzo ne esce) stanno in topps-libere-regole.js, in comune col servizio.
export * from "./topps-libere-regole.js";

const DAY_MS = 86_400_000;
/** Ricerche a giro (due per carta: Regno Unito e Stati Uniti). */
const MAX_SEARCHES = 200;
/** Chiamate lasciate libere agli altri lavori della quota eBay (ebay-quota.js). */
const RESERVE = 1200;
const REFRESH_DAYS = 14;
const EMPTY_REFRESH_DAYS = 30;
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const SUPA = "https://lafgthxgasunkxrgwqng.supabase.co";
const MAX_CARDS = 20_000;


/** Le carte di stanotte: mai cercate per prime, poi quelle cercate da più tempo. Ogni carta costa [perCard] ricerche. */
export function plan(defs, state, today, budget, perCard = Object.keys(MARKETS).length) {
  const due = [];
  for (const d of defs) {
    const s = state.s?.[d.id];
    // Una carta la cui ricerca è andata in errore si riprova il giorno dopo, ma in coda (non resta sempre la prima del giro).
    if (s && today - s.d < (s.fail ? 1 : s.empty ? EMPTY_REFRESH_DAYS : REFRESH_DAYS)) continue;
    due.push({ d, last: s?.d ?? -1 });
  }
  due.sort((a, b) => a.last - b.last);
  return due.slice(0, Math.max(0, Math.floor(budget / perCard))).map((x) => x.d);
}

/** Fa le ricerche e aggiorna lo stato: { v, q, s: { id: {d, empty} }, p: { id: prezzi } }. Rende le ricerche fatte. */
export async function run({ ebays, defs, state, today, budget, rates, pauseMs = 150, log = [] }) {
  const todo = plan(defs, state, today, budget);
  let calls = 0, found = 0, errors = 0, failed = 0;
  cards: for (const def of todo) {
    const buckets = {};
    for (const market of Object.keys(MARKETS)) {
      try {
        const items = await ebays[market].search(queryOf(def), 100, { anyCurrency: true });
        calls++;
        errors = 0;
        split(items, def, rates, buckets);
      } catch (err) {
        if (isQuotaError(err)) { log.push("! quota eBay finita: il resto delle carte libere al prossimo giro"); break cards; }
        errors++;
        failed++;
        // Segnata come cercata oggi senza esito (il prezzo di prima resta): al prossimo giro va dopo le carte mai cercate.
        (state.s ??= {})[def.id] = { d: today, fail: 1, ...(state.p?.[def.id] ? {} : { empty: 1 }) };
        // Nel registro (pubblico) solo il codice dell'errore: il messaggio di eBay contiene la ricerca, cioè i testi dell'utente.
        if (errors >= 20) { log.push(`! troppe ricerche eBay non riuscite di fila: mi fermo (${String(err.message).match(/HTTP \d+/)?.[0] ?? "errore di rete"})`); break cards; }
        continue cards;
      }
      if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
    }
    delete buckets.imgLen;
    const p = priced(buckets);
    (state.s ??= {})[def.id] = p ? { d: today } : { d: today, empty: 1 };
    state.p ??= {};
    if (p) { state.p[def.id] = p; found++; } else delete state.p[def.id];
  }
  log.push(`Topps libere: ${calls} ricerche eBay per ${todo.length} carte (${found} con inserzioni della carta${failed ? `, ${failed} in errore` : ""})`);
  return calls;
}

/** Carte che nessuno ha più in collezione: fuori dallo stato e dai prezzi dopo 60 giorni dall'ultima ricerca. */
export function prune(state, defs, today) {
  const live = new Set(defs.map((d) => d.id));
  for (const [id, s] of Object.entries(state.s ?? {})) {
    if (live.has(id) || today - s.d < 60) continue;
    delete state.s[id];
    delete state.p?.[id];
  }
}


/** Le righe delle collezioni diventano carte da cercare: una per id, senza quelle senza set o senza nome. */
export function defsOf(rows) {
  const by = new Map();
  for (const r of rows) {
    const id = String(r.card_id ?? "").match(/^tt:(-\d{1,10})$/)?.[1];
    if (!id || by.has(id)) continue;
    const def = { id, set: clip(r.set, MAX_TEXT.set), num: clip(r.num, MAX_TEXT.num), name: clip(r.name, MAX_TEXT.name), ver: clip(r.ver, MAX_TEXT.ver) };
    if (def.set.length < 3 || def.name.length < 2) continue;
    by.set(id, def);
  }
  return [...by.values()];
}

/** Le carte libere in collezione di tutti gli utenti (solo i campi della ricerca). */
async function ownedFree(log) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) { log.push("! chiave del database mancante: nessuna carta libera letta"); return null; }
  const select = "card_id:data->>cardId,name:data->>name,set:data->>setName,num:data->>localId,ver:data->>rarity";
  const rows = [];
  for (let from = 0; from < MAX_CARDS; from += 1000) {
    const url = `${SUPA}/rest/v1/owned_cards?select=${select}&deleted=eq.false&data->>cardId=like.tt:-*`;
    const r = await fetchRetry(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } });
    if (!r.ok) { log.push(`! carte libere non lette: HTTP ${r.status}`); return null; }
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return defsOf(rows);
}

async function main() {
  const [file, maxArg] = process.argv.slice(2);
  const log = [];
  const state = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => ({ v: 1, s: {}, p: {} }));
  const today = Math.floor(Date.now() / DAY_MS);
  const defs = await ownedFree(log);
  const cap = Number(maxArg ?? process.env.TOPPS_LIBERE_MAX ?? MAX_SEARCHES);
  if (defs && defs.length && cap > 0 && process.env.EBAY_APP_ID) {
    let rates = ecbRates(await fetchRetry(ECB).then((r) => r.text()).catch(() => ""));
    if (!rates) { rates = RATES_FALLBACK; log.push("! cambi della BCE non letti: uso quelli di riserva"); }
    const ebays = Object.fromEntries(Object.entries(MARKETS).map(([m, [marketplace]]) => [m, new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID, marketplace })]));
    const window = quotaWindow();
    const used = usedInWindow(state.q, window);
    const quota = await remainingQuota(ebays.US, log);
    const budget = dailyBudget({ cap, used, remaining: quota?.remaining ?? null, reserve: RESERVE });
    log.push(quotaLine("Topps libere", { window, cap, used, quota, reserve: RESERVE, budget }));
    const calls = await run({ ebays, defs, state, today, budget, rates, log });
    state.q = addCalls(state.q, window, calls);
  } else {
    log.push(`Topps libere: nessuna ricerca eBay (${defs ? `${defs.length} carte` : "carte non lette"}, tetto ${cap})`);
  }
  if (defs) prune(state, defs, today);
  state.v = 1;
  state.updated = new Date().toISOString().slice(0, 10);
  await fs.writeFile(file, JSON.stringify(state));
  log.push(`Topps libere: ${defs?.length ?? 0} carte nelle collezioni, ${Object.keys(state.p ?? {}).length} con un prezzo`);
  console.log(log.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
