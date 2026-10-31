// Catalogo TCGplayer di tutte le carte e i prodotti Pokémon (inglesi, categoria 3, e giapponesi, 85),
// dai file gratuiti di tcgcsv.com, con il prezzo di mercato in euro (cambio BCE). È l'ultima fonte
// dell'app: per le righe di Collectr che non sono né su TCGdex, né su Cardmarket, né su CardTrader
// (Collectr prende i nomi proprio da TCGplayer: "Ho-oh - 11/12 (Box Topper)", "Card-Flip Game"...).
//
//   node prezzi/src/tcgplayer-all.js <uscita.json>
//
// Uscita (prezzi/v1/tcgplayer.json):
//   { v, updated, usdEur, g: { idGruppo: [nome, categoria] }, p: { idProdotto: [nome, idGruppo, numero, prezzoEUR|null] } }
import fs from "node:fs/promises";
import { ecbUsd } from "./tcgplayer-ja.js";
import { fetchRetry } from "./rete.js";

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://cirolomonaco90-cyber.github.io/cartella-tcg/)" };
export const CATEGORIES = [3, 85];

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Prezzo di mercato del prodotto in euro: la variante normale/holo, altrimenti la prima con un prezzo. */
export function marketEur(prices, usdEur) {
  // Prezzo di mercato (vendite recenti); senza vendite recenti il prezzo medio delle offerte, ma solo
  // se ce n'è più d'una (una sola offerta non fa un prezzo: "Ho-oh Box Topper" a 850 $).
  for (const key of ["marketPrice", "midPrice"]) {
    const ok = prices.filter((x) => typeof x[key] === "number" && x[key] > 0 && (key !== "midPrice" || x.lowPrice < x.highPrice));
    const best = ok.find((x) => !/reverse/i.test(x.subTypeName)) ?? ok[0];
    if (best) return Math.round((best[key] / usdEur) * 100) / 100;
  }
  return null;
}

/** Righe del catalogo di un gruppo: { idProdotto: [nome, idGruppo, numero, prezzoEUR|null] }. */
export function groupRows(groupId, products, prices, usdEur) {
  const byProduct = new Map();
  for (const p of prices) {
    if (!byProduct.has(p.productId)) byProduct.set(p.productId, []);
    byProduct.get(p.productId).push(p);
  }
  const out = {};
  for (const prod of products) {
    const number = prod.extendedData?.find((e) => e.name === "Number")?.value ?? "";
    out[prod.productId] = [prod.name, groupId, number, marketEur(byProduct.get(prod.productId) ?? [], usdEur)];
  }
  return out;
}

/** Esegue [fn] su ogni elemento con al massimo [n] richieste insieme. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function buildTcgplayerAll({ now = new Date() } = {}) {
  const log = [];
  const usdEur = ecbUsd(await (await fetchRetry(ECB)).text());
  if (!usdEur) throw new Error("cambio USD/EUR della BCE non letto");
  const g = {};
  const p = {};
  let failed = 0;
  for (const cat of CATEGORIES) {
    const groups = (await json(`${TCGCSV}/${cat}/groups`)).results ?? [];
    await pool(groups, 8, async (grp) => {
      try {
        const [products, prices] = await Promise.all([
          json(`${TCGCSV}/${cat}/${grp.groupId}/products`),
          json(`${TCGCSV}/${cat}/${grp.groupId}/prices`),
        ]);
        g[grp.groupId] = [grp.name, cat];
        Object.assign(p, groupRows(grp.groupId, products.results ?? [], prices.results ?? [], usdEur));
      } catch {
        failed++;
      }
    });
  }
  log.push(`TCGplayer: ${Object.keys(p).length} prodotti in ${Object.keys(g).length} gruppi${failed ? `, ${failed} gruppi non letti` : ""} (1 EUR = ${usdEur} USD)`);
  return { data: { v: 1, updated: now.toISOString(), usdEur, g, p }, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.log("uso: node prezzi/src/tcgplayer-all.js <uscita.json>");
    process.exit(1);
  }
  const { data, log } = await buildTcgplayerAll();
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
}
