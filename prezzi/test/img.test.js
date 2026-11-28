import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// La regola dei percorsi del servizio "img" (foto CardTrader per la versione web). Il file sta nel repo dell'app: nella
// copia pubblica del job non c'è, e lì questi test si saltano.
const file = fileURLToPath(new URL("../../supabase/functions/img/percorso.js", import.meta.url));
const skip = !existsSync(file);
const load = async () => (await import(file)).safePath;

test("foto CardTrader accettate, anche col nome con le parentesi", { skip }, async () => {
  const safePath = await load();
  assert.ok(safePath("/uploads/blueprints/image/245406/show_trafalgar-law-event-pack-vol-3-store-tournaments-promos.png"));
  assert.ok(safePath("/uploads/blueprints/image/258656/show_151-elite-trainer-box-151.jpg"));
  // La seconda foto caricata per una carta: prima rifiutata (400), e la carta restava senza foto nel browser.
  assert.ok(safePath("/uploads/blueprints/image/346491/show_mickey-mouse-steamboat-pilot-enchanted-fabled(2).jpg"));
  assert.ok(safePath("/uploads/blueprints/image/362053/show_son-goten-super-alternate-art-fusion-world-saiyan-s-pride(2).JPG"));
  assert.ok(safePath("/uploads/blueprints/image/1/preview_x%282%29.webp"));
});

test("niente fuori da /uploads/, niente che non sia un'immagine, niente risalite di cartella", { skip }, async () => {
  const safePath = await load();
  assert.ok(!safePath(""));
  assert.ok(!safePath(null));
  assert.ok(!safePath("/admin/users.json"));
  assert.ok(!safePath("/uploads/blueprints/image/1/x.svg"));
  assert.ok(!safePath("/uploads/blueprints/image/1/x.jpg?size=big"));
  assert.ok(!safePath("https://altro.sito/uploads/x.jpg"));
  assert.ok(!safePath("/uploads/../segreti/x.jpg"));
  assert.ok(!safePath("/uploads/%2e%2e/segreti/x.jpg"));
  assert.ok(!safePath("/uploads/a/%2E%2E/x.png"));
  assert.ok(!safePath("/uploads/a/./x.png"));
  assert.ok(!safePath("/uploads/a%5Cb/x.png"));
  assert.ok(!safePath("/uploads/a b/x.png"));
  assert.ok(!safePath("/uploads/a/x(2).jpg#y"));
  assert.ok(!safePath("/uploads/%E0%A4%A/x.jpg"));
});
