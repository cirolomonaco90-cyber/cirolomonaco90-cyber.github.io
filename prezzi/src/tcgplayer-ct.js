// Prodotti TCGplayer delle carte One Piece, Lorcana e Dragon Ball (categorie tcgcsv 68, 71, 80 e 27): per ogni
// carta del catalogo CardTrader (onepiece.json, lorcana.json, dragonball.json) il prodotto TCGplayer con lo stesso
// numero e la stessa stampa, campo `tp: [idProdotto, idGruppo]`. Serve all'app per lo storico dei prezzi dal 2024
// (archivi tcgcsv, storico.js) e per la variazione delle 24 ore, come per le carte Pokémon (tcgplayerIdOf).
//
// TCGplayer scrive il numero in extendedData "Number": One Piece "OP01-003" (nome "Monkey.D.Luffy (003) (Parallel)"
// per l'alternate art), Lorcana "1/204" (il numero da solo è comune a ogni set: conta il nome), Dragon Ball
// "FB01-066" / "SD1-01" (nome "... (Alternate Art)"). CardTrader numera le stampe speciali con una lettera
// ("OP01-003b") e le descrive in `v` ("Alternate Art", "Manga", "Parallel"...).
import { fetchRetry } from "./rete.js";
import { yugiohKey } from "./onepiece.js";

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };

/** Categorie TCGplayer di ogni gioco (chiavi di CT_GAME_FILES). Dragon Ball: Fusion World (80) e Super Card Game (27). */
export const TP_CATEGORIES = { onepiece: [68], lorcana: [71], dragonball: [80, 27], yugioh: [2] };

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Chiave del numero: One Piece/Dragon Ball "OP01-003b" -> "op01-003" (senza la lettera della stampa); Lorcana "1/204" o "001" -> "001". */
export function numberKey(game, number) {
  const n = String(number || "").trim();
  if (!n) return null;
  // Yu-Gi-Oh!: "LOB-EN001" (TCGplayer) e "LOB-001" (catalogo) -> "lob-001".
  if (game === "yugioh") return yugiohKey(n);
  if (game === "lorcana") {
    const m = n.match(/^(\d{1,3})/);
    return m ? m[1].padStart(3, "0") : null;
  }
  const m = n.toUpperCase().match(/^([A-Z]+\d*-\d+)/);
  return m ? m[1].toLowerCase() : null;
}

/** Le parole tra parentesi del nome TCGplayer che descrivono la stampa ("(Parallel)", "(Alternate Art)"), senza il numero "(003)". */
export function tpExtra(name) {
  const words = [];
  for (const m of String(name || "").matchAll(/\(([^)]*)\)/g)) {
    if (/^\s*\d+\s*$/.test(m[1])) continue;
    words.push(...norm(m[1]).split(" ").filter(Boolean));
  }
  return new Set(words);
}

// Parole che dicono "stampa speciale" (non le rarità: "Super Rare", "Special Rare" su CardTrader sono la carta base).
const STAMPA = new Set(["parallel", "alternate", "art", "manga", "sp", "foil", "box", "topper", "reprint", "pre", "release", "promo", "wanted", "treasure", "stamp", "stamped", "anniversary", "gold", "silver"]);

/** Tra più candidati, quelli del gruppo TCGplayer che corrisponde al set CardTrader ("OP-01: Romance Dawn" ~ "Romance Dawn"). */
function bySet(cands, setName) {
  const set = norm(setName);
  if (!set) return cands;
  // Prima il gruppo con lo stesso nome del set: "Vermilion Bloodline" non è "Vermilion Bloodline: Pre-Release Promos", che
  // lo contiene (10 novembre 2026: interi set Dragon Ball restavano senza prodotto perché i due gruppi valevano uguale).
  const exact = cands.filter((c) => groupKey(c.groupName) === groupKey(setName));
  if (exact.length) return exact;
  const same = cands.filter((c) => {
    const g = norm(c.groupName);
    return g && (g === set || set.includes(g) || g.includes(set));
  });
  return same.length ? same : cands;
}

/** Le parole della versione CardTrader ("Alternate Art | Fixed Reprint", "Manga Panel Alternate Art | Secret Rare"). */
export function ctExtra(card) {
  const words = new Set(norm(card.v || "").split(" ").filter(Boolean));
  // Una lettera dopo il numero (OP01-003b) è comunque una stampa speciale.
  if (!words.size && /^[A-Z]+\d*-\d+[a-z]$/i.test(card.num || "")) words.add("parallel");
  return words;
}

/**
 * Indice dei prodotti TCGplayer di un gioco: chiave del numero -> [{ id, group, groupName, name, extra }].
 * [groups]: elenco tcgcsv dei gruppi; [productsOf]: gruppo -> prodotti (results).
 */
export function tpIndex(game, groups, productsOf) {
  const index = new Map();
  for (const g of groups) {
    for (const p of productsOf(g.groupId) || []) {
      const number = (p.extendedData || []).find((e) => e.name === "Number")?.value;
      const key = numberKey(game, number);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      const entry = { id: p.productId, group: g.groupId, groupName: g.name, name: p.name, extra: tpExtra(p.name) };
      if (game === "yugioh") {
        entry.rarity = rarityKey((p.extendedData || []).find((e) => e.name === "Rarity")?.value);
        // Anche per gruppo e numero senza il codice del set: CardTrader a volte ne usa uno suo (vedi matchYugioh).
        const gk = `${GROUP_KEY}${groupKey(g.name)}|${digitsOf(number)}`;
        if (!index.has(gk)) index.set(gk, []);
        index.get(gk).push(entry);
      }
      index.get(key).push(entry);
    }
  }
  return index;
}

// ---- Yu-Gi-Oh!: più prodotti con lo stesso numero (ristampe del set in altri gruppi, una rarità per prodotto)

const GROUP_KEY = "gruppo:";
/** Nome di un set o gruppo senza articoli né punteggiatura, parole in ordine: "The Legend of Blue Eyes…" = "Legend of Blue Eyes…". */
const groupWords = (name) => norm(name).split(" ").filter((w) => w && w !== "the");
const groupKey = (name) => groupWords(name).sort().join(" ");
/** Le cifre in fondo al numero: "SBCB-EN001" -> "001", "RA04-001qsec" -> "001". */
const digitsOf = (number) => String(number || "").match(/(\d+)[a-z]*$/i)?.[1] ?? "";
/**
 * Rarità confrontabile: "Quarter Century Secret Rare", "Common / Short Print" -> "common"; nelle Rarity Collection TCGplayer
 * scrive "Prismatic Collector's Rare" e "Prismatic Ultimate Rare" dove CardTrader ha "Collector's Rare Rare" e "Ultimate Rare".
 */
export const rarityKey = (r) => norm(String(r || "").split(/[|/]/)[0]).replace(/ short print$/, "").replace(/^prismatic /, "").replace(/\b(rare)( rare)+$/, "$1");

/** Tra i candidati, quelli del gruppo col nome più vicino al set (meno parole diverse): l'originale, non la ristampa "(25th Anniversary Edition)". */
function closestGroup(cands, setName) {
  const set = new Set(groupWords(setName));
  if (!set.size || cands.length < 2) return cands;
  const dist = (c) => {
    const g = new Set(groupWords(c.groupName));
    return [...g].filter((w) => !set.has(w)).length + [...set].filter((w) => !g.has(w)).length;
  };
  const best = Math.min(...cands.map(dist));
  return cands.filter((c) => dist(c) === best);
}

/**
 * Yu-Gi-Oh! (10 novembre 2026: 17.306 carte su 46.947 senza prodotto TCGplayer, cioè senza storico dal 2024; tra queste
 * tutti i set più famosi). Tre cause, sui dati veri di tcgcsv:
 * - lo stesso numero in più gruppi: "LOB-001" è in "The Legend of Blue Eyes White Dragon", "… (Worldwide English)" e
 *   "… (25th Anniversary Edition)", e la regola del nome contenuto li accettava tutti e tre: ora il gruppo col nome più
 *   vicino al set ([closestGroup]);
 * - una rarità per prodotto con lo stesso numero (Rarity Collection: sette rarità della stessa carta; Battle Pack: normale e
 *   "Starfoil"): ora la rarità del catalogo contro quella di TCGplayer;
 * - il codice del set di CardTrader diverso da quello stampato ("LOB25-001" per LOB-EN001 della 25th Anniversary, "SBBC"
 *   per SBCB, "TIN20" per MP20): senza candidati per numero, i prodotti del gruppo con lo stesso nome del set, le stesse
 *   cifre e lo stesso nome della carta.
 * Restituisce i candidati rimasti (uno = trovato; più d'uno li decide la regola delle stampe di [matchTp]).
 */
export function yugiohCandidates(card, index, setName) {
  let cands = index.get(numberKey("yugioh", card.num)) || [];
  if (!cands.length && setName) {
    const name = norm(card.n);
    cands = (index.get(`${GROUP_KEY}${groupKey(setName)}|${digitsOf(card.num)}`) || []).filter((c) => tpBaseName(c.name) === name);
  }
  cands = closestGroup(cands, setName);
  if (cands.length < 2) return cands;
  // Carte diverse con lo stesso numero (promo dei videogiochi: "WC4-001" è Fairy King Truesdale e Valkyrion): prima il nome.
  const name = norm(card.n);
  const named = cands.filter((c) => tpBaseName(c.name) === name);
  if (named.length) cands = named;
  if (cands.length < 2) return cands;
  const rarity = rarityKey(card.r || card.v);
  const same = rarity ? cands.filter((c) => c.rarity === rarity) : [];
  return same.length ? same : cands;
}

/**
 * Un prodotto trovato col solo numero deve essere la stessa carta: stesso nome, oppure (una carta rinominata: "Darklord
 * Marie" è "Marie the Fallen One", "Black Skull Dragon" è "B. Skull Dragon") stessa rarità. Nome e rarità diversi = un'altra
 * carta con lo stesso numero ("Beaver Warrior SRL-103" di CardTrader contro "Serpent Night Dragon" Secret Rare).
 */
function sameYugiohCard(card, c) {
  // Le stesse parole, in qualunque ordine: "Sheep Token" è "Token: Sheep (Blue)".
  const words = (x) => x.split(" ").sort().join(" ");
  if (words(tpBaseName(c.name)) === words(norm(card.n))) return true;
  const rarity = rarityKey(card.r || card.v);
  return Boolean(rarity) && c.rarity === rarity;
}

/** Nome TCGplayer senza le parentesi e senza il numero in coda ("Trunks : Future - FB01-049 (Alternate Art)" -> "trunks future"). */
function tpBaseName(name) {
  return norm(String(name).replace(/\([^)]*\)/g, " ").replace(/\s[-–]\s*[A-Z]+\d*-\d+\s*$/i, " "));
}

/**
 * Il prodotto TCGplayer di una carta CardTrader: stesso numero; tra più stampe quella con le stesse parole di
 * stampa (alternate art, parallel, manga...), altrimenti la stampa base per la carta base; Lorcana: stesso nome,
 * e con più set lo stesso set. Niente se resta il dubbio. Restituisce [idProdotto, idGruppo] o null.
 */
export function matchTp(game, card, index, setName = "") {
  const key = numberKey(game, card.num);
  const cands = game === "yugioh" ? yugiohCandidates(card, index, setName) : key ? index.get(key) : null;
  if (!cands?.length) return null;
  if (game === "yugioh" && cands.length === 1) return sameYugiohCard(card, cands[0]) ? [cands[0].id, cands[0].group] : null;
  const name = norm(card.n);
  if (game === "lorcana") {
    const same = cands.filter((c) => tpBaseName(c.name) === name);
    if (same.length === 1) return [same[0].id, same[0].group];
    if (!same.length) return null;
    const set = norm(setName);
    const bySet = same.filter((c) => set && (norm(c.groupName) === set || set.includes(norm(c.groupName)) || norm(c.groupName).includes(set)));
    return bySet.length === 1 ? [bySet[0].id, bySet[0].group] : null;
  }
  const words = [...ctExtra(card)];
  const mine = words.filter((w) => STAMPA.has(w));
  const plain = cands.filter((c) => ![...c.extra].some((w) => STAMPA.has(w)));
  if (!mine.length) {
    // Stampa base: il prodotto senza parole di stampa; con più d'uno (ristampe in altri gruppi) quello del set, poi col nome uguale.
    if (plain.length === 1) return [plain[0].id, plain[0].group];
    const inSet = bySet(plain, setName);
    if (inSet.length === 1) return [inSet[0].id, inSet[0].group];
    const byName = inSet.filter((c) => tpBaseName(c.name) === name);
    return byName.length === 1 ? [byName[0].id, byName[0].group] : null;
  }
  const special = bySet(cands.filter((c) => [...c.extra].some((w) => STAMPA.has(w))), setName);
  if (special.length === 1) return [special[0].id, special[0].group];
  // Più stampe speciali: quella con più parole in comune con la versione CardTrader ("Dokkan Battle Alternate Art"
  // batte "Alternate Art"); a parità quella con meno parole in più (la semplice "Alternate Art").
  const scored = special.map((c) => [c, words.filter((w) => c.extra.has(w)).length]).filter(([, n]) => n > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map(([, n]) => n));
  const top = bySet(scored.filter(([, n]) => n === best).map(([c]) => c), setName);
  const fewest = Math.min(...top.map((c) => c.extra.size));
  const tight = top.filter((c) => c.extra.size === fewest);
  return tight.length === 1 ? [tight[0].id, tight[0].group] : null;
}

/**
 * Aggiunge `tp: [idProdotto, idGruppo]` alle carte di [data] (catalogo del job di [game]) dai prodotti TCGplayer
 * delle sue categorie. Restituisce quante carte lo hanno.
 */
export async function addTcgplayerIds(game, data, { fetchJson = json, categories = TP_CATEGORIES[game] || [], log = [], sealed = null } = {}) {
  const groups = [];
  const products = new Map();
  for (const cat of categories) {
    const gs = (await fetchJson(`${TCGCSV}/${cat}/groups`))?.results || [];
    for (const g of gs) {
      try {
        products.set(g.groupId, (await fetchJson(`${TCGCSV}/${cat}/${g.groupId}/products`))?.results || []);
        groups.push(g);
      } catch (err) {
        log.push(`! TCGplayer ${game}, gruppo ${g.name}: ${err.message}`);
      }
    }
  }
  const index = tpIndex(game, groups, (id) => products.get(id));
  // Prodotti sigillati (senza numero di carta): per le foto dei Sealed del gioco (sealed.js, tcgplayerImages).
  if (sealed) {
    for (const g of groups) {
      for (const p of products.get(g.groupId) || []) {
        if ((p.extendedData || []).some((e) => e.name === "Number")) continue;
        sealed.push({ id: p.productId, name: p.name, group: g.name, groupId: g.groupId, noImg: p.imageCount === 0 });
      }
    }
  }
  const setNames = new Map((data.sets || []).map((s) => [s.id, s.name]));
  let n = 0;
  for (const c of data.cards || []) {
    const tp = matchTp(game, c, index, setNames.get(c.s) || "");
    if (tp) {
      c.tp = tp;
      n++;
    } else {
      delete c.tp;
    }
  }
  log.push(`${game}: ${n} carte su ${(data.cards || []).length} con il prodotto TCGplayer (${groups.length} gruppi)`);
  return n;
}
