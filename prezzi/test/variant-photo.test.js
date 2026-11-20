import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVariantListing, hasNumber, hasVariant, searchQuery, marketplaceFor, cacheKey, bigImage } from "../../supabase/functions/variant-photo/rules.js";

const gengar = { name: "Gengar", number: "11", setTotal: 110, setName: "Legendary Collection", variant: "reverse", lang: "en" };
const item = (title, extra = {}) => ({ title, image: "https://i.ebayimg.com/images/g/abc/s-l225.jpg", url: "https://www.ebay.com/itm/1", price: 50, ...extra });

test("numero e variante nel titolo", () => {
  assert.ok(hasNumber("Gengar 11/110 Legendary Collection Reverse Holo", "11", 110));
  assert.ok(hasNumber("Gengar 011/110 reverse", "11", 110));
  assert.ok(hasNumber("Gengar 11 / 110", "011", 110));
  assert.ok(!hasNumber("Gengar 111/110", "11", 110));
  assert.ok(!hasNumber("Gengar 11/111", "11", 110));
  assert.ok(hasNumber("Pikachu promo 25", "25", null));
  assert.ok(!hasNumber("Pikachu promo 250", "25", null));
  assert.ok(hasVariant("Gengar Reverse Holo", "reverse"));
  assert.ok(hasVariant("Gengar REV. HOLO", "reverse"));
  assert.ok(!hasVariant("Gengar Holo Rare", "reverse"));
  assert.ok(hasVariant("Charizard 1st Edition", "firstEdition"));
  assert.ok(hasVariant("Charizard prima edizione", "firstEdition"));
  assert.ok(!hasVariant("Charizard unlimited", "firstEdition"));
});

test("scelta dell'inserzione: nome, numero, variante, niente gradate o lotti", () => {
  const items = [
    item("Gengar 11/110 Legendary Collection Holo Rare"), // non reverse
    item("Gengar 11/110 Legendary Collection Reverse Holo PSA 9"), // gradata
    item("Lot 3x Gengar 11/110 Reverse Holo"), // lotto
    item("Gengar 12/110 Reverse Holo Legendary Collection"), // numero sbagliato
    item("Haunter 11/110 Reverse Holo"), // nome sbagliato
    item("Gengar 11/110 Reverse Holo", { price: 80, condition: "Used" }), // senza set: 0 punti
    item("Gengar 11/110 Legendary Collection Reverse Holo Near Mint", { price: 60 }), // set + NM: 3 punti
    item("Gengar 11/110 Legendary Collection Reverse Holo", { image: undefined }), // senza foto
  ];
  const pick = pickVariantListing(items, gengar);
  assert.equal(pick.title, "Gengar 11/110 Legendary Collection Reverse Holo Near Mint");
  assert.equal(pick.image, "https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
  assert.equal(pick.url, "https://www.ebay.com/itm/1");
  // Nessuna inserzione valida: null.
  assert.equal(pickVariantListing(items.slice(0, 5), gengar), null);
  assert.equal(pickVariantListing([], gengar), null);
});

test("nomi con punteggiatura e 1ª edizione", () => {
  const items = [item("Mr Mime 6/64 Jungle 1st Edition Holo"), item("Mr. Mime 6/64 Jungle unlimited")];
  const pick = pickVariantListing(items, { name: "Mr. Mime", number: "6", setTotal: 64, setName: "Jungle", variant: "firstEdition" });
  assert.equal(pick.title, "Mr Mime 6/64 Jungle 1st Edition Holo");
});

test("ricerca, mercato, chiave della cache", () => {
  assert.equal(searchQuery(gengar), "Gengar 11/110 Legendary Collection reverse holo");
  assert.equal(searchQuery({ ...gengar, setTotal: null, variant: "firstEdition" }), "Gengar 11 Legendary Collection 1st edition");
  assert.equal(marketplaceFor("it"), "EBAY_IT");
  assert.equal(marketplaceFor("en"), "EBAY_US");
  assert.equal(marketplaceFor("ja"), "EBAY_US");
  assert.equal(cacheKey(gengar), "en|legendarycollection|11/110|reverse");
  assert.equal(bigImage("https://i.ebayimg.com/images/g/x/s-l225.jpg"), "https://i.ebayimg.com/images/g/x/s-l1600.jpg");
});

test("Yu-Gi-Oh!: codice con la regione, 1ª edizione, ricerca e chiave a parte", () => {
  // Titoli veri di eBay (4 novembre 2026, ricerca "Blue-Eyes White Dragon LOB 1st edition").
  const bewd = { game: "yugioh", name: "Blue-Eyes White Dragon", number: "LOB-001", setName: "Legend of Blue Eyes White Dragon", variant: "firstEdition", lang: "en" };
  assert.ok(hasNumber("Konami Yu-Gi-Oh! Blue-Eyes White Dragon LOB-001 1st EDITION Ultra Rare Holo", "LOB-001", null, "yugioh"));
  assert.ok(hasNumber("Blue-Eyes White Dragon LOB-EN001 1st Edition", "LOB-001", null, "yugioh"));
  assert.ok(hasNumber("Drago Bianco Occhi Blu LOB-I001 1a Edizione", "LOB-001", null, "yugioh"));
  assert.ok(!hasNumber("Blue-Eyes White Dragon SDK-001 1st Edition", "LOB-001", null, "yugioh"));
  assert.ok(!hasNumber("Blue-Eyes White Dragon LOB-0010", "LOB-001", null, "yugioh"));
  assert.ok(hasVariant("Blauäugiger w. Drache LOB-G001 1. Auflage", "firstEdition"));
  const items = [
    item("Blue-Eyes White Dragon LOB-001 Ultra Rare 1st Edition GLOSSY Yugioh BGS 9.5"),
    item("Blue Eyes White Dragon LOB-001"),
    item("Blue-Eyes White Dragon SDK-001 1st Edition Ultra Rare"),
    item("Blue-Eyes White Dragon LOB-001 The Legend of Blue Eyes White Dragon 1st Edition"),
  ];
  assert.equal(pickVariantListing(items, bewd)?.title, "Blue-Eyes White Dragon LOB-001 The Legend of Blue Eyes White Dragon 1st Edition");
  assert.equal(searchQuery(bewd), "Blue-Eyes White Dragon LOB 1st edition");
  assert.equal(cacheKey(bewd), "yugioh|en|legendofblueeyeswhitedragon|lob-001/|firstEdition");
  assert.equal(cacheKey(gengar), "en|legendarycollection|11/110|reverse");
});
