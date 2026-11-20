// Prezzi TCGplayer delle carte giapponesi (terza fonte dopo Cardmarket e CardTrader), dai file
// gratuiti e quotidiani di tcgcsv.com (categoria 85 "Pokemon Japan"), convertiti in euro con il
// cambio del giorno della BCE.
//
//   node prezzi/src/tcgplayer-ja.js <uscita.json>
//
// Uscita (prezzi/v1/tcgplayer-ja.json):
//   { v, updated, usdEur, sets: { idSetTCGdex: { numero: [n, r] } } }
// numero senza zeri davanti ("007" -> "7"); n = prezzo di mercato EUR della carta (normale/holo/
// 1ª edizione), r = della reverse; null se TCGplayer non ha vendite recenti (solo il "market price").
// I set TCGplayer si abbinano ai set giapponesi di TCGdex per sigla ("SV9: Battle Partners" -> SV9) o
// per nome inglese (i nomi di carte/v1/asia.json: "Fever-Burst Fighter" -> XY11a); una carta il cui
// numero dopo la barra non è il totale del set viene scartata (meglio senza prezzo che sbagliato).
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";
import { JA_GROUPS } from "./asia-vuoti.js";
import { DATI } from "./dati.js";

const TCGCSV = "https://tcgcsv.com/tcgplayer/85";
const ASIA = `${DATI}/carte/v1/asia.json`;
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };

/** Nome per il confronto: minuscole, senza accenti, "&" = "and", solo lettere e cifre. */
export function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sigla per il confronto con gli id TCGdex: "sm1+" -> "sm1plus", "XY11-Bb" -> "xy11bb". */
function normCode(s) {
  return String(s ?? "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
}

/**
 * Set TCGdex giapponese di un set TCGplayer: per sigla, poi per nome inglese ("SV9: Battle Partners"
 * -> "Battle Partners"). jaIds = id dei set giapponesi di TCGdex; names = nome normalizzato -> id.
 */
export function groupSet(group, jaIds, names) {
  const byCode = new Map(jaIds.map((id) => [normCode(id), id]));
  const code = normCode(group.abbreviation);
  if (code && byCode.has(code)) return byCode.get(code);
  const name = String(group.name ?? "");
  const afterColon = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  return names.get(normName(afterColon)) ?? names.get(normName(name)) ?? null;
}

/** Set TCGdex di un gruppo della tabella a mano [JA_GROUPS]; null per gli altri gruppi. */
export function fixedSet(groupId) {
  for (const [id, groups] of Object.entries(JA_GROUPS)) if (groups.includes(groupId)) return id;
  return null;
}

/** "007/141" -> ["7", "141"]; "SV-P 001" o senza numero -> null. */
export function splitNumber(raw) {
  const m = /^0*(\d+[a-z]?)\s*(?:\/\s*(\S+))?$/i.exec(String(raw ?? "").trim());
  return m ? [m[1].toLowerCase(), m[2] ?? null] : null;
}

/**
 * Tra più prodotti con lo stesso numero resta quello senza aggiunte tra parentesi, se è uno solo ("Zekrom - 095/093"
 * e "Zekrom - 095/093 (Mirror Holofoil)": la carta è la prima). Per i set dove ogni carta ha anche la sua versione
 * speciale (EX Battle Boost), che altrimenti resterebbero tutti senza prezzo.
 */
export function plainProducts(products) {
  const number = (p) => splitNumber(p.extendedData?.find((e) => e.name === "Number")?.value)?.[0] ?? null;
  const groups = new Map();
  for (const p of products) {
    const n = number(p);
    if (n == null) continue;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(p);
  }
  const drop = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const plain = list.filter((p) => !/\(.+\)/.test(String(p.name ?? "")));
    if (plain.length === 1) for (const p of list) if (p !== plain[0]) drop.add(p);
  }
  return products.filter((p) => !drop.has(p));
}

/**
 * Prezzi di un set: { numero: [n, r] } in euro. Un numero con più prodotti diversi (stampe
 * speciali con lo stesso numero) si salta: non si sa quale sia la carta.
 */
export function setPrices(products, prices, usdEur, total, ids = null, plainFirst = false) {
  if (plainFirst) products = plainProducts(products);
  const byProduct = new Map();
  for (const p of prices) {
    if (!byProduct.has(p.productId)) byProduct.set(p.productId, []);
    byProduct.get(p.productId).push(p);
  }
  const eur = (v) => (typeof v === "number" && v > 0 ? Math.round((v / usdEur) * 100) / 100 : null);
  const seen = new Map();
  for (const prod of products) {
    const numRaw = prod.extendedData?.find((e) => e.name === "Number")?.value;
    const num = splitNumber(numRaw);
    if (!num) continue;
    const [n, den] = num;
    if (den && /^\d+$/.test(den) && total && Number(den) !== total) continue;
    const list = byProduct.get(prod.productId) ?? [];
    const reverse = list.find((x) => /reverse/i.test(x.subTypeName));
    const normal = list.find((x) => !/reverse/i.test(x.subTypeName) && x.marketPrice > 0) ?? list.find((x) => !/reverse/i.test(x.subTypeName));
    const row = [eur(normal?.marketPrice), eur(reverse?.marketPrice)];
    seen.set(n, seen.has(n) ? null : row);
    if (ids) ids[n] = seen.get(n) ? prod.productId : null;
  }
  if (ids) for (const [n, id] of Object.entries(ids)) if (!id) delete ids[n];
  return Object.fromEntries([...seen].filter(([, row]) => row && (row[0] || row[1])));
}

/**
 * Set giapponesi vecchi su TCGplayer (senza numeri) -> set TCGdex. Collectr e TCGdex li numerano in
 * modi diversi, TCGplayer non li numera: le carte si abbinano col Pokémon (vedi [dexPrices]).
 */
export const OLD_GROUPS = {
  "Expansion Pack": "PMCG1",
  "Pokemon Jungle": "PMCG2",
  "Mystery of the Fossils": "PMCG3",
  "Rocket Gang": "PMCG4",
  "Leaders' Stadium": "PMCG5",
  "Challenge from the Darkness": "PMCG6",
  "Gold, Silver, to a New World...": "neo1",
  "Crossing the Ruins...": "neo2",
  "Awakening Legends": "neo3",
  "Darkness, and to Light...": "neo4",
};

const compact = (s) => normName(String(s ?? "").replace(/\([^)]*\)/g, " ")).replace(/ /g, "");

/**
 * Prezzi dei set vecchi: TCGdex dà per ogni carta il numero del Pokédex (dex = { numeroPokédex:
 * idCarta }, solo Pokémon presenti una volta nel set), PokeAPI il nome inglese della specie
 * (species[n-1] = "charizard"), e su TCGplayer la carta è il prodotto il cui nome finisce con quella
 * specie ("Dark Charizard", "Brock's Rhydon"), se è uno solo. Chiave: numero della carta TCGdex.
 */
export function dexPrices(products, prices, dex, species, usdEur, names = null, ids = null) {
  const byProduct = new Map();
  for (const p of prices) {
    if (!byProduct.has(p.productId)) byProduct.set(p.productId, []);
    byProduct.get(p.productId).push(p);
  }
  const eur = (v) => (typeof v === "number" && v > 0 ? Math.round((v / usdEur) * 100) / 100 : null);
  const out = {};
  for (const [n, cardId] of Object.entries(dex ?? {})) {
    const sp = compact(species[Number(n) - 1]);
    if (!sp) continue;
    const found = products.filter((p) => compact(p.name).endsWith(sp));
    if (found.length !== 1) continue;
    const list = byProduct.get(found[0].productId) ?? [];
    const normal = list.find((x) => !/reverse/i.test(x.subTypeName) && x.marketPrice > 0);
    const price = eur(normal?.marketPrice);
    const key = String(cardId).split("-").pop().replace(/^0+(?=\d)/, "");
    if (price) out[key] = [price, null];
    if (names) names[key] = found[0].name;
    if (ids) ids[key] = found[0].productId;
  }
  return out;
}

/** Cambio USD per 1 EUR dal file quotidiano della BCE. */
export function ecbUsd(xml) {
  const m = /currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml);
  return m ? Number(m[1]) : null;
}

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function buildTcgplayerJa({ now = new Date() } = {}) {
  const log = [];
  const usdEur = ecbUsd(await (await fetchRetry(ECB)).text());
  if (!usdEur) throw new Error("cambio USD/EUR della BCE non letto");
  const jaSets = await json("https://api.tcgdex.net/v2/ja/sets");
  const asia = await json(ASIA);
  const names = new Map(Object.entries(asia.names?.ja ?? {}).map(([k, id]) => [normName(k), id]));
  const groups = (await json(`${TCGCSV}/groups`)).results ?? [];
  const sets = {};
  let cards = 0;
  let mapped = 0;
  // Nomi inglesi delle carte dei set giapponesi vecchi (TCGdex li ha in giapponese): { set: { numero: nome } }.
  const enNames = {};
  // Prodotti TCGplayer di ogni carta: { set: { numero: idProdotto } }, per la foto delle carte senza immagine.
  const img = {};
  // Nomi delle specie in inglese (indice = numero del Pokédex - 1), per i set vecchi.
  let species = [];
  try {
    species = ((await json("https://pokeapi.co/api/v2/pokemon-species?limit=2000")).results ?? []).map((x) => x.name);
  } catch (err) {
    log.push(`! nomi dei Pokémon non letti: ${err.message}`);
  }
  for (const g of groups) {
    const old = OLD_GROUPS[g.name];
    if (old) {
      try {
        const [products, prices] = await Promise.all([json(`${TCGCSV}/${g.groupId}/products`), json(`${TCGCSV}/${g.groupId}/prices`)]);
        enNames[old] = {};
        img[old] ??= {};
        const p = dexPrices(products.results ?? [], prices.results ?? [], asia.dex?.[old], species, usdEur, enNames[old], img[old]);
        sets[old] = { ...p, ...(sets[old] ?? {}) };
        cards += Object.keys(p).length;
        mapped++;
      } catch (err) {
        log.push(`! ${g.name}: ${err.message}`);
      }
      continue;
    }
    // Gruppi della tabella controllata a mano (asia-vuoti.js): il loro set è quello, e per un set con due gruppi
    // (due set TCGdex con lo stesso id) valgono i prezzi del primo, quello delle carte senza lettera. Un altro gruppo
    // che per sigla o nome finirebbe su uno di quei set si salta ("Black Collection" non è BW1b).
    const fixed = fixedSet(g.groupId);
    const guessed = groupSet(g, jaSets.map((s) => s.id), names);
    // Il set della tabella (solo dal suo primo gruppo) e, se è un altro, quello trovato per sigla o nome che non è
    // nella tabella ("Dragon Blade" è BW5b di TCGdex e anche il set "ct-dragonblade" preso da CardTrader).
    const targets = [];
    if (fixed && JA_GROUPS[fixed][0] === g.groupId) targets.push(fixed);
    if (guessed && guessed !== fixed && !JA_GROUPS[guessed]) targets.push(guessed);
    if (!targets.length) continue;
    mapped++;
    try {
      const [products, prices] = await Promise.all([json(`${TCGCSV}/${g.groupId}/products`), json(`${TCGCSV}/${g.groupId}/prices`)]);
      for (const setId of targets) {
        // Per i set della tabella il gruppo è già controllato: niente confronto col totale di TCGdex (EX Battle Boost
        // ha 96 carte su TCGdex e "/093" stampato), e tra una carta e la sua versione speciale vale la carta.
        const byHand = setId === fixed;
        const total = byHand ? null : asia.totals?.[`${setId}@ja`] ?? jaSets.find((s) => s.id === setId)?.cardCount?.official ?? null;
        const ids = {};
        const p = setPrices(products.results ?? [], prices.results ?? [], usdEur, total, ids, byHand);
        // Due set TCGplayer per lo stesso set TCGdex (es. ristampe): vale il primo per ogni numero.
        sets[setId] = { ...p, ...(sets[setId] ?? {}) };
        img[setId] = { ...ids, ...(img[setId] ?? {}) };
        cards += Object.keys(p).length;
      }
    } catch (err) {
      log.push(`! ${g.name}: ${err.message}`);
    }
  }
  log.push(`TCGplayer giapponese: ${mapped} set su ${groups.length} abbinati, ${cards} carte con un prezzo (1 EUR = ${usdEur} USD)`);
  return { data: { v: 1, updated: now.toISOString(), usdEur, sets, names: enNames, img }, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.log("uso: node prezzi/src/tcgplayer-ja.js <uscita.json>");
    process.exit(1);
  }
  const { data, log } = await buildTcgplayerJa();
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
}
