// Data di uscita di ogni set, per ordinare i set della collezione dal più recente:
// - set TCGdex: data della scheda del set, in ogni lingua (i set asiatici escono in date diverse:
//   "SV9" giapponese 2025-01-24, taiwanese 2025-02-07). Le date non cambiano: si chiedono solo i set nuovi;
// - set giapponesi extra di CardTrader (EXTRA_JA_SETS in asia.js): data scritta a mano;
// - gruppi TCGplayer: data di pubblicazione (tcgcsv.com), tranne quella dei gruppi misti (vedi tcgplayerDates);
// - espansioni dei sigillati (Cardmarket): set TCGdex inglese con lo stesso nome, altrimenti la data
//   mediana dei prodotti (senza il 2007-01-01 che Cardmarket dà ai prodotti caricati all'inizio).
//
//   node prezzi/src/set-dates.js <cache.json> <sealed.json|-> <uscita.json>
//
// Uscita (carte/v1/date-set.json): { v, updated, d: { chiave: "AAAA-MM-GG" } }, con chiave
//   "<set>" (TCGdex occidentale, CardTrader "ct-…"), "<set>@<lingua>" (TCGdex asiatico),
//   "tp-g<gruppo>" (TCGplayer), "sl:<espansione>" (sigillati).
import fs from "node:fs/promises";
import { EXTRA_JA_SETS } from "./asia.js";
import { fetchRetry } from "./rete.js";

const TCGDEX = "https://api.tcgdex.net/v2";
const TCGCSV = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://cirolomonaco90-cyber.github.io/cartella-tcg/)" };
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

export async function buildSetDates({ cache = {}, sealed = null, now = new Date() } = {}) {
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
  for (const cat of [3, 85]) {
    try {
      Object.assign(d, tcgplayerDates((await json(`${TCGCSV}/${cat}/groups`)).results ?? [], now));
    } catch (err) {
      log.push(`! TCGplayer ${cat}: ${err.message}`);
    }
  }
  Object.assign(d, sealedDates(sealed, enSets));
  log.push(`Date dei set: ${Object.keys(d).length} (${asked} schede TCGdex chieste${failed ? `, ${failed} non lette` : ""})`);
  return { data: { v: 1, updated: now.toISOString(), d }, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cachePath, sealedPath, out] = process.argv.slice(2);
  if (!out) {
    console.log("uso: node prezzi/src/set-dates.js <cache.json> <sealed.json|-> <uscita.json>");
    process.exit(1);
  }
  const read = async (p) => (p && p !== "-" ? JSON.parse(await fs.readFile(p, "utf8").catch(() => "null")) : null);
  // In cache solo le date TCGdex (le altre si ricalcolano ogni volta).
  const cached = (await read(cachePath))?.d ?? {};
  const cache = Object.fromEntries(Object.entries(cached).filter(([k]) => !/^(tp-g|sl:|ct-)/.test(k)));
  const { data, log } = await buildSetDates({ cache, sealed: await read(sealedPath) });
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
  await fs.writeFile(cachePath, JSON.stringify(data));
}
