// Regole per scegliere l'inserzione eBay la cui foto mostra la variante giusta di una carta (reverse holo,
// 1ª edizione): nessun archivio ha scansioni per variante, le foto dei venditori sì. Funzioni pure, testate
// in prezzi/test/variant-photo.test.js (Node) e usate dal servizio index.ts (Deno).
// Giochi: Pokémon (reverse e 1ª edizione, numero "11/110") e Yu-Gi-Oh! (1ª edizione, codice "LOB-EN001": game "yugioh").

/** Parole che nel titolo dichiarano la variante (confronto senza spazi né accenti). */
export const VARIANT_WORDS = {
  reverse: ["reverse", "rev holo", "rev. holo", "rev-holo"],
  firstEdition: ["1st edition", "1st ed", "first edition", "1ª edizione", "1a edizione", "prima edizione", "1. edition", "1ère édition", "1ere edition", "1ª edición", "1a edicion", "primera edición", "1ª edição", "1. auflage", "erste auflage"],
};

/** Titoli da scartare: gradate (la foto è della custodia), lotti, proxy, altro. */
export const EXCLUDE = /\b(psa|bgs|cgc|sgc|ace|tag|graded|gradata|gradate|slab|lot|lotto|bundle|proxy|custom|orica|replica|fake|falsa|playset|x4|4x|digital|online|code|codice|sticker|adesivo|poster|jumbo|oversized|gigante|empty|vuota)\b/;

/** Senza accenti, minuscolo, spazi singoli. */
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Solo lettere e cifre: "Mr. Mime" e "mr mime" diventano uguali. */
export const compact = (s) => norm(s).replace(/[^a-z0-9]/g, "");

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Numero Yu-Gi-Oh! senza la regione, come `yugiohKey` di prezzi/src/onepiece.js e `OnePiece.yugiohKey` nell'app
 * (copiato qui perché il servizio non vede il resto del job): "LOB-EN001", "LOB-E001", "LOB-001" -> "lob-001".
 */
const YUGIOH_NUMBER = /^(?:([A-Z0-9]+)-)?(?:EN|FR|DE|IT|SP|PT|JP|KR|AE|TC|SC|EU|[EFGISP](?=\d))?([A-Z]{0,3}\d+)[A-Z]*$/;
export function yugiohKey(number) {
  const raw = String(number ?? "").trim().toUpperCase();
  const n = (raw.includes("-") ? raw : raw.replace(/\s+/, "-")).replace(/\s+/g, "");
  const m = YUGIOH_NUMBER.exec(n);
  if (!m || !m[1]) return null;
  return `${m[1].toLowerCase()}-${m[2].toLowerCase()}`;
}

/** Il numero della carta nel titolo: "11/110", "011/110", "11 / 110"; senza totale basta "11" come parola. Yu-Gi-Oh!: il codice. */
export function hasNumber(title, number, setTotal, game = "pokemon") {
  if (game === "yugioh") {
    const k = yugiohKey(number);
    return !!k && String(title ?? "").split(/[\s,;:()[\]/|]+/).some((w) => yugiohKey(w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")) === k);
  }
  const n = String(number ?? "").trim().replace(/^0+(?=\d)/, "");
  if (!n) return false;
  const t = norm(title);
  if (setTotal) return new RegExp(`(^|[^0-9])0*${esc(n)}\\s*/\\s*0*${esc(String(setTotal))}([^0-9]|$)`).test(t);
  return new RegExp(`(^|[^0-9a-z])0*${esc(n)}([^0-9a-z]|$)`).test(t);
}

/** true se il titolo dichiara la variante. */
export function hasVariant(title, variant) {
  const c = compact(title);
  return (VARIANT_WORDS[variant] ?? []).some((w) => c.includes(compact(w)));
}

/**
 * L'inserzione migliore tra [items] ({title, image, url, price, condition}) per la carta:
 * nome e numero nel titolo, la variante dichiarata, niente gradate/lotti/proxy, una foto.
 * Preferisce i titoli che citano anche il set e le carte in condizione migliore (foto più leggibili).
 * @returns {{title, image, url, price} | null}
 */
export function pickVariantListing(items, { name, number, setTotal, setName, variant, game = "pokemon" }) {
  const cname = compact(name);
  const cset = compact(setName);
  const ok = [];
  for (const i of items ?? []) {
    const title = String(i.title ?? "");
    if (!i.image || !cname || !compact(title).includes(cname)) continue;
    if (!hasNumber(title, number, setTotal, game) || !hasVariant(title, variant)) continue;
    if (EXCLUDE.test(norm(title))) continue;
    let score = 0;
    if (cset && compact(title).includes(cset)) score += 2;
    if (/\b(near mint|nm|mint|new|nuov)/.test(norm(`${title} ${i.condition ?? ""}`))) score += 1;
    ok.push({ score, item: i });
  }
  if (ok.length === 0) return null;
  ok.sort((a, b) => b.score - a.score || (b.item.price ?? 0) - (a.item.price ?? 0));
  const best = ok[0].item;
  return { title: best.title, image: bigImage(best.image), url: best.url, price: best.price ?? null };
}

/** La foto grande di eBay al posto dell'anteprima ("s-l225" -> "s-l1600"). */
export function bigImage(url) {
  return String(url ?? "").replace(/\/s-l\d+\./, "/s-l1600.");
}

/** Testo della ricerca eBay per la carta e la variante. */
export function searchQuery({ name, number, setTotal, setName, variant, game = "pokemon" }) {
  // Yu-Gi-Oh!: il codice del set ("LOB"), perché il numero stampato ha la regione in mezzo ("LOB-EN001", "LOB-IT001").
  if (game === "yugioh") return [name, String(number ?? "").split("-")[0], "1st edition"].filter((x) => String(x ?? "").trim()).join(" ");
  const n = setTotal ? `${number}/${setTotal}` : String(number ?? "");
  const v = variant === "reverse" ? "reverse holo" : "1st edition";
  return [name, n, setName, v].filter((x) => String(x ?? "").trim()).join(" ");
}

/** Mercato eBay per la lingua della carta: le carte italiane stanno su ebay.it, le inglesi su ebay.com. */
export function marketplaceFor(lang) {
  return { it: "EBAY_IT", de: "EBAY_DE", fr: "EBAY_FR", es: "EBAY_ES", en: "EBAY_US" }[String(lang ?? "").toLowerCase()] ?? "EBAY_US";
}

/** Chiave della cache del servizio: lingua, set, numero e variante (non l'id, così vale per tutte le fonti). */
export function cacheKey({ lang, setName, number, setTotal, variant, game = "pokemon" }) {
  return `${game === "pokemon" ? "" : `${game}|`}${String(lang ?? "").toLowerCase()}|${compact(setName)}|${String(number ?? "").trim().toLowerCase()}/${setTotal ?? ""}|${variant}`;
}
