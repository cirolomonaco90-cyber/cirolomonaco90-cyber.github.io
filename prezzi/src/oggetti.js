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
      cm: { ...(o.listino > 0 ? { listino: o.listino } : {}), ...(market[o.id] ? { mercato: market[o.id][0], inserzioni: market[o.id][1] } : {}) },
      ct: {},
      ...(o.note ? { note: o.note } : {}),
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
  const out = addObjects(sealed, objects, market);
  await fs.writeFile(sealedFile, JSON.stringify(out));
  console.log(log.join("\n"));
  console.log(`Oggetti da collezione nel catalogo dei sigillati: ${objects.oggetti.length}, con prezzo di mercato eBay: ${Object.keys(market).length}`);
}
