import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { groups, split, queryOf, buildCatalog, plan, finishOf, gradeOf, setOk, priceOf, REFRESH_DAYS } from "../src/topps.js";

// Elenco vero delle carte (scripts/topps-elenco.py): 12 set, ogni versione una stampa a sé.
const data = JSON.parse(fs.readFileSync(new URL("../dati/topps-pokemon.json", import.meta.url), "utf8"));
const list = groups(data);
const group = (key) => list.find((g) => g.key === key);
const item = (title, price, currency = "USD") => ({ title, price, currency, image: `https://i.ebayimg.com/images/g/x/s-l225.jpg?${title.length}` });
const finishOfId = (id) => data.cards.find((c) => String(c.id) === String(id)).v ?? "Normale";

test("elenco: 12 set, le carte base con le loro versioni, gli id tutti diversi", () => {
  assert.equal(data.sets.length, 12);
  const ids = data.cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // Charizard #6 della serie 1: normale, foil argento, foil arcobaleno; nei Chrome Standard, Spectra, Sparkle, Tekno.
  assert.deepEqual(group("1|Base|6").prints.map((p) => p.v ?? null), [null, "Silver Foil", "Rainbow Foil"]);
  assert.deepEqual(group("6|Base|6").prints.map((p) => p.v ?? null), [null, "Spectra", "Sparkle", "Tekno"]);
  // Le carte speciali (die-cut, adesivi, trasparenti) hanno una versione sola.
  assert.equal(group("2|Clear|PC3").prints.length, 1);
  assert.equal(group("2|Clear|PC3").n, "Charizard");
});

// Titoli veri di eBay USA del 22 novembre 2026 (ricerca "topps pokemon charizard 6").
const charizard = [
  item("1999 Topps Pokemon Charizard #6 TV Animation Series 1 Non Foil Vintage", 13.99),
  item("Charizard #6 Topps Trading Cards Series 1 Pokemon Near Mint", 25),
  item("1999 Topps Pokemon TV Animation Series 1 Charizard #6 Rainbow Holo Foil Rare", 525),
  item("1999 Topps Pokemon TV Series 1 Charizard #6 FOIL - NM", 199),
  item("2000 TOPPS CHROME POKEMON T.V. SPECTRA #6 CHARIZARD PSA 6", 1200),
  item("Charizard #6 (E6) 1999 Topps Pokemon the Movie Edt E6 - Topps Pokemon the Movie", 53),
  item("1999 Topps Pokemon Charizard E6/12 Stage 3 Black Logo Non Holo NM", 29.99),
  item("2000 Topps Pokemon #06 Charizard PC3 PSA 8 Clear Acetate", 200),
  item("1999 Topps Pokemon TV Animation Edition #6 Charizard PSA 9 Mint", 250),
  item("Topps Charizard Charmeleon & Charmander Pokemon Cards 1999 Non Holo Set", 20),
  item("POKEMON TOPPS CHROME SERIES 1 TEKNO CHARIZARD #6 CARD 2000 8\"x10\" Photograph", 14.95),
  item("2000 Charizard #6 NM/LP Topps Chrome Pokemon Card", 400),
];

test("una ricerca divisa per set, versione e voto: niente film, trasparenti, Chrome, set o fotografie nella carta base", () => {
  const r = split(charizard, group("1|Base|6"), { market: "US", usdPerEur: 1.1 });
  const by = Object.fromEntries(Object.entries(r).map(([id, b]) => [finishOfId(id), b]));
  assert.deepEqual(by.Normale.en, [12.72, 22.73]); // dollari / 1,1
  assert.deepEqual(by.Normale["en|g:PSA 9"], [227.27]);
  assert.deepEqual(by["Silver Foil"].en, [180.91]);
  assert.deepEqual(by["Rainbow Foil"].en, [477.27]);
  // Il Chrome Spectra va alla stampa Spectra del Chrome, la copia "NM/LP" (rovinata) fuori, la fotografia fuori.
  const chrome = split(charizard, group("6|Base|6"), { market: "US", usdPerEur: 1.1 });
  const cb = Object.fromEntries(Object.entries(chrome).map(([id, b]) => [finishOfId(id), b]));
  assert.deepEqual(Object.keys(cb), ["Spectra"]);
  assert.deepEqual(cb.Spectra["en|g:PSA 6"], [1090.91]);
  // La E6 del primo film e la trasparente PC3 alle loro carte.
  const e6 = split(charizard, group("4|Evolution|E6"), { market: "US", usdPerEur: 1.1 });
  assert.equal(Object.values(e6).flatMap((b) => b.en ?? []).length, 2);
  const pc3 = split(charizard, group("2|Clear|PC3"), { market: "US", usdPerEur: 1.1 });
  assert.deepEqual(Object.values(pc3)[0]["en|g:PSA 8"], [181.82]);
});

test("su eBay.it valgono solo le lingue europee scritte nel titolo", () => {
  const items = [
    item("Pokemon Topps TV Animation Charizard #6 ITA serie 1", 30, "EUR"),
    item("Pokemon Topps TV Animation Charizard #6 inglese", 40, "EUR"),
    item("Pokemon Topps TV Animation Charizard #6", 50, "EUR"),
    item("Topps Pokemon Glurak #6 TV Animation deutsch", 20, "EUR"),
  ];
  const r = split(items, group("1|Base|6"), { market: "IT", usdPerEur: 1.1 });
  const normal = Object.values(r)[0];
  assert.deepEqual(normal.it, [30]);
  assert.equal(normal.en, undefined);
  // Il nome tedesco (Glurak) non è quello inglese: quell'inserzione resta fuori (meglio senza prezzo che sbagliato).
  assert.equal(normal.de, undefined);
});

test("versioni e voti letti dal titolo", () => {
  assert.equal(finishOf("1999 Topps Pokemon TV2 Pikachu #25 Foil", "foil3"), "Silver Foil");
  assert.equal(finishOf("Topps Pokémon Pikachu TV2 #25 TV Animation RAINBOW FOIL PSA 6", "foil3"), "Rainbow Foil");
  assert.equal(finishOf("1999 Topps Pokemon Charizard E6/12 Stage 3 Black Logo Non Holo NM", "foil3"), null);
  assert.equal(finishOf("2000 TOPPS CHROME POKEMON T.V. SPARKLE #6 CHARIZARD PSA 5", "chrome"), "Sparkle");
  assert.equal(finishOf("2000 Topps Chrome Pokemon Series 1 Charizard #6", "chrome"), null);
  assert.equal(gradeOf("Pokemon BGS 9.5 Charizard 6 Topps Chrome"), "BGS 9.5");
  assert.equal(gradeOf("Topps Pokemon TV Charizard graded"), "?");
  assert.equal(gradeOf("1999 Topps Pokemon TV #6 Charizard"), null);
  assert.ok(setOk("1999 TOPPS POKEMON THE MOVIE EDT FOIL #E6 CHARIZARD #6 PSA 9", "MOV1"));
  assert.ok(!setOk("1999 TOPPS POKEMON THE MOVIE EDT FOIL #E6 CHARIZARD #6 PSA 9", "MOV2"));
  assert.ok(!setOk("Pokemon Charizard Base Set 4/102", "TV1"), "senza Topps non è una Topps");
});

test("le ricerche: prima le carte mai cercate, poi le più vecchie; ogni set europeo anche su eBay.it", () => {
  const today = 20_414;
  const state = { g: { "US|1|Base|6": { d: today - 1, r: {} } } };
  const p = plan(list, state, today, 10_000);
  assert.ok(!p.some((x) => x.g.key === "1|Base|6" && x.market === "US"), "cercata ieri: non stanotte");
  assert.ok(p.some((x) => x.g.key === "1|Base|6" && x.market === "IT"));
  assert.ok(!p.some((x) => x.g.key === "6|Base|6" && x.market === "IT"), "i Chrome sono solo inglesi");
  const later = plan(list, state, today + REFRESH_DAYS, 10_000);
  assert.ok(later.some((x) => x.g.key === "1|Base|6" && x.market === "US"));
  assert.equal(queryOf(group("1|TV Animation|TV2")), "topps pokemon tv animation Pikachu TV2");
  assert.equal(queryOf(group("6|Base|6")), "topps pokemon chrome Charizard 6");
});

test("catalogo nel formato dei giochi CardTrader: prezzo per lingua, gradate, foto, lingue del set", () => {
  const r = split(charizard, group("1|Base|6"), { market: "US", usdPerEur: 1.1 });
  const cat = buildCatalog(data, { g: { "US|1|Base|6": { d: 1, r } } }, { updated: "2026-11-22" });
  const normal = cat.cards.find((c) => c.s === 1 && c.num === "6" && c.r === "Base" && !c.v);
  assert.deepEqual(normal.en, [12.72, 2]); // con due inserzioni la più bassa
  assert.deepEqual(normal.g.en["PSA 9"], [227.27, 1]);
  assert.match(normal.img, /^https:\/\/i\.ebayimg\.com\//);
  assert.deepEqual(cat.sets.find((s) => s.id === 1).l, ["en", "it", "de", "fr", "es"]);
  assert.equal(cat.cards.length, data.cards.length);
});

test("prezzi fuori misura nella stessa ricerca: fuori, e una normale non vale più della sua foil", () => {
  // Scena #65 del film del 2000 (titoli veri): 9-26 $ e due foil non dichiarate a 625-675 $.
  assert.deepEqual(priceOf([8.17, 10.15, 23.77, 568.7, 614.2]), [10.15, 3]);
  const g = group("5|Base|65");
  const [plain, silver] = g.prints;
  const state = { g: { [`US|${g.key}`]: { d: 1, r: { [plain.id]: { en: [600, 650] }, [silver.id]: { en: [55] } } } } };
  const cat = buildCatalog(data, state);
  assert.deepEqual(cat.cards.find((c) => c.id === plain.id).en, [55, 2]);
});

test("foto: prima la scansione di Bulbapedia (su R2), poi la foto eBay, poi quella di un'altra versione della carta", () => {
  const g = group("1|Base|6");
  const [plain, silver, rainbow] = g.prints;
  const scan = "https://dati.collectorone.app/immagini/topps/Topps_Series_1_06_Silver.webp";
  const state = { g: { [`US|${g.key}`]: { d: 1, r: { [plain.id]: { en: [12], img: "https://i.ebayimg.com/images/g/a/s-l225.jpg" } } } } };
  const cat = buildCatalog(data, state, { photos: { [silver.id]: scan } });
  const row = (id) => cat.cards.find((c) => c.id === id);
  assert.equal(row(silver.id).img, scan);
  assert.match(row(plain.id).img, /ebayimg/);
  assert.match(row(rainbow.id).img, /ebayimg/, "senza foto sua: quella della normale");
  // Il file vero dell'abbinamento: solo indirizzi di Cloudflare R2, mai di Bulbapedia o Supabase.
  const real = JSON.parse(fs.readFileSync(new URL("../dati/foto-topps.json", import.meta.url), "utf8")).p;
  assert.ok(Object.keys(real).length > 2700);
  assert.ok(Object.values(real).every((u) => u.startsWith("https://dati.collectorone.app/immagini/topps/")));
});
