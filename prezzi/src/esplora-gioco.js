// Solo a mano (workflow "Esplora CardTrader"): stampa com'è fatto un gioco su CardTrader, per prepararne i
// prezzi nell'app: giochi, espansioni, le proprietà dei blueprint (numero, rarità, lingua) e di un'offerta.
//   CARDTRADER_TOKEN=... node prezzi/src/esplora-gioco.js "dragon ball"
import { CardTrader } from "./cardtrader.js";

const match = (process.argv[2] || "dragon ball").toLowerCase();
const ct = new CardTrader({ token: process.env.CARDTRADER_TOKEN });
const items = (r) => (Array.isArray(r) ? r : r?.array ?? []);
const games = items(await ct.get("games"));
console.log("GIOCHI:", games.map((g) => `${g.id} ${g.name} (${g.display_name || ""})`).join(" | "));
for (const game of games.filter((g) => `${g.name} ${g.display_name || ""}`.toLowerCase().includes(match))) {
  console.log(`\nGIOCO ${game.id} ${game.name}`);
  const exps = await ct.expansions(game.id);
  console.log(`ESPANSIONI (${exps.length}):`);
  for (const e of exps) console.log(`  ${e.id} ${e.code} ${e.name}`);
  for (const e of exps.slice(0, 3)) {
    const bps = await ct.blueprints(e.id);
    console.log(`BLUEPRINT di ${e.name}: ${bps.length}`);
    for (const b of bps.slice(0, 4)) console.log("  ", JSON.stringify({ id: b.id, name: b.name, version: b.version, category_id: b.category_id, fixed_properties: b.fixed_properties, editable_properties: b.editable_properties?.map((p) => p.name) }));
    const card = bps.find((b) => b.fixed_properties?.collector_number);
    if (card) {
      const offers = await ct.get("marketplace/products", { blueprint_id: card.id });
      const list = Object.values(offers)[0] || [];
      console.log(`OFFERTE di ${card.name}: ${list.length}`);
      for (const o of list.slice(0, 3)) console.log("  ", JSON.stringify({ price: o.price, properties_hash: o.properties_hash, graded: o.graded, bundle: o.bundle, quantity: o.quantity }));
    }
  }
}
