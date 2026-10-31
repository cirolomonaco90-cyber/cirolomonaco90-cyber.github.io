// Scarica da TCGdex (inglese) i dati di ogni carta che servono a controllare i prodotti
// Cardmarket: nome, numero, attacchi, abilità e id Cardmarket (carta e varianti).
// Le risposte restano in una cache: una carta già letta non si scarica di nuovo.
//
//   node src/tcgdex-scan.js <cache.json>
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";

const API = "https://api.tcgdex.net/v2/en";
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

/** Solo i campi utili di una carta TCGdex (risposta di cards/{id}). */
export function compactCard(d) {
  const cmOf = (o) => Number(o?.thirdParty?.cardmarket ?? o?.pricing?.cardmarket?.idProduct) || null;
  return {
    id: d.id,
    set: d.set?.id ?? null,
    localId: d.localId ?? "",
    name: d.name ?? "",
    attacks: (d.attacks || []).map((a) => a.name).filter(Boolean),
    abilities: (d.abilities || []).map((a) => a.name).filter(Boolean),
    cm: Number(d.pricing?.cardmarket?.idProduct ?? d.thirdParty?.cardmarket) || null,
    variants: (d.variants_detailed || []).map(cmOf),
    updated: d.updated ?? null,
  };
}

/** Tutte le carte inglesi; [cache]: carte già lette (id -> carta compatta). */
export async function scan(cache = {}, { concurrency = 8, log = () => {} } = {}) {
  const list = (await getJson(`${API}/cards`)) || [];
  const todo = list.map((c) => c.id).filter((id) => !cache[id]);
  log(`TCGdex: ${list.length} carte, da scaricare ${todo.length}`);
  const out = { ...cache };
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      const d = await getJson(`${API}/cards/${encodeURIComponent(id)}`).catch(() => null);
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
  const fresh = process.env.RISCARICA === "1";
  const cache = fresh ? {} : JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}"));
  const cards = await scan(cache, { log: (s) => console.log(s) });
  await fs.writeFile(file, JSON.stringify(cards));
  console.log(`salvate ${Object.keys(cards).length} carte in ${file}`);
}
