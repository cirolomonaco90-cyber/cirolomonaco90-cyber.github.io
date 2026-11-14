// Nessun set vuoto nell'app, né oggi né per i set futuri (richiesto dall'utente, 11 novembre 2026): ogni set delle
// lingue asiatiche che TCGdex elenca senza carte (o con meno della metà di quelle ufficiali) prende le carte da
// un'altra fonte, da solo:
//   - giapponese: il gruppo giapponese di TCGplayer (tcgcsv.com, categoria 85: nome inglese, numero, foto, e i prezzi
//     arrivano da tcgplayer-ja.js), scelto dalla tabella controllata a mano [JA_GROUPS] o, per i set nuovi, dalla
//     sigla uguale all'id del set con la stessa data d'uscita;
//   - cinese tradizionale, indonesiano, thailandese: il sito ufficiale asia.pokemon-card.com, letto da
//     prezzi/immagini/asia-ufficiale.py (file carte/v1/asia-ufficiale.json, con le foto copiate in piccolo).
// I set che TCGdex ha vuoti e che il catalogo copre già con CardTrader (ASIA_SETS in asia.js) restano com'erano.
// Dal sito ufficiale arrivano anche le foto dei set che TCGdex ha con le carte ma senza immagini.
// Quello che resta vuoto si scrive nel registro e nel campo `vuoti` del catalogo: va guardato e sistemato.
//
//   node prezzi/src/asia-vuoti.js <asia.json pubblicato> <uscita.json>     (ogni notte, senza CardTrader)
// asia.js chiama [fillEmpty] alla fine di ogni suo giro (il lunedì).
import fs from "node:fs/promises";
import { fetchRetry } from "./rete.js";
import { DATI } from "./dati.js";

const TCGCSV = "https://tcgcsv.com/tcgplayer/85";
const TCGDEX = "https://api.tcgdex.net/v2";
const OFFICIAL = `${DATI}/carte/v1/asia-ufficiale.json`;
const HEADERS = { "User-Agent": "CollectorOne-prezzi (https://collectorone.app/)" };

export const ASIA_LANGS = ["ja", "ko", "zh-tw", "zh-cn", "id", "th"];
/** Lingue lette dal sito ufficiale asiatico. */
export const OFFICIAL_LANGS = ["zh-tw", "id", "th"];

/**
 * Set giapponesi di TCGdex -> gruppi giapponesi di TCGplayer, controllati a mano l'11 novembre 2026 (nome, data
 * d'uscita, numero di carte). Servono dove la sigla non basta: "BW1" vale per Black e per White Collection.
 * Fino al 12 novembre 2026 su TCGdex BW3a era sia Psycho Drive sia Hail Blizzard, e BW8a sia Spiral Force sia Thunder
 * Knuckle (due set con lo stesso id); la notte del 13 TCGdex li ha divisi in BW3a/BW3b e BW8a/BW8b, coi secondi vuoti:
 * la parte "asia" si è fermata con "SET ANCORA VUOTI: BW3b, BW8b" finché la tabella non li ha avuti.
 * tcgplayer-ja.js usa la stessa tabella per i prezzi e le foto.
 */
export const JA_GROUPS = {
  BW1a: [23893], // Black Collection
  BW1b: [23894], // White Collection
  BW2: [23895], // Red Collection
  BW3a: [23896], // Psycho Drive
  BW3b: [23897], // Hail Blizzard
  BW4: [23898], // Dark Rush
  BW5a: [23899], // Dragon Blast
  BW5b: [23900], // Dragon Blade
  BW6a: [23901], // Freeze Bolt
  BW6b: [23902], // Cold Flare
  BW7: [23903], // Plasma Gale
  BW8a: [23904], // Spiral Force
  BW8b: [23905], // Thunder Knuckle
  BW9: [23906], // Megalo Cannon
  DS: [23910], // Dragon Selection
  SC: [23911], // Shiny Collection
  EBB: [23912], // EX Battle Boost
  SM0: [23674], // Pikachu's New Friends
  WCS23: [23802], // 2023 World Championships Yokohama Deck: Pikachu
};

/** Set di TCG Pocket (solo digitali) e doppioni di «Triplet Beat» che TCGdex mette per errore fuori dal cinese. */
const POCKET = /^(P-[A-Z]|[AB][0-9]+[a-z]?)$/;
export function skipped(id, lang) {
  return POCKET.test(id) || (lang !== "zh-cn" && /^CS/i.test(id));
}

function normCode(s) {
  return String(s ?? "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
}

/** "BW1: White Collection" -> "White Collection". */
export function groupName(name) {
  const s = String(name ?? "");
  return (s.includes(":") ? s.slice(s.indexOf(":") + 1) : s).trim();
}

/**
 * Gruppi TCGplayer di un set giapponese: la tabella a mano, altrimenti l'unico gruppo con la sigla uguale all'id del set
 * e uscito lo stesso giorno (± 3 giorni; senza una delle due date basta la sigla). null se non c'è o non è uno solo.
 */
export function groupsOf(set, groups) {
  const fixed = JA_GROUPS[set.id];
  if (fixed) return groups.filter((g) => fixed.includes(g.groupId)).sort((a, b) => fixed.indexOf(a.groupId) - fixed.indexOf(b.groupId));
  const taken = new Set(Object.values(JA_GROUPS).flat());
  const same = groups.filter((g) => !taken.has(g.groupId) && normCode(g.abbreviation) && normCode(g.abbreviation) === normCode(set.id));
  if (same.length !== 1) return null;
  const a = Date.parse(String(set.releaseDate ?? "").slice(0, 10));
  const b = Date.parse(String(same[0].publishedOn ?? "").slice(0, 10));
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 3 * 86400000) return null;
  return same;
}

/** "Zekrom - 055/053" -> "Zekrom"; "Pokemon Enterprise - 099/093 (Mirror Holofoil)" -> "Pokemon Enterprise (Mirror Holofoil)". */
export function cardName(name) {
  return String(name ?? "").replace(/\s+-\s+\S*\d+\/\S+(?=\s|$)/, "").replace(/\s+/g, " ").trim();
}

/**
 * Righe del catalogo dai prodotti di uno o più gruppi TCGplayer: [numero, nome, "tp:<prodotto>", null, rarità, null × 5].
 * Solo le carte (hanno il numero); numeri ripetuti, anche tra due gruppi, prendono una lettera ("001b").
 */
export function tcgplayerRows(productLists) {
  const rows = [];
  for (const products of productLists) {
    const list = [];
    for (const p of products ?? []) {
      const ext = (n) => p.extendedData?.find((e) => e.name === n)?.value;
      const raw = String(ext("Number") ?? "").trim();
      const num = raw.split("/")[0].trim();
      if (!num || !/\d/.test(num) || !p.productId) continue;
      list.push({ num, name: cardName(p.name), id: p.productId, rarity: ext("Rarity") && ext("Rarity") !== "None" ? ext("Rarity") : null, img: p.imageCount === 0 ? null : `tp:${p.productId}` });
    }
    const key = (n) => parseInt(n.replace(/\D/g, ""), 10) || Number.MAX_SAFE_INTEGER;
    list.sort((a, b) => key(a.num) - key(b.num) || a.num.localeCompare(b.num) || a.id - b.id);
    rows.push(...list);
  }
  const seen = new Map();
  return rows.map((c) => {
    const n = (seen.get(c.num) ?? 0) + 1;
    seen.set(c.num, n);
    const num = n === 1 ? c.num : c.num + String.fromCharCode(96 + Math.min(n, 26));
    return [num, c.name, c.img, null, c.rarity, null, null, null, null, null];
  });
}

/** Quante delle carte ufficiali (numeri da 1 a [official]) hanno una riga: per controllare che il set sia quello. */
export function covered(rows, official) {
  if (!official) return rows.length ? 1 : 0;
  const nums = new Set(rows.map((r) => parseInt(String(r[0]).replace(/\D/g, ""), 10)).filter((n) => n >= 1 && n <= official));
  return nums.size / official;
}

const latin = (s) => !/[^\u0000-ɏ‘-”]/.test(String(s ?? ""));

/**
 * Righe del catalogo dalle carte del sito ufficiale ([numero, nome, file, illustratore]); la foto diventa l'indirizzo
 * intero della copia piccola, l'illustratore va in fondo alla riga. I nomi thailandesi (e cinesi) sono in un altro
 * alfabeto: se lo stesso set esiste in indonesiano ([latinRows], nomi in lettere latine) si prende il nome da lì,
 * stesso numero.
 */
export function officialRows(cards, base, latinRows = null) {
  const byNumber = new Map((latinRows ?? []).map((r) => [r[0], r[1]]));
  const seen = new Map();
  return (cards ?? []).map(([number, name, file, illustrator]) => {
    const n = (seen.get(number) ?? 0) + 1;
    seen.set(number, n);
    const num = n === 1 ? number : number + String.fromCharCode(96 + Math.min(n, 26));
    const shown = !latin(name) && n === 1 && latin(byNumber.get(number)) && byNumber.get(number) ? byNumber.get(number) : name;
    const ill = illustrator && illustrator !== "n/a" ? illustrator : null;
    return [num, shown, file ? base + file : null, null, null, null, null, null, null, null, ill];
  });
}

async function json(url) {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Set di TCGdex nelle lingue asiatiche senza carte (o con meno della metà): `empty` = [{ lang, id, official,
 * releaseDate }]; `full` = "id@lingua" dei set letti che le carte le hanno (solo per quelli una voce messa da un giro
 * prima si può togliere: un set che TCGdex non ha fatto leggere non deve tornare vuoto).
 */
export async function findEmpty({ langs = ASIA_LANGS, get = json } = {}) {
  const empty = [];
  const full = new Set();
  for (const lang of langs) {
    let sets = [];
    try {
      sets = await get(`${TCGDEX}/${lang}/sets`);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const s of sets) {
      if (skipped(s.id, lang) || seen.has(s.id)) continue;
      seen.add(s.id);
      let d = null;
      try {
        d = await get(`${TCGDEX}/${lang}/sets/${encodeURIComponent(s.id)}`);
      } catch {
        continue; // non letto: non si sa se è vuoto
      }
      const cards = d?.cards?.length ?? 0;
      const official = s.cardCount?.official ?? 0;
      if (cards === 0 || cards * 2 < official) empty.push({ lang, id: s.id, official, releaseDate: d?.releaseDate ?? null, cards });
      else full.add(`${s.id}@${lang}`);
    }
  }
  return { empty, full };
}

/**
 * Riempie nel catalogo asiatico [data] (quello di asia.js) i set vuoti [empty]: aggiunge `sets["<id>@<lingua>"]`,
 * le righe in `cards`, il totale e, per i giapponesi, il nome inglese del set. Le voci messe qui da un giro prima
 * (codici "tp-…" e "uff-…") si rifanno da capo. Restituisce le righe del registro.
 * groups = gruppi giapponesi di TCGplayer; products(groupId) = prodotti di un gruppo; official = asia-ufficiale.json.
 */
export async function fillEmpty(data, { empty, groups = [], products, official = null }) {
  const log = [];
  for (const [k, code] of Object.entries(data.sets)) {
    if (/^(tp|uff)-/.test(code)) {
      delete data.sets[k];
      delete data.cards[code];
    }
  }
  data.setEn ??= {};
  data.totals ??= {};
  const has = (id, lang) => {
    const code = data.sets[`${id}@${lang}`] ?? data.sets[id];
    return !!(code && data.cards[code]?.length);
  };
  const left = [];
  let fromTcgplayer = 0;
  let fromOfficial = 0;
  let already = 0;
  for (const set of empty) {
    const { lang, id } = set;
    if (has(id, lang)) {
      already++;
      continue;
    }
    if (lang === "ja") {
      const gs = groupsOf(set, groups);
      if (gs?.length) {
        try {
          const rows = tcgplayerRows(await Promise.all(gs.map((g) => products(g.groupId))));
          // Dalla tabella a mano il set è già controllato; da solo deve avere quasi tutte le carte ufficiali.
          if (rows.length && (JA_GROUPS[id] || covered(rows, set.official) >= 0.8)) {
            const code = `tp-${id}`;
            data.sets[`${id}@ja`] = code;
            data.cards[code] = rows;
            data.setEn[id] = gs.map((g) => groupName(g.name)).join(" / ");
            // Nome inglese -> set, per l'importazione da Collectr (che chiama i set giapponesi col nome inglese), e
            // nomi inglesi delle carte per numero (per quando TCGdex avrà le sue, in giapponese). Quelli che c'erano
            // per questo set venivano da un'espansione CardTrader col codice uguale all'id, che può essere un altro set
            // ("bw1b" = Black Collection, BW1b = White Collection): si rifanno.
            data.names ??= {};
            data.names.ja ??= {};
            for (const [name, set] of Object.entries(data.names.ja)) if (set === id) delete data.names.ja[name];
            // Un nome che porta già a un set preso da CardTrader ("Dragon Blade" = "ct-dragonblade", dove stanno le
            // copie importate finora) resta lì: l'importazione non deve mettere la stessa carta in due set.
            for (const g of gs) if (!String(data.names.ja[groupName(g.name)] ?? "").startsWith("ct-")) data.names.ja[groupName(g.name)] = id;
            data.en ??= {};
            data.en[id] = {};
            for (const [num, name] of rows) {
              if (/[a-z]$/i.test(num)) continue;
              data.en[id][String(num).replace(/^0+(?=\d)/, "").toLowerCase()] ??= name;
            }
            if (set.official) data.totals[`${id}@ja`] = set.official;
            fromTcgplayer++;
            continue;
          }
          log.push(`! ${id} (ja): il gruppo TCGplayer "${gs[0].name}" ha ${rows.length} carte contro ${set.official} ufficiali, non usato`);
        } catch (err) {
          log.push(`! ${id} (ja): ${err.message}`);
        }
      }
    }
    if (OFFICIAL_LANGS.includes(lang)) {
      const cards = official?.sets?.[lang]?.[id];
      if (cards?.length) {
        const latinRows = lang === "id" ? null : official?.sets?.id?.[id];
        const code = `uff-${lang}-${id}`;
        data.sets[`${id}@${lang}`] = code;
        data.cards[code] = officialRows(cards, official.base ?? "", latinRows);
        if (set.official) data.totals[`${id}@${lang}`] = set.official;
        fromOfficial++;
        continue;
      }
    }
    left.push(`${id} (${lang})`);
  }
  // Set che TCGdex ha con le carte ma senza foto (asia-ufficiale.py legge anche quelli): le righe del sito ufficiale
  // danno la foto alle carte con lo stesso numero (l'app la cerca nel catalogo, stesso set e lingua).
  let photos = 0;
  for (const lang of OFFICIAL_LANGS) {
    for (const [id, cards] of Object.entries(official?.sets?.[lang] ?? {})) {
      if (!cards?.length || has(id, lang)) continue;
      const code = `uff-${lang}-${id}`;
      data.sets[`${id}@${lang}`] = code;
      data.cards[code] = officialRows(cards, official.base ?? "", lang === "id" ? null : official?.sets?.id?.[id]);
      photos++;
    }
  }
  if (photos) log.push(`Set con le carte ma senza foto su TCGdex, foto dal sito ufficiale: ${photos}`);
  // Nome inglese anche per i set della tabella che TCGdex ha già con le carte (BW8a: due set con lo stesso id).
  for (const id of Object.keys(JA_GROUPS)) {
    const gs = groupsOf({ id }, groups);
    if (gs?.length === JA_GROUPS[id].length) data.setEn[id] = gs.map((g) => groupName(g.name)).join(" / ");
  }
  data.vuoti = left;
  log.push(`Set vuoti su TCGdex: ${empty.length}; già nel catalogo ${already}, riempiti da TCGplayer ${fromTcgplayer}, dal sito ufficiale ${fromOfficial}`);
  log.push(left.length ? `! SET ANCORA VUOTI, da sistemare: ${left.join(", ")}` : "Nessun set vuoto senza carte.");
  return log;
}

/** Tutto insieme, con le fonti vere: per asia.js e per il giro di ogni notte. */
export async function fillEmptyFromSources(data, { find = findEmpty, get = json } = {}) {
  const log = [];
  const { empty, full } = await find();
  let groups = [];
  try {
    groups = (await get(`${TCGCSV}/groups`)).results ?? [];
  } catch (err) {
    log.push(`! gruppi TCGplayer non letti: ${err.message}`);
  }
  let official = null;
  try {
    official = await get(OFFICIAL);
  } catch (err) {
    log.push(`! carte del sito ufficiale asiatico non lette: ${err.message}`);
  }
  const before = structuredClone({ sets: data.sets, cards: data.cards });
  const out = await fillEmpty(data, { empty, groups, products: async (g) => (await get(`${TCGCSV}/${g}/products`)).results ?? [], official });
  // Una voce messa da un giro prima sparisce solo se TCGdex ora ha le carte di quel set: se una fonte o TCGdex non si
  // sono fatti leggere resta com'era (meglio di un set tornato vuoto).
  let kept = 0;
  for (const [k, code] of Object.entries(before.sets)) {
    if (!/^(tp|uff)-/.test(code) || data.sets[k]) continue;
    // Giapponesi da TCGplayer: via solo quando TCGdex ha le carte. Sito ufficiale: il suo file dice tutto (anche i
    // set con le sole foto); resta com'era solo se il file non si è letto.
    if (/^tp-/.test(code) ? full.has(k) : official !== null) continue;
    data.sets[k] = code;
    data.cards[code] = before.cards[code];
    const [id, lang] = k.split("@");
    data.vuoti = (data.vuoti ?? []).filter((x) => x !== `${id} (${lang})`);
    kept++;
  }
  if (kept) log.push(`Set tenuti dal giro prima (fonte non letta): ${kept}`);
  return [...log, ...out.filter((l) => !/ANCORA VUOTI|Nessun set vuoto/.test(l)), data.vuoti?.length ? `! SET ANCORA VUOTI, da sistemare: ${data.vuoti.join(", ")}` : "Nessun set vuoto senza carte."];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) {
    console.log("uso: node prezzi/src/asia-vuoti.js <asia.json pubblicato> <uscita.json>");
    process.exit(1);
  }
  const data = JSON.parse(await fs.readFile(input, "utf8"));
  const log = await fillEmptyFromSources(data);
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
}
