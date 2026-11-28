// Carte libere Topps (topps-libere.js): titoli veri di eBay Regno Unito e Stati Uniti del 26 novembre 2026.
import test from "node:test";
import assert from "node:assert/strict";
import { seasons, sameSeason, numberIn, numberOk, wantsOf, matches, reject, split, priced, plan, run, defsOf, prune, ecbRates, queryOf } from "../src/topps-libere.js";

const yamal = { id: "-1", set: "Match Attax Extra 2024/25", num: "339", name: "Lamine Yamal", ver: "" };
const verstappen = { id: "-2", set: "Topps Chrome Formula 1 2023", num: "1", name: "Max Verstappen", ver: "" };
const bellingham = { id: "-3", set: "Topps Chrome UEFA 2023-24", num: "22", name: "Jude Bellingham", ver: "Refractor" };
const trout = { id: "-5", set: "Topps Update 2011", num: "US175", name: "Mike Trout", ver: "" };
const adam = { id: "-4", set: "Garbage Pail Kids 1985 Series 1", num: "8a", name: "Adam Bomb", ver: "" };

test("stagioni e anni scritti in tanti modi", () => {
  assert.deepEqual(seasons("match attax 2024/25").spans, [2024]);
  assert.deepEqual(seasons("topps match attax 24/25 ucc").spans, [2024]);
  assert.deepEqual(seasons("2024-2025 topps").spans, [2024]);
  // Una carta numerata non è una stagione.
  assert.deepEqual(seasons("purple checker flag #113 43/75").spans, []);
  assert.deepEqual(seasons("2023 topps chrome f1").singles, [2023]);
  const want = seasons("match attax extra 2024/25");
  assert.ok(sameSeason(want, seasons("topps match attax 24/25 extra")));
  assert.ok(sameSeason(want, seasons("2025 topps match attax extra")));
  assert.ok(!sameSeason(want, seasons("topps match attax 2025/26")));
  assert.ok(!sameSeason(want, seasons("topps match attax extra lamine yamal")));
  assert.ok(sameSeason(seasons("topps update 2011"), seasons("mike trout 2011-12 topps update")));
});

test("il numero della carta nel titolo", () => {
  assert.ok(numberIn("lamine yamal 100 club #339", "339"));
  assert.ok(numberIn("card no. 1 luke skywalker", "1"));
  assert.ok(!numberIn("max verstappen #113 43/75", "43"));
  assert.ok(!numberIn("max verstappen #169 orange wave", "1"));
  assert.ok(!numberIn("1 of 10 puzzle", "1"));
  assert.ok(numberIn("mike trout #us175 rc", "US175"));
  assert.ok(numberIn("tifo #tf-9 case hit", "TF9"));
  assert.ok(numberIn("series 1 usa 8a adam bomb", "8a"));
  assert.ok(!numberIn("adam bomb 8b blasted billy", "8a"));
});

test("la carta giusta e non le sue parenti", () => {
  const w = wantsOf(yamal);
  assert.ok(matches("Topps Match Attax 2024-25 UCC Extra Lamine Yamal Barcelona 100 Club #339", w));
  assert.ok(matches("Topps Match Attax 24/25 UCC Extra Lamine Yamal 100 Club #339 FC Barcelona", w));
  assert.equal(reject("Topps Match Attax UCL 2025/26 Lamine Yamal FC Barcelona Red Hot UR #RH-LY", w), "anno");
  assert.equal(reject("Topps Match Attax UEFA Club Competitions 2024-25 Lamine Yamal #STB LE1 LE", w), "set");
  // Senza "Extra" nella carta, la Extra è un'altra linea.
  assert.equal(reject("Topps Match Attax Extra 2023/24 Erling Haaland Mega Boost #185", wantsOf({ set: "Match Attax 2023/24", num: "185", name: "Erling Haaland" })), "altra linea");
});

test("la carta base senza le parallele, le autografate e le altre linee", () => {
  const w = wantsOf(verstappen);
  assert.ok(matches("2023 Topps Chrome Formula 1 #1 Max Verstappen", w));
  // Red Bull è la squadra, non una versione rossa.
  assert.ok(matches("2023 Topps Chrome F1 Max Verstappen #1 Red Bull Racing", w));
  assert.equal(reject("Topps Chrome Formula 1 2023 - Max Verstappen #1 - Image Variation IV SP Rare", w), "parallela");
  assert.equal(reject("2023 Topps Chrome Formula 1 F1 Max Verstappen #1 Purple Green Refractor Portrait", w), "parallela");
  assert.equal(reject("2023 Topps Chrome Sapphire F1 Max Verstappen Base Oracle Red Bull Racing #1", w), "altra linea");
  assert.equal(reject("2023 Topps Chrome Formula 1 F1 Max Verstappen #169 Orange Wave /25 PSA 9", w), "numero");
  const t = wantsOf(trout);
  assert.ok(matches("2011 Topps Update Mike Trout #US175 RC Los Angeles Angels PSA 9", t));
  assert.equal(reject("2011 TOPPS UPDATE GOLD #US175 MIKE TROUT BGS 9.5", t), "parallela");
  assert.equal(reject("Topps Project 2020 #227 Mike Trout  WAR MACHINE - Efdot  2011 Update #US175 RC", t), "altra linea");
  assert.equal(reject("2011 Topps Update #US175 Mike Trout Autographed Signed RC Rookie Card (PSA DNA)", t), "parallela");
});

test("con la versione scritta: quella, non le colorate né le numerate", () => {
  const w = wantsOf(bellingham);
  assert.ok(matches("Topps Chrome UEFA Champions League 2023/24 Jude Bellingham Refractor #22", w));
  assert.equal(reject("2023-24 Topps Chrome Jude Bellingham Real Madrid Blue Refractor #22 - 06/150", w), "numerata");
  assert.equal(reject("2023-24 Topps Chrome UEFA Jude Bellingham Gold Refractor #22", w), "colore");
  assert.equal(reject("🔥💎Jude Bellingham 2024-25 Topps Chrome UEFA UCC #22 GOLD REFRACTOR /50 Madrid", w), "anno");
  assert.equal(reject("2023-24 Topps Chrome UEFA Jude Bellingham #22", w), "versione");
  const gold = wantsOf({ ...verstappen, ver: "Gold Refractor /50" });
  assert.ok(matches("2023 Topps Chrome Formula 1 F1 Max Verstappen #1 Gold Refractor /50", gold));
  assert.equal(reject("2023 Topps Chrome Formula 1 F1 Max Verstappen #1 Gold Refractor /25", gold), "numerazione");
});

test("le Garbage Pail Kids sono adesivi", () => {
  const w = wantsOf(adam);
  assert.ok(matches("Adam Bomb 1985 Garbage Pail Kids Stickers #8a Series 1 PSA 4 GPK Vintage", w));
  assert.ok(matches("1985 Topps Garbage Pail Kids GPK First Original Series 1 OS1 8a Adam Bomb", w));
  assert.ok(reject("1985 Garbage Pail Kids 8A Adam Bomb 8B Blasted Billy UK Mini Series 1 Pair", w));
});

test("prezzi in euro divisi tra non gradate e gradate, rovinate fuori", () => {
  const rates = { EUR: 1, USD: 1.05, GBP: 0.84 };
  const items = [
    { title: "Topps Match Attax 2024-25 UCC Extra Lamine Yamal Barcelona 100 Club #339", price: 8.4, currency: "GBP", image: "a.jpg" },
    { title: "Topps Match Attax 24/25 UCC Extra Lamine Yamal 100 Club #339 FC Barcelona", price: 21, currency: "USD", image: "b.jpg" },
    { title: "2024-25 Topps Match Attax Extra Lamine Yamal 100 Club PSA 9 Barcelona #339", price: 105, currency: "USD" },
    { title: "Topps Match Attax 24/25 Extra Lamine Yamal 100 Club #339 damaged", price: 1, currency: "GBP" },
    { title: "Topps Match Attax 24/25 Extra Lamine Yamal 100 Club #339", price: 5, currency: "CHF" },
  ];
  const b = split(items, yamal, rates);
  assert.deepEqual(b.e, [10, 20]);
  assert.deepEqual(b["g:PSA 9"], [100]);
  assert.equal(b.img, "a.jpg");
  delete b.imgLen;
  const p = priced(b);
  assert.deepEqual(p.e, [10, 2]);
  assert.deepEqual(p.g["PSA 9"], [100, 1]);
  assert.equal(priced({}), null);
});

test("giro: le carte mai cercate per prime, due ricerche per carta", () => {
  const defs = [{ id: "-1" }, { id: "-2" }, { id: "-3" }, { id: "-4" }];
  const state = { s: { "-1": { d: 100 }, "-2": { d: 80 }, "-3": { d: 95, empty: 1 } } };
  // Oggi 110: -1 cercata 10 giorni fa (no), -2 30 giorni fa (sì), -3 vuota da 15 (no), -4 mai (prima).
  assert.deepEqual(plan(defs, state, 110, 200).map((d) => d.id), ["-4", "-2"]);
  assert.deepEqual(plan(defs, state, 110, 3).map((d) => d.id), ["-4"]);
  prune(state, [{ id: "-1" }], 200);
  assert.deepEqual(Object.keys(state.s), ["-1"]);
});

test("dalle righe delle collezioni solo le carte libere, coi testi tagliati", () => {
  const defs = defsOf([
    { card_id: "tt:-123", set: "  Match Attax   2024/25 ", num: "12", name: "Yamal", ver: null },
    { card_id: "tt:-123", set: "doppione", num: "1", name: "Altro" },
    { card_id: "tt:456", set: "Topps Chrome", num: "6", name: "Charizard" },
    { card_id: "tt:-9", set: "x", num: "1", name: "Senza set" },
    { card_id: "tt:-10", set: "S".repeat(200), num: "1", name: "Lungo" },
  ]);
  assert.deepEqual(defs.map((d) => d.id), ["-123", "-10"]);
  assert.equal(defs[0].set, "Match Attax 2024/25");
  assert.equal(defs[0].ver, "");
  assert.equal(defs[1].set.length, 80);
  assert.equal(queryOf({ set: "Topps Chrome (F1) 2023", name: "Max \"Mad\" Verstappen", num: "#1", ver: "" }), "Topps Chrome F1 2023 Max Mad Verstappen 1");
});

test("cambi della BCE", () => {
  const xml = "<Cube currency='USD' rate='1.0512'/><Cube currency='GBP' rate='0.8334'/>";
  assert.deepEqual(ecbRates(xml), { EUR: 1, USD: 1.0512, GBP: 0.8334 });
  assert.equal(ecbRates("<html>errore</html>"), null);
});

test("un voto o una serie non sono il numero della carta; col cancelletto vale solo quello", () => {
  // La carta 10 non è la "#339 PSA 10" (revisione del 26 novembre 2026).
  const ten = wantsOf({ set: "Topps Chrome 2023", num: "10", name: "Erling Haaland", ver: "" });
  assert.equal(reject("Erling Haaland 2023 Topps Chrome #339 PSA 10", ten), "numero");
  assert.ok(matches("Erling Haaland 2023 Topps Chrome #10 PSA 10", ten));
  assert.ok(matches("Erling Haaland 2023 Topps Chrome 10 Manchester City", ten));
  // "Series 1" non è la carta numero 1.
  assert.ok(!numberOk("1985 garbage pail kids series 1 nasty nick #5a", "1"));
  assert.ok(numberOk("1985 garbage pail kids series 1 nasty nick #1a", "1a"));
  assert.ok(numberOk("topps star wars no. 1 luke skywalker", "1"));
  assert.ok(!numberOk("max verstappen #113 43/75", "43"));
  assert.ok(numberOk("mike trout #us175 rc", "US175"));
  assert.ok(numberOk("tifo #tf-9 case hit", "TF9"));
  assert.ok(numberOk("card #007 james bond", "7"));
  // Un numero scritto con la barra si cerca con la barra.
  assert.ok(numberOk("max verstappen gold 12/99", "12/99"));
  assert.ok(!numberOk("max verstappen gold 12/50", "12/99"));
  assert.ok(numberOk("qualunque titolo", ""));
});

test("una ricerca in errore: carta in coda, prezzo di prima tenuto, niente testo dell'utente nel registro", async () => {
  const defs = [{ id: "-1", set: "Match Attax 2024/25", num: "1", name: "Mario Rossi", ver: "" }, { id: "-2", set: "Match Attax 2024/25", num: "2", name: "Luigi Verdi", ver: "" }];
  const state = { s: {}, p: { "-2": { e: [3, 2] } } };
  const boom = { search: async (q) => { throw new Error(`eBay search "${q}": HTTP 503`); } };
  const log = [];
  const calls = await run({ ebays: { GB: boom, US: boom }, defs, state, today: 100, budget: 200, rates: { EUR: 1 }, pauseMs: 0, log });
  assert.equal(calls, 0);
  assert.deepEqual(state.s["-1"], { d: 100, fail: 1, empty: 1 });
  assert.deepEqual(state.s["-2"], { d: 100, fail: 1 });
  assert.deepEqual(state.p["-2"], { e: [3, 2] });
  assert.ok(!log.join(" ").includes("Rossi") && !log.join(" ").includes("Verdi"));
  // Lo stesso giorno non si riprovano; il giorno dopo sì, dopo le carte mai cercate.
  assert.deepEqual(plan([...defs, { id: "-3" }], state, 100, 200).map((d) => d.id), ["-3"]);
  assert.deepEqual(plan([...defs, { id: "-3" }], state, 101, 200).map((d) => d.id), ["-3", "-1", "-2"]);
  // Venti errori di fila fermano il giro, con il solo codice dell'errore nel registro.
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `-${100 + i}`, set: "Match Attax 2024/25", num: String(i), name: "Segreto Nome", ver: "" }));
  const log2 = [];
  await run({ ebays: { GB: boom, US: boom }, defs: many, state: { s: {}, p: {} }, today: 100, budget: 200, rates: { EUR: 1 }, pauseMs: 0, log: log2 });
  assert.ok(log2.some((l) => l.includes("HTTP 503")));
  assert.ok(!log2.join(" ").includes("Segreto"));
});

test("il pacchetto del servizio topps-price ha le regole di adesso", async () => {
  const fs = await import("node:fs/promises");
  const crypto = await import("node:crypto");
  const here = new URL(".", import.meta.url);
  const bundlePath = new URL("../../supabase/functions/topps-price/regole.js", here);
  const [rules, common, bundleText] = await Promise.all([
    fs.readFile(new URL("../src/topps-libere-regole.js", here)),
    fs.readFile(new URL("../src/topps-regole.js", here)),
    fs.readFile(bundlePath, "utf8"),
  ]);
  // Regole cambiate senza rifare il pacchetto: bash scripts/pacchetto-topps-price.sh, poi ripubblicare il servizio.
  const sum = crypto.createHash("md5").update(Buffer.concat([rules, common])).digest("hex");
  assert.equal(bundleText.match(/Impronta: ([0-9a-f]{32})/)?.[1], sum, "rilancia scripts/pacchetto-topps-price.sh e ripubblica topps-price");
  // Niente di Node nel pacchetto (gira su Deno) e gli stessi risultati del job.
  assert.ok(!/node:|Buffer\.|process\./.test(bundleText));
  // Letto come testo e importato da un indirizzo "data:": nella copia pubblica del job non c'è un package.json sopra quella
  // cartella, e un Node più vecchio del 22.7 leggerebbe il file come CommonJS.
  const b = await import(`data:text/javascript;base64,${Buffer.from(bundleText).toString("base64")}`);
  const items = [
    { title: "2024-25 Topps Match Attax Extra Lamine Yamal #339 Barcelona", price: 10, currency: "GBP", image: "https://i.ebayimg.com/a.jpg" },
    { title: "Topps Match Attax Extra 2024/25 - 339 Lamine Yamal PSA 9", price: 70, currency: "GBP" },
    { title: "Topps Match Attax Extra 2024/25 Lamine Yamal 339 Gold Parallel", price: 50, currency: "GBP" },
    { title: "Match Attax 2023/24 Lamine Yamal 339", price: 2, currency: "GBP" },
  ];
  const rates = { EUR: 1, GBP: 0.8, USD: 1.1 };
  const mine = priced(split(items, yamal, rates));
  assert.deepEqual(b.priced(b.split(items, yamal, rates)), mine);
  assert.deepEqual(mine.e, [12.5, 1]);
  assert.deepEqual(mine.g, { "PSA 9": [87.5, 1] });
  assert.equal(b.queryOf(yamal), queryOf(yamal));
  assert.equal(typeof b.Ebay, "function");
});
