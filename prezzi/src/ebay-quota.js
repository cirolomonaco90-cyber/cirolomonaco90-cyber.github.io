// Quota giornaliera della Browse API di eBay: 5.000 chiamate al giorno per l'app, in comune tra i prezzi eBay del job
// (ebay-prezzi.js, parte "cardmarket"), le foto dei sigillati (foto-ebay.js) e gli oggetti da collezione (oggetti.js) della
// parte "prezzi", e il servizio variant-photo dell'app (foto delle reverse), che ne tiene per sé al massimo 1.500.
//
// Il giorno di eBay non è il nostro: la quota riparte a mezzanotte del Pacifico (08:00 UTC d'inverno, 07:00 d'estate, le 9
// italiane). Prima ogni giro aveva il suo tetto (EBAY_BUDGET, 3.000 ricerche) e non sapeva quante ne avessero già fatte gli
// altri: il 18 novembre 2026 il giro della notte partito tardi (09:15 UTC, dopo la ripartenza) ne ha fatte 3.000, quello
// rilanciato a mano alle 14:21 UTC altre 1.937 fino alla quota finita, e il giro della notte del 19 (04:00 UTC, ancora lo
// stesso giorno di eBay) 0: niente prezzi eBay quella notte, oggetti da collezione senza mercato, foto delle reverse ferme
// nell'app fino alle 9.
//
// Ora: (1) un tetto per giorno di eBay, non per giro: il file pubblicato di ogni lavoro tiene quante chiamate ha fatto in
// quel giorno di eBay ({w: giorno, n: chiamate}) e i giri dopo, nello stesso giorno, ne fanno solo quante ne restano;
// (2) prima di cominciare si chiede a eBay quante chiamate restano davvero (Analytics API, getRateLimits: non consuma la
// quota della ricerca) e si lascia sempre un margine per chi viene dopo (QUOTA_RESERVE).

/**
 * Chiamate che ogni lavoro lascia sempre libere: i prezzi eBay (la notte per primi) lasciano spazio alle foto dei sigillati
 * (300), agli oggetti (22 a giro) e a variant-photo; le foto lasciano spazio agli oggetti e a variant-photo; gli oggetti,
 * pochi e i più importanti, solo a una parte di variant-photo.
 */
export const QUOTA_RESERVE = { prezzi: 1500, foto: 800, oggetti: 300 };

const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

/** Il giorno di eBay ("2026-11-18": dalle 08:00 UTC del 18 alle 08:00 UTC del 19, d'inverno). */
export function quotaWindow(now = new Date()) {
  return PACIFIC.format(now);
}

/** Chiamate già fatte nel giorno di eBay [window] secondo il contatore salvato [counter] ({w, n}). */
export function usedInWindow(counter, window) {
  return counter && counter.w === window && Number.isFinite(counter.n) ? counter.n : 0;
}

/** Il contatore dopo [calls] chiamate in più nel giorno [window]. */
export function addCalls(counter, window, calls) {
  return { w: window, n: usedInWindow(counter, window) + calls };
}

/**
 * Chiamate che il lavoro può fare adesso: il suo tetto del giorno [cap] meno quelle già fatte oggi [used], e non oltre quelle
 * che eBay dice rimaste [remaining] meno il margine [reserve]. Senza la risposta di eBay ([remaining] null) vale solo il tetto.
 */
export function dailyBudget({ cap, used = 0, remaining = null, reserve = 0 }) {
  let budget = Math.max(0, cap - used);
  if (Number.isFinite(remaining)) budget = Math.min(budget, Math.max(0, remaining - reserve));
  return budget;
}

/** Quanto resta della quota secondo eBay ({limit, remaining, reset}) o null se eBay non lo dice. */
export async function remainingQuota(ebay, log = []) {
  try {
    const r = await ebay.rateLimit();
    if (r && Number.isFinite(r.remaining)) return r;
    log.push("quota eBay: eBay non dice quante chiamate restano, vale solo il tetto del giorno");
  } catch (err) {
    log.push(`quota eBay: non letta (${err.message}), vale solo il tetto del giorno`);
  }
  return null;
}

/** Riga del registro sulla quota, uguale per i tre lavori. */
export function quotaLine(what, { window, cap, used, quota, reserve, budget }) {
  const left = quota
    ? `${quota.remaining} chiamate su ${quota.limit} rimaste fino alle ${String(quota.reset ?? "").slice(11, 16)} UTC, ${reserve} lasciate agli altri`
    : "rimaste: non lette";
  return `quota eBay (${what}), giorno di eBay ${window}: tetto ${cap}, già fatte oggi ${used}, ${left}: stavolta al massimo ${budget}`;
}

/** È la risposta di eBay quando la quota del giorno è finita. */
export function isQuotaError(err) {
  return /HTTP 429/.test(String(err?.message ?? err));
}
