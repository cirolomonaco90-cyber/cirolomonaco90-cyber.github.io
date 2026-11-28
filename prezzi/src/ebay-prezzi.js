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
//  - al massimo EBAY_BUDGET ricerche (3.000) per giorno di eBay, contando anche quelle dei giri rilanciati nello stesso giorno e
//    lasciando sempre libere quelle per foto, oggetti e variant-photo (ebay-quota.js: dal 19 novembre 2026), scelte per ritardo = giorni dall'ultimo aggiornamento /
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
import { hasWord, nameLike, sealedLike, sealedNeed, searchText, words } from "./somiglianza.js";
import { QUOTA_RESERVE, addCalls, dailyBudget, isQuotaError, quotaLine, quotaWindow, remainingQuota, usedInWindow } from "./ebay-quota.js";

/** Criterio con cui sono scritte le voci (campo `c`): vedi sopra. L'app legge "en" come inglese solo dal 2 in su. */
export const CRITERIO = 3;
/**
 * Criterio delle voci Yu-Gi-Oh! (punto 10 della riverifica, 19 novembre 2026): numero con la regione ("LOB-EN005") e lingua
 * dalla regione; 4 dal 20 novembre 2026: ricerca con nome e codice del set (`query`). Le voci di prima avevano quasi tutte
 * zero titoli riconosciuti: contano come mai cercate.
 */
export const CRITERIO_YG = 4;
/**
 * Criterio delle voci delle carte giapponesi (21 novembre 2026, misura B1): ricerca e titoli col totale del set ("006/024") o
 * con le parole del set ("McDonald's", "Vending"); prima "Squirtle 007" prendeva anche Squirtle 007/165 di 151.
 */
export const CRITERIO_JA = 4;
/** Carte giapponesi col criterio di prima da ricercare subito: da questo valore in su (o in collezione). */
const JA_REDO_EUR = 20;
// Criterio 3 (20 novembre 2026): confronto per somiglianza (somiglianza.js) e titoli tradotti da eBay.it, per tutti i prodotti.
const criterioOf = (p) => (p.yg ? CRITERIO_YG : p.ja ? CRITERIO_JA : CRITERIO);
/** Carte Yu-Gi-Oh! col criterio di prima da ricercare subito: da questo valore in su (o in collezione). */
const YG_REDO_EUR = 5;

/** Lingua della regione nel numero Yu-Gi-Oh! ("EN", "E" = inglese; "IT", "I" = italiano...). */
const YG_REGION = { en: "en", e: "en", ae: "en", it: "it", i: "it", de: "de", g: "de", fr: "fr", f: "fr", sp: "es", s: "es", pt: "pt", p: "pt", jp: "ja", j: "ja", kr: "ko", k: "ko" };

/**
 * Il numero Yu-Gi-Oh! [number] ("LOB-005", come lo scrive il catalogo, senza regione) in un titolo eBay: anche con la regione
 * tra il trattino e le cifre ("LOB-EN005", "LOB-E005", "LDD-I003"), e lo spazio o niente al posto del trattino ("SDK 001").
 * null = non c'è; altrimenti { lang }: la lingua della regione (null senza regione, o con una che non si sa).
 */
export function yugiohNumberIn(title, number) {
  const m = String(number ?? "").trim().toLowerCase().match(/^([a-z0-9]+)-([a-z]*)0*(\d+)$/);
  if (!m) return null;
  const [, code, , digits] = m;
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Separatori anche con gli spazi ("YAP1 - 001", "YAP1 002", "YAP1 JP001").
  const re = new RegExp(`(^|[^0-9a-z])${esc}\\s*-?\\s*([a-z]{0,2})0*${digits}([^0-9]|$)`, "i");
  const hit = String(title).toLowerCase().match(re);
  if (!hit) return null;
  return { lang: YG_REGION[hit[2]] ?? null };
}
/** Secchio delle inserzioni che non dicono la lingua. */
const NO_LANG = "xx";

const DAY_MS = 86_400_000;
const BUDGET = 3000;
/** Errori di fila (non di quota) dopo cui le ricerche della notte si fermano. */
export const MAX_ERRORS_IN_A_ROW = 20;
/** Giorni tra due aggiornamenti per fascia di valore (euro): dai prodotti più cari ai trascurabili. */
const TIERS = [[1000, 2], [200, 4], [50, 7], [20, 14], [5, 30], [1, 90], [0, 180]];
/** L'intervallo più lungo: una voce più vecchia di così di un prodotto che non è più nell'universo si toglie. */
const MAX_INTERVAL_DAYS = 180;

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
export function bucketOf(title, { reprintOk = false, jumbo = false, plain = NO_LANG, stamps = true, region = null } = {}) {
  const t = norm(title);
  if (EXCLUDE.test(t)) return null;
  if (JUMBO.test(t) !== jumbo) return null;
  if (!reprintOk && REPRINT.test(t)) return null;
  // Yu-Gi-Oh!: la regione nel numero ([region], "LOB-EN005" = inglese) vale più delle parole del titolo, che spesso descrivono
  // in italiano una carta inglese ("Mago Oscuro LOB-EN005 ... inglese mondiale").
  const lang = region ?? titleLang(title, t) ?? plain;
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

/**
 * Altre cose che nel titolo di un sigillato dicono che non lo è (20 novembre 2026, venute fuori col confronto per somiglianza,
 * titoli veri di eBay.it): una carta gradata del prodotto anche senza il voto attaccato ("Mewtwo SVP 052 CGC Gem Mint 10 ... 151
 * collezione ultra premium"), il numero di una promo ("SVP 052", "#053"), una confezione aperta, usata o rovinata ("APERTO QUASI
 * COMPLETO - USATO", "CIB APERTO").
 */
const SEALED_NOT = /\b(psa|cgc|bgs|beckett|sgc|tag|ace|gem ?mint|pristine|svp\s*\d{2,3}|aperto|aperta|aperti|opened|usato|usata|usati|used|incomplet[oaie]|incomplete|danneggiat[oaie]|damaged|cib)\b|#\s?\d{2,3}\b/;

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
  if (EXCLUDE.test(rest) || SEALED_PART.test(rest) || CARD_NUMBER.test(rest) || SEALED_NOT.test(rest.replace(/\b(mai|non|never|not)\s+(aperto|aperta|aperti|opened|usato|usata|used)\b|\bunopened\b/g, " "))) return null;
  // Due prodotti nella stessa inserzione: la parola del tipo di confezione ripetuta ("151 Collezione Ultra Premium e Terapagos
  // ex Collezione Ultra Premium").
  if (/\b(collezione|collection|box|deck|mazzo|tin|bundle)\b.*\b(e|and|\+)\b.*\b\1\b/.test(t)) return null;
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
  // Per somiglianza (somiglianza.js, 20 novembre 2026): le parole del prodotto simili, non uguali, e qualcuna può mancare.
  if (p.kind === "sealed") return p.need || p.name ? sealedLike(title, p.need ?? sealedNeed(p.name)) : p.must.every((w) => ct.includes(w));
  // Yu-Gi-Oh!: il numero col codice del set ("LOB-005") dice da solo la carta, e su eBay.it il nome è spesso in italiano
  // ("Mago Oscuro LOB-005"): basta il numero, con o senza la regione.
  if (p.yg) return yugiohNumberIn(title, p.number) != null;
  // Il nome per somiglianza (somiglianza.js): una lettera diversa, parole attaccate, il titolo dopo il trattino tradotto da
  // eBay.it. Il numero, sotto, resta esatto: è lui che dice quale carta è.
  if (!p.name || !nameLike(title, p.name)) return false;
  // Set numerati col Pokédex: il set nel titolo, niente prodotti che non sono carte, niente "Dark/Light/Shining" se il nome
  // della carta non li ha.
  if (p.setWords && !setWordsIn(title, p.setWords)) return false;
  if (p.dexSet) {
    const t0 = norm(title).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!DEX_SET_WORDS[p.dexSet]?.some((w) => t0.includes(w))) return false;
    if (DEX_SET_NOT[p.dexSet]?.test(t0)) return false;
    if (DEX_NOT_CARDS.test(t0)) return false;
    const own = compact(p.name);
    if (DEX_PREFIXES.some((x) => !own.startsWith(x) && ct.includes(x + own))) return false;
  }
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
      : bucketOf(i.title, { reprintOk: p.reprint === true || p.ct === 1, jumbo: p.jumbo === true, plain: p.plain ?? NO_LANG, stamps: p.ct !== 1, region: p.yg ? yugiohNumberIn(i.title, p.number)?.lang ?? null : null });
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
/**
 * Ricerche riservate ogni notte ai sigillati senza valore (nessuna tendenza Cardmarket: accessori, confezioni senza vendite,
 * confezioni vuote), dentro il tetto [BUDGET]. Riverifica del 19 novembre 2026, approvato dall'utente: col valore 0 stavano in
 * fondo alla fila (81.704 prodotti dovuti, 3.000 ricerche a notte) e nessuno dei 2.123 era mai stato cercato. Con 100 a notte
 * sono tutti cercati in circa tre settimane, poi ognuno ogni 180 giorni (90 se è in collezione); ai prodotti di valore
 * restano 2.900 ricerche. Le confezioni vuote ci sono: le parole del nome ("Empty") devono stare nel titolo e non fanno
 * scartare l'inserzione (sealedBucket), quindi la ricerca trova proprio la scatola vuota.
 */
export const NO_VALUE_SLOTS = 100;

/** Sigillato senza valore, che ha i posti riservati della fila ([NO_VALUE_SLOTS]). */
const noValue = (p) => p.kind === "sealed" && !(p.value > 0);

export function plan(universe, state, owned, today, budget = BUDGET) {
  const scored = [];
  for (const p of universe) {
    // Le voci dei giochi CardTrader scritte col criterio di prima davano a tutte le stampe di un numero lo stesso prezzo, quelle
    // dei sigillati avevano carte sciolte e scatole vuote (l'app non le legge): contano come mai cercate.
    const e = state[p.id];
    // Yu-Gi-Oh! col criterio 2: subito solo le carte in collezione e da [YG_REDO_EUR] in su (sono decine di migliaia: tutte
    // insieme toglierebbero per giorni le ricerche agli altri prodotti); le altre al loro turno.
    // Dal criterio 3 (somiglianza) vale per tutti i prodotti: le voci scritte prima contano come mai cercate, le copie in
    // collezione per prime (score 3), poi dalle più care.
    // Carte giapponesi col criterio 3: subito quelle in collezione e da [JA_REDO_EUR] in su, le altre al loro turno.
    const redo = p.yg ? (e?.c ?? 1) < CRITERIO - 1 || p.value >= YG_REDO_EUR : p.ja ? (e?.c ?? 1) < CRITERIO || p.value >= JA_REDO_EUR : true;
    const old = e && (e.c ?? 1) < criterioOf(p) && (redo || owned.has(p.id));
    const last = e && !old ? e.d : null;
    // Ritardo: 1 = è il suo giorno; i mai cercati valgono 2 (a parità, dai più cari), 3 se qualcuno li ha in collezione: il
    // 20 novembre 2026 i dovuti erano 93.893 (le carte Yu-Gi-Oh! da rifare col criterio nuovo) per 3.000 ricerche e il Vaporeon
    // PSA 8 dell'utente, appena aggiunto alla ricerca, non era stato cercato.
    const score = last == null ? (owned.has(p.id) ? 3 : 2) : (today - last) / intervalFor(p.value, owned.has(p.id));
    if (score >= 1) scored.push({ p, score });
  }
  // A parità di ritardo dai più cari; fra i sigillati senza valore, dai più cari in vendita su Cardmarket (minimo).
  scored.sort((a, b) => b.score - a.score || b.p.value - a.p.value || (b.p.low ?? 0) - (a.p.low ?? 0));
  // I sigillati senza valore per primi nei loro posti riservati, poi tutti gli altri in ordine.
  const reserved = scored.filter((s) => noValue(s.p)).slice(0, Math.min(NO_VALUE_SLOTS, budget));
  const taken = new Set(reserved);
  return [...reserved, ...scored.filter((s) => !taken.has(s))].slice(0, budget).map((s) => s.p);
}

/** Chiave nel file di una carta giapponese in collezione, come la legge l'app (EbayPrices.productKey): "ja:" davanti, non per le "tp-". */
export const jaKey = (id) => (id.startsWith("tp-") || id.includes(":") ? id : `ja:${id}`);

/**
 * Set giapponesi vecchi numerati col Pokédex ([asiaDex]): le parole che nei titoli dicono il set, anche come le traduce
 * eBay.it ("Giungla"). Lo stesso numero del Pokédex è di tutte le carte di quel Pokémon (Vaporeon #134: Jungle, Dark Vaporeon
 * di Team Rocket, Light Vaporeon di neo, Carddass Bandai), quindi senza il set il titolo non dice quale carta è.
 */
const DEX_SET_WORDS = {
  PMCG1: ["base set", "base", "expansion pack", "espansione", "no rarity"],
  PMCG2: ["jungle", "giungla", "jungla", "dschungel"],
  PMCG3: ["fossil", "fossile", "fossiles", "fosil", "mystery of the fossils"],
  PMCG4: ["rocket"],
  PMCG5: ["leaders", "leader's", "stadium", "gym", "palestra"],
  // Gym 2: "gym" e "palestra" da soli prendevano anche il mazzo Yamabuki City Gym (Sabrina's Gengar #94 non holo, a 200 €,
  // un'altra carta: 21 novembre 2026); ora le parole del set e niente mazzi (DEX_SET_NOT).
  PMCG6: ["challenge", "darkness", "gym 2", "gym challenge", "palestra 2", "palestra giapponese 2", "sfida", "oscurita", "tenebre"],
  neo1: ["neo", "genesis", "gold silver", "new world"],
  neo2: ["neo", "discovery", "ruins", "rovine"],
  neo3: ["neo", "revelation", "awakening", "legends", "leggende"],
  neo4: ["neo", "destiny", "darkness", "light", "oscurita", "luce"],
};
/** Titoli di un altro prodotto con lo stesso numero del Pokédex: i mazzi delle palestre (Yamabuki City Gym Deck). */
const DEX_SET_NOT = {
  PMCG5: /\b(yamabuki|gym deck|city gym|mazzo)\b/,
  PMCG6: /\b(yamabuki|gym deck|city gym|mazzo)\b/,
};
/** Parole che non dicono quale set è ("Expansion Sheet (Vending)" = "vending", "S-P Promo" = nessuna). */
const GENERIC_SET_WORDS = new Set(["promo", "promos", "set", "expansion", "sheet", "pack", "edition", "special", "the", "of", "to", "senza", "numero", "and"]);
/** Le parole del nome di un set da trovare nei titoli (almeno 3 lettere o cifre). */
function setWordsOf(label) {
  // Gli anni no: molti titoli non li scrivono ("Squirtle 007/018 McDonald's Holo dal Giappone").
  return words(label).filter((w) => !GENERIC_SET_WORDS.has(w) && !/^(19|20)\d\d$/.test(w) && (w.length >= 3 || /\d/.test(w)));
}
/** Tutte le parole del set nel titolo, per somiglianza ("McDonalds" = "McDonald's"). */
function setWordsIn(title, ws) {
  const tw = words(title);
  const tc = tw.join("");
  return ws.every((w) => hasWord(tw, tc, w));
}
/** Prodotti che non sono carte del gioco (Carddass, Topsun...), con lo stesso numero del Pokédex. */
const DEX_NOT_CARDS = /\b(carddass|bandai|topsun|top sun|meiji|vending|sticker|seal)\b/;
/** Prefissi che fanno un'altra carta dello stesso Pokémon (Dark Vaporeon, Light Vaporeon, Shining Gyarados). */
const DEX_PREFIXES = ["dark", "light", "shining"];

/** Testo della ricerca eBay del prodotto. */
export function query(p) {
  // Testi brevi, senza parentesi e simboli (somiglianza.js): eBay cerca tutte le parole, e più ne metti meno trova.
  if (p.kind === "sealed") return [p.extra, searchText(p.name)].filter(Boolean).join(" ");
  // Yu-Gi-Oh!: nome e codice del set ("Blue-Eyes White Dragon YAP1"): eBay non collega "YAP1-001" a "YAP1-JP001" (con quella
  // ricerca 2 inserzioni, col codice 138) e il numero si controlla nei titoli (yugiohNumberIn). "B." per esteso come nei titoli
  // ("Red-Eyes B. Dragon" = "Red-Eyes Black Dragon": con "B." nessuna inserzione). 20 novembre 2026, carte YAP1 dell'utente.
  if (p.yg) {
    const code = String(p.number ?? "").split("-")[0];
    return [String(p.name).replace(/\bB\.\s*/g, "Black "), code].filter(Boolean).join(" ");
  }
  // Carte giapponesi: il numero come lo stampano ("006/024", "008"): con "6/24" eBay trovava 2 inserzioni invece di 101, con
  // "8" altri Magmortar invece di 36 di Dragon Blade.
  const pad = (x, w) => (/^\d+$/.test(String(x)) ? String(x).padStart(w, "0") : String(x));
  const n = p.ja && p.total ? `${pad(p.number, Math.max(3, String(p.total).length))}/${pad(p.total, 3)}`
    : p.ja && p.setWords ? pad(p.number, 3)
      : p.total ? `${p.number}/${p.total}` : p.number;
  // Del nome solo la parte prima del trattino (Lorcana "Elsa - Snow Queen": il resto eBay.it lo traduce).
  return [searchText(String(p.name ?? "").split(/\s+-\s+/)[0]), n, p.extra].filter(Boolean).join(" ");
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
export function buildUniverse({ cards = {}, cardsJa = {}, sets = {}, setNamesIt = null, asiaEn = {}, asiaDex = {}, asiaTotals = {}, asiaLabels = {}, guide = {}, ct = [], sealed = null, sealedGames = [], tcgplayer = null, owned = [], ownedJa = [] }) {
  const out = [];
  // Set giapponesi vecchi (PMCG, neo, VS...) senza numero stampato: nei titoli eBay c'è il numero del Pokédex ("Vaporeon
  // Jungle #134", "No.134"), non quello del catalogo ("023"). [asiaDex] = { set: { numeroPokédex: idCarta } } di asia.json.
  const dexOf = new Map();
  const dexSet = new Map();
  for (const [set, bySet] of Object.entries(asiaDex || {})) {
    for (const [dex, id] of Object.entries(bySet || {})) {
      dexOf.set(id, dex);
      if (DEX_SET_WORDS[set]) dexSet.set(id, set);
    }
  }
  const dexSetOf = (id) => (dexSet.has(id) ? { dexSet: dexSet.get(id) } : {});
  // Carte giapponesi: senza il set nel titolo "Squirtle 007" è anche Squirtle 007/165 di 151 (21 novembre 2026, misura B1:
  // in 5 carte su 6 il prezzo eBay era di altre carte). Set di TCGdex: il totale ufficiale ([asiaTotals], "SMP2@ja": 24),
  // cercato e confrontato come "006/024". Set presi da CardTrader ("ct-mcd2002"): le parole del loro nome ([asiaLabels]) nel
  // titolo ("McDonald's", "Dragon Blade", "Vending"). Set numerati col Pokédex: le loro parole (DEX_SET_WORDS), come prima.
  const jaSet = (id, set) => {
    if (dexOf.has(id)) return {};
    if (id.startsWith("ct-")) {
      const key = Object.keys(asiaLabels).filter((k) => id.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];
      const w = key ? setWordsOf(asiaLabels[key]) : [];
      return w.length ? { setWords: w } : {};
    }
    const total = asiaTotals[`${set ?? id.replace(/-[^-]+$/, "")}@ja`];
    return total ? { total } : {};
  };
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
    const js = jaSet(c.id, c.set);
    out.push({ id: `ja:${c.id}`, kind: "card", name, number: dexOf.get(c.id) ?? decodeURIComponent(c.localId), total: null, extra: js.total ? null : "japanese", value: v, ...dexSetOf(c.id), ...js, ja: 1 });
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
      out.push({ id: `${g.prefix}${c.id}`, kind: "card", name: c.n, number: baseNumber(c.num), total: null, extra: g.label, value: v, ct: 1, ...plain, ...(pr ? { pr } : {}), ...(g.prefix === "yg:" ? { yg: 1 } : {}) });
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
  // Carte giapponesi in collezione che non ci sono ancora ([ownedJa]: id, nome inglese e numero della copia, valore): quelle
  // che TCGdex non nomina in inglese, quelle dei set presi da CardTrader ("ct-sp-212") e quelle solo TCGplayer giapponesi
  // ("tp-597392", non nel catalogo TCGplayer del job). Avevano una fonte sola, il listino Cardmarket del prodotto giapponese
  // (19 novembre 2026, B1 della riverifica: Squirtle McDonald's 2002, Karen's Umbreon): i prezzi eBay si raccolgono per
  // confrontarli, l'app per ora non cambia. Senza un numero vero (energie, promo senza numero) nei titoli non si riconoscono.
  const have = new Set(out.map((p) => p.id));
  for (const c of ownedJa) {
    if (!c?.id || c.id.includes(":")) continue;
    const id = jaKey(c.id);
    if (have.has(id)) continue;
    const name = String(c.name ?? "").replace(/\s*\(.*$/, "").split(" - ")[0].trim();
    const number = dexOf.get(c.id) ?? String(c.number ?? "").trim().replace(/^0+(?=\d)/, "");
    if (!name || !/^\d{1,3}[a-z]?$/i.test(number)) continue;
    have.add(id);
    const js = c.id.startsWith("tp-") ? {} : jaSet(c.id);
    out.push({ id, kind: "card", name, number, total: null, extra: js.total ? null : js.setWords ? js.setWords.join(" ") : "japanese", value: c.value > 0 ? c.value : 20, ...dexSetOf(c.id), ...js, ja: 1 });
  }
  // Sigillati Pokémon e, con il nome del gioco nella ricerca ([extra]: "Booster Box" da solo è di ogni gioco), quelli di One Piece,
  // Lorcana, Dragon Ball e Yu-Gi-Oh! ([sealedGames]: [{label, data}]; prima solo Pokémon, 8 novembre 2026).
  for (const { label, data } of [{ label: null, data: sealed }, ...sealedGames]) {
    for (const p of data?.p ?? []) {
      const v = p.cm?.trend ?? 0;
      if (p.t === "object" || !p.n) continue;
      const lang = p.l ? { lang: p.l === "zh-cn" || p.l === "zh-tw" ? "zh" : p.l } : {};
      const plain = label && noItalian.has(label) ? { plain: "en" } : {};
      // Il minimo in vendita su Cardmarket ordina i sigillati senza valore nei loro posti riservati della fila (plan).
      const low = !(v > 0) && p.cm?.low > 0 ? { low: p.cm.low } : {};
      out.push({ id: `sl:${p.id}`, kind: "sealed", name: p.n, must: sealedWords(p.n), need: sealedNeed(p.n, label ? null : setNamesIt), value: v, ...(label ? { extra: label } : {}), ...lang, ...plain, ...low });
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

/**
 * Le voci da tenere nel file: quelle dei prodotti nell'universo e, per non perderle quando un catalogo stanotte non si è
 * scaricato (i suoi prodotti mancano dall'universo), anche le altre finché hanno meno di [MAX_INTERVAL_DAYS] giorni.
 */
export function keptEntries(state, universe, today) {
  const ids = new Set(universe.map((p) => p.id));
  return Object.fromEntries(Object.entries(state).filter(([id, e]) => ids.has(id) || today - (e?.d ?? -Infinity) < MAX_INTERVAL_DAYS));
}

/**
 * Ricerche della notte: aggiorna [state] (in posto) e restituisce le righe del registro. In [stats]: `calls` = chiamate a eBay
 * (anche quelle andate in errore, che contano per la quota), `quotaOut` = eBay ha risposto che la quota del giorno è finita.
 */
export async function run({ ebay, universe, state, owned, today, budget = BUDGET, pauseMs = 120, deadline = Infinity, log = [], stats = {} }) {
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
  let calls = 0;
  let errorsInARow = 0;
  let withPrices = 0;
  stats.calls = 0;
  stats.quotaOut = false;
  for (const p of due) {
    if (calls >= budget) break;
    if (fresh.has(p.id)) continue;
    if (Date.now() > deadline) { log.push(`tempo finito dopo ${done} ricerche`); break; }
    let items;
    calls++;
    stats.calls = calls;
    try {
      items = await ebay.search(query(p), 200);
    } catch (err) {
      if (isQuotaError(err)) {
        // Nessuna voce toccata: i prezzi dei giorni prima restano tutti come sono.
        stats.quotaOut = true;
        log.push(`! quota eBay finita dopo ${done} ricerche: i prodotti non cercati tengono i prezzi dei giorni prima`);
        break;
      }
      log.push(`! ${p.id}: ${err.message}`);
      // eBay che non risponde (token rifiutato, servizio fermo): dopo MAX_ERRORS_IN_A_ROW errori di fila ci si ferma, invece
      // di provare tutti i prodotti del tetto. Le voci non toccate tengono i prezzi dei giorni prima.
      if (++errorsInARow >= MAX_ERRORS_IN_A_ROW) {
        log.push(`! eBay non risponde: ${errorsInARow} errori di fila dopo ${done} ricerche, mi fermo (i prezzi dei giorni prima restano)`);
        break;
      }
      continue;
    }
    errorsInARow = 0;
    for (const s of sharing.get(searchKey(p))) {
      const b = bucketPrices(items, s);
      state[s.id] = { d: today, c: criterioOf(s), b };
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
  // Tetto per giorno di eBay, non per giro (ebay-quota.js): EBAY_BUDGET meno le ricerche già fatte oggi da altri giri (contatore
  // `quota` del file pubblicato) e mai oltre quelle che eBay dice rimaste meno il margine per foto, oggetti e variant-photo.
  const cap = Number(budgetArg ?? process.env.EBAY_BUDGET ?? BUDGET);
  const window = quotaWindow();
  const used = usedInWindow(old.quota, window);
  const prelog = [];
  const quota = await remainingQuota(ebay, prelog);
  const budget = dailyBudget({ cap, used, remaining: quota?.remaining, reserve: QUOTA_RESERVE.prezzi });
  prelog.push(quotaLine("prezzi", { window, cap, used, quota, reserve: QUOTA_RESERVE.prezzi, budget }));
  const stats = {};
  const log = await run({ ebay, universe, state, owned: new Set(owned ?? []), today, budget, deadline: Date.now() + 50 * 60_000, log: prelog, stats });
  if (budget === 0 && !stats.quotaOut) log.push(`! quota eBay: stanotte nessuna ricerca (${used >= cap ? `già fatte ${used} oggi` : "le chiamate rimaste sono per foto, oggetti e foto delle varianti"}): i prezzi dei giorni prima restano`);
  const kept = keptEntries(state, universe, today);
  await fs.writeFile(stateFile, JSON.stringify({ v: 1, updated: new Date().toISOString(), quota: addCalls(old.quota, window, stats.calls ?? 0), p: kept }));
  console.log(log.join("\n"));
}
