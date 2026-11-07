// Aggiunge a un file dei sigillati già pubblicato (sealed.json) il prodotto TCGplayer di ogni prodotto ("tp"), con le stesse
// regole del job (addSealedTcgplayer in sealed.js), senza rifare tutto il file: serve a dare subito l'andamento dei sigillati
// al grafico della collezione ricostruita (0.9.140), prima del giro notturno.
// Uso: node src/sealed-tp.js <sealed.json> <tcgplayer.json> <uscita.json>
import fs from "node:fs/promises";
import { addSealedTcgplayer } from "./sealed.js";

const [sealedFile, tpFile, outFile] = process.argv.slice(2);
if (!sealedFile || !tpFile || !outFile) {
  console.log("Uso: node src/sealed-tp.js <sealed.json> <tcgplayer.json> <uscita.json>");
  process.exit(1);
}
const sealed = JSON.parse(await fs.readFile(sealedFile, "utf8"));
const { g, p } = JSON.parse(await fs.readFile(tpFile, "utf8"));
// Come tcgplayerProducts in build.js: solo i prodotti senza numero (sigillati); categoria 85 = giapponese.
const tpProducts = Object.entries(p).filter(([, v]) => !v[2]).map(([id, v]) => ({ id, name: v[0], group: g[v[1]]?.[0], groupId: Number(v[1]), eur: v[3], lang: g[v[1]]?.[1] === 85 ? "ja" : "en" }));
const n = addSealedTcgplayer(sealed.p, tpProducts, sealed.exp || {}, null);
await fs.writeFile(outFile, JSON.stringify(sealed));
console.log(`Prodotto TCGplayer dei sigillati: ${n} su ${sealed.p.length}`);
