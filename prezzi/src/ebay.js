// Prezzo di mercato dalle inserzioni attive di eBay.it, con la Browse API ufficiale di eBay (gratuita,
// serve una chiave sviluppatore: App ID e Cert ID, in ~/CollectorOne-chiave/ebay-keys.txt come "APPID:CERTID").
// Per gli oggetti da collezione che nessun mercato delle carte quota (medaglie e folder di Poste Italiane):
// si cercano le inserzioni con le parole dell'oggetto, si scartano quelle che non lo riguardano, e la stima
// è la mediana delle più economiche, come per le offerte CardTrader (stats.estimate).
import { estimate } from "./stats.js";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

export class Ebay {
  /** @param {{appId: string, certId: string, fetchFn?: Function, marketplace?: string}} o */
  constructor({ appId, certId, fetchFn = fetch, marketplace = "EBAY_IT" }) {
    this.appId = appId;
    this.certId = certId;
    this.fetchFn = fetchFn;
    this.marketplace = marketplace;
    this.token = null;
  }

  async accessToken() {
    if (this.token) return this.token;
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.appId}:${this.certId}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });
    if (!res.ok) throw new Error(`eBay token: HTTP ${res.status}`);
    this.token = (await res.json()).access_token;
    return this.token;
  }

  /** Inserzioni attive per la ricerca [q]: [{title, price, currency, url}]. Solo in euro. */
  async search(q, limit = 50, { anyCurrency = false } = {}) {
    const token = await this.accessToken();
    // anyCurrency: per le foto (foto-ebay.js) vanno bene anche le inserzioni in dollari o sterline.
    const filter = anyCurrency ? "buyingOptions:{FIXED_PRICE|AUCTION}" : "buyingOptions:{FIXED_PRICE|AUCTION},priceCurrency:EUR";
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&limit=${limit}&filter=${encodeURIComponent(filter)}`;
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": this.marketplace, "Accept-Language": "it-IT" },
    });
    if (!res.ok) throw new Error(`eBay search "${q}": HTTP ${res.status}`);
    const data = await res.json();
    return (data.itemSummaries ?? []).map((i) => ({
      title: String(i.title ?? ""),
      price: Number(i.price?.value),
      currency: i.price?.currency,
      url: i.itemWebUrl,
      image: i.image?.imageUrl ?? null,
    })).filter((i) => Number.isFinite(i.price) && i.price > 0);
  }
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/**
 * Inserzioni con più cose in vendita (richiesto dall'utente, 4 novembre 2026: "stai sempre attento se ci sono altre cose oltre
 * all'oggetto della valutazione"): lotti, coppie, "insieme a", "+", "con kit", "x2", "2 pezzi", serie o set completi; e per le
 * carte più numeri "4/102 2/102" nello stesso titolo. Una parola che sta nel nome del prodotto stesso non conta
 * ("Booster Bundle", "Build & Battle Kit").
 */
const BUNDLE_WORDS = [
  "lotto", "lotti", "lot", "lots", "bundle", "stock", "coppia", "tris", "entrambe", "entrambi", "insieme", "kit",
  "set completo", "serie completa", "collezione completa", "x2", "x3", "x4", "2x", "3x", "4x",
];
export function isBundle(title, ownName = "") {
  const t = norm(title);
  const own = norm(ownName);
  if (t.includes("+") && !own.includes("+")) return true;
  for (const w of BUNDLE_WORDS) {
    if (own && new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(own)) continue;
    if (new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(t)) return true;
  }
  // "2 pezzi", "3 pz" con il numero davanti; "set of 3 tins" (0.9.160: un tin vuoto prendeva la foto dei tre tin insieme)
  if (/(^|[^0-9])[2-9]\s*(pezzi|pz)\b/.test(t)) return true;
  if (/\bset of [2-9]\b/.test(t) && !/\bset of [2-9]\b/.test(own)) return true;
  return new Set(t.match(/\b\d{1,3}\s*\/\s*\d{2,3}\b/g)?.map((x) => x.replace(/\s/g, "")) ?? []).size >= 2;
}

/**
 * Le inserzioni che riguardano davvero l'oggetto: tutte le parole di [must] nel titolo (ognuna può avere
 * alternative con "|": "pokeball|poké ball|poke ball"), nessuna di [no].
 */
export function relevant(items, { q = "", must = [], no = [] } = {}) {
  return items.filter((i) => {
    const t = norm(i.title);
    if (isBundle(i.title, q)) return false;
    return must.every((m) => String(m).split("|").some((alt) => t.includes(norm(alt)))) && !no.some((n) => t.includes(norm(n)));
  });
}

/** Stima di mercato dalle inserzioni: [prezzo, numero di inserzioni] o null. */
export function marketEstimate(items) {
  return estimate(items.map((i) => ({ price: i.price, currency: "EUR", graded: false, bundle: 1, quantity: 1, condition: null })), "n");
}

/**
 * Prezzi di mercato degli oggetti con una ricerca eBay ("ebay": {q, must, no} in oggetti.json):
 * { idOggetto: [prezzo, inserzioni] }. Un oggetto senza inserzioni pertinenti non ha prezzo.
 */
export async function marketPrices(ebay, objects, log = []) {
  const out = {};
  for (const o of objects) {
    if (!o.ebay?.q) continue;
    try {
      const items = relevant(await ebay.search(o.ebay.q), o.ebay);
      const est = marketEstimate(items);
      if (est) out[o.id] = est;
      log.push(`eBay "${o.ebay.q}": ${items.length} inserzioni pertinenti${est ? `, stima ${est[0]} €` : ""}`);
    } catch (err) {
      log.push(`! eBay "${o.ebay.q}": ${err.message}`);
    }
  }
  return out;
}
