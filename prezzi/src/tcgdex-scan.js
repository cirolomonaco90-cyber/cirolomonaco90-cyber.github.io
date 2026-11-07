// Scarica da TCGdex (inglese) i dati di ogni carta che servono a controllare i prodotti
// Cardmarket (nome, numero, attacchi, abilità, id Cardmarket di carta e varianti) e a dare i prezzi
// Cardmarket alla collezione senza chiamare TCGdex (varianti dettagliate con i loro prodotti, vedi
// cm-prezzi.js). Le risposte restano in una cache: una carta già letta non si scarica di nuovo
// (quelle salvate da una versione vecchia dello script, senza le varianti, sì).
//
//   node src/tcgdex-scan.js <cache.json> [lingua]
//
// [lingua]: "en" (predefinita) o "ja" (catalogo giapponese di TCGdex, per i prezzi delle copie giapponesi).
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

/** Formato della carta compatta: cambiandolo, la scansione riscarica le carte salvate con quello vecchio. */
export const FORMAT = 2;

/** Solo i campi utili di una carta TCGdex (risposta di cards/{id}). */
export function compactCard(d) {
  const cmOf = (o) => Number(o?.thirdParty?.cardmarket ?? o?.pricing?.cardmarket?.idProduct) || null;
  const third = Number(d.thirdParty?.cardmarket) || null;
  const priced = Number(d.pricing?.cardmarket?.idProduct) || null;
  const vd = d.variants_detailed || [];
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
    variants: vd.map(cmOf),
    vd: vd.filter((v) => v?.type).map(compactVariant),
    updated: d.updated ?? null,
  };
}

/** Tutte le carte nella lingua [lang]; [cache]: carte già lette (id -> carta compatta). */
export async function scan(cache = {}, { lang = "en", concurrency = 8, log = () => {} } = {}) {
  const list = (await getJson(`${API}/${lang}/cards`)) || [];
  // Le carte salvate da uno script vecchio (senza le varianti dettagliate, o in un formato precedente) si riscaricano.
  const todo = list.map((c) => c.id).filter((id) => !cache[id]?.vd || cache[id]?.f !== FORMAT);
  log(`TCGdex (${lang}): ${list.length} carte, da scaricare ${todo.length}`);
  const out = { ...cache };
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      const d = await getJson(`${API}/${lang}/cards/${encodeURIComponent(id)}`).catch(() => null);
      if (d) out[id] = compactCard(d);
      if (++done % 2000 === 0) log(`  ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
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
  const cards = await scan(cache, { lang, log: (s) => console.log(s) });
  await fs.writeFile(file, JSON.stringify(cards));
  console.log(`salvate ${Object.keys(cards).length} carte in ${file}`);
}
