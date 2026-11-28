// Oggetti da collezione che nessun mercato delle carte cataloga (medaglie Pokémon di Poste Italiane e Zecca
// dello Stato in cofanetto Poké Ball, folder filatelici...): elenco curato a mano in prezzi/dati/oggetti.json,
// aggiunto al catalogo dei sigillati come prodotti di tipo "object". Il valore è il prezzo di mercato dalle
// inserzioni eBay.it ("mercato", vedi ebay.js, con EBAY_APP_ID ed EBAY_CERT_ID); il listino ufficiale
// ("listino") è solo informativo. Se un giorno eBay non dà il prezzo di un oggetto, resta quello già pubblicato
// per 30 giorni (keepPublishedMarket).
//
//   node prezzi/src/oggetti.js prezzi/dati/oggetti.json <sealed.json>   (modifica sealed.json sul posto)
import fs from "node:fs/promises";
import { Ebay, marketPrices } from "./ebay.js";
import { fetchRetry } from "./rete.js";
import { DATI } from "./dati.js";
import { QUOTA_RESERVE, dailyBudget, quotaLine, quotaWindow, remainingQuota } from "./ebay-quota.js";

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

/** Per quanti giorni un prezzo di mercato eBay già pubblicato resta buono quando eBay non lo dà di nuovo. */
export const KEEP_MARKET_DAYS = 30;

/**
 * I prezzi di mercato eBay degli oggetti nel catalogo dei sigillati già pubblicato: id dell'oggetto -> [prezzo,
 * inserzioni, giorno della lettura]. Solo quelli presi dalle inserzioni dell'oggetto (non quelli della serie). Il giorno
 * è "letto" del catalogo o, nei cataloghi di prima di questo campo, il giorno del file ("updated").
 */
export function publishedMarket(published) {
  const out = {};
  const fileDay = typeof published?.updated === "string" ? published.updated.slice(0, 10) : null;
  for (const p of published?.p ?? []) {
    if (p.t !== "object" || p.id < OBJECT_OFFSET) continue;
    const cm = p.cm ?? {};
    const day = cm.letto ?? fileDay;
    if (!(cm.mercato > 0) || !(cm.inserzioni > 0) || cm.serie || !day) continue;
    out[p.id - OBJECT_OFFSET] = [cm.mercato, cm.inserzioni, day];
  }
  return out;
}

const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * 18 novembre 2026: il catalogo pubblicato alle 16:00 UTC aveva tutti i 22 oggetti senza prezzo di mercato (la ricerca eBay
 * di quel giro non era andata) e la medaglia d'oro valeva il listino, 2.000 € invece di 3.321,70 €: −1.442 € sulla
 * collezione dell'utente per qualche ora. Ora un oggetto che oggi non ha un prezzo eBay suo tiene quello già pubblicato,
 * col giorno della lettura, finché ha meno di [KEEP_MARKET_DAYS] giorni. Vale sia quando eBay non risponde (chiavi
 * mancanti, quota finita, rete) sia quando risponde senza inserzioni pertinenti: le inserzioni di questi oggetti vanno e
 * vengono, e un giorno senza non dice che il prezzo è cambiato (il prezzo della serie, calcolato dopo, resta per chi non ne
 * ha mai avuto uno suo). Oltre i 30 giorni: serie o listino, come prima.
 * [market]: id -> [prezzo, inserzioni] letti oggi. Ritorna id -> [prezzo, inserzioni, 0, giorno della lettura] e quanti tenuti.
 */
export function keepPublishedMarket(market, objects, previous, today) {
  const out = {};
  let kept = 0;
  for (const [id, v] of Object.entries(market)) out[id] = [v[0], v[1], v[2] ?? 0, today];
  for (const o of objects) {
    if (out[o.id] || !o.ebay?.q) continue;
    const prev = previous?.[o.id];
    if (!prev) continue;
    const age = dayNumber(today) - dayNumber(prev[2]);
    if (!(age >= 0 && age < KEEP_MARKET_DAYS)) continue;
    out[o.id] = [prev[0], prev[1], 0, prev[2]];
    kept++;
  }
  return { market: out, kept };
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
        // Giorno della lettura eBay del prezzo di mercato (keepPublishedMarket): l'app legge solo i numeri e lo ignora.
        ...(market[o.id]?.[3] && market[o.id][1] > 0 ? { letto: market[o.id][3] } : {}),
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
    // Una ricerca per oggetto (22): prima di cominciare si chiede a eBay quante chiamate restano oggi e se ne lascia sempre
    // una parte a variant-photo (ebay-quota.js); oltre, e con la quota finita, resta il prezzo già pubblicato.
    const ebay = new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID });
    const wanted = objects.oggetti.filter((o) => o.ebay?.q).length;
    const quota = await remainingQuota(ebay, log);
    const budget = dailyBudget({ cap: wanted, remaining: quota?.remaining, reserve: QUOTA_RESERVE.oggetti });
    log.push(quotaLine("oggetti", { window: quotaWindow(), cap: wanted, used: 0, quota, reserve: QUOTA_RESERVE.oggetti, budget }));
    market = await marketPrices(ebay, objects.oggetti, log, { budget });
  } else {
    log.push("EBAY_APP_ID/EBAY_CERT_ID non impostati: niente ricerche eBay degli oggetti");
  }
  // Il catalogo già pubblicato, per tenere i prezzi di mercato che oggi eBay non dà (keepPublishedMarket). Se non si legge,
  // come prima: senza prezzo di mercato quelli che eBay non ha dato.
  let previous = {};
  try {
    const r = await fetchRetry(`${DATI}/prezzi/v1/sealed.json?t=${Date.now()}`, {}, { attempts: 3, waitMs: 5000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    previous = publishedMarket(await r.json());
  } catch (err) {
    log.push(`catalogo dei sigillati pubblicato non letto (${err.message}): nessun prezzo dei giorni prima`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const fresh = Object.keys(market).length;
  const kept = keepPublishedMarket(market, objects.oggetti, previous, today);
  market = kept.market;
  log.push(`oggetti: ${kept.kept} col prezzo del giorno prima (eBay oggi non l'ha dato), ${fresh} col prezzo di oggi`);
  market = seriesPrices(objects.oggetti, market);
  const out = addObjects(sealed, objects, market);
  await fs.writeFile(sealedFile, JSON.stringify(out));
  console.log(log.join("\n"));
  console.log(`Oggetti da collezione nel catalogo dei sigillati: ${objects.oggetti.length}, con prezzo di mercato eBay: ${Object.keys(market).length}`);
}
