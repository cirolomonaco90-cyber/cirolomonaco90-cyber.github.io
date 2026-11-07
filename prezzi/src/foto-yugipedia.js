// Foto dei sigillati Yu-Gi-Oh! che né CardTrader né TCGplayer hanno (buste e box OCG giapponesi e coreani, mazzi, Rush Duel,
// prodotti vecchi): l'immagine della confezione dalla pagina del set su Yugipedia, scelta per tipo (busta, box, mazzo, tin) e
// per lingua (EN/NA/EU, JP, KR). 0.9.160, richiesto dall'utente il 7 novembre 2026: "eBay deve essere l'ultima spiaggia".
// Yugipedia, a differenza di Bulbapedia, risponde ai programmi (API MediaWiki).
//
// Uso (sul Mac, a mano; le foto si copiano poi nello spazio file "dati" e si scrivono in prezzi/dati/foto-sealed.json, che il
// job applica ogni notte prima di eBay):
//   node prezzi/src/foto-yugipedia.js <yugioh-sealed.json> <uscita.json>
// <uscita.json>: {"yugioh-sealed:<id>": {file, url, page, kind}} per i prodotti trovati.
import fs from "node:fs/promises";

const API = "https://yugipedia.com/api.php";
const UA = "CollectorOne/1.0 (https://collectorone.app; foto dei prodotti sigillati)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Codici delle regioni nei nomi dei file di Yugipedia ("LOB-BoosterEN.png", "NECH-BoosterJP.png"), per lingua del prodotto. */
export const REGIONS = { en: ["EN", "NA", "EU", "AE"], ja: ["JP"], ko: ["KR"] };

/** Nome del set e tipo di confezione dal nome Cardmarket ("The New Challengers (Japanese) Booster Box" -> set, "box"). */
export function parseProduct(name) {
  let n = String(name ?? "").replace(/\s*\((Japanese|Korean|OCG)\)\s*/gi, " ").replace(/\s+/g, " ").trim();
  let kind = "other";
  if (/\s(booster box|display)$/i.test(n)) {
    kind = "box";
    n = n.replace(/\s(booster box|display)$/i, "");
  } else if (/\sbooster$/i.test(n)) {
    kind = "booster";
    n = n.replace(/\sbooster$/i, "");
  } else if (/\s2-pack set$/i.test(n)) {
    kind = "booster";
    n = n.replace(/\s2-pack set$/i, "");
  } else if (/\b(structure|starter|half|duelist) deck\b|\bdeck\b/i.test(n)) {
    kind = "deck";
  } else if (/\btins?\b/i.test(n)) {
    kind = "tin";
  } else if (/\bbox\b/i.test(n)) {
    kind = "box";
  }
  return { set: n.replace(/:\s*special edition$/i, "").trim(), kind };
}

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["the", "of", "a", "and", "yu", "gi", "oh", "ocg", "tcg"]);
const words = (s) => norm(s).split(" ").filter((w) => w && !STOP.has(w));

/**
 * Il file della confezione tra le immagini della pagina: tipo e regione nel nome ("NECH-BoxEN.jpg", "SDSH-DeckEN.png"), solo i
 * file col codice del set davanti (le carte hanno il loro nome davanti), niente loghi, poster, promo, buste bonus (salvo che il
 * prodotto lo dica) né edizioni del 25° anniversario per i prodotti normali e viceversa.
 */
export function pickFile(files, kind, lang, productName = "") {
  // Prodotti solo OCG che Cardmarket elenca col nome inglese e senza lingua ("Structure Deck: Yugi Volume 2", "Gold Pack 2016"):
  // se la pagina non ha la confezione inglese, quella giapponese o coreana è il prodotto stesso. Non il contrario: la busta
  // giapponese di un set uscito anche in inglese non prende la foto di quella inglese.
  const regions = lang === "en" || !REGIONS[lang] ? [...REGIONS.en, ...REGIONS.ja, ...REGIONS.ko] : REGIONS[lang];
  const anniversary = /25th anniversary/i.test(productName);
  const bonus = /bonus/i.test(productName);
  const ok = files
    .map((f) => f.replace(/^File:/, ""))
    .filter((f) => /^[A-Z0-9]{2,6}-/.test(f) && /\.(png|jpe?g|webp)$/i.test(f))
    .filter((f) => !/logo|poster|promo|sleeve|playmat|mat-|card|token/i.test(f))
    .filter((f) => anniversary === /25thAnniversary/i.test(f))
    .filter((f) => bonus || !/bonus/i.test(f));
  const patterns = {
    booster: /-Booster(?:Pack)?-?(XX)(?:[-.])/i,
    box: /-(?:Booster)?(?:Box|Display)-?(XX)(?:[-.])/i,
    deck: /-(?:Deck|DeckBox|Box)-?(XX)(?:[-.])/i,
    tin: /-?Tin-?(XX)(?:[-.])/i,
  };
  const order = kind === "other" ? ["box", "deck", "booster"] : [kind];
  for (const k of order) {
    for (const r of regions) {
      const re = new RegExp(patterns[k].source.replace("XX", r), "i");
      const hit = ok.find((f) => re.test(f) && !(k === "booster" && /box|display/i.test(f)));
      if (hit) return hit;
    }
  }
  return null;
}

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) return r.json();
    await sleep(3000 * (i + 1));
  }
  throw new Error(`Yugipedia: ${url}`);
}

/** Pagina del set: il titolo esatto (con i rinvii) o il primo risultato della ricerca che ha tutte le parole del set. */
async function findPage(set) {
  const direct = await api({ action: "query", titles: set, redirects: "1", prop: "images", imlimit: "max" });
  const page = Object.values(direct.query?.pages ?? {})[0];
  if (page && !("missing" in page) && page.images?.length) return { title: page.title, images: page.images.map((i) => i.title) };
  await sleep(300);
  const found = await api({ action: "query", list: "search", srsearch: set, srlimit: "5", srnamespace: "0" });
  const want = words(set);
  for (const hit of found.query?.search ?? []) {
    const have = new Set(words(hit.title));
    if (!want.every((w) => have.has(w))) continue;
    await sleep(300);
    const res = await api({ action: "query", titles: hit.title, prop: "images", imlimit: "max" });
    const p = Object.values(res.query?.pages ?? {})[0];
    if (p?.images?.length) return { title: p.title, images: p.images.map((i) => i.title) };
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [catalogFile, outFile] = process.argv.slice(2);
  const data = JSON.parse(await fs.readFile(catalogFile, "utf8"));
  const out = {};
  const pages = new Map();
  let tried = 0;
  for (const p of data.p.filter((x) => !x.img)) {
    const { set, kind } = parseProduct(p.n);
    tried++;
    try {
      if (!pages.has(set)) {
        // I prodotti Rush Duel su Yugipedia non hanno "Rush Duel:" davanti e scrivono "Deck Modification Pack" per intero.
        const plain = set.replace(/^rush duel:\s*/i, "").replace(/\bdeck mod pack\b/i, "Deck Modification Pack");
        let page = await findPage(set);
        if (!page && plain !== set) {
          await sleep(300);
          page = await findPage(plain);
        }
        pages.set(set, page);
        await sleep(300);
      }
      const page = pages.get(set);
      if (!page) continue;
      // "(OCG)" e "(Japanese)" nel nome sono la confezione giapponese, "(Korean)" quella coreana, qualunque lingua dica il catalogo.
      const lang = /\((OCG|Japanese)\)/i.test(p.n) ? "ja" : /\(Korean\)/i.test(p.n) ? "ko" : p.l ?? "en";
      const file = pickFile(page.images, kind, lang, p.n);
      if (!file) continue;
      const info = await api({ action: "query", titles: `File:${file}`, prop: "imageinfo", iiprop: "url" });
      const url = Object.values(info.query?.pages ?? {})[0]?.imageinfo?.[0]?.url;
      if (url) out[`yugioh-sealed:${p.id}`] = { file, url, page: page.title, kind, name: p.n };
      await sleep(300);
    } catch (err) {
      console.log(`! ${p.n}: ${err.message}`);
    }
    if (tried % 50 === 0) console.log(`${tried} prodotti, ${Object.keys(out).length} foto`);
  }
  await fs.writeFile(outFile, JSON.stringify(out, null, 1));
  console.log(`Yugipedia: ${Object.keys(out).length} foto su ${tried} prodotti senza foto`);
}
