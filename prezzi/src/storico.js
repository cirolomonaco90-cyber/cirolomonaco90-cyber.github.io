// Storico dei prezzi di mercato, per il grafico "Andamento del prezzo" nella scheda di ogni carta.
//
// TCGplayer: tcgcsv.com archivia ogni giorno i prezzi di tutti i prodotti (dall'8 febbraio 2024; categorie Pokémon,
//   One Piece, Lorcana, Dragon Ball: CATEGORIES; le carte One Piece/Lorcana/Dragon Ball hanno il prodotto TCGplayer
//   nel catalogo, campo tp, da tcgplayer-ct.js):
//   un punto a settimana (il lunedì) più l'ultimo giorno disponibile, per prodotto e versione (Normal,
//   Holofoil, Reverse Holofoil, 1st Edition Holofoil...), in centesimi di dollaro, un file per gruppo
//   TCGplayer: storico/v1/tp/<gruppo>.json; i giorni già letti stanno in storico/v1/tp/_giorni.json.
//   Ogni notte si leggono gli archivi che mancano (al massimo [max] per volta: il passato si riempie in
//   qualche notte), quindi serve il programma 7z (c'è su GitHub Actions).
// Cardmarket: nessun archivio pubblico del passato: si accumula da oggi dal listino ufficiale, [tendenza,
//   tendenza foil] in centesimi di euro per prodotto, un file per espansione CardTrader (prodotto -> espansione dal
//   catalogo del job, la stessa mappa dell'app): storico/v1/cm/<espansione>.json.
//
// Formato di un file: { v: 1, d: [giorni, come giorni dal 1970-01-01], p: { idProdotto: { versione: [centesimi
// o null per ogni giorno di d] } } }. Si tengono solo i lunedì e gli ultimi due giorni: un file resta piccolo
// (per anni di storico) e l'app lo scarica solo per le carte che apre. Dagli ultimi due giorni viene anche la
// variazione delle 24 ore di ogni prodotto (storico/v1/variazioni-tp.json e variazioni-cm.json, { v, day,
// p: { idProdotto: { versione: percentuale } } }), che l'app mostra accanto al prezzo nelle anteprime delle carte.
//
// CardTrader (One Piece, Lorcana): le stime Near Mint per lingua dei cataloghi del job (onepiece.json, lorcana.json,
//   costruiti la stessa notte), in centesimi di euro per blueprint e lingua ("en", "jp", "fr"...), un file per set:
//   storico/v1/ct/<prefisso>-<set>.json ("op-3332", "lc-3469"); variazioni in variazioni-ct.json con le chiavi
//   delle copie dell'app ("op:244442").
//
//   node prezzi/src/storico.js tp <cartella> [max archivi]
//   node prezzi/src/storico.js cm <cartella>
//   node prezzi/src/storico.js ct <cartella> <onepiece.json> <lorcana.json> <dragonball.json> <yugioh.json>
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchRetry } from "./rete.js";

const run = promisify(execFile);
export const BASE = "https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati/storico/v1";
const ARCHIVE = (day) => `https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`;
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
/** Catalogo del job: prodotto Cardmarket -> espansione CardTrader (la stessa che l'app conosce da LanguagePrices). */
const CATALOG = "https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati/prezzi/v1/catalog.json";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };
/** Categorie TCGplayer: Pokémon inglese e giapponese, One Piece, Lorcana, Dragon Ball Super e Fusion World, Yu-Gi-Oh!. */
export const CATEGORIES = [3, 85, 68, 71, 27, 80, 2];

/**
 * Categorie da leggere: tutte, o solo quelle di STORICO_CATEGORIE ("2" = Yu-Gi-Oh!), per rileggere dal Mac il passato di
 * una categoria aggiunta dopo (STORICO_RILEGGI=1) senza rifare le altre.
 */
const readCategories = () => (process.env.STORICO_CATEGORIE ? process.env.STORICO_CATEGORIE.split(",").map(Number).filter(Boolean) : CATEGORIES);
/** Primo lunedì con un archivio tcgcsv. */
export const FIRST_DAY = "2024-02-12";
const DAY_MS = 86_400_000;

export const epochDay = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY_MS);
export const dayString = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Il 1° gennaio 1970 era giovedì: i lunedì sono i giorni 4, 11, 18... */
export const isMonday = (n) => (((n - 4) % 7) + 7) % 7 === 0;

/** Versioni TCGplayer -> chiave corta nel file (le altre: nome in minuscolo con i trattini). */
export const SUBTYPES = {
  Normal: "n",
  Holofoil: "h",
  "Reverse Holofoil": "r",
  "1st Edition Holofoil": "fh",
  "1st Edition": "f",
  "Unlimited Holofoil": "uh",
  Unlimited: "u",
};
export const subtypeKey = (name) => SUBTYPES[name] ?? String(name || "n").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const cents = (x) => (typeof x === "number" && x > 0 ? Math.round(x * 100) : null);

/** Prezzi di mercato di un file "prices" di tcgcsv (results): { idProdotto: { versione: centesimi } }. */
export function marketCents(results) {
  const out = {};
  for (const r of results || []) {
    const c = cents(r.marketPrice);
    if (c === null || !r.productId) continue;
    (out[r.productId] ??= {})[subtypeKey(r.subTypeName)] = c;
  }
  return out;
}

/** Tendenze del listino Cardmarket, per espansione: { idEspansione: { idProdotto: { t: centesimi, th: centesimi } } }. */
export function guideCents(priceGuides, expansionOf) {
  const out = {};
  for (const row of priceGuides || []) {
    const exp = expansionOf(Number(row.idProduct));
    if (exp === undefined || exp === null) continue;
    const t = cents(row.trend);
    const th = cents(row["trend-holo"]);
    if (t === null && th === null) continue;
    const entry = {};
    if (t !== null) entry.t = t;
    if (th !== null) entry.th = th;
    (out[exp] ??= {})[row.idProduct] = entry;
  }
  return out;
}

export const emptyShard = () => ({ v: 1, d: [], p: {} });

/**
 * Il file con in più il giorno [day] ({ idProdotto: { versione: centesimi } }): serie allineate ai giorni di d,
 * null dove un prodotto non c'era; lo stesso giorno due volte sostituisce. Dei giorni restano i lunedì e
 * l'ultimo: un giorno "di mezzo" sparisce quando ne arriva uno più nuovo.
 */
export function addDay(shard, day, values) {
  const days = shard.d.slice();
  const p = {};
  for (const [id, series] of Object.entries(shard.p)) {
    p[id] = {};
    for (const [k, arr] of Object.entries(series)) p[id][k] = arr.slice();
  }
  let idx = days.indexOf(day);
  if (idx < 0) {
    days.push(day);
    idx = days.length - 1;
    for (const series of Object.values(p)) for (const arr of Object.values(series)) arr.push(null);
  }
  for (const [id, byKey] of Object.entries(values)) {
    const series = (p[id] ??= {});
    for (const [k, c] of Object.entries(byKey)) {
      const arr = (series[k] ??= Array(days.length).fill(null));
      arr[idx] = c;
    }
  }
  const order = days.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]);
  // I lunedì e gli ultimi due giorni (per la variazione delle 24 ore).
  const fromDay = order[Math.max(0, order.length - 2)][0];
  const keep = order.filter(([d]) => isMonday(d) || d >= fromDay);
  const out = emptyShard();
  out.d = keep.map(([d]) => d);
  for (const [id, series] of Object.entries(p)) {
    const kept = {};
    for (const [k, arr] of Object.entries(series)) {
      const a = keep.map(([, i]) => arr[i] ?? null);
      if (a.some((x) => x !== null)) kept[k] = a;
    }
    if (Object.keys(kept).length) out.p[id] = kept;
  }
  return out;
}

/**
 * I giorni da leggere dagli archivi: tutti i lunedì da FIRST_DAY a ieri, più ieri e l'altro ieri (l'archivio di
 * oggi arriva domani; due giorni di fila danno la variazione delle 24 ore).
 */
export function wantedDays(today, firstDay = FIRST_DAY) {
  const yesterday = epochDay(today) - 1;
  const out = [];
  for (let d = epochDay(firstDay); d <= yesterday; d++) if (isMonday(d)) out.push(d);
  for (const d of [yesterday - 1, yesterday]) if (d >= epochDay(firstDay) && !out.includes(d)) out.push(d);
  return out.sort((a, b) => a - b);
}

/**
 * Variazione delle 24 ore di ogni prodotto e versione dai file [shards] (gruppo -> file): ultimo giorno contro
 * il giorno prima, solo se sono di fila e hanno entrambi un prezzo; in percentuale con un decimale.
 */
export function dailyChanges(shards) {
  const p = {};
  let day = null;
  for (const shard of shards) {
    const n = shard.d.length;
    if (n < 2 || shard.d[n - 1] - shard.d[n - 2] !== 1) continue;
    day = Math.max(day ?? 0, shard.d[n - 1]);
    for (const [id, series] of Object.entries(shard.p)) {
      for (const [k, arr] of Object.entries(series)) {
        const a = arr[n - 2];
        const b = arr[n - 1];
        if (a === null || b === null || !(a > 0)) continue;
        (p[id] ??= {})[k] = Math.round(((b - a) / a) * 1000) / 10;
      }
    }
  }
  return { v: 1, day: day === null ? null : dayString(day), p };
}

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  // Un file che non c'è: 404 (tcgcsv) o 400 (lo spazio file di Supabase).
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Esegue [fn] su ogni elemento con al massimo [n] alla volta. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** I file già pubblicati (uno per gruppo/espansione), scaricati al bisogno. */
function shardStore(kind, fetchJson) {
  const cache = new Map();
  return {
    async get(id) {
      if (!cache.has(id)) cache.set(id, (await fetchJson(`${BASE}/${kind}/${id}.json`)) ?? emptyShard());
      return cache.get(id);
    },
    set(id, shard) {
      cache.set(id, shard);
    },
    ids: () => [...cache.keys()],
    all: () => [...cache.values()],
    async write(dir) {
      await fs.mkdir(path.join(dir, kind), { recursive: true });
      for (const [id, shard] of cache) await fs.writeFile(path.join(dir, kind, `${id}.json`), JSON.stringify(shard));
    },
  };
}

/** Scarica l'archivio tcgcsv del giorno e lo apre con 7z: { "<gruppo>": results } per le categorie Pokémon. */
async function readArchive(day, tmp) {
  const res = await fetchRetry(ARCHIVE(day), { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${ARCHIVE(day)}: HTTP ${res.status}`);
  const file = path.join(tmp, `${day}.7z`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  const dir = path.join(tmp, day);
  await fs.rm(dir, { recursive: true, force: true });
  const cats = readCategories();
  await run("7z", ["x", "-y", `-o${dir}`, file, ...cats.map((c) => `${day}/${c}/*`)], { maxBuffer: 64 * 1024 * 1024 });
  const out = {};
  for (const cat of cats) {
    const catDir = path.join(dir, day, String(cat));
    let groups = [];
    try {
      groups = await fs.readdir(catDir);
    } catch {
      continue;
    }
    for (const g of groups) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(catDir, g, "prices"), "utf8"));
        out[g] = data.results ?? [];
      } catch {
        // gruppo senza prezzi quel giorno
      }
    }
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(file, { force: true });
  return out;
}

/**
 * Storico TCGplayer: legge al massimo [max] archivi che mancano (i più recenti prima) e scrive in [outDir]/tp
 * i file dei gruppi toccati e _giorni.json. Restituisce il registro.
 */
export async function updateTcgplayer({ outDir, max = 40, today = new Date(), fetchJson = json, archive = readArchive, pauseMs = Number(process.env.STORICO_PAUSA_MS || 0), log = [] }) {
  const todayStr = today.toISOString().slice(0, 10);
  const done = new Set(((await fetchJson(`${BASE}/tp/_giorni.json`)) ?? { d: [] }).d);
  const missing = wantedDays(todayStr).filter((d) => !done.has(d)).sort((a, b) => b - a).slice(0, max);
  const store = shardStore("tp", fetchJson);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "storico-"));
  let read = 0;
  try {
    for (const d of missing) {
      const day = dayString(d);
      const groups = await archive(day, tmp);
      if (!groups) {
        log.push(`${day}: nessun archivio`);
        done.add(d); // non arriverà più: non lo si richiede ogni notte
        continue;
      }
      for (const [g, results] of Object.entries(groups)) {
        const values = marketCents(results);
        if (!Object.keys(values).length) continue;
        store.set(g, addDay(await store.get(g), d, values));
      }
      done.add(d);
      read++;
      // tcgcsv limita le richieste (429): tra un archivio e l'altro una pausa, se chiesta (rilettura dal Mac).
      if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    }
  } catch (err) {
    // Un archivio che non arriva (tcgcsv che limita, rete): si salva quello già letto, il resto la prossima volta.
    log.push(`storico TCGplayer: mi fermo (${err.message}), salvo i ${read} archivi già letti`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  await store.write(outDir);
  await fs.writeFile(path.join(outDir, "tp", "_giorni.json"), JSON.stringify({ v: 1, d: [...done].sort((a, b) => a - b) }));
  const changes = dailyChanges(store.all());
  await fs.writeFile(path.join(outDir, "variazioni-tp.json"), JSON.stringify(changes));
  const left = wantedDays(todayStr).filter((d) => !done.has(d)).length;
  log.push(`storico TCGplayer: ${read} archivi letti, ${store.ids().length} gruppi aggiornati, ${done.size} giorni in tutto${left ? `, ${left} ancora da leggere` : ""}, variazioni 24h di ${Object.keys(changes.p).length} prodotti (${changes.day ?? "nessun giorno di fila"})`);
  return log;
}

/**
 * Storico Cardmarket: aggiunge oggi dal listino ufficiale e scrive in [outDir]/cm un file per espansione
 * CardTrader (prodotto -> espansione dal catalogo del job, `cm` di catalog.json: è la mappa che ha anche l'app).
 */
export async function updateCardmarket({ outDir, today = new Date(), fetchJson = json, guide, catalog, log = [] }) {
  const d = epochDay(today.toISOString().slice(0, 10));
  guide ??= await fetchJson(GUIDE);
  catalog ??= await fetchJson(CATALOG);
  // I prodotti che il catalogo non collega a un'espansione (sigillati, altro) finiscono nel file "0": il grafico
  // non li trova, ma la variazione delle 24 ore sì.
  const expOf = catalog?.cm ?? {};
  const byExp = guideCents(guide?.priceGuides ?? [], (id) => expOf[id] ?? 0);
  const store = shardStore("cm", fetchJson);
  const exps = Object.keys(byExp);
  await pool(exps, 8, async (exp) => store.get(exp));
  for (const exp of exps) store.set(exp, addDay(await store.get(exp), d, byExp[exp]));
  await store.write(outDir);
  const changes = dailyChanges(store.all());
  await fs.writeFile(path.join(outDir, "variazioni-cm.json"), JSON.stringify(changes));
  const products = exps.reduce((n, e) => n + Object.keys(byExp[e]).length, 0);
  log.push(`storico Cardmarket: ${products} prodotti in ${exps.length} espansioni, giorno ${dayString(d)}, variazioni 24h di ${Object.keys(changes.p).length} prodotti`);
  return log;
}

/** Giochi presi da CardTrader: prefisso degli id nell'app e nome del catalogo del job. */
export const CT_CATALOGS = [
  { prefix: "op", file: "onepiece.json" },
  { prefix: "lc", file: "lorcana.json" },
  { prefix: "db", file: "dragonball.json" },
  { prefix: "yg", file: "yugioh.json" },
];

/**
 * Stime Near Mint di un catalogo One Piece/Lorcana, per set: { "<prefisso>-<set>": { blueprint: { lingua: centesimi } } }.
 * Le lingue sono le chiavi di due lettere con [prezzo, offerte] ("en", "jp", "fr", "de", "it", "es").
 */
export function ctCents(catalog, prefix) {
  const out = {};
  for (const c of catalog?.cards ?? []) {
    const entry = {};
    for (const [k, v] of Object.entries(c)) {
      if (!/^[a-z]{2}$/.test(k) || !Array.isArray(v)) continue;
      const x = cents(v[0]);
      if (x !== null) entry[k] = x;
    }
    if (Object.keys(entry).length && c.id && c.s) (out[`${prefix}-${c.s}`] ??= {})[c.id] = entry;
  }
  return out;
}

/**
 * Storico CardTrader: oggi dalle stime dei cataloghi [catalogs] ([{ prefix, data }]), un file per set in [outDir]/ct,
 * più variazioni-ct.json ({ v, day, p: { "op:<blueprint>": { lingua: % } } }).
 */
export async function updateCt({ outDir, today = new Date(), fetchJson = json, catalogs, log = [] }) {
  const d = epochDay(today.toISOString().slice(0, 10));
  const store = shardStore("ct", fetchJson);
  const changes = { v: 1, day: null, p: {} };
  for (const { prefix, data } of catalogs) {
    const bySet = ctCents(data, prefix);
    const ids = Object.keys(bySet);
    await pool(ids, 8, async (id) => store.get(id));
    for (const id of ids) store.set(id, addDay(await store.get(id), d, bySet[id]));
    const ch = dailyChanges(await Promise.all(ids.map((id) => store.get(id))));
    for (const [bp, byLang] of Object.entries(ch.p)) changes.p[`${prefix}:${bp}`] = byLang;
    if (ch.day && (!changes.day || ch.day > changes.day)) changes.day = ch.day;
    const cards = ids.reduce((n, id) => n + Object.keys(bySet[id]).length, 0);
    log.push(`storico CardTrader ${prefix}: ${cards} carte in ${ids.length} set, giorno ${dayString(d)}`);
  }
  await store.write(outDir);
  await fs.writeFile(path.join(outDir, "variazioni-ct.json"), JSON.stringify(changes));
  log.push(`storico CardTrader: variazioni 24h di ${Object.keys(changes.p).length} carte`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, outDir, ...rest] = process.argv.slice(2);
  if (!mode || !outDir) {
    console.log("uso: node prezzi/src/storico.js tp <cartella> [max archivi] | cm <cartella> | ct <cartella> <onepiece.json> <lorcana.json> <dragonball.json> <yugioh.json>");
    process.exit(1);
  }
  // STORICO_RILEGGI=1 (rilettura di tutti gli archivi dal Mac, es. per categorie nuove): i file dello storico e i giorni
  // letti si prendono dalla cartella di uscita, non da Supabase, così si va avanti a blocchi (STORICO_PAUSA_MS tra gli
  // archivi) senza caricare nulla tra un blocco e l'altro; alla fine si carica tutto a mano.
  let fetchJson = json;
  if (process.env.STORICO_RILEGGI === "1" && mode === "tp") {
    fetchJson = async (url) => {
      if (!url.startsWith(`${BASE}/tp/`)) return json(url);
      try {
        return JSON.parse(await fs.readFile(path.join(outDir, "tp", url.slice(`${BASE}/tp/`.length)), "utf8"));
      } catch {
        return null; // mai letto in questa rilettura: si riparte da zero (anche _giorni.json)
      }
    };
  }
  let log;
  if (mode === "cm") {
    log = await updateCardmarket({ outDir });
  } else if (mode === "ct") {
    const catalogs = [];
    for (const [i, c] of CT_CATALOGS.entries()) {
      const file = rest[i];
      if (!file) continue;
      try {
        catalogs.push({ prefix: c.prefix, data: JSON.parse(await fs.readFile(file, "utf8")) });
      } catch (err) {
        console.log(`${c.file} non letto (${err.message}): salto`);
      }
    }
    log = await updateCt({ outDir, catalogs });
  } else {
    log = await updateTcgplayer({ outDir, max: rest[0] ? Number(rest[0]) : 40, fetchJson });
  }
  console.log(log.join("\n"));
}
