// Regole dei prezzi delle «carte libere» Topps, senza nulla di Node: quando un titolo di eBay è la carta scritta dall'utente e
// che prezzo ne esce. Le usano il job della notte (topps-libere.js) e il servizio Supabase "topps-price" (prezzo immediato,
// 26 novembre 2026: supabase/functions/topps-price/regole.js è questo file impacchettato da scripts/pacchetto-topps-price.sh).
import { Ebay, isBundle } from "./ebay.js";
import { round2 } from "./stats.js";
import { nameLike } from "./somiglianza.js";
import { gradeOf, priceOf, NOT_A_CARD, WORN } from "./topps-regole.js";

export { Ebay };

/** Mercati eBay della ricerca e la loro valuta. */
export const MARKETS = { GB: ["EBAY_GB", "GBP"], US: ["EBAY_US", "USD"] };
/** Cambi di riserva (unità di valuta per un euro) quando la BCE non risponde. */
export const RATES_FALLBACK = { EUR: 1, USD: 1.1, GBP: 0.86 };
/** Lunghezza massima dei testi scritti dall'utente (il resto si taglia) e carte lette al massimo. */
export const MAX_TEXT = { set: 80, name: 80, num: 16, ver: 60 };

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2019']/g, "");

/** Modi diversi di scrivere la stessa cosa nei titoli: "Formula 1" = "F1", "Champions League" = "UCL" = "UCC". */
const SAME = [
  [/\bformula\s?(1|one)\b/g, "f1"],
  [/\b(uefa\s)?(champions league|club competitions?)\b|\bucc\b|\bcl\b/g, "ucl"],
  [/\bgarbage pail kids?\b/g, "gpk"],
  [/\bmatch\s?attax\b/g, "matchattax"],
  [/\bstar\s?wars\b/g, "starwars"],
  [/\bpremier league\b|\bepl\b/g, "premierleague"],
  [/\bseries\b|\bserie\b|\bser\.\s?/g, "series "],
  // Squadre con un colore nel nome: il colore lì non è una versione della carta.
  [/\bred\s?bull\b/g, "redbull"], [/\bred\ssox\b/g, "redsox"], [/\bwhite\ssox\b/g, "whitesox"], [/\bblue\sjays\b/g, "bluejays"],
  [/\bgreen\sbay\b/g, "greenbay"], [/\bred\swings\b/g, "redwings"], [/\bblue\sjackets\b/g, "bluejackets"], [/\bgolden\sstate\b/g, "goldenstate"],
];
function plain(text) {
  let t = norm(text);
  for (const [re, to] of SAME) t = t.replace(re, to);
  return t;
}

/** Parole del set che nei titoli spesso mancano: non si pretendono. */
const SET_OPTIONAL = new Set(["topps", "the", "of", "and", "edition", "card", "cards", "trading", "official", "season", "stagione", "uefa", "soccer", "football", "calcio", "tcg", "collection", "set", "base"]);

/**
 * Altre linee di prodotti Topps: una di queste parole nel titolo e non nella carta dell'utente = un altro set ("Chrome
 * Sapphire" non è "Chrome", "Match Attax Extra" non è "Match Attax", "Update" non è la serie base).
 */
const OTHER_LINES = [
  "sapphire", "extra", "update", "finest", "bowman", "heritage", "merlin", "museum", "dynasty", "platinum", "mini", "sticker", "stickers",
  "japan", "inception", "chrome", "stadium club", "gold label", "turbo attax", "slam attax", "hero attax", "topps now", "tier one",
  "allen ginter", "gypsy queen", "big league", "opening day", "archives", "tribute", "five star", "triple threads", "transcendent",
  "definitive", "luminaries", "lights out", "paddock pass", "eccellenza", "deco", "pearl", "carnaval", "simplicidad", "motif",
  "knockout", "superstars", "jade", "cosmic", "logofractor", "living set", "project 70", "project 2020", "on demand", "tiffany", "traded",
  "o pee chee", "opc", "panini", "upper deck", "donruss", "fleer", "score", "leaf", "futera", "adrenalyn",
];

/** Versioni parallele, autografi e carte numerate: una carta senza versione non le vuole nel titolo. */
const PARALLEL = new RegExp(
  "\\b(refractors?|parallels?|prizm|prism|wave|shimmer|speckle|superfractor|mojo|x-?fractor|atomic|pulsar|lava|checker(ed)?\\s?flag|" +
    "variations?|ssp|sp|short print|autos?|autograph\\w*|signed|signature|relics?|patch|memorabilia|foil|holo\\w*|numbered|limited edition|" +
    "printing plate|error|misprint|one of one|gold|silver|bronze|orange|purple|pink|aqua|teal|rainbow|sepia|negative|diamond|sparkle|" +
    "raywave|ray wave|mini diamonds?|black\\s(border|edge|refractor)|red\\s(border|edge|refractor|parallel)|" +
    "blue\\s(border|edge|refractor|parallel)|green\\s(border|edge|refractor|parallel))\\b|/\\s?\\d{1,4}\\b|\\b\\d{1,4}\\s?/\\s?\\d{1,4}\\b|\\b1\\s?of\\s?1\\b",
);

/**
 * Anni e stagioni scritti nel testo: "2024/25", "2024-25", "24/25", "2023". Rende gli anni (interi) e il testo senza di loro.
 * Una stagione corta vale solo se il secondo numero è il primo più uno ("24/25" sì, "43/75" è una carta numerata).
 * [spans] = primo anno di ogni stagione, [singles] = gli anni scritti da soli.
 */
export function sameSeason(want, title) {
  if (!want.years.length) return true;
  // La carta è di una stagione ("2023-24"): il titolo deve dire quella; se non dice stagioni, uno dei suoi due anni.
  if (want.spans.length) {
    if (title.spans.length) return want.spans.some((y) => title.spans.includes(y));
    return want.years.some((y) => title.singles.includes(y));
  }
  // La carta è di un anno ("2023"): quell'anno da solo, o una stagione che lo contiene.
  return want.singles.some((y) => title.years.includes(y));
}

/**
 * Vedi [sameSeason].
 */
export function seasons(text) {
  const years = new Set();
  const spans = [];
  let rest = ` ${text} `;
  rest = rest.replace(/\b((?:19|20)\d\d)\s?[/-]\s?((?:19|20)?\d\d)\b/g, (m, a, b) => {
    const y1 = Number(a);
    const y2 = b.length === 4 ? Number(b) : Math.floor(y1 / 100) * 100 + Number(b);
    if (y2 !== y1 + 1) return m;
    years.add(y1); years.add(y2); spans.push(y1);
    return " ";
  });
  rest = rest.replace(/(^|[^0-9/#-])(\d\d)\s?[/-]\s?(\d\d)(?![0-9/-])/g, (m, pre, a, b) => {
    const y1 = Number(a), y2 = Number(b);
    if (y2 !== (y1 + 1) % 100) return m;
    const century = y1 >= 70 ? 1900 : 2000;
    years.add(century + y1); years.add(century + y1 + 1); spans.push(century + y1);
    return `${pre} `;
  });
  const singles = [];
  rest = rest.replace(/\b((?:19|20)\d\d)\b/g, (m, a) => { years.add(Number(a)); singles.push(Number(a)); return " "; });
  return { years: [...years], spans, singles, rest: rest.replace(/\s+/g, " ").trim() };
}

const tokens = (text) => text.split(/[^a-z0-9]+/).filter(Boolean);

/** Il numero della carta nel titolo: "#339", "339", "No. 339", "US175", "TF-9", "8a"; mai dentro "44/75" o "1 of 10". */
export function numberIn(title, number) {
  const n = norm(number).replace(/[^a-z0-9]+/g, "");
  if (!n) return true;
  const parts = n.match(/[a-z]+|\d+/g) ?? [];
  const body = parts.map((p) => (/^\d+$/.test(p) ? `0*${Number(p)}` : p)).join("\\s?[-.]?\\s?#?");
  const numeric = parts.length === 1 && /^\d+$/.test(parts[0]);
  const after = numeric ? "(?![a-z0-9]|\\s?/\\s?\\d|\\s?of\\s\\d)" : "(?![a-z0-9])";
  return new RegExp(`(^|[^a-z0-9/])${body}${after}`).test(norm(title).replace(/\bno\.?\s?(?=\d)/g, "#"));
}

/** Voti delle gradate e «Series 1»: numeri del titolo che non sono il numero della carta. */
const NOT_THE_NUMBER = /\b(psa|bgs|cgc|sgc|beckett|ace|tag|mgc|gem\s?mt|gem\smint|mint|grade[d]?)\s*-?\s*\d{1,2}([.,]5)?\b|\bseries\s+\d+\b|\b(vol|volume|part|wave)\.?\s?\d+\b/g;

const compactNumber = (x) => norm(x).replace(/[^a-z0-9]+/g, "").replace(/(^|[a-z])0+(?=\d)/g, "$1");

/**
 * Il numero della carta nel titolo, guardando tutto il titolo (revisione del 26 novembre 2026): un voto ("PSA 10") o una serie
 * ("Series 1") non sono il numero; se il titolo scrive un numero col cancelletto ("#339", "No. 339") vale solo quello (la
 * carta 10 non è la "#339 PSA 10"); un numero scritto con la barra ("12/99") si cerca con la barra.
 */
export function numberOk(title, number) {
  const raw = String(number ?? "").trim();
  if (!compactNumber(raw)) return true;
  const t = norm(title).replace(/\bno\.?\s?(?=\d)/g, "#").replace(NOT_THE_NUMBER, " ");
  const slash = raw.match(/^#?\s*(\d{1,4})\s*\/\s*(\d{1,4})$/);
  if (slash) return new RegExp(`(^|[^0-9])0*${Number(slash[1])}\\s?/\\s?0*${Number(slash[2])}(?![0-9])`).test(t);
  const tagged = [...t.matchAll(/#\s?([a-z]{0,5}\s?-?\s?\d+[a-z]?)(?![a-z0-9]|\s?\/\s?\d)/g)].map((m) => compactNumber(m[1]));
  if (tagged.length) return tagged.includes(compactNumber(raw));
  return numberIn(t, raw);
}

/**
 * Cosa deve avere un titolo per essere la carta: parole del set, anni, numero, nome, versione. [def] = { set, num, name, ver }.
 */
export function wantsOf(def) {
  const setText = plain(def.set);
  const season = seasons(setText);
  const { rest } = season;
  const ver = plain(def.ver ?? "");
  const own = ` ${plain(`${def.set} ${def.ver ?? ""} ${def.name}`)} `;
  return {
    season,
    own,
    setWords: tokens(rest).filter((w) => !SET_OPTIONAL.has(w)),
    num: String(def.num ?? "").trim(),
    name: String(def.name ?? "").trim(),
    verWords: tokens(seasons(ver.replace(/\/\s?\d{1,4}\b/g, " ")).rest),
    verSerial: (ver.match(/\/\s?\d{1,4}\b/g) ?? []).map((s) => s.replace(/\s/g, "")),
    // Le Garbage Pail Kids sono adesivi: lì "sticker" non dice un altro prodotto.
    otherLines: OTHER_LINES.filter((w) => !new RegExp(`\\b${w}\\b`).test(own) && !(/\bgpk\b/.test(own) && w.startsWith("sticker"))),
  };
}

/** Colori delle versioni parallele: con una versione scritta, un colore in più nel titolo è un'altra versione. */
const COLORS = ["gold", "orange", "purple", "pink", "red", "blue", "green", "black", "aqua", "teal", "yellow", "bronze", "silver", "rose", "white"];

/** Perché il titolo non è la carta (null = lo è). Meglio nessuna inserzione che quelle di un'altra carta. */
export function reject(title, want) {
  const t = plain(title);
  if (NOT_A_CARD.test(t) || isBundle(title, `${want.name} ${want.setWords.join(" ")}`)) return "non è una carta sola";
  const s = seasons(t);
  // Gli anni: quelli della carta devono esserci; un titolo senza anni non si sa di che stagione è.
  if (!sameSeason(want.season, s)) return "anno";
  const words = new Set(tokens(s.rest));
  if (!want.setWords.every((w) => words.has(w))) return "set";
  if (want.otherLines.some((w) => new RegExp(`\\b${w}\\b`).test(t))) return "altra linea";
  if (!numberOk(s.rest, want.num)) return "numero";
  if (!nameLike(title, want.name)) return "nome";
  if (want.verWords.length || want.verSerial.length) {
    if (!want.verWords.every((w) => words.has(w))) return "versione";
    const compact = s.rest.replace(/\s/g, "");
    if (!want.verSerial.every((x) => compact.includes(x))) return "numerazione";
    // Una versione senza numerazione non è una carta numerata, e un colore in più è un'altra versione.
    if (!want.verSerial.length && /\/\s?\d{1,4}\b/.test(s.rest)) return "numerata";
    if (COLORS.some((c) => words.has(c) && !new RegExp(`\\b${c}\\b`).test(want.own))) return "colore";
  } else if (!want.num.includes("/")) {
    // Senza versione: la carta base. Via le parole delle parallele che non stanno già nel nome o nel set della carta.
    const base = s.rest.replace(new RegExp(`\\b(${[...tokens(plain(want.name)), ...want.setWords].join("|") || "_"})\\b`, "g"), " ");
    if (PARALLEL.test(base)) return "parallela";
  }
  return null;
}

export const matches = (title, want) => reject(title, want) === null;

/** Le parole della ricerca: set, nome, numero, versione, senza segni. */
export function queryOf(def) {
  return `${def.set} ${def.name} ${def.num ?? ""} ${def.ver ?? ""}`.replace(/[()"!?:#*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Le inserzioni della carta divise per secchio: { e: [prezzi in euro delle non gradate], "g:PSA 9": [...], img }. [rates] =
 * unità di valuta per un euro.
 */
export function split(items, def, rates, into = {}) {
  const want = wantsOf(def);
  for (const i of items) {
    const title = i.title ?? "";
    if (!matches(title, want)) continue;
    const rate = rates[i.currency];
    const eur = rate ? i.price / rate : null;
    if (!(eur > 0)) continue;
    const grade = gradeOf(title);
    if (grade === "?") continue;
    if (!grade && WORN.test(norm(title))) continue;
    (into[grade ? `g:${grade}` : "e"] ??= []).push(round2(eur));
    if (!grade && i.image && (!into.img || title.length < into.imgLen)) {
      into.img = i.image;
      into.imgLen = title.length;
    }
  }
  return into;
}

/** Prezzi pubblicati di una carta dai suoi secchi: { e: [prezzo, inserzioni], g: { "PSA 9": [prezzo, inserzioni] }, img }. */
export function priced(buckets) {
  const out = {};
  for (const [b, v] of Object.entries(buckets)) {
    if (b === "img") { out.img = v; continue; }
    if (!Array.isArray(v)) continue;
    const est = priceOf(v);
    if (!est) continue;
    if (b === "e") out.e = est;
    else (out.g ??= {})[b.slice(2)] = est;
  }
  return out.e || out.g ? out : null;
}

/** Cambi BCE: unità di valuta per un euro. */
export function ecbRates(xml) {
  const out = { EUR: 1 };
  for (const m of String(xml).matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) out[m[1]] = Number(m[2]);
  return out.USD > 0 && out.GBP > 0 ? out : null;
}

export const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
