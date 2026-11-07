// Prepara l'universo dei prodotti per i prezzi eBay (vedi ebay-prezzi.js): carte TCGdex inglesi e giapponesi, carte
// One Piece/Lorcana/Dragon Ball, sigillati Pokémon, con il valore dal listino ufficiale Cardmarket e l'elenco degli id
// che ha in collezione qualcuno (solo gli id, letti con la chiave segreta del job; nessun altro dato degli utenti).
//
//   node prezzi/src/ebay-universo.js <tcgdex-carte.json> <tcgdex-carte-ja.json> <cartella con i file del job> <universo.json>
// Nella cartella: onepiece.json, lorcana.json, dragonball.json, sealed.json, asia.json (mancanti = saltati).

import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./ebay-prezzi.js";
import { fetchRetry } from "./rete.js";

const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const SETS = "https://api.tcgdex.net/v2/en/sets";
const SUPA = "https://lafgthxgasunkxrgwqng.supabase.co";

const readJson = (f) => fs.readFile(f, "utf8").then(JSON.parse).catch(() => null);
async function getJson(url, headers = {}) {
  const r = await fetchRetry(url, { headers });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** Id delle copie in collezione di tutti gli utenti (senza doppioni). */
async function ownedIds() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return [];
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const rows = await getJson(`${SUPA}/rest/v1/owned_cards?select=card_id:data->>cardId&deleted=eq.false`, {
      apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`,
    }).catch(() => []);
    for (const r of rows) if (r.card_id) ids.add(r.card_id);
    if (rows.length < 1000) break;
  }
  return [...ids];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cardsFile, cardsJaFile, dir, out] = process.argv.slice(2);
  const guideRows = (await getJson(GUIDE)).priceGuides ?? [];
  const guide = Object.fromEntries(guideRows.map((g) => [g.idProduct, Math.max(g.trend ?? 0, g.avg30 ?? 0, g["trend-holo"] ?? 0)]));
  const setList = await getJson(SETS).catch(() => []);
  const sets = Object.fromEntries(setList.map((s) => [s.id, { official: s.cardCount?.official ?? null, name: s.name }]));
  const asia = await readJson(path.join(dir, "asia.json"));
  const ct = [];
  for (const [file, prefix, label] of [["onepiece.json", "op:", "one piece"], ["lorcana.json", "lc:", "lorcana"], ["dragonball.json", "db:", "dragon ball"], ["yugioh.json", "yg:", "yu-gi-oh"]]) {
    const data = await readJson(path.join(dir, file));
    if (data) ct.push({ prefix, label, data });
  }
  const universe = buildUniverse({
    cards: (await readJson(cardsFile)) ?? {},
    cardsJa: (await readJson(cardsJaFile)) ?? {},
    sets, asiaEn: asia?.en ?? {}, guide, ct,
    sealed: await readJson(path.join(dir, "sealed.json")),
  });
  const owned = await ownedIds();
  await fs.writeFile(out, JSON.stringify({ universe, owned }));
  const by = universe.reduce((m, p) => ((m[p.id.includes(":") ? p.id.split(":")[0] : "pokemon"] = (m[p.id.includes(":") ? p.id.split(":")[0] : "pokemon"] ?? 0) + 1), m), {});
  console.log(`Universo eBay: ${universe.length} prodotti ${JSON.stringify(by)}, ${owned.length} id in collezione`);
}
