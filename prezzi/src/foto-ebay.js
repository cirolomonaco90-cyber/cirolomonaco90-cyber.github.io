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
import { productKind, sealedKey } from "./sealed.js";

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

export function pickPhoto(items, name, gameRe = null, lang = null) {
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
  const required = own.includes("case") ? own.filter((w) => w !== "box" && w !== "booster") : own;
  if (!required.length) return null;
  const kind = productKind(name);
  const empty = /\b(empty|vuot[oa])\b/i.test(name);
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
    if (isBundle(i.title, name)) continue;
    if (!empty && /\b(empty|vuot[oa]|only box|solo scatola)\b/i.test(i.title)) continue;
    // Non è il prodotto sigillato: una carta gradata o singola (numero "001/165", "#25"), una busta di un'altra promozione
    // (McDonald's), riproduzioni e buste "repack" (Gift Box Mew dava la foto di una carta gradata con "Gift Box" sull'etichetta).
    if (OTHER.some((re) => re.test(i.title) && !re.test(name))) continue;
    return i.image;
  }
  return null;
}

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
 * Chapter Simplified Chinese Booster Box" aveva da CardTrader la foto del box inglese). Restituisce quante foto ha messo.
 */
export function applyManualPhotos(catalogs, manual, force = {}) {
  let n = 0;
  for (const { prefix, data } of catalogs) {
    for (const p of data.p) {
      const key = `${prefix}:${p.id}`;
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

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const daysSince = (s, now) => (now - new Date(s)) / 86400000;

/** Cerca le foto mancanti; aggiorna [cache] ({p: {chiave: [foto|null, giorno]}}) e restituisce quante ne ha trovate. */
export async function findPhotos(ebay, products, cache, { budget = 300, now = new Date(), log = [] } = {}) {
  let used = 0;
  let found = 0;
  for (const { key, name, expansion, game, lang } of products) {
    const c = cache.p[key];
    if (c && (c[0] ? daysSince(c[1], now) < RECHECK_DAYS : daysSince(c[1], now) < RETRY_EMPTY_DAYS)) continue;
    if (used >= budget) break;
    used++;
    try {
      const first = photoQuery(name, expansion, game, lang);
      let img = pickPhoto(await ebay.search(first, 50, { anyCurrency: true }), name, GAME_WORDS[game] ?? null, lang ?? null);
      // Nome troppo lungo col set davanti ("Gold, Silver, to a New World... Neo Starter Deck"): di nuovo col solo nome.
      const second = shortQuery(name, game, lang);
      if (!img && second !== first && used < budget) {
        used++;
        img = pickPhoto(await ebay.search(second, 50, { anyCurrency: true }), name, GAME_WORDS[game] ?? null, lang ?? null);
      }
      cache.p[key] = [img, day(now)];
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
  const manualFiles = process.env.FOTO_SEALED
    ? [process.env.FOTO_SEALED]
    : (await fs.readdir("prezzi/dati").catch(() => [])).filter((f) => /^foto-sealed(-[a-z]+)?\.json$/.test(f)).sort().map((f) => `prezzi/dati/${f}`);
  for (const f of manualFiles) {
    try {
      const json = JSON.parse(await fs.readFile(f, "utf8"));
      Object.assign(manual, json.p ?? {});
      Object.assign(force, json.forza ?? {});
    } catch {
      // file illeggibile: si salta
    }
  }
  const fromManual = applyManualPhotos(catalogs, manual, force);
  log.push(`Foto da altre fonti (Bulbapedia, Yugipedia, siti ufficiali, set di carte): ${fromManual}`);
  if (process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID) {
    const missing = catalogs.flatMap(({ prefix, data }) => data.p.filter((p) => !p.img).map((p) => ({
      key: `${prefix}:${p.id}`, name: p.n, expansion: data.exp?.[p.e] ?? "", value: p.cm?.trend ?? p.cm?.tcgplayer ?? 0, date: p.d ?? "",
      game: prefix,
      lang: p.l ?? null,
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
      const img = !p.img && cache.p[`${prefix}:${p.id}`]?.[0];
      if (img) {
        p.img = img;
        applied++;
      }
    }
    await fs.writeFile(f, JSON.stringify(data));
    log.push(`${path.basename(f)}: restano senza foto ${data.p.filter((p) => !p.img).length} su ${data.p.length}`);
  }
  await fs.writeFile(cacheFile, JSON.stringify(cache));
  console.log(log.join("\n"));
  console.log(`Foto eBay messe nei cataloghi: ${applied}`);
}
