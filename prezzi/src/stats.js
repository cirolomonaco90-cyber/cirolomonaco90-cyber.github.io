// Algoritmo di stima (stessa logica di PriceEngine.kt nell'app). Funzioni pure, testate.

/** Coefficienti di condizione per riportare un'offerta a Near Mint. */
const CONDITION_FACTOR = {
  "mint": 1.05,
  "near mint": 1.0,
  "slightly played": 0.85,
  "moderately played": 0.7,
  "played": 0.4,
  "heavily played": 0.25,
  "poor": 0.25,
};

function conditionFactor(name) {
  return CONDITION_FACTOR[String(name || "").trim().toLowerCase()] ?? 1.0;
}

/** Condizioni CardTrader -> codici delle condizioni dell'app (Condition.code in Valuation.kt). */
const CT_CONDITION_CODE = {
  "mint": "M",
  "near mint": "NM",
  "slightly played": "EX",
  "moderately played": "GD",
  "played": "PL",
  "heavily played": "PO",
  "poor": "PO",
};

/** Offerte minime in una condizione perché il suo prezzo sia pubblicato. */
const MIN_OFFERS_FOR_CONDITION = 3;

/**
 * Prezzi per condizione dalle offerte di una lingua: per ogni condizione con almeno
 * MIN_OFFERS_FOR_CONDITION offerte, la mediana delle 5 più economiche così come sono (non riportate
 * a NM), scartata un'offerta anomala. L'app confronta la condizione con Near Mint della stessa lingua
 * e ottiene la percentuale della condizione misurata sul mercato invece di quella fissa.
 * Pubblicato con almeno due condizioni: fino all'11 novembre 2026 solo se c'era anche Near Mint (per la percentuale), ma
 * l'app (0.9.177, PriceEngine.conditionValue) aggancia il valore di una copia alle offerte nella sua condizione, e sulle
 * carte d'epoca le Near Mint in vendita sono spesso meno di tre. Le app di prima, senza Near Mint, usano la tabella.
 *
 * **In misura dall'11 novembre 2026** (approvato dall'utente: "Sì, misura prima"): dopo i primi due numeri, che l'app legge
 * e che non cambiano, i tre prezzi più economici della condizione senza i prezzi finti ([fakePrices]), 0 dove mancano.
 * La mediana di poche offerte sparse non è "quanto costa comprarla": Baron of the Fiend Sword SDY-036 di Yu-Gi-Oh! ha le
 * Near Mint a 2,30 €, 19,40 € e 200,64 € (un venditore che chiede 200,64 € in ogni condizione), mediana 52 €, e l'app lo
 * valutava 31,66 €. Con questi numeri si misura su tutti i cataloghi cosa cambierebbe usando l'offerta più economica o la
 * seconda (file riscritti in prova e CoerenzaCataloghiTest dell'app), prima di decidere; l'app di oggi li ignora.
 * @returns {Record<string, number[]> | null} codice condizione -> [prezzo, offerte, 1ª, 2ª e 3ª più economica, mediana e media delle 5 più economiche senza prezzi finti]
 */
export function conditionPrices(offers, variant, currency = "EUR") {
  const usable = withoutAbsurd(
    offers.filter(
      (o) => !o.graded && o.bundle <= 1 && o.quantity > 0 && o.price > 0 && !isPlaceholderPrice(o.price) && o.currency === currency && matchesVariant(o, variant),
    ),
  );
  const by = {};
  const coded = [];
  for (const o of usable) {
    const code = CT_CONDITION_CODE[String(o.condition || "").trim().toLowerCase()];
    if (!code) continue;
    (by[code] ||= []).push(o.price);
    coded.push({ code, price: o.price });
  }
  const fake = fakePrices(coded);
  const out = {};
  for (const [code, list] of Object.entries(by)) {
    if (list.length < MIN_OFFERS_FOR_CONDITION) continue;
    const s = [...list].sort((a, b) => a - b);
    const real = s.filter((p) => !fake.has(p));
    if (s.length >= 4 && s[0] < 0.5 * s[1]) s.shift();
    // Sesto numero (19 novembre 2026, in misura, deciso dall'utente: "si, e domani misuriamo"): la stessa mediana delle 5
    // più economiche, con la stessa protezione dalla più bassa anomala, ma senza i prezzi finti ([fakePrices]): oggi un
    // venditore che chiede 200,64 € in ogni condizione entra nella mediana (Baron of the Fiend Sword: 85 € invece di 19,40 €).
    const r2 = [...real];
    if (r2.length >= 4 && r2[0] < 0.5 * r2[1]) r2.shift();
    // Settimo numero (stesso giorno, chiesto dall'utente: "fai anche la media senza i prezzi finti"): la media delle stesse 5.
    const five = r2.slice(0, 5);
    const mean = five.length ? five.reduce((a, b) => a + b, 0) / five.length : 0;
    out[code] = [round2(median(s.slice(0, 5))), list.length, ...[0, 1, 2].map((i) => round2(real[i] ?? 0)), round2(five.length ? median(five) : 0), round2(mean)];
  }
  return Object.keys(out).length >= 2 ? out : null;
}

/**
 * Offerte minime della variante perché il job scriva [heldPrices]: il pavimento dell'app vale da 3 offerte in su (col peso delle
 * offerte, pieno da 6: PriceEngine.combine dalla 0.9.216; prima solo da 6, e con un'offerta in meno spariva).
 */
const MIN_OFFERS_FOR_HELD = 3;

/**
 * Prezzi veri per condizione, anche con una sola offerta ("nq", "rq", "fq" nei file di lingua, 0.9.213, 14 novembre 2026):
 * {codice: [mediana delle 5 più economiche così come sono, offerte]}, senza i prezzi finti ([fakePrices]). L'app li usa per
 * limitare il pavimento delle offerte (PriceEngine.conditionValue): il minimo calcolato col Near Mint ricavato dalla tabella
 * non porta una copia oltre il 90% di quanto costano le copie in vendita nella sua condizione o in una peggiore. Nato dal
 * Lugia di Aquapolis italiano Good: 3.938 € col pavimento (due Poor a 2.500 € riportate a Near Mint con la tabella valevano
 * 10.000 €) e una sola Good in vendita a 2.750 €; un'offerta in meno spegneva il pavimento e la copia scendeva a 2.598 €.
 * null con meno di [min] offerte della variante (di solito [MIN_OFFERS_FOR_HELD]: il pavimento non c'è) o senza condizioni
 * riconosciute.
 */
export function heldPrices(offers, variant, currency = "EUR", min = MIN_OFFERS_FOR_HELD) {
  const usable = withoutAbsurd(
    offers.filter(
      (o) => !o.graded && o.bundle <= 1 && o.quantity > 0 && o.price > 0 && !isPlaceholderPrice(o.price) && o.currency === currency && matchesVariant(o, variant),
    ),
  );
  if (usable.length < min) return null;
  const coded = [];
  for (const o of usable) {
    const code = CT_CONDITION_CODE[String(o.condition || "").trim().toLowerCase()];
    if (code) coded.push({ code, price: o.price });
  }
  const fake = fakePrices(coded);
  const by = {};
  for (const o of coded) if (!fake.has(o.price)) (by[o.code] ||= []).push(o.price);
  const out = {};
  for (const [code, list] of Object.entries(by)) {
    const s = list.sort((a, b) => a - b);
    out[code] = [round2(median(s.slice(0, 5))), s.length];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Le copie in vendita di una variante con una o due offerte in tutto ("nt", "rt", "ft" nei file di lingua, 25 novembre 2026):
 * come [heldPrices], per le varianti sotto [MIN_OFFERS_FOR_HELD] offerte. Le legge solo il limite della tendenza come copia
 * media dell'app (PriceFixes.trendCap): l'aumento non porta una copia sopra una copia in vendita nella sua condizione o in una
 * migliore, anche se è una sola. In campi a parte perché pavimento, agganci e tetto dell'app (anche delle versioni già
 * installate, che leggono "nq") restino da 3 offerte. null da [MIN_OFFERS_FOR_HELD] offerte in su (ci sono già i "q").
 */
export function thinPrices(offers, variant, currency = "EUR") {
  // Con 3 o più offerte e nessuna condizione riconosciuta anche questa lettura è vuota: niente.
  return heldPrices(offers, variant, currency) ? null : heldPrices(offers, variant, currency, 1);
}

/** Un prezzo è finto se lo stesso identico prezzo sta in almeno tante condizioni diverse della carta... */
const FAKE_PRICE_CONDITIONS = 3;
/** ...ed è almeno tante volte il prezzo di mezzo di tutte le offerte della carta. */
const FAKE_PRICE_TIMES = 3;

/**
 * Prezzi "per non vendere": un venditore che chiede la stessa cifra alta per ogni condizione della carta (Card-Foundry,
 * 200,64 € per Near Mint, Slightly Played, Moderately Played e Played di una comune che si compra a 0,20 €). Non contano i
 * prezzi bassi uguali in più condizioni (le comuni al prezzo minimo, 0,19 € in Poor, Played e Slightly Played): solo
 * quelli da [FAKE_PRICE_TIMES] volte il prezzo di mezzo di tutte le offerte in su.
 * @param {{code: string, price: number}[]} offers offerte già filtrate, con il codice della condizione
 * @returns {Set<number>}
 */
export function fakePrices(offers) {
  if (offers.length === 0) return new Set();
  const middle = median(offers.map((o) => o.price));
  const codes = new Map();
  for (const o of offers) {
    if (!codes.has(o.price)) codes.set(o.price, new Set());
    codes.get(o.price).add(o.code);
  }
  return new Set([...codes].filter(([price, set]) => set.size >= FAKE_PRICE_CONDITIONS && price >= FAKE_PRICE_TIMES * middle).map(([price]) => price));
}

/** Un prezzo da tanti euro in su... */
const ABSURD_MIN_PRICE = 1000;
/** ...che è almeno tante volte il prezzo di mezzo di tutte le offerte della carta (almeno [ABSURD_MIN_OFFERS])... */
const ABSURD_TIMES = 50;
const ABSURD_MIN_OFFERS = 3;

/**
 * ...non è un prezzo, anche se non è tondo e sta in una condizione sola (17 novembre 2026: Elemental HERO Burstinatrix YSD-008
 * di Yu-Gi-Oh! in inglese, comune da 0,72 €, con due offerte Slightly Played a 10.225 €, cioè 10.100 € più la commissione:
 * [isPlaceholderPrice] riconosce solo le migliaia tonde e [fakePrices] voleva lo stesso prezzo in tre condizioni; la
 * condizione usciva a 10.225 € e l'app portava il Near Mint a 4.601,61 €). Sulle carte vere la distanza più grande
 * misurata tra una condizione e il prezzo di mezzo è intorno a 10 volte. Stessa regola nell'app (ConditionSanity.kt), per
 * i file già sui telefoni.
 */
export function isAbsurdPrice(price, middle, count) {
  return price >= ABSURD_MIN_PRICE && count >= ABSURD_MIN_OFFERS && middle > 0 && price >= ABSURD_TIMES * middle;
}

/** Le offerte (già filtrate per variante e valuta) senza i prezzi fuori dal mondo ([isAbsurdPrice]) rispetto al loro prezzo di mezzo. */
export function withoutAbsurd(offers) {
  if (offers.length < ABSURD_MIN_OFFERS || !offers.some((o) => o.price >= ABSURD_MIN_PRICE)) return offers;
  const middle = median(offers.map((o) => o.price));
  return offers.filter((o) => !isAbsurdPrice(o.price, middle, offers.length));
}

export function median(values) {
  if (values.length === 0) throw new Error("median di un elenco vuoto");
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Prezzo "segnaposto": alcuni venditori mettono 1.000, 5.000, 10.000 € (più la commissione) per non
 * vendere. Fuori da ogni stima (es. Latios HGSS11 in italiano a 5.028 €, Lugia Aquapolis a 10.000 €).
 */
export function isPlaceholderPrice(price) {
  // Con la commissione di CardTrader (1,22%) 10.000 € diventano 10.122 €, 20.000 € 20.244 €: il margine cresce col prezzo
  // (9 novembre 2026: cinque carte Dragon Ball a 10.122,14 € e una Yu-Gi-Oh! a 24 milioni facevano il prezzo da sole).
  return price >= 1000 && price % 1000 < Math.max(50, price * 0.013);
}

/** Varianti: n = normale/holo, r = reverse, f = 1ª edizione. */
function matchesVariant(o, v) {
  if (v === "r") return o.reverse === true;
  if (v === "f") return o.firstEdition === true;
  return o.reverse !== true && o.firstEdition !== true;
}

/**
 * Stima Near Mint dalle offerte di una lingua:
 * esclude graded/lotti/altre valute, riporta a NM, scarta un'offerta anomala
 * (meno della metà della successiva) e prende la mediana delle 5 più economiche.
 * [thinLowest]: con una o due offerte vale la più bassa, non la loro media (giochi presi tutti da CardTrader, dove la stima
 * è il prezzo: un'offerta a 1.200 € accanto a una a 3 € dava 600 €).
 * @returns {[number, number] | null} [prezzo NM, numero di offerte]
 */
export function estimate(offers, variant, currency = "EUR", { thinLowest = false } = {}) {
  const usable = withoutAbsurd(
    offers.filter(
      (o) => !o.graded && o.bundle <= 1 && o.quantity > 0 && o.price > 0 && !isPlaceholderPrice(o.price) && o.currency === currency && matchesVariant(o, variant),
    ),
  );
  if (usable.length === 0) return null;
  const nm = usable.map((o) => o.price / conditionFactor(o.condition)).sort((a, b) => a - b);
  if (nm.length >= 4 && nm[0] < 0.5 * nm[1]) nm.shift();
  if (thinLowest && nm.length <= 2) return [round2(nm[0]), usable.length];
  return [round2(median(nm.slice(0, 5))), usable.length];
}

// Soglie verificate sui dati reali (ottobre 2026): con poche offerte la mediana delle più
// economiche è sistematicamente più alta, quindi il rapporto con l'inglese (che ha molte
// offerte) risulta gonfiato (tedesco: 1,42 con almeno 3 offerte, 1,27 con almeno 8). Per
// l'italiano il rapporto è stabile a ogni soglia. Per ogni lingua si usa quindi la soglia più
// alta che lascia abbastanza carte (MIN_SAMPLES_FOR_LANG); se nessuna basta, la più bassa con
// almeno MIN_SAMPLES_FOR_WEAK_LANG carte. Ogni lingua ha così il suo rapporto (richiesto
// dall'utente, ottobre 2026: mai lo stesso prezzo per tutte le lingue), anche se meno preciso.
const OFFER_THRESHOLDS = [15, 8, 5, 3];
const MIN_OFFERS_FOR_COEF = OFFER_THRESHOLDS[OFFER_THRESHOLDS.length - 1];
const MIN_SAMPLES_FOR_COEF = 5; // per set
const MIN_SAMPLES_FOR_LANG = 200; // per l'intera lingua, con la soglia preferita
const MIN_SAMPLES_FOR_WEAK_LANG = 30; // sotto, la lingua resta senza rapporto

/**
 * Rapporto lingua / inglese di una carta, entrambi su CardTrader (così il sovrapprezzo
 * del sito si annulla). Solo se entrambe le lingue hanno almeno minOffers offerte.
 */
export function cardRatio(langEntry, enEntry, variant = "n", minOffers = MIN_OFFERS_FOR_COEF) {
  const a = langEntry?.[variant];
  const b = enEntry?.[variant];
  if (!a || !b || a[1] < minOffers || b[1] < minOffers || !(b[0] > 0)) return null;
  return a[0] / b[0];
}

/** Offerte su cui si regge un rapporto: le meno numerose tra le due lingue. */
export function ratioOffers(langEntry, enEntry, variant = "n") {
  return Math.min(langEntry?.[variant]?.[1] ?? 0, enEntry?.[variant]?.[1] ?? 0);
}

/**
 * Soglia di offerte scelta per una lingua: la più alta con almeno MIN_SAMPLES_FOR_LANG carte,
 * altrimenti la più bassa se ha almeno MIN_SAMPLES_FOR_WEAK_LANG carte; null = lingua senza rapporto.
 * @param samples [{exp, ratio, offers}] (senza offers: contano tutte)
 */
export function pickThreshold(samples, { thresholds = OFFER_THRESHOLDS, minSamples = MIN_SAMPLES_FOR_LANG, minWeak = MIN_SAMPLES_FOR_WEAK_LANG } = {}) {
  const valid = samples.filter((s) => s.ratio > 0);
  const count = (thr) => valid.filter((s) => (s.offers ?? Infinity) >= thr).length;
  for (const thr of thresholds) if (count(thr) >= minSamples) return thr;
  const lowest = thresholds[thresholds.length - 1];
  return count(lowest) >= minWeak ? lowest : null;
}

/**
 * Coefficienti di lingua: mediana dei rapporti lingua/inglese, per espansione e in totale,
 * sulle carte con almeno la soglia di offerte scelta da pickThreshold.
 * @param samples [{exp, ratio, offers}]
 * @param opts {thresholds, minSamples, minWeak} come pickThreshold (i sigillati usano soglie più basse)
 * @returns {{all?: [number, number], [exp]: [number, number]}}
 */
export function coefficients(samples, opts = {}) {
  const out = {};
  const thr = pickThreshold(samples, opts);
  if (thr === null) return out;
  const byExp = new Map();
  for (const s of samples) {
    if (!(s.ratio > 0) || (s.offers ?? Infinity) < thr) continue;
    const r = Math.min(5, Math.max(0.1, s.ratio));
    if (!byExp.has(s.exp)) byExp.set(s.exp, []);
    byExp.get(s.exp).push(r);
  }
  const all = [];
  for (const list of byExp.values()) all.push(...list);
  out.all = [round3(median(all)), all.length];
  for (const [exp, list] of byExp) {
    if (list.length >= MIN_SAMPLES_FOR_COEF) out[exp] = [round3(median(list)), list.length];
  }
  return out;
}

/**
 * Lingue con troppe poche offerte su CardTrader per un rapporto affidabile (novembre 2026: francese 146%,
 * spagnolo 117%, portoghese 220%, tedesco 127% su 1.800 carte dell'inglese, contro il 72% dell'italiano misurato su
 * 14.000 carte): usano il rapporto dell'italiano, totale e per set (richiesto dall'utente, il tedesco il 3 novembre
 * 2026: "moltiplicatori allucinanti"). Il file lo dice in `coefFrom`. Il rapporto misurato sulla singola carta con
 * abbastanza offerte nella lingua resta (PriceEngine.languageRatio): una carta davvero cara in tedesco resta cara.
 */
export const RATIO_FROM_IT = ["fr", "es", "pt", "de"];

/**
 * Sostituisce i coefficienti delle lingue [langs] con quelli di [from] (se [from] ne ha):
 * perLang[l].coef = copia di perLang[from].coef e perLang[l].coefFrom = from. Restituisce le lingue cambiate.
 */
export function borrowCoefficients(perLang, { from = "it", langs = RATIO_FROM_IT } = {}) {
  const source = perLang[from]?.coef;
  if (!source?.all) return [];
  const changed = [];
  for (const l of langs) {
    if (!perLang[l] || l === from) continue;
    perLang[l].coef = structuredClone(source);
    perLang[l].coefFrom = from;
    changed.push(l);
  }
  return changed;
}

/** Offerte minime, di 1ª edizione e di unlimited, perché una carta conti nella maggiorazione del set. */
const MIN_PREMIUM_OFFERS = 3;
/** Carte minime perché un set abbia la sua maggiorazione (sotto vale quella di tutta la lingua). */
const MIN_SAMPLES_FOR_PREMIUM = 5;
/**
 * Prezzo unlimited minimo (EUR) perché una carta conti nella maggiorazione: sotto, i prezzi "a pavimento" delle
 * comuni gonfiano il rapporto (Neo Destiny in italiano: 7,2× con tutte le carte, 4,4× senza quelle sotto i 2 €,
 * mentre le holo care stanno a 3-4×).
 */
export const MIN_PREMIUM_PRICE = 2;

/**
 * Campione per la maggiorazione della 1ª edizione da una voce di prodotto {n: [prezzo, offerte], f: [...]}:
 * {ratio: 1ª ed. / unlimited, offers: min(offerte)}, null se mancano le offerte di una delle due o la unlimited
 * vale meno di MIN_PREMIUM_PRICE.
 */
export function premiumSample(entry) {
  const f = entry?.f;
  const n = entry?.n;
  if (!f || !n || !(n[0] >= MIN_PREMIUM_PRICE) || Math.min(f[1], n[1]) < MIN_PREMIUM_OFFERS) return null;
  return { ratio: f[0] / n[0], offers: Math.min(f[1], n[1]) };
}

/**
 * Maggiorazione della 1ª edizione per set (espansione CardTrader): mediana di (prezzo 1ª edizione / prezzo
 * unlimited) sui prodotti con almeno MIN_PREMIUM_OFFERS offerte di entrambe, tra 1 e 100 (come nell'app).
 * [samples]: [{exp, ratio, offers}]. Risultato come coefficients(): {all: [mediana, carte], <exp>: [mediana, carte]}
 * (un set compare con almeno MIN_SAMPLES_FOR_PREMIUM carte); {} senza campioni. L'app lo usa per le 1ª edizioni che
 * Cardmarket non distingue quando le offerte della singola carta non bastano (Shining Charizard in italiano).
 */
export function firstEditionPremiums(samples) {
  const out = {};
  const byExp = new Map();
  for (const s of samples) {
    if (!(s.ratio > 0) || (s.offers ?? 0) < MIN_PREMIUM_OFFERS) continue;
    const r = Math.min(100, Math.max(1, s.ratio));
    if (!byExp.has(s.exp)) byExp.set(s.exp, []);
    byExp.get(s.exp).push(r);
  }
  const all = [];
  for (const list of byExp.values()) all.push(...list);
  if (all.length === 0) return out;
  out.all = [round3(median(all)), all.length];
  for (const [exp, list] of byExp) {
    if (list.length >= MIN_SAMPLES_FOR_PREMIUM) out[exp] = [round3(median(list)), list.length];
  }
  return out;
}

export const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
