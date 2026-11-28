// Regole comuni delle Topps (topps.js e topps-libere-regole.js), senza nulla di Node: le usa anche il servizio Supabase
// "topps-price" (prezzo immediato delle carte scritte a mano), che gira su Deno.
import { estimate } from "./stats.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2019']/g, "");

/** Cose che non sono una carta: lotti, set, buste, fotografie, ristampe, falsi. */
export const NOT_A_CARD = /\b(lot|lots|lotto|stock|bundle|set of|complete set|full set|set completo|serie completa|pack|packs|booster|box|sealed|sigillat\w|wrapper|binder|album|raccoglitore|poster|photograph|photo print|8x10|reprint|ristampa|custom|proxy|fake|orica|replica|choose|pick|scegli|you pick|uncut sheet|sheet|x[2-9]|[2-9]x|card ?lot)\b/;

/** Copie dichiarate rovinate: fuori dal prezzo delle non gradate, come in ebay-prezzi.js. */
export const WORN = /\b(played|lp|mp|hp|nm\/lp|light play|heavy play|damaged|dmg|poor|giocata|rovinat\w|danneggiat\w|crease|creased|piega|bent|scratch\w*|graffi\w*|worn|usurat\w)\b/;

/** Voto di una carta gradata: "PSA 9", "BGS 9.5", "CGC 10"... */
const GRADE = /\b(psa|bgs|cgc|sgc|beckett|ace|tag)\s*-?\s*(10|9[.,]5|9|8[.,]5|8|7[.,]5|7|6[.,]5|6|5[.,]5|5|4|3|2|1)\b/;

/** Il voto di una carta gradata ("PSA 9"), null se non è gradata, "?" se lo è ma il voto non si legge. */
export function gradeOf(title) {
  const t = norm(title);
  const g = t.match(GRADE);
  if (g) return `${g[1] === "beckett" ? "BGS" : g[1].toUpperCase()} ${g[2].replace(",", ".")}`;
  if (/\b(graded|gradata|slab|pristine|gem mint)\b/.test(t)) return "?";
  return null;
}

/** Oltre quante volte il prezzo di mezzo un'inserzione è un'altra cosa (una foil venduta senza dirlo, una gradata senza voto). */
export const OUTLIER_TIMES = 8;

/**
 * Prezzo di un secchio: mediana delle più economiche (stats.estimate), con una o due inserzioni la più bassa. Con tre o più
 * inserzioni fuori quelle oltre [OUTLIER_TIMES] volte quella di mezzo (scena #65 del film del 2000: 9-26 $ e due foil non
 * dichiarate a 625-675 $ nella stessa ricerca).
 */
export function priceOf(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)];
  const kept = sorted.length >= 3 ? sorted.filter((p) => p <= OUTLIER_TIMES * mid) : sorted;
  const offers = kept.map((price) => ({ price, currency: "EUR", graded: false, bundle: 1, quantity: 1, condition: null }));
  return estimate(offers, "n", "EUR", { thinLowest: true });
}
