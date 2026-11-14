// Illustratore di ogni carta, per sfogliare le carte per illustratore in Cerca e nella Collezione (richiesto dall'utente
// l'11 novembre 2026: "come ora fai per i set").
//
//   node prezzi/src/illustratori.js <tcgdex-carte.json|-> <lorcana.json|-> <uscita.json>
//
// Fonti:
// - Pokémon: TCGdex, elenco degli illustratori e carte di ognuno (`/v2/<lingua>/illustrators/<nome>`), in inglese (gli id
//   valgono per tutte le lingue occidentali) e in ogni lingua asiatica (id propri: "SV9-001");
// - Lorcana: LorcanaJSON (lorcanajson.org, campo `artists`), abbinato al nostro catalogo CardTrader per set e numero.
// One Piece, Dragon Ball e Yu-Gi-Oh!: nessuna banca dati pubblica riporta l'illustratore (verificato l'11 novembre 2026:
// optcgapi.com, sito ufficiale Bandai, YGOPRODeck; le carte Yu-Gi-Oh! non lo stampano nemmeno).
//
// Uscita (carte/v1/illustratori.json):
//   { v, updated,
//     pk: { <lingua>: { n: [nomi, da chi ha più carte], c: ["id id id", …], f: [foto di copertina], q: { indice: [nomi TCGdex] } } },
//     lc: { n: [nomi], c: ["blueprint blueprint", …] } }
// - c[i] sono le carte dell'illustratore n[i] (una carta Lorcana con due illustratori sta in tutti e due);
// - f[i] è la foto di una sua carta senza "https://assets.tcgdex.net/" davanti ("" se nessuna ha la foto): in inglese
//   la carta che vale di più (tendenza del listino Cardmarket), altrimenti la più recente;
// - q solo dove TCGdex scrive il nome in più modi ("Saino Misaki" e "saino misaki", virgolette in più): i nomi da
//   chiedere a TCGdex per avere tutte le carte.
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";
import { DATI } from "./dati.js";

const TCGDEX = "https://api.tcgdex.net/v2";
const ASSETS = "https://assets.tcgdex.net/";
const GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const LORCANA_JSON = "https://lorcanajson.org/files/current/en/allCards.json";
export const PUBLISHED = `${DATI}/carte/v1/illustratori.json`;
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };
/** Inglese (id comuni alle lingue occidentali) e le lingue asiatiche di TCGdex, che hanno id propri. */
export const LANGS = ["en", "ja", "zh-tw", "zh-cn", "ko", "id", "th"];
/** Oltre questa quota di illustratori non letti in una lingua si tiene la parte già pubblicata. */
const MAX_FAILED = 0.03;

/** Nome ripulito: spazi doppi, virgolette spaiate in fondo, nome scritto due volte di fila. */
export function cleanName(raw) {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  const half = s.slice(0, s.length / 2);
  if (s.length > 3 && s.length % 2 === 0 && half + half === s) s = half.trim();
  if ((s.match(/"/g) ?? []).length % 2 === 1) s = s.replace(/"$/, "").trim();
  return s;
}

/** Chiave che unisce i modi diversi di scrivere lo stesso nome (maiuscole, virgolette). */
export const nameKey = (raw) => cleanName(raw).toLowerCase().replace(/["“”]/g, "").replace(/\s+/g, " ").trim();

/** Set di TCG Pocket ("A1", "A2b", "B2", "P-A"): carte solo digitali, che l'app non mostra (come isPocketSet nell'app). */
export const isPocketSet = (setId) => /^(P-[A-Z]|[AB][0-9]+[a-z]?)$/.test(setId);
const setOf = (id) => id.slice(0, id.lastIndexOf("-"));

const natural = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true });

/**
 * Parte di una lingua. [lists] = [{ raw, cards: [{ id, image }] }] (una voce per nome di TCGdex);
 * [order] = id del set -> posizione (i set più recenti hanno il numero più alto); [price] = id carta -> prezzo.
 */
export function buildSection(lists, { order = new Map(), price = new Map() } = {}) {
  const groups = new Map();
  for (const { raw, cards } of lists) {
    const key = nameKey(raw);
    if (!key || !cards?.length) continue;
    const g = groups.get(key) ?? { variants: [], cards: new Map() };
    g.variants.push({ raw, count: cards.length });
    for (const c of cards) if (c?.id && !isPocketSet(setOf(c.id)) && !g.cards.has(c.id)) g.cards.set(c.id, c.image ?? null);
    if (g.cards.size) groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => {
    // Il nome da mostrare: la scrittura con più carte, ripulita.
    const name = cleanName([...g.variants].sort((a, b) => b.count - a.count)[0].raw);
    const ids = [...g.cards.keys()].sort((a, b) => (order.get(setOf(b)) ?? -1) - (order.get(setOf(a)) ?? -1) || natural(a, b));
    const withImage = ids.filter((id) => g.cards.get(id));
    const best = withImage.filter((id) => price.has(id)).sort((a, b) => price.get(b) - price.get(a))[0] ?? withImage[0];
    const queries = [...new Set(g.variants.map((v) => v.raw.toLowerCase()))];
    return { name, ids, cover: best ? g.cards.get(best).replace(ASSETS, "") : "", queries };
  }).sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  const q = {};
  rows.forEach((r, i) => {
    if (r.queries.length > 1 || r.queries[0] !== r.name.toLowerCase()) q[i] = r.queries;
  });
  return { n: rows.map((r) => r.name), c: rows.map((r) => r.ids.join(" ")), f: rows.map((r) => r.cover), q };
}

/** Set Lorcana di CardTrader -> sigla di LorcanaJSON (set principali, avventure, promo). */
export function lorcanaSetCode(code) {
  const c = String(code ?? "").toLowerCase();
  if (c === "ch1") return "1";
  let m = c.match(/^lor(\d+)$/);
  if (m) return m[1];
  m = c.match(/^quest(\d+)$/);
  if (m) return `Q${m[1]}`;
  return null;
}

/** Promo: espansione CardTrader -> gruppi promo di LorcanaJSON. */
const LORCANA_PROMOS = { promos: ["P1"], p2: ["P2"], p3: ["P3"], p4: ["P4"], pd1: ["PD1"], d23: ["D23"], lcp: ["C1", "C2"], dis: ["DIS"], cc: ["CC1"] };

const lorcanaName = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Illustratori delle carte Lorcana del nostro catalogo ([catalog] = lorcana.json del job) dai dati di LorcanaJSON
 * ([all] = allCards.json). Una carta si abbina per set e numero **e stesso nome**; le promo per gruppo promo e
 * numero; il resto solo se tutte le stampe con quel nome hanno lo stesso illustratore (le Enchanted e molte promo
 * hanno un disegno diverso: meglio nessun illustratore che quello di un'altra stampa).
 */
export function lorcanaSection(catalog, all) {
  const byNumber = new Map(), byPromo = new Map(), byName = new Map();
  for (const c of all?.cards ?? []) {
    const artists = (c.artists?.length ? c.artists : String(c.artistsText ?? "").split(/\s*\/\s*/)).map(cleanName).filter(Boolean);
    if (!artists.length) continue;
    const name = lorcanaName(c.fullName);
    const row = { name, artists };
    if (c.promoGrouping) byPromo.set(`${c.promoGrouping}|${c.number}`, row);
    else byNumber.set(`${c.setCode}|${c.number}`, row);
    const list = byName.get(name) ?? [];
    list.push(artists.join("|"));
    byName.set(name, list);
  }
  const sets = new Map((catalog?.sets ?? []).map((s) => [s.id, s.code]));
  const cardsOf = new Map();
  let matched = 0, total = 0;
  for (const card of catalog?.cards ?? []) {
    total++;
    const code = sets.get(card.s), name = lorcanaName(card.n), num = parseInt(card.num, 10);
    let row = null;
    const main = lorcanaSetCode(code);
    if (main && Number.isFinite(num)) row = byNumber.get(`${main}|${num}`);
    if (!row && Number.isFinite(num)) for (const g of LORCANA_PROMOS[code] ?? []) row ??= byPromo.get(`${g}|${num}`);
    if (row && row.name !== name) row = null;
    let artists = row?.artists;
    if (!artists) {
      const same = new Set(byName.get(name) ?? []);
      if (same.size === 1) artists = [...same][0].split("|");
    }
    if (!artists) continue;
    matched++;
    for (const a of artists) {
      const list = cardsOf.get(a) ?? [];
      list.push(card.id);
      cardsOf.set(a, list);
    }
  }
  const rows = [...cardsOf.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return { n: rows.map((r) => r[0]), c: rows.map((r) => r[1].join(" ")), matched, total };
}

async function getJson(url, opts) {
  const res = await fetchRetry(url, { headers: HEADERS }, opts);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Tutti gli illustratori di una lingua da TCGdex: { lists, failed }. */
async function tcgdexLists(lang) {
  const names = await getJson(`${TCGDEX}/${lang}/illustrators`);
  const lists = [];
  let failed = 0;
  // TCGdex non distingue maiuscole e minuscole nel nome: una richiesta per scrittura diversa.
  const distinct = [...new Map(names.map((n) => [String(n).toLowerCase(), n])).values()];
  await pool(distinct, 6, async (raw) => {
    try {
      const d = await getJson(`${TCGDEX}/${lang}/illustrators/${encodeURIComponent(raw)}`, { attempts: 4, waitMs: 3000, maxWaitMs: 10000, log: () => {} });
      lists.push({ raw, cards: d.cards ?? [] });
    } catch {
      failed++;
    }
  });
  return { lists, failed, names: distinct.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cardsFile, lorcanaFile, out] = process.argv.slice(2);
  const readJson = (f) => (!f || f === "-" ? Promise.resolve(null) : fs.readFile(f, "utf8").then(JSON.parse).catch(() => null));
  const previous = await getJson(`${PUBLISHED}?t=${Date.now()}`, { attempts: 2, waitMs: 2000, log: () => {} }).catch(() => null);
  // Prezzo delle carte inglesi (prodotto Cardmarket della carta nella cache di tcgdex-scan + tendenza del listino), per
  // la foto di copertina: la carta più preziosa di ogni illustratore.
  const price = new Map();
  const cards = await readJson(cardsFile);
  if (cards) {
    const guide = await getJson(GUIDE).then((g) => g.priceGuides ?? []).catch(() => []);
    const trend = new Map();
    for (const g of guide) {
      const t = g.trend, a = g.avg30;
      if (t >= 1 && a > 0 && t <= a * 2.5 && t >= a / 2.5) trend.set(g.idProduct, t);
    }
    for (const c of Object.values(cards)) if (trend.has(c.cm)) price.set(c.id, trend.get(c.cm));
  }
  const pk = {};
  const notes = [];
  for (const lang of LANGS) {
    try {
      const sets = await getJson(`${TCGDEX}/${lang}/sets`);
      const order = new Map(sets.map((s, i) => [s.id, i]));
      const { lists, failed, names } = await tcgdexLists(lang);
      if (failed > names * MAX_FAILED && previous?.pk?.[lang]) {
        pk[lang] = previous.pk[lang];
        notes.push(`${lang} come pubblicato (${failed} illustratori non letti su ${names})`);
        continue;
      }
      pk[lang] = buildSection(lists, { order, price: lang === "en" ? price : new Map() });
      const count = pk[lang].c.reduce((n, s) => n + (s ? s.split(" ").length : 0), 0);
      notes.push(`${lang} ${pk[lang].n.length} illustratori e ${count} carte${failed ? ` (${failed} non letti)` : ""}`);
    } catch (e) {
      if (previous?.pk?.[lang]) pk[lang] = previous.pk[lang];
      notes.push(`${lang} non letto${previous?.pk?.[lang] ? ", come pubblicato" : ""} (${e.message.slice(0, 60)})`);
    }
  }
  if (!pk.en?.n?.length) throw new Error("nessun illustratore in inglese: file non scritto");
  let lc = previous?.lc ?? null;
  const catalog = await readJson(lorcanaFile);
  if (catalog) {
    try {
      const s = lorcanaSection(catalog, await getJson(LORCANA_JSON));
      if (s.n.length) lc = { n: s.n, c: s.c };
      notes.push(`Lorcana ${s.n.length} illustratori, ${s.matched} carte su ${s.total}`);
    } catch (e) {
      notes.push(`Lorcana non letto (${e.message.slice(0, 60)})`);
    }
  }
  await fs.writeFile(out, JSON.stringify({ v: 1, updated: new Date().toISOString(), pk, ...(lc ? { lc } : {}) }));
  console.log(`Illustratori: ${notes.join("; ")}`);
}
