// Set asiatici (giapponese, coreano, cinese, indonesiano, thailandese) che su TCGdex hanno solo il
// nome, senza carte: le carte si prendono da CardTrader (nome inglese, numero, foto). Per i set che
// TCGdex ha con le carte ma senza immagini, l'app usa le foto dello stesso numero.
//
//   CARDTRADER_TOKEN=... node prezzi/src/asia.js <uscita.json>
//
// Uscita (carte/v1/asia.json):
//   { v, updated,
//     sets:  { idSetTCGdex[@lingua]: codiceEspansioneCardTrader },
//     cards: { codiceEspansione: [[numero, nome, immagine, idBlueprint, versione|null, idCardmarket|null,
//              tendenzaCM|null, media30CM|null, stimaCardTrader|null, offerteCardTrader|null], ...] },
//     names: { lingua: { "Battle Partners": idSetTCGdex } },   // nomi inglesi, per l'importazione da Collectr
//     totals: { idSetTCGdex@lingua: carte ufficiali },
//     dex: { idSetTCGdex: { numeroPokédex: idCarta } } }   // set giapponesi vecchi, numerati col Pokédex da Collectr
// Il numero è quello stampato prima della barra ("042/048" -> "042"); se più stampe hanno lo
// stesso numero (es. ristampe Master Ball), dalla seconda si aggiunge una lettera: "042b", "042c".
import fs from "node:fs/promises";
import { CardTrader } from "./cardtrader.js";
import { estimate } from "./stats.js";
import { isPlaceholderPrice } from "./onepiece.js";
import { fetchRetry } from "./rete.js";

const CM_GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const CM_SINGLES = "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json";

/**
 * Set TCGdex vuoti -> espansione CardTrader. Codice uguale (o con "+" = "plus", senza il punto,
 * senza la "C" finale dei set cinesi) oppure abbinato per nome; ogni abbinamento è stato
 * controllato confrontando numero di carte ed esempi (ottobre 2026).
 * Le promo hanno numeri diversi in ogni paese: "SV-P@ja" vale solo per il set giapponese (le promo
 * taiwanesi e thailandesi con lo stesso id sono altre carte), e le promo indonesiane e thailandesi
 * "S-P" non si abbinano alle giapponesi.
 * Esclusi i "CS…" che TCGdex mette per errore anche in giapponese, coreano, indonesiano e
 * thailandese (tutti col nome "Triplet Beat"): sono set cinesi, non esistono in quelle lingue.
 */
export const ASIA_SETS = {
  "ADV1": "exp", // ja · ADV Expansion Pack
  "ADV2": "mod", // ja · Miracle of the Desert
  "ADV3": "roh", // ja · Rulers of the Heavens
  "ADV4": "mvsa", // ja · Magma VS Aqua: Two Ambitions
  "ADV5": "uns", // ja · Undone Seal
  "CBB2C": "cbb2c", // zh-cn · Gem Pack Vol.2
  "CBB3C": "cbb3c", // zh-cn · Gem Pack Vol.3
  "CBB4C": "cbb4c", // zh-cn · Gem Pack Vol.4
  "CBB5C": "cbb5c", // zh-cn · Gem Pack Vol.5
  "CP3": "cp3", // ja · PokéKyun Collection
  "CP4": "cp4", // ja · Premium Champion Pack
  "CP5": "cp5", // ja · Mythical & Legendary Dream Shine Collection
  "CP6": "ep20", // ja · Expansion Pack 20th Anniversary
  "CS1.5C": "cs15", // zh-cn · CS1.5: Dynamax Tactics
  "CS1aC": "cs1a", // zh-cn · CS1a: Dynamax Clash - Thunder
  "CS1bC": "cs1b", // zh-cn · CS1b: Dynamax Clash - Flame
  "CS2.5C": "cs25", // zh-cn · CS2.5: Brilliant Counterattack
  "CS2aC": "cs2a", // zh-cn · CS2a: Vivid Portrayals - Obsidian
  "CS2bC": "cs2b", // zh-cn · CS2b: Vivid Portrayals - Indigo
  "CS3.5C": "cs35", // zh-cn · CS3.5: Scorching Skies
  "CS3aC": "cs3a", // zh-cn · CS3a: Primordial Martial Arts - Overgrowth
  "CS3bC": "cs3b", // zh-cn · CS3b: Primordial Martial Arts - Torrent
  "CS4.5C": "cs45", // zh-cn · CS4.5: Final Flame Dance
  "CS4aC": "cs4a", // zh-cn · CS4a: Nine Colors Gathering - Friends
  "CS4bC": "cs4b", // zh-cn · CS4b: Nine Colors Gathering - Origin
  "CS5.5C": "cs55", // zh-cn · CS5.5: Shadow of Glory
  "CS5aC": "cs5a", // zh-cn · CS5a: Brave Enchanting Stars - Brave
  "CS5bC": "cs5b", // zh-cn · CS5b: Brave Enchanting Stars - Charm
  "CS6.5C": "cs65", // zh-cn · CS6.5: Victory Star Guide
  "CS6aC": "cs6a", // zh-cn · CS6a: Azure Shadow - Roar
  "CS6bC": "cs6b", // zh-cn · CS6b: Azure Shadow - Pursuit
  "csm1.5": "csm15", // zh-cn · CSM1.5: Battle Elite
  "CSM1.5C": "csm15", // zh-cn · CSM1.5: Battle Elite
  "csm1a": "csm1a", // zh-cn · CSM1a: Storming Emergence - Radiant
  "CSM1aC": "csm1a", // zh-cn · CSM1a: Storming Emergence - Radiant
  "csm1b": "csm1b", // zh-cn · CSM1b: Storming Emergence - Verdant
  "CSM1bC": "csm1b", // zh-cn · CSM1b: Storming Emergence - Verdant
  "csm1c": "csm1c", // zh-cn · CSM1c: Storming Emergence - Abundant
  "CSM1cC": "csm1c", // zh-cn · CSM1c: Storming Emergence - Abundant
  "csm2.5": "csm25", // zh-cn · CSM2.5: Striking Competition
  "CSM2.5C": "csm25", // zh-cn · CSM2.5: Striking Competition
  "csm2a": "csm2a", // zh-cn · CSM2a: Shining Synergy - Shower
  "CSM2aC": "csm2a", // zh-cn · CSM2a: Shining Synergy - Shower
  "csm2b": "csm2b", // zh-cn · CSM2b: Shining Synergy - Supreme
  "CSM2bC": "csm2b", // zh-cn · CSM2b: Shining Synergy - Supreme
  "csm2c": "csm2c", // zh-cn · CSM2c: Shining Synergy - Summon
  "CSM2cC": "csm2c", // zh-cn · CSM2c: Shining Synergy - Summon
  "CSV1C": "csv1", // zh-cn,zh-cn · CSV1: Eternal Birth
  "CSV2C": "csv2", // zh-cn · CSV2: Miracle Journey
  "CSV3C": "csv3", // zh-cn · CSV3: Fearless Terastal
  "CSV4C": "csv4", // zh-cn · CSV4: Bonus Round
  "CSV5C": "csv5", // zh-cn · CSV5: Dark Crystal Blaze
  "CSV6C": "csv6", // zh-cn · CSV6: True Mystery
  "CSV7C": "csv7", // zh-cn · CSV7: Blade Awakening
  "CSV8C": "csv8", // zh-cn · CSV8: Brilliant Fantasy
  "CSV9.5C": "csv9.5", // zh-cn · CSV9.5: Terastal Gathering
  "CSV9C": "csv9", // zh-cn · CSV9: Stellar Crystal
  "L1a": "l1", // ja · HeartGold Collection
  "L1b": "l1ss", // ja · SoulSilver Collection
  "L2": "l2", // ja · Reviving Legends
  "L3": "l3", // ja · Clash at the Summit
  "LL": "ll", // ja · Lost Link
  "PCG10": "wcp", // ja · World Champions Pack
  "S10a": "s10a", // ko,id · Dark Phantasma
  "S10b": "s10b", // ja,ko,id,th · Pokémon GO Enhanced Expansion Pack
  "S10D": "s10d", // ja,ko,id,th · Time Gazer
  "S10P": "s10p", // ko,id,th · Space Juggler
  "S11": "s11", // ko,id,th · Lost Abyss
  "S11a": "s11a", // ko,id,th · Incandescent Arcana
  "S12": "s12", // ko,id · Paradigm Trigger
  "S12a": "s12a", // ko,id · VSTAR Universe
  "S1a": "s1a", // ja,ko · VMAX Rising
  "S1H": "s1h", // ja,ko · Shield
  "S1W": "s1w", // ja,ko · Sword
  "S2": "s2", // ja,ko · Rebellion Crash
  "S2a": "s2a", // ja,ko · Explosive Flame Walker
  "S3": "s3", // ja,ko · Infinity Zone
  "S3a": "ls3", // ja,ko · Legendary Heartbeat
  "S4": "s4", // ja,ko · Shocking Volt Tackle
  "S4a": "s4a", // ja,ko · Shiny Star V
  "S5a": "s5a", // ja,ko,id · Matchless Fighters
  "S5I": "s5l", // ko,id · Single Strike Master
  "S5R": "s5r", // ja,ko,id · Rapid Strike Master
  "S6a": "s6a", // ja,ko,id,th · Eevee Heroes
  "S6H": "s6h", // ko,id,th · Silver Lance
  "S6K": "s6k", // ko,id,th · Jet Black Spirit
  "S7D": "s7d", // ko,id,th · Towering Perfection
  "S7R": "s7r", // ja,ko,id,th · Blue Sky Stream
  "S8": "s8", // ko,id,th · Fusion Arts
  "S8a": "s8a", // ja,ko,id,th · 25th Anniversary Collection
  "S8b": "s8b", // ko,id,th · VMAX Climax
  "S9": "s9", // ko,id,th · Star Birth
  "S9a": "s9a", // ko,id,th · Battle Region
  "SH": "sh", // th · Sword & Shield Family Pokémon Card Game
  "SM1+": "sm1plus", // ja,ko · Strength Expansion Pack Sun & Moon
  "SM10": "sm10", // ko · Double Blaze
  "SM10a": "sm10a", // ko · GG End
  "SM10b": "sm10b", // ko · Sky Legend
  "SM11": "sm11", // ko · Miracle Twin
  "SM11a": "sm11a", // ko · Remix Bout
  "SM11b": "sm11b", // ko · Dream League
  "SM12": "sm12", // ko · Alter Genesis
  "SM12a": "sm12a", // ko · Tag Team GX: Tag All Stars
  "SM1M": "sm1m", // ko · Collection Moon
  "SM1S": "sm1s", // ko · Collection Sun
  "sm2+": "sm2plus", // ja · Facing a New Trial
  "SM2K": "sm2k", // ko · Islands Await You
  "SM2L": "sm2l", // ko · Alolan Moonlight
  "SM3+": "sm3", // ja,ko · Strength Expansion Pack Shining Legends
  "SM3H": "sm3h", // ko · To Have Seen the Battle Rainbow
  "SM3N": "sm3n", // ko · Darkness that Consumes Light
  "SM4+": "sm4", // ja,ko · GX Battle Boost
  "SM4A": "sm4a", // ko · Ultradimensional Beasts
  "SM4S": "sm4s", // ko · Awakened Heroes
  "SM5+": "sm5plus", // ja,ko · Ultra Force
  "SM5M": "sm5m", // ko · Ultra Moon
  "SM5S": "sm5s", // ko · Ultra Sun
  "SM6": "sm6", // ko · Forbidden Light JP
  "SM6a": "sm6a", // ko · Dragon Storm
  "SM6b": "sm6b", // ko · Champion Road
  "SM7": "sm7", // ko · Sky-Splitting Charisma
  "SM7a": "sm7a", // ko · Thunderclap Spark
  "SM7b": "sm7b", // ko · Fairy Rise
  "SM8": "sm8", // ko · Super-Burst Impact
  "SM8a": "sm8a", // ko · Dark Order
  "SM8b": "sm8b", // ko · High Class Pack GX Ultra Shiny
  "SM9": "sm9", // ko · Tag Bolt
  "SM9a": "sm9a", // ko · Night Unison
  "SM9b": "sm9b", // ko · Full Metal Wall
  "SMP2": "smp2", // ja,ko · Great Detective Pikachu
  "SV1a": "sv1a", // ko · Triplet Beat
  "SV1S": "sv1s", // ko · Scarlet ex
  "SV1V": "sv1v", // ko · Violet ex
  "SV2a": "sv2a", // ko · Pokémon Card 151
  "SV2D": "sv2d", // ko · Clay Burst
  "SV2P": "sv2p", // ko · Snow Hazard
  "SV3": "sv3", // ko · Ruler of the Black Flame
  "SV3a": "sv3a", // ko · Raging Surf
  "SV4a": "sv4a", // ko · Shiny Treasure ex
  "SV5a": "sv5a", // ko · Crimson Haze
  "SV5M": "sv5m", // ko · Cyber Judge
  "SV6": "sv6", // ko · Mask of Change
  "XY10": "xy10", // ja · Awakening Psychic King
  "XY11a": "xy11f", // ja · Fever-Burst Fighter
  "XY11b": "xy11", // ja · Cruel Traitor
  "XY1a": "xy1", // ja · Collection X
  "XY1b": "xy1y", // ja · Collection Y
  "XY2": "xy2", // ja · Wild Blaze
  "XY3": "xy3", // ja · Rising Fist
  "XY4": "xy4", // ja · Phantom Gate
  "XY5a": "xy5", // ja · Gaia Volcano
  "XY5b": "xy5t", // ja · Tidal Storm
  "XY6": "xy6", // ja · Emerald Break
  "XY7": "xy7", // ja · Bandit Ring
  "XY8a": "xy8", // ja · Blue Shock
  "XY8b": "xy8r", // ja · Red Flash
  "XY9": "xy9", // ja · Rage of the Broken Heavens
  // Set che TCGdex ha con le carte ma senza immagini: dal catalogo si prendono solo le foto
  // (stesso numero). Esclusi i set giapponesi più vecchi: su CardTrader le carte non hanno numero.
  "CP1": "cp1", // ja · Magma Gang VS Aqua Gang: Double Crisis · foto per 34/34 carte
  "CP2": "cp2", // ja · Legendary Shine Collection · foto per 27/27 carte
  "CSMPiC": "csmpic", // zh-cn · CSMPiC: Battle Party Set Reward Pack · foto per 48/48 carte
  "E1": "ec1", // ja · Base Expansion Pack · foto per 128/128 carte
  "E2": "ec2", // ja · The Town on No Map · foto per 92/92 carte
  "E3": "ec3", // ja · Wind from the Sea · foto per 90/90 carte
  "E4": "ec4", // ja · Split Earth · foto per 91/91 carte
  "E5": "ec5", // ja · Mysterious Mountains · foto per 91/91 carte
  "M1L": "m1l", // ja · Mega Brave · foto per 92/92 carte
  "M1S": "m1s", // ja · Mega Symphonia · foto per 92/92 carte
  "M2": "m2", // ja · Inferno X · foto per 116/116 carte
  "M2a": "m2a", // ja · MEGA Dream ex · foto per 250/250 carte
  "M3": "m3", // ja · Nihil Zero · foto per 117/117 carte
  "M4": "m4", // ja · Ninja Spinner · foto per 120/120 carte
  "M5": "m5", // ja · Abyss Eye · foto per 118/118 carte
  "M6": "m6", // ja · Storm Emeralda · foto per 113/113 carte
  "M6a": "m6a", // ja · 30th Celebration JP · foto per 176/176 carte
  "MC": "mc", // ja · MEGA Start Deck 100 Battle Collection · foto per 766/774 carte
  "MF": "mf", // ja · 30th Celebration Premium Deck Set · foto per 44/49 carte
  "PCG1": "fol", // ja · Flight of Legends · foto per 82/82 carte
  "PCG2": "cbs", // ja · Clash of the Blue Sky · foto per 81/82 carte
  "PCG3": "rgsb", // ja · Rocket Gang Strikes Back · foto per 85/85 carte
  "PCG4": "gsso", // ja · Golden Sky, Silvery Ocean · foto per 106/106 carte
  "PCG5": "mif", // ja · Mirage Forest · foto per 86/86 carte
  "PCG6": "hrt", // ja · Holon Research Tower · foto per 86/86 carte
  "PCG7": "hof", // ja · Holon Phantoms · foto per 52/52 carte
  "PCG8": "mic", // ja · Miracle Crystal · foto per 75/75 carte
  "PCG9": "odffe", // ja · Offense and Defense of the Furthest Ends · foto per 68/68 carte
  "PMCG5": "gls", // ja · Gym Booster 1 Leaders' Stadium · foto per 2/96 carte
  "SJ": "sj", // zh-tw · Special Deck Set Zacian Zamazenta vs Eternatus · foto per 10/10 carte
  "SK": "sk", // zh-tw · Premium Trainer Box VSTAR · foto per 10/10 carte
  "SLL": "sll", // zh-tw · Sword & Shield Starter Set Lucario VSTAR · foto per 1/2 carte
  "SM1p": "sm1plus", // ja · Strength Expansion Pack Sun & Moon · foto per 67/68 carte
  "SM2p": "sm2plus", // ja · Facing a New Trial · foto per 64/65 carte
  "SM3p": "sm3", // ja · Strength Expansion Pack Shining Legends · foto per 82/82 carte
  "SM4p": "sm4", // ja · GX Battle Boost · foto per 122/125 carte
  "SM5p": "sm5plus", // ja · Ultra Force · foto per 62/63 carte
  "SN": "sn", // zh-tw · Start Deck 100 CoroCoro Comic Version · foto per 4/5 carte
  "SV-P@ja": "promosv", // ja · Scarlet & Violet Promos · foto per 278/288 carte
  "M-P@ja": "mp-promo", // ja · M-P Promos · foto per 129/132 carte
  "SV10": "sv10", // ja,zh-cn · The Glory of Team Rocket · foto per 34/34 carte
  "SV11B": "sv11b", // ja · Black Bolt | sv11B · foto per 174/174 carte
  "SV11W": "sv11w", // ja · White Flare | sv11W · foto per 174/174 carte
  "SV4K": "sv4k", // ko,zh-tw,th · Ancient Roar · foto per 95/95 carte
  "SV4M": "sv4m", // ko,zh-tw,th · Future Flash · foto per 95/95 carte
  "SV5K": "sv5k", // ko,zh-tw,th · Wild Force · foto per 49/49 carte
  "SV6a": "sv6a", // zh-tw · Night Wanderer · foto per 64/64 carte
  "SV7": "sv7", // zh-cn · Stellar Miracle · foto per 132/132 carte
  "SV7a": "sv7a", // zh-cn · Paradise Dragona · foto per 64/64 carte
  "SV8": "sv8", // ja,zh-cn · Super Electric Breaker · foto per 32/32 carte
  "SV8a": "sv8a", // zh-cn · Terastal Festival ex · foto per 237/237 carte
  "SV9": "sv9", // zh-cn · Battle Partners · foto per 100/100 carte
  "SV9a": "sv9a", // zh-cn · Heat Wave Arena · foto per 92/92 carte
  "SVAL": "sval", // zh-tw,id · ex Starter Set: Fuecoco & Ampharos ex · foto per 1/3 carte
  "SVAM": "svam", // zh-tw,id · ex Starter Set: Sprigatito & Lucario ex · foto per 3/5 carte
  "SVAW": "svaw", // zh-tw,id · ex Starter Set: Quaxly & Mimikyu ex · foto per 3/5 carte
  "SVB": "svb", // zh-tw · Scarlet & Violet JP: Premium Trainer Box ex · foto per 8/16 carte
  "SVC": "svc", // zh-tw · ex Starter Set Pikachu ex & Pawmot · foto per 1/2 carte
  "SVD": "svd", // zh-tw · ex Start Decks · foto per 119/127 carte
  "SVF": "svf", // zh-tw · Ruler of the Black Flame Deck Build Box · foto per 18/26 carte
  "SVHK": "svhk", // zh-tw,id,th · Starter Deck & Build Set Ancient Koraidon ex · foto per 2/4 carte
  "SVHM": "svhm", // zh-tw,id,th · Starter Deck & Build Set Future Miraidon ex · foto per 2/4 carte
  "VS1": "pvs", // ja · Pokémon VS · foto per 140/143 carte
};

/** Numero stampato: "042/048" -> "042", "01-15/15" -> "01-15". */
export function printedNumber(raw) {
  return String(raw ?? "").split("/")[0].trim();
}

/** Versione della stampa senza il numero ("Shiny Rare | 191/190" -> "Shiny Rare"); null se resta solo il numero. */
export function versionLabel(v) {
  if (typeof v !== "string") return null;
  const parts = v.split("|").map((x) => x.trim()).filter((x) => x && !/^[\w-]*\d+\/\d+$/.test(x));
  return parts.length ? parts.join(" | ") : null;
}

/** Carte di un'espansione dai blueprint CardTrader, in ordine di numero, con numeri tutti diversi. */
/**
 * Set giapponesi che TCGdex non ha affatto: carte, foto e prezzi tutti da CardTrader, con id propri
 * ("ct-…", per non confondersi con quelli di TCGdex). Per ognuno, i nomi con cui Collectr lo chiama
 * (più set insieme separati da "|": i tre mazzi Classic hanno ognuno le sue carte 001-032).
 */
// date: uscita giapponese (per le raccolte di promo, la prima carta), per ordinare i set in collezione.
export const EXTRA_JA_SETS = {
  "ct-sp": { code: "s-p", date: "2019-12-06", label: "S-P Promo", collectr: ["Sword & Shield Promos", "Sword & Shield Promo"] },
  "ct-xyp": { code: "pxy", date: "2013-12-06", label: "XY-P Promo", collectr: ["XY Promos", "XY Promo"] },
  "ct-pp": { code: "ppromos", date: "2001-01-01", label: "P Promo", collectr: ["P Promotional Cards", "P Promos"] },
  "ct-unp": { code: "unpromo", date: "1997-01-01", label: "Promo senza numero", collectr: ["Unnumbered Promos (1997)", "Unnumbered Promos (1998)", "Unnumbered Promos (1999)", "Unnumbered Promos (2000)", "Unnumbered Promos"] },
  "ct-yamabuki": { code: "gym2-s", date: "1999-06-25", label: "Yamabuki City Gym", collectr: ["Yamabuki City Gym Deck", "Yamabuki City Gym"] },
  "ct-bestxy": { code: "xy", date: "2016-06-17", label: "The Best of XY", collectr: ["The Best of XY"] },
  "ct-classic-c": { code: "cll", date: "2023-11-10", label: "Classic: Charizard & Ho-Oh ex", collectr: [] },
  "ct-classic-v": { code: "clf", date: "2023-11-10", label: "Classic: Venusaur & Lugia ex", collectr: [] },
  "ct-classic-b": { code: "clk", date: "2023-11-10", label: "Classic: Blastoise & Suicune ex", collectr: [] },
  "ct-bonds": { code: "pt2", date: "2009-04-17", label: "Bonds to the End of Time", collectr: ["Bonds to the End of Time"] },
  "ct-dragonblade": { code: "bw5", date: "2012-03-16", label: "Dragon Blade", collectr: ["Dragon Blade"] },
  "ct-eeveevmax": { code: "sp4", date: "2021-05-28", label: "Eevee Heroes VMAX Special Set", collectr: ["Eevee Heroes VMAX Special Set"] },
  "ct-25p": { code: "s8ap", date: "2021-10-22", label: "25th Anniversary Edition", collectr: ["25th Anniversary Promo", "25th Anniversary Edition"] },
  "ct-mcd2002": { code: "mcmp", date: "2002-01-01", label: "McDonald's 2002", collectr: ["McDonald's Promo (2002)"] },
  "ct-vending": { code: "exsh", date: "1998-01-01", label: "Expansion Sheet (Vending)", collectr: ["Vending Series 1 (Blue)", "Vending Series 2 (Red)", "Vending Series 3 (Green)", "Vending Series"] },
};
/** Nomi Collectr che valgono per più set insieme. */
export const EXTRA_JA_GROUPS = {
  "Trading Card Game Classic": "ct-classic-c|ct-classic-v|ct-classic-b",
  "Pokemon Card Game Classic": "ct-classic-c|ct-classic-v|ct-classic-b",
};

/** Un blueprint che è una carta e non una busta, un box o un mazzo (per i set senza numeri). */
function isSingle(bp) {
  return !/booster|box|deck|pack|bundle|collection|case|tin\b|sleeve|coin|binder/i.test(String(bp?.name ?? ""));
}

/**
 * Numero di una carta di un set "extra": quello stampato, altrimenti il numero del Pokédex scritto
 * nella versione ("Glossy | No.016"), altrimenti l'id del blueprint ("bp254237": stabile nel tempo).
 */
export function extraNumber(bp) {
  const printed = printedNumber(bp?.fixed_properties?.collector_number);
  if (printed) return printed;
  const dex = /No\.\s*(\d+)/.exec(String(bp?.version ?? ""));
  return dex ? dex[1] : `bp${bp?.id}`;
}

export function cardsFromBlueprints(bps, number = (bp) => printedNumber(bp?.fixed_properties?.collector_number)) {
  const rows = bps
    .map((bp) => ({
      num: number(bp),
      name: String(bp?.name ?? "").trim(),
      img: bp?.image?.show?.url || bp?.image?.url || null,
      id: bp?.id,
      version: versionLabel(bp?.version),
      cm: (bp?.card_market_ids || []).map(Number).filter(Number.isFinite),
    }))
    .filter((c) => c.num && c.name && c.id);
  const key = (n) => [parseInt(n.replace(/\D/g, ""), 10) || Number.MAX_SAFE_INTEGER, n];
  rows.sort((a, b) => key(a.num)[0] - key(b.num)[0] || a.num.localeCompare(b.num) || (a.version ? 1 : 0) - (b.version ? 1 : 0) || a.id - b.id);
  const seen = new Map();
  return rows.map((c) => {
    const n = (seen.get(c.num) ?? 0) + 1;
    seen.set(c.num, n);
    const num = n === 1 ? c.num : c.num + String.fromCharCode(96 + Math.min(n, 26));
    return [num, c.name, c.img, c.id, c.version, c.cm];
  });
}

/**
 * Prezzi delle carte giapponesi (carte di CardTrader, per i set che TCGdex ha solo di nome).
 * Ogni riga [numero, nome, immagine, blueprint, versione, idCardmarket[]] diventa
 * [numero, nome, immagine, blueprint, versione, idCardmarket|null, tendenza, media30, stimaCT, offerteCT]:
 * Cardmarket dal listino ufficiale (il prodotto giapponese, che CardTrader collega al blueprint),
 * CardTrader dalla mediana delle offerte giapponesi più economiche (stats.estimate).
 * guide = Map(idProdotto -> riga del listino); offers = Map(blueprint -> offerte) o null.
 */
/** Nome di una carta per il confronto con Cardmarket: "Karen's Umbreon [Paralyzing Glare | Gouge]" -> "karen s umbreon". */
export function cmCardName(s) {
  return String(s ?? "")
    .replace(/\[.*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Prodotti Cardmarket mancanti, cercati per nome: CardTrader collega a Cardmarket solo alcune carte
 * di certi set (Pokémon VS: 3 su 147). L'espansione Cardmarket giapponese è quella delle carte già
 * collegate; una carta senza collegamento prende il prodotto di quell'espansione con lo stesso nome,
 * solo se è l'unico (e nessun'altra carta del set ha lo stesso nome: "Switch" no, "Karen's Umbreon" sì).
 * singles = Map(idProdotto -> { name, idExpansion }).
 */
export function linkByName(rows, singles) {
  const counts = new Map();
  for (const [, , , , , cmIds = []] of rows) {
    for (const id of cmIds) {
      const exp = singles.get(id)?.idExpansion;
      if (exp != null) counts.set(exp, (counts.get(exp) ?? 0) + 1);
    }
  }
  const exp = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (exp == null) return rows;
  const byName = new Map();
  for (const [id, p] of singles) {
    if (p.idExpansion !== exp) continue;
    const n = cmCardName(p.name);
    byName.set(n, [...(byName.get(n) ?? []), id]);
  }
  const rowNames = new Map();
  for (const r of rows) rowNames.set(cmCardName(r[1]), (rowNames.get(cmCardName(r[1])) ?? 0) + 1);
  return rows.map((r) => {
    if ((r[5] ?? []).length) return r;
    const n = cmCardName(r[1]);
    const ids = byName.get(n) ?? [];
    return ids.length === 1 && rowNames.get(n) === 1 ? [...r.slice(0, 5), ids] : r;
  });
}

export function withPrices(rows, guide, offers) {
  return rows.map(([num, name, img, id, version, cmIds = []]) => {
    const cm = cmIds.find((x) => guide.get(x)?.trend > 0 || guide.get(x)?.avg30 > 0) ?? cmIds[0] ?? null;
    const g = cm == null ? null : guide.get(cm);
    const pos = (v) => (typeof v === "number" && v > 0 ? v : null);
    // Senza le offerte a prezzo finto (10.000 €...) che alcuni venditori usano per non vendere.
    const ct = offers?.get(id) ? estimate(offers.get(id).filter((o) => !isPlaceholderPrice(o.price)), "n") : null;
    return [num, name, img, id, version, cm, pos(g?.trend), pos(g?.avg30), ct?.[0] ?? null, ct?.[1] ?? null];
  });
}

/**
 * Totali sbagliati di TCGdex, controllati sulle carte stampate (numero dopo la barra):
 * Sky Legend è 054, Black Bolt e White Flare 086.
 */
export const TOTAL_FIX = { "SM10b@ja": 54, "SV11B@ja": 86, "SV11W@ja": 86 };

/** Lingue asiatiche di TCGdex di cui si cercano i nomi inglesi dei set (per l'importazione da Collectr). */
export const NAME_LANGS = ["ja", "ko", "zh-tw", "zh-cn"];

/** Codice CardTrader che corrisponde all'id di un set TCGdex: "SM1+" -> "sm1plus", "CS3.5C" -> "cs35". */
export function ctCode(setId, lang) {
  const c = String(setId).toLowerCase().replace(/\+/g, "plus").replace(/\./g, "");
  return lang === "zh-cn" && /^c.*c$/.test(c) ? c.slice(0, -1) : c;
}

/** Nome inglese di un'espansione CardTrader senza aggiunte: "Black Bolt | sv11B" -> "Black Bolt", "Forbidden Light JP" -> "Forbidden Light". */
export function cleanExpansionName(name) {
  return String(name ?? "").split("|")[0].replace(/\s+JP$/i, "").trim();
}

/**
 * Nomi inglesi (da CardTrader) dei set asiatici di TCGdex, per lingua, e numero ufficiale di carte:
 * Collectr chiama i set giapponesi col nome inglese ("Battle Partners" = SV9). Solo abbinamenti
 * sicuri: stesso codice (o quello di [sets]); un nome che porta a due set diversi viene scartato.
 * tcgdexSets = { lingua: [{ id, cardCount: { official } }] }.
 */
export function setNames(tcgdexSets, expansions, sets = ASIA_SETS) {
  const byCode = new Map(expansions.map((e) => [String(e.code).toLowerCase(), e]));
  const names = {};
  const totals = {};
  for (const lang of NAME_LANGS) {
    const out = new Map();
    const ids = new Set((tcgdexSets[lang] ?? []).map((s) => s.id.toLowerCase()));
    for (const s of tcgdexSets[lang] ?? []) {
      // "SM1p" è un doppione di TCGdex di "SM1+": vale quello col "+".
      const dup = /^(sm\d+)p$/i.exec(s.id);
      if (dup && ids.has(`${dup[1].toLowerCase()}+`)) continue;
      // I "CS…" fuori dal cinese sono un errore di TCGdex (tutti "Triplet Beat").
      if (lang !== "zh-cn" && /^CS/i.test(s.id)) continue;
      const code = sets[`${s.id}@${lang}`] ?? sets[s.id] ?? ctCode(s.id, lang);
      const e = byCode.get(code);
      const name = e && cleanExpansionName(e.name);
      if (!name) continue;
      out.set(name, out.has(name) && out.get(name) !== s.id ? null : s.id);
      const official = s.cardCount?.official;
      if (official) totals[`${s.id}@${lang}`] = official;
    }
    names[lang] = Object.fromEntries([...out].filter(([, id]) => id));
  }
  return { names, totals };
}

/** "042" -> "42", "SV-P" resta com'è: numero per confrontare TCGdex e CardTrader. */
export function shortNumber(n) {
  return String(n ?? "").replace(/^0+(?=\d)/, "").toLowerCase();
}

/**
 * Nomi inglesi delle carte dei set asiatici (le carte su TCGdex hanno il nome in giapponese/cinese/
 * coreano): { idSet: { numero: nome } } dalle carte CardTrader dello stesso set, solo la prima stampa
 * di ogni numero ("042", non "042b"). rows = righe di cardsFromBlueprints.
 */
export function englishNames(rows) {
  const out = {};
  for (const [num, name] of rows) {
    if (/[a-z]$/i.test(num) && !/^\D/.test(num)) continue;
    const k = shortNumber(num);
    if (!(k in out)) out[k] = name;
  }
  return out;
}

export async function buildAsia({ ct, sets = ASIA_SETS, now = new Date(), tcgdexSets = null }) {
  const log = [];
  const expansions = await ct.expansions(await ct.pokemonGameId());
  const byCode = new Map(expansions.map((e) => [String(e.code).toLowerCase(), e]));
  const cards = {};
  const found = {};
  const extraCodes = new Set(Object.values(EXTRA_JA_SETS).map((x) => x.code));
  const allSets = { ...sets, ...Object.fromEntries(Object.entries(EXTRA_JA_SETS).map(([id, x]) => [`${id}@ja`, x.code])) };
  for (const [setId, code] of Object.entries(allSets)) {
    const e = byCode.get(code);
    if (!e) {
      log.push(`! ${setId}: espansione CardTrader "${code}" non trovata`);
      continue;
    }
    if (!cards[code]) {
      try {
        // Solo le carte (i blueprint delle buste e dei box non hanno il numero né "No.").
        const bps = await ct.blueprints(e.id);
        cards[code] = extraCodes.has(code)
          ? cardsFromBlueprints(bps.filter((bp) => bp?.fixed_properties?.collector_number || /No\.\s*\d+/.test(String(bp?.version ?? "")) || isSingle(bp)), extraNumber)
          : cardsFromBlueprints(bps);
      } catch (err) {
        log.push(`! ${setId}: ${err.message}`);
        continue;
      }
    }
    if (cards[code].length) found[setId] = code;
  }
  const n = Object.values(cards).reduce((s, c) => s + c.length, 0);
  log.push(`Set asiatici: ${Object.keys(found).length} su ${Object.keys(allSets).length} con carte (${n} carte da CardTrader)`);
  const tsets = tcgdexSets ?? (await tcgdexAsianSets());
  const { names, totals } = setNames(tsets, expansions, sets);
  // Nomi inglesi delle carte e dei set asiatici di TCGdex (che li ha in giapponese, cinese, coreano).
  const en = {};
  const setEn = {};
  for (const lang of NAME_LANGS) {
    for (const st of tsets[lang] ?? []) {
      if (setEn[st.id] || (lang !== "zh-cn" && /^CS/i.test(st.id))) continue;
      const code = sets[`${st.id}@${lang}`] ?? sets[st.id] ?? ctCode(st.id, lang);
      const e = byCode.get(code);
      if (!e) continue;
      setEn[st.id] = cleanExpansionName(e.name);
      try {
        // Senza aggiungerle al catalogo: di questi set TCGdex ha già le carte, servono solo i nomi.
        const rows = cards[code] ?? cardsFromBlueprints(await ct.blueprints(e.id));
        const m = englishNames(rows);
        if (Object.keys(m).length) en[st.id] = m;
      } catch (err) {
        log.push(`! nomi inglesi di ${st.id}: ${err.message}`);
      }
    }
  }
  log.push(`Nomi inglesi: ${Object.keys(setEn).length} set, ${Object.values(en).reduce((n, m) => n + Object.keys(m).length, 0)} carte`);
  // Prezzi delle carte dei set giapponesi (le altre lingue asiatiche non hanno un listino proprio).
  const jaIds = new Set((tsets.ja ?? []).map((s) => s.id));
  const jaCodes = new Set(Object.entries(found).filter(([k]) => jaIds.has(k.split("@")[0]) && (!k.includes("@") || k.endsWith("@ja"))).map(([, c]) => c));
  for (const c of extraCodes) jaCodes.add(c);
  // Set "extra": i nomi con cui li chiama Collectr e il nome da mostrare.
  for (const [id, x] of Object.entries(EXTRA_JA_SETS)) {
    if (!found[`${id}@ja`]) continue;
    for (const n of x.collectr) names.ja[n] = id;
  }
  for (const [n, ids] of Object.entries(EXTRA_JA_GROUPS)) names.ja[n] = ids;
  const labels = Object.fromEntries(Object.entries(EXTRA_JA_SETS).filter(([id]) => found[`${id}@ja`]).map(([id, x]) => [id, x.label]));
  let guide = new Map();
  let singles = new Map();
  try {
    const res = await fetchRetry(CM_GUIDE);
    guide = new Map(((await res.json()).priceGuides || []).map((g) => [Number(g.idProduct), g]));
    const list = await (await fetchRetry(CM_SINGLES)).json();
    singles = new Map((list.products || []).map((p) => [Number(p.idProduct), { name: p.name, idExpansion: p.idExpansion }]));
  } catch (err) {
    log.push(`! listino Cardmarket non letto: ${err.message}`);
  }
  let priced = 0;
  for (const code of Object.keys(cards)) {
    let offers = null;
    if (jaCodes.has(code)) {
      try {
        offers = await ct.offersByExpansion(byCode.get(code).id, "jp");
      } catch (err) {
        log.push(`! offerte di ${code}: ${err.message}`);
      }
    }
    const rows = jaCodes.has(code) ? linkByName(cards[code], singles) : cards[code];
    cards[code] = withPrices(rows, jaCodes.has(code) ? guide : new Map(), offers);
    priced += cards[code].filter((r) => r[6] || r[8]).length;
  }
  log.push(`Carte giapponesi con un prezzo: ${priced}`);
  log.push(`Nomi inglesi dei set: ${NAME_LANGS.map((l) => `${l} ${Object.keys(names[l]).length}`).join(", ")}`);
  let dex = {};
  try {
    dex = await tcgdexDex();
    log.push(`Set giapponesi col numero del Pokédex: ${Object.keys(dex).length}`);
  } catch (err) {
    log.push(`! numeri del Pokédex non letti: ${err.message}`);
  }
  // v2: nomi inglesi dei set e prezzi delle carte giapponesi (l'app riscarica i file v1).
  return { data: { v: 2, updated: now.toISOString(), sets: found, cards, names, totals: { ...totals, ...TOTAL_FIX }, dex, labels, en, setEn }, log };
}

/**
 * Set giapponesi vecchi che Collectr numera col Pokédex ("Dark Charizard" = 006): per ognuno, numero
 * del Pokédex -> carta TCGdex, solo se in quel set c'è una sola carta di quel Pokémon.
 */
export const DEX_SETS = ["PMCG1", "PMCG2", "PMCG3", "PMCG4", "PMCG5", "PMCG6", "neo1", "neo2", "neo3", "neo4"];

/** { numeroPokédex: idCarta } dalle carte di un set ([{ id, dexId: [n] }]), senza i numeri ripetuti. */
export function dexMap(cards) {
  const seen = new Map();
  for (const c of cards) {
    for (const n of c.dexId ?? []) {
      const k = String(n);
      seen.set(k, seen.has(k) && seen.get(k) !== c.id ? null : c.id);
    }
  }
  return Object.fromEntries([...seen].filter(([, id]) => id));
}

async function tcgdexDex(sets = DEX_SETS) {
  const out = {};
  for (const setId of sets) {
    const res = await fetchRetry(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(setId)}`);
    if (!res.ok) continue;
    const cards = [];
    for (const c of (await res.json()).cards ?? []) {
      const r = await fetchRetry(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(c.id)}`);
      if (r.ok) cards.push(await r.json());
    }
    out[setId] = dexMap(cards);
  }
  return out;
}

/** Set di TCGdex nelle lingue asiatiche (con il numero ufficiale di carte). */
async function tcgdexAsianSets() {
  const out = {};
  for (const lang of NAME_LANGS) {
    const res = await fetchRetry(`https://api.tcgdex.net/v2/${lang}/sets`);
    out[lang] = res.ok ? await res.json() : [];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  const token = process.env.CARDTRADER_TOKEN;
  if (!out || !token) {
    console.log("uso: CARDTRADER_TOKEN=... node prezzi/src/asia.js <uscita.json>");
    process.exit(1);
  }
  const { data, log } = await buildAsia({ ct: new CardTrader({ token }) });
  console.log(log.join("\n"));
  await fs.writeFile(out, JSON.stringify(data));
}
