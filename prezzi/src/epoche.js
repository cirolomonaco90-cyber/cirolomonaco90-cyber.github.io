// Quanta parte di una Near Mint venduta vale la tendenza Cardmarket, per epoca del set (id TCGdex): gli stessi elenchi
// chiusi dell'app (PriceFixes.trendShare, 25 novembre 2026). La tendenza è il prezzo medio delle copie vendute in ogni
// condizione, non di una Near Mint: Wizards (fino a Skyridge) 0,57; EX, Diamante e Perla, Platino, HeartGold SoulSilver,
// Call of Legends 0,41; Nero e Bianco, XY, Sole e Luna 0,76; tutto il resto (dal 2020, e i set futuri) 1.
const WIZARDS = new Set(["base1", "base2", "base3", "base4", "base5", "basep", "gym1", "gym2", "neo1", "neo2", "neo3", "neo4", "si1", "lc", "ecard1", "ecard2", "ecard3", "bog"]);
const EX_HGSS = /^(ex\d|exu$|np$|pop\d|tk-ex-|tk-dp-|tk-hs-|dp|pl\d|ru1$|hgss|col1$)/;
const BW_SM = /^(bw|xy|sm|dv1$|dc1$|g1$|det1$|tk-bw-|tk-xy-|tk-sm-|201[1-9](bw|xy|sm)$)/;

/** Da questa tendenza in su (euro) la parte delle carte d'epoca comincia a salire, e da questa è quella delle carte care. */
const BAND_FROM = 50;
const BAND_TO = 125;

/**
 * La parte per una tendenza di [amount] euro: chi vende una carta d'epoca cara di solito la vende in buone condizioni, quindi
 * la sua tendenza è più vicina a una Near Mint. Fino a 50 € la parte dell'epoca (0,57 Wizards, 0,41 EX-HGSS), da 125 € in su
 * 0,72 e 0,60, in mezzo un passaggio graduale (PriceFixes.trendShare(cardId, amount) nell'app, scelto dall'utente il 25
 * novembre 2026). Le altre epoche non cambiano col prezzo.
 */
export function trendShareAt(cardId, amount) {
  const base = trendShare(cardId);
  const high = base === 0.57 ? 0.72 : base === 0.41 ? 0.6 : null;
  if (high === null || !(amount > BAND_FROM)) return base;
  if (amount >= BAND_TO) return high;
  return base + ((high - base) * (amount - BAND_FROM)) / (BAND_TO - BAND_FROM);
}

/** La parte della tendenza per l'epoca della carta [cardId] ("neo1-9", "tk-xy-w-11"): 0,57, 0,41, 0,76 o 1. */
export function trendShare(cardId) {
  const id = String(cardId ?? "");
  const cut = id.lastIndexOf("-");
  const set = (cut < 0 ? id : id.slice(0, cut)).toLowerCase();
  if (!set) return 1;
  if (WIZARDS.has(set)) return 0.57;
  if (EX_HGSS.test(set)) return 0.41;
  if (BW_SM.test(set)) return 0.76;
  return 1;
}
