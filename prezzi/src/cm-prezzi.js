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
import { cardName, cardNumber } from "./cardmarket.js";
import { norm } from "./matching.js";

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

/** true se la carta non ha nessuna fonte di prezzo: né un prodotto Cardmarket (suo o di una variante) né prezzi TCGplayer. */
export function noPriceSource(card) {
  return !card.cm && !card.cm2 && !(card.vd || []).some(variantProduct) && !hasTcgPrices(card);
}

/** Lettere dei tipi di energia con cui TCGplayer scrive le Unit Energy e i Fairy Charm ("Unit Energy FDY", "Fairy Charm L"). */
const TYPE_LETTERS = { grass: "G", fire: "R", water: "W", lightning: "L", psychic: "P", fighting: "F", darkness: "D", metal: "M", fairy: "Y" };
/** Parentesi che non cambiano la carta: Team Plasma, il tipo di allenatore, la rarità segreta (il numero dice già quale). */
const SAME_CARD = /^(team plasma|supporter|item|stadium|secret|secret rare|full art)$/i;

/**
 * Il nome di una carta per abbinare TCGdex e TCGplayer, con le parentesi in [fillName]: { key, other, finish }.
 * [number] è il numero della carta (una parentesi uguale al numero non conta: "Lycanroc GX (SV66)"). Riverifica del 19
 * novembre 2026: TCGplayer scrive «Unown [H]» per «Unown H», «Nidoran F» per «Nidoran♀», «Mew Star (Delta Species)» per
 * «Mew ☆ δ», «Delta Rainbow Energy» per «δ Rainbow Energy», «Unit Energy FDY» per «Unit Energy FightingDarknessFairy»,
 * «Professor's Research [Professor Magnolia]» per «Professor's Research (Professor Magnolia)».
 * [other]: c'è una parentesi che dice un'altra stampa ("(Prerelease)", "(Staff)", "(Cosmos Holo)"); [finish]: "n" per
 * "(Non-Holo)", "h" per "(Holo)"/"(Holofoil)", altrimenti null.
 */
export function fillName(name, number = "") {
  let s = String(name ?? "");
  // Nome giapponese con quello inglese tra quadre (TCGdex: "ナッシー[Exeggutor]").
  const latin = /[\u3040-\u30ff\u4e00-\u9fff]/.test(s) && /\[([A-Za-z][^\]]*)\]/.exec(s);
  if (latin) s = latin[1];
  let other = false;
  let finish = null;
  const num = cardNumber(String(number ?? "").split("/")[0]);
  s = s.replace(/[(\[]([^)\]]*)[)\]]/g, (all, inner) => {
    const x = inner.trim();
    if (/^delta species$/i.test(x)) return " Delta ";
    if (/^non-?holo$/i.test(x)) { finish = "n"; return " "; }
    if (/^holo(foil)?$/i.test(x)) { finish = "h"; return " "; }
    if (SAME_CARD.test(x) || (num && cardNumber(x) === num)) return " ";
    // Una lettera o un simbolo (Unown) o un nome tra quadre (Professor's Research [Professor Magnolia]) sono del nome.
    if (/^[A-Za-z!?]$/.test(x) || all.startsWith("[") || /^Professor /.test(x)) return ` ${x} `;
    other = true;
    return " ";
  });
  s = s
    .replace(/[☆★]/g, " Star ")
    .replace(/δ/g, " Delta ")
    .replace(/♀/g, " F ")
    .replace(/♂/g, " M ")
    .replace(/^(Unit Energy|Fairy Charm)\s+(.+)$/i, (all, head, types) => {
      const letters = types.match(/Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy/gi);
      return letters && letters.join("").length === types.replace(/\s+/g, "").length ? `${head} ${letters.map((t) => TYPE_LETTERS[t.toLowerCase()]).join("")}` : all;
    })
    .replace(/\bMega\b/gi, "M")
    .replace(/\s*\bLV\.?\s*(\d+|X)\b/gi, "");
  return { key: norm(s), other, finish };
}

/** Categoria inglese del catalogo TCGplayer (tcgplayer-all.js). */
const TCGPLAYER_ENGLISH = 3;
/** Carte di un set senza nessun collegamento a TCGplayer: servono almeno tante carte trovate nello stesso gruppo... */
export const FILL_MIN_CARDS = 10;
/** ...e questa parte di quelle trovate, perché il gruppo sia quello del set. */
export const FILL_GROUP_SHARE = 0.8;
/** Parte delle carte di un set che un gruppo TCGplayer deve avere per essere del set, quando TCGdex non collega nessuna carta. */
export const HOME_GROUP_SHARE = 0.2;

/**
 * Prezzi TCGplayer per le carte che TCGdex lascia senza nessuna fonte di prezzo, dal catalogo TCGplayer del job
 * (tcgplayer-all.js: prezzo di mercato in euro di ogni prodotto). Verifica dei prezzi del 17 novembre 2026: 204 carte
 * inglesi senza prezzo, tra cui le 94 della Volta Cromatica di Destino Sfuggente (sma, SV1-SV94: Charizard GX 708 €), che
 * nel catalogo TCGplayer ci sono tutte.
 *
 * Solo abbinamenti certi: un prodotto del catalogo inglese con lo stesso numero e lo stesso nome (senza parentesi: le
 * versioni "(Prerelease)", "(Staff)", "(Cosmos Holo)" sono altre stampe), **l'unico** in tutto il catalogo, nel gruppo
 * TCGplayer del set: quello dei prodotti che TCGdex collega già alle altre carte del set oppure, per un set senza nessun
 * collegamento, il gruppo in cui cadono almeno [FILL_MIN_CARDS] carte e [FILL_GROUP_SHARE] di quelle trovate. E solo se la
 * carta dichiara una finitura sola (normale o holo): il catalogo ha un prezzo per prodotto, non per versione.
 * @param {object[]} cards carte TCGdex compatte (tcgdex-scan.js)
 * @param {{usdEur: number, g: Record<string, [string, number]>, p: Record<string, any[]>}} catalog tcgplayer.json
 * @returns {Map<string, {block: Record<string, number[]>, product: number, group: number}>} carta -> prezzi (in dollari, come TCGdex)
 */
export function tcgplayerFill(cards, catalog) {
  const out = new Map();
  const rate = Number(catalog?.usdEur);
  if (!(rate > 0) || !catalog?.p || !catalog?.g) return out;
  const english = (group) => catalog.g[group]?.[1] === TCGPLAYER_ENGLISH;
  // Numero confrontabile: "SV49/SV94" -> "sv49", "004/005" -> "4".
  const numKey = (n) => cardNumber(String(n ?? "").split("/")[0]);
  // Prodotti inglesi per numero e nome. Il nome senza il numero in fondo ("Charmander - 004/165", "Snivy - BW01"); quelli
  // con una parentesi sono altre stampe e non si scelgono, ma contano per dire che il nome non è di un prodotto solo.
  const byKey = new Map();
  for (const [id, row] of Object.entries(catalog.p)) {
    const [name, group, number, eur] = row;
    if (!number || !english(group) || typeof name !== "string") continue;
    // Il numero in fondo al nome, anche prima delle parentesi ("Trainers' Mail - 92a/108 (Non-Holo)").
    const noNumber = name.replace(/\s+-\s+([^\s([]+)(?=\s*(?:[([]|$))/, (all, n) => (numKey(n) === numKey(number) ? "" : all));
    const f = fillName(noNumber, number);
    const k = `${numKey(number)}|${f.key}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ id: Number(id), group: Number(group), plain: !f.other, finish: f.finish, eur: typeof eur === "number" && eur > 0 ? eur : null });
  }
  // Gruppi TCGplayer "di casa" di ogni set: quelli dei prodotti che TCGdex collega alle sue carte ("tp:<prodotto>").
  const home = new Map();
  for (const c of cards) {
    for (const v of c.vd || []) {
      const m = /\|tp:(\d+)/.exec(v);
      const group = m && catalog.p[m[1]]?.[1];
      if (group === undefined || group === null || !english(group)) continue;
      if (!home.has(c.set)) home.set(c.set, new Set());
      home.get(c.set).add(Number(group));
    }
  }
  // Per i set di cui TCGdex non collega nessuna carta a TCGplayer (Diamante e Perla: 26 Unown senza prezzo, 19 novembre
  // 2026), il gruppo del set dalle sue carte: quello in cui il numero e il nome di quasi tutte trovano un prodotto solo.
  const votes = new Map();
  for (const c of cards) {
    if (!c.name || !c.localId || home.has(c.set)) continue;
    const gs = new Set((byKey.get(`${numKey(c.localId)}|${fillName(c.name, c.localId).key}`) || []).filter((x) => x.plain).map((x) => x.group));
    if (!votes.has(c.set)) votes.set(c.set, { n: 0, by: new Map() });
    const v = votes.get(c.set);
    v.n++;
    if (gs.size === 1) {
      const [g] = gs;
      v.by.set(g, (v.by.get(g) || 0) + 1);
    }
  }
  // Tra le carte con un prodotto in un gruppo solo; più gruppi se ognuno ne ha abbastanza (Generations e la sua Radiant
  // Collection), mai quelli con poche carte (le alternate art, le carte giganti).
  for (const [set, v] of votes) {
    const voters = [...v.by.values()].reduce((a, b) => a + b, 0);
    const groups = [...v.by].filter(([, n]) => n >= FILL_MIN_CARDS && n >= HOME_GROUP_SHARE * voters).map(([g]) => g);
    if (groups.length > 0) home.set(set, new Set(groups));
  }
  // Gruppo delle carte "a" di XY (24a, 55a, XY198a): TCGplayer le mette tutte in «Alternate Art Promos».
  const altArt = new Set(Object.entries(catalog.g).filter(([, g]) => g?.[0] === "Alternate Art Promos").map(([id]) => Number(id)));
  // Candidati: carte senza fonte con un solo prodotto con quel numero e quel nome.
  const bySet = new Map();
  for (const c of cards) {
    if (!noPriceSource(c) || !c.name || !c.localId) continue;
    const fl = typeof c.fl === "string" ? c.fl : "";
    const normal = fl.includes("n");
    const holo = fl.includes("h");
    const letter = /\d+[a-z]$/i.test(String(c.localId));
    const products = byKey.get(`${numKey(c.localId)}|${fillName(c.name, c.localId).key}`) || [];
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    if (normal && holo) {
      // Normale e holo: solo se TCGplayer ha un prodotto per finitura ("Trainers' Mail - 92a/108 (Non-Holo)" e "(Holo)").
      for (const [f, key] of [["n", "normal"], ["h", "holofoil"]]) bySet.get(c.set).push({ card: c, all: products.filter((x) => x.finish === f), letter, key, both: true });
      continue;
    }
    if (normal === holo) continue;
    // Prodotti con quel numero e quel nome, della finitura della carta se il nome la dice ("(Non-Holo)", "(Holo)").
    const all = products.filter((x) => x.finish === null || x.finish === (normal ? "n" : "h"));
    bySet.get(c.set).push({ card: c, all, letter, key: normal ? "normal" : "holofoil" });
  }
  for (const [set, list] of bySet) {
    // Un solo prodotto semplice nei gruppi del set (o, per le carte "a", in «Alternate Art Promos»), e nessun'altra stampa
    // con lo stesso nome in quei gruppi. Le uscite in altri gruppi (carte giganti, mazzi dei Mondiali, Deck Exclusives)
    // sono altre stampe col loro nome e non contano. Senza gruppi del set: come prima, un prodotto unico in tutto il catalogo.
    const homeGroups = home.get(set);
    for (const x of list) {
      const ok = (p) => (homeGroups ? homeGroups.has(p.group) || (x.letter && altArt.has(p.group)) : x.letter ? altArt.has(p.group) : true);
      const inGroups = x.all.filter(ok);
      const plain = inGroups.filter((p) => p.plain);
      x.product = plain.length === 1 && inGroups.length === plain.length && (homeGroups || x.letter || x.all.length === 1) ? plain[0] : null;
    }
    const found = list.filter((x) => x.product);
    let groups = homeGroups && new Set([...homeGroups, ...altArt]);
    if (!groups) {
      // Set senza nessun collegamento: il gruppo dove cadono quasi tutte le carte trovate.
      const count = new Map();
      for (const x of found) count.set(x.product.group, (count.get(x.product.group) || 0) + 1);
      const [best, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      groups = n >= FILL_MIN_CARDS && n >= FILL_GROUP_SHARE * found.length ? new Set([best]) : new Set();
    }
    for (const x of found) {
      // Le carte "a" stanno in «Alternate Art Promos» anche quando il set non ha un gruppo suo (le 6 carte di xya).
      if (!(groups.has(x.product.group) || (x.letter && altArt.has(x.product.group))) || x.product.eur === null) continue;
      const usd = Math.round(x.product.eur * rate * 100) / 100;
      // Con le due finiture, un blocco solo con entrambe (se ne manca una, la carta resta senza: un prezzo per due no).
      const prev = x.both ? out.get(x.card.id) : null;
      out.set(x.card.id, { block: { ...(prev?.block ?? {}), [x.key]: [usd] }, product: prev?.product ?? x.product.id, group: x.product.group, ...(x.both ? { both: true } : {}) });
    }
  }
  for (const [id, x] of out) if (x.both && Object.keys(x.block).length < 2) out.delete(id);
  return out;
}

/**
 * I prezzi TCGplayer di una carta che TCGdex dichiara di una finitura sola (normale o holo) e che TCGplayer ha solo
 * nell'altra: sono della stessa carta, col nome della finitura di TCGdex. Riverifica del 19 novembre 2026: Pikachu Libre
 * 30 del Trainer Kit XY (TCGdex: normale; TCGplayer: holofoil 72,05 $) e altre restavano senza prezzo perché l'app cerca
 * il prezzo della finitura della copia. Solo con la carta di una finitura e il blocco di una voce.
 */
export function sameFinish(card) {
  const fl = typeof card?.fl === "string" ? card.fl : "";
  const keys = Object.keys(card?.tpp ?? {});
  // Solo per le carte senza un prodotto Cardmarket: per le altre il prezzo viene da lì e TCGplayer non serve.
  if (keys.length !== 1 || fl.includes("r") || card.cm || card.cm2 || (card.vd || []).some(variantProduct)) return card;
  const normal = fl.includes("n");
  const holo = fl.includes("h");
  if (normal === holo) return card;
  const want = normal ? "normal" : "holofoil";
  const have = keys[0];
  if (have === want || !["normal", "holofoil"].includes(have)) return card;
  return { ...card, tpp: { [want]: card.tpp[have] } };
}

/**
 * Prezzi TCGplayer delle versioni dei mazzi dei Mondiali ("stamp:<giocatore>" su TCGdex, senza prodotto né prezzi):
 * TCGplayer le ha nel gruppo «World Championship Decks» col nome del giocatore ("Unown [Q] - 2010 (Mychael Bryan)",
 * 18,23 €; "Jolteon Star - 2007 (Tom Roos)", 107,28 €). Solo con lo stesso numero, lo stesso nome ([fillName]) e lo stesso
 * giocatore, e un prodotto solo. Riverifica del 19 novembre 2026: 11 carte, 133 combinazioni senza prezzo.
 * @returns {Map<string, Map<number, Record<string, number[]>>>} carta -> (posizione in vd -> blocco in dollari, come TCGdex)
 */
export function worldsFill(cards, catalog) {
  const out = new Map();
  const rate = Number(catalog?.usdEur);
  if (!(rate > 0) || !catalog?.p || !catalog?.g) return out;
  const groups = new Set(Object.entries(catalog.g).filter(([, g]) => g?.[0] === "World Championship Decks").map(([id]) => Number(id)));
  const numKey = (n) => cardNumber(String(n ?? "").split("/")[0]);
  const slug = (x) => norm(x);
  const byKey = new Map();
  for (const [id, row] of Object.entries(catalog.p)) {
    const [name, group, number, eur] = row;
    if (!groups.has(Number(group)) || typeof name !== "string" || !(typeof eur === "number" && eur > 0)) continue;
    const m = /^(.*?)\s+-\s+\d{4}\s+\(([^)]+)\)\s*$/.exec(name);
    if (!m) continue;
    const f = fillName(m[1], number);
    if (f.other) continue;
    const k = `${numKey(number)}|${f.key}|${slug(m[2])}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ id: Number(id), eur });
  }
  for (const c of cards) {
    if (!c.name || !c.localId) continue;
    (c.vd || []).forEach((v, i) => {
      const stamp = /\|stamp:([a-z-]+)/.exec(v)?.[1];
      // Con prezzi TCGplayer suoi si lascia com'è, salvo che siano quelli della carta (TCGdex dà alla Latias ☆ del mazzo dei
      // Mondiali di Hiroki Yano i prezzi della Latias ☆ originale, 1.800 $, contro i 364,70 € della sua).
      const own = c.vt?.[i] && Object.keys(c.vt[i]).length > 0;
      if (!stamp || variantProduct(v) || (own && JSON.stringify(c.vt[i]) !== JSON.stringify(c.tpp))) return;
      const list = byKey.get(`${numKey(c.localId)}|${fillName(c.name, c.localId).key}|${slug(stamp)}`) || [];
      if (list.length !== 1) return;
      const type = v.split(":")[0];
      const key = type === "holo" ? "holofoil" : type === "reverse" ? "reverse-holofoil" : "normal";
      if (!out.has(c.id)) out.set(c.id, new Map());
      out.get(c.id).set(i, { [key]: [Math.round(list[0].eur * rate * 100) / 100] });
    });
  }
  return out;
}

/**
 * I prodotti della sola carta corretti da cardmarket.js (campo "own" di cardmarket.json: carta -> {prodotto sbagliato:
 * prodotto della carta}): si cambiano il prodotto principale e quelli delle varianti senza timbro né foil speciale, mentre
 * le versioni speciali tengono il loro. Milotic 70/147 di Supreme Victors: TCGdex dà a tutte il prodotto della prerelease.
 */
export function applyOwnProducts(cards, own) {
  if (!own || Object.keys(own).length === 0) return cards;
  const special = /\|(stamp|foil):/;
  return cards.map((c) => {
    const m = own[c.id];
    if (!m) return c;
    const to = (x) => (Number.isFinite(x) && String(x) in m ? Number(m[x]) : x);
    // Le versioni speciali senza un prodotto loro né prezzi TCGplayer loro prendevano quello della carta (Leafeon 17/90 Staff):
    // tengono quello di prima. Con prezzi TCGplayer loro (Milotic 70/147 Staff, 215 €) restano senza prodotto, come prima.
    const before = Number.isFinite(c.cm) && String(c.cm) in m ? c.cm : null;
    const ownTcg = (i) => c.vt?.[i] && Object.keys(c.vt[i]).length > 0;
    const vd = (c.vd || []).map((v, i) => {
      if (special.test(v)) return before && variantProduct(v) === null && !ownTcg(i) ? v.replace(/^([^:|]*):/, `$1:${before}`) : v;
      const p = variantProduct(v);
      return p && String(p) in m ? v.replace(`:${p}`, `:${m[p]}`) : v;
    });
    return { ...c, cm: to(c.cm), ...(c.cm2 ? { cm2: to(c.cm2) } : {}), vd };
  });
}

/**
 * Il file dei prezzi.
 * @param {object[]} cards carte TCGdex compatte del catalogo inglese (tcgdex-scan.js)
 * @param {{priceGuides: object[], createdAt?: string}} guide listino Cardmarket
 * @param {object[]} [jaCards] carte compatte del catalogo giapponese
 */
export function buildCmPrices(cards, guide, jaCards = [], { today = Math.floor(Date.now() / 86_400_000), tcgplayer = null, own = null } = {}) {
  cards = applyOwnProducts(cards, own);
  // Carte inglesi senza nessuna fonte: prezzi dal catalogo TCGplayer, scritti come quelli di TCGdex (tcgplayerFill).
  const filled = tcgplayer ? tcgplayerFill(cards, tcgplayer) : new Map();
  if (filled.size > 0) cards = cards.map((c) => (filled.has(c.id) ? { ...c, tp: true, tpp: filled.get(c.id).block } : c));
  // Carte di una finitura sola coi prezzi TCGplayer dell'altra (sameFinish).
  let finishes = 0;
  cards = cards.map((c) => {
    const x = sameFinish(c);
    if (x !== c) finishes++;
    return x;
  });
  // Versioni dei mazzi dei Mondiali senza prezzi: quelli di TCGplayer (worldsFill).
  const worlds = tcgplayer ? worldsFill(cards, tcgplayer) : new Map();
  if (worlds.size > 0) {
    cards = cards.map((c) => {
      const m = worlds.get(c.id);
      if (!m) return c;
      const vt = (c.vd || []).map((_, i) => m.get(i) ?? c.vt?.[i] ?? null);
      return { ...c, vt };
    });
  }
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
      if (noPriceSource(card)) {
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
      filled: filled.size,
      worlds: [...worlds.values()].reduce((n, m) => n + m.size, 0),
      finishes,
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
  // Catalogo TCGplayer del job (tcgplayer-all.js), se c'è: dà un prezzo alle carte che TCGdex lascia senza fonte.
  const tcgplayer = process.env.TCGPLAYER_JSON ? JSON.parse(await fs.readFile(process.env.TCGPLAYER_JSON, "utf8").catch(() => "null")) : null;
  // Correzioni Cardmarket del job (cardmarket.js), se ci sono: i prodotti giusti della sola carta ("own").
  const own = process.env.CARDMARKET_JSON ? JSON.parse(await fs.readFile(process.env.CARDMARKET_JSON, "utf8").catch(() => "{}"))?.own ?? null : null;
  const { out, stats } = buildCmPrices(cards, guide, jaCards, { tcgplayer, own });
  const text = JSON.stringify(out);
  await fs.writeFile(outFile, text);
  console.log(
    `prezzi Cardmarket: ${stats.cards} carte inglesi e ${stats.ja} giapponesi (${stats.skipped} escluse), ` +
      `${stats.tcg} inglesi e ${stats.jaTcg} giapponesi con i prezzi TCGplayer (${stats.blocks} blocchi), ` +
      `${stats.filled} col prezzo dal catalogo TCGplayer, ${stats.worlds} versioni dei mazzi dei Mondiali, ${stats.finishes} con la finitura di TCGdex, ${stats.noSource} senza fonte di prezzo (lette da ${Math.floor(Date.now() / 86_400_000) - out.ck} giorni al più), ` +
      `${stats.priced} prodotti nel listino su ${stats.products}, ` +
      `${(text.length / 1e6).toFixed(1)} MB, listino del ${out.guide}`,
  );
}
