// Prezzi Cardmarket di tutte le carte TCGdex in un file solo, per aggiornare i prezzi della collezione
// senza chiedere a TCGdex una carta alla volta (800 richieste per 900 copie, e niente senza rete).
// Per ogni carta la struttura che serve all'app per scegliere la variante della copia (prodotti Cardmarket
// della carta e delle varianti dettagliate, dalla cache di tcgdex-scan.js) e, a parte, i prezzi del listino
// ufficiale Cardmarket (price guide) di ogni prodotto, con gli stessi campi che dà TCGdex (che li copia da lì).
//
//   node src/cm-prezzi.js <cache-carte-tcgdex.json> <output.json> [cache-carte-giapponesi.json] [listino.json]
//
// Output: { v, updated, guide, c: {idCarta: "prodotto;variante;variante…"}, j: {idCarta giapponese: "prodotto"},
//           p: {prodotto: [avg, low, trend, avg1, avg7, avg30, avg-holo, low-holo, trend-holo, avg1-holo, avg7-holo, avg30-holo]},
//           ct: {idCarta: riga}, jt: {idCarta giapponese: riga}, t: ["versione=mercato/medio,…"] }
//   - c: carte del catalogo inglese (tutte le lingue occidentali): prodotto principale (vuoto se TCGdex non lo dà), poi
//     una voce per variante dettagliata nel formato di compactVariant ("tipo:prodotto|subtype:…|stamp:…|foil:…|size:…";
//     "!" dopo il prodotto = variante senza prezzi su TCGdex);
//   - j: carte del catalogo giapponese, solo il prodotto (l'app non usa le varianti dettagliate delle carte giapponesi);
//     le poche con lo stesso id di una carta inglese (Neo Destiny) hanno le varianti di quella, come nell'app;
//   - p: solo i prodotti usati dalle carte, nei campi di TCGdex (che li copia dal listino, zeri compresi): 0 = campo a zero
//     o mancante, gli zeri finali si tolgono (anche tutti: "[]" = prodotto nel listino senza nessun prezzo); un prodotto
//     senza nessun campo nel listino non c'è, come su TCGdex non c'è il blocco dei prezzi.
//   - ct, jt, t (10 novembre 2026): le carte con prezzi TCGplayer su TCGdex (19.000 su 24.000 inglesi), che prima restavano
//     fuori dal file e l'app chiedeva a TCGdex una alla volta. Stesse righe di c e j, con in più "|t:<n>" dopo i prodotti
//     della carta e dopo ogni variante che ha prezzi TCGplayer: n (in base 36) è la posizione in t dei suoi prezzi,
//     "versione=mercato/medio" per ogni versione di TCGdex ("normal", "holofoil", "reverse-holofoil", "1st-edition-holofoil"…),
//     in dollari come li dà TCGdex (marketPrice e midPrice, vuoto = manca). Le app fino alla 0.9.172 leggono solo c, j e p:
//     per loro queste carte restano fuori dal file (le chiedono a TCGdex, come prima), perché senza i prezzi TCGplayer
//     darebbero un valore diverso.
//   - ck: il giorno (giorni dal 1970) della lettura più vecchia tra le carte del file senza nessuna fonte di prezzo (né
//     prodotto Cardmarket né prezzi TCGplayer). La scansione le rilegge ogni notte: se ck è di oggi o di ieri l'app si fida
//     del file e non le chiede più a TCGdex; se è vecchio (scansione ferma) torna a chiederle, come faceva prima.
//   - in fondo a ogni riga, se c'è qualcosa da dire, una voce ":lettere" (cardFlags di tcgdex-scan.js: versioni che TCGdex
//     dichiara, rarità holo o no, nome senza reverse): servono all'app per proporre le stesse varianti e segnare gli
//     stessi prezzi indicativi che con la risposta di TCGdex. Le app vecchie la saltano (una variante senza tipo).
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

/** Un blocco di prezzi TCGplayer di tcgdex-scan.js ({versione: [mercato, medio]}) in una riga: "versione=mercato/medio,…". */
export function tcgBlock(block) {
  const n = (x) => (typeof x === "number" && Number.isFinite(x) ? String(x) : "");
  return Object.entries(block)
    .filter(([key]) => !/[,=/|;]/.test(key))
    .map(([key, v]) => `${key}=${[n(v?.[0]), n(v?.[1])].join("/").replace(/\/+$/, "")}`)
    .join(",");
}

/** true se la carta compatta ha prezzi TCGplayer scritti (formato 3 di tcgdex-scan.js). */
export function hasTcgPrices(c) {
  return !!c?.tpp || (Array.isArray(c?.vt) && c.vt.some(Boolean));
}

/**
 * La riga di una carta nel file ("prodotto;variante;…"; [variants] false: solo il prodotto), null se la carta non ci va
 * (mai letta, o con prezzi TCGplayer su TCGdex ma letta da uno script vecchio che non li salvava: l'app la chiede a TCGdex).
 * [ref]: per le carte con prezzi TCGplayer, la funzione che dà a un blocco la sua posizione nella tabella "t" (senza,
 * quelle carte restano fuori).
 */
export function cardLine(c, { variants = true, ref = null } = {}) {
  if (!Array.isArray(c?.vd)) return null;
  const tcg = hasTcgPrices(c);
  if (c.tp && (!tcg || !ref)) return null;
  const mark = (block) => (tcg && block && Object.keys(block).length > 0 ? `|t:${ref(block).toString(36)}` : "");
  const roots = [c.cm2, c.cm].filter((x) => Number.isFinite(x) && x > 0);
  const flags = typeof c.fl === "string" && /^[A-Za-z0-9]+$/.test(c.fl) ? [`:${c.fl}`] : [];
  return [roots.join(",") + mark(c.tpp), ...(variants ? c.vd.map((v, i) => v + mark(c.vt?.[i])) : []), ...flags].join(";");
}

/** Una riga del file nelle sue parti: prodotti della carta (con "|t:"), varianti dettagliate e voce delle lettere (o null). */
export function lineParts(line) {
  const [root, ...rest] = line.split(";");
  return { root, vd: rest.filter((x) => !x.startsWith(":")), flags: rest.find((x) => x.startsWith(":")) ?? null };
}

/**
 * Il file dei prezzi.
 * @param {object[]} cards carte TCGdex compatte del catalogo inglese (tcgdex-scan.js)
 * @param {{priceGuides: object[], createdAt?: string}} guide listino Cardmarket
 * @param {object[]} [jaCards] carte compatte del catalogo giapponese
 */
export function buildCmPrices(cards, guide, jaCards = [], { today = Math.floor(Date.now() / 86_400_000) } = {}) {
  const used = new Set();
  let skipped = 0;
  // Tabella dei prezzi TCGplayer: ogni blocco diverso una volta sola (carta e varianti dello stesso prodotto hanno lo stesso).
  const t = [];
  const blockIndex = new Map();
  const ref = (block) => {
    const text = tcgBlock(block);
    let i = blockIndex.get(text);
    if (i === undefined) {
      i = t.length;
      t.push(text);
      blockIndex.set(text, i);
    }
    return i;
  };
  // Lettura più vecchia tra le carte senza nessuna fonte di prezzo (vedi "ck" in cima).
  let oldest = Infinity;
  let noSource = 0;
  /** Le righe di [list]: senza prezzi TCGplayer in [plain] (le leggono anche le app vecchie), con i prezzi in [withTcg]. */
  function lines(list, variants) {
    const plain = {};
    const withTcg = {};
    for (const card of list) {
      const line = cardLine(card, { variants, ref });
      if (line === null) {
        skipped++;
        continue;
      }
      if (!card.cm && !card.cm2 && !card.vd.some(variantProduct) && !hasTcgPrices(card)) {
        noSource++;
        oldest = Math.min(oldest, Number(card.ck) || 0);
      }
      // Carta giapponese: le varianti (e i loro prezzi TCGplayer) non si scrivono, conta solo il blocco della carta.
      (line.includes("|t:") ? withTcg : plain)[card.id] = line;
      for (const x of [card.cm, card.cm2]) if (x) used.add(Number(x));
      if (variants) for (const v of card.vd) {
        const p = variantProduct(v);
        if (p) used.add(p);
      }
    }
    return [plain, withTcg];
  }
  const [c, ct] = lines(cards, true);
  const [j, jt] = lines(jaCards, false);
  // Carta giapponese con lo stesso id di una inglese: l'app completa la giapponese con prodotto e prezzi (se mancano) e
  // varianti dettagliate della inglese.
  const en = new Set(cards.map((card) => card.id));
  for (const card of jaCards) {
    if (!en.has(card.id)) continue;
    const jaLine = j[card.id] ?? jt[card.id];
    const enLine = c[card.id] ?? ct[card.id];
    if (jaLine === undefined || enLine === undefined) continue;
    // Prodotti e lettere della carta giapponese, varianti di quella inglese.
    const ja = lineParts(jaLine);
    const e = lineParts(enLine);
    const line = [ja.root || e.root, ...e.vd, ...(ja.flags ? [ja.flags] : [])].join(";");
    delete j[card.id];
    delete jt[card.id];
    (line.includes("|t:") ? jt : j)[card.id] = line;
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
    out: { v: 1, updated: new Date().toISOString(), guide: guide.createdAt ?? null, ck: Number.isFinite(oldest) ? oldest : today, c, j, p, ct, jt, t },
    stats: {
      noSource,
      cards: Object.keys(c).length + Object.keys(ct).length,
      ja: Object.keys(j).length + Object.keys(jt).length,
      tcg: Object.keys(ct).length,
      jaTcg: Object.keys(jt).length,
      blocks: t.length,
      skipped,
      products: used.size,
      priced: Object.keys(p).length,
    },
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
      `${stats.tcg} inglesi e ${stats.jaTcg} giapponesi con i prezzi TCGplayer (${stats.blocks} blocchi), ` +
      `${stats.noSource} senza fonte di prezzo (lette da ${Math.floor(Date.now() / 86_400_000) - out.ck} giorni al più), ` +
      `${stats.priced} prodotti nel listino su ${stats.products}, ` +
      `${(text.length / 1e6).toFixed(1)} MB, listino del ${out.guide}`,
  );
}
