// One Piece e Lorcana: catalogo e prezzi presi tutti da CardTrader (nessun abbinamento tra fonti).
// Lorcana (v1/lorcana.json): stesso formato, lingue en/fr/de/it/es/jp, rarità "lorcana_rarity".
// Su CardTrader ogni stampa è un "blueprint" col suo numero (OP01-064 normale, OP01-064b
// Alternate Art...), uguale in tutte le lingue: le offerte si filtrano per lingua.
//
// Output (v1/onepiece.json):
//   { v, updated,
//     sets:  [{ id, code, name, n }]                 // espansioni con carte, n = carte
//     cards: [{ id, n: nome, num: numero, r: rarità, v: versione|null, s: idEspansione,
//               img: percorso immagine, en: [prezzoNM, offerte], jp: [...], c: { en: { NM: [prezzo, offerte], EX: [...] } } (condizioni misurate),
//               g: { en: {"PSA 10": [prezzo, offerte], ...}, jp: {...} } }] }   // carte gradate
//   Prezzi Near Mint in euro, stessa stima delle carte Pokémon (stats.js).
import { coefficients, conditionPrices, estimate, isPlaceholderPrice, MIN_PREMIUM_PRICE, RATIO_FROM_IT } from "./stats.js";
export { isPlaceholderPrice };
import { parseGrade } from "./grading.js";
import { items } from "./matching.js";
import { blueprintLanguage, sealedEstimate } from "./sealed.js";

const ONE_PIECE_LANGS = ["en", "jp"];
/** Lorcana: stesso catalogo da CardTrader (gioco "Lorcana"), in sei lingue (il giapponese su CardTrader è "jp"). */
const LORCANA_LANGS = ["en", "fr", "de", "it", "es", "jp"];

/** I giochi il cui catalogo viene tutto da CardTrader: nome per cercarli tra i giochi, lingue, campo della rarità. */
/** Dragon Ball Super Card Game e Fusion World: su CardTrader un solo gioco (id 9, 176 espansioni), inglese e giapponese. */
const DRAGON_BALL_LANGS = ["en", "jp"];
/** Yu-Gi-Oh!: TCG in sei lingue occidentali e OCG giapponese (espansioni "-jp"); coreano e cinese non ancora. */
const YUGIOH_LANGS = ["en", "it", "fr", "de", "es", "pt", "jp"];

const CT_GAMES = {
  onepiece: { label: "One Piece", match: "one piece", langs: ONE_PIECE_LANGS, rarity: "onepiece_rarity" },
  // splitFoil (19 novembre 2026, B7 della verifica dei prezzi, scelto dall'utente): le carte che esistono normali e foil
  // (hasFoilChoice) hanno la stima delle normali in "en" e quella delle foil in "en1", come la 1ª edizione di Yu-Gi-Oh!;
  // nell'app la copia ha la finitura Normale / Foil. Vale solo se CardTrader segna la foil sull'offerta ("…_foil").
  lorcana: { label: "Lorcana", match: "lorcana", langs: LORCANA_LANGS, rarity: "lorcana_rarity", splitFoil: true },
  // Le comuni e non comuni esistono normali e foil nello stesso blueprint ("dragonball_foil" sull'offerta): la stima è
  // quella delle normali. Le rare esistono solo foil: il loro blueprint non ha la proprietà da scegliere, e tutte le loro
  // offerte contano (vedi hasFoilChoice: dal 9 novembre 2026 CardTrader le segna tutte "foil").
  dragonball: { label: "Dragon Ball", match: "dragon ball", langs: DRAGON_BALL_LANGS, rarity: "dragonball_rarity", excludeFoil: true, splitFoil: true },
  // Yu-Gi-Oh! (CardTrader gioco 4, 691 espansioni, 4 novembre 2026): la 1ª edizione è una proprietà dell'offerta
  // ("first_edition"), come per i Pokémon: stima delle unlimited in "en" e delle 1ª edizione in "en1" (splitFirst). Il numero
  // del blueprint è solo "001": nel catalogo diventa "LOB-001" col codice dell'espansione (numberWithSet).
  // photosByName: una carta senza foto prende quella di un'altra stampa con lo stesso nome (sharedPhotos); solo Yu-Gi-Oh!, dove lo
  // stesso nome è la stessa carta (in One Piece "Monkey.D.Luffy" sono decine di carte diverse).
  yugioh: { label: "Yu-Gi-Oh!", match: "yu-gi-oh", langs: YUGIOH_LANGS, rarity: "yugioh_rarity", splitFirst: true, numberWithSet: true, photosByName: true },
};

/**
 * Carte senza foto su CardTrader con quella della stessa carta in un'altra stampa del catalogo (0.9.160, richiesto dall'utente:
 * foto da altre fonti prima di eBay; il 7 novembre 2026 senza foto 588 carte Dragon Ball e 669 Yu-Gi-Oh!): stesso numero
 * ("BT10-008" Non-Holo = la Holo), lo stesso numero senza le lettere della stampa ("P-540c" Silver Foil = "P-540",
 * "BT17-135l2" Judge Pack = "BT17-135") e, con [byName], lo stesso nome. Restituisce quante ne ha sistemate.
 */
export function sharedPhotos(cards, { byName = false } = {}) {
  const base = (n) => String(n ?? "").replace(/[a-z]+\d*$/, "");
  // Stesso numero non basta: in Lorcana i numeri si ripetono in ogni set e CardTrader ha qualche numero sbagliato ("BT15-119"
  // Forbidden Power e Hire-Dragon's Home). Serve anche lo stesso nome, a meno di due lettere ("Krillian" = "Krillin") o
  // dell'ordine delle due facce dei leader ("Trunks // SS Trunks" = "SS Trunks // Trunks").
  const plain = (n) => String(n ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const faces = (n) => String(n ?? "").split("//").map(plain).sort().join("|");
  const sameName = (a, b) => faces(a) === faces(b) || editDistance(plain(a), plain(b)) <= 2;
  const byNum = new Map();
  const byBase = new Map();
  const byCardName = new Map();
  const add = (m, k, c) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  };
  for (const c of cards) {
    if (!c.img) continue;
    add(byNum, c.num, c);
    add(byBase, base(c.num), c);
    const n = String(c.n ?? "").toLowerCase();
    if (n && !byCardName.has(n)) byCardName.set(n, c.img);
  }
  let n = 0;
  for (const c of cards) {
    if (c.img) continue;
    const twin = [...(byNum.get(c.num) ?? []), ...(byBase.get(base(c.num)) ?? [])].find((o) => sameName(o.n, c.n));
    const img = twin?.img || (byName ? byCardName.get(String(c.n ?? "").toLowerCase()) : null);
    if (img) {
      c.img = img;
      n++;
    }
  }
  return n;
}

/** Distanza tra due parole (lettere da cambiare, togliere o aggiungere), per i nomi scritti quasi uguali. */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Numero Yu-Gi-Oh! normalizzato per confronti ("lob-001"): codice del set + numero senza la regione ("MP16-EN198" ->
 * "mp16-198", "CIBR-ENSE4" -> "cibr-se4", "AST-009" -> "ast-009"). [setCode] serve quando il numero è solo "001"
 * (blueprint CardTrader); i codici delle espansioni OCG ("cibr-jp") e delle ristampe ("rp01-2024") perdono il suffisso.
 */
export function yugiohKey(number, setCode = "") {
  // "lob en001" scritto con lo spazio al posto del trattino: lo spazio diventa il trattino.
  const raw = String(number || "").trim().toUpperCase();
  const n = (raw.includes("-") ? raw : raw.replace(/\s+/, "-")).replace(/\s+/g, "");
  if (!n) return null;
  const code = String(setCode || "").split("-")[0].toLowerCase();
  // Regioni: "EN", "FR"... e, nelle prime stampe europee, una lettera sola seguita dal numero ("SDD-E003", "LOB-G001").
  // Le lettere dopo il numero sono la stampa ("MRD-143sec" = Secret Rare di CardTrader): non fanno parte della chiave.
  const m = n.match(/^(?:([A-Z0-9]+)-)?(?:EN|FR|DE|IT|SP|PT|JP|KR|AE|TC|SC|EU|[EFGISP](?=\d))?([A-Z]{0,3}\d+)[A-Z]*$/);
  if (!m) return null;
  const set = (m[1] || "").toLowerCase() || code;
  if (!set) return null;
  return `${set}-${m[2].toLowerCase()}`;
}

/**
 * true se il blueprint esiste sia normale sia foil: tra le proprietà che il venditore sceglie sull'offerta
 * (`editable_properties`) ce n'è una "…_foil". Solo per queste carte le offerte foil restano fuori dalla stima
 * (`excludeFoil`). Una carta che esiste solo foil (Dragon Ball: Rare, Super Rare, Special Rare, Secret Rare, Alternate
 * Art, Leader...) non ha quella proprietà, e CardTrader segna comunque "dragonball_foil: true" tutte le sue offerte:
 * scartandole restava senza prezzo. Visto sulle offerte vere il 18 novembre 2026 (workflow "Esplora CardTrader"): le tre
 * offerte della Super Rare EB1-62 (0,71 / 1,28 / 5,32 €), che il 3 novembre avevano "dragonball_foil: false", hanno
 * "true"; nel catalogo del 17 novembre 4.788 carte delle rarità solo foil su 4.807 erano senza prezzo (tutte le Super
 * Rare, Special Rare, Secret Rare, Alternate Art e Leader; 18 Rare su 2.018 con un prezzo).
 */
export function hasFoilChoice(bp) {
  const props = Array.isArray(bp?.editable_properties) ? bp.editable_properties : [];
  return props.some((p) => String((p && typeof p === "object" ? p.name : p) ?? "").toLowerCase().endsWith("_foil"));
}

/** Carte gradate: si leggono le offerte solo delle carte che valgono almeno tanto (euro, non gradate). */
const GRADED_MIN_PRICE = 10;

/**
 * Offerta "segnaposto": alcuni venditori mettono le carte a 5.000, 10.000, 15.000 € (più qualche
 * centesimo di commissione) per tenerle in vetrina senza venderle. Visto sui dati reali di
 * ottobre 2026: 76 stime di questo tipo. Meglio nessun prezzo che uno finto.
 */

/** Una stampa (One Piece, Lorcana) da un blueprint CardTrader; null per i prodotti sigillati. */
export function cardFromBlueprint(bp, rarityKey = "onepiece_rarity") {
  const num = bp?.fixed_properties?.collector_number;
  if (!num) return null;
  const version = typeof bp.version === "string" && bp.version.trim() ? bp.version.trim() : null;
  return {
    id: bp.id,
    n: String(bp.name || "").trim(),
    num: String(num).trim(),
    r: bp.fixed_properties?.[rarityKey] || null,
    v: version,
    s: bp.expansion_id,
    img: bp.image?.show?.url || bp.image?.url || null,
  };
}

/**
 * Tendenza Cardmarket di ogni carta (campo "cmt": [normale, foil] in euro, 0 dove manca) dal listino del gioco ([guide]) e dai
 * prodotti che CardTrader collega a ogni stampa ([cmIds]). Serve all'app per il controllo dei prezzi da 1-2 offerte (punto 4
 * della riverifica del 19 novembre 2026: Dragon Ball Time's Choice 103 promo a 7.188,66 € su un'offerta, Cardmarket 9,65 €).
 * Con più prodotti per una stampa, il primo con una tendenza. Restituisce quante carte ce l'hanno.
 */
export function addCmTrends(data, cmIds, guide) {
  const byId = new Map((guide?.priceGuides || []).map((g) => [Number(g.idProduct), g]));
  let n = 0;
  for (const c of data.cards || []) {
    delete c.cmt;
    const g = (cmIds?.get(c.id) || []).map((id) => byId.get(id)).find((x) => x && (x.trend > 0 || x["trend-foil"] > 0));
    if (!g) continue;
    const r = (x) => (x > 0 ? Math.round(x * 100) / 100 : 0);
    c.cmt = [r(g.trend), r(g["trend-foil"])];
    n++;
  }
  return n;
}

export async function buildOnePiece(opts) {
  return buildCtGame({ ...CT_GAMES.onepiece, ...opts });
}

export async function buildLorcana(opts) {
  return buildCtGame({ ...CT_GAMES.lorcana, ...opts });
}

export async function buildDragonBall(opts) {
  return buildCtGame({ ...CT_GAMES.dragonball, ...opts });
}

export async function buildYuGiOh(opts) {
  return buildCtGame({ ...CT_GAMES.yugioh, ...opts });
}

/**
 * Scrive nella carta [c] le stime della lingua [lang] dalle offerte [usable] (già senza prezzi segnaposto e foil da
 * escludere), togliendo quelle di prima: `c[lang]`, `c[lang + "1"]` (Yu-Gi-Oh!, [splitFirst]) e i prezzi per condizione
 * `c.c[lang]`. Restituisce true se la carta ha un prezzo nella lingua.
 */
function priceCard(c, lang, usable, splitFirst = false, foil = null) {
  delete c[lang];
  delete c[`${lang}1`];
  if (c.c) {
    delete c.c[lang];
    if (Object.keys(c.c).length === 0) delete c.c;
  }
  // Yu-Gi-Oh!: le 1ª edizione a parte ("en1", stima "f" di estimate); il prezzo base è quello delle unlimited ("n", che
  // scarta le 1ª edizione), e se una carta ha solo offerte di 1ª edizione (molti set recenti) il base è quello.
  // Foil (splitFoil): le offerte foil a parte nel campo della seconda versione ("en1"), [usable] sono le sole normali.
  const firstEst = foil ? estimate(foil, "n", "EUR", { thinLowest: true }) : splitFirst ? estimate(usable, "f", "EUR", { thinLowest: true }) : null;
  const est = estimate(usable, "n", "EUR", { thinLowest: true }) ?? (foil ? null : firstEst);
  if (firstEst) c[`${lang}1`] = firstEst;
  if (!est) return !!firstEst;
  c[lang] = est;
  // Condizione misurata sul mercato (come "nc" dei file di lingua Pokémon): condizione -> [prezzo così com'è, offerte].
  const cond = conditionPrices(usable, "n");
  if (cond) (c.c ||= {})[lang] = cond;
  return true;
}

/** Da tanti euro in su lo stesso prezzo su più carte diverse non è un caso... */
const REPEAT_MIN_PRICE = 5000;
/** ...se le carte sono almeno tante... */
const REPEAT_MIN_CARDS = 3;

/**
 * I prezzi "per non vendere" riconosciuti perché lo stesso venditore li mette su carte diverse (18 novembre 2026): nei
 * cataloghi del 17 novembre 10.225,00 € era l'unica offerta, o quella che decideva la stima, di sei carte Yu-Gi-Oh! di sei
 * set diversi (Mist Wurm DT01-032; Copycat DEM6-014, Giant Germ SRL25-085 e Twin-Headed Behemoth DB2-174 in 1ª edizione,
 * comuni da meno di 3 €; Supreme Arcanite Magician STBL-038ul; Chain Energy MRL-046, comune da 0,84 €, valutata
 * 25.562,50 € perché l'offerta era "Played" e si riporta a Near Mint), e 10.260,02 / 10.260,03 € di cinque comuni e non
 * comuni Dragon Ball. Non sono cifre tonde ([isPlaceholderPrice] non le vede) e con una sola offerta nessun confronto
 * dentro la carta le ferma ([isAbsurdPrice] vuole tre offerte).
 *
 * Regola: un prezzo da [REPEAT_MIN_PRICE] in su (arrotondato all'euro: la commissione sposta i centesimi) che compare su
 * almeno [REPEAT_MIN_CARDS] carte diverse del gioco, non tutte dello stesso set e rarità. Sotto i 5.000 € le cifre tonde
 * si ripetono davvero (One Piece: 2.500,64 € su tre premi di torneo diversi, 3.500,64 € su tre, 1.200,64 € su cinque
 * Manga: prezzi veri); sopra, nei quattro cataloghi del 17 novembre, si ripetono solo quei due. Le carte "sorelle" (stesso
 * set e stessa rarità, come le Grand Master Rare di Yu-Gi-Oh! a 7.500,64 e 7.500,63 €) possono avere lo stesso prezzo vero.
 * @param {Map<number, Set<number>>} seen prezzo in euro -> id delle carte su cui compare
 * @param {(id: number) => ({s?: number, r?: string|null}|undefined)} cardOf
 * @returns {Set<number>} i prezzi finti (in euro, arrotondati)
 */
export function repeatedPrices(seen, cardOf) {
  const out = new Set();
  for (const [price, ids] of seen) {
    if (price < REPEAT_MIN_PRICE || ids.size < REPEAT_MIN_CARDS) continue;
    const groups = new Set([...ids].map((id) => `${cardOf(id)?.s ?? ""}|${cardOf(id)?.r ?? ""}`));
    if (groups.size >= 2) out.add(price);
  }
  return out;
}

// Stime fatte da una o due offerte: qui la stima è il prezzo della carta, e un'offerta fuori dal mondo lo decide da sola
// (9 novembre 2026: "Dark Magician Knight LCYW-028", comune da 10 €, a 24,7 milioni; "Son Goku FB05-053" a 1.200 € con
// una offerta ed eBay a 2 €; 196 stime inglesi Yu-Gi-Oh! da 200 € in su con una o due offerte).
const THIN_OFFERS = 2;
const THIN_MIN_PRICE = 50; // sotto, un errore pesa poco e le carte da pochi euro hanno prezzi molto sparsi
const THIN_MAX_OTHER = 10; // volte la stessa carta in un'altra lingua con almeno 3 offerte
const THIN_MAX_SET = 20; // volte la mediana delle carte dello stesso set, rarità e stampa con almeno 3 offerte
const THIN_MIN_SAMPLES = 5;
/**
 * Stime con tre o più offerte: fuori solo oltre tante volte la stessa carta in un'altra lingua con almeno 3 offerte.
 * Misurato sul catalogo Yu-Gi-Oh! del 17 novembre 2026: a 10 volte (la soglia delle stime con una o due offerte) si
 * toglierebbero prezzi veri, perché le 1ª edizioni inglesi dei primi set valgono davvero 10-20 volte le altre lingue
 * (Dark Magician SDY-006 1ª ed. 406,14 € su 6 offerte contro 20,44 € in italiano, 19,9 volte, con TCGplayer a 234 €;
 * Raigeki LOB-053 233,36 € contro 20,40 €, TCGplayer 199 €). Oltre 30 volte ci sono solo errori: Solemn Judgment
 * MAGO-051 615,87 € su 5 offerte (italiano 5,86 €, TCGplayer 2,00 €, tendenza Cardmarket 1,66 €), Smashing Ground DR2-094
 * comune 401,86 € su 3 (italiano 1,64 € su 12), Brain Jacker DR3-154 359,52 € su 4, Jurrac Gallim WGRT-038 comune 171,08 €.
 */
const SOLID_MAX_OTHER = 30;

/**
 * Toglie le stime da [THIN_MIN_PRICE] € in su fuori dal mondo rispetto alla stessa carta nelle altre lingue:
 *  - con al massimo [THIN_OFFERS] offerte, oltre [THIN_MAX_OTHER] volte la stima di un'altra lingua (almeno 3 offerte) o, se
 *    nessun'altra lingua ne ha, oltre [THIN_MAX_SET] volte la mediana delle carte dello stesso set, rarità e stampa (almeno
 *    [THIN_MIN_SAMPLES] con 3 offerte). Le stampe speciali (Manga, Alternate Art, Serial...) si confrontano solo tra loro:
 *    di solito non hanno abbastanza compagne e restano;
 *  - con tre o più offerte (18 novembre 2026), oltre [SOLID_MAX_OTHER] volte la stima di un'altra lingua (almeno 3 offerte):
 *    anche cinque offerte possono essere tutte fuori mercato.
 * Yu-Gi-Oh!: quando la carta ha solo offerte di 1ª edizione il prezzo base è la stessa stima (vedi priceCard): tolta una,
 * va via anche l'altra, se no la copia unlimited resterebbe senza prezzo e quella di 1ª edizione col prezzo sbagliato.
 * La carta resta senza prezzo in quella lingua (l'app usa le altre lingue col rapporto, o eBay). Restituisce quante ne toglie.
 */
export function dropThinOutliers(cards, langs) {
  let dropped = 0;
  for (const suffix of ["", "1"]) {
    const keys = langs.map((l) => `${l}${suffix}`);
    for (const key of keys) {
      const groups = new Map();
      const groupOf = (c) => `${c.s}|${c.r || ""}|${c.v || ""}`;
      for (const c of cards) {
        const e = c[key];
        if (!e || e[1] <= THIN_OFFERS) continue;
        const g = groupOf(c);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(e[0]);
      }
      const medians = new Map();
      for (const [g, list] of groups) if (list.length >= THIN_MIN_SAMPLES) medians.set(g, medianOf(list));
      for (const c of cards) {
        const e = c[key];
        if (!e || e[0] < THIN_MIN_PRICE) continue;
        const others = keys.filter((k) => k !== key && c[k] && c[k][1] > THIN_OFFERS).map((k) => c[k][0]);
        let absurd;
        if (e[1] <= THIN_OFFERS) {
          const ref = medians.get(groupOf(c));
          absurd = others.length ? e[0] > THIN_MAX_OTHER * Math.max(...others) : ref !== undefined && e[0] > THIN_MAX_SET * ref;
        } else {
          absurd = others.length > 0 && e[0] > SOLID_MAX_OTHER * Math.max(...others);
        }
        if (!absurd) continue;
        // La stessa stima scritta anche per l'altra edizione (solo offerte di 1ª edizione): va via insieme.
        const twin = suffix ? key.slice(0, -1) : `${key}1`;
        if (c[twin] && c[twin][0] === e[0] && c[twin][1] === e[1]) {
          delete c[twin];
          dropped++;
        }
        delete c[key];
        // La condizione misurata era sulle stesse offerte.
        if (c.c && !c[key.replace(/1$/, "")]) {
          delete c.c[key.replace(/1$/, "")];
          if (Object.keys(c.c).length === 0) delete c.c;
        }
        dropped++;
      }
    }
  }
  return dropped;
}

function medianOf(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Catalogo e prezzi di un gioco preso tutto da CardTrader (vedi CT_GAMES). */
async function buildCtGame({ ct, label = "One Piece", match = "one piece", rarity = "onepiece_rarity", langs = ONE_PIECE_LANGS, excludeFoil = false, splitFoil = false, splitFirst = false, numberWithSet = false, photosByName = false, maxExpansions = Infinity, now = new Date() }) {
  const log = [];
  const games = items(await ct.get("games"));
  const game = games.find((g) => `${g.name} ${g.display_name || ""}`.toLowerCase().includes(match));
  if (!game) throw new Error(`${label} non trovato tra i giochi di CardTrader`);
  const expansions = (await ct.expansions(game.id)).slice(0, maxExpansions);

  const sets = [];
  const cards = [];
  const byId = new Map();
  // Prodotti Sealed (box, buste, mazzi...): blueprint senza numero di carta, collegati a Cardmarket.
  // Stessi dati dei Sealed Pokémon, per buildSealed (sealed.js).
  const sealedBp = new Map(); // blueprint -> [prodotti Cardmarket]
  const sealedExps = [];
  const sealed = { cmToCtExp: new Map(), ctExpNames: new Map(), ctExpLangs: new Map(), ctProducts: new Map(), ctPrices: {}, ctUnlinked: [] };
  // Blueprint che esistono normali e foil (hasFoilChoice): solo per loro le offerte foil restano fuori (excludeFoil).
  const foilChoice = new Set();
  const cmIds = new Map(); // blueprint della carta -> prodotti Cardmarket
  for (const e of expansions) {
    let bps;
    try {
      bps = await ct.blueprints(e.id);
    } catch (err) {
      log.push(`! ${label}, blueprint ${e.name}: ${err.message}`);
      continue;
    }
    sealed.ctExpNames.set(e.id, e.name);
    const langCount = new Map();
    let hasSealed = false;
    for (const bp of bps) {
      if (hasFoilChoice(bp)) foilChoice.add(bp.id);
      const l = blueprintLanguage(bp);
      if (l) langCount.set(l, (langCount.get(l) || 0) + 1);
      const ids = (bp.card_market_ids || []).map(Number).filter(Number.isFinite);
      for (const id of ids) sealed.cmToCtExp.set(id, e.id);
      // Prodotti Cardmarket di ogni stampa, per la tendenza della carta (addCmTrends, campo "cmt").
      if (ids.length && bp?.fixed_properties?.collector_number) cmIds.set(bp.id, ids);
      if (bp?.fixed_properties?.collector_number) continue;
      // Sigillati CardTrader non collegati a Cardmarket: solo per la loro foto (per nome, in sealed.js).
      if (ids.length === 0) {
        const img = bp.image?.show?.url || bp.image?.url || null;
        if (img) sealed.ctUnlinked.push({ bp: bp.id, name: bp.name, img, lang: blueprintLanguage(bp), ctExp: e.id });
        continue;
      }
      sealedBp.set(bp.id, ids);
      hasSealed = true;
      for (const id of ids) sealed.ctProducts.set(id, { bp: bp.id, img: bp.image?.show?.url || bp.image?.url || null, lang: blueprintLanguage(bp) });
    }
    const expLang = [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (expLang) sealed.ctExpLangs.set(e.id, expLang);
    if (hasSealed) sealedExps.push(e);
    const setCards = bps.map((bp) => cardFromBlueprint(bp, rarity)).filter(Boolean);
    // Yu-Gi-Oh!: il numero del blueprint è solo "001": col codice dell'espansione diventa "LOB-001" (come lo scrivono
    // Collectr e TCGplayer, senza la regione "EN").
    if (numberWithSet) {
      const code = String(e.code || "").split("-")[0].toUpperCase();
      for (const c of setCards) if (code && !c.num.includes("-")) c.num = `${code}-${c.num}`;
    }
    if (setCards.length === 0) continue;
    sets.push({ id: e.id, code: e.code || "", name: e.name, n: setCards.length });
    for (const c of setCards) {
      cards.push(c);
      byId.set(c.id, c);
    }
  }
  log.push(`${label}: ${sets.length} espansioni con carte, ${cards.length} carte`);
  const shared = sharedPhotos(cards, { byName: photosByName });
  log.push(`${label}: ${shared} carte senza foto con quella di un'altra stampa (restano ${cards.filter((c) => !c.img).length})`);
  if (excludeFoil || splitFoil) {
    const both = cards.filter((c) => foilChoice.has(c.id)).length;
    // Le carte con la scelta normale/foil: nell'app la finitura si sceglie anche senza offerte foil (campo "fb").
    if (splitFoil) for (const c of cards) if (foilChoice.has(c.id)) c.fb = 1;
    log.push(`${label}: ${both} carte normali e foil (${splitFoil ? "stima della foil a parte" : "le foil fuori dalla stima"}), ${cards.length - both} in una sola finitura (tutte le offerte)`);
    // Senza nessuna carta con la scelta la risposta di CardTrader è cambiata: le foil contano per tutte, meglio saperlo.
    if (cards.length > 0 && both === 0) log.push(`! ${label}: nessun blueprint con la scelta normale/foil, le offerte foil contano per tutte le carte`);
  }

  const setIds = new Set(sets.map((s) => s.id));
  const toRead = [...sets, ...sealedExps.filter((e) => !setIds.has(e.id))];
  const highPrices = new Map(); // prezzo in euro (arrotondato) -> blueprint su cui compare, in tutte le lingue
  const highOffers = []; // { c, lang, usable } delle carte con un'offerta da REPEAT_MIN_PRICE in su
  for (const lang of langs) {
    let priced = 0;
    let failures = 0;
    const sealedPrices = new Map();
    for (const s of toRead) {
      let byBp;
      try {
        byBp = await ct.offersByExpansion(s.id, lang);
      } catch (err) {
        failures++;
        if (/Token/.test(err.message)) throw err;
        continue;
      }
      for (const [bpId, offers] of byBp) {
        const sealedIds = sealedBp.get(bpId);
        if (sealedIds) {
          const est = sealedEstimate(offers);
          if (est) for (const id of sealedIds) sealedPrices.set(id, est);
          continue;
        }
        const c = byId.get(bpId);
        if (!c) continue;
        // Le foil fuori solo per le carte che esistono anche normali (hasFoilChoice): le altre hanno solo offerte foil.
        // Con splitFoil quelle foil fanno la stima della foil ("en1").
        const both = foilChoice.has(bpId);
        const split = splitFoil && both;
        const usable = offers.filter((o) => !isPlaceholderPrice(o.price) && !((excludeFoil || split) && o.foil === true && both));
        const foil = split ? offers.filter((o) => !isPlaceholderPrice(o.price) && o.foil === true) : null;
        // Prezzi alti: si contano le carte su cui compare lo stesso prezzo (repeatedPrices), e le offerte di quelle carte
        // restano da parte per rifare la stima senza i prezzi finti.
        const high = usable.filter((o) => !o.graded && o.price >= REPEAT_MIN_PRICE);
        if (high.length) {
          for (const o of high) {
            const k = Math.round(o.price);
            if (!highPrices.has(k)) highPrices.set(k, new Set());
            highPrices.get(k).add(bpId);
          }
          highOffers.push({ c, lang, usable, foil });
        }
        if (priceCard(c, lang, usable, splitFirst, foil)) priced++;
      }
    }
    // Lingua dell'app: "jp" di CardTrader = "ja".
    sealed.ctPrices[lang === "jp" ? "ja" : lang] = sealedPrices;
    log.push(`${label} ${lang}: ${priced} carte con offerte${failures ? `, ${failures} espansioni non lette` : ""}`);
  }
  // Lo stesso prezzo alto su carte diverse è il prezzo "per non vendere" di un venditore: fuori, e le stime si rifanno.
  const fake = repeatedPrices(highPrices, (id) => byId.get(id));
  if (fake.size) {
    let redone = 0;
    for (const { c, lang, usable, foil } of highOffers) {
      const real = (o) => !(!o.graded && o.price >= REPEAT_MIN_PRICE && fake.has(Math.round(o.price)));
      const kept = usable.filter(real);
      const keptFoil = foil?.filter(real) ?? null;
      if (kept.length === usable.length && (keptFoil?.length ?? 0) === (foil?.length ?? 0)) continue;
      priceCard(c, lang, kept, splitFirst, keptFoil);
      redone++;
    }
    log.push(`${label}: ${fake.size} prezzi "per non vendere" ripetuti su carte diverse (${[...fake].sort((a, b) => a - b).join(", ")} €), ${redone} stime rifatte senza`);
  }
  const dropped = dropThinOutliers(cards, langs);
  if (dropped) log.push(`${label}: ${dropped} stime scartate (una o due offerte oltre ${THIN_MAX_OTHER} volte le altre lingue o ${THIN_MAX_SET} volte le carte del set; tre o più offerte oltre ${SOLID_MAX_OTHER} volte le altre lingue)`);
  const coef = languageCoefficients(cards, langs, log, label);
  const foilCoef = splitFoil ? foilCoefficient(cards, log, label, new Map(sets.map((x) => [x.id, x.name]))) : null;
  // Carte gradate: le offerte di una carta alla volta (tutte le lingue insieme), solo per le carte
  // di valore. Prezzo per ente, voto e lingua: stessa stima delle carte non gradate.
  const valuable = cards.filter((c) => Math.max(...langs.map((l) => c[l]?.[0] || 0)) >= GRADED_MIN_PRICE);
  let withGraded = 0;
  for (const c of valuable) {
    let byBp;
    try {
      byBp = await ct.offersByBlueprint(c.id);
    } catch (err) {
      if (/Token/.test(err.message)) throw err;
      continue;
    }
    const groups = {};
    for (const o of byBp) {
      if (!o.graded || isPlaceholderPrice(o.price)) continue;
      const g = parseGrade(o.description);
      const lang = langs.includes(o.language) ? o.language : null;
      if (!g || !lang) continue;
      const key = `${g.grader} ${g.grade}`;
      ((groups[lang] ||= {})[key] ||= []).push({ ...o, graded: false, condition: "Near Mint" });
    }
    const out = {};
    for (const [lang, byGrade] of Object.entries(groups)) {
      for (const [key, offers] of Object.entries(byGrade)) {
        const est = estimate(offers, "n");
        if (est) (out[lang] ||= {})[key] = est;
      }
    }
    if (Object.keys(out).length) {
      c.g = out;
      withGraded++;
    }
  }
  log.push(`${label} gradate: ${valuable.length} carte di valore lette, ${withGraded} con offerte gradate riconoscibili`);
  log.push(`${label} Sealed su CardTrader: ${sealedBp.size} blueprint collegati a Cardmarket`);
  return { data: { v: 1, updated: now.toISOString(), sets, cards, coef, ...(foilCoef ? { foil: foilCoef } : {}) }, sealed, cmIds, log };
}

/** Offerte minime della normale e della foil (in inglese) perché una carta conti nel rapporto foil/normale. */
const FOIL_MIN_OFFERS = 3;

/**
 * Carte su cui misurare il rapporto di un set (A4 della riverifica, 19 novembre 2026): sotto, il set non ha un rapporto suo e
 * vale quello del gioco. Il set «Errata Cards» di Lorcana aveva 50 volte su 6 carte (normali delle carte errata a 0,11 €,
 * foil a 13-37 €). Lo stesso numero in FOIL_SET_MIN dell'app (OnePiece.kt).
 */
export const FOIL_SET_MIN = 10;

// Parole della rarità o della versione, e del nome del set, che dicono promo, timbrate, premi ed edizioni particolari.
// Le stesse dell'app (CtFoil in OnePiece.kt): lì una foil senza offerte foil di queste carte resta senza prezzo.
const FOIL_SPECIAL_PRINT = /\b(promo|promos|stamp|stamped|pre ?release|prerelease|championship|top \d+|winner|judge|event|gold|silver|iconic|challenge|quest|oversized|errata|misprint|tournament|anniversary|serial|convention|store|league|prize|celebration|limited)\b/;
const FOIL_SPECIAL_SET = /\b(promo|promos|pre ?release|prerelease|errata|challenge|event|quest|oversized|championship|prize|league|store|convention|celebration)\b/;
const foilNorm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Una carta di set, non promo, timbrata o premio (A4 della riverifica, 19 novembre 2026, approvato dall'utente): solo per
 * queste il rapporto foil/normale dice quanto vale la foil. Prima valeva anche per le promo (Mickey Mouse - Brave Little
 * Tailor 1/P1 foil 8.575 € = 3.253 € × 2,636, tendenza Cardmarket 1.113 €) e le «Pre-Release Stamped» di Dragon Ball
 * (Chiaotzu BT7-064 246 € = 65,64 € × 3,75, tendenza foil Cardmarket 8,36 €).
 */
export function isFoilSetCard(card, setName = "") {
  return !FOIL_SPECIAL_PRINT.test(foilNorm(`${card.r || ""} ${card.v || ""}`)) && !FOIL_SPECIAL_SET.test(foilNorm(setName));
}

/**
 * Quanto vale la foil rispetto alla normale in un gioco con la finitura da scegliere (splitFoil: Lorcana e Dragon Ball,
 * 19 novembre 2026): mediana di foil / normale delle carte con almeno [FOIL_MIN_OFFERS] offerte inglesi di tutte e due, in
 * totale (`all`) e per espansione (da FOIL_SET_MIN carte, solo carte di set: isFoilSetCard), come il rapporto tra le lingue. Serve alle copie foil senza offerte foil:
 * prezzo = normale × rapporto. Nessun limite a 5 come per le lingue: una foil comune di Dragon Ball vale anche 10 volte la
 * normale da pochi centesimi.
 * @returns {{all: [number, number], [exp]: [number, number]} | null}
 */
export function foilCoefficient(cards, log = [], label = "", setNames = new Map()) {
  const byExp = new Map();
  for (const c of cards) {
    if (c.fb !== 1 || !(c.en?.[0] > 0) || !(c.en1?.[0] > 0)) continue;
    // Solo le carte di set (A4): il rapporto si applica solo a loro.
    if (!isFoilSetCard(c, setNames.get(c.s))) continue;
    if (c.en[1] < FOIL_MIN_OFFERS || c.en1[1] < FOIL_MIN_OFFERS) continue;
    const r = Math.min(50, Math.max(1, c.en1[0] / c.en[0]));
    if (!byExp.has(c.s)) byExp.set(c.s, []);
    byExp.get(c.s).push(r);
  }
  const all = [...byExp.values()].flat();
  if (all.length === 0) {
    log.push(`${label}: nessuna carta con offerte normali e foil per il rapporto foil/normale`);
    return null;
  }
  const med = (list) => {
    const s = [...list].sort((a, b) => a - b);
    const m = s.length >> 1;
    return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 1000) / 1000;
  };
  const out = { all: [med(all), all.length] };
  for (const [exp, list] of byExp) if (list.length >= FOIL_SET_MIN) out[exp] = [med(list), list.length];
  log.push(`${label} rapporto foil/normale: ${out.all[0]} su ${out.all[1]} carte`);
  return out;
}

/**
 * Rapporto lingua/inglese di un gioco CardTrader (come `coefficients` dei file di lingua Pokémon): mediana dei rapporti
 * delle carte con offerte in entrambe le lingue, in totale (`all`) e per espansione, con la soglia di offerte scelta da
 * pickThreshold, solo sulle carte da MIN_PREMIUM_PRICE in su in inglese. Serve alle copie in una lingua senza offerte (Gaston promo in italiano: solo offerte inglesi):
 * prezzo = inglese × rapporto, invece di nessun prezzo. Francese, spagnolo e portoghese prendono sempre quello
 * dell'italiano (`from: "it"`), come per i Pokémon.
 * @returns {{[lang]: {all: [number, number], [exp]: [number, number], from?: string}}}
 */
export function languageCoefficients(cards, langs, log = [], label = "") {
  const out = {};
  for (const lang of langs) {
    if (lang === "en") continue;
    const samples = [];
    for (const c of cards) {
      // Le comuni a prezzo minimo (Lorcana: inglese mediano 0,14 €, 7 carte su 10 sotto 0,50 €) hanno lo stesso prezzo in ogni
      // lingua e dicono poco: contano solo le carte da MIN_PREMIUM_PRICE in su in inglese (italiano 90% invece di 100%).
      if (!(c.en?.[0] >= MIN_PREMIUM_PRICE) || !c[lang]?.[0]) continue;
      samples.push({ exp: c.s, ratio: c[lang][0] / c.en[0], offers: Math.min(c[lang][1], c.en[1]) });
    }
    const k = coefficients(samples);
    if (!k.all) continue;
    out[lang] = k;
    log.push(`${label} rapporto ${lang}/en: ${Math.round(k.all[0] * 100)}% su ${k.all[1]} carte`);
  }
  // Francese, spagnolo, portoghese e tedesco: sempre il rapporto dell'italiano (come per i Pokémon, RATIO_FROM_IT), anche
  // se ne hanno uno proprio: con poche offerte è gonfiato (Lorcana tedesco 123% su 50 carte).
  if (out.it) {
    for (const lang of RATIO_FROM_IT) {
      if (!langs.includes(lang)) continue;
      out[lang] = { ...structuredClone(out.it), from: "it" };
      log.push(`${label} rapporto ${lang}/en: quello dell'italiano`);
    }
  }
  return out;
}
