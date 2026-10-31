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
  async search(q, limit = 50) {
    const token = await this.accessToken();
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&limit=${limit}&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION},priceCurrency:EUR")}`;
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
    })).filter((i) => Number.isFinite(i.price) && i.price > 0);
  }
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/**
 * Le inserzioni che riguardano davvero l'oggetto: tutte le parole di [must] nel titolo (ognuna può avere
 * alternative con "|": "pokeball|poké ball|poke ball"), nessuna di [no].
 */
export function relevant(items, { must = [], no = [] } = {}) {
  return items.filter((i) => {
    const t = norm(i.title);
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
