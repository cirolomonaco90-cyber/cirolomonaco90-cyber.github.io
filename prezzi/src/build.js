// Job notturno: costruisce i file dei prezzi per lingua letti dall'app.
//
//   CARDTRADER_TOKEN=... node src/build.js <cartella-output>
//
// Output (cartella-output/v1/):
//   catalog.json  { v, updated, exp: {expId: nome}, cm: {idProdottoCardmarket: expId} }
//   onepiece.json catalogo e prezzi One Piece (vedi onepiece.js); lorcana.json, dragonball.json e i -sealed.json lo stesso per Lorcana e Dragon Ball (ct-giochi.js)
//   <lingua>.json { v, lang, updated, coef: {all: [r, n], expId: [r, n]}, coefFrom?: "it" (rapporto preso da un'altra lingua),
//                   p: {idProdottoCardmarket: {n: [prezzoNM, offerte], r: [...], f: [...], nc: {NM: [prezzo, offerte], EX: [...]}}} }
//     n = normale/holo, r = reverse, f = 1ª edizione; prezzi NM in euro (offerte CardTrader);
//     nc/rc/fc = prezzi per condizione così come sono (almeno 3 offerte), per misurare la percentuale della condizione.
//     coef = mediana del rapporto prezzo lingua / prezzo inglese, entrambi su CardTrader
//            (così il sovrapprezzo del sito si annulla), per espansione e in totale.
//            L'app moltiplica il prezzo Cardmarket per questo rapporto.
//
// Variabili opzionali: LANGS (default en,it,fr,de,es,pt; l'inglese serve sempre come riferimento),
// MAX_EXPANSIONS (per prove), CT_CACHE (cartella delle risposte CardTrader del giorno: un job
// interrotto e ripartito continua da dove era arrivato), CT_SCADENZA (ora, in millisecondi dal 1970, oltre la
// quale non si chiedono più offerte a CardTrader: quelle non ancora lette si prendono dall'ultima lettura dei
// giorni prima, cartelle sorelle di CT_CACHE, e i file si scrivono comunque; la calcola job-notte.sh da
// PREZZI_MINUTI, perché GitHub annulla la parte dopo 350 minuti senza pubblicare nulla).
import fs from "node:fs/promises";
import path from "node:path";
import { CardTrader } from "./cardtrader.js";
import { estimate, coefficients, cardRatio, ratioOffers, pickThreshold, conditionPrices, borrowCoefficients, firstEditionPremiums, premiumSample } from "./stats.js";
import { buildCtGameFiles, CT_GAME_FILES } from "./ct-giochi.js";
import { buildSealed, sealedEstimate, blueprintLanguage, SEALED_LANGS } from "./sealed.js";
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
  const sealed = { cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(), ctPrices: {}, ctUnlinked: [] };
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
        // Sigillati CardTrader non collegati a Cardmarket: servono solo per la loro foto (per nome, in sealed.js).
        if (ids.length === 0) {
          const img = bp.image?.show?.url || bp.image?.url || null;
          if (img) sealed.ctUnlinked.push({ bp: bp.id, name: bp.name, img, lang: blueprintLanguage(bp), ctExp: e.id });
          continue;
        }
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
    const premiumSamples = [];
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
        // Maggiorazione della 1ª edizione, per set: anche in inglese (è la lingua con più offerte).
        const ps = premiumSample(entry);
        if (ps) premiumSamples.push({ exp: e.id, ...ps });
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
    const first = firstEditionPremiums(premiumSamples);
    perLang[lang] = { v: 1, lang, updated, coef, first, p };
    log.push(
      `${lang}: ${Object.keys(p).length} prodotti con offerte` +
        (first.all ? `, 1ª edizione ${first.all[0]}× la unlimited su ${first.all[1]} carte (${Object.keys(first).length - 1} set)` : "") +
        (lang === "en"
          ? " (riferimento)"
          : `, rapporto con l'inglese ${coef.all ? `${Math.round(coef.all[0] * 100)}% su ${coef.all[1]} carte (almeno ${pickThreshold(samples)} offerte)` : "n/d"}`) +
        (failures ? `, ${failures} espansioni non lette` : ""),
    );
  }
  // Francese, spagnolo e portoghese: poche offerte, rapporti gonfiati -> il rapporto dell'italiano (vedi stats.js).
  for (const l of borrowCoefficients(perLang)) {
    log.push(`${l}: rapporto con l'inglese preso dall'italiano, ${Math.round(perLang[l].coef.all[0] * 100)}% su ${perLang[l].coef.all[1]} carte`);
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

/**
 * Il client CardTrader della parte "prezzi" del job: risposte del giorno in CT_CACHE e, con CT_SCADENZA, la scadenza
 * della notte. Niente rotazione (reuseDays): finché c'è tempo ogni offerta si legge ogni notte.
 */
export function priceClient(env = process.env, opts = {}) {
  return new CardTrader({ token: env.CARDTRADER_TOKEN, cacheDir: env.CT_CACHE || null, deadline: Number(env.CT_SCADENZA || 0) || 0, ...opts });
}

/** L'ultima riga del registro: durata, chiamate e, se la scadenza è scattata, quante letture vengono dai giorni prima. */
export function doneLine(ct, started, now = Date.now()) {
  return (
    `Fatto in ${Math.round((now - started) / 60000)} minuti, ${ct.calls} chiamate a CardTrader` +
    (ct.cached ? `, ${ct.cached} risposte dalla cache` : "") +
    (ct.reused ? `, tempo della notte finito: ${ct.reused} letture di offerte prese dai giorni prima` : "") +
    (ct.skipped ? `, ${ct.skipped} rimandate alla prossima notte (mai lette nei giorni prima)` : "") +
    "."
  );
}

/**
 * I giochi CardTrader da costruire, in un ordine che gira di un posto ogni giorno ([day]: giorni dal 1970): se la
 * scadenza scatta, a restare con le offerte dei giorni prima è l'ultimo della fila, e non deve essere sempre lo stesso.
 */
export function ctGameOrder(keys, day) {
  const n = keys.length;
  if (n === 0) return [];
  const shift = ((day % n) + n) % n;
  return [...keys.slice(shift), ...keys.slice(0, shift)];
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
    // Lingua del prodotto dalla categoria del gruppo: 85 = Pokémon giapponese, il resto inglese.
    return Object.entries(p).filter(([, v]) => !v[2]).map(([id, v]) => ({ id, name: v[0], group: g[v[1]]?.[0], groupId: Number(v[1]), eur: v[3], lang: g[v[1]]?.[1] === 85 ? "ja" : "en", noImg: v[4] === 0 }));
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

  // CT_CACHE: cartella del giorno con le risposte già lette (ripresa di un job interrotto); CT_SCADENZA: vedi sopra.
  const ct = priceClient();
  const started = Date.now();
  if (ct.deadline) console.log(`Offerte CardTrader fino alle ${new Date(ct.deadline).toISOString().slice(11, 16)} UTC, poi l'ultima lettura dei giorni prima.`);
  const { catalog, perLang, sealed, log } = await build({ ct, langs, maxExpansions });
  log.forEach((l) => console.log(l));

  const dir = path.join(out, "v1");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "catalog.json"), JSON.stringify(catalog));
  for (const [lang, data] of Object.entries(perLang)) {
    await fs.writeFile(path.join(dir, `${lang}.json`), JSON.stringify(data));
  }
  // One Piece, Lorcana, Dragon Ball: a parte, così un loro errore non ferma i prezzi Pokémon (ct-giochi.js).
  // CT_GAMES_SKIP="yugioh": i giochi che girano in una parte propria del job (Yu-Gi-Oh!: 691 espansioni in 7 lingue, ore).
  const skip = (process.env.CT_GAMES_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean);
  const games = ctGameOrder(CT_GAME_FILES.map((g) => g.key).filter((k) => !skip.includes(k)), Math.floor(started / 86_400_000));
  await buildCtGameFiles({ ct, dir, maxExpansions, log, only: games });
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
  const done = doneLine(ct, started);
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
