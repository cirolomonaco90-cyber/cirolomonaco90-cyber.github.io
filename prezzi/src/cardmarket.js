// Correzioni dei prodotti Cardmarket di TCGdex.
//
// TCGdex collega ogni carta a un prodotto Cardmarket (thirdParty.cardmarket) e ne riporta i prezzi.
// A volte il collegamento è sbagliato: Mewtwo XY101 delle promo XY risulta la promo giapponese
// "Mew 20th Anniversary Festa" (5.550 €), Pikachu XY95 il Pikachu-EX XY84 (oltre 1.800 €).
// Qui ogni collegamento si controlla con il catalogo ufficiale di Cardmarket (nome e attacchi del
// prodotto, espansione) e con i numeri di collezione di CardTrader; per quelli sbagliati si cerca
// il prodotto giusto e se ne prendono i prezzi dal listino ufficiale (price guide) di Cardmarket.
//
//   CARDTRADER_TOKEN=... node src/cardmarket.js <cache-carte-tcgdex.json> <output.json>
//
// Output: { v, updated, fix: {idCarta: {prodottoSbagliato: prodottoGiusto | 0}}, g: {prodotto: {campo: prezzo}} }
//   0 = prodotto giusto non trovato con certezza: l'app non mostra il prezzo sbagliato.
//   Chiave 0 = carta che TCGdex non collega a nessun prodotto (promo Wizards, Nintendo, BW; Victini-EX di
//   Plasma Storm...): il prodotto trovato con il numero di CardTrader o con nome e attacchi.
//   g = prezzi Cardmarket dei prodotti giusti (stessi campi di TCGdex: trend, avg30, avg, low, *-holo...).
import fs from "node:fs/promises";
import { norm, normNumber, blueprintNumber, matchExpansion } from "./matching.js";
import { fetchRetry } from "./rete.js";

const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const PRODUCTS = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

/**
 * "Mewtwo [Psy Bolt | Zen Blade]" -> { name: "mewtwo", moves: ["psybolt", "zenblade"] }.
 * Le parentesi che non sono attacchi ("Unown [G]", "Nidoran [M]", "Kyogre & Groudon LEGEND [Top]")
 * non contano.
 */
export function parseProductName(full) {
  const s = String(full || "");
  const groups = [...s.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim());
  const last = groups.length > 0 ? groups[groups.length - 1] : "";
  const isMoves = last.includes("|") || (last.length > 1 && !/^(top|bottom)$/i.test(last));
  const moves = isMoves && groups.length > 0 ? last.split("|").map(norm).filter(Boolean) : [];
  return { name: cardName(s), moves };
}

/**
 * Nome confrontabile: come norm, senza parentesi, con "Mega X" = "M X", senza il simbolo delle
 * Pokémon Star e delta e senza il livello delle carte Diamante e Perla ("Gliscor LV.42" su
 * Cardmarket, "Gliscor" su TCGdex).
 */
export function cardName(s) {
  return norm(
    String(s || "")
      .replace(/\s*\[[^\]]*\]/g, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\bMega\b/gi, "M")
      .replace(/[◇☆★δ]/g, "")
      .replace(/\bDelta Species\b/gi, "")
      .replace(/^Basic (\w+ Energy)$/i, "$1")
      .replace(/\s*\bLV\.?\s*(\d+|X)\b/gi, ""),
  );
}

/** true se nome e attacchi del prodotto sono quelli della carta. */
export function sameCard(card, product) {
  if (cardName(card.name) !== product.name) return false;
  const moves = new Set([...(card.attacks || []), ...(card.abilities || [])].map(norm));
  if (product.moves.length === 0 || moves.size === 0) return true;
  return product.moves.some((m) => moves.has(m));
}

/**
 * true se i due nomi sono chiaramente di carte diverse ("Mewtwo" e "Mew", "Charmander" e "Bulbasaur"),
 * non solo scritti in modo diverso ("Prof. Oak's Research" e "Professor Oak's Research").
 */
export function otherCard(a, b) {
  const x = cardName(a);
  const y = cardName(b);
  if (x === y || (x.includes(y) && y.length >= 4) || (y.includes(x) && x.length >= 4)) return false;
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return i < 4;
}

/**
 * Controlla tutte le carte. Una carta si corregge solo con una prova: il prodotto giusto trovato
 * (stesso nome e attacchi nell'espansione del set, o stesso numero su CardTrader), oppure un
 * prodotto di una carta chiaramente diversa (allora 0: niente prezzo, invece di uno sbagliato).
 * Un attacco scritto in modo diverso, senza un prodotto migliore, non basta.
 * @param {object[]} cards carte TCGdex compatte (vedi tcgdex-scan.js)
 * @param {object[]} products catalogo Cardmarket: {idProduct, name, idExpansion}
 * @param {Map<number, {exp: number, number: string}>} ctByProduct prodotto -> blueprint CardTrader (espansione e numero)
 * @returns {{fix: Record<string, Record<string, number>>, stats: object, log: string[]}}
 */
export function findFixes(cards, products, ctByProduct = new Map(), { setNames = {}, ctExpNames = new Map() } = {}) {
  const ctExpList = [...ctExpNames].map(([id, name]) => ({ id, name }));
  const byId = new Map();
  for (const p of products) byId.set(Number(p.idProduct), { ...parseProductName(p.name), full: p.name, exp: p.idExpansion, id: Number(p.idProduct) });
  // Prodotti per espansione Cardmarket e per nome: per cercare quello giusto.
  const byExpName = new Map();
  for (const p of byId.values()) {
    const k = `${p.exp}|${p.name}`;
    if (!byExpName.has(k)) byExpName.set(k, []);
    byExpName.get(k).push(p);
  }
  // Blueprint CardTrader per espansione e numero.
  const ctByNumber = new Map();
  for (const [cm, bp] of ctByProduct) {
    const k = `${bp.exp}|${normNumber(bp.number)}`;
    if (!ctByNumber.has(k)) ctByNumber.set(k, new Set());
    ctByNumber.get(k).add(cm);
  }

  const bySet = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    bySet.get(c.set).push(c);
  }

  const fix = {};
  const log = [];
  const stats = { cards: 0, links: 0, wrong: 0, fixed: 0, unknown: 0, missing: 0, added: 0 };
  for (const [set, list] of bySet) {
    // Espansioni Cardmarket "di casa" del set: quelle dei prodotti principali che corrispondono alla carta.
    const votes = new Map();
    let valid = 0;
    for (const c of list) {
      const p = byId.get(c.cm);
      if (p && sameCard(c, p)) {
        votes.set(p.exp, (votes.get(p.exp) || 0) + 1);
        valid++;
      }
    }
    const home = new Set([...votes].filter(([, n]) => n >= Math.max(2, valid * 0.1)).map(([e]) => e));
    // Espansioni CardTrader del set: quelle dei blueprint dei suoi prodotti di casa.
    const ctExps = new Set();
    for (const c of list) {
      const p = byId.get(c.cm);
      if (p && home.has(p.exp) && ctByProduct.has(c.cm)) ctExps.add(ctByProduct.get(c.cm).exp);
    }
    // Set senza prodotti (promo Wizards, Nintendo...): l'espansione CardTrader con il nome del set.
    if (ctExps.size === 0 && setNames[set]) {
      const e = matchExpansion(ctExpList, setNames[set]);
      if (e) ctExps.add(e.id);
    }

    for (const c of list) {
      stats.cards++;
      if (links(c).length === 0) {
        // Nessun prodotto su TCGdex: si cerca come per quelli sbagliati, con la stessa prudenza.
        stats.missing++;
        const right = findRight(c, 0);
        if (right) {
          (fix[c.id] ||= {})[0] = right;
          stats.added++;
          const r = byId.get(right);
          log.push(`${c.id} ${c.name} (${c.localId}): senza prodotto -> ${right} "${r.full}" esp. ${r.exp}`);
        }
        continue;
      }
      for (const id of links(c)) {
        stats.links++;
        const verdict = check(c, id, id === c.cm);
        if (!verdict) continue;
        stats.wrong++;
        (fix[c.id] ||= {})[id] = verdict.right;
        if (verdict.right) stats.fixed++;
        else stats.unknown++;
        const p = byId.get(id);
        const r = byId.get(verdict.right);
        log.push(`${c.id} ${c.name} (${c.localId}): ${id} "${p.full}" esp. ${p.exp}, ${verdict.reason} -> ${r ? `${r.id} "${r.full}" esp. ${r.exp}` : "nessuno"}`);
      }
    }

    /** null se il prodotto va bene, altrimenti {reason, right}. */
    function check(c, id, main) {
      const p = byId.get(id);
      if (!p) return null; // non è una carta singola del catalogo: non si giudica
      const same = sameCard(c, p);
      // Le varianti con timbro (prerelease, Pokémon Day...) stanno in altre espansioni di Cardmarket:
      // per loro contano solo nome e attacchi, e il prodotto giusto non si cerca.
      if (!main) return !same && otherCard(c.name, p.full) ? { reason: "carta diversa", right: 0 } : null;
      const right = findRight(c, id);
      if (!same) {
        if (right) return { reason: "nome o attacchi diversi", right };
        return otherCard(c.name, p.full) ? { reason: "carta diversa", right: 0 } : null;
      }
      if (!right) return null;
      if (home.size > 0 && !home.has(p.exp)) return { reason: "altra espansione", right };
      // Stessa carta nella stessa espansione ma numero diverso su CardTrader: es. due Mewtwo delle promo XY.
      const bp = ctByProduct.get(id);
      if (bp && normNumber(bp.number) !== normNumber(c.localId) && ctFor(c).includes(right)) {
        return { reason: `numero ${bp.number} su CardTrader`, right };
      }
      return null;
    }

    /** Prodotti dei blueprint CardTrader con il numero della carta, nelle espansioni del set. */
    function ctFor(c) {
      const out = new Set();
      for (const e of ctExps) for (const cm of ctByNumber.get(`${e}|${normNumber(c.localId)}`) || []) out.add(cm);
      return [...out].filter((cm) => byId.has(cm) && sameCard(c, byId.get(cm)));
    }

    /** Il prodotto giusto: per numero su CardTrader, o l'unico con nome e attacchi uguali nel set. */
    function findRight(c, wrong) {
      const byNumber = ctFor(c).filter((id) => id !== wrong);
      if (byNumber.length === 1) return byNumber[0];
      if (byNumber.length > 1) return null;
      const cand = [];
      for (const e of home) for (const p of byExpName.get(`${e}|${cardName(c.name)}`) || []) if (p.id !== wrong && sameCard(c, p)) cand.push(p);
      // Solo se gli attacchi la distinguono: senza (allenatori, energie) non si può sapere quale sia.
      if (cand.length === 1 && cand[0].moves.length > 0 && (c.attacks || []).length + (c.abilities || []).length > 0) return cand[0].id;
      return null;
    }
  }
  return { fix, stats, log };
}

/** Prodotti Cardmarket di una carta: quello principale e quelli delle varianti. */
function links(c) {
  return [...new Set([c.cm, ...(c.variants || [])].filter((x) => Number.isFinite(x) && x > 0))];
}

/** Prezzi del listino Cardmarket per i prodotti giusti, con i nomi dei campi di TCGdex. */
export function pricesFor(guide, ids) {
  const want = new Set(ids);
  const g = {};
  for (const row of guide.priceGuides || []) {
    if (!want.has(Number(row.idProduct))) continue;
    const out = {};
    for (const [k, v] of Object.entries(row)) if (k !== "idProduct" && k !== "idCategory" && typeof v === "number") out[k] = v;
    g[row.idProduct] = out;
  }
  return g;
}

async function json(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Blueprint CardTrader di tutte le espansioni Pokémon: prodotto Cardmarket -> {exp, number};
 * [expNames]: espansione -> nome (per i set che TCGdex non collega a nessun prodotto).
 */
export async function ctProducts(ct, expNames = new Map()) {
  const out = new Map();
  const gameId = await ct.pokemonGameId();
  for (const e of await ct.expansions(gameId)) {
    expNames.set(e.id, e.name);
    let bps = [];
    try {
      bps = await ct.blueprints(e.id);
    } catch {
      continue;
    }
    for (const bp of bps) {
      const number = blueprintNumber(bp);
      if (!number) continue;
      for (const id of bp.card_market_ids || []) out.set(Number(id), { exp: e.id, number });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cacheFile, outFile = "cardmarket.json"] = process.argv.slice(2);
  const cards = Object.values(JSON.parse(await fs.readFile(cacheFile, "utf8")));
  const [products, guide] = [(await json(PRODUCTS)).products, await json(GUIDE)];
  let ctMap = new Map();
  const ctExpNames = new Map();
  if (process.env.CARDTRADER_TOKEN) {
    const { CardTrader } = await import("./cardtrader.js");
    ctMap = await ctProducts(new CardTrader({ token: process.env.CARDTRADER_TOKEN, cacheDir: process.env.CT_CACHE || null }), ctExpNames);
  }
  // Nomi inglesi dei set TCGdex: per trovare l'espansione CardTrader dei set senza prodotti.
  let setNames = {};
  try {
    setNames = Object.fromEntries((await json("https://api.tcgdex.net/v2/en/sets")).map((s) => [s.id, s.name]));
  } catch (err) {
    console.log(`nomi dei set TCGdex non letti: ${err.message}`);
  }
  const { fix, stats, log } = findFixes(cards, products, ctMap, { setNames, ctExpNames });
  const ids = Object.values(fix).flatMap((m) => Object.values(m)).filter((x) => x > 0);
  const out = { v: 1, updated: new Date().toISOString(), fix, g: pricesFor(guide, ids) };
  await fs.writeFile(outFile, JSON.stringify(out));
  console.log(log.join("\n"));
  console.log(
    `carte ${stats.cards}, collegamenti ${stats.links}, sbagliati ${stats.wrong}: corretti ${stats.fixed}, senza prodotto giusto ${stats.unknown}; ` +
      `senza prodotto su TCGdex ${stats.missing}, trovati ${stats.added}; ` +
      `blueprint CardTrader ${ctMap.size}, listino del ${guide.createdAt}`,
  );
}
