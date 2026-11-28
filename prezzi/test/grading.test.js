import test from "node:test";
import assert from "node:assert/strict";
import { parseGrade } from "../src/grading.js";

// Descrizioni vere di offerte gradate su CardTrader (ottobre 2026).
test("ente e voto dalla descrizione", () => {
  const cases = {
    "[PSA 8.0]": "PSA 8",
    "psa 5": "PSA 5",
    "PSA 10": "PSA 10",
    "[BGS 5.5]": "BGS 5.5",
    "Bgs8,5": "BGS 8.5",
    "BGS9 ": "BGS 9",
    "[BGS 9.5]": "BGS 9.5",
    "Gradato BGS 9.5 - SQUARE CUT": "BGS 9.5",
    "[CGC 7.0] https://www.cgccards.com/certlookup/6197411": "CGC 7",
    "CGC 8,5": "CGC 8.5",
    "[CGC 10.0 Gem-Mint]": "CGC 10",
    "PSA 9 [Metal Version]": "PSA 9",
    "PSA 9 MINT": "PSA 9",
    "SGC 4 ": "SGC 4",
    "PSA 8.5 NM-MT+": "PSA 8.5",
  };
  for (const [d, want] of Object.entries(cases)) {
    const g = parseGrade(d);
    assert.equal(g && `${g.grader} ${g.grade}`, want, d);
  }
});

test("descrizioni da scartare", () => {
  for (const d of [
    "[GRAAD 3.0] THE CARDS YOU WANT", // ente non gestito
    "Graded by European Grading 5.5",
    "graduato 9", // senza ente
    "Charizard holo set base gradato graad ",
    "PSA8 Auto10 POP 4 in the world.", // autografata
    "BGS 10 Black Label", // prezzi a parte
    "PSA 9.5", // PSA non dà il 9.5
    "",
  ]) {
    assert.equal(parseGrade(d), null, d);
  }
});
