// Foto dei prodotti sigillati che nessun catalogo ha (né CardTrader né TCGplayer: Gem Pack cinesi, prodotti giapponesi,
// promo...): la foto di un'inserzione eBay dello stesso prodotto (Browse API ufficiale, chiavi EBAY_APP_ID/EBAY_CERT_ID).
// Richiesto dall'utente il 4 novembre 2026: "tutti i prodotti devono avere un'immagine".
//
// Uso: node prezzi/src/foto-ebay.js <cache.json> <budget> <sealed.json> [<onepiece-sealed.json> ...]
// La cache (prezzi/v1/foto-ebay.json) tiene per ogni prodotto la foto trovata o il giorno dell'ultimo tentativo andato a
// vuoto, così ogni notte si cercano solo i prodotti nuovi e si riprova dopo 30 giorni quelli senza risultato; le foto
// trovate si ricontrollano dopo 180 giorni (le foto di eBay restano anche a inserzione chiusa, ma non per sempre).
// Scrive la foto ("https://i.ebayimg.com/...") nel campo img dei prodotti che non l'hanno.
import fs from "node:fs/promises";
import path from "node:path";
import { Ebay, isBundle } from "./ebay.js";
import { productKind, sameWords, sealedKey } from "./sealed.js";
import { applyKonamiPhotos, findKonamiPhotos, konamiIo } from "./foto-konami.js";

const RETRY_EMPTY_DAYS = 30;
const RECHECK_DAYS = 180;
const STOP = new Set(["the", "of", "and", "pokemon", "tcg", "card", "cards", "game", "trading", "a", "with", "x", "set"]);
// Parole che il titolo può non avere (0.9.160): la lingua (la controlla otherLanguage), l'edizione e la regione non cambiano la
// foto ("30th Celebration JP Booster Box Case" = "... Japanese Booster Box Case", "25th Anniversary Edition Case" = "...
// Anniversary Booster Case").
const OPTIONAL = new Set(["jp", "japanese", "en", "english", "unlimited", "version", "ver", "asia", "region", "legal", "non"]);
const SAME = { display: "box", boosters: "booster", packs: "pack", tins: "tin", decks: "deck", two: "2", three: "3", four: "4" };
// Plurale e singolare uguali ("Collectors Tin" = "Collector's Tins").
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (s) => sealedKey(s).split(" ").map((w) => singular(SAME[w] ?? w)).map((w) => SAME[w] ?? w).filter((w) => w && !STOP.has(w));
/** Parole del titolo, anche unite a due a due ("Pre Release" = "Prerelease"). */
const titleWords = (s) => {
  const ws = sealedKey(s).split(" ").filter(Boolean);
  return new Set([...words(s), ...ws.slice(1).map((w, i) => singular(ws[i] + w))]);
};

/** Ricerca eBay di un prodotto: il nome senza parentesi, con il set davanti se il nome da solo è generico. */
export function photoQuery(name, expansion = "", game = null, lang = null) {
  const base = String(name).replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/[:«»"]/g, " ").replace(/\s+/g, " ").trim();
  // Il set davanti se il nome non lo dice già ("Elite Trainer Box" di Prismatic Evolutions), ma non le espansioni
  // generiche dei cataloghi ("Pokémon Products", "Simplified Chinese Products", "... Promos").
  const exp = String(expansion ?? "").trim();
  const generic = !exp || /\b(products?|promos?|miscellaneous)\b/i.test(exp);
  const withSet = !generic && !sealedKey(base).includes(sealedKey(exp)) ? `${exp} ${base}` : base;
  // Il nome del gioco e la lingua (0.9.160): "Special Anniversary Pack" da solo dava Street Fighter e accendini.
  const g = GAME_QUERY[game] && !GAME_WORDS[game]?.test(withSet) ? `${GAME_QUERY[game]} ` : "";
  const l = LANG_QUERY[String(lang ?? "").split("-")[0]] && !LANG_WORDS[String(lang).split("-")[0]]?.test(withSet) ? ` ${LANG_QUERY[String(lang).split("-")[0]]}` : "";
  return `${g}${withSet}${l}`;
}

/** Seconda ricerca, se la prima non trova il prodotto: il nome senza il set, col gioco e la lingua. */
export function shortQuery(name, game = null, lang = null) {
  return photoQuery(name, "", game, lang);
}

const GAME_QUERY = { sealed: "Pokemon", "onepiece-sealed": "One Piece", "lorcana-sealed": "Lorcana", "dragonball-sealed": "Dragon Ball", "yugioh-sealed": "Yugioh" };
const LANG_QUERY = { ja: "Japanese", ko: "Korean", zh: "Chinese", th: "Thai", id: "Indonesian" };

/**
 * La foto dalla prima inserzione (in ordine di pertinenza eBay) che è proprio quel prodotto: tutte le parole del nome nel
 * titolo, stesso tipo di prodotto (una busta non è un box), niente lotti, niente confezioni vuote se il prodotto non lo è.
 */
/** Il gioco di ogni catalogo, che il titolo dell'inserzione deve nominare (Silver Deck Kit dava staffe di metallo). */
export const GAME_WORDS = {
  sealed: /\b(pokemon|pokémon|pocket monsters?|ポケモン)\b/i,
  "onepiece-sealed": /\bone\s?piece\b/i,
  "lorcana-sealed": /\blorcana\b/i,
  "dragonball-sealed": /\b(dragon\s?ball|dbs|dbscg)\b/i,
  "yugioh-sealed": /\b(yu-?gi-?oh|ygo|konami)\b/i,
};

// Il titolo deve dire che è un prodotto di carte (Pokémon Rumble: Game Box dava il gioco Pinball per Game Boy).
const TCG_HINT = /\b(tcg|ccg|card|cards|carte|karten|cartas|booster|boosters|trading|sealed|sigillat[oai]|display|etb)\b/i;
// Parole della lingua dell'inserzione: un prodotto giapponese non prende la foto di quello coreano e viceversa.
const LANG_WORDS = {
  en: /\b(english|eng)\b/i,
  ja: /\b(japanese|japan|giappones[ei]|jp|jpn)\b/i,
  ko: /\b(korean|korea|corean[oa])\b/i,
  zh: /\b(chinese|china|cines[ei]|s-chinese|t-chinese|simplified|traditional)\b/i,
  th: /\b(thai|thailand)\b/i,
  id: /\b(indonesian|indonesia)\b/i,
};

/** true se il titolo nomina una lingua diversa da quella del prodotto ([lang] null = prodotto occidentale). */
export function otherLanguage(title, lang) {
  // Prodotti occidentali = inglese: un titolo "English" va bene, uno "Japanese" no; un prodotto giapponese non prende la foto
  // di un'inserzione "English" (0.9.160: la case giapponese di Raging Roar prendeva quella inglese).
  const own = lang ? lang.split("-")[0] : "en";
  return Object.entries(LANG_WORDS).some(([l, re]) => l !== own && re.test(title));
}

/**
 * Il nome del prodotto per il confronto: le parentesi che dicono quale prodotto è restano ("(Obelisk the Tormentor)", "(Legendary
 * Collection: 25th Anniversary Edition)", "(2024 Reprint)"), quelle della lingua e dei conteggi no; "1st Edition" non conta
 * (stessa confezione), "1st Anniversary" sì.
 */
const nameForWords = (name) => String(name ?? "")
  .replace(/\(\s*(japanese|korean|ocg|non-english|english version|asia region lega?l?|simplified chinese|traditional chinese|\d+\s*x?\s*(cards?|boosters?|booster boxes|boxes|packs?|bundles?))\s*\)/gi, " ")
  // "Edition" conta quando è il nome ("Duelist Edition Volume 4" non è "Duelist Legacy Volume 4"), non nell'edizione della
  // stampa o dell'anniversario.
  .replace(/\b(1st|first|unlimited) edition\b/gi, " ")
  .replace(/\b(anniversary) edition\b/gi, "$1")
  .replace(/[()[\]]/g, " ");

export function pickPhoto(items, name, gameRe = null, lang = null, { date = null, noFirstEdition = false } = {}) {
  const own = words(nameForWords(name)).filter((w) => !OPTIONAL.has(w));
  // Codice del set davanti al nome ("CSVH1C: Simplified Chinese Happy Card Set"): un'inserzione con un altro codice dello
  // stesso tipo ("CSVH6C") è un altro prodotto.
  const code = String(name ?? "").match(/^([A-Za-z]{2,6})(\d+[A-Za-z]{0,3})\s*:/);
  // Nomi troppo generici per eBay ("Vol. 1 Booster Box", "Expansion Pack Booster", "Promotion Pack", "The Gold Box"): senza una
  // parola che dica quale prodotto è (o con una sola parola corta), la prima inserzione è quasi sempre un'altra cosa (0.9.160:
  // "Vol. 1" dava Dark Revelation Vol. 1, "The Gold Box" il Maximum Gold El Dorado Box).
  const distinct = own.filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
  if (!distinct.length || (distinct.length === 1 && distinct[0].length <= 4)) return null;
  // Prodotti asiatici: il titolo deve dire la lingua ("(Japanese) Booster Box" prendeva il box inglese senza lingua nel titolo).
  const asianLang = lang && lang.split("-")[0] !== "en" ? LANG_WORDS[lang.split("-")[0]] : null;
  // "Booster Box Case" e "Booster Case" sono la stessa cassa: con "case" il "box" non serve.
  // Solo il contenuto, senza scatola ("Deck Pack", "Decks Only"): l'inserzione deve dirlo, se no è il mazzo in scatola; "pack"
  // allora non serve ("Starter Deck Smoker deck only").
  const contentOnly = CONTENT_ONLY.test(name);
  const required = (own.includes("case") ? own.filter((w) => w !== "box" && w !== "booster") : own).filter((w) => !(contentOnly && w === "pack"));
  if (!required.length) return null;
  const kind = productKind(name);
  const empty = /\b(empty|vuot[oa])\b/i.test(name);
  // Anni ammessi nel titolo: quelli del nome e, se si sa, l'uscita del prodotto con l'anno prima e dopo ("Gold Series (Japanese)"
  // del 2008 prendeva la foto della "GOLD SERIES 2014").
  const nameYears = String(name ?? "").match(/\b(19|20)\d{2}\b/g) ?? [];
  const released = Number(String(date ?? "").slice(0, 4));
  const okYear = (y) => nameYears.includes(y) || (released > 1990 && Math.abs(Number(y) - released) <= 1);
  const checkYears = nameYears.length > 0 || released > 1990;
  for (const i of items) {
    if (!i.image) continue;
    if (gameRe && !gameRe.test(i.title)) continue;
    if (!TCG_HINT.test(i.title)) continue;
    if (otherLanguage(i.title, lang)) continue;
    if (asianLang && !asianLang.test(i.title)) continue;
    if (code) {
      const other = (i.title.match(new RegExp(`\\b${code[1]}\\d+[A-Za-z]{0,3}\\b`, "gi")) ?? []).some((t) => t.toLowerCase() !== `${code[1]}${code[2]}`.toLowerCase());
      if (other) continue;
    }
    const t = titleWords(i.title);
    if (!required.every((w) => t.has(w))) continue;
    const tk = productKind(i.title);
    if (kind !== "other" && tk !== kind) continue;
    // Una busta non prende la foto di un'inserzione che parla di box, display, cassa o bundle ("Gem Pack Vol.7 Booster Sealed
    // Box" era per productKind una busta: "booster box" non è attaccato), salvo che lo dica anche il nome del prodotto.
    if (kind === "booster" && /\b(box|boxes|display|case|bundle)\b/i.test(i.title) && !/\b(box|display|case|bundle)\b/i.test(name)) continue;
    if (isBundle(i.title, name)) continue;
    if (!empty && /\b(empty|vuot[oa]|only box|solo scatola)\b/i.test(i.title)) continue;
    if (checkYears && (i.title.match(/\b(19|20)\d{2}\b/g) ?? []).some((y) => !okYear(y))) continue;
    // [noFirstEdition]: le confezioni OCG di Yu-Gi-Oh! non hanno la 1ª edizione, un'inserzione "1st Edition" è il box inglese
    // ("Magic Ruler (Japanese)" prendeva quello inglese). Le buste giapponesi Pokémon dei set vecchi invece sì.
    if (noFirstEdition && /\b(1st|first)\s+ed(ition|\.)?\b/i.test(i.title)) continue;
    if (contentOnly && !CONTENT_ONLY_TITLE.test(i.title)) continue;
    // Non è il prodotto sigillato: una carta gradata o singola (numero "001/165", "#25"), una busta di un'altra promozione
    // (McDonald's), riproduzioni e buste "repack" (Gift Box Mew dava la foto di una carta gradata con "Gift Box" sull'etichetta).
    if (OTHER.some((re) => re.test(i.title) && !re.test(name))) continue;
    return i.image;
  }
  return null;
}

// Prodotti che sono solo il contenuto (come CONTENT_ONLY di sealed.js) e titoli di inserzioni che lo dicono.
const CONTENT_ONLY = /\b(deck pack|decks? only)\b/i;
const CONTENT_ONLY_TITLE = /\b(deck pack|decks? only|no box|without (the )?box|senza scatola|loose deck)\b/i;

// Parole che dicono il tipo di prodotto, non quale prodotto ("Vol. 1 Booster Box" ha una sola parola sua).
const GENERIC = new Set(["booster", "box", "pack", "deck", "display", "case", "tin", "collection", "bundle", "blister", "vol", "volume", "expansion", "promotion", "promo", "starter", "special", "beginner", "edition", "series", "premium"]);

const OTHER = [
  /\b(psa|bgs|cgc|sgc|beckett|graded|gradat[ao]|slab|gem mint|mint 10)\b/i,
  /\b(psa|bgs|cgc|sgc)\s?\d/i,
  /\bno\.\s?\d+/i,
  // Accessori e confezioni aperte: bustine protettive, teche in acrilico, "In Opened Pack" (0.9.160).
  /\b(sleeves?|acrylic|protector|opened|apert[oa])\b/i,
  // Una carta promo singola ("... Introduction To Evil and D23 Lorcana EN5 Cold Foil Promo Card").
  /\b(promo card|cold foil)\b/i,
  /\b\d{1,3}\s*\/\s*\d{2,3}\b/,
  /#\s?\d+/,
  /\b(mc\s?donald'?s?|happy meal)\b/i,
  /\b(proxy|custom|fake|replica|repack|mystery|sticker|adesiv[oi])\b/i,
  // Parole delle carte singole: Gift Box Mew • Lucario dava la carta Aron con "Gift Box" nel titolo.
  /\b(holo|reverse|rare|single|singola|near mint|nm|lp|hp|carta)\b/i,
];

/**
 * Foto scelte a mano (prezzi/dati/foto-sealed*.json, chiave "<catalogo>:<id prodotto>"). Quelle di [manual] (campo "p" dei file)
 * vanno dove manca la foto o c'è solo quella di eBay: una foto di CardTrader o TCGplayer del prodotto vale di più. Quelle di
 * [force] (campo "forza") sostituiscono anche la foto del catalogo, perché è di un altro prodotto (7 novembre 2026: "The First
 * Chapter Simplified Chinese Booster Box" aveva da CardTrader la foto del box inglese); a null tolgono la foto. Restituisce quante
 * foto ha messo o tolto.
 */
export function applyManualPhotos(catalogs, manual, force = {}) {
  let n = 0;
  for (const { prefix, data } of catalogs) {
    for (const p of data.p) {
      const key = `${prefix}:${p.id}`;
      // "forza" a null: nessuna foto, perché quella che c'è (o che eBay troverebbe) è di un altro prodotto e non ce n'è una giusta.
      if (noPhoto(force, key)) {
        if (p.img) {
          delete p.img;
          n++;
        }
        continue;
      }
      const img = force[key] ?? manual[key];
      if (!img || p.img === img) continue;
      if (force[key] || !p.img || String(p.img).startsWith("https://i.ebayimg.com/")) {
        p.img = img;
        n++;
      }
    }
  }
  return n;
}

/**
 * Lingua con cui cercare il prodotto su eBay. I sigillati Yu-Gi-Oh! che CardTrader non mette in nessun set hanno spesso il nome
 * inglese di Cardmarket ma sono confezioni OCG giapponesi ("Vol. 1 Booster Box", "Duelist Legacy Volume 2", "Premium Pack 20",
 * "(OCG)"): cercati come inglesi, la ricerca scartava le inserzioni "Japanese" e non trovava nulla. Restano inglesi le stampe
 * europee col codice tra parentesi ("Legend of Blue Eyes White Dragon (LDD)", "Starter Deck: Yugi (BIY)").
 */
export function ebayLang(prefix, product, expansion) {
  const lang = product.l ?? null;
  if (prefix !== "yugioh-sealed" || (lang && lang !== "en")) return lang;
  if (/\(OCG\)/i.test(product.n ?? "")) return "ja";
  if (!String(expansion ?? "").trim() && !/\([A-Z]{3}\)/.test(product.n ?? "")) return "ja";
  return lang;
}

/**
 * Foto di un altro prodotto dello stesso set per i sigillati che non ne hanno una loro (0.9.161, richiesto dall'utente: "le foto
 * di tutti i prodotti"), segnata nel catalogo perché l'app lo scriva sulla foto ("ia", "ian"):
 * - "case": una cassa ("Rage of the Abyss: Special 3-Pack Tuckbox Case (12x Tuckbox)", "Sword & Shield 24 Sleeved Booster
 *   Case") con la foto di una sua confezione, e quante sono;
 * - "content": il solo contenuto ("Speed Duel: Battle City Box Decks Only (4 Card Packs)", "Structure Deck: Fire Kings Card
 *   Pack", "ex Starter Set ... Promo Card Pack") con la foto della confezione completa;
 * - "reprint": una ristampa ("... (2024 Reprint)") con la foto della prima stampa.
 * Sempre stesso set (`e`) e stessa lingua, e il nome della confezione dev'essere esattamente quello senza "Case"/"Decks Only"...
 */
const BOXES_IN_PARENS = /\(\s*\d+\s*x\s*(?:booster )?box(?:es)?\s*\)/i;

export function similarOf(p, siblings) {
  const n = String(p.n ?? "");
  const withPhoto = siblings.filter((s) => s !== p && s.img && !s.ia);
  const pick = (base, ok = () => true) => {
    const hits = withPhoto.filter((s) => ok(s) && sameWords(s.n, base));
    return hits.find((s) => !String(s.img).startsWith("https://i.ebayimg.com/")) ?? hits[0] ?? null;
  };
  // Cassa anche senza la parola "Case": "Memorial Collection (12x Booster Box) (Non-English)".
  if (/\bcases?\b/i.test(n) || BOXES_IN_PARENS.test(n)) {
    // La parentesi che dice quante confezioni ("(12x Tuckbox)", "(12 Booster Boxes)", "(EU Version - 12 Booster Boxes with
    // 24 Packs)"), non le altre ("(2024 Reprint)").
    const parens = [...n.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const paren = parens.find((x) => /\d+\s*x?\s+\w/.test(x) && /\b(box|boxes|packs?|tins?|tuckbox|bundles?|boosters?|decks?|blisters?)\b/i.test(x) && !/reprint/i.test(x)) ?? "";
    const count = Number(paren.match(/(\d+)\s*x?\s/)?.[1] ?? n.match(/\bcase of (\d+)/i)?.[1] ?? n.match(/\b([1-9]\d*)\s+(?:[a-z]+\s+){0,2}(?:booster|elite|etb|display|box|tin|pack|bundle|blister)/i)?.[1] ?? 0);
    // Il numero di una cassa non comincia mai con lo zero: "Manga Booster 02 Booster Box Case" è il volume 2, non 2 box.
    const unit = /booster box/i.test(paren) ? " Booster Box" : /\bboxes\b/i.test(paren) ? " Box" : /\btins\b/i.test(paren) ? " Tin" : "";
    const base = n.replace(/^sealed case of \d+\s+/i, "").replace(paren ? `(${paren})` : "\u0000", " ").replace(/\bcases?\b/gi, " ")
      .replace(/\b[1-9]\d*\s+(?=(?:[a-z]+\s+){0,2}(?:sleeved|booster|elite|etb|display|box|tin|pack|bundle|blister))/gi, " ").replace(/\s+/g, " ").trim();
    const notCase = (s) => !/\bcases?\b/i.test(s.n) && !BOXES_IN_PARENS.test(s.n);
    const s = pick(base + unit, notCase) ?? pick(base, notCase) ?? (/\bsleeved\b/i.test(base) ? pick(base.replace(/\bsleeved\b/i, ""), notCase) : null);
    if (s) return { img: s.img, kind: "case", count: count > 1 ? count : null };
  }
  const CONTENT = /\s*\b(?:(?:all )?card packs?|decks? only|deck pack|promo card pack)\b/gi;
  if (CONTENT.test(n) && !/\bgod deck pack\b/i.test(n)) {
    const base = n.replace(/\([^)]*card packs?[^)]*\)/gi, " ").replace(CONTENT, " ").replace(/\s+/g, " ").trim();
    const s = pick(base, (x) => !/\b(card packs?|decks? only|deck pack)\b/i.test(x.n));
    if (s) return { img: s.img, kind: "content", count: null };
  }
  if (/\((?:19|20)\d{2} reprint\)/i.test(n)) {
    const s = pick(n.replace(/\((?:19|20)\d{2} reprint\)/i, " "), (x) => !/reprint/i.test(x.n));
    if (s) return { img: s.img, kind: "reprint", count: null };
  }
  return null;
}

/**
 * Applica [similarOf] ai sigillati ancora senza foto di [data] (tranne quelli che "forza" vuole senza). Restituisce quanti.
 * Prima tra i prodotti dello stesso set, poi in tutto il catalogo nella stessa lingua: Cardmarket mette a volte la cassa in un
 * altro set ("Manga Booster 02 Booster Box Case [Fusion World]" nei promo di Fusion World, il box nel suo set).
 */
export function applySimilarPhotos(data, prefix, force = {}) {
  const bySet = new Map();
  const byLang = new Map();
  for (const p of data.p) {
    const k = `${p.e}|${p.l ?? ""}`;
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k).push(p);
    if (!byLang.has(p.l ?? "")) byLang.set(p.l ?? "", []);
    byLang.get(p.l ?? "").push(p);
  }
  let n = 0;
  for (const p of data.p) {
    if (p.img || noPhoto(force, `${prefix}:${p.id}`)) continue;
    const s = similarOf(p, bySet.get(`${p.e}|${p.l ?? ""}`) ?? []) ?? similarOf(p, byLang.get(p.l ?? "") ?? []);
    if (!s) continue;
    p.img = s.img;
    p.ia = s.kind;
    if (s.count) p.ian = s.count;
    n++;
  }
  return n;
}

/** true se "forza" dice che il prodotto non deve avere foto (valore null): niente foto da altre fonti né da eBay. */
export const noPhoto = (force, key) => Object.hasOwn(force, key) && force[key] == null;

// Lingua scritta nel nome del prodotto (Cardmarket, CardTrader) e nome senza la lingua.
const LANG_MARKS = [
  [/\(\s*japanese\s*\)|\bjapanese\b|\bjp\b|\(\s*ocg\s*\)|\(\s*non-english\s*\)/gi, "ja"],
  [/\(\s*korean\s*\)|\bkorean\b/gi, "ko"],
  [/\(\s*simplified chinese\s*\)|\bsimplified chinese\b/gi, "zh-cn"],
  [/\(\s*traditional chinese\s*\)|\btraditional chinese\b/gi, "zh-tw"],
  [/\(\s*asia region(?: legal)?\s*\)/gi, "asia"],
  [/\(\s*version fran[cç]aise\s*\)|-?\s*french exclusive edition\s*-?|\bfr\b/gi, "fr"],
  [/\bthai\b/gi, "th"],
  [/\bindonesian\b/gi, "id"],
];
// Stampe europee Yu-Gi-Oh! con il codice tra parentesi: "Starter Deck: Yugi (DDY)", "Spell Ruler (SDM) Booster".
const EU_CODE = /\(\s*[A-Z]{3}\s*\)/;

/**
 * Lingua del prodotto ("ja", "zh-cn", "fr"...; "asia" per le stampe inglesi per l'Asia, "eu" per le stampe europee Yu-Gi-Oh!
 * col codice) e nome senza la lingua, per ritrovare lo stesso prodotto nelle altre lingue.
 */
export function productLang(p) {
  let base = String(p.n ?? "");
  let found = null;
  for (const [re, l] of LANG_MARKS) {
    const next = base.replace(re, " ");
    if (next !== base) {
      found ??= l;
      base = next;
    }
  }
  if (EU_CODE.test(base)) {
    found ??= "eu";
    base = base.replace(EU_CODE, " ");
  }
  const lang = p.l && p.l !== "en" ? p.l : found ?? p.l ?? "en";
  return { lang, base: base.replace(/\s+/g, " ").trim() };
}

const WESTERN = new Set(["en", "fr", "de", "it", "es", "pt", "eu"]);
const ASIAN_STEPS = { "zh-cn|zh-tw": 1, "id|th": 1, "ja|ko": 2, "ja|zh-tw": 2, "ja|th": 2, "id|ja": 2, "asia|th": 2, "asia|id": 2, "ja|zh-cn": 3, "ko|zh-tw": 3, "ko|zh-cn": 3 };

/**
 * Quanto è lontana la foto in lingua [b] da un prodotto in lingua [a] (più basso = più simile): le lingue occidentali tra loro
 * (prima l'inglese), le stampe inglesi per l'Asia con l'inglese, i due cinesi tra loro, giapponese e coreano, thailandese e
 * indonesiano (stessi set del giapponese), poi l'inglese per tutte.
 */
export function langDistance(a, b) {
  if (a === b) return 0;
  const west = (x) => WESTERN.has(x);
  if (west(a) && west(b)) return b === "en" ? 1 : 2;
  if ((a === "asia" && b === "en") || (a === "en" && b === "asia")) return 1;
  const step = ASIAN_STEPS[[a, b].sort().join("|")];
  if (step) return step;
  return b === "en" || a === "en" ? 4 : 5;
}

/**
 * Foto della lingua più vicina (7 novembre 2026, richiesto dall'utente: "per quelli di cui non trovi le immagini nella lingua
 * giusta usa quelle della lingua più vicina"): per i sigillati ancora senza foto, quella dello stesso prodotto in un'altra
 * lingua (stesso tipo, stesso nome senza la lingua: "Shadow Specters (Japanese) Booster Box" -> "Shadow Specters Booster Box",
 * "Starter Deck: Yugi (DDY)" -> "Starter Deck: Yugi"), in tutto il catalogo. Segnata nel catalogo ("ia": "lang", "ial": lingua
 * della foto) perché l'app lo scriva sulla foto. Restituisce quanti.
 */
export function applyOtherLangPhotos(data, prefix, force = {}) {
  const info = new Map(data.p.map((p) => [p, productLang(p)]));
  const withPhoto = data.p.filter((s) => s.img && !s.ia);
  let n = 0;
  for (const p of data.p) {
    if (p.img || noPhoto(force, `${prefix}:${p.id}`)) continue;
    const me = info.get(p);
    if (!me.base) continue;
    const hits = withPhoto.filter((s) => s.t === p.t && info.get(s).lang !== me.lang && sameWords(info.get(s).base, me.base));
    if (!hits.length) continue;
    const ebay = (s) => String(s.img).startsWith("https://i.ebayimg.com/");
    hits.sort((x, y) => langDistance(me.lang, info.get(x).lang) - langDistance(me.lang, info.get(y).lang) || ebay(x) - ebay(y) || x.id - y.id);
    const s = hits[0];
    const lang = info.get(s).lang;
    p.img = s.img;
    p.ia = "lang";
    p.ial = lang === "asia" ? "en" : lang;
    n++;
  }
  return n;
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const daysSince = (s, now) => (now - new Date(s)) / 86400000;

/** Cerca le foto mancanti; aggiorna [cache] ({p: {chiave: [foto|null, giorno]}}) e restituisce quante ne ha trovate. */
export async function findPhotos(ebay, products, cache, { budget = 300, now = new Date(), log = [] } = {}) {
  let used = 0;
  let found = 0;
  for (const { key, name, expansion, game, lang, date } of products) {
    const c = cache.p[key];
    // Le foto scelte prima del 7 novembre 2026 non hanno il titolo dell'inserzione: si ricontrollano subito con le regole nuove
    // (la busta CBB7C aveva la foto di un box).
    if (c && (c[0] ? c.length > 2 && daysSince(c[1], now) < RECHECK_DAYS : daysSince(c[1], now) < RETRY_EMPTY_DAYS)) continue;
    if (used >= budget) break;
    used++;
    try {
      const first = photoQuery(name, expansion, game, lang);
      const opts = { date, noFirstEdition: game === "yugioh-sealed" && lang === "ja" };
      let items = await ebay.search(first, 50, { anyCurrency: true });
      let img = pickPhoto(items, name, GAME_WORDS[game] ?? null, lang ?? null, opts);
      // Nome troppo lungo col set davanti ("Gold, Silver, to a New World... Neo Starter Deck"): di nuovo col solo nome.
      const second = shortQuery(name, game, lang);
      if (!img && second !== first && used < budget) {
        used++;
        items = await ebay.search(second, 50, { anyCurrency: true });
        img = pickPhoto(items, name, GAME_WORDS[game] ?? null, lang ?? null, opts);
      }
      // Anche il titolo dell'inserzione: così una foto si può ricontrollare con regole nuove senza rifare la ricerca.
      cache.p[key] = img ? [img, day(now), items.find((i) => i.image === img)?.title ?? ""] : [null, day(now)];
      if (img) found++;
    } catch (err) {
      log.push(`! eBay foto "${name}": ${err.message}`);
      if (/HTTP 429/.test(err.message)) break; // quota del giorno finita: si riprende domani
    }
  }
  log.push(`Foto eBay dei sigillati: ${used} ricerche, ${found} foto nuove`);
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cacheFile, budgetArg, ...files] = process.argv.slice(2);
  if (!cacheFile || !files.length) {
    console.log("uso: node prezzi/src/foto-ebay.js <cache.json> <budget> <sealed.json> [...]");
    process.exit(1);
  }
  let cache = { v: 1, p: {} };
  try {
    cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    // prima volta: cache vuota
  }
  const catalogs = [];
  for (const f of files) {
    try {
      catalogs.push({ f, prefix: path.basename(f, ".json"), data: JSON.parse(await fs.readFile(f, "utf8")) });
    } catch (err) {
      console.log(`${f} non letto (${err.message}): saltato`);
    }
  }
  const log = [];
  // Foto scelte da altre fonti (Bulbapedia: buste e box dei set, prezzi/dati/foto-sealed.json): prima di eBay e al posto
  // di una foto eBay già messa (richiesto dall'utente: eBay solo per ultimo).
  // Più file (0.9.160): foto-sealed.json e uno per gioco (foto-sealed-yugioh.json, foto-sealed-dragonball.json...), così chi
  // cerca le foto di giochi diversi non scrive nello stesso file.
  let manual = {};
  const force = {};
  // Prodotti la cui foto eBay è stata guardata e scartata (7 novembre 2026: busta al posto del box, carte gradate, una carta
  // sola, il box al posto della cassa): eBay non si usa più per loro, restano alla foto di un prodotto fratello o al riquadro.
  const noEbay = new Set();
  const manualFiles = process.env.FOTO_SEALED
    ? [process.env.FOTO_SEALED]
    : (await fs.readdir("prezzi/dati").catch(() => [])).filter((f) => /^foto-sealed(-[a-z]+)?\.json$/.test(f)).sort().map((f) => `prezzi/dati/${f}`);
  for (const f of manualFiles) {
    try {
      const json = JSON.parse(await fs.readFile(f, "utf8"));
      Object.assign(manual, json.p ?? {});
      Object.assign(force, json.forza ?? {});
      for (const k of json.senzaEbay ?? []) noEbay.add(k);
    } catch {
      // file illeggibile: si salta
    }
  }
  const fromManual = applyManualPhotos(catalogs, manual, force);
  log.push(`Foto da altre fonti (Bulbapedia, Yugipedia, siti ufficiali, set di carte): ${fromManual}`);
  // Sigillati Yu-Gi-Oh! giapponesi: foto ufficiali Konami prima di eBay (cercate solo dalla parte che cerca anche su eBay, cioè
  // con un budget; la parte "yugioh" del job applica quelle già trovate).
  const yg = catalogs.find((c) => c.prefix === "yugioh-sealed");
  if (yg) {
    const isJapanese = (p) => !noPhoto(force, `yugioh-sealed:${p.id}`) && ebayLang("yugioh-sealed", p, yg.data.exp?.[p.e]) === "ja";
    if (process.env.SUPABASE_SECRET_KEY && Number(budgetArg) > 0) {
      await findKonamiPhotos(yg.data, cache, { isJapanese, ...konamiIo(process.env.SUPABASE_SECRET_KEY), log });
    }
    log.push(`Foto Konami messe nel catalogo Yu-Gi-Oh!: ${applyKonamiPhotos(yg.data, cache)}`);
  }
  if (process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID) {
    const missing = catalogs.flatMap(({ prefix, data }) => data.p.filter((p) => !p.img && !noPhoto(force, `${prefix}:${p.id}`) && !noEbay.has(`${prefix}:${p.id}`)).map((p) => ({
      key: `${prefix}:${p.id}`, name: p.n, expansion: data.exp?.[p.e] ?? "", value: p.cm?.trend ?? p.cm?.tcgplayer ?? 0, date: p.d ?? "",
      game: prefix,
      lang: ebayLang(prefix, p, data.exp?.[p.e]),
    // Prima quelli con un prezzo, dal più caro; poi quelli senza prezzo dal più recente (i prodotti appena usciti, che
    // Cerca mostra per primi: Mega Rayquaza ex Premium Tournament Collection restava in fondo).
    }))).sort((a, b) => (b.value > 0) - (a.value > 0) || b.value - a.value || String(b.date).localeCompare(String(a.date)));
    const ebay = new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID, marketplace: "EBAY_US" });
    const budget = Number(budgetArg);
    await findPhotos(ebay, missing, cache, { budget: Number.isFinite(budget) ? budget : 300, log });
  } else {
    log.push("EBAY_APP_ID/EBAY_CERT_ID non impostati: niente foto eBay nuove (si usano quelle già trovate)");
  }
  let applied = 0;
  for (const { f, prefix, data } of catalogs) {
    for (const p of data.p) {
      const img = !p.img && !noPhoto(force, `${prefix}:${p.id}`) && !noEbay.has(`${prefix}:${p.id}`) && cache.p[`${prefix}:${p.id}`]?.[0];
      if (img) {
        p.img = img;
        applied++;
      }
    }
    // Per ultimo, a chi resta senza: la foto di un prodotto fratello (cassa, solo contenuto, ristampa), segnata per l'app.
    const similar = applySimilarPhotos(data, prefix, force);
    // E se ancora manca: lo stesso prodotto nella lingua più vicina, segnato anche quello.
    const otherLang = applyOtherLangPhotos(data, prefix, force);
    await fs.writeFile(f, JSON.stringify(data));
    log.push(`${path.basename(f)}: foto di un prodotto fratello ${similar}, di un'altra lingua ${otherLang}, restano senza foto ${data.p.filter((p) => !p.img).length} su ${data.p.length}`);
  }
  await fs.writeFile(cacheFile, JSON.stringify(cache));
  console.log(log.join("\n"));
  console.log(`Foto eBay messe nei cataloghi: ${applied}`);
}
