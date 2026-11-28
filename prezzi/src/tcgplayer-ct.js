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
const TP_CATEGORIES = { onepiece: [68], lorcana: [71], dragonball: [80, 27], yugioh: [2] };

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
function yugiohCandidates(card, index, setName) {
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
function sameYugiohCard(card, c, names = null) {
  // Le stesse parole, in qualunque ordine: "Sheep Token" è "Token: Sheep (Blue)".
  const words = (x) => x.split(" ").sort().join(" ");
  if (words(tpBaseName(c.name)) === words(norm(card.n))) return true;
  // Lo stesso nome scritto un po' diverso ("Cemetery Bomb" / "Cemetary Bomb").
  if (closeName(norm(card.n).replace(/ /g, ""), tpBaseName(c.name).replace(/ /g, ""))) return true;
  // A7 della riverifica (19 novembre 2026): un prodotto col nome di un'altra carta dello stesso set è quella carta, anche con
  // la stessa rarità (LART-064 Macro Cosmos e LART-065 Masked Ninja Ebisu scambiate, LDS3-005/006, BPW2-088/089).
  if (names?.has(tpBaseName(c.name))) return false;
  const rarity = rarityKey(card.r || card.v);
  return Boolean(rarity) && c.rarity === rarity;
}

/** Distanza tra due nomi senza spazi entro due lettere (o un ottavo del nome), come closeName dell'app (CollectrImport.kt). */
function closeName(a, b) {
  if (!a || !b) return false;
  const max = Math.max(2, Math.floor(Math.min(a.length, b.length) / 8));
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * A7 della riverifica (19 novembre 2026, approvato dall'utente): il prodotto deve avere il nome della carta. Il collegamento
 * passa dal numero, e dove CardTrader e TCGplayer numerano diversamente lo stesso set la carta prendeva il prodotto di
 * un'altra (Dragon Ball BT15-039 SS Cabba -> "Cabba, Saiyan Pride", quasi tutto BT15 e TB3; One Piece OP09-010a Buggy ->
 * "Bonk Punch (Reprint)"). Valgono: lo stesso nome a meno di accenti e due lettere ([closeName]: "Sorbet" / "Sorbe",
 * "Attack Furry" / "Attack Fury"), oppure tutte le parole dell'uno nell'altro, da due parole in su ("Energy Marker" e
 * "\"Gogeta\" Energy Marker", "Piccolo, Savior from Beyond"); mai il nome esatto di un'altra carta del catalogo ([names]).
 */
export function sameCardName(card, c, names = null) {
  const a = norm(card.n);
  // Il nome del prodotto senza le parentesi ("Shanks (Parallel)" -> "shanks") e con quelle che non sono il numero
  // ("Gloriosa (Grandma Nyon)", "Mr.2.Bon.Kurei (Bentham)": nel catalogo il nome le ha).
  const forms = [tpBaseName(c.name), tpFullName(c.name)];
  if (!a || !forms[0]) return true;
  if (forms.includes(a)) return true;
  if (forms.some((b) => closeName(a.replace(/ /g, ""), b.replace(/ /g, "")))) return true;
  const wa = a.split(" "), sa = new Set(wa);
  return forms.some((b) => {
    const wb = b.split(" "), sb = new Set(wb);
    // Il nome del prodotto è dentro quello della carta ("Energy Marker" in "\"Gogeta\" Energy Marker", "Jiren" in
    // "Jiren // Jiren", "Syn Shenron" in "Syn Shenron // Omega Shenron").
    if (wb.every((w) => sa.has(w))) return true;
    // Quello della carta dentro quello del prodotto ("Ganos" / "Ganos, Bird of Prey", "Son Gohan" / "Son Gohan : Adolescence"),
    // ma non se il prodotto ha il nome di un'altra carta del set ("Kale" non è "SS Kale, Universe 6 Combination").
    if (wa.every((w) => sb.has(w))) return !names?.has(b);
    // Le stesse parole tranne una scritta in un altro modo ("Calculated" / "Calculating"): stesse prime 5 lettere.
    if (wa.length === wb.length && wa.length >= 2) {
      const diff = wa.filter((w, i) => w !== wb[i]);
      return diff.length === 1 && wa.every((w, i) => w === wb[i] || (w.length >= 5 && wb[i].slice(0, 5) === w.slice(0, 5)));
    }
    return false;
  });
}

/** Nome TCGplayer con le parentesi che non sono il numero né la stampa ("Gloriosa (Grandma Nyon)" -> "gloriosa grandma nyon"). */
function tpFullName(name) {
  const kept = String(name).replace(/\(([^)]*)\)/g, (m, inner) => (/^\s*\d+\s*$/.test(inner) || norm(inner).split(" ").some((w) => STAMPA.has(w)) ? " " : ` ${inner} `));
  return norm(kept.replace(/\s[-–]\s*[A-Z]+\d*-\d+\s*$/i, " "));
}

/**
 * One Piece (A7): le parole del prodotto che dicono una stampa particolare ("Manga", "Super", "Parallel", "Pre-Release") solo
 * se la stampa del catalogo le ha (Shanks OP01-120a Alternate Art era collegata a "Shanks (Parallel) (Manga) (Alternate Art)"
 * da 3.645 $, Luffy OP13-118a a "(Super Alternate Art)", Zoro OP07-034 Pre-Release Stamp a "Roronoa Zoro (Reprint)").
 * "Parallel" su TCGplayer è l'alternate art: vale per le carte con "Alternate"/"Parallel" o la lettera dopo il numero.
 */
export function onePieceExtraOk(card, c) {
  const v = norm(`${card.r || ""} ${card.v || ""}`);
  const mine = ctExtra(card);
  const extra = c.extra || tpExtra(c.name);
  if (extra.has("manga") && !/\bmanga\b/.test(v)) return false;
  const said = norm([...String(c.name).matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" "));
  // "Super Rare Alternate Art" è l'alternate art di una Super Rare; "Super Alternate Art" / "Super Leader" un'altra stampa.
  if (!/\bsuper rare\b/.test(said) && extra.has("super") && !/\bsuper (alternate|parallel|leader|alt)\b/.test(v)) return false;
  // "Parallel" su TCGplayer è l'alternate art (anche "Full Art" e le stampe con la lettera dopo il numero, ST30-007a).
  if (extra.has("parallel") && !(mine.has("parallel") || mine.has("alternate") || mine.has("full") || /^[A-Z]+\d*-\d+[a-z]$/i.test(card.num || ""))) return false;
  if (extra.has("pre") && extra.has("release") && !/\bpre ?release\b/.test(v)) return false;
  if (/\bpre ?release\b/.test(v) && !(extra.has("pre") || extra.has("prerelease"))) return false;
  // "(SP)" su TCGplayer è la Special (controllo finale del 19 novembre 2026: le «Super Pre-Release Stamp» ST02-007p, ST03-004p,
  // ST04-005p erano collegate a "(SP)" da 34-157 $ con la carta a 1-3 €).
  // Le SP che CardTrader chiama "Alternate Art" con il numero senza lettera (Sakazuki OP02-099 "Alternate Art" = "Sakazuki (SP)"),
  // o con un'altra parola in comune ("WANTED" / "(SP) (Wanted Poster)") valgono.
  if (extra.has("sp") && !/\b(sp|special)\b/.test(v)) {
    const plainNumber = /^[A-Z]+\d*-\d+$/i.test(card.num || "");
    const shared = [...extra].some((w) => w !== "sp" && w.length > 2 && !EXTRA_GENERIC.has(w) && v.split(" ").includes(w));
    if (!(/\balternate\b/.test(v) && (plainNumber || shared))) return false;
  }
  return true;
}

// Parole tra parentesi del prodotto che non dicono un'altra stampa: l'alternate art ("Parallel", "Alternate Art", "Full Art"),
// la finitura e i colori delle carte Dragon Ball ("Son Gohan (Green)" è la BT11-076, un numero solo).
const EXTRA_GENERIC = new Set(["alternate", "art", "parallel", "full", "foil", "holo", "holofoil", "version", "ver", "vol", "the", "of", "and", "a",
  "red", "blue", "green", "yellow", "black", "white", "multicolor", "sp", "super", "rare"]);

/**
 * One Piece e Dragon Ball (controllo finale del 19 novembre 2026): le parole tra parentesi del prodotto TCGplayer (tolte quelle
 * di [EXTRA_GENERIC] e i codici con cifre, "OP11", "ST15") devono avere a che fare con la carta:
 * - una carta senza versione, che non sia una promo, non prende il prodotto di un'edizione speciale (Who's.Who ST04-010 a
 *   0,13 € -> "(CS 2023 Celebration Pack)" 11 $; Boa Hancock ST03-013 -> "(Premium Card Collection -Best Selection Vol. 2-)");
 * - una carta con la versione la deve avere in comune almeno con una parola (Lucky.Roux OP09-015tr "Treasure Rare" ->
 *   "(Reprint)"; Boa Hancock OP07-051 "Alternate Art" -> "(Seven Warlords of the Sea Binder Set) (Alternate Art)"; Dragon Ball
 *   BT7-113 Super Rare -> "(SPR)", la Special Rare).
 */
export function extraSaid(card, c, setName = "") {
  const words = (x) => norm(x).split(" ").filter((w) => w.length >= 2 && !/\d/.test(w) && !EXTRA_GENERIC.has(w)).map(singular);
  const extra = [...new Set(words([...String(c.name).matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ")))];
  if (!extra.length) return true;
  // Quello che la carta dice: versione, nome (le parentesi del nome: "Mr.1 (Daz.Bonez)"), rarità con le sigle di TCGplayer
  // ("(SPR)" è la Special Rare) e set.
  const r = norm(card.r || "");
  const abbr = Object.entries(RARITY_ABBR).filter(([k]) => r.includes(k)).map(([, a]) => a);
  const mine = new Set([...words(`${card.v || ""} ${card.n || ""} ${card.r || ""} ${setName}`), ...abbr]);
  // Alternate art della carta e del prodotto: le parole in più sono il nome della serie di alternate art ("Pandaman Art",
  // "Bonus Pack Alternate Art", "Super Rare Alternate Art"); tra più prodotti decide la regola delle stampe di matchTp.
  const tpAlt = /\b(alternate|parallel|alt|art)\b/.test(norm(String(c.name)));
  if (tpAlt && (/\b(alternate|parallel|full)\b/.test(norm(`${card.r || ""} ${card.v || ""}`)) || /^[A-Z]+\d*-\d+[a-z]$/i.test(card.num || ""))) return true;
  // Senza versione (o solo "Promo"): una carta del set non prende un'edizione speciale; una promo sì (il numero è suo).
  if (!words(card.v || "").filter((w) => w !== "promo").length) {
    return /\bpromo\b/.test(r) || /^P-/i.test(card.num || "") || extra.every((w) => mine.has(w));
  }
  return extra.some((w) => mine.has(w));
}

/** Sigle delle rarità nei nomi dei prodotti TCGplayer ("Son Gohan & Son Goten, Familial Bonds (SPR)"). */
const RARITY_ABBR = { "special rare": "spr", "secret rare": "scr", "super rare": "sr", "starter rare": "str", "god rare": "gdr", "special": "sp", "feature rare": "dbr" };

/**
 * Yu-Gi-Oh! (controllo finale): le ristampe "©2020" non prendono il prodotto dell'originale (Dark Magician RP01-003 ©2020 a
 * 9,86 € collegata a "Dark Magician" RP01-EN003 da 149,99 $: il prodotto passa alla ©1996), e "1st Edition Artwork" /
 * "Reprint Artwork" nel prodotto solo se la versione della carta lo dice (Dark Paladin MFC-105 era collegata a
 * "(1st Edition Artwork)").
 */
export function yugiohExtraOk(card, c, originals = null, siblings = null) {
  const v = norm(`${card.r || ""} ${card.v || ""}`);
  const extra = norm([...String(c.name).matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" "));
  // Solo se nello stesso set c'è anche l'originale ©1996 con lo stesso numero (RP01): le ristampe in un set loro (LOB25,
  // LC25) hanno su TCGplayer un gruppo loro.
  if (/©\s*20[12]\d/.test(card.v || "") && originals?.has(`${card.s}|${card.num}`) && !/\b(reprint|20[12]\d)\b/.test(extra)) return false;
  // Solo se nel set c'è anche un'altra stampa con lo stesso numero (MFC-105 e MFC-105a: quale è l'artwork non si sa).
  if (/\bartwork\b/.test(extra) && !/\bartwork\b/.test(v) && siblings?.has(`${card.s}|${String(card.num || "").replace(/[a-z]+$/, "")}`)) return false;
  return true;
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
/**
 * Parole di stampa che il nome del prodotto TCGplayer deve dire se la carta CardTrader le ha nella rarità o nella versione
 * (verifica del 18 novembre 2026: le 93 Special Rare One Piece erano collegate alla carta base, le Manga Panel all'Alternate
 * Art normale, le Pre-Errata e i segnalini Gold/Silver alla stessa carta). Per ognuna, le parole del prodotto che valgono.
 */
const MUST_SAY = [
  [/\bspecial rare\b/, ["sp", "special"]],
  [/\bmanga\b/, ["manga"]],
  [/\berrata\b/, ["errata"]],
  [/\bgold\b/, ["gold"]],
  [/\bsilver\b/, ["silver"]],
  [/\bwanted\b/, ["wanted"]],
  [/\banniversary\b/, ["anniversary"]],
  // Controllo finale del 19 novembre 2026: le stampe dei premi prendevano il prodotto della promo normale (Luffy P-061w
  // "Winner" 148 € -> "Monkey.D.Luffy (P-061)" 1,21 $; Lim P-079 "Championship 25-26" -> "Lim" 0,28 $). Valgono anche le
  // parole del gruppo TCGplayer ("Championship Promos").
  [/\bwinner\b/, ["winner"]],
  [/\bjudge\b/, ["judge"]],
  [/\bchampionship\b/, ["championship", "champion", "cs"]],
  [/\bprize\b/, ["prize"]],
  [/\bserial\b/, ["serial"]],
  [/\bsigned\b/, ["signed", "signature"]],
];

/** true se il prodotto [c] dice tutte le stampe particolari della carta ([MUST_SAY]). */
export function saysPrint(card, c) {
  const words = norm(`${card.r || ""} ${card.v || ""}`);
  // Le parole di tutto il nome del prodotto (anche tra quadre: "Monkey.D.Luffy - ST01-001 [Serial Number]") e del gruppo.
  const extra = new Set([...(c.extra || tpExtra(c.name)), ...norm(c.name).split(" "), ...norm(c.groupName || "").split(" ")]);
  return MUST_SAY.every(([re, ok]) => !re.test(words) || ok.some((w) => extra.has(w)));
}

export function matchTp(game, card, index, setName = "", names = null) {
  const tp = matchTpRaw(game, card, index, setName, names);
  if (!tp) return null;
  const c = productsById(index).get(tp[0]);
  // Yu-Gi-Oh!: "Gold Rare", "Premium Gold Rare" sono rarità (decide già rarityKey), non stampe da leggere nel nome.
  if (game === "yugioh") return !c || (sameYugiohCard(card, c, otherNames(names, card)) && yugiohExtraOk(card, c, names?.originals, names?.siblings)) ? tp : null;
  return !c || saysPrint(card, c) ? tp : null;
}

/**
 * I nomi delle altre carte dello stesso set di [card] (un prodotto col nome di un'altra carta del set è quella carta). [names]:
 * set -> nomi. Solo lo stesso set: CardTrader scrive a volte la stessa carta in due modi in set diversi.
 */
function otherNames(names, card) {
  const inSet = names?.get(card.s);
  if (!inSet) return null;
  const own = norm(card.n);
  return { has: (n) => n !== own && inSet.has(n) };
}

const byIdCache = new WeakMap();
/** I prodotti dell'indice per id (calcolati una volta per indice). */
function productsById(index) {
  let m = byIdCache.get(index);
  if (!m) {
    m = new Map();
    for (const list of index.values()) for (const c of list) m.set(c.id, c);
    byIdCache.set(index, m);
  }
  return m;
}

function matchTpRaw(game, card, index, setName = "", names = null) {
  const key = numberKey(game, card.num);
  let cands = game === "yugioh" ? yugiohCandidates(card, index, setName) : key ? index.get(key) : null;
  if (!cands?.length) return null;
  if (game === "yugioh" && cands.length === 1) return sameYugiohCard(card, cands[0], otherNames(names, card)) ? [cands[0].id, cands[0].group] : null;
  if (game !== "yugioh" && game !== "lorcana") {
    const others = otherNames(names, card);
    cands = cands.filter((c) => sameCardName(card, c, others) && (game !== "onepiece" || onePieceExtraOk(card, c)) && extraSaid(card, c, setName));
    if (!cands.length) return null;
  }
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
export async function addTcgplayerIds(game, data, { fetchJson = json, categories = TP_CATEGORIES[game] || [], log = [], sealed = null, market = true } = {}) {
  const groups = [];
  const products = new Map();
  // Prezzo di mercato TCGplayer (vendite recenti) di ogni prodotto, unlimited e 1ª edizione (campo `tm`): per il tetto di
  // Yu-Gi-Oh! (regola 3) e, per tutti i giochi, per il controllo dei prezzi da 1-2 offerte nell'app (punto 4 della riverifica,
  // 19 novembre 2026; prima solo Yu-Gi-Oh!).
  const prices = new Map();
  for (const cat of categories) {
    const gs = (await fetchJson(`${TCGCSV}/${cat}/groups`))?.results || [];
    for (const g of gs) {
      try {
        products.set(g.groupId, (await fetchJson(`${TCGCSV}/${cat}/${g.groupId}/products`))?.results || []);
        groups.push(g);
      } catch (err) {
        log.push(`! TCGplayer ${game}, gruppo ${g.name}: ${err.message}`);
        continue;
      }
      if (!market) continue;
      try {
        addMarketPrices(prices, (await fetchJson(`${TCGCSV}/${cat}/${g.groupId}/prices`))?.results || []);
      } catch (err) {
        log.push(`! TCGplayer ${game}, prezzi del gruppo ${g.name}: ${err.message}`);
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
  const names = new Map();
  for (const c of data.cards || []) (names.get(c.s) || names.set(c.s, new Set()).get(c.s)).add(norm(c.n));
  // Yu-Gi-Oh!: le carte "©1996" per set e numero (yugiohExtraOk: la ristampa ©2020 dello stesso set non prende il loro prodotto).
  names.originals = new Set((data.cards || []).filter((c) => /©\s*199\d/.test(c.v || "")).map((c) => `${c.s}|${c.num}`));
  names.siblings = new Set((data.cards || []).filter((c) => /[a-z]+$/.test(c.num || "")).map((c) => `${c.s}|${c.num.replace(/[a-z]+$/, "")}`));
  const links = new Map((data.cards || []).map((c) => [c, matchTp(game, c, index, setNames.get(c.s) || "", names)]));
  const kept = uniqueLinks(links, index, setNames, log, game);
  let n = 0;
  for (const c of data.cards || []) {
    const tp = kept.get(c);
    if (tp) {
      c.tp = tp;
      n++;
    } else {
      delete c.tp;
    }
    const tm = tp && market ? marketOf(prices.get(tp[0])) : null;
    if (tm) c.tm = tm;
    else delete c.tm;
  }
  if (market) log.push(`${game}: ${(data.cards || []).filter((c) => c.tm).length} carte col prezzo di mercato TCGplayer (${prices.skipped || 0} prezzi di mercato scartati: sotto un terzo dell'inserzione più economica)`);
  log.push(`${game}: ${n} carte su ${(data.cards || []).length} con il prodotto TCGplayer (${groups.length} gruppi)`);
  return n;
}

/** Parole della rarità che dicono un'altra cosa dalla carta normale (le altre rarità non contano: "Common", "Rare"...). */
const KIND = new Set(["promo", "oversized"]);
const singular = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Quante parole della versione della carta (e "promo"/"oversized" della rarità) il nome del prodotto e del gruppo non dicono. */
function printScore(card, p) {
  const said = new Set(norm(`${p.name} ${p.groupName || ""}`).split(" ").map(singular));
  const words = norm(card.v || "").split(" ").filter((w) => w && !/^\d+$/.test(w));
  for (const w of norm(card.r || "").split(" ")) if (KIND.has(w)) words.push(w);
  return words.map(singular).filter((w) => !said.has(w)).length;
}

/** Il set CardTrader è quello del gruppo TCGplayer ("OP-02: Paramount War" ~ "Paramount War"). */
function sameSet(setName, groupName) {
  const a = norm(setName), b = norm(groupName);
  return Boolean(a && b) && (groupKey(setName) === groupKey(groupName) || a.includes(b) || b.includes(a));
}

/**
 * Un prodotto TCGplayer per una carta sola (verifica del 18 novembre 2026: 2.000 prodotti dati a più carte, con grafici e
 * variazioni di un'altra stampa: la promo e la carta del set, l'Oversized e la carta normale, la ristampa e l'originale).
 * Tra le carte che hanno lo stesso prodotto lo tiene quella con meno parole di stampa che il prodotto non dice
 * ([printScore]); a parità quella del set del gruppo TCGplayer; se ne resta più d'una, nessuna. Le carte identiche (stesso
 * nome, numero, rarità, versione e set: CardTrader a volte ha la stessa carta due volte) contano come una e lo tengono tutte.
 */
export function uniqueLinks(links, index, setNames, log = [], game = "") {
  const byProduct = new Map();
  for (const [card, tp] of links) if (tp) (byProduct.get(tp[0]) || byProduct.set(tp[0], []).get(tp[0])).push(card);
  const products = productsById(index);
  const out = new Map(links);
  let dropped = 0;
  for (const [id, cards] of byProduct) {
    if (cards.length < 2) continue;
    const p = products.get(id);
    const same = (c) => [c.n, c.num, c.r, c.v, c.s].join("|");
    const byKey = new Map();
    for (const c of cards) (byKey.get(same(c)) || byKey.set(same(c), []).get(same(c))).push(c);
    const groups = [...byKey.values()];
    if (groups.length < 2 || !p) continue;
    // In ordine: stesso nome del prodotto, stessa rarità (Yu-Gi-Oh!: Secret, Gold e Ultra Rare con lo stesso numero), meno
    // parole di stampa non dette, lo stesso set del gruppo (prima il nome uguale: "Rise of the Duelist" e non "… OCG"), poi
    // il set contenuto nel nome del gruppo.
    const narrow = (list, keep) => {
      const ok = list.filter(keep);
      return ok.length ? ok : list;
    };
    let best = narrow(groups, (g) => tpBaseName(p.name) === norm(g[0].n));
    if (game === "yugioh" && p.rarity) best = narrow(best, (g) => rarityKey(g[0].r || g[0].v) === p.rarity);
    const min = Math.min(...best.map((g) => printScore(g[0], p)));
    best = best.filter((g) => printScore(g[0], p) === min);
    best = narrow(best, (g) => groupKey(setNames.get(g[0].s) || "") === groupKey(p.groupName));
    best = narrow(best, (g) => sameSet(setNames.get(g[0].s) || "", p.groupName));
    const keep = new Set(best.length === 1 ? best[0] : []);
    for (const c of cards) if (!keep.has(c)) { out.set(c, null); dropped++; }
  }
  if (dropped) log.push(`${game}: ${dropped} carte senza prodotto TCGplayer perché lo stesso prodotto era di un'altra carta`);
  return out;
}

/**
 * Un prezzo di mercato vale solo se l'inserzione più economica non costa più di [MARKET_LOW_RATIO] volte tanto. Misurato sui
 * prezzi tcgcsv del 19 novembre 2026 (Yu-Gi-Oh!): con la metà si scartavano anche 183 prezzi veri di carte da pochi centesimi
 * (mercato 0,10 $, la più economica 0,25 $ per il prezzo minimo dei venditori); con un decimo restavano mercati fermi da
 * anni (Icarus Attack DR04-235 unlimited: 259,99 $ contro 1.569 $ in vendita); un terzo scarta 284 versioni di prodotto.
 */
const MARKET_LOW_RATIO = 3;

/**
 * Prezzi di mercato TCGplayer (vendite recenti, `marketPrice`) di una risposta `/prices` di tcgcsv, per prodotto: `u`
 * unlimited (anche "Limited" se manca l'unlimited), `f` 1ª edizione, in dollari.
 */
export function addMarketPrices(prices, results) {
  for (const r of results) {
    const v = Number(r.marketPrice);
    if (!r.productId || !(v > 0)) continue;
    // A2 della riverifica (19 novembre 2026, approvato dall'utente): un prezzo di mercato sotto un terzo dell'inserzione più
    // economica non è una vendita vera (Winged Kuriboh TLM-005 Ultimate Rare unlimited: mercato 0,49 $, la più economica in
    // vendita 89,93 $; il tetto della regola 3 la portava da 176,58 € a 0,67 €). Non è un limite sul valore: senza un prezzo
    // di mercato credibile la carta resta senza tetto.
    const low = Number(r.lowPrice);
    if (low > 0 && v * MARKET_LOW_RATIO < low) {
      prices.skipped = (prices.skipped || 0) + 1;
      continue;
    }
    const kind = /1st/i.test(r.subTypeName || "") ? "f" : /limited/i.test(r.subTypeName || "") ? "l" : "u";
    (prices.get(r.productId) || prices.set(r.productId, {}).get(r.productId))[kind] = v;
  }
  return prices;
}

/** Il campo `tm` di una carta: [unlimited, 1ª edizione] in dollari (0 dove manca), o null senza prezzi. */
export function marketOf(p) {
  if (!p) return null;
  const u = p.u ?? p.l ?? 0;
  const f = p.f ?? 0;
  return u || f ? [Math.round(u * 100) / 100, Math.round(f * 100) / 100] : null;
}
