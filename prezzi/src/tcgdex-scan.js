// Scarica da TCGdex (inglese) i dati di ogni carta che servono a controllare i prodotti
// Cardmarket (nome, numero, attacchi, abilità, id Cardmarket di carta e varianti) e a dare i prezzi
// Cardmarket alla collezione senza chiamare TCGdex (varianti dettagliate con i loro prodotti, vedi
// cm-prezzi.js). Le risposte restano in una cache: una carta già letta non si scarica di nuovo
// (quelle salvate da una versione vecchia dello script, senza le varianti, sì; quelle senza prodotto
// Cardmarket né prezzi TCGplayer ogni RECHECK_DAYS giorni). Le carte con prezzi TCGplayer si rileggono
// ogni notte: quei prezzi (in dollari, TCGdex li aggiorna ogni sera) finiscono nel file dei prezzi così
// come sono, e l'app non deve più chiederli a TCGdex una carta alla volta.
//
//   node src/tcgdex-scan.js <cache.json> [lingua]
//
// [lingua]: "en" (predefinita) o "ja" (catalogo giapponese di TCGdex, per i prezzi delle copie giapponesi).
// SCAN_MINUTI (90): dopo tanti minuti non si chiede più nulla; le carte rimaste tengono i dati di ieri e
// si rileggono la notte dopo (TCGdex lento non deve far annullare la parte del job da GitHub).
// RILEGGI=1 (il lunedì): si rileggono tutte le carte, tenendo i dati di prima per quelle che non rispondono
// (RISCARICA=1 invece butta la cache: le carte non lette mancherebbero dal file dei prezzi).
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";

const API = "https://api.tcgdex.net/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 1) {
  try {
    const res = await fetchRetry(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
    await sleep(2000 * attempt);
    return getJson(url, attempt + 1);
  }
}

/** true se un blocco "pricing" di TCGdex ha prezzi TCGplayer (l'app li usa quando manca Cardmarket). */
function hasTcgplayer(pricing) {
  const t = pricing?.tcgplayer;
  return !!t && typeof t === "object" && Object.values(t).some((v) => v && typeof v === "object");
}

/**
 * I prezzi TCGplayer di un blocco "pricing" di TCGdex in breve: {versione: [mercato, medio]} con le versioni di
 * TCGdex ("normal", "holofoil", "reverse-holofoil", "1st-edition-holofoil", "unlimited-holofoil"...), in dollari
 * come li dà TCGdex; null = il campo manca (non è zero: l'app passa dal prezzo di mercato a quello medio solo se
 * il primo manca). Null se il blocco non ha prezzi TCGplayer. L'app usa solo marketPrice e midPrice.
 */
export function compactTcgplayer(pricing) {
  const t = pricing?.tcgplayer;
  if (!t || typeof t !== "object") return null;
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const out = {};
  for (const [key, v] of Object.entries(t)) {
    if (!v || typeof v !== "object") continue;
    out[key] = [num(v.marketPrice), num(v.midPrice)];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Una voce di variants_detailed in una riga: "tipo:prodotto|subtype:…|stamp:…|foil:…|size:…"
 * (gli stessi campi che legge l'app; prodotto vuoto se TCGdex non lo dà; "!" dopo il prodotto se
 * TCGdex non ha prezzi Cardmarket per la variante).
 */
export function compactVariant(v) {
  const cm = Number(v?.thirdParty?.cardmarket ?? v?.pricing?.cardmarket?.idProduct) || "";
  const priced = !!v?.pricing?.cardmarket;
  const parts = [`${v?.type ?? ""}:${cm}${cm && !priced ? "!" : ""}`];
  if (v?.subtype) parts.push(`subtype:${v.subtype}`);
  for (const s of Array.isArray(v?.stamp) ? v.stamp : []) parts.push(`stamp:${s}`);
  if (v?.foil) parts.push(`foil:${v.foil}`);
  if (v?.size && v.size !== "standard") parts.push(`size:${v.size}`);
  // Prodotto TCGplayer della variante: per la variazione delle 24 ore di mercato e le gradate.
  const tp = Number(v?.thirdParty?.tcgplayer) || 0;
  if (tp) parts.push(`tp:${tp}`);
  return parts.join("|");
}

/**
 * Nomi delle carte senza reverse (ex, EX, Star): la stessa regola di Variants.NO_REVERSE_NAME nell'app
 * (shared/…/data/Variants.kt), da tenere uguale.
 */
const NO_REVERSE_NAME = /(\s(ex|EX)$)|☆|\bStar$/;

/**
 * Le altre cose della carta da cui dipende il valore di una copia, in lettere: n, r, h, 1 = le versioni che TCGdex
 * dichiara in "variants" (normale, reverse, holo, 1ª edizione: l'app le propone anche se mancano tra le varianti
 * dettagliate); H o R = rarità con o senza "holo" (per l'app il prezzo generale è della finitura della rarità, l'altra
 * è indicativa), nessuna delle due = rarità sconosciuta; x = nome di una carta senza reverse (ex, EX, Star).
 */
export function cardFlags(d) {
  const v = d?.variants || {};
  let s = "";
  if (v.normal === true) s += "n";
  if (v.reverse === true) s += "r";
  if (v.holo === true) s += "h";
  if (v.firstEdition === true) s += "1";
  if (typeof d?.rarity === "string") s += /holo/i.test(d.rarity) ? "H" : "R";
  if (typeof d?.name === "string" && NO_REVERSE_NAME.test(d.name)) s += "x";
  return s;
}

/**
 * Formato della carta compatta: cambiandolo, la scansione riscarica le carte salvate con quello vecchio.
 * 3 (10 novembre 2026): i prezzi TCGplayer della carta ("tpp") e delle varianti dettagliate ("vt"), e "fl" (cardFlags).
 */
export const FORMAT = 3;

/** Solo i campi utili di una carta TCGdex (risposta di cards/{id}). */
export function compactCard(d) {
  const cmOf = (o) => Number(o?.thirdParty?.cardmarket ?? o?.pricing?.cardmarket?.idProduct) || null;
  const third = Number(d.thirdParty?.cardmarket) || null;
  const priced = Number(d.pricing?.cardmarket?.idProduct) || null;
  const vd = d.variants_detailed || [];
  const detailed = vd.filter((v) => v?.type);
  const tpp = compactTcgplayer(d.pricing);
  const vt = detailed.map((v) => compactTcgplayer(v.pricing));
  return {
    id: d.id,
    f: FORMAT,
    set: d.set?.id ?? null,
    localId: d.localId ?? "",
    name: d.name ?? "",
    attacks: (d.attacks || []).map((a) => a.name).filter(Boolean),
    abilities: (d.abilities || []).map((a) => a.name).filter(Boolean),
    cm: priced ?? third,
    // Prodotto "thirdParty" diverso da quello dei prezzi (raro): l'app li tiene entrambi, questo per primo.
    ...(third && priced && third !== priced ? { cm2: third } : {}),
    // true se TCGdex ha prezzi Cardmarket per la carta (non solo il collegamento al prodotto).
    pr: !!d.pricing?.cardmarket,
    // true se TCGdex ha prezzi TCGplayer (carta o varianti): l'app li usa dove manca Cardmarket.
    tp: hasTcgplayer(d.pricing) || vd.some((v) => hasTcgplayer(v?.pricing)),
    // Prezzi TCGplayer della carta e, nello stesso ordine di "vd", delle varianti dettagliate (null = nessuno).
    ...(tpp ? { tpp } : {}),
    ...(vt.some(Boolean) ? { vt } : {}),
    // Versioni dichiarate, rarità holo o no, nome senza reverse (cardFlags).
    fl: cardFlags(d),
    variants: vd.map(cmOf),
    vd: detailed.map(compactVariant),
    updated: d.updated ?? null,
  };
}

/**
 * Giorni tra due controlli di una carta letta senza prodotto Cardmarket né prezzi TCGplayer: ogni notte (fino al 9 novembre
 * 2026 ogni 3, e intanto l'app le chiedeva a TCGdex a ogni aggiornamento dei prezzi). Il file dei prezzi dice all'app da che
 * giorno sono lette ("ck" in cm-prezzi.js): se è recente, l'app non chiede più nulla a TCGdex per le carte del file.
 */
export const RECHECK_DAYS = 1;

/** Giorni tra due letture di una carta con prezzi TCGplayer: ogni notte, come li aggiorna TCGdex. */
export const TCGPLAYER_DAYS = 1;

/**
 * true se la carta [cached] va (ri)scaricata da TCGdex il giorno [today] (giorni dal 1970): mai letta, salvata da uno
 * script vecchio (senza le varianti dettagliate o in un formato precedente), con prezzi TCGplayer letti da almeno
 * [TCGPLAYER_DAYS] giorni (cambiano ogni giorno e il file dei prezzi li riporta), oppure letta senza prodotto Cardmarket né
 * prezzi TCGplayer da almeno [RECHECK_DAYS] giorni. Le carte di un set appena uscito TCGdex le collega a Cardmarket dopo
 * qualche giorno: lette prima, restavano senza prodotto fino al lunedì dopo, quando la cache si rifà tutta (8 novembre
 * 2026, Collezione Classica del 30°: il file dei prezzi le dava senza prodotto e l'app teneva il prezzo del 31 ottobre).
 */
export function needsFetch(cached, today) {
  if (!cached?.vd || cached.f !== FORMAT) return true;
  const age = today - (cached.ck ?? 0);
  if (cached.tp) return age >= TCGPLAYER_DAYS;
  return !cached.cm && age >= RECHECK_DAYS;
}

/**
 * Tutte le carte nella lingua [lang]; [cache]: carte già lette (id -> carta compatta).
 * [all]: si rileggono tutte (il giro del lunedì: prodotti e varianti cambiano di rado). [deadline]: ora (ms) oltre la
 * quale non si chiede più nulla (0 = senza limite): le carte rimaste tengono i dati già in cache e si rileggono al
 * prossimo giro. [getCard]/[getList]: per i test, al posto delle richieste a TCGdex.
 */
export async function scan(cache = {}, { lang = "en", concurrency = 8, log = () => {}, now = Date.now(), all = false, deadline = 0, clock = Date.now, getList, getCard } = {}) {
  const list = (await (getList ? getList(lang) : getJson(`${API}/${lang}/cards`))) || [];
  // Senza l'elenco (TCGdex risponde vuoto) la cache si svuoterebbe e il file dei prezzi uscirebbe senza carte: meglio fermarsi.
  if (list.length === 0) throw new Error(`TCGdex (${lang}): elenco delle carte vuoto`);
  const today = Math.floor(now / 86_400_000);
  const read = (c) => c?.vd && c?.f === FORMAT;
  // Prima le carte mai lette o in un formato vecchio (senza, il file dei prezzi non le ha), poi quelle da rileggere, dalla
  // lettura più vecchia: se il tempo finisce prima, a restare indietro non sono sempre le stesse.
  const stale = list.map((c) => c.id).filter((id) => all || needsFetch(cache[id], today));
  const reread = stale.filter((id) => read(cache[id])).sort((a, b) => (cache[a].ck ?? 0) - (cache[b].ck ?? 0));
  const todo = [...stale.filter((id) => !read(cache[id])), ...reread];
  const tcgplayer = todo.filter((id) => read(cache[id]) && cache[id].tp).length;
  const recheck = todo.filter((id) => read(cache[id]) && !cache[id].tp).length;
  log(
    `TCGdex (${lang}): ${list.length} carte, da scaricare ${todo.length} ` +
      (all
        ? "(tutte: giro della settimana)"
        : `(di cui ${tcgplayer} per i prezzi TCGplayer di oggi e ${recheck} senza prodotto, da ricontrollare)`),
  );
  const out = { ...cache };
  let i = 0;
  let done = 0;
  let late = 0;
  let failed = 0;
  async function worker() {
    while (i < todo.length) {
      if (deadline > 0 && clock() > deadline) {
        late = todo.length - i;
        i = todo.length;
        return;
      }
      const id = todo[i++];
      const d = await (getCard ? getCard(lang, id) : getJson(`${API}/${lang}/cards/${encodeURIComponent(id)}`)).catch(() => null);
      // "ck": giorno della lettura, per rileggere quelle con prezzi TCGplayer e quelle senza prodotto (needsFetch).
      if (d) out[id] = { ...compactCard(d), ck: today };
      else failed++;
      if (++done % 2000 === 0) log(`  ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed > 0) log(`  ${failed} carte non lette (restano i dati di prima)`);
  if (late > 0) log(`  tempo finito: ${late} carte rimandate al prossimo giro (restano i dati di prima)`);
  // Le carte tolte da TCGdex escono dalla cache.
  const keep = new Set(list.map((c) => c.id));
  for (const id of Object.keys(out)) if (!keep.has(id)) delete out[id];
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || "tcgdex-cards.json";
  const lang = process.argv[3] || "en";
  const fresh = process.env.RISCARICA === "1";
  const cache = fresh ? {} : JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}"));
  const minutes = Number(process.env.SCAN_MINUTI || 90);
  const cards = await scan(cache, {
    lang,
    log: (s) => console.log(s),
    all: process.env.RILEGGI === "1",
    deadline: minutes > 0 ? Date.now() + minutes * 60_000 : 0,
  });
  await fs.writeFile(file, JSON.stringify(cards));
  console.log(`salvate ${Object.keys(cards).length} carte in ${file}`);
}
