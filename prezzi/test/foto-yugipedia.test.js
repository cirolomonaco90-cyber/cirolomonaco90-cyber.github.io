import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProduct, pickFile, titleVariants, prefixOf } from "../src/foto-yugipedia.js";

test("Yugipedia: set e tipo dal nome Cardmarket, file della confezione per tipo e regione", () => {
  assert.deepEqual(parseProduct("The New Challengers (Japanese) Booster Box"), { set: "The New Challengers", kind: "box" });
  assert.deepEqual(parseProduct("Vol. 1 Booster Box"), { set: "Vol. 1", kind: "box" });
  const files = ["File:NECH-BoosterEN.png", "File:NECH-BoxEN.jpg", "File:NECH-BoosterJP.png", "File:NECH-BoxJP.png", "File:Logo.png"];
  assert.equal(pickFile(files, "box", "ja", "The New Challengers (Japanese) Booster Box"), "NECH-BoxJP.png");
  assert.equal(pickFile(files, "booster", "en", "The New Challengers Booster"), "NECH-BoosterEN.png");
});

test("Yugipedia: titoli col punto, senza le parentesi di Cardmarket, e prefisso del set dall'infobox", () => {
  // Pagine reali: "Vol.1", "Duelist Legacy Volume.1", "Expert Edition Volume.1" (7 novembre 2026).
  assert.ok(titleVariants("Vol. 1").includes("Vol.1"));
  assert.ok(titleVariants("Duelist Legacy Volume 2").includes("Duelist Legacy Volume.2"));
  assert.ok(titleVariants("Expert Edition Volume 3").includes("Expert Edition Volume.3"));
  assert.ok(titleVariants("Premium Pack (Legendary Collection: 25th Anniversary Edition)").includes("Premium Pack"));
  assert.equal(titleVariants("Vol. 1")[0], "Vol. 1");
  assert.equal(prefixOf("{{Infobox set\n| en_name = Duelist League 1\n| prefix  = DL1\n| ja_name = x\n}}"), "DL1");
  assert.equal(prefixOf("{{Infobox set\n| en_name = senza prefisso\n}}"), null);
});

test("Yugipedia: niente foto della confezione sbagliata (casi del 7 novembre 2026)", () => {
  // La busta dentro un Duelist Set non è il mazzo; la stampa portoghese non è quella inglese; la Special Edition non è il mazzo normale.
  assert.deepEqual(parseProduct("Duelist Set: Version Machine-Gear Troopers Enhancement Pack").kind, "booster");
  assert.equal(pickFile(["File:DS14-DeckJP-VerA.png"], "booster", "en", "Duelist Set: Version Machine-Gear Troopers Enhancement Pack"), null);
  assert.equal(pickFile(["File:MRD-BoosterEN.png"], "booster", "en", "Metal Raiders (PMT) Booster"), null);
  assert.equal(pickFile(["File:SD11-DeckJP.png"], "deck", "en", "Structure Deck: Surge of Radiance Special Edition"), null);
  assert.equal(pickFile(["File:SD11-DeckJP.png", "File:SD11-DeckJP-SE.png"], "deck", "en", "Structure Deck: Surge of Radiance Special Edition"), "SD11-DeckJP-SE.png");
  assert.equal(pickFile(["File:SD16-DeckAE.png"], "deck", "en", "Structure Deck: Lord of the Magician Limited Edition"), null);
});
