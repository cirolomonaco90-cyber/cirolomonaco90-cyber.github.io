// Esplorazione (sola lettura): offerte di una singola carta su CardTrader, per vedere se le gradate
// sono tagliate dalle "25 più economiche" e se esiste un filtro per le gradate.
import { CardTrader } from "./cardtrader.js";

const ct = new CardTrader({ token: process.env.CARDTRADER_TOKEN });
const wait = () => new Promise((r) => setTimeout(r, 1300));
const cases = [
  ["Charizard Set Base", 111151],
  ["Charizard ex 151 SIR 199", null],
  ["Luffy OP05-119 Manga", 268469],
];
const PARSE = /\b(PSA|BGS|BECKETT|CGC|SGC|ACE|PCA|GRAAD|UCG|AP)\b[^0-9]{0,12}(10|[1-9](?:[.,]5)?)\b/i;
for (const [label, bp] of cases) {
  if (!bp) continue;
  for (const extra of [{}, { graded: true }]) {
    await wait();
    let json;
    try {
      json = await ct.get("marketplace/products", { blueprint_id: bp, ...extra });
    } catch (e) {
      console.log(`${label} ${JSON.stringify(extra)}: errore ${e.message}`);
      continue;
    }
    const offers = Object.values(json || {}).flat();
    const graded = offers.filter((o) => o.graded);
    console.log(`\n=== ${label} (${bp}) ${JSON.stringify(extra)}: offerte ${offers.length}, gradate ${graded.length}`);
    const langs = {};
    for (const o of graded) {
      const l = o.properties_hash?.pokemon_language || o.properties_hash?.onepiece_language || "?";
      langs[l] = (langs[l] || 0) + 1;
    }
    console.log("  lingue gradate:", JSON.stringify(langs));
    let parsed = 0;
    for (const o of graded.sort((a, b) => a.price_cents - b.price_cents)) {
      const m = PARSE.exec(o.description || "");
      if (m) parsed++;
    }
    console.log(`  descrizioni con ente e voto riconoscibili: ${parsed}/${graded.length}`);
    for (const o of graded.slice(0, 40)) {
      const m = PARSE.exec(o.description || "");
      console.log(`    ${(o.price_cents / 100).toFixed(2)} € | ${o.properties_hash?.pokemon_language || o.properties_hash?.onepiece_language || ""} | ${m ? m[1].toUpperCase() + " " + m[2] : "??"} | ${String(o.description || "").slice(0, 70)}`);
    }
  }
}
