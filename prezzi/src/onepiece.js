// One Piece e Lorcana: catalogo e prezzi presi tutti da CardTrader (nessun abbinamento tra fonti).
// Lorcana (v1/lorcana.json): stesso formato, lingue en/fr/de/it/es/jp, rarità "lorcana_rarity".
// Su CardTrader ogni stampa è un "blueprint" col suo numero (OP01-064 normale, OP01-064b
// Alternate Art...), uguale in tutte le lingue: le offerte si filtrano per lingua.
//
// Output (v1/onepiece.json):
//   { v, updated,
//     sets:  [{ id, code, name, n }]                 // espansioni con carte, n = carte
//     cards: [{ id, n: nome, num: numero, r: rarità, v: versione|null, s: idEspansione,
//               img: percorso immagine, en: [prezzoNM, offerte], jp: [...], c: { en: { NM: [prezzo, offerte], EX: [...] } } (condizioni misurate),
//               g: { en: {"PSA 10": [prezzo, offerte], ...}, jp: {...} } }] }   // carte gradate
//   Prezzi Near Mint in euro, stessa stima delle carte Pokémon (stats.js).
import { coefficients, conditionPrices, estimate, isPlaceholderPrice, MIN_PREMIUM_PRICE, RATIO_FROM_IT } from "./stats.js";
export { isPlaceholderPrice };
import { parseGrade } from "./grading.js";
import { items } from "./matching.js";
import { blueprintLanguage, sealedEstimate } from "./sealed.js";

export const ONE_PIECE_LANGS = ["en", "jp"];
/** Lorcana: stesso catalogo da CardTrader (gioco "Lorcana"), in sei lingue (il giapponese su CardTrader è "jp"). */
export const LORCANA_LANGS = ["en", "fr", "de", "it", "es", "jp"];

/** I giochi il cui catalogo viene tutto da CardTrader: nome per cercarli tra i giochi, lingue, campo della rarità. */
/** Dragon Ball Super Card Game e Fusion World: su CardTrader un solo gioco (id 9, 176 espansioni), inglese e giapponese. */
export const DRAGON_BALL_LANGS = ["en", "jp"];
/** Yu-Gi-Oh!: TCG in sei lingue occidentali e OCG giapponese (espansioni "-jp"); coreano e cinese non ancora. */
export const YUGIOH_LANGS = ["en", "it", "fr", "de", "es", "pt", "jp"];

export const CT_GAMES = {
  onepiece: { label: "One Piece", match: "one piece", langs: ONE_PIECE_LANGS, rarity: "onepiece_rarity" },
  lorcana: { label: "Lorcana", match: "lorcana", langs: LORCANA_LANGS, rarity: "lorcana_rarity" },
  // Le comuni e non comuni esistono normali e foil nello stesso blueprint ("dragonball_foil" sull'offerta): la stima è
  // quella delle normali; le rare sono sempre foil (nessuna proprietà) e contano tutte.
  dragonball: { label: "Dragon Ball", match: "dragon ball", langs: DRAGON_BALL_LANGS, rarity: "dragonball_rarity", excludeFoil: true },
  // Yu-Gi-Oh! (CardTrader gioco 4, 691 espansioni, 4 novembre 2026): la 1ª edizione è una proprietà dell'offerta
  // ("first_edition"), come per i Pokémon: stima delle unlimited in "en" e delle 1ª edizione in "en1" (splitFirst). Il numero
  // del blueprint è solo "001": nel catalogo diventa "LOB-001" col codice dell'espansione (numberWithSet).
  // photosByName: una carta senza foto prende quella di un'altra stampa con lo stesso nome (sharedPhotos); solo Yu-Gi-Oh!, dove lo
  // stesso nome è la stessa carta (in One Piece "Monkey.D.Luffy" sono decine di carte diverse).
  yugioh: { label: "Yu-Gi-Oh!", match: "yu-gi-oh", langs: YUGIOH_LANGS, rarity: "yugioh_rarity", splitFirst: true, numberWithSet: true, photosByName: true },
};

/**
 * Carte senza foto su CardTrader con quella della stessa carta in un'altra stampa del catalogo (0.9.160, richiesto dall'utente:
 * foto da altre fonti prima di eBay; il 7 novembre 2026 senza foto 588 carte Dragon Ball e 669 Yu-Gi-Oh!): stesso numero
 * ("BT10-008" Non-Holo = la Holo), lo stesso numero senza le lettere della stampa ("P-540c" Silver Foil = "P-540",
 * "BT17-135l2" Judge Pack = "BT17-135") e, con [byName], lo stesso nome. Restituisce quante ne ha sistemate.
 */
export function sharedPhotos(cards, { byName = false } = {}) {
  const base = (n) => String(n ?? "").replace(/[a-z]+\d*$/, "");
  // Stesso numero non basta: in Lorcana i numeri si ripetono in ogni set e CardTrader ha qualche numero sbagliato ("BT15-119"
  // Forbidden Power e Hire-Dragon's Home). Serve anche lo stesso nome, a meno di due lettere ("Krillian" = "Krillin") o
  // dell'ordine delle due facce dei leader ("Trunks // SS Trunks" = "SS Trunks // Trunks").
  const plain = (n) => String(n ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const faces = (n) => String(n ?? "").split("//").map(plain).sort().join("|");
  const sameName = (a, b) => faces(a) === faces(b) || editDistance(plain(a), plain(b)) <= 2;
  const byNum = new Map();
  const byBase = new Map();
  const byCardName = new Map();
  const add = (m, k, c) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  };
  for (const c of cards) {
    if (!c.img) continue;
    add(byNum, c.num, c);
    add(byBase, base(c.num), c);
    const n = String(c.n ?? "").toLowerCase();
    if (n && !byCardName.has(n)) byCardName.set(n, c.img);
  }
  let n = 0;
  for (const c of cards) {
    if (c.img) continue;
    const twin = [...(byNum.get(c.num) ?? []), ...(byBase.get(base(c.num)) ?? [])].find((o) => sameName(o.n, c.n));
    const img = twin?.img || (byName ? byCardName.get(String(c.n ?? "").toLowerCase()) : null);
    if (img) {
      c.img = img;
      n++;
    }
  }
  return n;
}

/** Distanza tra due parole (lettere da cambiare, togliere o aggiungere), per i nomi scritti quasi uguali. */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Numero Yu-Gi-Oh! normalizzato per confronti ("lob-001"): codice del set + numero senza la regione ("MP16-EN198" ->
 * "mp16-198", "CIBR-ENSE4" -> "cibr-se4", "AST-009" -> "ast-009"). [setCode] serve quando il numero è solo "001"
 * (blueprint CardTrader); i codici delle espansioni OCG ("cibr-jp") e delle ristampe ("rp01-2024") perdono il suffisso.
 */
export function yugiohKey(number, setCode = "") {
  // "lob en001" scritto con lo spazio al posto del trattino: lo spazio diventa il trattino.
  const raw = String(number || "").trim().toUpperCase();
  const n = (raw.includes("-") ? raw : raw.replace(/\s+/, "-")).replace(/\s+/g, "");
  if (!n) return null;
  const code = String(setCode || "").split("-")[0].toLowerCase();
  // Regioni: "EN", "FR"... e, nelle prime stampe europee, una lettera sola seguita dal numero ("SDD-E003", "LOB-G001").
  // Le lettere dopo il numero sono la stampa ("MRD-143sec" = Secret Rare di CardTrader): non fanno parte della chiave.
  const m = n.match(/^(?:([A-Z0-9]+)-)?(?:EN|FR|DE|IT|SP|PT|JP|KR|AE|TC|SC|EU|[EFGISP](?=\d))?([A-Z]{0,3}\d+)[A-Z]*$/);
  if (!m) return null;
  const set = (m[1] || "").toLowerCase() || code;
  if (!set) return null;
  return `${set}-${m[2].toLowerCase()}`;
}

/** Carte gradate: si leggono le offerte solo delle carte che valgono almeno tanto (euro, non gradate). */
export const GRADED_MIN_PRICE = 10;

/**
 * Offerta "segnaposto": alcuni venditori mettono le carte a 5.000, 10.000, 15.000 € (più qualche
 * centesimo di commissione) per tenerle in vetrina senza venderle. Visto sui dati reali di
 * ottobre 2026: 76 stime di questo tipo. Meglio nessun prezzo che uno finto.
 */

/** Una stampa (One Piece, Lorcana) da un blueprint CardTrader; null per i prodotti sigillati. */
export function cardFromBlueprint(bp, rarityKey = "onepiece_rarity") {
  const num = bp?.fixed_properties?.collector_number;
  if (!num) return null;
  const version = typeof bp.version === "string" && bp.version.trim() ? bp.version.trim() : null;
  return {
    id: bp.id,
    n: String(bp.name || "").trim(),
    num: String(num).trim(),
    r: bp.fixed_properties?.[rarityKey] || null,
    v: version,
    s: bp.expansion_id,
    img: bp.image?.show?.url || bp.image?.url || null,
  };
}

export async function buildOnePiece(opts) {
  return buildCtGame({ ...CT_GAMES.onepiece, ...opts });
}

export async function buildLorcana(opts) {
  return buildCtGame({ ...CT_GAMES.lorcana, ...opts });
}

export async function buildDragonBall(opts) {
  return buildCtGame({ ...CT_GAMES.dragonball, ...opts });
}

export async function buildYuGiOh(opts) {
  return buildCtGame({ ...CT_GAMES.yugioh, ...opts });
}

/** Catalogo e prezzi di un gioco preso tutto da CardTrader (vedi CT_GAMES). */
export async function buildCtGame({ ct, label = "One Piece", match = "one piece", rarity = "onepiece_rarity", langs = ONE_PIECE_LANGS, excludeFoil = false, splitFirst = false, numberWithSet = false, photosByName = false, maxExpansions = Infinity, now = new Date() }) {
  const log = [];
  const games = items(await ct.get("games"));
  const game = games.find((g) => `${g.name} ${g.display_name || ""}`.toLowerCase().includes(match));
  if (!game) throw new Error(`${label} non trovato tra i giochi di CardTrader`);
  const expansions = (await ct.expansions(game.id)).slice(0, maxExpansions);

  const sets = [];
  const cards = [];
  const byId = new Map();
  // Prodotti Sealed (box, buste, mazzi...): blueprint senza numero di carta, collegati a Cardmarket.
  // Stessi dati dei Sealed Pokémon, per buildSealed (sealed.js).
  const sealedBp = new Map(); // blueprint -> [prodotti Cardmarket]
  const sealedExps = [];
  const sealed = { cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(), ctPrices: {}, ctUnlinked: [] };
  for (const e of expansions) {
    let bps;
    try {
      bps = await ct.blueprints(e.id);
    } catch (err) {
      log.push(`! ${label}, blueprint ${e.name}: ${err.message}`);
      continue;
    }
    sealed.ctExpNames.set(e.id, e.name);
    const langCount = new Map();
    let hasSealed = false;
    for (const bp of bps) {
      const l = blueprintLanguage(bp);
      if (l) langCount.set(l, (langCount.get(l) || 0) + 1);
      const ids = (bp.card_market_ids || []).map(Number).filter(Number.isFinite);
      for (const id of ids) sealed.cmToCtExp.set(id, e.id);
      if (bp?.fixed_properties?.collector_number) continue;
      // Sigillati CardTrader non collegati a Cardmarket: solo per la loro foto (per nome, in sealed.js).
      if (ids.length === 0) {
        const img = bp.image?.show?.url || bp.image?.url || null;
        if (img) sealed.ctUnlinked.push({ bp: bp.id, name: bp.name, img, lang: blueprintLanguage(bp), ctExp: e.id });
        continue;
      }
      sealedBp.set(bp.id, ids);
      hasSealed = true;
      for (const id of ids) sealed.ctProducts.set(id, { bp: bp.id, img: bp.image?.show?.url || bp.image?.url || null, lang: blueprintLanguage(bp) });
    }
    const expLang = [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (expLang) sealed.ctExpLangs.set(e.id, expLang);
    if (hasSealed) sealedExps.push(e);
    const setCards = bps.map((bp) => cardFromBlueprint(bp, rarity)).filter(Boolean);
    // Yu-Gi-Oh!: il numero del blueprint è solo "001": col codice dell'espansione diventa "LOB-001" (come lo scrivono
    // Collectr e TCGplayer, senza la regione "EN").
    if (numberWithSet) {
      const code = String(e.code || "").split("-")[0].toUpperCase();
      for (const c of setCards) if (code && !c.num.includes("-")) c.num = `${code}-${c.num}`;
    }
    if (setCards.length === 0) continue;
    sets.push({ id: e.id, code: e.code || "", name: e.name, n: setCards.length });
    for (const c of setCards) {
      cards.push(c);
      byId.set(c.id, c);
    }
  }
  log.push(`${label}: ${sets.length} espansioni con carte, ${cards.length} carte`);
  const shared = sharedPhotos(cards, { byName: photosByName });
  log.push(`${label}: ${shared} carte senza foto con quella di un'altra stampa (restano ${cards.filter((c) => !c.img).length})`);

  const setIds = new Set(sets.map((s) => s.id));
  const toRead = [...sets, ...sealedExps.filter((e) => !setIds.has(e.id))];
  for (const lang of langs) {
    let priced = 0;
    let failures = 0;
    const sealedPrices = new Map();
    for (const s of toRead) {
      let byBp;
      try {
        byBp = await ct.offersByExpansion(s.id, lang);
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
        const c = byId.get(bpId);
        if (!c) continue;
        const usable = offers.filter((o) => !isPlaceholderPrice(o.price) && !(excludeFoil && o.foil === true));
        // Yu-Gi-Oh!: le 1ª edizione a parte ("en1", stima "f" di estimate); il prezzo base è quello delle unlimited ("n", che
        // scarta le 1ª edizione), e se una carta ha solo offerte di 1ª edizione (molti set recenti) il base è quello.
        const firstEst = splitFirst ? estimate(usable, "f") : null;
        const est = estimate(usable, "n") ?? firstEst;
        if (!est) continue;
        c[lang] = est;
        if (firstEst) c[`${lang}1`] = firstEst;
        priced++;
        // Condizione misurata sul mercato (come "nc" dei file di lingua Pokémon): condizione -> [prezzo così com'è, offerte].
        const cond = conditionPrices(usable, "n");
        if (cond) (c.c ||= {})[lang] = cond;
      }
    }
    // Lingua dell'app: "jp" di CardTrader = "ja".
    sealed.ctPrices[lang === "jp" ? "ja" : lang] = sealedPrices;
    log.push(`${label} ${lang}: ${priced} carte con offerte${failures ? `, ${failures} espansioni non lette` : ""}`);
  }
  const coef = languageCoefficients(cards, langs, log, label);
  // Carte gradate: le offerte di una carta alla volta (tutte le lingue insieme), solo per le carte
  // di valore. Prezzo per ente, voto e lingua: stessa stima delle carte non gradate.
  const valuable = cards.filter((c) => Math.max(...langs.map((l) => c[l]?.[0] || 0)) >= GRADED_MIN_PRICE);
  let withGraded = 0;
  for (const c of valuable) {
    let byBp;
    try {
      byBp = await ct.offersByBlueprint(c.id);
    } catch (err) {
      if (/Token/.test(err.message)) throw err;
      continue;
    }
    const groups = {};
    for (const o of byBp) {
      if (!o.graded || isPlaceholderPrice(o.price)) continue;
      const g = parseGrade(o.description);
      const lang = langs.includes(o.language) ? o.language : null;
      if (!g || !lang) continue;
      const key = `${g.grader} ${g.grade}`;
      ((groups[lang] ||= {})[key] ||= []).push({ ...o, graded: false, condition: "Near Mint" });
    }
    const out = {};
    for (const [lang, byGrade] of Object.entries(groups)) {
      for (const [key, offers] of Object.entries(byGrade)) {
        const est = estimate(offers, "n");
        if (est) (out[lang] ||= {})[key] = est;
      }
    }
    if (Object.keys(out).length) {
      c.g = out;
      withGraded++;
    }
  }
  log.push(`${label} gradate: ${valuable.length} carte di valore lette, ${withGraded} con offerte gradate riconoscibili`);
  log.push(`${label} Sealed su CardTrader: ${sealedBp.size} blueprint collegati a Cardmarket`);
  return { data: { v: 1, updated: now.toISOString(), sets, cards, coef }, sealed, log };
}

/**
 * Rapporto lingua/inglese di un gioco CardTrader (come `coefficients` dei file di lingua Pokémon): mediana dei rapporti
 * delle carte con offerte in entrambe le lingue, in totale (`all`) e per espansione, con la soglia di offerte scelta da
 * pickThreshold, solo sulle carte da MIN_PREMIUM_PRICE in su in inglese. Serve alle copie in una lingua senza offerte (Gaston promo in italiano: solo offerte inglesi):
 * prezzo = inglese × rapporto, invece di nessun prezzo. Francese, spagnolo e portoghese prendono sempre quello
 * dell'italiano (`from: "it"`), come per i Pokémon.
 * @returns {{[lang]: {all: [number, number], [exp]: [number, number], from?: string}}}
 */
export function languageCoefficients(cards, langs, log = [], label = "") {
  const out = {};
  for (const lang of langs) {
    if (lang === "en") continue;
    const samples = [];
    for (const c of cards) {
      // Le comuni a prezzo minimo (Lorcana: inglese mediano 0,14 €, 7 carte su 10 sotto 0,50 €) hanno lo stesso prezzo in ogni
      // lingua e dicono poco: contano solo le carte da MIN_PREMIUM_PRICE in su in inglese (italiano 90% invece di 100%).
      if (!(c.en?.[0] >= MIN_PREMIUM_PRICE) || !c[lang]?.[0]) continue;
      samples.push({ exp: c.s, ratio: c[lang][0] / c.en[0], offers: Math.min(c[lang][1], c.en[1]) });
    }
    const k = coefficients(samples);
    if (!k.all) continue;
    out[lang] = k;
    log.push(`${label} rapporto ${lang}/en: ${Math.round(k.all[0] * 100)}% su ${k.all[1]} carte`);
  }
  // Francese, spagnolo, portoghese e tedesco: sempre il rapporto dell'italiano (come per i Pokémon, RATIO_FROM_IT), anche
  // se ne hanno uno proprio: con poche offerte è gonfiato (Lorcana tedesco 123% su 50 carte).
  if (out.it) {
    for (const lang of RATIO_FROM_IT) {
      if (!langs.includes(lang)) continue;
      out[lang] = { ...structuredClone(out.it), from: "it" };
      log.push(`${label} rapporto ${lang}/en: quello dell'italiano`);
    }
  }
  return out;
}
