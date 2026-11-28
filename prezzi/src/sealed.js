// Prodotti sigillati Pokémon: box di buste, Elite Trainer Box, buste, tin, blister, mazzi, collezioni.
// Catalogo e prezzo di tendenza dal listino pubblico di Cardmarket (un prezzo per tutte le lingue);
// foto e prezzi per lingua dalle offerte CardTrader dei blueprint collegati allo stesso prodotto
// Cardmarket (solo confezioni sigillate: le offerte "sealed: false" sono aperte).
// I prodotti asiatici (giapponesi, cinesi, coreani...) esistono in una sola lingua: hanno "l".
//
// Output (v1/sealed.json):
//   { v, updated,
//     exp: { idEspansioneCardmarket: nome },             // nome dell'espansione CardTrader
//     p:   [{ id: idProdottoCardmarket, n: nome, t: tipo, e: idEspansione, d: "AAAA-MM-GG",
//             l: lingua del prodotto asiatico ("ja", "zh-cn", "zh-tw", "ko", "th", "id") | assente,
//             img: percorso foto CardTrader | null, bp: blueprint CardTrader | null,
//             cm: { trend, low, avg30 } | null,         // euro, listino Cardmarket
//             ct: { lingua: [prezzo, offerte] } }] }    // euro, offerte CardTrader per lingua ("ja" = giapponese)
import { estimate, coefficients, median, RATIO_FROM_IT } from "./stats.js";
import { isPlaceholderPrice } from "./onepiece.js";

/** Categorie Cardmarket dei prodotti sigillati -> tipo nell'app. Esclusi monete e lotti. */
const SEALED_TYPES = {
  "Pokémon Display": "display",
  "Pokémon Elite Trainer Boxes": "etb",
  "Pokémon Booster": "booster",
  "Pokémon Tins": "tin",
  "Pokémon Box Set": "box",
  "Pokémon Blisters": "blister",
  "Pokémon Theme Decks": "deck",
  "Pokémon Trainer Kits": "kit",
};

/** One Piece: categorie Cardmarket -> tipo nell'app. Esclusi i lotti (set di carte singole). */
export const ONE_PIECE_SEALED_TYPES = {
  "One Piece Booster Boxes": "display",
  "One Piece Booster": "booster",
  "One Piece Preconstructed Decks": "deck",
  "One Piece Promo Products": "box",
};

/** Lorcana: categorie Cardmarket -> tipo nell'app. Esclusi i lotti. */
export const LORCANA_SEALED_TYPES = {
  "Lorcana Booster Boxes": "display",
  "Lorcana Booster": "booster",
  "Lorcana Starter Decks": "deck",
  "Lorcana Box Set": "box",
  "Lorcana Gift Set": "box",
  "Lorcana Sets": "box",
};

/** Dragon Ball Super (Cardmarket gioco 13, Fusion World compreso): categorie -> tipo nell'app. Esclusi lotti e "DBS Set". */
/** Sigillati Yu-Gi-Oh! (Cardmarket gioco 3): "Yugioh Lot" ed "Event Tickets" esclusi. */
export const YUGIOH_SEALED_TYPES = {
  "Yugioh Display": "display",
  "Yugioh Booster": "booster",
  "Yugioh Structure Deck": "deck",
  "Yugioh Starter Deck": "deck",
  "Yugioh Special Edition": "box",
  "Yugioh Promo Products": "box",
  "Yugioh Collector Tins": "tin",
};

export const DRAGON_BALL_SEALED_TYPES = {
  "Dragon Ball Super Booster Boxes": "display",
  "Dragon Ball Super Boosters": "booster",
  "Dragon Ball Super Starter Decks": "deck",
  "Dragon Ball Super Expansion Sets": "box",
  "Dragon Ball Super Special Packs": "box",
  "Dragon Ball Super Draft Boxes": "box",
};

/** Lingue dei prezzi CardTrader (codici dell'app; il giapponese su CardTrader è "jp"). */
export const SEALED_LANGS = ["en", "it", "fr", "de", "es", "pt", "ja"];

// Prodotti asiatici: "JP Booster Box", "Chinese ...", "CSV10.5C: ... S-Ch", espansioni "CSV7: Blade Awakening".
const ASIAN = /\b(JP|Japan|Japanese|Chinese|S-Ch|T-Ch|Korean|Thai|Indonesian)\b|^C(S|SV|SM|BB)[\w.]*C\b/i;
const CHINESE_EXP = /^(CS|CSV|CSM|CBB|CSH|CSI|CSML|CSMJ|CSVE|CSVL)[\w.]*:|^\d+C:/;
// Prodotti che esistono solo in giapponese ma che Cardmarket chiama senza la lingua e CardTrader mette in inglese (7 novembre
// 2026): i pacchetti Takara Tomy "FABLED 物語のおもいで 特別プロモーションパック vol.1/vol.2" ("Fabled: Memories of the Story Special
// Promotion Pack Vol.1"), allegati ai box giapponesi di Archazia's Island e Reign of Jafar (il Giappone non ha avuto Fabled).
const JAPANESE_ONLY = /\bMemories of the Story\b/i;

/** Sotto questa cifra la "tendenza" del listino Cardmarket è un segnaposto (0,02 €), non un prezzo. */
const MIN_TREND = 0.05;

/**
 * La tendenza Cardmarket di un sigillato, se è credibile; null = come se non ci fosse (stessa regola di `Sealed.saneTrend`
 * nell'app). 18 novembre 2026: 39 sigillati a 0,02 € («Mega Charizard X Poncho-wearing Pikachu Special Box» col minimo in
 * vendita a 40.000 €, i box «EX Team Rocket Returns» e «Magician's Force»). Non un taglio secco sotto 1 €: tin vuoti, buste
 * dei tornei e puzzle di Lorcana costano davvero centesimi; fuori i segnaposto e chi sta sotto 1 € col minimo in vendita
 * almeno dieci volte più su («Legendary Dragons of Atlantis Deck Card Pack» 0,64 € col minimo a 14 €).
 */
export function saneTrend(trend, low) {
  if (!(typeof trend === "number" && trend > MIN_TREND)) return null;
  if (trend < 1 && typeof low === "number" && low >= 10 * trend) return null;
  return trend;
}

/** Il nome dice la lingua del prodotto in modo esplicito: le offerte non la cambiano. */
const EXPLICIT_LANG = /Non-English|Japanese|Korean|Chinese|S-Ch|T-Ch|Thai|Indonesian|\(OCG\)|\(JP\)|Asia Region/i;

/** Offerte CardTrader di un prodotto: quante in giapponese e quante nelle lingue occidentali. */
function offerLangs(p) {
  let ja = 0;
  let western = 0;
  for (const [lang, est] of Object.entries(p.ct ?? {})) {
    if (lang === "ja") ja += est[1];
    else western += est[1];
  }
  return { ja, western };
}

/**
 * Lingua dei prodotti corretta con le offerte CardTrader, dove CardTrader e il nome sbagliano (18 novembre 2026):
 *  - Pokémon ([westernLang] null): un prodotto senza lingua con offerte solo in giapponese, almeno 2, è giapponese («VMAX Climax
 *    Booster Box»: 9 offerte giapponesi e nessuna occidentale, valeva 110,40 € di tendenza invece di 199,64 €; «25th Anniversary
 *    Collection Booster Box», «Gengar VMAX High-Class Deck»); con una sola offerta giapponese solo se la sua espansione ha già un
 *    prodotto asiatico e nessuna offerta occidentale («25th Anniversary Collection Special Set»). Solo Pokémon: negli altri
 *    giochi Cardmarket ha un prodotto per lingua e le offerte giapponesi su un prodotto inglese sono un collegamento sbagliato.
 *  - Ogni gioco: un prodotto dato per giapponese senza che il nome lo dica ([EXPLICIT_LANG]), con almeno 3 offerte occidentali e
 *    nessuna giapponese, è occidentale (One Piece «Mini-tin Pack Set Vol.3 (Monkey.D.Luffy V2)»: 20 offerte inglesi; il mazzo dei
 *    Mondiali «WCD 2025: Yuya Okita "JP Raging Bolt"», dove "JP" è il nome del mazzo).
 * Modifica [out] sul posto; restituisce quanti prodotti cambiano.
 */
export function fixLangsFromOffers(out, westernLang = null) {
  let toJa = 0;
  let toWestern = 0;
  if (westernLang === null) {
    const strong = out.filter((p) => !p.l && offerLangs(p).ja >= 2 && offerLangs(p).western === 0);
    for (const p of strong) p.l = "ja";
    toJa += strong.length;
    // Espansioni con un prodotto asiatico e nessuna offerta occidentale: basta un'offerta giapponese.
    const asianExp = new Set(out.filter((p) => p.l && p.e).map((p) => p.e));
    const westernOffers = new Set(out.filter((p) => offerLangs(p).western > 0).map((p) => p.e));
    for (const p of out) {
      if (p.l || !asianExp.has(p.e) || westernOffers.has(p.e)) continue;
      const o = offerLangs(p);
      if (o.ja >= 1 && o.western === 0) {
        p.l = "ja";
        toJa++;
      }
    }
  }
  for (const p of out) {
    if (p.l !== "ja" || westernLang === "ja" || EXPLICIT_LANG.test(p.n)) continue;
    const o = offerLangs(p);
    if (o.ja > 0 || o.western < 3) continue;
    if (westernLang) p.l = westernLang;
    else delete p.l;
    toWestern++;
  }
  return { toJa, toWestern };
}

export function isAsian(name) {
  return ASIAN.test(String(name || ""));
}

/**
 * Lingua di un prodotto asiatico dal nome suo e dell'espansione; se non dice niente, [fallback]
 * (la lingua che dà CardTrader), altrimenti giapponese.
 */
export function asianLang(name, expName = "", fallback = "ja") {
  const n = `${name || ""} ${expName || ""}`;
  if (/T-Ch|Traditional Chinese|Taiwan/i.test(n)) return "zh-tw";
  if (/S-Ch|Chinese/i.test(n) || CHINESE_EXP.test(String(name || "")) || CHINESE_EXP.test(String(expName || ""))) return "zh-cn";
  if (/Korean|\bKR\b/i.test(n)) return "ko";
  if (/Indonesian|\bID\b/i.test(n)) return "id";
  if (/Thai|\bTH\b/i.test(n)) return "th";
  return fallback;
}

/**
 * Stima delle offerte di confezioni sigillate: le aperte non contano, e nemmeno i prezzi
 * "segnaposto" (es. Elite Trainer Box Surging Sparks a 5.076 € in inglese, ottobre 2026).
 */
export function sealedEstimate(offers) {
  const usable = offers.filter((o) => !isPlaceholderPrice(o.price));
  // "Sigillato" su CardTrader è affidabile solo quando almeno un venditore lo spunta: allora le offerte
  // segnate "no" sono confezioni aperte e restano fuori. Se nessuna offerta lo spunta, "no" è solo la
  // casella lasciata vuota (Booster Bundle, Build & Battle Kit, valigetta Team Rocket giapponese: decine
  // di offerte allo stesso prezzo del sigillato) e il prodotto resterebbe senza prezzo: contano tutte.
  const anySealed = usable.some((o) => o.sealed === true);
  return estimate(anySealed ? usable.filter((o) => o.sealed !== false) : usable, "n");
}

/** Lingue CardTrader dei prodotti asiatici -> codici dell'app. */
const CT_ASIAN_LANGS = { jp: "ja", "zh-CN": "zh-cn", "zh-TW": "zh-tw", kr: "ko", id: "id", th: "th" };

/** Lingua predefinita di un blueprint CardTrader ("jp", "en"...), da editable_properties. */
export function blueprintLanguage(bp) {
  const p = (bp?.editable_properties || []).find((x) => String(x.name).endsWith("_language"));
  return typeof p?.default_value === "string" ? p.default_value : null;
}

/** Lingua dell'app di un prodotto asiatico per la lingua CardTrader; null se occidentale o sconosciuta. */
function asianFromCt(ctLang) {
  return CT_ASIAN_LANGS[ctLang] ?? null;
}

/**
 * @param {object} a
 * @param {object[]} a.products   prodotti sigillati Cardmarket (products_nonsingles_6.json)
 * @param {object[]} a.singles    carte singole Cardmarket (per dare un nome alle espansioni)
 * @param {object} a.guide        listino Cardmarket (price_guide_6.json)
 * @param {Map<number, number>} a.cmToCtExp  prodotto Cardmarket -> espansione CardTrader (tutti i blueprint)
 * @param {Map<number, string>} a.ctExpNames espansione CardTrader -> nome
 * @param {Map<number, {bp: number, img: string|null, lang?: string|null}>} a.ctProducts prodotto Cardmarket ->
 *   blueprint sigillato, con la sua lingua CardTrader predefinita ("jp", "en"...)
 * @param {Map<number, string>} [a.ctExpLangs] espansione CardTrader -> lingua predefinita dei suoi blueprint
 * @param {Record<string, Map<number, [number, number]>>} a.ctPrices lingua -> prodotto Cardmarket -> stima
 * @param {Record<string, string>} [a.types] categorie Cardmarket -> tipo (Pokémon o [ONE_PIECE_SEALED_TYPES])
 * @param {string|null} [a.westernLang] lingua dei prodotti non asiatici, se Cardmarket ne ha uno per lingua:
 *   One Piece ha "Romance Dawn Booster Box" (inglese) e "... (Non-English)" (giapponese). Pokémon: null,
 *   un prodotto per tutte le lingue occidentali.
 *
 * Un prodotto è asiatico se lo dice CardTrader (lingua predefinita del suo blueprint o, se non è
 * collegato, della sua espansione: es. "Clay Burst" = "jp", anche se Cardmarket la chiama in inglese)
 * o il nome ("JP", "Chinese"...). Il nome decide anche tra cinese, coreano...
 */
/** Tipo di un prodotto dal nome (prodotti che Cardmarket non ha, quindi senza la sua categoria). */
export function guessType(name) {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("elite trainer box") || /\betb\b/.test(n)) return "etb";
  if (n.includes("booster box") || n.includes("display")) return "display";
  if (/\btin\b/.test(n)) return "tin";
  if (n.includes("blister")) return "blister";
  if (n.includes("deck")) return "deck";
  if (n.includes("booster") || /\bpack\b/.test(n)) return "booster";
  return "box";
}

/**
 * Nome confrontabile di un prodotto sigillato: senza il codice del set ("SV9: ", "151C: "), "Pokémon TCG",
 * le note tra parentesi tonde ("(18 Boosters)") e la punteggiatura; le parentesi quadre di TCGplayer
 * contengono la variante e restano: "V Battle Deck: Venusaur V" = "V Battle Deck [Venusaur V]".
 */
export function sealedKey(name) {
  return String(name ?? "")
    .toLowerCase()
    // Lettere accentate come le semplici ("PokéKyun" = "PokeKyun") e il genitivo inglese ("Collector's Tins" = "Collectors
    // Tins"): prima i nomi scritti nei due modi non si abbinavano (0.9.160).
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/\bpre[\s-]?release\b/g, "prerelease")
    .replace(/&/g, " and ")
    .replace(/^[a-z0-9.\-]{1,8}:\s*/, "")
    .replace(/\bpokemon tcg:?\s*/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Foto TCGplayer dei prodotti senza foto CardTrader: il prodotto TCGplayer con lo stesso nome
 * (anche "<gruppo> <nome>", es. "SV9: Battle Partners" + "Booster Box"). "tp:<prodotto>".
 * @param {{id: number|string, name: string, group?: string}[]} tpProducts
 */
export function tcgplayerImages(tpProducts) {
  return tcgplayerByName(tpProducts, (p) => `tp:${p.id}`);
}

/** Prezzi di mercato TCGplayer (euro) per nome, per i prodotti senza prezzo Cardmarket né offerte CardTrader. */
function tcgplayerPrices(tpProducts) {
  return tcgplayerByName(tpProducts.filter((p) => p.eur > 0), (p) => p.eur);
}

/** Tendenza sballata se dista più di tante volte dalla media a 30 giorni (Valuation.GLITCH dell'app). */
const GUIDE_GLITCH = 3;

/**
 * Prezzi del listino Cardmarket di un prodotto ([g]: riga di price_guide): tendenza, minimo, media a 30 giorni. La tendenza
 * segnaposto o sballata ([saneTrend]) resta fuori; [bad] = ne è stata tolta una.
 */
function guideCm(g) {
  const cm = {};
  for (const k of ["trend", "low", "avg30"]) if (typeof g?.[k] === "number" && g[k] > 0) cm[k] = g[k];
  // Tendenza sballata rispetto alla media a 30 giorni (oltre [GUIDE_GLITCH] volte): la mediana delle medie a 1, 7 e 30
  // giorni, come per le carte (Valuation.cm). I sigillati non hanno le medie nel listino; le carte giganti e promo che
  // CardTrader mette fra i sigillati sì (categoria delle carte singole).
  if (cm.trend && cm.avg30 && (cm.trend > GUIDE_GLITCH * cm.avg30 || cm.trend < cm.avg30 / GUIDE_GLITCH)) {
    const avgs = ["avg1", "avg7", "avg30"].map((k) => g[k]).filter((v) => typeof v === "number" && v > 0);
    if (avgs.length) cm.trend = median(avgs);
  }
  // Tendenza segnaposto (0,02 €) o sotto 1 € col minimo dieci volte più su: non è una tendenza (saneTrend).
  let bad = false;
  if (cm.trend !== undefined && saneTrend(cm.trend, cm.low) === null) {
    delete cm.trend;
    bad = true;
  }
  return { cm, bad };
}

/**
 * Le stime delle offerte CardTrader sigillate del prodotto [id] per lingua, senza quelle lontanissime dalla tendenza
 * Cardmarket (più del triplo o meno di un terzo): poche offerte fuori mercato, es. Elite Trainer Box Surging Sparks in
 * inglese a 5.076 € (Cardmarket 133 €). Meglio nessun prezzo.
 */
function guideOffers(ctPrices, id, cm) {
  const ct = {};
  for (const [lang, m] of Object.entries(ctPrices)) {
    const est = m.get(id);
    if (est && !(cm.trend && (est[0] > 3 * cm.trend || est[0] < cm.trend / 3))) ct[lang] = est;
  }
  return ct;
}

/**
 * Un box non vale meno di una sua busta (riverifica del 19 novembre 2026, approvato dall'utente: "correggili tutti"). Nello
 * stesso set e lingua ("<set> Booster" e "<set> Booster Box", senza parentesi) la tendenza della busta pari o sopra quella
 * del box è impossibile: una delle due è sbagliata. Vale quella vicina al proprio minimo in vendita (minimo tra metà e il
 * doppio della tendenza); l'altra non si usa. Se nessuna delle due lo è, nessuna (meglio senza prezzo che sbagliato); se lo
 * sono tutte e due restano (un dato vero, da guardare). Casi veri: «EX Dragon Frontiers Booster Box» 40 € con la busta a
 * 1.697,26 € (minimo 1.979,99 €), «MEGA Dream ex Booster» giapponese 80,70 € (minimo 4,99 €) col box a 79,03 €.
 * Restituisce le tendenze tolte: [{ id, n, invece }].
 */
export function boxBelowBooster(out) {
  const base = (p, suffix) => {
    if (/[()[\]]/.test(p.n)) return null;
    const m = String(p.n).match(new RegExp(`^(.*\\S)\\s+${suffix}$`, "i"));
    return m ? `${p.l ?? ""}|${sealedKey(m[1])}` : null;
  };
  const boxes = new Map();
  for (const p of out) if (p.t === "display" && p.cm?.trend) { const k = base(p, "Booster Box"); if (k) boxes.set(k, boxes.has(k) ? null : p); }
  const near = (p) => p.cm?.low > 0 && p.cm.low >= p.cm.trend / 2 && p.cm.low <= 2 * p.cm.trend;
  const dropped = [];
  for (const b of out) {
    if (b.t !== "booster" || !b.cm?.trend) continue;
    const k = base(b, "Booster");
    const box = k ? boxes.get(k) : null;
    if (!box || b.cm.trend < box.cm.trend) continue;
    const okBox = near(box);
    const okBooster = near(b);
    if (okBox && okBooster) continue;
    if (!okBox) dropped.push({ id: box.id, n: box.n, invece: b.n });
    if (!okBooster) dropped.push({ id: b.id, n: b.n, invece: box.n });
  }
  const ids = new Set(dropped.map((d) => d.id));
  for (const p of out) if (ids.has(p.id)) delete p.cm.trend;
  return dropped;
}

/**
 * Scrive in ogni prodotto di [out] il prodotto TCGplayer, `tp: [prodotto, gruppo]`: stesso nome (anche con l'espansione
 * davanti), altrimenti il più somigliante dello stesso tipo e lingua ([fuzzyMatch], solo se è chiaramente il migliore).
 * Solo i prodotti TCGplayer con il gruppo noto. Restituisce quanti ne hanno uno.
 *
 * Come i collegamenti delle carte (A14, `uniqueLinks`/`saysPrint` in tcgplayer-ct.js), dalla riverifica dei prezzi del 19
 * novembre 2026 (approvato dall'utente): la confezione deve essere la stessa da tutte e due le parti ([sameLinkMarks]: vuota,
 * mezzo box da 18 buste, busta da N carte, cassa) e un prodotto TCGplayer va a un solo sigillato ([uniqueSealedLinks]). Prima
 * «Celestial Storm: Empty Elite Trainer Box» seguiva l'ETB pieno (1.906,73 €), «Team Up Booster Box (18 Boosters)» il box
 * intero, «Unleashed Booster (5 Cards)» la busta normale.
 */
export function addSealedTcgplayer(out, tpProducts, exp, westernLang = null, log = []) {
  const withGroup = tpProducts.filter((p) => Number.isFinite(Number(p.groupId)) && Number(p.groupId) > 0);
  const groupOf = new Map(withGroup.map((p) => [String(p.id), Number(p.groupId)]));
  const byId = new Map(withGroup.map((p) => [String(p.id), p]));
  const exact = tcgplayerByName(withGroup, (p) => String(p.id));
  const fuzzy = fuzzyIndex(withGroup);
  let marks = 0;
  for (const p of out) {
    const pl = p.l ?? westernLang;
    let id = exact.get(tpKey(pl, p.n)) ?? exact.get(tpKey(pl, `${exp[p.e] ?? ""} ${p.n}`));
    if (!id) id = fuzzyMatch(`${exp[p.e] ?? ""} ${p.n}`, p.n, fuzzy, pl)?.id;
    const group = id == null ? undefined : groupOf.get(String(id));
    if (group && !sameLinkMarks(p.n, byId.get(String(id))?.name)) {
      marks++;
      delete p.tp;
    } else if (group) {
      p.tp = [Number(id), group];
    } else {
      delete p.tp;
    }
  }
  const shared = uniqueSealedLinks(out, byId, exp);
  if (marks) log.push(`Prodotto TCGplayer dei sigillati: ${marks} tolti perché la confezione è diversa (vuota, mezzo box, carte per busta, cassa)`);
  if (shared) log.push(`Prodotto TCGplayer dei sigillati: ${shared} tolti perché lo stesso prodotto era di un altro sigillato`);
  return out.filter((p) => p.tp).length;
}

/**
 * Segni del nome che cambiano la confezione: vuota ("Empty"), mezzo box ("(18 Boosters)" di Cardmarket = "Half Booster Box"
 * di TCGplayer), busta con un numero di carte scritto ("Booster (5 Cards)", "(6 Cards)": non la busta normale), cassa ("Case").
 */
export function linkMarks(name) {
  const s = String(name ?? "").toLowerCase();
  const out = [];
  if (/\bempty\b/.test(s)) out.push("empty");
  if (/\b18 boosters?\b|\bhalf\b/.test(s)) out.push("half");
  const cards = s.match(/\(\s*(\d+)\s*cards?\s*\)/);
  if (cards) out.push(`cards:${cards[1]}`);
  // "Case (12 Booster Boxes)", "Memorial Collection (12x Booster Box)": casse anche quando la parola "Case" non c'è.
  if (/\bcases?\b|\(\s*\d+\s*x?\s*booster box(es)?\s*\)/.test(s)) out.push("case");
  return out.join(",");
}

/** true se il sigillato [ours] e il prodotto TCGplayer [theirs] hanno gli stessi segni della confezione ([linkMarks]). */
function sameLinkMarks(ours, theirs) {
  return theirs == null || linkMarks(ours) === linkMarks(theirs);
}

/**
 * Parole di un nome per scegliere fra i sigillati dello stesso prodotto TCGplayer, anche quelle tra parentesi e contando le
 * ripetute: "FireRed & LeafGreen Theme Deck - "LeafGreen"" è il mazzo LeafGreen, non quello FireRed.
 */
function linkWords(name) {
  return String(name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]s\b/g, "").replace(/&/g, " and ")
    .split(/[^a-z0-9]+/).filter((w) => w && (!FUZZY_STOP.has(w) || w === "us" || w === "eu")).map((w) => FUZZY_SAME[w] ?? singular(w));
}

/** Somiglianza fra due elenchi di parole contando le ripetute (parole in comune / parole in tutto). */
function overlap(a, b) {
  const left = new Map();
  for (const w of a) left.set(w, (left.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const n = left.get(w) ?? 0;
    if (n > 0) { common++; left.set(w, n - 1); }
  }
  const all = a.length + b.length - common;
  return all ? common / all : 0;
}

/**
 * Un prodotto TCGplayer a un solo sigillato. Se più sigillati hanno lo stesso `tp`, resta solo quello col nome più vicino al
 * nome del prodotto TCGplayer (con o senza l'espansione davanti); a pari merito nessuno
 * (meglio senza andamento che con quello di un'altra confezione: "Double Crisis: Team Magma 3-Pack" e "4-Pack Blister" sullo
 * stesso blister). I sigillati con lo stesso nome fuori dalle parentesi, anche in un altro ordine ("Winner Pack 2025 Vol.3" e
 * "Pack Winner 2025 Vol.3", "… Tin" e "… Tin (US Version)") contano come uno solo e tengono il collegamento. TCGplayer è il mercato americano: fra la versione US e quella EU vale la US. Restituisce quanti
 * collegamenti ha tolto.
 */
export function uniqueSealedLinks(out, byId, exp = {}) {
  const byTp = new Map();
  for (const p of out) if (p.tp) (byTp.get(p.tp[0]) || byTp.set(p.tp[0], []).get(p.tp[0])).push(p);
  let dropped = 0;
  for (const [id, list] of byTp) {
    const byName = new Map();
    // Stesso nome senza le parti tra parentesi, in qualsiasi ordine: "(US Version)", "(Asia Region Legal)" restano insieme, come prima.
    const same = (p) => sealedKey(p.n).split(" ").sort().join(" ");
    for (const p of list) (byName.get(same(p)) || byName.set(same(p), []).get(same(p))).push(p);
    if (byName.size < 2) continue;
    const theirs = linkWords(byId.get(String(id))?.name);
    let groups = [...byName.values()];
    // Un sigillato senza espansione nel catalogo cede a quelli che ce l'hanno ("Holon Phantom Booster Box" del 2024, senza set
    // né prezzo, contro "EX Holon Phantoms Booster Box").
    if (groups.some((g) => exp[g[0].e])) groups = groups.filter((g) => exp[g[0].e]);
    const says = (g, w) => linkWords(g[0].n).includes(w);
    if (!theirs.includes("eu") && groups.some((g) => says(g, "us")) && groups.some((g) => says(g, "eu"))) groups = groups.filter((g) => !says(g, "eu"));
    const score = (g) => Math.max(overlap(theirs, linkWords(g[0].n)), overlap(theirs, linkWords(`${exp[g[0].e] ?? ""} ${g[0].n}`)));
    const best = Math.max(...groups.map(score));
    const winners = groups.filter((g) => score(g) === best);
    const keep = new Set(winners.length === 1 ? winners[0] : []);
    for (const p of list) if (!keep.has(p)) { delete p.tp; dropped++; }
  }
  return dropped;
}

// Parole che non distinguono un prodotto da un altro.
// "empty": un tin vuoto ha la foto di quello pieno (TCGplayer non vende i vuoti).
// "pack": "Booster" e "Booster Pack" sono la stessa busta.
// "products", "us", "version", "international": "Pokémon Products: ...", "(US Version)", "(International Version)".
const FUZZY_STOP = new Set(["the", "of", "and", "pokemon", "tcg", "card", "cards", "game", "trading", "a", "with", "set", "x", "empty", "pack", "products", "us", "version", "international", "eu", "english", "disney", "lorcana"]);

/** Parole che dicono il tipo di prodotto, non quale prodotto. */
const KIND_WORDS = new Set(["booster", "box", "elite", "trainer", "bundle", "tin", "blister", "deck", "starter", "theme", "collection", "premium", "case", "sleeved", "1", "2", "3"]);

/** Tipo di prodotto dal nome: due prodotti di tipo diverso (busta e box, ETB e tin) non sono mai lo stesso. */
export function productKind(name) {
  // Tutto il nome, anche tra parentesi ("Memorial Collection (12x Booster Box)" è un box, non una busta); "collection" per
  // ultimo, perché sta anche nei nomi dei set ("Memorial Collection - Booster Pack" è una busta).
  const k = String(name ?? "").toLowerCase().replace(/pokémon/g, "pokemon").replace(/[^a-z0-9]+/g, " ");
  if (/\b(elite trainer|etb)\b/.test(k)) return "etb";
  if (/\b(booster box|boxes|display|booster case|case)\b/.test(k)) return "box";
  if (/\bbundle\b/.test(k)) return "bundle";
  if (/\btins?\b/.test(k)) return "tin";
  if (/\bblister\b/.test(k)) return "blister";
  if (/\b(deck|decks|starter|theme)\b/.test(k)) return "deck";
  if (/\b(booster|boosters|pack|packs|sleeved)\b/.test(k)) return "booster";
  if (/\b(collection|premium|box)\b/.test(k)) return "collection";
  return "other";
}

// Parole con lo stesso senso nei due cataloghi (Cardmarket "Booster Box Display", TCGplayer "Booster Box"; "3-Pack Blister" e
// "Three Pack Blister").
const FUZZY_SAME = {
  display: "box", boosters: "booster", packs: "pack", tins: "tin", decks: "deck", etb: "elite", single: "1", chests: "chest", sampling: "sample",
  two: "2", three: "3", four: "4", five: "5", six: "6",
};

/** Plurale e singolare uguali ("Collectors Tins" = "Collector Tin"); le parole corte ("gx", "ex", "vs") restano come sono. */
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/**
 * "Code Card - Fates Collide Three Pack Blister [Froakie]" di TCGplayer è il codice per il gioco online, non il prodotto: con
 * lo stesso nome del prodotto vero, i due erano quasi alla pari e l'abbinamento si annullava (0.9.160). Così le carte DON!!
 * One Piece col nome della busta tra parentesi ("DON!! Card (CS 2023 Celebration Pack)"): sono una carta, non la busta.
 */
const isCodeCard = (name) => /^\s*(code card\b|don!! card\s*\()/i.test(String(name ?? ""));

/**
 * Parole che per la sola foto non distinguono un prodotto (0.9.160, richiesto dall'utente: meno foto da eBay): la busta della 1ª
 * edizione ha la stessa foto della unlimited o della ristampa, "(Asia Region Legal)" e "Booster" ("Bonus Pack Booster" = "Bonus
 * Pack") non cambiano la confezione. "Limited" e le lettere sole sì ("Limited Booster Box Set" contiene due box, "Mega Charizard
 * Y" non è la X, "M Tyranitar EX Box" non è "Tyranitar EX Box"). Non valgono per il prodotto TCGplayer collegato (andamento e
 * prezzo), che resta esatto.
 */
const PHOTO_OPTIONAL = new Set(["edition", "unlimited", "reprint", "jp", "japanese", "booster", "expansion", "asia", "region", "legal", "lega", "ver"]);
/**
 * Parole di un nome per la somiglianza. Le parentesi restano ("First Partner Pack (Johto)": la regione è il prodotto), tranne
 * i conteggi ("(6 Cards)", "(18 Boosters)") e le lingue ("(Non-English)", "(Japanese)"), che sealedKey toglierebbe comunque.
 */
const fuzzyWords = (s) => {
  const kept = String(s ?? "")
    .replace(/\(\s*\d+x?\s*(cards?|boosters?|booster boxes|boxes|packs?|carte|structure decks?|decks?|tins?|bundles?|blisters?)\s*\)/gi, " ")
    .replace(/\((non-english|japanese|english|simplified chinese|traditional chinese|korean|asia region legal)\)/gi, " ")
    .replace(/[()[\]]/g, " ")
    // Il nome del gioco dentro il nome non dice quale prodotto è ("Extra Booster: One Piece Heroines Edition").
    .replace(/\b(one piece( card game)?|dragon ball super( card game)?|yu-?gi-?oh!?|disney lorcana)\b/gi, " ")
    // "CS 2024" di Cardmarket è il "Championship 2024" di TCGplayer (buste dei campionati One Piece).
    .replace(/\bcs\s+(\d{4})\b/gi, "championship $1");
  // Parole da ignorare controllate prima e dopo il singolare ("Products" -> "product" restava e contava come set).
  return new Set(sealedKey(kept).split(" ").filter((w) => !FUZZY_STOP.has(w)).map((w) => singular(FUZZY_SAME[w] ?? w)).map((w) => FUZZY_SAME[w] ?? w).filter((w) => w && !FUZZY_STOP.has(w)));
};

/** true se due nomi dicono le stesse parole (stesse regole della somiglianza: conteggi, lingua e parole vuote fuori). */
export const sameWords = (a, b) => {
  const x = fuzzyWords(a);
  const y = fuzzyWords(b);
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
};

/** Parole unite a due a due ("Pre Release" = "Prerelease", "Mega Pack" = "Megapack"), per i nomi scritti attaccati o staccati. */
const joinedWords = (s) => {
  const ws = sealedKey(s).split(" ").filter(Boolean);
  return ws.slice(1).map((w, i) => singular(ws[i] + w));
};

/** Indice per la somiglianza dei nomi: parole (nome + gruppo TCGplayer) e tipo di ogni prodotto. */
export function fuzzyIndex(tpProducts) {
  return tpProducts.filter((p) => !isCodeCard(p.name)).map((p) => ({
    id: p.id, name: p.name, kind: productKind(p.name), lang: p.lang ?? "en",
    words: new Set([...fuzzyWords(`${p.group ?? ""} ${p.name}`), ...joinedWords(`${p.group ?? ""} ${p.name}`)]), own: fuzzyWords(withoutGroupPrefix(p.name, p.group)),
    group: fuzzyWords(p.group ?? ""),
  }));
}

/**
 * Il nome TCGplayer senza il set davanti quando è quello del gruppo ("Awakening of the New Era - 1st Anniversary Tournament Pack",
 * "Dragon Ball Super: Gift Box"): quelle parole dicono il set, non il prodotto, e non vanno contate come parole in più.
 */
function withoutGroupPrefix(name, group) {
  // Il nome del gioco davanti ("Dragon Ball Super - Miraculous Revival Special Pack Set", "Disney Lorcana: ...").
  const n = String(name ?? "").replace(/^(dragon ball super|disney lorcana|one piece card game|yu-gi-oh!?|pokemon|pokémon)\s*(?: - |:\s)/i, "");
  const m = n.match(/^(.+?)\s*(?: - |:\s)(.+)$/);
  if (!m) return n;
  const g = fuzzyWords(group ?? "");
  const prefix = [...fuzzyWords(m[1])];
  return prefix.length && prefix.every((w) => g.has(w)) ? m[2] : n;
}

/**
 * Il prodotto TCGplayer più somigliante a [fullName] (set + nome) dello stesso tipo di [name]: almeno l'80% delle parole
 * del prodotto Cardmarket nel nome TCGplayer (con il gruppo), almeno 2 parole, e un distacco netto dal secondo; null se no.
 */
export function fuzzyMatch(fullName, name, index, lang = null, allowJa = true, { photo = false, genericSet = false } = {}) {
  const kind = productKind(name);
  // Stessa lingua: la confezione giapponese non è quella inglese (151 giapponese contro il Booster Bundle inglese).
  const want_lang = !lang || lang === "en" ? "en" : lang === "jp" ? "ja" : lang;
  // [photo]: solo per la foto, senza le parole di PHOTO_OPTIONAL (edizione, ristampa, regione...).
  const allOwn = fuzzyWords(name);
  // Le parole facoltative si tolgono solo se ne restano almeno due ("Generations Booster" resta "generation booster").
  const kept0 = [...allOwn].filter((w) => !(photo && PHOTO_OPTIONAL.has(w)));
  const relax = photo && kept0.filter((w) => !/^\d+$/.test(w)).length >= 2;
  const optional = (w) => relax && PHOTO_OPTIONAL.has(w);
  const own = new Set([...allOwn].filter((w) => !optional(w)));
  // Parole obbligatorie: quelle del nome del prodotto, tranne numeri e anni ("6 Booster Box Case", "2022 ... Stacking Tin":
  // TCGplayer non li scrive); le parole del set aiutano ma non bastano a scartare (il gruppo TCGplayer dei tin è
  // "Miscellaneous Cards & Products", non il set).
  const required = [...own].filter((w) => !/^\d+$/.test(w));
  if (required.length < 2) return null;
  const fullWords = fuzzyWords(fullName);
  const setWords = [...fullWords].filter((w) => !own.has(w) && !optional(w));
  const digits = [...own].filter((w) => /^\d+$/.test(w));
  // Quante confezioni ha una cassa ("Celebrations 10 Elite Trainer Box Case", "Lost Origin 24 Sleeved Booster Case"): TCGplayer
  // non lo scrive.
  const caseCounts = /\bcases?\b/i.test(name ?? "")
    ? new Set([...String(name).matchAll(/\b(\d+)\s*x?\s+(?:[a-z]+\s+){0,2}(booster|elite|etb|display|box|collection|tin|pack|bundle|blister)/gi)].map((m) => m[1]))
    : new Set();
  // Numeri che TCGplayer spesso non scrive: quante cose ci sono ("4-Pack Blister", "8-Tin Display") e la versione ("Booster Bundle
  // Version 1": TCGplayer ha un prodotto solo).
  const softNumbers = new Set([...String(name ?? "").matchAll(/\b(\d+)\s*-\s*(?:pack|tin|booster|card|box|deck)s?\b|\b(?:version|ver\.?)\s*(\d+)\b/gi)].map((m) => m[1] ?? m[2]));
  let best = null;
  let second = 0;
  let secondOwn = null;
  for (const c of index) {
    if (c.kind !== kind || c.lang !== want_lang) continue;
    if (!required.every((w) => c.words.has(w))) continue;
    // Un piccolo pacchetto dentro un prodotto non è il prodotto ("Structure Deck: Fire Kings Card Pack" non è il mazzo "Fire
    // Kings Structure Deck"): il nome TCGplayer deve dire "pack" o "booster" anche lui ("Promo Pack" = "Promo Booster"). Né
    // per la foto né per l'andamento del prezzo.
    if (/\b(card|bonus|promo|special)\s+pack\b/i.test(name) && !/\b(packs?|boosters?)\b/i.test(c.name ?? "")) continue;
    // Il solo contenuto senza la scatola ("Starter Deck: Smoker Deck Pack" di Cardmarket, "Decks Only") non è il mazzo in
    // scatola di TCGplayer, che costa il doppio e ha un'altra foto: solo un prodotto TCGplayer che dice lo stesso.
    if (CONTENT_ONLY.test(name) && !CONTENT_ONLY.test(c.name ?? "")) continue;
    // Una busta non ha la foto del box che le contiene ("Movie Pack Gold Booster" e "Movie Pack: Gold Edition Box").
    if (photo && productKind(name) === "booster" && !fullWords.has("box") && c.words.has("box")) continue;
    const setHit = setWords.length ? setWords.filter((w) => c.words.has(w)).length / setWords.length : 1;
    // Per la foto, un prodotto di un altro set non va bene anche col nome uguale ("XY: Kanto Starters 2-Pack Blister" non è il
    // "Kanto Two Pack Blister [Starters]" di Plasma Storm): il gruppo TCGplayer deve avere una parola del set o del nome, tranne
    // i gruppi che non sono un set (tin, mini tin…) e i prodotti che su Cardmarket non hanno un set vero ([genericSet]: "Pokémon
    // Products", "Masters Promo"; i tin vuoti Galar Partners stanno su TCGplayer sotto Sword & Shield).
    const setOnly = setWords.filter((w) => !KIND_WORDS.has(w) && !isNumber(w));
    // ...o il nome stesso del prodotto è il set ("GX Ultra Shiny Booster" del set "High Class Pack GX Ultra Shiny").
    const ownCore = [...own].filter((w) => !KIND_WORDS.has(w) && !isNumber(w));
    const setMatch = setOnly.some((w) => c.words.has(w)) || (ownCore.length >= 2 && ownCore.every((w) => c.group.has(w)));
    if (photo && !genericSet && setOnly.length && !c.group.has("miscellaneou") && !setMatch) continue;
    const missingDigits = digits.filter((w) => !c.words.has(w)).length;
    const extra = [...c.own].filter((w) => !own.has(w) && !setWords.includes(w) && !optional(w)).length;
    // Per la foto, troppe parole in più vogliono dire un altro prodotto con due parole in comune ("Duelist Pack: Duelists of the
    // Abyss" non è "Legendary Duelists: White Dragon Abyss"): al massimo metà delle parole del nome.
    const extraOwn = [...c.own].filter((w) => !own.has(w) && !setWords.includes(w) && !optional(w) && !c.group.has(w)).length;
    if (photo && extraOwn > Math.max(2, required.length / 2)) continue;
    // Un prodotto TCGplayer che è il suo gruppo più il tipo ("Legendary Duelists: White Dragon Abyss Booster Box"): il nome
    // Cardmarket deve avere la maggior parte delle parole del gruppo ("Duelists of the Abyss" ne ha due su cinque).
    const groupCore = [...c.group].filter((w) => !KIND_WORDS.has(w) && !/^\d+$/.test(w));
    const ownBeyondGroup = [...c.own].filter((w) => !c.group.has(w) && !KIND_WORDS.has(w) && !optional(w) && !/^\d+$/.test(w));
    const candCore = [...c.own].filter((w) => !KIND_WORDS.has(w) && !optional(w) && !isNumber(w));
    if (photo && groupCore.length >= 3 && !ownBeyondGroup.length && !candCore.every((w) => fullWords.has(w)) &&
      groupCore.filter((w) => fullWords.has(w)).length / groupCore.length < 0.6) continue;
    // Per la foto, numeri diversi sono prodotti diversi ("CS 2023 Event Pack" non è quello del 2024, "Vol. 3" non è "Vol. 4"):
    // un numero del prodotto TCGplayer che il nome non ha, mentre un numero del nome manca a lui.
    // Anche il gruppo conta ("Legendary Collection 4 - Mega-Pack Booster Pack" non è "Collection Pack 2020") e i numerali
    // ordinali sono numeri ("1st Anniversary" non è "4th Anniversary").
    const ownNumbers = [...own].filter((w) => isNumber(w) && !caseCounts.has(w));
    // Un nome con un numero e una sola parola sua ("Premium Pack 2022", "Gold Pack 2016"): il numero è il prodotto, il prodotto
    // TCGplayer deve averlo ("Premium Gold: Return of the Bling" non è nessuno dei Premium Pack).
    // Anche per l'andamento del prezzo: "CS 2023 Top Players Pack" seguiva la "CS 25-26 Top Player Pack".
    if (ownNumbers.length && ownCore.length < 2 && !ownNumbers.every((w) => c.words.has(w))) continue;
    // Un numero di volume o di serie ("Hidden Arsenal 2", "Vol. 3", "1st Anniversary") deve esserci: il prodotto TCGplayer
    // senza numero è il primo della serie ("Hidden Arsenal - Booster Box" non è l'Hidden Arsenal 5, ma "Learn Together Deck Set
    // 01" sì). Gli anni no ("2022 ... Stacking Tin": TCGplayer non li scrive), né i conteggi e le versioni (`softNumbers`).
    if (ownNumbers.some((w) => /^\d{1,3}(st|nd|rd|th)?$/.test(w) && parseInt(w, 10) !== 1 && !softNumbers.has(w) && !c.words.has(w))) continue;
    if (ownNumbers.length && [...c.words].some((w) => isNumber(w) && !fullWords.has(w)) && ownNumbers.some((w) => !c.words.has(w))) continue;
    // Per la foto, un numero di volume che il nome non dice pesa ("The Best Booster Box Case": meglio il prodotto senza "Vol. 2").
    const extraNumbers = photo ? [...c.words].filter((w) => isNumber(w) && !fullWords.has(w)).length : 0;
    const score = 0.85 + 0.15 * setHit - 0.05 * extra - 0.02 * missingDigits - 0.03 * extraNumbers;
    if (!best || score > best.score) {
      if (best) {
        second = best.score;
        secondOwn = best.own;
      }
      best = { id: c.id, score, own: c.own, extra, setHit };
    } else if (score > second) {
      second = score;
      secondOwn = c.own;
    }
  }
  if (!best && want_lang === "en" && !lang && allowJa) {
    // Prodotto senza lingua su Cardmarket di un set giapponese ("Advent of Arceus Booster"): il prodotto TCGplayer
    // giapponese, solo se tutte le parole del set ci sono.
    // Il nome del set deve essere quello del gruppo TCGplayer giapponese ("DPt4: Advent of Arceus"), non parole qualsiasi
    // ("Thunderstorm Theme Deck" di "Pokémon Products" non è il mazzo giapponese).
    const ja = fuzzyMatch(fullName, name, index, "ja", false, { photo, genericSet });
    const group = ja && index.find((c) => c.id === ja.id)?.group;
    const named = required.filter((w) => !KIND_WORDS.has(w));
    return ja && group && named.length > 0 && named.every((w) => group.has(w)) ? ja : null;
  }
  if (!best || best.score < 0.8) return null;
  // Due prodotti TCGplayer col nome che dice le stesse cose (lo stesso tin in due gruppi): è lo stesso prodotto, non un dubbio.
  const kept = (ws) => [...ws].filter((w) => !optional(w));
  const sameAsSecond = secondOwn && kept(best.own).every((w) => secondOwn.has(w) || optional(w)) && kept(secondOwn).every((w) => best.own.has(w) || optional(w));
  // Il migliore non ha parole in più ("Single Pack Blister [Hatenna]") e il secondo sì ("Code Card - ..."): nessun dubbio.
  const cleanBest = best.extra === 0 && second < best.score;
  if (best.score - second < 0.05 && !sameAsSecond && !cleanBest) return null;
  return { id: best.id, score: best.score, setHit: best.setHit };
}

/** Prodotti che sono solo il contenuto, senza la confezione ("Deck Pack" di One Piece, "Decks Only" di Yu-Gi-Oh!). */
const CONTENT_ONLY = /\b(deck pack|decks? only)\b/i;

/** Numeri e ordinali ("2020", "4th", "1st"). */
const isNumber = (w) => /^\d+(st|nd|rd|th)?$/.test(w);

/** Espansioni Cardmarket che non sono un set ("Pokémon Products", "Simplified Chinese Products", "Masters Promo"). */
const genericSet = (exp) => !String(exp ?? "").trim() || /\b(products?|promos?|promotion|miscellaneous)\b/i.test(String(exp));

/** Lingua di un prodotto per gli abbinamenti con TCGplayer: "en" per gli occidentali, "jp" = "ja". */
const tpLang = (l) => (!l || l === "en" ? "en" : l === "jp" ? "ja" : l);

/**
 * Prodotti TCGplayer per nome e lingua ("ja|romance dawn booster box"): un prodotto giapponese non prende foto né prezzo di
 * quello inglese ("(Non-English)" sta tra parentesi e sealedKey le toglie). Si cerca con [tpKey].
 */
function tcgplayerByName(tpProducts, value) {
  const byName = new Map();
  for (const p of tpProducts) {
    if (isCodeCard(p.name)) continue;
    const l = tpLang(p.lang);
    const k = sealedKey(p.name);
    if (k && !byName.has(`${l}|${k}`)) byName.set(`${l}|${k}`, value(p));
    const g = sealedKey(`${p.group ?? ""} ${p.name}`);
    if (p.group && !byName.has(`${l}|${g}`)) byName.set(`${l}|${g}`, value(p));
  }
  return byName;
}

const tpKey = (lang, name) => `${tpLang(lang)}|${sealedKey(name)}`;

// Rapporto lingua/inglese dei sigillati: i sigillati hanno poche offerte, quindi soglie più basse delle carte.
const SEALED_RATIO_OPTS = { thresholds: [5, 3, 2, 1], minSamples: 100, minWeak: 20 };

/**
 * Rapporto prezzo nella lingua / prezzo in inglese dei prodotti occidentali, dalle offerte CardTrader
 * dei sigillati (stessa idea delle carte: stesso sito, il sovrapprezzo si annulla). Dove i sigillati
 * confrontabili sono troppo pochi vale il rapporto delle carte singole (cardCoef), segnato con 0 prodotti.
 * @returns {Record<string, [number, number]>} lingua -> [rapporto, prodotti usati (0 = dalle carte)]
 */
export function sealedCoefficients(out, cardCoef = {}, langs = SEALED_LANGS) {
  const coef = {};
  for (const lang of langs) {
    if (lang === "en" || lang === "ja") continue;
    const samples = [];
    for (const p of out) {
      if (p.l) continue; // asiatici: una sola lingua
      const a = p.ct?.[lang];
      const b = p.ct?.en;
      if (!a || !b || !(b[0] > 0)) continue;
      samples.push({ exp: p.e, ratio: a[0] / b[0], offers: Math.min(a[1], b[1]) });
    }
    const c = coefficients(samples, SEALED_RATIO_OPTS);
    if (c.all) coef[lang] = c.all;
    else if (cardCoef[lang] > 0) coef[lang] = [cardCoef[lang], 0];
  }
  // Francese, spagnolo, portoghese e tedesco: il rapporto dell'italiano, come per le carte (RATIO_FROM_IT; richiesto
  // dall'utente il 4 novembre 2026: misurati sui sigillati erano fr 100%, de 89%, es 83% contro l'italiano 74%).
  // Terzo elemento: la lingua da cui viene.
  if (coef.it) {
    for (const lang of RATIO_FROM_IT) {
      if (langs.includes(lang)) coef[lang] = [coef.it[0], coef.it[1], "it"];
    }
  }
  return coef;
}

export function buildSealed({
  products, singles = [], guide, cmToCtExp, ctExpNames, ctProducts, ctExpLangs = new Map(), ctPrices = {},
  types = SEALED_TYPES, westernLang = null, tpProducts = [], cardCoef = {}, now = new Date(), ctUnlinked = [], crossLangPhotos = false,
}) {
  const log = [];
  const prices = new Map((guide.priceGuides || []).map((g) => [Number(g.idProduct), g]));

  // Nome di ogni espansione Cardmarket: l'espansione CardTrader più votata dai suoi prodotti.
  const votes = new Map(); // idEspansione -> Map(ctExp -> voti)
  for (const p of [...products, ...singles]) {
    const ctExp = cmToCtExp.get(Number(p.idProduct));
    if (ctExp === undefined) continue;
    const v = votes.get(p.idExpansion) || new Map();
    v.set(ctExp, (v.get(ctExp) || 0) + 1);
    votes.set(p.idExpansion, v);
  }
  const exp = {};
  const votedCtExp = new Map();
  for (const [id, v] of votes) {
    const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
    votedCtExp.set(id, best);
    const name = ctExpNames.get(best);
    if (name) exp[id] = name;
  }
  // Prodotti senza collegamento a CardTrader: asiatici se il nome comincia con un'espansione asiatica
  // ("Islands Await You Booster").
  const asianNames = [...ctExpNames.entries()]
    .map(([e, name]) => [String(name).toLowerCase(), asianFromCt(ctExpLangs.get(e))])
    .filter(([name, lang]) => lang && name.length >= 6);
  const langOf = (p) => {
    // Il nome di Cardmarket, quando dice la lingua, vale più di CardTrader (One Piece:
    // "... (Non-English)" = giapponese, "... (English Version)" = inglese).
    if (/\((English|English Version)\)/i.test(p.name)) return null;
    if (/Non-English/i.test(p.name)) return asianLang(p.name, exp[p.idExpansion], "ja");
    if (JAPANESE_ONLY.test(p.name)) return "ja";
    // Yu-Gi-Oh! "(OCG)" = stampa asiatica (giapponese se il nome non dice altro): 73 prodotti su 95 erano dati per inglesi
    // (18 novembre 2026), quelli senza un set CardTrader "… OCG". La ricerca eBay e le foto li trattavano già da giapponesi.
    if (/\(OCG\)/i.test(p.name)) return asianLang(p.name, exp[p.idExpansion], "ja");
    const id = Number(p.idProduct);
    const own = ctProducts.get(id)?.lang;
    const ctExp = cmToCtExp.get(id) ?? votedCtExp.get(p.idExpansion);
    const ct = own ? asianFromCt(own)
      : ctExp !== undefined ? asianFromCt(ctExpLangs.get(ctExp))
      : asianNames.find(([name]) => String(p.name).toLowerCase().startsWith(name))?.[1] ?? null;
    const byName = isAsian(p.name) || isAsian(exp[p.idExpansion]) || CHINESE_EXP.test(String(p.name || "")) ||
      CHINESE_EXP.test(String(exp[p.idExpansion] || ""));
    return ct || byName ? asianLang(p.name, exp[p.idExpansion], ct || "ja") : null;
  };

  // Espansioni quasi tutte asiatiche (almeno 4 prodotti e 3 su 4): anche gli altri prodotti sono in quella
  // lingua ("Collect 151: First Partner Premium Gift Box" tra i "151C: Collect 151 ..." cinesi).
  const langs = new Map(products.filter((p) => types[p.categoryName]).map((p) => [p, langOf(p)]));
  const expLang = new Map();
  for (const e of new Set(products.map((p) => p.idExpansion))) {
    const items = [...langs].filter(([p]) => p.idExpansion === e);
    const counts = new Map();
    for (const [, l] of items) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (best && n >= 4 && n >= 0.75 * items.length) expLang.set(e, best);
  }

  const out = [];
  let badTrends = 0;
  for (const p of products) {
    const t = types[p.categoryName];
    if (!t) continue;
    const lang = langs.get(p) ?? expLang.get(p.idExpansion) ?? westernLang;
    const id = Number(p.idProduct);
    const { cm, bad } = guideCm(prices.get(id));
    if (bad) badTrends++;
    const ct = guideOffers(ctPrices, id, cm);
    const link = ctProducts.get(id);
    out.push({
      id,
      n: String(p.name || "").trim(),
      t,
      e: p.idExpansion,
      d: String(p.dateAdded || "").slice(0, 10),
      ...(lang ? { l: lang } : {}),
      img: link?.img || null,
      bp: link?.bp || null,
      cm: Object.keys(cm).length ? cm : null,
      ct,
    });
  }
  const fixed = fixLangsFromOffers(out, westernLang);
  if (fixed.toJa || fixed.toWestern) log.push(`Lingua corretta dalle offerte: ${fixed.toJa} prodotti giapponesi, ${fixed.toWestern} occidentali`);
  // Prodotti Cardmarket doppi (stesso nome e lingua, es. due "Alolan Raichu Box"): quello senza prezzo
  // né foto non serve a niente, se l'altro ha almeno uno dei due.
  const twinKey = (p) => `${sealedKey(p.n)}|${p.l ?? ""}`;
  const twins = new Map();
  for (const p of out) (twins.get(twinKey(p)) ?? twins.set(twinKey(p), []).get(twinKey(p))).push(p);
  const useless = new Set();
  for (const list of twins.values()) {
    if (list.length < 2) continue;
    const useful = list.filter((p) => p.cm?.trend || Object.keys(p.ct).length > 0 || p.img);
    if (useful.length > 0) for (const p of list) if (!useful.includes(p)) useless.add(p.id);
  }
  if (useless.size > 0) {
    for (let i = out.length - 1; i >= 0; i--) if (useless.has(out[i].id)) out.splice(i, 1);
    log.push(`Sigillati doppi senza prezzo né foto tolti: ${useless.size}`);
  }
  // Prodotti che CardTrader collega a Cardmarket ma che non sono (più) nel catalogo Cardmarket
  // (es. "The Glory of Team Rocket Attaché Case"): nome, foto e prezzi da CardTrader. Non se un
  // prodotto Cardmarket con lo stesso nome e lingua c'è già (sarebbe un doppione: "Empty Level Ball Tin").
  const have = new Set(out.map((p) => p.id));
  const haveNames = new Set(out.map(twinKey));
  let ctOnly = 0;
  let ctTwins = 0;
  let ctOnlyTrend = 0;
  for (const [id, link] of ctProducts) {
    if (have.has(id) || !link.name) continue;
    // Lingua: quella predefinita del blueprint; se manca, quella dell'espansione CardTrader (la valigetta
    // "The Glory of Team Rocket Attaché Case" è giapponese come il resto del set).
    const linkLang = asianFromCt(link.lang) ?? asianFromCt(ctExpLangs.get(link.ctExp)) ?? westernLang;
    // Doppione anche se CardTrader mette parte del nome nell'espansione: "Ultra-Premium Collection | Charizard"
    // nell'espansione "Sword & Shield: Ultra-Premium Collection | Charizard" = "Sword & Shield Ultra-Premium
    // Collection - Charizard" di Cardmarket.
    const expName = ctExpNames.get(link.ctExp) ?? "";
    const twin = [link.name, `${expName} ${link.name}`, expName].some((n) => haveNames.has(`${sealedKey(n)}|${linkLang ?? ""}`));
    if (twin) {
      ctTwins++;
      continue;
    }
    // Il listino Cardmarket ha anche questi prodotti (monete, spille, carte giganti: categorie che non stanno nell'elenco dei
    // sigillati): stessa tendenza e stesse regole degli altri (riverifica del 19 novembre 2026, approvato dall'utente: prima
    // `cm: null` e 604 prodotti Pokémon restavano senza prezzo con la tendenza del giorno nel listino).
    const { cm, bad } = guideCm(prices.get(id));
    if (bad) badTrends++;
    if (cm.trend) ctOnlyTrend++;
    const ct = guideOffers(ctPrices, id, cm);
    const lang = linkLang;
    const expKey = -Number(link.ctExp);
    if (ctExpNames.get(link.ctExp)) exp[expKey] = ctExpNames.get(link.ctExp);
    out.push({ id, n: String(link.name).trim(), t: guessType(link.name), e: expKey, d: "", ...(lang ? { l: lang } : {}), img: link.img || null, bp: link.bp || null, cm: Object.keys(cm).length ? cm : null, ct });
    have.add(id);
    ctOnly++;
  }
  log.push(`Sigillati solo su CardTrader: ${ctOnly}${ctTwins ? ` (${ctTwins} doppioni di prodotti Cardmarket scartati)` : ""}, ${ctOnlyTrend} con la tendenza del listino Cardmarket`);
  if (badTrends) log.push(`Tendenze Cardmarket non credibili (segnaposto o sotto 1 € col minimo dieci volte più su) scartate: ${badTrends}`);
  const contradicted = boxBelowBooster(out);
  if (contradicted.length) log.push(`Tendenze tolte perché il box varrebbe meno di una sua busta: ${contradicted.length} (${contradicted.slice(0, 5).map((d) => d.n).join("; ")})`);
  // Foto TCGplayer per i prodotti che CardTrader non fotografa.
  // Foto dai sigillati CardTrader non collegati a Cardmarket (Gem Pack cinesi, prodotti giapponesi...): stesso nome o il più
  // somigliante dello stesso tipo e della stessa lingua. Prima di TCGplayer ed eBay (richiesto dall'utente: eBay per ultimo).
  // Le lingue occidentali contano come una sola: Cardmarket ha un prodotto per tutte.
  const ctLangOf = (u) => {
    const l = asianFromCt(u.lang) ?? asianFromCt(ctExpLangs.get(u.ctExp));
    return l ?? "en";
  };
  const ctAsTp = ctUnlinked.map((u) => ({ id: u.bp, name: u.name, group: ctExpNames.get(u.ctExp) ?? "", lang: ctLangOf(u), img: u.img }));
  const ctImgById = new Map(ctAsTp.map((u) => [u.id, u.img]));
  const ctExact = tcgplayerByName(ctAsTp, (u) => u.img);
  const ctFuzzy = fuzzyIndex(ctAsTp);
  let fromCtName = 0;
  for (const p of out) {
    if (p.img) continue;
    const pl = p.l ?? westernLang;
    let img = ctExact.get(tpKey(pl, p.n)) ?? ctExact.get(tpKey(pl, `${exp[p.e] ?? ""} ${p.n}`));
    if (!img) {
      const m = fuzzyMatch(`${exp[p.e] ?? ""} ${p.n}`, p.n, ctFuzzy, pl, true, { photo: true, genericSet: genericSet(exp[p.e]) });
      if (m) img = ctImgById.get(m.id);
    }
    if (img) {
      p.img = img;
      fromCtName++;
    }
  }
  if (ctUnlinked.length > 0) log.push(`Foto CardTrader per nome (sigillati non collegati a Cardmarket: ${ctUnlinked.length}): ${fromCtName}`);
  const tpImages = tcgplayerImages(tpProducts);
  const tpFuzzy = fuzzyIndex(tpProducts);
  // Prodotti TCGplayer senza foto ("imageCount" 0): abbinati lo stesso, così non si prende per somiglianza un altro prodotto che
  // la foto ce l'ha, ma il sigillato resta senza e la prendono le altre fonti (foto a mano, eBay). Prima "tp:<id>" vuoto
  // bloccava tutto: 6 sigillati Dragon Ball su 64 senza foto nell'app (7 novembre 2026).
  const tpNoImg = new Set(tpProducts.filter((p) => p.noImg).map((p) => `tp:${p.id}`));
  let fromTp = 0;
  let tpEmpty = 0;
  let fromTpFuzzy = 0;
  for (const p of out) {
    if (p.img) continue;
    const pl = p.l ?? westernLang;
    let img = tpImages.get(tpKey(pl, p.n)) ?? tpImages.get(tpKey(pl, `${exp[p.e] ?? ""} ${p.n}`));
    let viaFuzzy = false;
    // Nomi scritti in modo diverso ("Elite Trainer Box" / "Elite Trainer Box [Pokemon Center]", set davanti o dietro):
    // il prodotto TCGplayer più somigliante dello stesso tipo, solo se è chiaramente il migliore (fuzzyMatch).
    if (!img) {
      const full = `${exp[p.e] ?? ""} ${p.n}`;
      const opts = { photo: true, genericSet: genericSet(exp[p.e]) };
      const m = fuzzyMatch(full, p.n, tpFuzzy, p.l ?? westernLang, true, opts)
        // One Piece, Dragon Ball, Lorcana ([crossLangPhotos]): TCGplayer ha solo le confezioni inglesi e quella giapponese ha
        // lo stesso disegno, meglio di un'inserzione eBay (0.9.160, richiesto dall'utente: eBay per ultimo). Pokémon no (i set
        // giapponesi sono altri prodotti), Yu-Gi-Oh! nemmeno (confezioni OCG diverse: Yugipedia, foto-fonti.js).
        ?? (crossLangPhotos && p.l && p.l !== westernLang ? fuzzyMatch(full, p.n, tpFuzzy, westernLang, true, opts) : null);
      if (m) img = `tp:${m.id}`;
      viaFuzzy = Boolean(m);
    }
    if (img && tpNoImg.has(img)) {
      tpEmpty++;
      continue;
    }
    if (img) {
      p.img = img;
      fromTp++;
      if (viaFuzzy) fromTpFuzzy++;
    }
  }
  if (fromTpFuzzy) log.push(`  di cui per somiglianza del nome: ${fromTpFuzzy}`);
  if (tpEmpty) log.push(`  prodotti TCGplayer senza foto, lasciati alle altre fonti: ${tpEmpty}`);
  if (tpProducts.length > 0) log.push(`Foto TCGplayer per i sigillati senza foto: ${fromTp} (restano senza ${out.filter((p) => !p.img).length})`);
  // Prodotto TCGplayer di ogni sigillato, con o senza foto (campo "tp" = [prodotto, gruppo]): l'app ne legge l'andamento dal
  // 2024 (storico/v1/tp/<gruppo>.json) per il valore della collezione nelle settimane passate (0.9.140).
  const linked = addSealedTcgplayer(out, tpProducts, exp, westernLang, log);
  if (tpProducts.length > 0) log.push(`Prodotto TCGplayer dei sigillati (per l'andamento): ${linked} su ${out.length}`);
  // Prezzo TCGplayer ("tcgplayer" in cm, come i prodotti di TcgplayerCatalog) per chi non ha né Cardmarket né CardTrader.
  const tpPrices = tcgplayerPrices(tpProducts);
  let priced = 0;
  for (const p of out) {
    if (p.cm?.trend || Object.keys(p.ct).length > 0) continue;
    const eur = tpPrices.get(tpKey(p.l ?? westernLang, p.n)) ?? tpPrices.get(tpKey(p.l ?? westernLang, `${exp[p.e] ?? ""} ${p.n}`));
    if (eur) {
      p.cm = { ...(p.cm ?? {}), tcgplayer: eur };
      priced++;
    }
  }
  if (tpProducts.length > 0) log.push(`Prezzo TCGplayer per i sigillati senza prezzo: ${priced} (restano senza ${out.filter((p) => !p.cm?.trend && !p.cm?.tcgplayer && Object.keys(p.ct).length === 0).length})`);
  // Rapporto di lingua dei sigillati (solo Pokémon: i prodotti One Piece hanno una lingua sola).
  const coef = westernLang === null ? sealedCoefficients(out, cardCoef) : {};
  if (westernLang === null) {
    log.push(
      "Rapporto sigillati lingua/inglese: " +
        (Object.entries(coef).map(([l, [r, n]]) => `${l} ${Math.round(r * 100)}%${n ? ` (${n} prodotti)` : " (dalle carte)"}`).join(", ") || "n/d"),
    );
  }
  // Solo le espansioni usate.
  const used = new Set(out.map((p) => String(p.e)));
  for (const k of Object.keys(exp)) if (!used.has(k)) delete exp[k];
  log.push(
    `Sigillati: ${out.length} prodotti (${out.filter((p) => p.l && p.l !== westernLang).length} asiatici), ${out.filter((p) => p.cm?.trend).length} con prezzo Cardmarket, ` +
      `${out.filter((p) => Object.keys(p.ct).length).length} con offerte CardTrader, ${out.filter((p) => p.img).length} con foto, ` +
      `${out.filter((p) => exp[p.e]).length} con il nome dell'espansione`,
  );
  return { data: { v: 1, updated: now.toISOString(), exp, ...(Object.keys(coef).length ? { coef } : {}), p: out }, log };
}
