// Prezzi Cardmarket di tutte le carte TCGdex in un file solo, per aggiornare i prezzi della collezione
// senza chiedere a TCGdex una carta alla volta (800 richieste per 900 copie, e niente senza rete).
// Per ogni carta la struttura che serve all'app per scegliere la variante della copia (prodotti Cardmarket
// della carta e delle varianti dettagliate, dalla cache di tcgdex-scan.js) e, a parte, i prezzi del listino
// ufficiale Cardmarket (price guide) di ogni prodotto, con gli stessi campi che dà TCGdex (che li copia da lì).
//
//   node src/cm-prezzi.js <cache-carte-tcgdex.json> <output.json> [cache-carte-giapponesi.json] [listino.json]
//
// Output: { v, updated, guide, c: {idCarta: "prodotto;variante;variante…"}, j: {idCarta giapponese: "prodotto"},
//           p: {prodotto: [avg, low, trend, avg1, avg7, avg30, avg-holo, low-holo, trend-holo, avg1-holo, avg7-holo, avg30-holo]} }
//   - c: carte del catalogo inglese (tutte le lingue occidentali): prodotto principale (vuoto se TCGdex non lo dà), poi
//     una voce per variante dettagliata nel formato di compactVariant ("tipo:prodotto|subtype:…|stamp:…|foil:…|size:…";
//     "!" dopo il prodotto = variante senza prezzi su TCGdex);
//   - j: carte del catalogo giapponese, solo il prodotto (l'app non usa le varianti dettagliate delle carte giapponesi);
//     le poche con lo stesso id di una carta inglese (Neo Destiny) hanno le varianti di quella, come nell'app;
//   - p: solo i prodotti usati dalle carte, nei campi di TCGdex (che li copia dal listino, zeri compresi): 0 = campo a zero
//     o mancante, gli zeri finali si tolgono (anche tutti: "[]" = prodotto nel listino senza nessun prezzo); un prodotto
//     senza nessun campo nel listino non c'è, come su TCGdex non c'è il blocco dei prezzi.
//   Le carte con prezzi TCGplayer su TCGdex (oggi nessuna) restano fuori: l'app le chiede a TCGdex.
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";

const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";

/** Campi del listino nell'ordine del file, gli stessi nomi di TCGdex. */
export const FIELDS = ["avg", "low", "trend", "avg1", "avg7", "avg30", "avg-holo", "low-holo", "trend-holo", "avg1-holo", "avg7-holo", "avg30-holo"];

/** Prodotto di una voce di variante compatta ("holo:547881!|foil:…" -> 547881), null se non c'è. */
export function variantProduct(v) {
  const m = /^[^:|]*:(\d+)/.exec(v);
  return m ? Number(m[1]) : null;
}

/** La riga di una carta nel file ("prodotto;variante;…"; [variants] false: solo il prodotto), null se la carta non ci va. */
export function cardLine(c, { variants = true } = {}) {
  if (!Array.isArray(c?.vd) || c.tp) return null;
  const roots = [c.cm2, c.cm].filter((x) => Number.isFinite(x) && x > 0);
  return [roots.join(","), ...(variants ? c.vd : [])].join(";");
}

/**
 * Il file dei prezzi.
 * @param {object[]} cards carte TCGdex compatte del catalogo inglese (tcgdex-scan.js)
 * @param {{priceGuides: object[], createdAt?: string}} guide listino Cardmarket
 * @param {object[]} [jaCards] carte compatte del catalogo giapponese
 */
export function buildCmPrices(cards, guide, jaCards = []) {
  const used = new Set();
  let skipped = 0;
  function lines(list, variants) {
    const out = {};
    for (const card of list) {
      const line = cardLine(card, { variants });
      if (line === null) {
        skipped++;
        continue;
      }
      out[card.id] = line;
      for (const x of [card.cm, card.cm2]) if (x) used.add(Number(x));
      if (variants) for (const v of card.vd) {
        const p = variantProduct(v);
        if (p) used.add(p);
      }
    }
    return out;
  }
  const c = lines(cards, true);
  const j = lines(jaCards, false);
  // Carta giapponese con lo stesso id di una inglese: l'app completa la giapponese con prodotto (se manca) e
  // varianti dettagliate della inglese.
  const en = new Map(cards.map((card) => [card.id, card]));
  for (const card of jaCards) {
    const e = en.get(card.id);
    if (!e || !(card.id in j) || !(e.id in c)) continue;
    const [roots] = j[card.id].split(";");
    const [enRoots, ...vd] = c[e.id].split(";");
    j[card.id] = [roots || enRoots, ...vd].join(";");
  }
  const p = {};
  for (const row of guide.priceGuides || []) {
    const id = Number(row.idProduct);
    if (!used.has(id)) continue;
    if (!FIELDS.some((f) => typeof row[f] === "number")) continue;
    const values = FIELDS.map((f) => (typeof row[f] === "number" && row[f] > 0 ? row[f] : 0));
    while (values.length > 0 && values[values.length - 1] === 0) values.pop();
    p[id] = values;
  }
  return {
    out: { v: 1, updated: new Date().toISOString(), guide: guide.createdAt ?? null, c, j, p },
    stats: { cards: Object.keys(c).length, ja: Object.keys(j).length, skipped, products: used.size, priced: Object.keys(p).length },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cacheFile, outFile = "cm-prezzi.json", jaFile, guideFile] = process.argv.slice(2);
  const cards = Object.values(JSON.parse(await fs.readFile(cacheFile, "utf8")));
  const jaCards = jaFile ? Object.values(JSON.parse(await fs.readFile(jaFile, "utf8").catch(() => "{}"))) : [];
  const guide = guideFile
    ? JSON.parse(await fs.readFile(guideFile, "utf8"))
    : await (async () => {
        const res = await fetchRetry(GUIDE);
        if (!res.ok) throw new Error(`${GUIDE}: HTTP ${res.status}`);
        return res.json();
      })();
  const { out, stats } = buildCmPrices(cards, guide, jaCards);
  const text = JSON.stringify(out);
  await fs.writeFile(outFile, text);
  console.log(
    `prezzi Cardmarket: ${stats.cards} carte inglesi e ${stats.ja} giapponesi (${stats.skipped} escluse), ` +
      `${stats.priced} prodotti nel listino su ${stats.products}, ` +
      `${(text.length / 1e6).toFixed(1)} MB, listino del ${out.guide}`,
  );
}
