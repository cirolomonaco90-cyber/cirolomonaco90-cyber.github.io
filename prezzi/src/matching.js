// Funzioni pure per abbinare una carta TCGdex a un "blueprint" CardTrader
// e per leggere le offerte. Testate in test/matching.test.js.

/** Normalizza un nome: minuscolo, senza accenti, "&" -> "and", senza "pokemon/tcg/set". */
export function norm(s) {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pokemon|tcg|set)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** "007" -> "7", "149/147" -> "149", "H14" -> "h14", "000" -> "0". */
export function normNumber(s) {
  if (s === null || s === undefined) return "";
  const first = String(s).split("/")[0].trim().toLowerCase();
  const digits = first.replace(/^0+/, "");
  return first.length > 0 && digits.length === 0 ? "0" : digits;
}

/** Trova l'espansione CardTrader dal nome inglese del set. */
export function matchExpansion(expansions, englishSetName) {
  const target = norm(englishSetName);
  if (!target) return null;
  const exact = expansions.find((e) => norm(e.name) === target);
  if (exact) return exact;
  let best = null;
  let bestDiff = Infinity;
  for (const e of expansions) {
    const n = norm(e.name);
    if (!n || !(n.includes(target) || target.includes(n))) continue;
    const diff = Math.abs(n.length - target.length);
    if (diff <= 8 && diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}

/** Numero di collezione di un blueprint, ovunque CardTrader lo metta. */
export function blueprintNumber(bp) {
  const fixed = bp.fixed_properties || {};
  for (const [k, v] of Object.entries(fixed)) {
    if ((k.includes("collector") || k.includes("number")) && v !== null && v !== undefined) return String(v);
  }
  return null;
}

/**
 * Sceglie il blueprint giusto:
 * 1. id Cardmarket (preciso: CardTrader li riporta in card_market_ids);
 * 2. numero di collezione, se unico;
 * 3. nome inglese, se unico.
 */
export function findBlueprint(blueprints, { cardmarketIds = [], number = "", name = "" }) {
  const cm = new Set(cardmarketIds.map(Number).filter((n) => Number.isFinite(n)));
  if (cm.size > 0) {
    const hit = blueprints.find((bp) => (bp.card_market_ids || []).some((id) => cm.has(Number(id))));
    if (hit) return hit;
  }
  const num = normNumber(number);
  if (num) {
    const byNum = blueprints.filter((bp) => normNumber(blueprintNumber(bp)) === num);
    if (byNum.length === 1) return byNum[0];
  }
  if (name) {
    const byName = blueprints.filter((bp) => norm(bp.name) === norm(name));
    if (byName.length === 1) return byName[0];
  }
  return null;
}

/**
 * Risposta di /marketplace/products?expansion_id=... : oggetto { blueprintId: [prodotti] }.
 * @returns {Map<number, object[]>} offerte semplici per blueprint
 */
export function parseOffersByBlueprint(json) {
  const out = new Map();
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    for (const o of parseOffersWithId(Array.isArray(json) ? json : [])) push(out, o);
    return out;
  }
  for (const [key, list] of Object.entries(json)) {
    if (!Array.isArray(list)) continue;
    for (const o of parseOffersWithId(list, Number(key))) push(out, o);
  }
  return out;

  function push(map, o) {
    if (!Number.isFinite(o.blueprintId)) return;
    if (!map.has(o.blueprintId)) map.set(o.blueprintId, []);
    const { blueprintId, ...offer } = o;
    map.get(blueprintId).push(offer);
  }
}

function parseOffersWithId(products, fallbackId) {
  return parseOffers(products, true).map((o) => ({
    ...o,
    blueprintId: Number.isFinite(o.blueprintId) ? o.blueprintId : fallbackId,
  }));
}

/** Converte la risposta di /marketplace/products in un elenco di offerte semplici. */
export function parseOffers(json, keepId = false) {
  let products = [];
  if (Array.isArray(json)) products = json;
  else if (json && typeof json === "object") {
    for (const v of Object.values(json)) if (Array.isArray(v)) products.push(...v);
  }
  const out = [];
  for (const p of products) {
    if (!p || typeof p !== "object") continue;
    if (p.on_vacation === true) continue;
    const cents = p.price?.cents;
    if (typeof cents !== "number") continue;
    const props = p.properties_hash || {};
    const boolProp = (match) => {
      for (const [k, v] of Object.entries(props)) {
        if (match(k.toLowerCase()) && typeof v === "boolean") return v;
      }
      return null;
    };
    out.push({
      ...(keepId ? { blueprintId: Number(p.blueprint_id) } : {}),
      price: cents / 100,
      currency: p.price?.currency || "EUR",
      condition: typeof props.condition === "string" ? props.condition : null,
      reverse: boolProp((k) => k.includes("reverse")),
      firstEdition: boolProp((k) => k.includes("first_edition") || k.includes("1st")),
      graded: p.graded === true,
      // Prodotti sigillati: false = confezione aperta (CardTrader la vende come "unsealed").
      sealed: typeof props.sealed === "boolean" ? props.sealed : null,
      bundle: Number.isInteger(p.bundle_size) ? p.bundle_size : 1,
      quantity: Number.isInteger(p.quantity) ? p.quantity : 1,
      // Lingua dell'offerta ("en", "jp"...) e descrizione del venditore (per le carte gradate: ente e voto).
      language: Object.entries(props).find(([k]) => k.endsWith("_language"))?.[1] ?? null,
      description: typeof p.description === "string" ? p.description : "",
    });
  }
  return out;
}

/** Alcuni endpoint rispondono con un array, altri lo avvolgono in un oggetto. */
export function items(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    if (Array.isArray(json.array)) return json.array;
    const firstArray = Object.values(json).find((v) => Array.isArray(v));
    if (firstArray) return firstArray;
  }
  return [];
}

/** Codici lingua di CardTrader (2 lettere). */
export function ctLanguage(lang) {
  if (lang === "pt-br" || lang === "pt-pt") return "pt";
  return String(lang || "").slice(0, 2).toLowerCase();
}
