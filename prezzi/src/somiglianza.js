// Confronti per somiglianza dei titoli eBay con i prodotti (20 novembre 2026, dall'utente: "tutte le ricerche che vengono
// fatte devono funzionare anche per similitudine, se cerchi esattamente quello che scrivi non funzionerà mai"). Prima il nome
// doveva comparire identico nel titolo ("Red-Eyes B. Dragon", "Elsa - Snow Queen") e i sigillati dovevano avere tutte le parole
// del nome Cardmarket, comprese quelle tra parentesi: le carte YAP1 dell'utente non trovavano nessuna inserzione.
// Il numero della carta resta un controllo esatto (è lui che dice quale carta è); il nome e le parole del prodotto si
// confrontano per somiglianza: una o due lettere diverse, singolare e plurale, parole attaccate, qualche parola in meno.
// Usato da ebay-prezzi.js (matches, query).

const strip = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** Parole vuote che non dicono il prodotto. */
const STOP = new Set(["the", "of", "and", "a", "an", "di", "del", "della", "e", "il", "la", "le", "lo", "da", "con", "pokemon", "tcg", "card", "cards", "game", "trading"]);

/** Le parole di un testo: minuscole, senza accenti né simboli; "B." = "black" (Red-Eyes B. Dragon), "&" = "and". */
export function words(text) {
  return strip(text)
    .replace(/\bb\.\s*/g, "black ")
    .replace(/&/g, " and ")
    .replace(/['’]s\b/g, "s")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Distanza di modifica (Levenshtein), fermata oltre [max]. */
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Due parole sono la stessa: uguali, singolare/plurale, o una lettera diversa da 5 lettere (due da 8). Le cifre sempre uguali. */
export function sameWord(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return a.replace(/^0+(?=\d)/, "") === b.replace(/^0+(?=\d)/, "");
  const sing = (w) => w.replace(/(es|s)$/, "");
  if (a.length >= 4 && b.length >= 4 && sing(a) === sing(b)) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  const max = n >= 8 ? 2 : 1;
  return distance(a, b, max) <= max;
}

/** La parola [w] c'è nel titolo: una parola simile, o attaccata ad altre ("Pikachuex", "VAPOREON-HOLO"). */
export function hasWord(titleWords, titleCompact, w) {
  if (titleWords.some((t) => sameWord(w, t))) return true;
  return w.length >= 4 && titleCompact.includes(w);
}

/**
 * Il nome di una carta nel titolo, per somiglianza: le sue parole (senza le parole vuote) quasi tutte presenti, la più lunga
 * sempre. Per i nomi con il titolo dopo il trattino (Lorcana "Elsa - Snow Queen") basta la parte prima: eBay.it traduce il
 * resto ("Elsa Regina delle Nevi").
 */
export function nameLike(title, name) {
  const main = String(name ?? "").split(/\s+-\s+/)[0];
  const need = words(main).filter((w) => !STOP.has(w));
  if (!need.length) return false;
  const tw = words(title);
  const tc = tw.join("");
  // Tutto il nome attaccato ("Pikachuex", "Mr.Mime").
  if (tc.includes(need.join(""))) return true;
  const longest = need.reduce((a, b) => (b.length > a.length ? b : a));
  if (!hasWord(tw, tc, longest)) return false;
  const hits = need.filter((w) => hasWord(tw, tc, w)).length;
  return hits >= Math.ceil(need.length * 0.6);
}

/** Parole che dicono il tipo di confezione: non possono mancare (un "Booster Box" non è un "Booster Bundle"). */
const KIND = new Set(["box", "booster", "boosters", "bundle", "etb", "elite", "trainer", "tin", "tins", "deck", "decks", "collection", "blister", "pack", "packs", "case", "display", "starter", "theme", "premium", "chest", "binder", "portfolio", "sleeve", "sleeves", "playmat", "build", "battle", "kit"]);

/**
 * Come eBay.it traduce i titoli (20 novembre 2026, inserzioni vere: "Set Base 2 Grass Chopper Mazzo Tematico", "Scatola di
 * potenziamento Cieli in evoluzione", "Scatola Allenatore Elite"). Prima le frasi di più parole, poi le parole sole.
 */
export const PHRASES = [
  ["elite trainer box", ["scatola allenatore elite", "allenatore elite", "allenatore fuoriclasse", "etb"]],
  ["ultra premium collection", ["collezione ultra premium"]],
  ["premium collection", ["collezione premium"]],
  ["special collection", ["collezione speciale"]],
  ["booster box", ["box di buste", "scatola di buste", "scatola di potenziamento", "box buste", "display"]],
  ["booster bundle", ["bundle di buste", "pacchetto di buste", "confezione di buste"]],
  ["booster pack", ["busta", "bustina", "buste"]],
  ["build battle", ["costruzione e stadio battaglia", "stadio battaglia", "build and battle"]],
  ["theme deck", ["mazzo tematico", "mazzi tema", "mazzo tema", "mazzo a tema", "mazzo precostruito"]],
  ["starter deck", ["mazzo iniziale", "mazzo di partenza"]],
  ["mini tin", ["mini latta", "mini scatola in latta"]],
];
export const WORD_ALTS = {
  tin: ["latta", "scatola in latta"],
  collection: ["collezione"],
  box: ["scatola"],
  deck: ["mazzo", "mazzi"],
  booster: ["buste", "busta", "bustine", "potenziamento"],
  case: ["cassa"],
  display: ["espositore"],
  binder: ["raccoglitore"],
  playmat: ["tappetino"],
  premium: ["premium"],
  special: ["speciale"],
  trainer: ["allenatore"],
};

/**
 * Le parti di un sigillato da cercare nei titoli. Ogni parte ha le sue alternative (la frase inglese e come la traduce eBay.it,
 * il nome del set in inglese e in italiano da [setNamesIt]: "Evolving Skies" = "Cieli in Evoluzione"): [{ alts: [[parole]],
 * kind, num }]. Le parole fuori dalle parentesi (quelle dentro, "(Non-English)", "(Japanese)", di solito i titoli non le
 * scrivono e la lingua la dice il secchio) più i numeri dentro le parentesi ("(18 Boosters)": il mezzo box non è il box intero).
 */
export function sealedNeed(name, setNamesIt = null) {
  const s = String(name ?? "");
  const outside = s.replace(/\([^)]*\)/g, " ");
  const inside = (s.match(/\(([^)]*)\)/g) || []).join(" ");
  let ws = words(outside).filter((w) => !STOP.has(w) && w.length >= 1);
  const parts = [];
  // Il nome del set (il più lungo che c'è nel nome del prodotto), con il nome italiano come alternativa.
  if (setNamesIt) {
    let best = null;
    for (const [en, it] of Object.entries(setNamesIt)) {
      const e = words(en).filter((w) => !STOP.has(w));
      if (e.length && (!best || e.length > best.e.length) && e.every((w) => ws.includes(w))) best = { e, it: words(it).filter((w) => !STOP.has(w)) };
    }
    if (best) {
      parts.push({ alts: [best.e, best.it].filter((a) => a.length), kind: false, num: best.e.some((w) => /\d/.test(w)) });
      ws = ws.filter((w) => !best.e.includes(w));
    }
  }
  // Le frasi del tipo di confezione.
  for (const [en, its] of PHRASES) {
    const e = words(en);
    const i = ws.findIndex((_, k) => e.every((w, j) => ws[k + j] === w));
    if (i < 0) continue;
    parts.push({ alts: [e, ...its.map(words)], kind: true, num: false });
    ws = [...ws.slice(0, i), ...ws.slice(i + e.length)];
  }
  for (const w of [...new Set(ws)]) {
    if (w.length < 2 && !/\d/.test(w)) continue;
    parts.push({ alts: [[w], ...(WORD_ALTS[w] || []).map(words)], kind: KIND.has(w), num: /\d/.test(w) });
  }
  for (const w of words(inside).filter((x) => /^\d+$/.test(x))) parts.push({ alts: [[w]], kind: false, num: true });
  return parts;
}

/**
 * Un sigillato nel titolo, per somiglianza: le parti del tipo di confezione e i numeri sempre (in inglese o come li traduce
 * eBay.it), le altre quasi tutte (ne può mancare una ogni tre: i venditori spesso non scrivono la serie, "151 Ultra Premium
 * Collection" senza "Scarlet & Violet").
 */
export function sealedLike(title, need) {
  if (!need?.length) return false;
  const tw = words(title);
  const tc = tw.join("");
  // Le parole che mancano si contano sulle parole del nome inglese (una frase tradotta conta per le sue parole).
  let missing = 0;
  let total = 0;
  for (const part of need) {
    const alts = Array.isArray(part) ? [[part]] : part.alts;
    total += alts[0].length;
    if (alts.some((a) => a.every((w) => hasWord(tw, tc, w)))) continue;
    const kind = Array.isArray(part) ? KIND.has(part) : part.kind;
    const num = Array.isArray(part) ? /\d/.test(part) : part.num;
    if (kind || num) return false;
    missing += alts[0].length;
  }
  return missing <= Math.floor(total / 3);
}

/** Testo da cercare su eBay da un nome: senza parentesi, virgolette, due punti e simboli (come `MarketLinks.searchName` dell'app). */
export function searchText(name) {
  return String(name ?? "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/["“”«»:·|]/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/[δ☆★♀♂]/g, " ")
    .replace(/\bB\.\s*/g, "Black ")
    .replace(/\s+/g, " ")
    .trim();
}
