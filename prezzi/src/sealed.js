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
import { estimate, coefficients } from "./stats.js";
import { isPlaceholderPrice } from "./onepiece.js";

/** Categorie Cardmarket dei prodotti sigillati -> tipo nell'app. Esclusi monete e lotti. */
export const SEALED_TYPES = {
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

/** Lingue dei prezzi CardTrader (codici dell'app; il giapponese su CardTrader è "jp"). */
export const SEALED_LANGS = ["en", "it", "fr", "de", "es", "pt", "ja"];

// Prodotti asiatici: "JP Booster Box", "Chinese ...", "CSV10.5C: ... S-Ch", espansioni "CSV7: Blade Awakening".
const ASIAN = /\b(JP|Japan|Japanese|Chinese|S-Ch|T-Ch|Korean|Thai|Indonesian)\b|^C(S|SV|SM|BB)[\w.]*C\b/i;
const CHINESE_EXP = /^(CS|CSV|CSM|CBB|CSH|CSI|CSML|CSMJ|CSVE|CSVL)[\w.]*:|^\d+C:/;

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
  return estimate(offers.filter((o) => o.sealed !== false && !isPlaceholderPrice(o.price)), "n");
}

/** Lingue CardTrader dei prodotti asiatici -> codici dell'app. */
const CT_ASIAN_LANGS = { jp: "ja", "zh-CN": "zh-cn", "zh-TW": "zh-tw", kr: "ko", id: "id", th: "th" };

/** Lingua predefinita di un blueprint CardTrader ("jp", "en"...), da editable_properties. */
export function blueprintLanguage(bp) {
  const p = (bp?.editable_properties || []).find((x) => String(x.name).endsWith("_language"));
  return typeof p?.default_value === "string" ? p.default_value : null;
}

/** Lingua dell'app di un prodotto asiatico per la lingua CardTrader; null se occidentale o sconosciuta. */
export function asianFromCt(ctLang) {
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
    .replace(/pokémon/g, "pokemon")
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
export function tcgplayerPrices(tpProducts) {
  return tcgplayerByName(tpProducts.filter((p) => p.eur > 0), (p) => p.eur);
}

function tcgplayerByName(tpProducts, value) {
  const byName = new Map();
  for (const p of tpProducts) {
    const k = sealedKey(p.name);
    if (k && !byName.has(k)) byName.set(k, value(p));
    const g = sealedKey(`${p.group ?? ""} ${p.name}`);
    if (p.group && !byName.has(g)) byName.set(g, value(p));
  }
  return byName;
}

// Rapporto lingua/inglese dei sigillati: i sigillati hanno poche offerte, quindi soglie più basse delle carte.
export const SEALED_RATIO_OPTS = { thresholds: [5, 3, 2, 1], minSamples: 100, minWeak: 20 };

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
  return coef;
}

export function buildSealed({
  products, singles = [], guide, cmToCtExp, ctExpNames, ctProducts, ctExpLangs = new Map(), ctPrices = {},
  types = SEALED_TYPES, westernLang = null, tpProducts = [], cardCoef = {}, now = new Date(),
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
  for (const p of products) {
    const t = types[p.categoryName];
    if (!t) continue;
    const lang = langs.get(p) ?? expLang.get(p.idExpansion) ?? westernLang;
    const id = Number(p.idProduct);
    const g = prices.get(id);
    const cm = {};
    for (const k of ["trend", "low", "avg30"]) if (typeof g?.[k] === "number" && g[k] > 0) cm[k] = g[k];
    const ct = {};
    for (const [lang, m] of Object.entries(ctPrices)) {
      const est = m.get(id);
      // Lontanissimo da Cardmarket (più del triplo o meno di un terzo): poche offerte fuori mercato,
      // es. Elite Trainer Box Surging Sparks in inglese a 5.076 € (Cardmarket 133 €). Meglio nessun prezzo.
      if (est && !(cm.trend && (est[0] > 3 * cm.trend || est[0] < cm.trend / 3))) ct[lang] = est;
    }
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
  for (const [id, link] of ctProducts) {
    if (have.has(id) || !link.name) continue;
    const linkLang = asianFromCt(link.lang) ?? westernLang;
    // Doppione anche se CardTrader mette parte del nome nell'espansione: "Ultra-Premium Collection | Charizard"
    // nell'espansione "Sword & Shield: Ultra-Premium Collection | Charizard" = "Sword & Shield Ultra-Premium
    // Collection - Charizard" di Cardmarket.
    const expName = ctExpNames.get(link.ctExp) ?? "";
    const twin = [link.name, `${expName} ${link.name}`, expName].some((n) => haveNames.has(`${sealedKey(n)}|${linkLang ?? ""}`));
    if (twin) {
      ctTwins++;
      continue;
    }
    const ct = {};
    for (const [lang, m] of Object.entries(ctPrices)) {
      const est = m.get(id);
      if (est) ct[lang] = est;
    }
    const lang = linkLang;
    const expKey = -Number(link.ctExp);
    if (ctExpNames.get(link.ctExp)) exp[expKey] = ctExpNames.get(link.ctExp);
    out.push({ id, n: String(link.name).trim(), t: guessType(link.name), e: expKey, d: "", ...(lang ? { l: lang } : {}), img: link.img || null, bp: link.bp || null, cm: null, ct });
    have.add(id);
    ctOnly++;
  }
  log.push(`Sigillati solo su CardTrader: ${ctOnly}${ctTwins ? ` (${ctTwins} doppioni di prodotti Cardmarket scartati)` : ""}`);
  // Foto TCGplayer per i prodotti che CardTrader non fotografa.
  const tpImages = tcgplayerImages(tpProducts);
  let fromTp = 0;
  for (const p of out) {
    if (p.img) continue;
    const img = tpImages.get(sealedKey(p.n)) ?? tpImages.get(sealedKey(`${exp[p.e] ?? ""} ${p.n}`));
    if (img) {
      p.img = img;
      fromTp++;
    }
  }
  if (tpProducts.length > 0) log.push(`Foto TCGplayer per i sigillati senza foto: ${fromTp} (restano senza ${out.filter((p) => !p.img).length})`);
  // Prezzo TCGplayer ("tcgplayer" in cm, come i prodotti di TcgplayerCatalog) per chi non ha né Cardmarket né CardTrader.
  const tpPrices = tcgplayerPrices(tpProducts);
  let priced = 0;
  for (const p of out) {
    if (p.cm?.trend || Object.keys(p.ct).length > 0) continue;
    const eur = tpPrices.get(sealedKey(p.n)) ?? tpPrices.get(sealedKey(`${exp[p.e] ?? ""} ${p.n}`));
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
