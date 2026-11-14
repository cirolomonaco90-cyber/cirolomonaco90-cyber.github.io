// Prezzi chiesti su eBay per ogni prodotto, divisi per lingua, variante e voto, per correggere il prezzo dell'app
// (richiesto dall'utente, 4 novembre 2026: "non limitiamoci alle carte in collezione, troviamo una tattica per tutti i
// prodotti"). Con la Browse API ufficiale (5.000 chiamate al giorno per l'app, gratuite; le altre restano al servizio
// delle foto delle varianti e agli oggetti da collezione).
//
// Tattica:
//  - una sola ricerca per prodotto (fino a 200 inserzioni): dai titoli si separano lingua, variante (reverse,
//    1ª edizione, shadowless, staff, prerelease) e voto (PSA 10, BGS 9.5...), senza una chiamata per combinazione;
//  - tutti i prodotti, con una frequenza che scende col valore (richiesto dall'utente: i prodotti molto cari spesso,
//    quelli di valore trascurabile molto di rado): `intervalFor`, da 2 giorni (da 1.000 €) a 180 (sotto 1 €), la metà
//    per le carte che ha in collezione qualcuno;
//  - ogni notte al massimo EBAY_BUDGET ricerche (3.000), scelte per ritardo = giorni dall'ultimo aggiornamento /
//    intervallo; i prodotti mai cercati valgono come in ritardo doppio e passano dai più cari. Se la domanda supera la
//    quota restano indietro i prodotti meno cari (il loro ritardo cresce più piano).
//
// Il file prezzi/v1/ebay.json si accumula: ogni notte si scarica quello di ieri, si aggiornano i prodotti scelti e si
// ricarica. Formato: { v, updated, p: { idApp: { d: giorno (dal 1970), c: criterio, b: { "en|n": [prezzo, inserzioni], ... } } } }
// con le chiavi delle copie dell'app ("base1-4", "op:244442", "sl:730469").
//
// Criterio 2 (10 novembre 2026, campo `c` della voce; le voci di prima non lo hanno e restano fino al loro turno):
//  - lingua: "en" sono solo le inserzioni che dicono inglese; quelle che non dicono la lingua stanno nel secchio "xx". Prima
//    finivano in "en", ma su eBay.it sono quasi tutte carte italiane: misurato su 90 carte e 8.096 inserzioni, il secchio
//    senza lingua vale 0,95 volte quello italiano e quello inglese dichiarato 1,5 volte. Dove la carta in italiano non
//    esiste (One Piece, Dragon Ball: `plain` del prodotto) chi non dice la lingua vende la carta inglese;
//  - stampe dei giochi CardTrader: una ricerca sola per nome e numero, divisa tra le stampe dai titoli (ebay-stampe.js).
//
//   node prezzi/src/ebay-prezzi.js <universo.json> <ebay.json> [budget]
// L'universo (elenco dei prodotti con query e valore) lo prepara `buildUniverse` (vedi job-notte.sh).

import fs from "node:fs/promises";
import { Ebay, isBundle } from "./ebay.js";
import { estimate } from "./stats.js";
import { compact, norm, VARIANT_WORDS } from "../../supabase/functions/variant-photo/rules.js";
import { baseNumber, printOk, printRules } from "./ebay-stampe.js";

/** Criterio con cui sono scritte le voci (campo `c`): vedi sopra. L'app legge "en" come inglese solo dal 2 in su. */
export const CRITERIO = 2;
/** Secchio delle inserzioni che non dicono la lingua. */
export const NO_LANG = "xx";

export const DAY_MS = 86_400_000;
export const BUDGET = 3000;
/** Giorni tra due aggiornamenti per fascia di valore (euro): dai prodotti più cari ai trascurabili. */
export const TIERS = [[1000, 2], [200, 4], [50, 7], [20, 14], [5, 30], [1, 90], [0, 180]];

/** Intervallo di aggiornamento di un prodotto: per valore, la metà se qualcuno lo ha in collezione (almeno 2 giorni). */
export function intervalFor(value, owned) {
  const days = TIERS.find(([min]) => value >= min)?.[1] ?? 180;
  return owned ? Math.max(2, days / 2) : days;
}

/** Ricerche al giorno che servirebbero per tenere tutti i prodotti al loro ritmo (per il registro). */
export function dailyDemand(universe, owned) {
  // Le stampe con la stessa ricerca ne fanno una sola, al ritmo della più frequente.
  const by = new Map();
  for (const p of universe) {
    const k = searchKey(p);
    by.set(k, Math.min(by.get(k) ?? Infinity, intervalFor(p.value, owned.has(p.id))));
  }
  let sum = 0;
  for (const days of by.values()) sum += 1 / days;
  return Math.round(sum);
}

/** Prodotti con la stessa chiave si cercano una volta sola: le stampe dei giochi CardTrader con lo stesso nome e numero. */
export function searchKey(p) {
  return p.pr ? `q:${compact(p.name)}|${String(p.number).toLowerCase()}|${p.extra ?? ""}` : p.id;
}

/** Lingua dichiarata nel titolo. L'inglese per ultimo: "ITA" o "JAP" vincono su un "EN" messo per altro. */
const LANGS = [
  ["it", /\b(ita|italian[oa]?|italiano|ital)\b/],
  ["ja", /\b(jp|jap|japan|japanese|giappon\w*|jpn)\b/],
  ["de", /\b(deutsch|german|ger|tedesc\w)\b/],
  ["fr", /\b(fr|french|francese|francais|fra)\b/],
  ["es", /\b(esp|spanish|spagnol\w|espanol)\b/],
  ["pt", /\b(portugues\w*|portoghese|pt-?br)\b/],
  ["ko", /\b(korean|coreano|kor)\b/],
  ["zh", /\b(chinese|cinese|chn|s-?chinese|t-?chinese)\b/],
  ["en", /\b(eng|english|inglese|ingl|englisch|anglais|ingles)\b/],
];

/**
 * Lingua scritta nel titolo, null se non la dice. [text]: il titolo normalizzato (o la sua parte senza il nome del prodotto).
 * "EN" da solo vale inglese solo in maiuscolo in un titolo non tutto maiuscolo ("Holo EN 2016"; "Cielos en Evolución" no).
 */
export function titleLang(title, text = norm(title)) {
  const found = LANGS.find(([, re]) => re.test(text))?.[0];
  if (found) return found;
  return /\bEN\b/.test(title) && /[a-z]/.test(title) ? "en" : null;
}

/** Voto di una carta gradata nel titolo: "PSA 10", "BGS 9.5", "CGC 9"... */
const GRADE = /\b(psa|bgs|cgc|sgc|ace|tag)\s*-?\s*(10|9[.,]5|9|8[.,]5|8|7[.,]5|7|6[.,]5|6|5[.,]5|5|4|3|2|1)\b/;

/** Inserzioni da scartare sempre: lotti, falsi, oggetti diversi dalla carta. */
const EXCLUDE = /\b(lot|lotto|lots|bundle|proxy|custom|personalizzat[oae]|orica|replica|fake|falsa|playset|x[2-9]|[2-9]x|digital|online|code|codice|sticker|adesivo|poster|empty|vuota|binder|raccoglitore|choose|scegli|pick your|you pick|metal|metallo|gold card)\b/;

/** Carte giganti: fuori dai prezzi delle carte normali, le sole che valgono per le carte giganti (TCGplayer "Jumbo Cards"). */
const JUMBO = /\b(jumbo|oversized?|gigante|box topper)\b/;

/** Ristampe che portano nome e numero della carta originale (Shining Charizard 107/105 di Celebrations). */
const REPRINT = /\b(celebrations?|classic collection|25th|anniversary|reprint|ristampa|rpr|cel25|trading card game classic)\b/;

/** Copie dichiarate rovinate: fuori dai prezzi delle non gradate (la stima vale per una carta in buone condizioni). */
const WORN = /\b(played|lp|mp|hp|light play|heavy play|damaged|dmg|poor|giocata|rovinat\w|danneggiat\w|crease|creased|piega|bent|scratch\w*|graffi\w*|worn|usurat\w)\b/;

/**
 * Il secchio di un'inserzione: "lingua|variante" (n = normale/holo, r = reverse, 1 = 1ª edizione, s = shadowless,
 * st = staff, pr = prerelease) o "lingua|g:PSA 10" per le gradate; null se l'inserzione va scartata. La lingua è quella
 * scritta nel titolo; se non c'è, [plain]: "xx" (non si sa) o la lingua del prodotto quando chi non la dice vende quella.
 */
export function bucketOf(title, { reprintOk = false, jumbo = false, plain = NO_LANG, stamps = true } = {}) {
  const t = norm(title);
  if (EXCLUDE.test(t)) return null;
  if (JUMBO.test(t) !== jumbo) return null;
  if (!reprintOk && REPRINT.test(t)) return null;
  const lang = titleLang(title, t) ?? plain;
  const g = t.match(GRADE);
  // "BGS 9,5" con la virgola (inserzioni italiane) = "BGS 9.5".
  if (g) return `${lang}|g:${g[1].toUpperCase()} ${g[2].replace(",", ".")}`;
  if (/\b(graded|gradata|gradate|slab)\b/.test(t)) return null; // gradata senza voto leggibile
  if (WORN.test(t)) return null;
  const c = compact(title);
  // Staff, prerelease, shadowless e reverse sono varianti delle carte Pokémon; negli altri giochi ([stamps] falso) le
  // stampe sono carte a sé del catalogo, e resta solo la 1ª edizione (Yu-Gi-Oh!).
  if (stamps && /\bstaff\b/.test(t)) return `${lang}|st`;
  if (stamps && /\bpre-?release\b/.test(t)) return `${lang}|pr`;
  if (VARIANT_WORDS.firstEdition.some((w) => c.includes(compact(w)))) return `${lang}|1`;
  if (stamps && /\bshadowless\b/.test(t)) return `${lang}|s`;
  if (stamps && VARIANT_WORDS.reverse.some((w) => c.includes(compact(w)))) return `${lang}|r`;
  return `${lang}|n`;
}

/**
 * Inserzioni di un pezzo del sigillato, non del prodotto intero (8 novembre 2026: per il Japan Post Stamp Box passavano scatole
 * vuote, "solo foglio francobolli", "senza carte promo", custodie e le singole carte promo, e la stima eBay era 77,50 € contro i
 * 2.400 € del box): "solo", "senza", "vuota", "custodia", "cartoline", "tappeto"... se non sono nel nome del prodotto.
 */
const SEALED_PART = /\b(only|solo|soltanto|nur|seulement|uniquement|without|senza|ohne|sans|no promos?|no cards?|no stamps?|not included|non inclus[oa]|nicht enthalten|excluded|esclus[oie]|leer|vide|vuot[oaie]|empty|case for|custodia|protector|protettore|acrylic|acrilico|replacement|post ?cards?|cartolin[ae]|rug|tappeto|playmat)\b/;

/** Numero di una carta nel titolo ("227/S-P", "4/102", "016/128"): è una carta del prodotto, non il sigillato. */
const CARD_NUMBER = /\b\d{1,3}\s*\/\s*(\d{1,3}|[a-z]{1,4}-?p)\b/;

/** Sotto questa parte della tendenza Cardmarket un'inserzione di sigillato è un pezzo o un'altra cosa. */
const SEALED_MIN_SHARE = 0.4;

/**
 * Il secchio di un'inserzione di un sigillato [p]: la lingua scritta nel titolo o, se non c'è, quella del prodotto ([p.lang]: i
 * titoli dei prodotti giapponesi spesso non la dicono; [p.plain]: giochi senza prodotti in italiano), altrimenti "xx"; sempre
 * "n"; null per i pezzi, le carte singole, le gradate e i prezzi troppo bassi.
 */
export function sealedBucket(title, price, p) {
  const t = norm(title);
  // Le parole del nome del prodotto non contano ("Booster Bundle", "Empty Tin"...).
  const own = new Set(norm(p.name ?? "").split(/[^a-z0-9]+/).filter(Boolean));
  const rest = t.split(/\s+/).filter((w) => !own.has(w.replace(/[^a-z0-9]/g, ""))).join(" ");
  if (EXCLUDE.test(rest) || SEALED_PART.test(rest) || CARD_NUMBER.test(rest)) return null;
  if (GRADE.test(t) || /\b(graded|gradata|gradate|slab)\b/.test(t)) return null;
  if (p.value > 0 && price < SEALED_MIN_SHARE * p.value) return null;
  // La lingua scritta nel titolo vince ("Korean", "Chinese": il 151 coreano non è quello giapponese); senza, quella del prodotto.
  // (Sul titolo senza le parole del nome: "Japan Post Stamp Box Korean" è coreano, non giapponese.)
  const lang = titleLang(title, rest) ?? p.lang ?? p.plain ?? NO_LANG;
  return `${lang}|n`;
}

/** Il titolo parla di questo prodotto: per le carte nome e numero, per i sigillati tutte le parole importanti. */
export function matches(title, p) {
  const ct = compact(title);
  if (p.kind === "sealed") return p.must.every((w) => ct.includes(w));
  if (!p.name || !ct.includes(compact(p.name))) return false;
  const n = String(p.number ?? "").trim().toLowerCase().replace(/^0+(?=\d)/, "");
  if (!n) return false;
  const t = norm(title);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (p.total) return new RegExp(`(^|[^0-9])0*${esc}\\s*/\\s*0*${p.total}([^0-9]|$)`).test(t);
  return new RegExp(`(^|[^0-9a-z])0*${esc}([^0-9a-z]|$)`).test(t);
}

/** Prezzi per secchio dalle inserzioni del prodotto: { "en|n": [prezzo, inserzioni], ... } (mediana delle più economiche). */
export function bucketPrices(items, p) {
  const by = new Map();
  for (const i of items) {
    if (!(i.price > 0) || i.currency !== "EUR" || !matches(i.title, p)) continue;
    // Più cose in vendita nella stessa inserzione. Per un sigillato "set completo" / "complete set" vuol dire la confezione
    // con tutto dentro (Japan Post Stamp Box "Set Completo"), non una serie di prodotti.
    const title = p.kind === "sealed" ? i.title.replace(/\b(set|serie|collezione)\s+complet[oae]\b|\bcomplete\s+set\b|\bset\s+complete\b/gi, " ") : i.title;
    if (isBundle(title, p.name)) continue;
    // Le carte che sono esse stesse ristampe (Celebrations, Classic Collection) accettano le parole delle ristampe. I sigillati
    // hanno regole loro: "Celebrations" e "25th Anniversary" sono il loro nome, non una ristampa.
    // Giochi CardTrader ([p.ct]): le parole delle ristampe non scartano ("25th Anniversary Rarity Collection" è un set
    // Yu-Gi-Oh!), e tra più stampe dello stesso numero vale solo il titolo che dice quella del prodotto (ebay-stampe.js).
    if (p.pr && !printOk(i.title, p)) continue;
    const b = p.kind === "sealed"
      ? sealedBucket(i.title, i.price, p)
      : bucketOf(i.title, { reprintOk: p.reprint === true || p.ct === 1, jumbo: p.jumbo === true, plain: p.plain ?? NO_LANG, stamps: p.ct !== 1 });
    if (!b) continue;
    if (!by.has(b)) by.set(b, []);
    by.get(b).push({ price: i.price, currency: "EUR", graded: false, bundle: 1, quantity: 1, condition: null });
  }
  const out = {};
  for (const [b, offers] of by) {
    const est = estimate(offers, "n");
    if (est) out[b] = est;
  }
  return out;
}

/**
 * I prodotti da cercare stanotte: al massimo [budget], per priorità. [universe]: [{id, value, ...}], [state]: le voci di
 * ieri ({id: {d}}), [owned]: id che ha in collezione qualcuno, [today]: giorno (dal 1970).
 */
export function plan(universe, state, owned, today, budget = BUDGET) {
  const scored = [];
  for (const p of universe) {
    // Le voci dei giochi CardTrader scritte col criterio di prima davano a tutte le stampe di un numero lo stesso prezzo
    // (l'app non le legge): contano come mai cercate.
    const e = state[p.id];
    const last = e && !(p.ct === 1 && (e.c ?? 1) < CRITERIO) ? e.d : null;
    // Ritardo: 1 = è il suo giorno; i mai cercati valgono 2 (a parità, dai più cari).
    const score = last == null ? 2 : (today - last) / intervalFor(p.value, owned.has(p.id));
    if (score >= 1) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || b.p.value - a.p.value);
  return scored.slice(0, budget).map((s) => s.p);
}

/** Testo della ricerca eBay del prodotto. */
export function query(p) {
  if (p.kind === "sealed") return p.extra ? `${p.extra} ${p.name}` : p.name;
  const n = p.total ? `${p.number}/${p.total}` : p.number;
  return [p.name, n, p.extra].filter(Boolean).join(" ");
}

/** Le parole importanti del nome di un sigillato (per riconoscerlo nei titoli). */
export function sealedWords(name) {
  const stop = new Set(["pokemon", "the", "and", "of", "di", "e", "tcg", "card", "game", "english", "japanese"]);
  return norm(name).replace(/[()[\],:]/g, " ").split(" ").map(compact).filter((w) => w.length >= 2 && !stop.has(w));
}

/**
 * Universo dei prodotti dai file del job: carte TCGdex inglesi ([cards]: cache di tcgdex-scan, con [sets] TCGdex per
 * totale e nome), carte giapponesi ([cardsJa], nomi inglesi da asia.json [asiaEn]), giochi CardTrader ([ct]: {prefix,
 * label, data}) e sigillati ([sealed]); valori in euro dal listino Cardmarket ([guide]: idProduct -> euro).
 */
export function buildUniverse({ cards = {}, cardsJa = {}, sets = {}, asiaEn = {}, guide = {}, ct = [], sealed = null, sealedGames = [], tcgplayer = null, owned = [] }) {
  const out = [];
  const cardValue = (c) => Math.max(0, ...(c.variants ?? [c.cm]).filter(Boolean).map((id) => guide[id] ?? 0));
  for (const c of Object.values(cards)) {
    const v = cardValue(c);
    if (!c.name) continue;
    const s = sets[c.set];
    const reprint = /celebrations|classic collection/i.test(s?.name ?? "") || /^cel25/.test(c.set);
    out.push({ id: c.id, kind: "card", name: c.name, number: decodeURIComponent(c.localId), total: s?.official ?? null, value: v, cm: guide[c.cm] ?? null, ...(reprint ? { reprint } : {}) });
  }
  for (const c of Object.values(cardsJa)) {
    const v = cardValue(c);
    const name = asiaEn[c.set]?.[String(c.localId).replace(/^0+(?=\d)/, "")];
    if (!name) continue;
    out.push({ id: `ja:${c.id}`, kind: "card", name, number: decodeURIComponent(c.localId), total: null, extra: "japanese", value: v });
  }
  // Giochi che non hanno carte in italiano (One Piece, Dragon Ball: nessuna carta del catalogo ha offerte italiane): lì chi
  // non scrive la lingua vende la carta inglese ([plain]); negli altri le inserzioni senza lingua restano a parte ("xx").
  const noItalian = new Set();
  for (const g of ct) {
    const cards = g.data.cards ?? [];
    const plain = cards.some((c) => c.it) ? {} : { plain: "en" };
    if (plain.plain) noItalian.add(g.label);
    // Più stampe con lo stesso nome e numero: una ricerca sola (il numero senza le lettere della stampa di CardTrader,
    // "OP07-051a": con le lettere eBay non trovava nulla) e i titoli divisi con le regole di ebay-stampe.js.
    const rules = printRules(cards, g.data.sets ?? [], { rarity: g.rarity === true });
    for (const c of cards) {
      const v = Math.max(0, ...["en", "jp", "it", "fr", "de", "es"].map((l) => c[l]?.[0] ?? 0));
      const pr = rules.get(c.id);
      // Niente totale del set: quello del catalogo conta anche le carte oltre il numero stampato (Lorcana "41/204" con 217
      // carte nel set) e con "41/217" la ricerca non trovava nulla (10 novembre 2026: 1 carta Lorcana su 439 con un prezzo).
      out.push({ id: `${g.prefix}${c.id}`, kind: "card", name: c.n, number: baseNumber(c.num), total: null, extra: g.label, value: v, ct: 1, ...plain, ...(pr ? { pr } : {}) });
    }
  }
  // Carte solo TCGplayer che ha in collezione qualcuno ("tp-210853" = "Ho-oh - 11/12 (Box Topper)" delle Jumbo Cards, dal
  // catalogo TCGplayer del job): spesso nessun'altra fonte ha un prezzo (8 novembre 2026, richiesto dall'utente). Senza
  // prezzo TCGplayer contano come 20 € (aggiornate ogni settimana).
  for (const id of owned) {
    const row = id.startsWith("tp-") ? tcgplayer?.p?.[id.slice(3)] : null;
    if (!row) continue;
    const card = tpCard(row[0], row[2], tcgplayer?.g?.[row[1]]?.[0]);
    if (card) out.push({ id, kind: "card", ...card, value: row[3] ?? 20 });
  }
  // Sigillati Pokémon e, con il nome del gioco nella ricerca ([extra]: "Booster Box" da solo è di ogni gioco), quelli di One Piece,
  // Lorcana, Dragon Ball e Yu-Gi-Oh! ([sealedGames]: [{label, data}]; prima solo Pokémon, 8 novembre 2026).
  for (const { label, data } of [{ label: null, data: sealed }, ...sealedGames]) {
    for (const p of data?.p ?? []) {
      const v = p.cm?.trend ?? 0;
      if (p.t === "object" || !p.n) continue;
      const lang = p.l ? { lang: p.l === "zh-cn" || p.l === "zh-tw" ? "zh" : p.l } : {};
      const plain = label && noItalian.has(label) ? { plain: "en" } : {};
      out.push({ id: `sl:${p.id}`, kind: "sealed", name: p.n, must: sealedWords(p.n), value: v, ...(label ? { extra: label } : {}), ...lang, ...plain });
    }
  }
  return out;
}

/**
 * Nome, numero e totale di una carta TCGplayer dal nome del prodotto ("Ho-oh - 11/12 (Box Topper)") e dal numero
 * ("011/012"): null senza numero (nei titoli eBay non si riconoscerebbe). Le carte del gruppo "Jumbo Cards" o "Box Topper"
 * sono giganti ([jumbo]) e la parentesi del nome va nella ricerca ("box topper").
 */
export function tpCard(fullName, number, groupName = "") {
  const [num, total] = String(number ?? "").split("/").map((x) => x.trim().replace(/^0+(?=\d)/, ""));
  if (!num) return null;
  const name = String(fullName ?? "").replace(/\s*\(.*$/, "").split(" - ")[0].trim();
  if (!name) return null;
  const extra = (String(fullName).match(/\(([^)]*)\)/)?.[1] ?? "").toLowerCase();
  const jumbo = /jumbo|box topper|oversize/i.test(`${fullName} ${groupName}`);
  return { name, number: num, total: /^\d+$/.test(total ?? "") ? Number(total) : null, extra: extra || null, ...(jumbo ? { jumbo } : {}) };
}

/** Ricerche della notte: aggiorna [state] (in posto) e restituisce le righe del registro. */
export async function run({ ebay, universe, state, owned, today, budget = BUDGET, pauseMs = 120, deadline = Infinity, log = [] }) {
  // Tutti i dovuti in ordine di priorità: le ricerche sono al massimo [budget], ma ognuna aggiorna tutte le stampe che la
  // condividono (stesso nome e numero), che così non ne spendono un'altra.
  const due = plan(universe, state, owned, today, Infinity);
  const sharing = new Map();
  for (const p of universe) {
    const k = searchKey(p);
    if (!sharing.has(k)) sharing.set(k, []);
    sharing.get(k).push(p);
  }
  const fresh = new Set();
  let done = 0;
  let withPrices = 0;
  for (const p of due) {
    if (done >= budget) break;
    if (fresh.has(p.id)) continue;
    if (Date.now() > deadline) { log.push(`tempo finito dopo ${done} ricerche`); break; }
    let items;
    try {
      items = await ebay.search(query(p), 200);
    } catch (err) {
      if (/429/.test(err.message)) { log.push(`quota eBay finita dopo ${done} ricerche`); break; }
      log.push(`! ${p.id}: ${err.message}`);
      continue;
    }
    for (const s of sharing.get(searchKey(p))) {
      const b = bucketPrices(items, s);
      state[s.id] = { d: today, c: CRITERIO, b };
      fresh.add(s.id);
      if (Object.keys(b).length) withPrices++;
    }
    done++;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  log.push(`eBay: ${universe.length} prodotti, ${dailyDemand(universe, owned)} ricerche al giorno per tenerli al loro ritmo, ${due.length} dovuti stanotte, ${done} ricerche, ${fresh.size} prodotti aggiornati, ${withPrices} con prezzi`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [universeFile, stateFile, budgetArg] = process.argv.slice(2);
  if (!universeFile || !stateFile) {
    console.log("uso: node prezzi/src/ebay-prezzi.js <universo.json> <ebay.json> [budget]");
    process.exit(1);
  }
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
    console.log("EBAY_APP_ID/EBAY_CERT_ID non impostati: prezzi eBay non aggiornati");
    process.exit(0);
  }
  const { universe, owned } = JSON.parse(await fs.readFile(universeFile, "utf8"));
  const old = await fs.readFile(stateFile, "utf8").then(JSON.parse).catch(() => ({ p: {} }));
  const state = old.p ?? {};
  const ebay = new Ebay({ appId: process.env.EBAY_APP_ID, certId: process.env.EBAY_CERT_ID, marketplace: "EBAY_IT" });
  const today = Math.floor(Date.now() / DAY_MS);
  const budget = Number(budgetArg ?? process.env.EBAY_BUDGET ?? BUDGET);
  const log = await run({ ebay, universe, state, owned: new Set(owned ?? []), today, budget, deadline: Date.now() + 50 * 60_000 });
  // Si tengono solo i prodotti ancora nell'universo (quelli scesi sotto la soglia escono).
  const ids = new Set(universe.map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(state).filter(([id]) => ids.has(id)));
  await fs.writeFile(stateFile, JSON.stringify({ v: 1, updated: new Date().toISOString(), p: kept }));
  console.log(log.join("\n"));
}
