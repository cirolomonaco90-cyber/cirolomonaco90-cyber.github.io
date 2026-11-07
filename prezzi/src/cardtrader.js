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
   * @param {number} [opts.reuseDays] offerte lette nei giorni prima (cartelle sorelle di cacheDir) ancora buone per tanti
   *   giorni: non si richiedono (Yu-Gi-Oh!: 691 espansioni × 7 lingue non stanno in una notte, si leggono a rotazione)
   * @param {number} [opts.deadline] ora (ms) oltre la quale non si chiedono più offerte: si usa la risposta più recente dei
   *   giorni prima, o niente; il catalogo si pubblica comunque (GitHub ferma il job dopo 6 ore senza pubblicare nulla)
   */
  constructor({ token, fetchFn = fetch, marketGapMs = 1100, catalogGapMs = 80, retryWaitMs = 15000, retries = 8, cacheDir = null, reuseDays = 0, deadline = 0 }) {
    this.token = token;
    this.fetchFn = fetchFn;
    this.marketGapMs = marketGapMs;
    this.catalogGapMs = catalogGapMs;
    this.retryWaitMs = retryWaitMs;
    this.retries = retries;
    this.cacheDir = cacheDir;
    this.reuseDays = reuseDays;
    this.deadline = deadline;
    this.reused = 0;
    this.skipped = 0;
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
  async remember(key, fn, { isMap = false, gapMs = 0, market = false } = {}) {
    if (!this.cacheDir) {
      if (gapMs) await sleep(gapMs);
      return fn();
    }
    const name = key.replace(/[^\w.-]+/g, "_") + ".json";
    const file = path.join(this.cacheDir, name);
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      this.cached++;
      return isMap ? new Map(saved) : saved;
    } catch {
      // non in cache: si chiede davvero
    }
    // Offerte a rotazione: la risposta di un giorno prima, se ancora buona (reuseDays) o se il tempo è finito.
    if (market && (this.reuseDays > 0 || this.deadline > 0)) {
      const late = this.deadline > 0 && Date.now() > this.deadline;
      const old = await this.olderCopy(name, late ? 30 : this.reuseDays);
      if (old) {
        this.reused++;
        return isMap ? new Map(old) : old;
      }
      if (late) {
        this.skipped++;
        throw new Error("tempo della notte finito: si legge la prossima notte");
      }
    }
    if (gapMs) await sleep(gapMs);
    const value = await fn();
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(isMap ? [...value] : value));
    return value;
  }

  /** La copia più recente di [name] nelle cartelle dei giorni prima (sorelle di cacheDir), entro [maxDays] giorni. */
  async olderCopy(name, maxDays) {
    if (!maxDays) return null;
    const root = path.dirname(this.cacheDir);
    const today = path.basename(this.cacheDir);
    this.days ??= (await fs.readdir(root).catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today).sort().reverse();
    const limit = new Date(Date.parse(today) - maxDays * 86_400_000).toISOString().slice(0, 10);
    for (const d of this.days) {
      if (d <= limit) break;
      try {
        return JSON.parse(await fs.readFile(path.join(root, d, name), "utf8"));
      } catch {
        // non c'è quel giorno
      }
    }
    return null;
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
      market: true,
    });
  }

  /** Le offerte più economiche (max 25 per carta) di un'intera espansione, in una lingua. */
  async offersByExpansion(expansionId, lang) {
    return this.remember(
      `offers-exp-${expansionId}-${lang}`,
      async () => parseOffersByBlueprint(await this.get("marketplace/products", { expansion_id: expansionId, language: ctLanguage(lang) })),
      { isMap: true, gapMs: this.marketGapMs, market: true },
    );
  }
}
