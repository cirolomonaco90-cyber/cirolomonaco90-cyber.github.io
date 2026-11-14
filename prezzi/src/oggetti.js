// Oggetti da collezione che nessun mercato delle carte cataloga (medaglie Pokémon di Poste Italiane e Zecca
// dello Stato in cofanetto Poké Ball, folder filatelici...): elenco curato a mano in prezzi/dati/oggetti.json,
// aggiunto al catalogo dei sigillati come prodotti di tipo "object". Il valore è il prezzo di mercato dalle
// inserzioni eBay.it ("mercato", vedi ebay.js, con EBAY_APP_ID ed EBAY_CERT_ID); il listino ufficiale
// ("listino") è solo informativo.
//
//   node prezzi/src/oggetti.js prezzi/dati/oggetti.json <sealed.json>   (modifica sealed.json sul posto)
import fs from "node:fs/promises";
import { Ebay, marketPrices } from "./ebay.js";

/** Id dei prodotti "oggetto" nel catalogo (sopra quelli di Cardmarket e di TCGplayer). */
export const OBJECT_OFFSET = 2_000_000_000;
/** Espansione fittizia degli oggetti. */
export const OBJECT_EXP = 9_000_001;

/**
 * Oggetti della stessa serie ("serie" in oggetti.json: i folder delle città del 2021, quelli del 2022, le regioni) senza
 * inserzioni eBay: la mediana dei prezzi di mercato degli altri della serie, [prezzo, 0, quanti]. Il listino non basta
 * (richiesto dall'utente, 4 novembre 2026): il folder di Roma 2021 costava 12 € ma gli altri della serie si vendono a 55-75 €.
 */
export function seriesPrices(objects, market) {
  const out = { ...market };
  for (const o of objects) {
    if (!o.serie || out[o.id]) continue;
    const prices = objects.filter((x) => x.serie === o.serie && market[x.id]).map((x) => market[x.id][0]).sort((a, b) => a - b);
    if (!prices.length) continue;
    const m = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    out[o.id] = [Math.round(m * 100) / 100, 0, prices.length];
  }
  return out;
}

/** Il catalogo dei sigillati con gli oggetti in più (quelli già presenti vengono sostituiti). */
export function addObjects(sealed, objects, market = {}) {
  const out = { ...sealed, exp: { ...sealed.exp, [OBJECT_EXP]: objects.exp }, p: sealed.p.filter((p) => p.id < OBJECT_OFFSET) };
  for (const o of objects.oggetti) {
    out.p.push({
      id: OBJECT_OFFSET + Number(o.id),
      n: o.n,
      t: "object",
      e: OBJECT_EXP,
      d: o.d ?? "",
      img: o.img ?? null,
      bp: null,
      cm: {
        ...(o.listino > 0 ? { listino: o.listino } : {}),
        ...(market[o.id] ? { mercato: market[o.id][0], inserzioni: market[o.id][1] } : {}),
        // Prezzo preso dagli altri oggetti della stessa serie (quanti): vedi seriesPrices.
        ...(market[o.id]?.[2] ? { serie: market[o.id][2] } : {}),
      },
      ct: {},
      ...(o.note ? { note: o.note } : {}),
      // Ricerca per il bottone "Compra su eBay" dell'app: la stessa, breve, usata per il prezzo di mercato.
      ...(o.ebay?.q ? { q: o.ebay.q } : {}),
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [objectsFile, sealedFile] = process.argv.slice(2);
  if (!objectsFile || !sealedFile) {
    console.log("uso: node prezzi/src/oggetti.js <oggetti.json> <sealed.json>");
    process.exit(1);
  }
  const objects = JSON.parse(await fs.readFile(objectsFile, "utf8"));
  const sealed = JSON.parse(await fs.readFile(sealedFile, "utf8"));
  const log = [];
  let market = {};
  if (process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID) {
    market = await marketPrices(new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID }), objects.oggetti, log);
  } else {
    log.push("EBAY_APP_ID/EBAY_CERT_ID non impostati: oggetti senza prezzo di mercato");
  }
  market = seriesPrices(objects.oggetti, market);
  const out = addObjects(sealed, objects, market);
  await fs.writeFile(sealedFile, JSON.stringify(out));
  console.log(log.join("\n"));
  console.log(`Oggetti da collezione nel catalogo dei sigillati: ${objects.oggetti.length}, con prezzo di mercato eBay: ${Object.keys(market).length}`);
}
