// I giochi presi tutti da CardTrader (One Piece, Lorcana, Dragon Ball, Yu-Gi-Oh!): catalogo e prezzi dal job di onepiece.js,
// Sealed dal catalogo e listino Cardmarket del gioco + foto e offerte CardTrader (sealed.js). Un errore di un gioco
// non ferma gli altri né i prezzi Pokémon. Per aggiungere un gioco: una riga in CT_GAME_FILES (più CT_GAMES in
// onepiece.js, i tipi dei sigillati in sealed.js, CT_CATALOGS in storico.js, impronte.py e job-notte.sh).
import fs from "node:fs/promises";
import path from "node:path";
import { buildOnePiece, buildLorcana, buildDragonBall, buildYuGiOh } from "./onepiece.js";
import { buildSealed, ONE_PIECE_SEALED_TYPES, LORCANA_SEALED_TYPES, DRAGON_BALL_SEALED_TYPES, YUGIOH_SEALED_TYPES } from "./sealed.js";
import { fetchRetry } from "./rete.js";
import { addTcgplayerIds } from "./tcgplayer-ct.js";

const CM_FILES = "https://downloads.s3.cardmarket.com/productCatalog";

export const CT_GAME_FILES = [
  // crossLangPhotos: i sigillati giapponesi o cinesi senza una foto nella loro lingua prendono quella inglese di TCGplayer (stesso
  // disegno della confezione); Yu-Gi-Oh! no, le confezioni OCG sono diverse e le foto giapponesi le dà Yugipedia (foto-fonti.js).
  { key: "onepiece", label: "One Piece", build: buildOnePiece, cmGame: 18, types: ONE_PIECE_SEALED_TYPES, crossLangPhotos: true },
  { key: "lorcana", label: "Lorcana", build: buildLorcana, cmGame: 19, types: LORCANA_SEALED_TYPES, crossLangPhotos: true },
  { key: "dragonball", label: "Dragon Ball", build: buildDragonBall, cmGame: 13, types: DRAGON_BALL_SEALED_TYPES, crossLangPhotos: true },
  { key: "yugioh", label: "Yu-Gi-Oh!", build: buildYuGiOh, cmGame: 3, types: YUGIOH_SEALED_TYPES },
];

async function fetchJson(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Scrive in [dir] <gioco>.json e <gioco>-sealed.json per ogni gioco di CT_GAME_FILES ([only]: solo quelle chiavi,
 * nell'ordine in cui sono scritte). Aggiunge le righe al registro [log] (e le stampa).
 */
export async function buildCtGameFiles({ ct, dir, maxExpansions = Infinity, log = [], only = null, fetchFn = fetchJson, games = CT_GAME_FILES }) {
  const list = only ? only.map((key) => games.find((g) => g.key === key)).filter(Boolean) : games;
  for (const g of list) {
    try {
      const r = await g.build({ ct, maxExpansions });
      r.log.forEach((l) => console.log(l));
      log.push(...r.log);
      // Prodotti TCGplayer delle carte (storico dal 2024 e variazione 24h nell'app, come per i Pokémon).
      const tpSealed = [];
      try {
        const tpLog = [];
        await addTcgplayerIds(g.key, r.data, { log: tpLog, sealed: tpSealed });
        tpLog.forEach((l) => console.log(l));
        log.push(...tpLog);
      } catch (err) {
        console.error(err);
        log.push(`! ${g.label}, prodotti TCGplayer non letti: ${err.message}`);
      }
      await fs.writeFile(path.join(dir, `${g.key}.json`), JSON.stringify(r.data));
      try {
        const [products, singles, guide] = await Promise.all([
          fetchFn(`${CM_FILES}/productList/products_nonsingles_${g.cmGame}.json`),
          fetchFn(`${CM_FILES}/productList/products_singles_${g.cmGame}.json`),
          fetchFn(`${CM_FILES}/priceGuide/price_guide_${g.cmGame}.json`),
        ]);
        const s = buildSealed({ products: products.products, singles: singles.products, guide, types: g.types, westernLang: "en", tpProducts: tpSealed, crossLangPhotos: g.crossLangPhotos ?? false, ...r.sealed });
        s.log.forEach((l) => console.log(`${g.label} ${l}`));
        log.push(...s.log.map((l) => `${g.label} ${l}`));
        await fs.writeFile(path.join(dir, `${g.key}-sealed.json`), JSON.stringify(s.data));
      } catch (err) {
        console.error(err);
        log.push(`! Sealed ${g.label} non aggiornati: ${err.message}`);
      }
    } catch (err) {
      console.error(err);
      log.push(`! ${g.label} non aggiornato: ${err.message}`);
    }
  }
  return log;
}
