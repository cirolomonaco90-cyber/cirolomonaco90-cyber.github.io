// Rete del job notturno: ogni richiesta riprova da sola quando la connessione manca
// (DNS, rete assente, timeout) o il server risponde 429/5xx, aspettando sempre di più.
// Così un buco di rete di qualche minuto non butta via ore di lavoro.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Come fetch, ma con nuovi tentativi.
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @param {object} [opts]
 * @param {number} [opts.attempts] tentativi in tutto (8: circa 9 minuti di attesa complessiva)
 * @param {number} [opts.waitMs] attesa dopo il primo errore, poi moltiplicata per il numero del tentativo
 * @param {number} [opts.maxWaitMs] attesa massima tra due tentativi
 * @param {Function} [opts.fetchFn] per i test
 * @param {Function} [opts.sleepFn] per i test
 * @param {Function} [opts.log] dove scrivere gli avvisi (console.error)
 * @returns {Promise<Response>} l'ultima risposta (anche non ok, se non è 429/5xx)
 */
export async function fetchRetry(url, init = {}, opts = {}) {
  const {
    attempts = 8,
    waitMs = 15000,
    maxWaitMs = 120000,
    fetchFn = fetch,
    sleepFn = sleep,
    log = (m) => console.error(m),
  } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let reason;
    try {
      const res = await fetchFn(url, init);
      if (!(res.status === 429 || res.status >= 500)) return res;
      reason = `HTTP ${res.status}`;
      lastErr = new Error(`${url}: ${reason}`);
    } catch (err) {
      lastErr = err;
      reason = err?.cause?.code || err?.cause?.message || err.message || String(err);
    }
    if (attempt === attempts) break;
    const wait = Math.min(waitMs * attempt, maxWaitMs);
    log(`rete: ${reason} per ${String(url).slice(0, 90)}; riprovo tra ${Math.round(wait / 1000)} s (${attempt}/${attempts})`);
    await sleepFn(wait);
  }
  throw lastErr;
}
