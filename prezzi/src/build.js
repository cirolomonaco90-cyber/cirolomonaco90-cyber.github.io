// Job notturno: costruisce i file dei prezzi per lingua letti dall'app.
//
//   CARDTRADER_TOKEN=... node src/build.js <cartella-output>
//
// Output (cartella-output/v1/):
//   catalog.json  { v, updated, exp: {expId: nome}, cm: {idProdottoCardmarket: expId} }
//   onepiece.json catalogo e prezzi One Piece (vedi onepiece.js)
//   <lingua>.json { v, lang, updated, coef: {all: [r, n], expId: [r, n]},
//                   p: {idProdottoCardmarket: {n: [prezzoNM, offerte], r: [...], f: [...], nc: {NM: [prezzo, offerte], EX: [...]}}} }
//     n = normale/holo, r = reverse, f = 1ª edizione; prezzi NM in euro (offerte CardTrader);
//     nc/rc/fc = prezzi per condizione così come sono (almeno 3 offerte), per misurare la percentuale della condizione.
//     coef = mediana del rapporto prezzo lingua / prezzo inglese, entrambi su CardTrader
//            (così il sovrapprezzo del sito si annulla), per espansione e in totale.
//            L'app moltiplica il prezzo Cardmarket per questo rapporto.
//
// Variabili opzionali: LANGS (default en,it,fr,de,es,pt; l'inglese serve sempre come riferimento),
// MAX_EXPANSIONS (per prove), CT_CACHE (cartella delle risposte CardTrader del giorno: un job
// interrotto e ripartito continua da dove era arrivato).
import fs from "node:fs/promises";
import path from "node:path";
import { CardTrader } from "./cardtrader.js";
import { estimate, coefficients, cardRatio, ratioOffers, pickThreshold, conditionPrices } from "./stats.js";
import { buildOnePiece } from "./onepiece.js";
import { buildSealed, sealedEstimate, blueprintLanguage, SEALED_LANGS, ONE_PIECE_SEALED_TYPES } from "./sealed.js";
import { fetchRetry } from "./rete.js";

export const DEFAULT_LANGS = ["en", "it", "fr", "de", "es", "pt"];

/**
 * Costruisce catalogo e file per lingua.
 * @returns {{catalog: object, perLang: Record<string, object>, log: string[]}}
 */
export async function build({ ct, langs = DEFAULT_LANGS, maxExpansions = Infinity, now = new Date() }) {
  const log = [];
  const updated = now.toISOString();
  // L'inglese è il riferimento per i rapporti: va sempre calcolato, e per primo.
  const order = ["en", ...langs.filter((l) => l !== "en")];
  const gameId = await ct.pokemonGameId();
  const expansions = (await ct.expansions(gameId)).slice(0, maxExpansions);
  log.push(`Espansioni Pokémon su CardTrader: ${expansions.length}`);

  // 1) Catalogo: quali prodotti Cardmarket corrispondono a quali blueprint ed espansioni.
  const all = []; // [{exp, bps}]
  for (const e of expansions) {
    try {
      all.push({ exp: e, bps: await ct.blueprints(e.id) });
    } catch (err) {
      log.push(`! blueprint ${e.name}: ${err.message}`);
    }
  }
  // Solo carte singole: la categoria più frequente tra i blueprint collegati a Cardmarket.
  // Le altre (box, buste, accessori) falserebbero prezzi e coefficienti.
  const categoryCount = new Map();
  for (const { bps } of all) {
    for (const bp of bps) {
      if ((bp.card_market_ids || []).length === 0) continue;
      categoryCount.set(bp.category_id, (categoryCount.get(bp.category_id) || 0) + 1);
    }
  }
  const singlesCategory = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  log.push(`Categorie dei blueprint (id: quantità): ${[...categoryCount.entries()].map(([k, v]) => `${k}: ${v}`).join(", ")}; carte singole = ${singlesCategory}`);

  // cm: prodotto Cardmarket -> espansione; bp: prodotto Cardmarket -> blueprint (link alla pagina CardTrader).
  const catalog = { v: 1, updated, exp: {}, cm: {}, bp: {} };
  const bpToCm = new Map(); // blueprintId -> [idProduct]
  const useful = [];
  // Prodotti sigillati (box, ETB, buste...): blueprint -> prodotti Cardmarket, foto ed espansioni.
  const sealedBp = new Map(); // blueprintId -> [idProduct]
  const sealed = { cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(), ctPrices: {} };
  const sealedExps = new Set();
  for (const { exp: e, bps } of all) {
    let any = false;
    sealed.ctExpNames.set(e.id, e.name);
    // Lingua dell'espansione: la più frequente tra le lingue predefinite dei suoi blueprint.
    const langCount = new Map();
    for (const bp of bps) {
      const l = blueprintLanguage(bp);
      if (l) langCount.set(l, (langCount.get(l) || 0) + 1);
    }
    const expLang = [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (expLang) sealed.ctExpLangs.set(e.id, expLang);
    for (const bp of bps) {
      const ids = (bp.card_market_ids || []).map(Number).filter(Number.isFinite);
      for (const id of ids) sealed.cmToCtExp.set(id, e.id);
      if (singlesCategory !== undefined && bp.category_id !== singlesCategory) {
        if (ids.length === 0) continue;
        sealedBp.set(bp.id, ids);
        sealedExps.add(e.id);
        for (const id of ids) sealed.ctProducts.set(id, { bp: bp.id, img: bp.image?.show?.url || bp.image?.url || null, lang: blueprintLanguage(bp), name: bp.name, ctExp: e.id });
        continue;
      }
      if (ids.length === 0) continue;
      bpToCm.set(bp.id, ids);
      for (const id of ids) {
        catalog.cm[id] = e.id;
        catalog.bp[id] = bp.id;
      }
      any = true;
    }
    if (any) {
      catalog.exp[e.id] = e.name;
      useful.push(e);
    }
  }
  log.push(`Espansioni con carte collegate a Cardmarket: ${useful.length}, prodotti: ${Object.keys(catalog.cm).length}`);

  // 2) Offerte per lingua, un'espansione alla volta (anche quelle con soli prodotti sigillati).
  const usefulIds = new Set(useful.map((e) => e.id));
  const toRead = [...useful, ...expansions.filter((e) => sealedExps.has(e.id) && !usefulIds.has(e.id))];
  const perLang = {};
  const enByBp = new Map(); // blueprintId -> voce inglese (riferimento)
  for (const lang of order) {
    const p = {};
    const samples = [];
    let failures = 0;
    const sealedPrices = new Map();
    for (const e of toRead) {
      let byBp;
      try {
        byBp = await ct.offersByExpansion(e.id, lang);
      } catch (err) {
        failures++;
        if (/Token/.test(err.message)) throw err;
        continue;
      }
      for (const [bpId, offers] of byBp) {
        const sealedIds = sealedBp.get(bpId);
        if (sealedIds) {
          const est = sealedEstimate(offers);
          if (est) for (const id of sealedIds) sealedPrices.set(id, est);
          continue;
        }
        const ids = bpToCm.get(bpId);
        if (!ids) continue;
        const entry = {};
        for (const v of ["n", "r", "f"]) {
          const est = estimate(offers, v);
          if (est) entry[v] = est;
          // Prezzi per condizione ("nc", "rc", "fc"): percentuale della condizione misurata sul mercato.
          const cp = est && conditionPrices(offers, v);
          if (cp) entry[`${v}c`] = cp;
        }
        if (Object.keys(entry).length === 0) continue;
        for (const id of ids) p[id] = entry;
        if (lang === "en") {
          enByBp.set(bpId, entry);
        } else {
          const en = enByBp.get(bpId);
          const r = cardRatio(entry, en, "n");
          if (r !== null) samples.push({ exp: e.id, ratio: r, offers: ratioOffers(entry, en, "n") });
        }
      }
    }
    if (SEALED_LANGS.includes(lang)) sealed.ctPrices[lang] = sealedPrices;
    const coef = lang === "en" ? {} : coefficients(samples);
    perLang[lang] = { v: 1, lang, updated, coef, p };
    log.push(
      `${lang}: ${Object.keys(p).length} prodotti con offerte` +
        (lang === "en"
          ? " (riferimento)"
          : `, rapporto con l'inglese ${coef.all ? `${Math.round(coef.all[0] * 100)}% su ${coef.all[1]} carte (almeno ${pickThreshold(samples)} offerte)` : "n/d"}`) +
        (failures ? `, ${failures} espansioni non lette` : ""),
    );
  }
  // Solo le lingue richieste finiscono nei file.
  for (const l of Object.keys(perLang)) if (!langs.includes(l)) delete perLang[l];
  // Sigillati giapponesi: offerte in giapponese ("jp" su CardTrader, "ja" nell'app), solo
  // per le espansioni con prodotti sigillati (le carte giapponesi non sono in questi file).
  if (SEALED_LANGS.includes("ja")) {
    const sealedPrices = new Map();
    for (const e of expansions.filter((x) => sealedExps.has(x.id))) {
      let byBp;
      try {
        byBp = await ct.offersByExpansion(e.id, "jp");
      } catch (err) {
        if (/Token/.test(err.message)) throw err;
        continue;
      }
      for (const [bpId, offers] of byBp) {
        const ids = sealedBp.get(bpId);
        const est = ids && sealedEstimate(offers);
        if (est) for (const id of ids) sealedPrices.set(id, est);
      }
    }
    sealed.ctPrices.ja = sealedPrices;
  }
  log.push(`Sigillati su CardTrader: ${sealedBp.size} blueprint collegati a Cardmarket, ${toRead.length - useful.length} espansioni in più da leggere`);
  return { catalog, perLang, sealed, log };
}

const CM_FILES = "https://downloads.s3.cardmarket.com/productCatalog";

async function fetchJson(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Prodotti sigillati del catalogo TCGplayer (file di tcgplayer-all.js, se TCGPLAYER_JSON lo indica): foto dei sigillati. */
async function tcgplayerProducts() {
  const file = process.env.TCGPLAYER_JSON;
  if (!file) return [];
  try {
    const { g, p } = JSON.parse(await fs.readFile(file, "utf8"));
    return Object.entries(p).filter(([, v]) => !v[2]).map(([id, v]) => ({ id, name: v[0], group: g[v[1]]?.[0], eur: v[3] }));
  } catch (err) {
    console.log(`catalogo TCGplayer non letto (${err.message}): sigillati senza le sue foto`);
    return [];
  }
}

async function main() {
  const out = process.argv[2] || "out";
  const token = process.env.CARDTRADER_TOKEN;
  if (!token) {
    console.log("CARDTRADER_TOKEN non impostato: niente da fare.");
    process.exit(0);
  }
  const langs = (process.env.LANGS || DEFAULT_LANGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const maxExpansions = Number(process.env.MAX_EXPANSIONS || Infinity);

  // CT_CACHE: cartella del giorno con le risposte già lette (ripresa di un job interrotto).
  const ct = new CardTrader({ token, cacheDir: process.env.CT_CACHE || null });
  const started = Date.now();
  const { catalog, perLang, sealed, log } = await build({ ct, langs, maxExpansions });
  log.forEach((l) => console.log(l));

  const dir = path.join(out, "v1");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "catalog.json"), JSON.stringify(catalog));
  for (const [lang, data] of Object.entries(perLang)) {
    await fs.writeFile(path.join(dir, `${lang}.json`), JSON.stringify(data));
  }
  // One Piece: a parte, così un suo errore non ferma i prezzi Pokémon.
  try {
    const op = await buildOnePiece({ ct, maxExpansions });
    op.log.forEach((l) => console.log(l));
    log.push(...op.log);
    await fs.writeFile(path.join(dir, "onepiece.json"), JSON.stringify(op.data));
    // Sealed One Piece: catalogo e listino Cardmarket (gioco 18) + foto e offerte CardTrader.
    try {
      const [products, singles, guide] = await Promise.all([
        fetchJson(`${CM_FILES}/productList/products_nonsingles_18.json`),
        fetchJson(`${CM_FILES}/productList/products_singles_18.json`),
        fetchJson(`${CM_FILES}/priceGuide/price_guide_18.json`),
      ]);
      const s = buildSealed({ products: products.products, singles: singles.products, guide, types: ONE_PIECE_SEALED_TYPES, westernLang: "en", ...op.sealed });
      s.log.forEach((l) => console.log(`One Piece ${l}`));
      log.push(...s.log.map((l) => `One Piece ${l}`));
      await fs.writeFile(path.join(dir, "onepiece-sealed.json"), JSON.stringify(s.data));
    } catch (err) {
      console.error(err);
      log.push(`! Sealed One Piece non aggiornati: ${err.message}`);
    }
  } catch (err) {
    console.error(err);
    log.push(`! One Piece non aggiornato: ${err.message}`);
  }
  // Sigillati: catalogo e listino Cardmarket (file pubblici) + foto e offerte CardTrader.
  try {
    const [products, singles, guide] = await Promise.all([
      fetchJson(`${CM_FILES}/productList/products_nonsingles_6.json`),
      fetchJson(`${CM_FILES}/productList/products_singles_6.json`),
      fetchJson(`${CM_FILES}/priceGuide/price_guide_6.json`),
    ]);
    // Rapporti di lingua delle carte singole: riserva per le lingue senza sigillati confrontabili.
    const cardCoef = Object.fromEntries(Object.entries(perLang).filter(([, d]) => d.coef?.all).map(([l, d]) => [l, d.coef.all[0]]));
    const s = buildSealed({ products: products.products, singles: singles.products, guide, tpProducts: await tcgplayerProducts(), cardCoef, ...sealed });
    s.log.forEach((l) => console.log(l));
    log.push(...s.log);
    await fs.writeFile(path.join(dir, "sealed.json"), JSON.stringify(s.data));
  } catch (err) {
    console.error(err);
    log.push(`! Sigillati non aggiornati: ${err.message}`);
  }
  const done = `Fatto in ${Math.round((Date.now() - started) / 60000)} minuti, ${ct.calls} chiamate a CardTrader${ct.cached ? `, ${ct.cached} risposte dalla cache` : ""}.`;
  console.log(done);
  // Registro leggibile pubblicato con i dati (i log di Actions non sempre sono consultabili).
  await fs.writeFile(path.join(out, "log.txt"), [...log, done].join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
