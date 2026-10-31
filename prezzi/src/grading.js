// Carte gradate su CardTrader: l'ente e il voto non sono campi, sono scritti dal venditore nella
// descrizione, in mille modi ("[PSA 8.0]", "Bgs8,5", "CGC 10 Gem Mint", "graduato 9" senza ente).
// Si riconoscono solo PSA, BGS (Beckett), CGC e SGC con un voto chiaro; il resto si scarta.

const GRADER = /\b(PSA|BGS|BECKETT|CGC|SGC)\s*[:#-]?\s*(10(?:[.,]0)?|[1-9](?:[.,][05])?)(?![0-9.,]*\d)/i;

// Descrizioni da non usare: autografate, Black Label/Pristine (prezzi a parte), lotti, "solo voto".
const SKIP = /\bauto|\bsigned|\bfirmat|black\s*label|pristine|\blott[oi]\b|\blot\b|\bbundle\b|qualifier/i;

/** {grader: "PSA", grade: "10"} dalla descrizione di un'offerta gradata; null se non è chiara. */
export function parseGrade(description) {
  const d = String(description || "");
  if (SKIP.test(d)) return null;
  const m = GRADER.exec(d);
  if (!m) return null;
  const grader = m[1].toUpperCase() === "BECKETT" ? "BGS" : m[1].toUpperCase();
  let grade = m[2].replace(",", ".");
  if (grade.endsWith(".0")) grade = grade.slice(0, -2);
  // PSA dà anche i mezzi voti, ma non il 9.5.
  if (grader === "PSA" && grade === "9.5") return null;
  return { grader, grade };
}
