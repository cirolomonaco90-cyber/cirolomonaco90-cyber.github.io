// Immagini delle carte su CardTrader (foto del prodotto), per le carte che non hanno
// immagine né su TCGdex né su pokemontcg.io né su TCGplayer.
//
//   CARDTRADER_TOKEN=... node prezzi/immagini/cardtrader.js <uscita.json>
//
// Uscita: { cm: {idProdottoCardmarket: url}, tp: {idProdottoTCGplayer: url},
//           sets: {idSetTCGdex: {numero: url}} }
// "sets": set solo giapponesi che su TCGdex non hanno né immagini né id Cardmarket/TCGplayer
// (es. Pokémon Card★web): si abbinano per numero di collezione ("042/048" -> 42).
import fs from "node:fs/promises";
import { CardTrader } from "../src/cardtrader.js";

function imageUrl(bp) {
  const v = bp.image_url ?? bp.image?.url ?? bp.image?.show?.url ?? bp.image;
  if (typeof v !== "string" || !v) return null;
  // Indirizzo diretto (senza il reindirizzamento da cardtrader.com a www.cardtrader.com).
  const full = v.startsWith("http") ? v : `https://www.cardtrader.com${v.startsWith("/") ? "" : "/"}${v}`;
  return full.replace(/^https?:\/\/cardtrader\.com\//, "https://www.cardtrader.com/");
}

// Codice espansione CardTrader -> id del set su TCGdex.
export const JAPANESE_SETS = { pwe: "web1" };

// Foto grande (senza "preview_"), per la scheda della carta.
const fullSize = (url) => url.replace(/\/preview_([^/]+)$/, "/$1");

const out = process.argv[2];
const token = process.env.CARDTRADER_TOKEN;
if (!token) {
  console.log("CARDTRADER_TOKEN mancante: niente immagini CardTrader");
  await fs.writeFile(out, JSON.stringify({ cm: {}, tp: {}, sets: {} }));
  process.exit(0);
}
const ct = new CardTrader({ token });
const gameId = await ct.pokemonGameId();
const expansions = await ct.expansions(gameId);
const res = { cm: {}, tp: {}, sets: {} };
let sample = null;
for (const e of expansions) {
  let bps = [];
  try {
    bps = await ct.blueprints(e.id);
  } catch (err) {
    console.log(`! ${e.name}: ${err.message}`);
    continue;
  }
  for (const bp of bps) {
    if (!sample) sample = bp;
    const url = imageUrl(bp);
    if (!url) continue;
    for (const id of bp.card_market_ids || []) res.cm[id] ??= url;
    if (bp.tcg_player_id) res.tp[bp.tcg_player_id] ??= url;
    const setId = JAPANESE_SETS[e.code];
    const n = parseInt(String(bp.fixed_properties?.collector_number ?? "").split("/")[0], 10);
    if (setId && n > 0) (res.sets[setId] ??= {})[n] ??= fullSize(url);
  }
}
console.log(`Espansioni: ${expansions.length}; immagini CardTrader: ${Object.keys(res.cm).length} (Cardmarket), ${Object.keys(res.tp).length} (TCGplayer); ` +
  `set giapponesi: ${Object.entries(res.sets).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(", ") || "nessuno"}`);
if (sample) console.log(`Esempio di blueprint: campi ${Object.keys(sample).join(", ")}; immagine ${JSON.stringify(sample.image_url ?? sample.image)}`);
await fs.writeFile(out, JSON.stringify(res));
