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

/**
 * Numero di una carta da confrontare tra TCGdex e CardTrader: come normNumber, senza gli zeri dopo le lettere
 * ("H08" di TCGdex = "H8" di CardTrader, "TG02" = "TG2"). Verifica dei prezzi del 17 novembre 2026: le holo «H» di Aquapolis e
 * Skyridge da H01 a H09 restavano col prodotto della gemella non holo (TCGdex le ha scambiate; da H10 in su il numero si
 * scrive uguale e la correzione le trovava): Entei H8 valeva 25 € con TCGplayer a 580 €, 16 carte su 18 sotto un terzo.
 */
export function cardNumber(s) {
  return normNumber(s).replace(/^([a-z]+)0+(?=\d)/, "$1");
}

/** Anni tra due prodotti omonimi perché quello nuovo sia di una versione speciale (vedi olderCopy in findFixes). */
const OLDER_COPY_YEARS = 5;

/** true se nome e attacchi del prodotto sono quelli della carta. */
function sameCard(card, product) {
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
  for (const p of products) {
    byId.set(Number(p.idProduct), { ...parseProductName(p.name), full: p.name, exp: p.idExpansion, id: Number(p.idProduct), added: String(p.dateAdded || "") });
  }
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
    const k = `${bp.exp}|${cardNumber(bp.number)}`;
    if (!ctByNumber.has(k)) ctByNumber.set(k, new Set());
    ctByNumber.get(k).add(cm);
  }

  const bySet = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    bySet.get(c.set).push(c);
  }

  const fix = {};
  // Prodotto giusto della sola carta (principale e varianti senza timbro né foil speciale), quando il prodotto sbagliato
  // resta giusto per una sua versione speciale: carta -> {prodotto: prodotto della carta}. Lo applica cm-prezzi.js alle righe.
  const own = {};
  const log = [];
  const stats = { cards: 0, links: 0, wrong: 0, fixed: 0, unknown: 0, missing: 0, added: 0, own: 0 };
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
    // Come [home], contando anche i prodotti delle varianti: per i set a cui TCGdex non dà prodotti principali (Gym Heroes,
    // Gym Challenge: solo quello della 1ª edizione). Serve solo per cercare il prodotto giusto di un prodotto condiviso.
    const homeVotes = new Map(votes);
    let homeValid = valid;
    for (const c of list) {
      for (const id of (c.variants || []).filter((x) => Number.isFinite(x) && x > 0 && x !== c.cm)) {
        const p = byId.get(id);
        if (p && sameCard(c, p)) {
          homeVotes.set(p.exp, (homeVotes.get(p.exp) || 0) + 1);
          homeValid++;
        }
      }
    }
    const homeAll = new Set([...homeVotes].filter(([, n]) => n >= Math.max(2, homeValid * 0.1)).map(([e]) => e));
    // Espansioni CardTrader del set: quelle dei blueprint dei suoi prodotti di casa.
    // Solo quelle di una parte vera delle carte (almeno il 10%): un prodotto nuovo della prerelease, che CardTrader mette
    // nell'espansione delle promo, non fa diventare quella un'espansione del set (riverifica del 19 novembre 2026).
    const ctVotes = new Map();
    let ctLinked = 0;
    for (const c of list) {
      const p = byId.get(c.cm);
      if (p && home.has(p.exp) && ctByProduct.has(c.cm)) {
        const e = ctByProduct.get(c.cm).exp;
        ctVotes.set(e, (ctVotes.get(e) || 0) + 1);
        ctLinked++;
      }
    }
    const ctExps = new Set([...ctVotes].filter(([, n]) => n >= Math.max(1, ctLinked * 0.1)).map(([e]) => e));
    // Set senza prodotti (promo Wizards, Nintendo...): l'espansione CardTrader con il nome del set.
    if (ctExps.size === 0 && setNames[set]) {
      const e = matchExpansion(ctExpList, setNames[set]);
      if (e) ctExps.add(e.id);
    }

    // Prodotto principale (quello di TCGdex) -> carta del set: una variante di un'altra carta non può avere quel prodotto.
    const mainOf = new Map();
    for (const c of list) if (Number.isFinite(c.cm) && c.cm > 0 && !mainOf.has(c.cm)) mainOf.set(c.cm, c.id);
    // Prodotto -> carte del set che lo usano (principale o variante).
    const users = new Map();
    for (const c of list) {
      for (const id of links(c)) {
        if (!users.has(id)) users.set(id, new Set());
        users.get(id).add(c.id);
      }
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
      // Un prodotto usato da 3 o più carte del set è di una sola (riverifica dei prezzi del 19 novembre 2026): per TCGdex la
      // 1ª edizione di «Erika's Bellsprout», «Erika's Dratini»... di Gym Heroes ha il prodotto della carta allenatore «Erika»
      // (65,50 € con TCGplayer a 2-4 €), e il controllo dei nomi non lo vedeva perché «Erika» sta dentro «Erika's Bellsprout».
      // Solo con un nome diverso: un attacco scritto in modo diverso, senza un prodotto migliore, non basta (le Magcargo di Skyridge).
      const owner = !same && cardName(c.name) !== p.name ? sharedOwner(id, p) : null;
      if (owner && owner !== c.id) {
        const right = (main ? null : ownProduct(c, id)) ?? findRight(c, id, homeAll);
        return { reason: `prodotto di ${owner}, usato da ${users.get(id).size} carte del set`, right: right || 0 };
      }
      // Le varianti con timbro (prerelease, Pokémon Day...) stanno in altre espansioni di Cardmarket:
      // per loro contano solo nome e attacchi, e il prodotto giusto non si cerca.
      if (!main) {
        // Il prodotto principale di un'altra carta dello stesso set (verifica dei prezzi del 17 novembre 2026): per TCGdex la
        // 1ª edizione delle rare non holo di Jungle e Team Rocket ha il prodotto della gemella holo, stesso nome e stessi
        // attacchi (Snorlax 27/64: prezzo di partenza 43,76 €, la tendenza dello Snorlax holo, invece dei suoi 14,57 €), e
        // la reverse di 8 carte di Supreme Victors quello di un'altra carta (Milotic 70/147 reverse 149 €, la carta 4 €).
        // La variante è della carta: vale il prodotto della carta (quello corretto, se TCGdex l'aveva sbagliato).
        const mainOwner = mainOf.get(id);
        if (mainOwner && mainOwner !== c.id && id !== c.cm2) {
          return { reason: `prodotto principale di ${mainOwner}`, right: ownProduct(c, id) || 0 };
        }
        return !same && otherCard(c.name, p.full) ? { reason: "carta diversa", right: 0 } : null;
      }
      // Il prodotto di una versione speciale aggiunto a Cardmarket anni dopo (riverifica del 19 novembre 2026): Milotic 70/147
      // di Supreme Victors ha su TCGdex il prodotto «Milotic Lv.49» del 10 aprile 2026 (97,25 €, quello della prerelease),
      // mentre la carta è il prodotto omonimo di sempre (1,21 €, TCGplayer 4,38 €).
      // Il prodotto resta alle versioni speciali: si corregge solo per la carta (own), non in "fix", che vale per tutte.
      const older = olderCopy(c, id, p);
      if (older) {
        (own[c.id] ||= {})[id] = older;
        stats.own++;
        const q = byId.get(older);
        log.push(`${c.id} ${c.name} (${c.localId}): ${id} "${p.full}" esp. ${p.exp}, aggiunto a Cardmarket il ${p.added.slice(0, 10)}, di una versione speciale -> ${older} "${q.full}" per la carta`);
        return null;
      }
      const right = findRight(c, id);
      if (!same) {
        if (right) return { reason: "nome o attacchi diversi", right };
        return otherCard(c.name, p.full) ? { reason: "carta diversa", right: 0 } : null;
      }
      if (!right) return null;
      if (home.size > 0 && !home.has(p.exp)) return { reason: "altra espansione", right };
      // Stessa carta nella stessa espansione ma numero diverso su CardTrader: es. due Mewtwo delle promo XY.
      const bp = ctByProduct.get(id);
      if (bp && cardNumber(bp.number) !== cardNumber(c.localId) && ctFor(c).includes(right)) {
        return { reason: `numero ${bp.number} su CardTrader`, right };
      }
      return null;
    }

    /** Prodotti dei blueprint CardTrader con il numero della carta, nelle espansioni del set. */
    function ctFor(c) {
      const out = new Set();
      for (const e of ctExps) for (const cm of ctByNumber.get(`${e}|${cardNumber(c.localId)}`) || []) out.add(cm);
      return [...out].filter((cm) => byId.has(cm) && sameCard(c, byId.get(cm)));
    }

    /**
     * La carta a cui appartiene un prodotto usato da 3 o più carte del set: quella che CardTrader collega col numero o, se
     * CardTrader non lo dice, una carta del set con lo stesso nome (e attacchi) del prodotto (Gym Heroes ne ha due «Erika»,
     * la holo 16 e la 100: il prodotto è di una delle due, comunque non di «Erika's Bellsprout»). null se non si sa.
     */
    function sharedOwner(id, p) {
      const who = users.get(id);
      if (!who || who.size < 3) return null;
      const bp = ctByProduct.get(id);
      if (bp && ctExps.has(bp.exp)) {
        const byNumber = list.filter((x) => cardNumber(x.localId) === cardNumber(bp.number));
        if (byNumber.length === 1) return byNumber[0].id;
      }
      return list.find((x) => sameCard(x, p))?.id ?? null;
    }

    /**
     * Il prodotto della carta per una sua variante col prodotto sbagliato [wrong]: quello principale (corretto, se TCGdex
     * l'aveva sbagliato), purché sia della carta e non di un'altra stampa: mai uno che CardTrader collega a un'espansione
     * fuori dal set (promo, prerelease). null se non c'è.
     */
    function ownProduct(c, wrong) {
      const mine = own[c.id]?.[c.cm] ?? (fix[c.id] && c.cm in fix[c.id] ? fix[c.id][c.cm] : c.cm);
      if (!(mine > 0) || mine === wrong || !byId.has(mine) || !sameCard(c, byId.get(mine))) return null;
      const bp = ctByProduct.get(mine);
      if (bp && ctExps.size > 0 && !ctExps.has(bp.exp)) return null;
      return mine;
    }

    /**
     * Prodotto principale [p] aggiunto a Cardmarket anni dopo un altro con lo stesso nome e gli stessi attacchi nella stessa
     * espansione, per una carta che ha versioni con timbro o foil speciali: è il prodotto di una di quelle (prerelease,
     * League...), e la carta è quello di prima. Solo se CardTrader non collega già [p] al numero della carta.
     */
    function olderCopy(c, id, p) {
      const year = (s) => (/^\d{4}/.test(s) && !s.startsWith("0000") ? Number(s.slice(0, 4)) : null);
      const added = year(p.added);
      if (added === null) return null;
      const special = (c.vd || []).some((v) => /\|(stamp|foil):/.test(v) && !/\|stamp:1st-edition/.test(v));
      if (!special) return null;
      // Stesso nome e stessi attacchi del prodotto della carta (il nome della carta non sempre è uguale: «Garchomp C»
      // contro «Garchomp [C] Lv.62»), e attacchi della carta.
      const moves = (c.attacks || []).concat(c.abilities || []).map(norm);
      if (p.moves.length === 0 || !p.moves.some((m) => moves.includes(m))) return null;
      const before = (byExpName.get(`${p.exp}|${p.name}`) || []).filter((q) => {
        if (q.id === id || q.moves.join("|") !== p.moves.join("|")) return false;
        const y = year(q.added);
        return y === null || added - y >= OLDER_COPY_YEARS;
      });
      if (before.length !== 1) return null;
      const ct = ctFor(c);
      if (ct.includes(id)) return null;
      return before[0].id;
    }

    /** Il prodotto giusto: per numero su CardTrader, o l'unico con nome e attacchi uguali nel set. */
    function findRight(c, wrong, exps = home) {
      const byNumber = ctFor(c).filter((id) => id !== wrong);
      if (byNumber.length === 1) return byNumber[0];
      if (byNumber.length > 1) return null;
      const cand = [];
      for (const e of exps) for (const p of byExpName.get(`${e}|${cardName(c.name)}`) || []) if (p.id !== wrong && sameCard(c, p)) cand.push(p);
      // Solo se gli attacchi la distinguono: senza (allenatori, energie) non si può sapere quale sia.
      if (cand.length === 1 && cand[0].moves.length > 0 && (c.attacks || []).length + (c.abilities || []).length > 0) return cand[0].id;
      return null;
    }
  }
  return { fix, own, stats, log };
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
async function ctProducts(ct, expNames = new Map()) {
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
  const { fix, own, stats, log } = findFixes(cards, products, ctMap, { setNames, ctExpNames });
  const ids = Object.values(fix).flatMap((m) => Object.values(m)).filter((x) => x > 0);
  // "own" lo legge cm-prezzi.js (le app lo ignorano): i prezzi dei suoi prodotti arrivano col file dei prezzi.
  const out = { v: 1, updated: new Date().toISOString(), fix, own, g: pricesFor(guide, ids) };
  await fs.writeFile(outFile, JSON.stringify(out));
  console.log(log.join("\n"));
  console.log(
    `carte ${stats.cards}, collegamenti ${stats.links}, sbagliati ${stats.wrong}: corretti ${stats.fixed}, senza prodotto giusto ${stats.unknown}; ` +
      `senza prodotto su TCGdex ${stats.missing}, trovati ${stats.added}; prodotto di una versione speciale ${stats.own}; ` +
      `blueprint CardTrader ${ctMap.size}, listino del ${guide.createdAt}`,
  );
}
