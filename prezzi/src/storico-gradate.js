// Storico dei prezzi delle carte gradate per ente e voto (0.9.214, 14 novembre 2026, dall'utente con la schermata di un'altra
// app: "voglio inserire anche queste informazioni per le carte ... parlo dei grafici", poi "falli tutti e 2").
//
// Nessuna fonte gratuita ha il passato dei prezzi gradati (PokemonPriceTracker: 3 giorni col piano gratuito; i venduti eBay
// solo con un permesso speciale), quindi lo storico si accumula da qui in avanti, con quello che il job già raccoglie:
//   - eBay (prezzi/v1/ebay.json di ebay-prezzi.js): per ogni prodotto e lingua il prezzo delle inserzioni attive per voto
//     ("en|g:PSA 10"), tutti i giochi; un punto nel giorno della ricerca (campo d), che torna ogni 2-180 giorni secondo il valore;
//   - PokemonPriceTracker (tabella graded_prices del servizio graded-price, vendite delle carte inglesi): un punto nel giorno
//     in cui il servizio l'ha letto.
// Punti radi (solo i giorni con una lettura vera, mai ripetuti): nei file [giorno, centesimi, quanti] per serie (quanti = inserzioni
// eBay o vendite di PokemonPriceTracker: l'app scarta i prezzi da una sola inserzione, spesso di un'altra carta), non un valore al giorno.
//
//   node prezzi/src/storico-gradate.js <cartella di uscita> <ebay.json> [graded_prices.json]
// File: storico/v1/gr/<n>.json (n = gradedShard(id), 0-255) = {v: 1, p: {id: {"<fonte>|<voto>": [[giorno, centesimi, quanti], ...]}}}
//   id = id del prodotto nell'app ("ecard2-149", "ja:SV9-001", "op:354316", "sl:580605") o "tp:<prodotto TCGplayer>";
//   fonte = lingua delle inserzioni eBay ("en", "it", "ja", "xx" = senza lingua nel titolo) o "ppt" (PokemonPriceTracker).
import fs from "node:fs/promises";
import path from "node:path";
import { fetchRetry } from "./rete.js";
import { BASE, checkMissing, withLocalCopy } from "./storico.js";

const SHARDS = 256;
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };
const DAY_MS = 86_400_000;

/** Il file di un id: la stessa formula di MarketHistory.gradedShard nell'app (interi piccoli, uguale in JS e Kotlin). */
export function gradedShard(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)) % SHARDS;
  return h;
}

/** Aggiunge [giorno, centesimi, quanti] alla serie: un giorno già letto si sostituisce, uno più vecchio dell'ultimo no. */
export function addPoint(series, day, cents, count = 0) {
  const last = series[series.length - 1];
  if (last && last[0] === day) {
    last[1] = cents;
    last[2] = count;
    return false;
  }
  if (last && last[0] > day) return false;
  series.push([day, cents, count]);
  return true;
}

/** I punti di oggi: dalle voci eBay con un voto e dalle righe di graded_prices. */
export function gradedPoints(ebay, rows = []) {
  const out = [];
  for (const [id, entry] of Object.entries(ebay?.p ?? {})) {
    const day = entry?.d;
    if (!Number.isInteger(day)) continue;
    for (const [bucket, val] of Object.entries(entry.b ?? {})) {
      const m = /^([a-z]{2})\|g:(.+)$/.exec(bucket);
      const price = Array.isArray(val) ? val[0] : null;
      if (!m || !(price > 0)) continue;
      out.push({ id, key: `${m[1]}|${m[2]}`, day, cents: Math.round(price * 100), count: Number.isInteger(val[1]) ? val[1] : 0 });
    }
  }
  for (const row of rows) {
    const day = Math.floor(Date.parse(row?.fetched_at) / DAY_MS);
    if (!Number.isInteger(row?.tcgplayer_id) || !Number.isFinite(day)) continue;
    for (const [grade, g] of Object.entries(row.data?.grades ?? {})) {
      if (!(g?.eur > 0)) continue;
      out.push({ id: `tp:${row.tcgplayer_id}`, key: `ppt|${grade}`, day, cents: Math.round(g.eur * 100), count: Number.isInteger(g.sales) ? g.sales : 0 });
    }
  }
  return out;
}

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Aggiorna i file dello storico dei gradati: legge i file pubblicati dei soli id con punti nuovi, aggiunge i punti e scrive
 * in [outDir]/gr quelli cambiati. Un file pubblicato che non si legge (rete) ferma tutto: riscriverlo da zero perderebbe il passato.
 */
export async function updateGraded({ outDir, ebay, rows = [], fetchJson = json, log = [], env = process.env }) {
  const points = gradedPoints(ebay, rows);
  const byShard = new Map();
  for (const p of points) {
    const s = gradedShard(p.id);
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push(p);
  }
  await fs.mkdir(path.join(outDir, "gr"), { recursive: true });
  let added = 0;
  let missing = 0;
  const out = [];
  for (const [s, list] of [...byShard].sort((a, b) => a[0] - b[0])) {
    const old = await fetchJson(`${BASE}/gr/${s}.json`);
    if (!old) missing++;
    const data = old && typeof old === "object" && old.p ? old : { v: 1, p: {} };
    let changed = 0;
    for (const p of list.sort((a, b) => a.day - b.day)) {
      const series = ((data.p[p.id] ??= {})[p.key] ??= []);
      if (addPoint(series, p.day, p.cents, p.count)) changed++;
    }
    if (changed === 0 && old) continue;
    added += changed;
    out.push([s, data]);
  }
  // Se quasi tutti i file pubblicati risultano "non trovati" (indirizzo dei dati sbagliato, spazio file vuoto) riscriverli col
  // solo giorno di oggi cancellerebbe il passato: ci si ferma, come per gli altri storici (storico.js, checkMissing).
  checkMissing("gr", missing, byShard.size, env);
  for (const [s, data] of out) await fs.writeFile(path.join(outDir, "gr", `${s}.json`), JSON.stringify(data));
  const files = out.length;
  const ids = new Set(points.map((p) => p.id)).size;
  log.push(`storico dei gradati: ${points.length} prezzi per voto di ${ids} prodotti (eBay e PokemonPriceTracker), ${added} punti nuovi, ${files} file scritti`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outDir, ebayFile, gradedFile] = process.argv.slice(2);
  if (!outDir || !ebayFile) {
    console.log("uso: node prezzi/src/storico-gradate.js <cartella> <ebay.json> [graded_prices.json]");
    process.exit(1);
  }
  const ebay = JSON.parse(await fs.readFile(ebayFile, "utf8"));
  let rows = [];
  if (gradedFile) {
    try {
      rows = JSON.parse(await fs.readFile(gradedFile, "utf8"));
      if (!Array.isArray(rows)) rows = [];
    } catch (err) {
      console.log(`${gradedFile} non letto (${err.message}): solo eBay`);
    }
  }
  const stats = {};
  const log = await updateGraded({ outDir, ebay, rows, fetchJson: withLocalCopy(json, process.env.STORICO_COPIA, { stats }) });
  if (process.env.STORICO_COPIA) console.log(`file dello storico: ${stats.local ?? 0} dalla copia locale, ${stats.remote ?? 0} scaricati`);
  console.log(log.join("\n"));
}
