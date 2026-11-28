// Stampe dei giochi CardTrader nei titoli eBay (10 novembre 2026). In One Piece, Dragon Ball, Lorcana e Yu-Gi-Oh! più stampe
// hanno lo stesso nome e lo stesso numero (carta base, Alternate Art, Manga, SP, Serial, Pre-Release, premi dei tornei; in
// Yu-Gi-Oh! le rarità e le ristampe): la ricerca eBay è la stessa per tutte e prima avevano tutte lo stesso prezzo ("Shanks
// OP01-120 Limited Serial Numbered", 15.899 € su CardTrader, aveva 7,99 € su 37 inserzioni: quelle della carta base).
//
// Regola: ogni stampa ha i suoi contrassegni, letti dalla versione CardTrader (campo `v`) e dalla rarità (`r`) con la stessa
// tabella con cui si leggono i titoli ([MARKERS], con le parole italiane in cui eBay traduce i titoli: "Arte Alternativa",
// "Serializzato", "Tappetino"). Un titolo vale per una stampa solo se dice gli stessi contrassegni: la stampa speciale accetta
// solo i titoli con le sue parole, la carta base scarta i titoli che ne hanno. Meglio nessun prezzo che quello di un'altra
// stampa: una versione che la tabella non sa leggere ("Dash Pack", "Dragon Ball Pattern") non prende nessun titolo.

import { norm, compact } from "../../supabase/functions/variant-photo/rules.js";

/**
 * Numero come lo scrive chi vende: senza le lettere che CardTrader aggiunge per la stampa ("OP07-051a" Alternate Art,
 * "RP01-096sec" Secret Rare, "E-128g" Gold, "P-037-foil"). Con le lettere la ricerca eBay non trovava nulla.
 */
export const baseNumber = (num) => {
  const n = String(num ?? "").trim();
  return /^(?:[A-Z0-9]+-)?[0-9]+/i.exec(n)?.[0] ?? n;
};

/** Parole separate da uno spazio: senza accenti, minuscole, senza punteggiatura ("Pre-Release" = "pre release"). */
const words = (s) => norm(s).replace(/[^a-z0-9']+/g, " ").trim();

/**
 * Contrassegni di stampa: [chiave, tipo, come è scritto nella versione CardTrader, parole in più dei titoli eBay].
 * Tipi: h = dice una stampa diversa (deve coincidere); s = parola generica di premio o promo (la carta base la scarta, le
 * stampe che hanno solo quella ne vogliono almeno una); r = rarità e colori, solo nei giochi dove la stessa carta esce in più
 * rarità con lo stesso numero (Yu-Gi-Oh!); x = ristampa; o = solo nei titoli, cose che nessun catalogo ha (firmate, "V.2").
 * L'ordine conta: ogni contrassegno toglie le sue parole dal testo ("super pre release" prima di "pre release" e "super rare").
 */
const MARKERS = [
  ["altro", "o", null, "\\bv ?[2-9]\\b|\\bversion [2-9]\\b|\\bsigned\\b|\\bfirmat[oa]\\b|\\bautograf\\w+|\\bmiscut\\b"],
  ["reprint", "x", "\\breprint\\b", "\\bristampa\\b"],
  ["serial", "h", "\\bserial\\w*|\\bnumbered\\b", "\\bnumerat[aoie]\\b"],
  ["manga", "h", "\\bmanga\\b", "\\bcomic\\b|\\bfumett\\w+"],
  ["superpre", "h", "\\bsuper pre ?release\\b", null],
  ["pre", "h", "\\bpre ?release\\b", "\\bpre ?rilascio\\b"],
  ["alt", "h", "\\balt(ernate|ernative)? art(work)?\\b|\\bparallel\\b", "\\balternativ[ae] art\\b|\\barte alternativa\\b|\\baa\\b|\\bparallel[aoe]\\b|\\b(sec|sr|uc|r|c|l) p\\b"],
  ["sp", "h", "\\bspecial (leader )?rare\\b|\\bspr?\\b", "\\bslr\\b|\\brara speciale\\b|\\bspecial card\\b"],
  ["fullart", "h", "\\bfull art\\b", "\\bfa\\b"],
  ["extended", "h", "\\bextended art\\b", "\\barte estesa\\b"],
  ["textured", "h", "\\btextured\\b", "\\btextur\\w+"],
  ["jolly", "h", "\\bjolly roger\\b", null],
  ["pirate", "h", "\\bpirate foil\\b", "\\bfoil pirata\\b"],
  ["trare", "h", "\\btreasure rare\\b", "\\btr\\b|\\brara tesoro\\b"],
  ["tcup", "h", "\\btreasure cup\\b", "\\bcoppa del tesoro\\b"],
  ["anniv", "h", "\\banniversary\\b", "\\banniversari[oa]\\b|\\banniv\\b|\\banv\\b"],
  ["champ", "h", "\\bchampionships?\\b", "\\bcampionat[oi]\\b"],
  ["finals", "h", "\\bfinals?\\b", "\\bfinal[ei]\\b"],
  ["finalist", "h", "\\bfinalist\\b", "\\bfinalist[ai]\\b"],
  ["winner", "h", "\\bwinner\\b", "\\bvincitor[ei]\\b|\\bvincitrice\\b"],
  ["judge", "h", "\\bjudge\\b", "\\bgiudice\\b"],
  ["flagship", "h", "\\bflagship\\b", "\\bammiraglia\\b"],
  ["playmat", "h", "\\bplaymat\\b", "\\btappetino\\b"],
  ["limitedpack", "h", "\\blimited pack\\b", "\\bconfezione limitata\\b|\\bpacchetto limitato\\b"],
  ["gold", "h", "\\bgold(en)?\\b", "\\boro\\b|\\bdorat[oa]\\b"],
  ["silver", "h", "\\bsilver\\b", "\\bargent[oa]\\b|\\bargentat[oa]\\b"],
  ["rainbow", "h", "\\brainbow\\b", "\\barcobaleno\\b"],
  ["wanted", "h", "\\bwanted\\b", null],
  // Colori: "Red Manga Panel Alternate Art" (5.500 €) non è la "Manga Panel Alternate Art" (800 €); in Yu-Gi-Oh! le rare colorate.
  ["blue", "h", "\\bblue\\b", "\\bblu\\b"],
  ["green", "h", "\\bgreen\\b", "\\bverde\\b"],
  ["purple", "h", "\\bpurple\\b", "\\bviola\\b"],
  ["red", "h", "\\bred\\b", "\\bross[oa]\\b"],
  ["bronze", "h", "\\bbronze\\b", "\\bbronzo\\b"],
  ["promo", "s", "\\bpromo\\w*", null],
  ["prize", "s", "\\bprize\\b", "\\bpremi[oa]\\b"],
  ["event", "s", "\\bevent\\b", "\\bevent[oi]\\b"],
  ["tournament", "s", "\\btournaments?\\b", "\\btorne[oi]\\b"],
  ["store", "s", "\\b(store|shop)\\b", "\\bnegozio\\b"],
  ["regional", "s", "\\bregionals?\\b", "\\bregional[ei]\\b"],
  ["stamp", "s", "\\bstamp(ed)?\\b", "\\btimbr\\w+"],
  ["top", "s", "\\btop (\\d+|player|prize|cut)\\b", null],
  ["qcr", "r", "\\bquarter century( secret)?( rare)?\\b", "\\bqcs?r\\b|\\bquarto di secolo\\b"],
  ["platinum", "r", "\\bplatinum( secret)?( rare)?\\b", "\\b(rara )?(segreta )?platino\\b"],
  ["prismatic", "r", "\\bprismatic\\b", "\\bprismatic[ao]\\b|\\bpser\\b"],
  ["starlight", "r", "\\bstarlight( rare)?\\b", "\\bstlr\\b"],
  ["ghost", "r", "\\bghost( rare)?\\b", "\\bfantasma\\b"],
  ["collectors", "r", "\\bcollector'?s?( rare)+", "\\bcollector'?s? rar[ae]\\b"],
  ["ultimate", "r", "\\bultimate( rare)?\\b", "\\b(rara )?ultimate( rara)?\\b|\\butr\\b"],
  ["starfoil", "r", "\\bstarfoil( rare)?\\b", null],
  ["shatterfoil", "r", "\\bshatterfoil( rare)?\\b", null],
  ["mosaic", "r", "\\bmosaic( rare)?\\b", "\\bmosaico\\b"],
  ["duelterminal", "r", "\\bduel terminal\\b", null],
  ["secret", "r", "\\bsecret( rare)?\\b", "\\b(rara )?segret[ao]( rara)?\\b|\\bsecret rara\\b|\\bscr\\b|\\bsec\\b"],
  ["ultra", "r", "\\bultra( rare)?\\b", "\\b(rara )?ultra( rara)?\\b|\\bur\\b"],
  ["super", "r", "\\bsuper( rare)?\\b", "\\b(rara )?super( rara)?\\b|\\bsr\\b"],
  ["common", "r", "\\bcommon\\b", "\\bcomun[ei]\\b"],
  ["rare", "r", "\\brare\\b", "\\brar[ae]\\b"],
].map(([key, kind, cat, extra]) => ({
  key,
  kind,
  cat: cat ? new RegExp(cat, "g") : null,
  // Nei titoli valgono le parole del catalogo e quelle in più: così un titolo scritto come il catalogo ha gli stessi contrassegni.
  title: new RegExp([cat, extra].filter(Boolean).join("|"), "g"),
}));

/** Parole della versione che non dicono una stampa: rarità (dove non distinguono), foil, correzioni del testo. */
const NOISE = new Set([
  "rare", "common", "uncommon", "secret", "super", "ultra", "special", "leader", "don", "foil", "non", "holo", "holographic",
  "card", "cards", "version", "ver", "vol", "volume", "pack", "set", "edition", "the", "for", "and", "with", "next", "errata",
  "misprint", "missing", "fixed", "text", "incorrect", "symbol", "pen", "artist", "name", "pre", "art", "asia", "asian", "japan",
  "release", "token",
]);

/** Contrassegni di [text] (già a parole): { h, s, x, o, rest }. [side] 0 = versione del catalogo, 1 = titolo eBay. */
function scan(text, side, rarity) {
  let t = ` ${text} `;
  const h = new Set();
  const s = new Set();
  const r = new Set();
  let x = false;
  let o = false;
  for (const m of MARKERS) {
    if (m.kind === "r" && !rarity) continue;
    const re = side ? m.title : m.cat;
    if (!re) continue;
    re.lastIndex = 0;
    if (!re.test(t)) continue;
    re.lastIndex = 0;
    t = t.replace(re, " ").replace(/\s+/g, " ");
    if (m.kind === "h") h.add(m.key);
    else if (m.kind === "s") s.add(m.key);
    else if (m.kind === "r") r.add(m.key);
    else if (m.kind === "x") x = true;
    else o = true;
  }
  // "Rare" da sola è la rarità Rara; accanto a un altro contrassegno ("Gold Rare", "Rara Segreta") è solo una parola.
  if (r.has("rare") && (r.size > 1 || h.size > 0)) r.delete("rare");
  return { h, s, r, x, o, rest: t.trim() };
}

/** Numeri scritti in un testo a parole, senza zeri davanti ("vol 05" = 5, "3rd" = 3, "25 26" = 25 e 26). */
const numbersOf = (text) => new Set((text.match(/\d+/g) ?? []).map((n) => String(Number(n))));

/** Contrassegni di una carta del catalogo: versione e rarità CardTrader. */
function catalogSig(c, rarity) {
  // "©2020" è la ristampa recente di un set vecchio (Yu-Gi-Oh!), "©1996" la stampa originale; il testo tra virgolette è
  // quello corretto o sbagliato delle carte errata.
  const v = String(c.v ?? "").replace(/"[^"]*"/g, " ").replace(/©\s*(\d{4})/g, (_, y) => (Number(y) >= 2020 ? " reprint " : " "));
  const text = words(`${v} | ${c.r ?? ""}`);
  const f = scan(text, 0, rarity);
  const left = f.rest.split(" ").filter((w) => /^[a-z']{3,}$/.test(w) && !NOISE.has(w));
  // Parole che la tabella non conosce senza un contrassegno che dica la stampa ("Dash Pack", "Shonen Jump Promo": "promo"
  // da solo lo dicono i titoli di ogni promo): una stampa che non si sa riconoscere nei titoli. Così anche un numero con la
  // lettera della stampa senza parole ("ST02-003p" senza versione).
  const lettered = baseNumber(c.num) !== String(c.num ?? "").trim() && !String(c.v ?? "").trim();
  const unknown = f.h.size === 0 && f.r.size === 0 && (left.length > 0 || (lettered && f.s.size === 0 && !f.x));
  return { h: [...f.h].sort(), s: [...f.s].sort(), r: [...f.r].sort(), x: f.x, unknown, nums: [...numbersOf(words(v))] };
}

/** Il nome di un set come sta nei titoli: senza il codice davanti ("OP-01: Romance Dawn") e le parentesi, anche accorciato. */
function setPhrases(name) {
  const w = words(String(name ?? "").replace(/^[^:]{1,14}:\s*/, "").replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
  const out = [];
  for (let n = w.length; n >= 2; n--) out.push(w.slice(0, n).join(" "));
  return out;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Regole dei titoli per le carte di [cards] ({id, n, num, v, r, s}) che dividono nome e numero con altre stampe: Map id ->
 * regola ({u} = nessun titolo; altrimenti h/s contrassegni, x ristampa, r rarità da leggere, e parole generiche esclusive, n
 * numeri che il titolo deve avere, strip nomi dei set da non leggere come contrassegni). Le carte con una stampa sola non ci
 * sono: per loro valgono tutti i titoli. [rarity]: nel gioco la stessa carta esce in più rarità con lo stesso numero.
 */
export function printRules(cards, sets = [], { rarity = false } = {}) {
  const setName = new Map(sets.map((s) => [s.id, s.name ?? ""]));
  const groups = new Map();
  for (const c of cards) {
    const k = `${compact(c.n)}|${baseNumber(c.num).toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sig = g.map((c) => catalogSig(c, rarity));
    // Rarità uguale per tutte le stampe del numero: non distingue nulla, e i titoli che non la dicono valgono lo stesso.
    const known = sig.filter((s) => !s.unknown);
    const readRarity = rarity && known.some((s) => !same(s.r, known[0].r));
    for (const s of sig) s.hard = readRarity ? [...s.h, ...s.r].sort() : s.h;
    // I nomi dei set delle stampe normali non sono contrassegni ("Manga Booster 01", "25th Anniversary Rarity Collection").
    const strip = [...new Set(g.flatMap((c, i) => (!sig[i].unknown && !sig[i].h.length && !sig[i].s.length ? setPhrases(setName.get(c.s)) : [])))]
      .sort((a, b) => b.length - a.length);
    g.forEach((c, i) => {
      const s = sig[i];
      const twins = sig.filter((o) => !o.unknown && same(o.hard, s.hard) && same(o.s, s.s));
      // Tra l'originale e la sua ristampa i titoli non dicono quasi mai quale: vanno alla ristampa (le inserzioni più
      // economiche sono le sue), l'originale resta senza ("Sangan RP01-036" del 2008 a 106 €, la ristampa 2024 a 10 €).
      if (s.unknown || (!s.x && twins.some((o) => o.x))) {
        out.set(c.id, { u: 1 });
        return;
      }
      const pr = {};
      if (s.hard.length) pr.h = s.hard.join("+");
      if (s.s.length) pr.s = s.s.join("+");
      if (s.x) pr.x = 1;
      if (readRarity) pr.r = 1;
      // Stessi contrassegni forti e parole generiche diverse ("Ultra Rare" e "Ultra Rare | OTS Stamp"): contano anche quelle.
      if (s.hard.length && sig.some((o) => !o.unknown && same(o.hard, s.hard) && !same(o.s, s.s))) pr.e = 1;
      // Stessi contrassegni e numeri diversi ("Championship 2023" e "Championship 25-26"): il titolo deve dire i suoi.
      const alike = twins.filter((o) => o.x === s.x);
      if (alike.length > 1) {
        const need = s.nums.filter((n) => !alike.every((o) => o.nums.includes(n)));
        if (need.length) pr.n = need;
      }
      if (strip.length) pr.strip = strip;
      out.set(c.id, pr);
    });
  }
  return out;
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Il titolo senza il numero, i nomi dei set normali e le parole del nome della carta ("Judge", "Gold Frieza" non sono stampe). */
function cleanTitle(title, p, strip = []) {
  // La stellina dopo la rarità è la stampa parallela nei titoli dei venditori giapponesi ("SR*", "R☆", "UC★").
  const starred = String(title).replace(/\b(sec|sr|uc|r|c|l)[☆★*](?![☆★*])/gi, "$1 parallel ");
  let t = ` ${words(starred)} `;
  const cut = (phrase) => {
    if (phrase) t = t.replace(new RegExp(`(?<= )${esc(phrase)}(?= )`, "g"), " ").replace(/\s+/g, " ");
  };
  cut(words(p.number));
  for (const s of strip) cut(s);
  for (const w of words(p.name).split(" ")) if (w.length >= 2) cut(w);
  return t.trim();
}

/** Il titolo [title] è della stampa del prodotto [p] (regola `p.pr` di [printRules]); senza regola valgono tutti i titoli. */
export function printOk(title, p) {
  const pr = p.pr;
  if (!pr) return true;
  if (pr.u) return false;
  const t = cleanTitle(title, p, pr.strip);
  const f = scan(t, 1, pr.r === 1);
  if (f.o || (f.x && !pr.x)) return false;
  const hard = new Set([...f.h, ...f.r]);
  const H = pr.h ? pr.h.split("+") : [];
  const S = pr.s ? pr.s.split("+") : [];
  if (hard.size !== H.length || !H.every((k) => hard.has(k))) return false;
  if (!H.length || pr.e) {
    if (S.length ? !S.some((k) => f.s.has(k)) : f.s.size > 0) return false;
  }
  if (pr.n) {
    const nums = numbersOf(t);
    if (!pr.n.every((n) => nums.has(n))) return false;
  }
  return true;
}
