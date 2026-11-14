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
import crypto from "node:crypto";
import { fetchRetry } from "./rete.js";
import { DATI } from "./dati.js";

const run = promisify(execFile);
export const BASE = `${DATI}/storico/v1`;
const ARCHIVE = (day) => `https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`;
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
/** Catalogo del job: prodotto Cardmarket -> espansione CardTrader (la stessa che l'app conosce da LanguagePrices). */
const CATALOG = `${DATI}/prezzi/v1/catalog.json`;
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
/**
 * Giorni recenti tenuti uno per uno nei file dello storico; prima restano solo i lunedì. Fino al 10 novembre 2026 restavano
 * i lunedì e gli ultimi due giorni: il grafico di un prodotto senza altro storico aveva 2-6 punti in un mese ("alcune carte
 * hanno pochissimi punti", detto dall'utente). Due mesi coprono i periodi 1G, 1S e 1M giorno per giorno.
 */
export const DAILY_DAYS = 60;
/**
 * Prodotti Cardmarket che il catalogo non collega a un'espansione (sigillati di tutti i giochi, oggetti): un file ogni
 * BUCKET numeri di prodotto, "cm/b<n>.json" (l'app lo trova dal solo id). Prima stavano tutti nel file "0", che con i
 * giorni tenuti uno per uno diventerebbe di molti megabyte per aprire un grafico solo.
 */
export const BUCKET = 5000;
export const bucketOf = (id) => `b${Math.floor(Number(id) / BUCKET)}`;
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
 * gli ultimi [daily] (60): un giorno più vecchio che non è lunedì sparisce quando ne arrivano di nuovi.
 */
export function addDay(shard, day, values, daily = DAILY_DAYS) {
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
  // I lunedì, gli ultimi [daily] giorni e comunque gli ultimi due presenti (per la variazione delle 24 ore).
  const fromDay = Math.min(order[Math.max(0, order.length - 2)][0], order[order.length - 1][0] - daily);
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
 * I giorni da leggere dagli archivi: tutti i lunedì da FIRST_DAY a ieri, più gli ultimi [recent] giorni fino a ieri
 * (l'archivio di oggi arriva domani; almeno due, per la variazione delle 24 ore).
 */
export function wantedDays(today, firstDay = FIRST_DAY, recent = DAILY_DAYS) {
  const yesterday = epochDay(today) - 1;
  const out = [];
  for (let d = epochDay(firstDay); d <= yesterday; d++) if (isMonday(d) || d > yesterday - Math.max(2, recent)) out.push(d);
  return out;
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

/** L'etag del file pubblicato (per lo spazio file di Supabase è l'md5 del contenuto); null se il file non c'è. */
async function remoteEtag(url) {
  const res = await fetchRetry(url, { method: "HEAD", headers: HEADERS });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (res.headers.get("etag") ?? "").replace(/^W\//, "").replaceAll('"', "") || undefined;
}

/**
 * I file dello storico già pubblicati letti dalla copia locale [dir] quando è identica a quella pubblicata
 * (stesso md5 dell'etag: una richiesta HEAD, senza scaricare il file), altrimenti scaricati come prima.
 * Nel job [dir] è ~/.collectorone/storico-copia, che resta nella memoria di Actions: job-notte.sh ci copia i file
 * appena caricati. Prima ogni notte si riscaricavano tutti i ~3.400 file (140 MB a notte, 4 GB al mese: quasi tutto
 * il traffico "non in cache" del piano gratuito di Supabase, 12 novembre 2026). Gli indirizzi con "?" (letture
 * fresche del file delle variazioni) e quelli fuori dallo storico passano sempre dalla rete.
 */
export function withLocalCopy(fetchJson, dir, { etag = remoteEtag, stats = null } = {}) {
  if (!dir) return fetchJson;
  return async (url) => {
    if (!url.startsWith(`${BASE}/`) || url.includes("?")) return fetchJson(url);
    let local = null;
    try {
      local = await fs.readFile(path.join(dir, url.slice(BASE.length + 1)));
    } catch {
      // mai copiato: si scarica
    }
    if (local) {
      let tag;
      try {
        tag = await etag(url);
      } catch {
        tag = undefined; // etag non letto: si scarica
      }
      if (tag === null) return null;
      if (tag && tag === crypto.createHash("md5").update(local).digest("hex")) {
        try {
          const data = JSON.parse(local.toString("utf8"));
          if (stats) stats.local = (stats.local ?? 0) + 1;
          return data;
        } catch {
          // copia rovinata: si scarica
        }
      }
    }
    if (stats) stats.remote = (stats.remote ?? 0) + 1;
    return fetchJson(url);
  };
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

/** Listini ufficiali Cardmarket degli altri giochi e i cataloghi dei loro sigillati (gli unici loro prodotti che l'app prezza da Cardmarket). */
export const OTHER_GAMES = [
  { game: 18, sealed: "onepiece-sealed.json" },
  { game: 19, sealed: "lorcana-sealed.json" },
  { game: 13, sealed: "dragonball-sealed.json" },
  { game: 3, sealed: "yugioh-sealed.json" },
];
const guideUrl = (game) => `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${game}.json`;
const PREZZI = `${DATI}/prezzi/v1`;
/** Gli oggetti da collezione hanno id da qui in su (prezzi/src/oggetti.js): valgono il prezzo di mercato eBay. */
const OBJECT_OFFSET = 2_000_000_000;

/**
 * Prezzi di oggi dei prodotti che il listino Pokémon non ha: { idProdotto: { t: centesimi } } con la tendenza Cardmarket
 * dei sigillati di One Piece, Lorcana, Dragon Ball e Yu-Gi-Oh! (dal listino del loro gioco, solo i prodotti dei nostri
 * cataloghi) e il prezzo di mercato eBay degli oggetti da collezione (dal catalogo dei sigillati Pokémon). Fino al 10
 * novembre 2026 non si registravano: nessuno storico e nessuna variazione delle 24 ore per 3.750 sigillati.
 * Una fonte che non risponde si salta (resta scritto nel registro).
 */
export async function extraCents({ fetchJson = json, log = [] } = {}) {
  const out = {};
  for (const { game, sealed } of OTHER_GAMES) {
    try {
      const ids = new Set(((await fetchJson(`${PREZZI}/${sealed}`))?.p ?? []).map((x) => Number(x.id)));
      let n = 0;
      for (const row of (await fetchJson(guideUrl(game)))?.priceGuides ?? []) {
        const t = cents(row.trend);
        if (t === null || !ids.has(Number(row.idProduct))) continue;
        out[row.idProduct] = { t };
        n++;
      }
      log.push(`storico Cardmarket, ${sealed.replace("-sealed.json", "")}: ${n} sigillati con la tendenza su ${ids.size}`);
    } catch (err) {
      log.push(`storico Cardmarket, ${sealed}: non letto (${err.message})`);
    }
  }
  try {
    let n = 0;
    for (const x of (await fetchJson(`${PREZZI}/sealed.json`))?.p ?? []) {
      const t = Number(x.id) >= OBJECT_OFFSET ? cents(x.cm?.mercato) : null;
      if (t === null) continue;
      out[x.id] = { t };
      n++;
    }
    log.push(`storico degli oggetti da collezione: ${n} con il prezzo di mercato`);
  } catch (err) {
    log.push(`storico degli oggetti: non letto (${err.message})`);
  }
  return out;
}

/** Quanti giorni indietro si cercano le copie del listino nell'archivio di Internet (più vecchie sarebbero punti isolati). */
export const ARCHIVE_DAYS = 75;
const CDX = `http://web.archive.org/cdx/search/cdx?url=${GUIDE.replace("https://", "")}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:8`;

/**
 * Le copie del listino Cardmarket dei Pokémon nell'archivio di Internet (web.archive.org tiene il file ufficiale quasi
 * ogni giorno dal settembre 2026): `list` dà le copie, una per giorno ("20261002172911"), `read` il listino di una copia.
 */
export const wayback = (max) => ({
  max,
  async list() {
    const rows = (await json(CDX)) ?? [];
    return rows.slice(1).map((r) => r[0]);
  },
  read: (ts) => json(`https://web.archive.org/web/${ts}id_/${GUIDE}`),
});

/**
 * Storico Cardmarket: aggiunge oggi dal listino ufficiale e scrive in [outDir]/cm un file per espansione CardTrader
 * (prodotto -> espansione dal catalogo del job, `cm` di catalog.json: è la mappa che ha anche l'app) e, per i prodotti
 * senza espansione (sigillati, oggetti; [extra] = quelli degli altri giochi, vedi [extraCents]), un file ogni [BUCKET] id
 * ([bucketOf]). Il file "0" (tutti i prodotti Pokémon senza espansione) resta per le app fino alla 0.9.173, con i soli
 * lunedì e gli ultimi due giorni come prima.
 *
 * [archive] (vedi [wayback]): recupera i giorni passati che mancano dalle copie del listino nell'archivio di Internet, al
 * massimo `archive.max` per volta, i più recenti prima; il giorno è quello scritto nel listino (`createdAt`). I giorni
 * fatti stanno in cm/_giorni.json (la prima volta: quelli già nel file "0").
 */
export async function updateCardmarket({ outDir, today = new Date(), fetchJson = json, guide, catalog, extra = {}, archive = null, log = [] }) {
  const d = epochDay(today.toISOString().slice(0, 10));
  guide ??= await fetchJson(GUIDE);
  catalog ??= await fetchJson(CATALOG);
  // I prodotti che il catalogo non collega a un'espansione (sigillati, altro) finiscono nel file "0" e nei file per id.
  const expOf = catalog?.cm ?? {};
  const store = shardStore("cm", fetchJson);
  const put = async (day, priceGuides, extraValues) => {
    const byExp = guideCents(priceGuides ?? [], (id) => expOf[id] ?? 0);
    const loose = byExp[0] ?? {};
    const byBucket = {};
    for (const [id, v] of Object.entries({ ...loose, ...extraValues })) (byBucket[bucketOf(id)] ??= {})[id] = v;
    const ids = [...Object.keys(byExp), ...Object.keys(byBucket)];
    await pool(ids, 8, async (id) => store.get(id));
    for (const [exp, values] of Object.entries(byExp)) store.set(exp, addDay(await store.get(exp), day, values, exp === "0" ? 0 : DAILY_DAYS));
    for (const [b, values] of Object.entries(byBucket)) store.set(b, addDay(await store.get(b), day, values));
    return { products: Object.values(byExp).reduce((n, v) => n + Object.keys(v).length, 0) + Object.keys(extraValues).length, exps: Object.keys(byExp).length, buckets: Object.keys(byBucket).length };
  };
  // I file per id nascono il 10 novembre 2026: la prima volta ognuno prende i giorni che il file "0" ha già per i suoi prodotti.
  const zero = await store.get("0");
  if (zero.d.length) {
    const idsOf = {};
    for (const id of Object.keys(zero.p)) (idsOf[bucketOf(id)] ??= []).push(id);
    await pool(Object.keys(idsOf), 8, async (b) => store.get(b));
    for (const [b, ids] of Object.entries(idsOf)) {
      let shard = await store.get(b);
      if (shard.d.length) continue;
      zero.d.forEach((day, i) => {
        const values = {};
        for (const id of ids) {
          const entry = {};
          for (const [k, arr] of Object.entries(zero.p[id])) if (arr[i] !== null && arr[i] !== undefined) entry[k] = arr[i];
          if (Object.keys(entry).length) values[id] = entry;
        }
        if (Object.keys(values).length) shard = addDay(shard, day, values);
      });
      store.set(b, shard);
    }
  }
  const now = await put(d, guide?.priceGuides, extra);
  const done = new Set(((await fetchJson(`${BASE}/cm/_giorni.json`)) ?? { d: (await store.get("0")).d }).d);
  done.add(d);
  let read = 0;
  let left = 0;
  if (archive) {
    try {
      // Una copia per giorno (l'ultima), non più vecchia di ARCHIVE_DAYS e non di oggi.
      const byDay = new Map();
      for (const ts of await archive.list()) {
        const sd = epochDay(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`);
        if (sd >= d - ARCHIVE_DAYS && sd < d) byDay.set(sd, ts);
      }
      const missing = [...byDay.keys()].filter((x) => !done.has(x)).sort((a, b) => b - a);
      left = missing.length;
      for (const sd of missing.slice(0, archive.max)) {
        const g = await archive.read(byDay.get(sd));
        const day = g?.createdAt ? epochDay(String(g.createdAt).slice(0, 10)) : sd;
        // Una copia presa prima dell'uscita del listino del giorno ha dentro quello del giorno prima: se c'è già, niente.
        if (g?.priceGuides?.length && (day === sd || !done.has(day))) {
          await put(day, g.priceGuides, {});
          done.add(day);
          read++;
        }
        done.add(sd);
        left--;
      }
    } catch (err) {
      // L'archivio non risponde: si salva quello già letto, il resto la prossima volta.
      log.push(`storico Cardmarket: archivio di Internet interrotto (${err.message}), ${read} giorni recuperati`);
    }
  }
  await store.write(outDir);
  await fs.writeFile(path.join(outDir, "cm", "_giorni.json"), JSON.stringify({ v: 1, d: [...done].sort((a, b) => a - b) }));
  const changes = dailyChanges(store.all());
  await fs.writeFile(path.join(outDir, "variazioni-cm.json"), JSON.stringify(changes));
  log.push(
    `storico Cardmarket: ${now.products} prodotti in ${now.exps} espansioni e ${now.buckets} file per id, giorno ${dayString(d)}` +
      (archive ? `, ${read} giorni recuperati dall'archivio di Internet${left > 0 ? ` (${left} ancora da recuperare)` : ""}` : "") +
      `, variazioni 24h di ${Object.keys(changes.p).length} prodotti`,
  );
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
 * più variazioni-ct.json ({ v, day, days: { prefisso: giorno }, p: { "op:<blueprint>": { lingua: % } } }).
 *
 * Ogni parte del job passa solo i cataloghi che ha appena costruito ("prezzi": One Piece, Lorcana, Dragon Ball; "yugioh":
 * Yu-Gi-Oh!) e nel file delle variazioni, che è uno solo, lascia le voci degli altri giochi come sono pubblicate, se sono
 * di oggi o di ieri ([days], o [day] nei file scritti prima). Fino al 10 novembre 2026 la parte "prezzi" faceva anche
 * Yu-Gi-Oh!, col catalogo che trovava pubblicato: quando la parte "yugioh" pubblicava dopo, confrontava il catalogo di
 * ieri con se stesso (0% per tutte le carte) e la notte dopo dava la variazione di due giorni.
 * Il file pubblicato si legge per ultimo, subito prima di scrivere: chi chiama lo carica per primo, così tra lettura e
 * caricamento passano pochi secondi (l'altra parte finisce a minuti di distanza).
 */
export async function updateCt({ outDir, today = new Date(), fetchJson = json, catalogs, log = [] }) {
  const d = epochDay(today.toISOString().slice(0, 10));
  const store = shardStore("ct", fetchJson);
  const changes = { v: 1, day: null, days: {}, p: {} };
  for (const { prefix, data } of catalogs) {
    const bySet = ctCents(data, prefix);
    const ids = Object.keys(bySet);
    await pool(ids, 8, async (id) => store.get(id));
    for (const id of ids) store.set(id, addDay(await store.get(id), d, bySet[id]));
    const ch = dailyChanges(await Promise.all(ids.map((id) => store.get(id))));
    for (const [bp, byLang] of Object.entries(ch.p)) changes.p[`${prefix}:${bp}`] = byLang;
    if (ch.day) changes.days[prefix] = ch.day;
    const cards = ids.reduce((n, id) => n + Object.keys(bySet[id]).length, 0);
    log.push(`storico CardTrader ${prefix}: ${cards} carte in ${ids.length} set, giorno ${dayString(d)}`);
  }
  await store.write(outDir);
  const others = await othersChanges({ changes, mine: new Set(catalogs.map((c) => c.prefix)), d, fetchJson, stamp: today.getTime(), log });
  changes.day = Object.values(changes.days).sort().at(-1) ?? null;
  await fs.writeFile(path.join(outDir, "variazioni-ct.json"), JSON.stringify(changes));
  log.push(`storico CardTrader: variazioni 24h di ${Object.keys(changes.p).length} carte${others ? ` (${others} di altri giochi, lasciate come pubblicate)` : ""}`);
  return log;
}

/**
 * Aggiunge a [changes] le variazioni pubblicate dei giochi che non sono tra i [mine] (li scrive un'altra parte del job),
 * solo se sono di oggi o di ieri: più vecchie non sono "delle 24 ore" (l'altra parte non gira da due notti) e si tolgono.
 * Restituisce quante carte ha aggiunto. `?t=` salta la copia del server, che può avere qualche minuto.
 */
async function othersChanges({ changes, mine, d, fetchJson, stamp, log }) {
  let published;
  try {
    published = await fetchJson(`${BASE}/variazioni-ct.json?t=${stamp}`);
  } catch (err) {
    log.push(`storico CardTrader: variazioni degli altri giochi non lette (${err.message})`);
    return 0;
  }
  let n = 0;
  const old = new Map();
  for (const [key, byLang] of Object.entries(published?.p ?? {})) {
    const prefix = key.split(":")[0];
    if (mine.has(prefix)) continue;
    const day = published.days?.[prefix] ?? published.day;
    if (!day || epochDay(day) < d - 1) {
      old.set(prefix, day ?? "senza giorno");
      continue;
    }
    changes.p[key] = byLang;
    changes.days[prefix] = day;
    n++;
  }
  for (const [prefix, day] of old) log.push(`storico CardTrader ${prefix}: variazioni pubblicate troppo vecchie (${day}), tolte`);
  return n;
}

/**
 * Cataloghi dalla riga di comando di `ct`: in ordine come [CT_CATALOGS] (onepiece, lorcana, dragonball, yugioh; un posto
 * vuoto si salta) oppure col prefisso del gioco davanti ("yg=/percorso/yugioh.json": la parte "yugioh" passa solo il suo).
 */
export function ctArgs(args) {
  const out = [];
  for (const [i, arg] of args.entries()) {
    const m = /^([a-z]{2})=(.+)$/.exec(arg);
    const c = m ? CT_CATALOGS.find((x) => x.prefix === m[1]) : CT_CATALOGS[i];
    const file = m ? m[2] : arg;
    if (c && file) out.push({ prefix: c.prefix, file });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, outDir, ...rest] = process.argv.slice(2);
  if (!mode || !outDir) {
    console.log("uso: node prezzi/src/storico.js tp <cartella> [max archivi] | cm <cartella> [giorni dall'archivio] | ct <cartella> <onepiece.json> <lorcana.json> <dragonball.json> | ct <cartella> yg=<yugioh.json>");
    process.exit(1);
  }
  // STORICO_RILEGGI=1 (rilettura di tutti gli archivi dal Mac, es. per categorie nuove): i file dello storico e i giorni
  // letti si prendono dalla cartella di uscita, non da Supabase, così si va avanti a blocchi (STORICO_PAUSA_MS tra gli
  // archivi) senza caricare nulla tra un blocco e l'altro; alla fine si carica tutto a mano.
  // STORICO_COPIA: cartella con la copia dei file già pubblicati (vedi withLocalCopy).
  const copyStats = {};
  let fetchJson = withLocalCopy(json, process.env.STORICO_COPIA, { stats: copyStats });
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
    // Secondo argomento: quanti giorni passati recuperare al massimo dall'archivio di Internet (0 = nessuno).
    const max = rest[0] ? Number(rest[0]) : 0;
    log = [];
    const extra = await extraCents({ log });
    await updateCardmarket({ outDir, extra, archive: max > 0 ? wayback(max) : null, log, fetchJson });
  } else if (mode === "ct") {
    const catalogs = [];
    for (const { prefix, file } of ctArgs(rest)) {
      try {
        catalogs.push({ prefix, data: JSON.parse(await fs.readFile(file, "utf8")) });
      } catch (err) {
        console.log(`${file} non letto (${err.message}): salto`);
      }
    }
    log = await updateCt({ outDir, catalogs, fetchJson });
  } else {
    log = await updateTcgplayer({ outDir, max: rest[0] ? Number(rest[0]) : 40, fetchJson });
  }
  if (process.env.STORICO_COPIA) console.log(`file dello storico: ${copyStats.local ?? 0} dalla copia locale, ${copyStats.remote ?? 0} scaricati`);
  console.log(log.join("\n"));
}
