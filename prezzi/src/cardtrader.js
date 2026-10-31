// Client CardTrader per il job notturno: un solo token (secret del repo),
// richieste in coda rispettando i limiti dell'API, nuovi tentativi in caso di 429 o di rete
// assente (rete.js). Con cacheDir le risposte già lette restano su disco: se il job si ferma a
// metà e riparte nello stesso giorno, continua da dove era arrivato invece di ricominciare.
import fs from "node:fs/promises";
import path from "node:path";
import { items, parseOffers, parseOffersByBlueprint, ctLanguage } from "./matching.js";
import { fetchRetry } from "./rete.js";

const BASE = "https://api.cardtrader.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CardTrader {
  /**
   * @param {object} opts
   * @param {string} opts.token
   * @param {Function} [opts.fetchFn] per i test
   * @param {number} [opts.marketGapMs] distanza tra richieste di offerte (limite ~1/s)
   * @param {number} [opts.catalogGapMs] distanza tra richieste di catalogo (limite 200/10s)
   * @param {number} [opts.retryWaitMs] attesa dopo un 429 o un errore di rete (cresce a ogni tentativo)
   * @param {number} [opts.retries] tentativi in tutto per ogni richiesta
   * @param {string} [opts.cacheDir] cartella delle risposte già lette (una per giorno: la crea il job)
   */
  constructor({ token, fetchFn = fetch, marketGapMs = 1100, catalogGapMs = 80, retryWaitMs = 15000, retries = 8, cacheDir = null }) {
    this.token = token;
    this.fetchFn = fetchFn;
    this.marketGapMs = marketGapMs;
    this.catalogGapMs = catalogGapMs;
    this.retryWaitMs = retryWaitMs;
    this.retries = retries;
    this.cacheDir = cacheDir;
    this.calls = 0; // richieste fatte davvero (quelle lette dalla cache non contano)
    this.cached = 0; // risposte prese dalla cache
  }

  async get(path, query = {}) {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    this.calls++;
    const res = await fetchRetry(
      url,
      { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } },
      { attempts: this.retries, waitMs: this.retryWaitMs, fetchFn: this.fetchFn },
    );
    if (res.status === 401) throw new Error("Token CardTrader non valido (401)");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CardTrader ${path}: HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Risultato di fn() salvato in cacheDir con la chiave data; la volta dopo si legge il file.
   * Le Map si salvano come elenco di coppie (isMap = true).
   */
  async remember(key, fn, { isMap = false, gapMs = 0 } = {}) {
    if (!this.cacheDir) {
      if (gapMs) await sleep(gapMs);
      return fn();
    }
    const file = path.join(this.cacheDir, key.replace(/[^\w.-]+/g, "_") + ".json");
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      this.cached++;
      return isMap ? new Map(saved) : saved;
    } catch {
      // non in cache: si chiede davvero
    }
    if (gapMs) await sleep(gapMs);
    const value = await fn();
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(isMap ? [...value] : value));
    return value;
  }

  async pokemonGameId() {
    const games = items(await this.get("games"));
    const g = games.find((x) => `${x.name} ${x.display_name}`.toLowerCase().includes("pok"));
    if (!g) throw new Error("Pokémon non trovato tra i giochi di CardTrader");
    return g.id;
  }

  async expansions(gameId) {
    return items(await this.get("expansions")).filter((e) => e.game_id === gameId);
  }

  async blueprints(expansionId) {
    return this.remember(`blueprints-${expansionId}`, async () => items(await this.get("blueprints/export", { expansion_id: expansionId })), {
      gapMs: this.catalogGapMs,
    });
  }

  /** Tutte le offerte di una carta (tutte le lingue), comprese le gradate. */
  async offersByBlueprint(blueprintId) {
    return this.remember(`offers-bp-${blueprintId}`, async () => parseOffers(await this.get("marketplace/products", { blueprint_id: blueprintId })), {
      gapMs: this.marketGapMs,
    });
  }

  /** Le offerte più economiche (max 25 per carta) di un'intera espansione, in una lingua. */
  async offersByExpansion(expansionId, lang) {
    return this.remember(
      `offers-exp-${expansionId}-${lang}`,
      async () => parseOffersByBlueprint(await this.get("marketplace/products", { expansion_id: expansionId, language: ctLanguage(lang) })),
      { isMap: true, gapMs: this.marketGapMs },
    );
  }
}
