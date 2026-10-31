// One Piece: catalogo e prezzi presi tutti da CardTrader (nessun abbinamento tra fonti).
// Su CardTrader ogni stampa è un "blueprint" col suo numero (OP01-064 normale, OP01-064b
// Alternate Art...), uguale in tutte le lingue: le offerte si filtrano per lingua.
//
// Output (v1/onepiece.json):
//   { v, updated,
//     sets:  [{ id, code, name, n }]                 // espansioni con carte, n = carte
//     cards: [{ id, n: nome, num: numero, r: rarità, v: versione|null, s: idEspansione,
//               img: percorso immagine, en: [prezzoNM, offerte], jp: [...],
//               g: { en: {"PSA 10": [prezzo, offerte], ...}, jp: {...} } }] }   // carte gradate
//   Prezzi Near Mint in euro, stessa stima delle carte Pokémon (stats.js).
import { estimate, isPlaceholderPrice } from "./stats.js";
export { isPlaceholderPrice };
import { parseGrade } from "./grading.js";
import { items } from "./matching.js";
import { blueprintLanguage, sealedEstimate } from "./sealed.js";

export const ONE_PIECE_LANGS = ["en", "jp"];

/** Carte gradate: si leggono le offerte solo delle carte che valgono almeno tanto (euro, non gradate). */
export const GRADED_MIN_PRICE = 10;

/**
 * Offerta "segnaposto": alcuni venditori mettono le carte a 5.000, 10.000, 15.000 € (più qualche
 * centesimo di commissione) per tenerle in vetrina senza venderle. Visto sui dati reali di
 * ottobre 2026: 76 stime di questo tipo. Meglio nessun prezzo che uno finto.
 */

/** Una stampa di One Piece da un blueprint CardTrader; null per i prodotti sigillati. */
export function cardFromBlueprint(bp) {
  const num = bp?.fixed_properties?.collector_number;
  if (!num) return null;
  const version = typeof bp.version === "string" && bp.version.trim() ? bp.version.trim() : null;
  return {
    id: bp.id,
    n: String(bp.name || "").trim(),
    num: String(num).trim(),
    r: bp.fixed_properties?.onepiece_rarity || null,
    v: version,
    s: bp.expansion_id,
    img: bp.image?.show?.url || bp.image?.url || null,
  };
}

export async function buildOnePiece({ ct, langs = ONE_PIECE_LANGS, maxExpansions = Infinity, now = new Date() }) {
  const log = [];
  const games = items(await ct.get("games"));
  const game = games.find((g) => `${g.name} ${g.display_name || ""}`.toLowerCase().includes("one piece"));
  if (!game) throw new Error("One Piece non trovato tra i giochi di CardTrader");
  const expansions = (await ct.expansions(game.id)).slice(0, maxExpansions);

  const sets = [];
  const cards = [];
  const byId = new Map();
  // Prodotti Sealed (box, buste, mazzi...): blueprint senza numero di carta, collegati a Cardmarket.
  // Stessi dati dei Sealed Pokémon, per buildSealed (sealed.js).
  const sealedBp = new Map(); // blueprint -> [prodotti Cardmarket]
  const sealedExps = [];
  const sealed = { cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(), ctPrices: {} };
  for (const e of expansions) {
    let bps;
    try {
      bps = await ct.blueprints(e.id);
    } catch (err) {
      log.push(`! One Piece, blueprint ${e.name}: ${err.message}`);
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
      if (bp?.fixed_properties?.collector_number || ids.length === 0) continue;
      sealedBp.set(bp.id, ids);
      hasSealed = true;
      for (const id of ids) sealed.ctProducts.set(id, { bp: bp.id, img: bp.image?.show?.url || bp.image?.url || null, lang: blueprintLanguage(bp) });
    }
    const expLang = [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (expLang) sealed.ctExpLangs.set(e.id, expLang);
    if (hasSealed) sealedExps.push(e);
    const setCards = bps.map(cardFromBlueprint).filter(Boolean);
    if (setCards.length === 0) continue;
    sets.push({ id: e.id, code: e.code || "", name: e.name, n: setCards.length });
    for (const c of setCards) {
      cards.push(c);
      byId.set(c.id, c);
    }
  }
  log.push(`One Piece: ${sets.length} espansioni con carte, ${cards.length} carte`);

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
        const est = estimate(offers.filter((o) => !isPlaceholderPrice(o.price)), "n");
        if (!est) continue;
        c[lang] = est;
        priced++;
      }
    }
    // Lingua dell'app: "jp" di CardTrader = "ja".
    sealed.ctPrices[lang === "jp" ? "ja" : lang] = sealedPrices;
    log.push(`One Piece ${lang}: ${priced} carte con offerte${failures ? `, ${failures} espansioni non lette` : ""}`);
  }
  // Carte gradate: le offerte di una carta alla volta (tutte le lingue insieme), solo per le carte
  // di valore. Prezzo per ente, voto e lingua: stessa stima delle carte non gradate.
  const valuable = cards.filter((c) => Math.max(c.en?.[0] || 0, c.jp?.[0] || 0) >= GRADED_MIN_PRICE);
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
      const lang = o.language === "jp" ? "jp" : o.language === "en" ? "en" : null;
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
  log.push(`One Piece gradate: ${valuable.length} carte di valore lette, ${withGraded} con offerte gradate riconoscibili`);
  log.push(`One Piece Sealed su CardTrader: ${sealedBp.size} blueprint collegati a Cardmarket`);
  return { data: { v: 1, updated: now.toISOString(), sets, cards }, sealed, log };
}
