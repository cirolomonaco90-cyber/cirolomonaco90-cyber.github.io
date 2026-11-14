// Foto ufficiali Konami dei sigillati Yu-Gi-Oh! OCG giapponesi (7 novembre 2026, suggerito dalla sessione delle foto Yu-Gi-Oh!:
// "le fonti Konami si possono automatizzare per i prodotti nuovi"). L'elenco dei prodotti dal 2018 sta in un oggetto JS della
// pagina https://www.yugioh-card.com/japan/products/ (p[n]={"id":"cg1830","title":...,"thumbnail":...}); le foto in
// https://img.yugioh-card.com/japan/products/package/<cg>.png (box e busta), <cg>-box.png (solo box), <cg>-pack.png (busta).
// Si abbinano solo i titoli scritti in lettere latine uguali al nome Cardmarket ("PREMIUM PACK 2021" = "Premium Pack 2021
// Booster"): i titoli giapponesi restano per la ricerca a mano. Konami non dà le foto ad altri siti (CORS solo per
// www.yugioh-card.com), quindi il job le copia nello spazio file "dati" (immagini/sealed/yugioh/konami-auto-*), come le altre
// fonti; il risultato resta nella cache delle foto eBay (campo "konami") e la parte "yugioh" del job lo applica.
import { productKind } from "./sealed.js";

export const KONAMI_LIST = "https://www.yugioh-card.com/japan/products/";
export const KONAMI_IMG = "https://img.yugioh-card.com/japan/products/";
const UA = { "User-Agent": "CollectorOne/1.0 (https://collectorone.app; foto dei prodotti sigillati)" };
const RETRY_DAYS = 30;

/** Prodotti dell'elenco Konami: [{id: "cg1721", title, thumbnail}]. */
export function parseKonamiList(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/p\[\d+\]=(\{[^}]*\})/g)) {
    try {
      const p = JSON.parse(m[1].replace(/'/g, '"'));
      if (p.id && p.title) out.push({ id: p.id, title: p.title, thumbnail: p.thumbnail ?? "" });
    } catch {
      // riga illeggibile: si salta
    }
  }
  return out;
}

const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
  .filter((w) => w && !["the", "of", "yu", "gi", "oh"].includes(w)).join(" ");

/** Il nome Cardmarket senza lingua e senza il tipo in fondo ("Secret Shiny Box Booster" -> "secret shiny box"). */
export function konamiKey(name) {
  return norm(String(name ?? "").replace(/\((japanese|ocg)\)/gi, " ").replace(/\b(booster box|booster|display)\s*$/i, ""));
}

/** Il prodotto Konami con lo stesso titolo; null se nessuno o più di uno. */
export function matchKonami(name, list) {
  const key = konamiKey(name);
  if (!key || !/[a-z]/.test(key)) return null;
  const hits = list.filter((p) => norm(p.title) === key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Foto da provare, in ordine. Box: il box da solo, poi la foto del prodotto (box e busta). Busta: solo la busta ("<cg>-pack.png"),
 * perché la foto del prodotto è quasi sempre il box ("Premium Pack 2021", "Secret Shiny Box": provato il 7 novembre 2026). Altri
 * prodotti (mazzi, set, tin): la foto del prodotto. Mai la miniatura dell'elenco (120 px, a volte il box e a volte la busta).
 */
export function konamiImages(product, name) {
  const kind = productKind(name);
  const files = kind === "box" ? [`${product.id}-box.png`, `${product.id}.png`] : kind === "booster" ? [`${product.id}-pack.png`] : [`${product.id}.png`];
  return files.map((f) => `${KONAMI_IMG}package/${f}`);
}

const day = (d) => d.toISOString().slice(0, 10);

/**
 * Cerca le foto Konami dei sigillati giapponesi di [data] (catalogo yugioh-sealed) senza foto o con quella di eBay e le scrive in
 * cache.konami ({chiave: [foto nel nostro spazio | null, giorno]}). [isJapanese](p): prodotto giapponese. [fetchText]/[fetchImage]
 * leggono il web, [upload](percorso, byte) copia la foto e restituisce l'indirizzo pubblico. Restituisce quante ne ha trovate.
 */
export async function findKonamiPhotos(data, cache, { isJapanese, fetchText, fetchImage, upload, now = new Date(), log = [] }) {
  cache.konami ??= {};
  const todo = data.p.filter((p) => (!p.img || String(p.img).startsWith("https://i.ebayimg.com/")) && isJapanese(p))
    .filter((p) => {
      const c = cache.konami[`yugioh-sealed:${p.id}`];
      return !c || (!c[0] && (now - new Date(c[1])) / 86400000 >= RETRY_DAYS);
    });
  if (!todo.length) return 0;
  let list;
  try {
    list = parseKonamiList(await fetchText(KONAMI_LIST));
  } catch (err) {
    log.push(`! elenco prodotti Konami: ${err.message}`);
    return 0;
  }
  let found = 0;
  for (const p of todo) {
    const key = `yugioh-sealed:${p.id}`;
    const k = matchKonami(p.n, list);
    let url = null;
    if (k) {
      for (const src of konamiImages(k, p.n)) {
        try {
          const bytes = await fetchImage(src);
          if (!bytes) continue;
          url = await upload(`immagini/sealed/yugioh/konami-auto-${src.split("/").pop()}`, bytes);
          break;
        } catch (err) {
          log.push(`! foto Konami ${src}: ${err.message}`);
        }
      }
    }
    cache.konami[key] = [url, day(now)];
    if (url) found++;
  }
  log.push(`Foto Konami dei sigillati Yu-Gi-Oh! giapponesi: ${found} nuove su ${todo.length} provati (${list.length} prodotti Konami)`);
  return found;
}

/** Mette in [data] le foto Konami già trovate (al posto di nessuna foto o di quella di eBay). Restituisce quante. */
export function applyKonamiPhotos(data, cache) {
  let n = 0;
  for (const p of data.p) {
    const img = cache.konami?.[`yugioh-sealed:${p.id}`]?.[0];
    if (img && (!p.img || String(p.img).startsWith("https://i.ebayimg.com/"))) {
      p.img = img;
      n++;
    }
  }
  return n;
}

/** Lettura del web e copia nello spazio file "dati" di Supabase (chiave segreta del job). */
export function konamiIo(secretKey) {
  const supa = "https://lafgthxgasunkxrgwqng.supabase.co";
  return {
    fetchText: async (url) => {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    },
    fetchImage: async (url) => {
      const r = await fetch(url, { headers: UA });
      if (!r.ok || !/^image\//.test(r.headers.get("content-type") ?? "")) return null;
      return Buffer.from(await r.arrayBuffer());
    },
    upload: async (path, bytes) => {
      const r = await fetch(`${supa}/storage/v1/object/dati/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, apikey: secretKey, "x-upsert": "true", "Content-Type": /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png" },
        body: bytes,
      });
      if (!r.ok) throw new Error(`caricamento HTTP ${r.status}`);
      return `${supa}/storage/v1/object/public/dati/${path}`;
    },
  };
}
