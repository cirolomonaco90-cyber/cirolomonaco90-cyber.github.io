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

export function conditionFactor(name) {
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
export const MIN_OFFERS_FOR_CONDITION = 3;

/**
 * Prezzi per condizione dalle offerte di una lingua: per ogni condizione con almeno
 * MIN_OFFERS_FOR_CONDITION offerte, la mediana delle 5 più economiche così come sono (non riportate
 * a NM), scartata un'offerta anomala. L'app confronta la condizione con Near Mint della stessa lingua
 * e ottiene la percentuale della condizione misurata sul mercato invece di quella fissa.
 * Pubblicato solo se c'è Near Mint e almeno un'altra condizione.
 * @returns {Record<string, [number, number]> | null} codice condizione -> [prezzo, offerte]
 */
export function conditionPrices(offers, variant, currency = "EUR") {
  const usable = offers.filter(
    (o) => !o.graded && o.bundle <= 1 && o.quantity > 0 && o.price > 0 && !isPlaceholderPrice(o.price) && o.currency === currency && matchesVariant(o, variant),
  );
  const by = {};
  for (const o of usable) {
    const code = CT_CONDITION_CODE[String(o.condition || "").trim().toLowerCase()];
    if (!code) continue;
    (by[code] ||= []).push(o.price);
  }
  const out = {};
  for (const [code, list] of Object.entries(by)) {
    if (list.length < MIN_OFFERS_FOR_CONDITION) continue;
    const s = [...list].sort((a, b) => a - b);
    if (s.length >= 4 && s[0] < 0.5 * s[1]) s.shift();
    out[code] = [round2(median(s.slice(0, 5))), list.length];
  }
  return out.NM && Object.keys(out).length >= 2 ? out : null;
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
  return price >= 1000 && price % 1000 < 50;
}

/** Varianti: n = normale/holo, r = reverse, f = 1ª edizione. */
export function matchesVariant(o, v) {
  if (v === "r") return o.reverse === true;
  if (v === "f") return o.firstEdition === true;
  return o.reverse !== true && o.firstEdition !== true;
}

/**
 * Stima Near Mint dalle offerte di una lingua:
 * esclude graded/lotti/altre valute, riporta a NM, scarta un'offerta anomala
 * (meno della metà della successiva) e prende la mediana delle 5 più economiche.
 * @returns {[number, number] | null} [prezzo NM, numero di offerte]
 */
export function estimate(offers, variant, currency = "EUR") {
  const usable = offers.filter(
    (o) => !o.graded && o.bundle <= 1 && o.quantity > 0 && o.price > 0 && !isPlaceholderPrice(o.price) && o.currency === currency && matchesVariant(o, variant),
  );
  if (usable.length === 0) return null;
  const nm = usable.map((o) => o.price / conditionFactor(o.condition)).sort((a, b) => a - b);
  if (nm.length >= 4 && nm[0] < 0.5 * nm[1]) nm.shift();
  return [round2(median(nm.slice(0, 5))), usable.length];
}

// Soglie verificate sui dati reali (ottobre 2026): con poche offerte la mediana delle più
// economiche è sistematicamente più alta, quindi il rapporto con l'inglese (che ha molte
// offerte) risulta gonfiato (tedesco: 1,42 con almeno 3 offerte, 1,27 con almeno 8). Per
// l'italiano il rapporto è stabile a ogni soglia. Per ogni lingua si usa quindi la soglia più
// alta che lascia abbastanza carte (MIN_SAMPLES_FOR_LANG); se nessuna basta, la più bassa con
// almeno MIN_SAMPLES_FOR_WEAK_LANG carte. Ogni lingua ha così il suo rapporto (richiesto
// dall'utente, ottobre 2026: mai lo stesso prezzo per tutte le lingue), anche se meno preciso.
export const OFFER_THRESHOLDS = [15, 8, 5, 3];
export const MIN_OFFERS_FOR_COEF = OFFER_THRESHOLDS[OFFER_THRESHOLDS.length - 1];
export const MIN_SAMPLES_FOR_COEF = 5; // per set
export const MIN_SAMPLES_FOR_LANG = 200; // per l'intera lingua, con la soglia preferita
export const MIN_SAMPLES_FOR_WEAK_LANG = 30; // sotto, la lingua resta senza rapporto

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

export const round2 = (x) => Math.round(x * 100) / 100;
export const round3 = (x) => Math.round(x * 1000) / 1000;
