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
      index.get(key).push({ id: p.productId, group: g.groupId, groupName: g.name, name: p.name, extra: tpExtra(p.name) });
    }
  }
  return index;
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
  const cands = key ? index.get(key) : null;
  if (!cands?.length) return null;
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
        sealed.push({ id: p.productId, name: p.name, group: g.name, groupId: g.groupId });
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
